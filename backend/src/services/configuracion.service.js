import { query } from '../db.js';

const CACHE_MS = 30_000;
let cache = { valores: null, expira: 0 };

export async function obtenerConfiguracion() {
  if (cache.valores && Date.now() < cache.expira) return cache.valores;

  const filas = await query('SELECT clave, valor FROM configuracion');
  const mapa = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));

  const valores = {
    tarifaBus: Number(mapa.tarifa_bus ?? 195000),
    tarifaVehiculoPropio: Number(mapa.tarifa_vehiculo_propio ?? 180000),
    abonoMinimo: Number(mapa.abono_minimo ?? 20000),
    llavePago: mapa.llave_pago ?? '',
    correoDestino: mapa.correo_destino ?? '',
    fechaEvento: mapa.fecha_evento ?? '',
    lugarEvento: mapa.lugar_evento ?? '',
    whatsapp: mapa.whatsapp ?? '',
    // Unico destino valido: el pago solo se acepta si llego a esta llave.
    llavesValidas: (mapa.llaves_validas ?? mapa.llave_pago ?? '')
      .split(',')
      .map((llave) => llave.trim())
      .filter(Boolean),
    validarLlave: (mapa.validar_llave ?? '1') === '1',
    // Vigencia de la fecha del comprobante.
    validarFecha: (mapa.validar_fecha ?? '1') === '1',
    diasVigencia: Number(mapa.dias_vigencia_comprobante ?? 30),
    minutosTolerancia: Number(mapa.minutos_tolerancia_fecha ?? 120),
  };

  cache = { valores, expira: Date.now() + CACHE_MS };
  return valores;
}

export function limpiarCacheConfiguracion() {
  cache = { valores: null, expira: 0 };
}

/**
 * Normaliza una llave de pago para poder compararla:
 * quita tildes, espacios, guiones y el prefijo de indicativo colombiano.
 * "@Plata 314-381-7689" y "+57 3143817689" quedan equivalentes.
 */
function normalizarLlave(llave) {
  const base = String(llave ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s()-]/g, '');

  // Correo: se compara tal cual.
  if (base.includes('@') && base.includes('.')) return base.replace(/^@/, '');

  // Solo dígitos: se comparan los últimos 10 (celular colombiano).
  const digitos = base.replace(/\D/g, '');
  if (digitos.length >= 10) return digitos.slice(-10);

  return base.replace(/^@/, '');
}

/**
 * ¿La cuenta leída del comprobante es la misma que la esperada?
 * Acepta que el comprobante muestre la llave completa («@Plata3143817689»)
 * o únicamente el celular asociado («314 381 7689»), pero nada más.
 */
function coincideLlave(esperada, detectada) {
  const a = normalizarLlave(esperada);
  const b = normalizarLlave(detectada);
  if (!a || !b) return false;
  if (a === b) return true;

  // Comparación por el celular de 10 dígitos, exacta (sin subcadenas).
  const digitosA = a.replace(/\D/g, '');
  const digitosB = b.replace(/\D/g, '');
  return digitosA.length === 10 && digitosA === digitosB;
}

/**
 * Verifica que el dinero se haya enviado a la llave del campamento.
 * @returns {{ valida: boolean, llavesValidas: string[], detectada: string|null }}
 */
export async function validarLlaveDestino(llaveDetectada) {
  const cfg = await obtenerConfiguracion();

  if (!cfg.validarLlave || !cfg.llavesValidas.length) {
    return { valida: true, llavesValidas: cfg.llavesValidas, detectada: llaveDetectada ?? null };
  }

  if (!normalizarLlave(llaveDetectada)) {
    return { valida: false, llavesValidas: cfg.llavesValidas, detectada: null };
  }

  return {
    valida: cfg.llavesValidas.some((llave) => coincideLlave(llave, llaveDetectada)),
    llavesValidas: cfg.llavesValidas,
    detectada: llaveDetectada,
  };
}

export { normalizarLlave };

/**
 * Verifica que la fecha del comprobante sea legible y esté vigente.
 * Evita que se reutilicen capturas antiguas o con fecha adulterada.
 *
 * @param {string|Date|null} fecha fecha leída del comprobante
 * @returns {Promise<{ valida: boolean, codigo: string|null, fecha: Date|null, diasVigencia: number }>}
 */
export async function validarFechaComprobante(fecha) {
  const cfg = await obtenerConfiguracion();
  const resultado = { valida: true, codigo: null, fecha: null, diasVigencia: cfg.diasVigencia };

  if (!cfg.validarFecha) return resultado;

  if (!fecha) return { ...resultado, valida: false, codigo: 'fecha_ilegible' };

  const momento = fecha instanceof Date ? fecha : new Date(String(fecha).replace(' ', 'T'));
  if (Number.isNaN(momento.getTime())) {
    return { ...resultado, valida: false, codigo: 'fecha_ilegible' };
  }
  resultado.fecha = momento;

  const ahora = Date.now();
  const tolerancia = cfg.minutosTolerancia * 60_000;

  // Fecha posterior a hoy: el comprobante no puede ser del futuro.
  if (momento.getTime() > ahora + tolerancia) {
    return { ...resultado, valida: false, codigo: 'fecha_futura' };
  }

  // Comprobante demasiado antiguo.
  const limite = ahora - cfg.diasVigencia * 24 * 60 * 60_000;
  if (momento.getTime() < limite) {
    return { ...resultado, valida: false, codigo: 'fecha_vencida' };
  }

  return resultado;
}

export async function tarifaDe(transporte) {
  const cfg = await obtenerConfiguracion();
  return transporte === 'vehiculo_propio' ? cfg.tarifaVehiculoPropio : cfg.tarifaBus;
}

/**
 * Con un valor pagado calcula de cuántas formas se puede repartir:
 * cuántos cupos completos alcanza y a cuántas personas se les puede
 * abonar el mínimo.
 */
export async function analizarCapacidad(valorEnviado, transporte) {
  const cfg = await obtenerConfiguracion();
  const tarifa = await tarifaDe(transporte);
  const valor = Math.max(0, Number(valorEnviado) || 0);

  const personasCompletas = Math.floor(valor / tarifa);
  const restante = valor - personasCompletas * tarifa;
  const personasConAbono = restante >= cfg.abonoMinimo ? 1 : 0;

  // Reparto alternativo: todo el dinero en abonos mínimos.
  const maximoConAbono = Math.floor(valor / cfg.abonoMinimo);
  const sobranteAbonos = valor - maximoConAbono * cfg.abonoMinimo;

  return {
    transporte,
    tarifa,
    abonoMinimo: cfg.abonoMinimo,
    valorEnviado: valor,
    // Reparto con cupos completos primero
    personasCompletas,
    restante,
    personasConAbono,
    // Reparto en abonos mínimos
    maximoConAbono,
    sobranteAbonos,
    // Techo absoluto de personas registrables con este pago
    maximoPersonas: Math.max(1, maximoConAbono),
  };
}
