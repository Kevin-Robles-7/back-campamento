import { query } from '../db.js';
import { config } from '../config.js';
import * as almacenamiento from './almacenamiento.service.js';

/**
 * Limpieza de borradores.
 *
 * Un comprobante sin `inscripcion_id` es un borrador: alguien subió la imagen
 * pero no terminó la inscripción (recargó, cerró la pestaña o se fue). Lo mismo
 * aplica a los documentos de consentimiento que nadie llegó a asociar.
 *
 * Solo lo confirmado en el paso final permanece guardado.
 */

const MINUTOS_GRACIA = config.minutosBorrador;
const INTERVALO_MS = 10 * 60 * 1000;

/**
 * Descarta un comprobante que aún no pertenece a ninguna inscripción.
 * @returns {Promise<boolean>} true si se eliminó
 */
export async function descartarComprobante(id) {
  const filas = await query(
    `DELETE FROM comprobantes
      WHERE id = $1 AND inscripcion_id IS NULL
      RETURNING archivo_ruta`,
    [id],
  );
  if (!filas.length) return false;

  await almacenamiento.borrar(filas[0].archivo_ruta);
  return true;
}

/** Descarta un documento de consentimiento que nadie asoció a una persona. */
export async function descartarDocumento(id) {
  const filas = await query(
    `DELETE FROM documentos_consentimiento
      WHERE id = $1
        AND NOT EXISTS (
          SELECT 1 FROM consentimientos_menores c WHERE c.documento_id = documentos_consentimiento.id
        )
      RETURNING archivo_ruta`,
    [id],
  );
  if (!filas.length) return false;

  await almacenamiento.borrar(filas[0].archivo_ruta);
  return true;
}

/**
 * Elimina los borradores abandonados con más de `MINUTOS_GRACIA` minutos.
 * @returns {Promise<{comprobantes: number, documentos: number}>}
 */
export async function limpiarBorradores() {
  const comprobantes = await query(
    `DELETE FROM comprobantes
      WHERE inscripcion_id IS NULL
        AND created_at < NOW() - ($1 || ' minutes')::INTERVAL
      RETURNING archivo_ruta`,
    [MINUTOS_GRACIA],
  );

  const documentos = await query(
    `DELETE FROM documentos_consentimiento d
      WHERE d.created_at < NOW() - ($1 || ' minutes')::INTERVAL
        AND NOT EXISTS (SELECT 1 FROM consentimientos_menores c WHERE c.documento_id = d.id)
      RETURNING d.archivo_ruta`,
    [MINUTOS_GRACIA],
  );

  await Promise.all(
    [...comprobantes, ...documentos].map((fila) => almacenamiento.borrar(fila.archivo_ruta)),
  );

  return { comprobantes: comprobantes.length, documentos: documentos.length };
}

/** Programa la limpieza periódica. Devuelve una función para detenerla. */
export function programarLimpieza() {
  const ejecutar = async () => {
    try {
      const { comprobantes, documentos } = await limpiarBorradores();
      if (comprobantes || documentos) {
        console.log(
          `[limpieza] ${comprobantes} comprobante(s) y ${documentos} documento(s) sin usar eliminados`,
        );
      }
    } catch (error) {
      console.warn('[limpieza] no se pudo ejecutar:', error.message);
    }
  };

  ejecutar();
  const temporizador = setInterval(ejecutar, INTERVALO_MS);
  temporizador.unref();
  return () => clearInterval(temporizador);
}
