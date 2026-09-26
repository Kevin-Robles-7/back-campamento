import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Almacenamiento de archivos con dos implementaciones:
 *
 *  - `local`: guarda en disco. Solo para desarrollo, porque en Render el
 *    sistema de archivos se borra en cada despliegue.
 *  - `s3`: cualquier servicio compatible con S3 (Supabase Storage,
 *    Cloudflare R2). El bucket se mantiene PRIVADO y los comprobantes se
 *    sirven con enlaces temporales firmados, porque contienen nombres y
 *    datos bancarios.
 *
 * La interfaz es la misma en los dos casos:
 *   guardar(archivo) -> { clave, nombre, mime, tamanoBytes }
 *   urlDe(clave)     -> string | null
 *   borrar(clave)
 */

const { driver, carpetaLocal } = config.almacenamiento;
const esS3 = driver === 's3';

// --- Cliente S3 perezoso: solo se carga si de verdad se usa ---
let clientePromesa = null;
let firmador = null;

async function cliente() {
  if (!clientePromesa) {
    clientePromesa = (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      firmador = getSignedUrl;

      const { region, endpoint, accessKeyId, secretAccessKey, forcePathStyle } =
        config.almacenamiento;

      return new S3Client({
        region,
        endpoint: endpoint || undefined,
        forcePathStyle,
        credentials: { accessKeyId, secretAccessKey },
      });
    })();
  }
  return clientePromesa;
}

/** Nombre de objeto único, agrupado por año y mes para facilitar el orden. */
function nuevaClave(nombreOriginal) {
  const extension = path.extname(nombreOriginal).toLowerCase().slice(0, 10);
  const hoy = new Date();
  const carpeta = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  return `${carpeta}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
}

// ------------------------------------------------------------
//  Guardar
// ------------------------------------------------------------

/**
 * Guarda el archivo recibido por multer (en memoria).
 * @param {{originalname: string, mimetype: string, buffer: Buffer, size: number}} archivo
 */
export async function guardar(archivo) {
  const clave = nuevaClave(archivo.originalname);

  if (esS3) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await cliente();
    await s3.send(
      new PutObjectCommand({
        Bucket: config.almacenamiento.bucket,
        Key: clave,
        Body: archivo.buffer,
        ContentType: archivo.mimetype,
      }),
    );
  } else {
    const destino = path.join(rutaLocal(), clave);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, archivo.buffer);
  }

  return {
    clave,
    nombre: archivo.originalname,
    mime: archivo.mimetype,
    tamanoBytes: archivo.size,
  };
}

// ------------------------------------------------------------
//  Leer y enlazar
// ------------------------------------------------------------

/**
 * Enlace para ver el archivo.
 * En S3 es un enlace firmado que caduca; en local es la ruta estática.
 */
export async function urlDe(clave) {
  if (!clave) return null;

  if (!esS3) return `/uploads/${clave}`;

  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await cliente();
  return firmador(
    s3,
    new GetObjectCommand({ Bucket: config.almacenamiento.bucket, Key: clave }),
    { expiresIn: config.almacenamiento.minutosEnlace * 60 },
  );
}

// ------------------------------------------------------------
//  Borrar
// ------------------------------------------------------------

export async function borrar(clave) {
  if (!clave) return;

  try {
    if (esS3) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = await cliente();
      await s3.send(
        new DeleteObjectCommand({ Bucket: config.almacenamiento.bucket, Key: clave }),
      );
    } else {
      await fs.unlink(path.join(rutaLocal(), clave));
    }
  } catch {
    /* si el archivo ya no existe no hay nada que hacer */
  }
}

// ------------------------------------------------------------
//  Utilidades
// ------------------------------------------------------------

/** Carpeta local absoluta (solo aplica al driver `local`). */
export function rutaLocal() {
  return path.resolve(process.cwd(), carpetaLocal);
}

export function usaS3() {
  return esS3;
}

/** Comprueba que la configuración esté completa antes de arrancar. */
export function validarConfiguracion() {
  if (!esS3) return { ok: true, driver: 'local' };

  const faltan = ['bucket', 'endpoint', 'accessKeyId', 'secretAccessKey'].filter(
    (campo) => !config.almacenamiento[campo],
  );

  if (faltan.length) {
    return {
      ok: false,
      driver: 's3',
      mensaje: `Faltan variables de almacenamiento: ${faltan
        .map((c) => `S3_${c.replace(/([A-Z])/g, '_$1').toUpperCase()}`)
        .join(', ')}`,
    };
  }

  return { ok: true, driver: 's3', bucket: config.almacenamiento.bucket };
}
