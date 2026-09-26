import multer from 'multer';
import { config } from '../config.js';

/**
 * Los archivos se reciben en memoria, no en disco: así el mismo buffer sirve
 * para el OCR y para subirlo al almacenamiento, y no dependemos del sistema
 * de archivos (que en Render es efímero).
 */

const MIMES_COMPROBANTE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

/** Documentos de soporte del consentimiento: PDF, Word o imagen escaneada. */
const MIMES_DOCUMENTO = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

const storage = multer.memoryStorage();

function filtro(permitidos, mensaje) {
  return (_req, file, cb) => {
    if (!permitidos.has(file.mimetype)) {
      cb(new Error(mensaje));
      return;
    }
    cb(null, true);
  };
}

export const subirComprobante = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: filtro(MIMES_COMPROBANTE, 'Formato no permitido. Usa JPG, PNG, WEBP o PDF.'),
}).single('comprobante');

export const subirDocumento = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: filtro(
    MIMES_DOCUMENTO,
    'Formato no permitido. Usa PDF, Word (DOC/DOCX) o una imagen.',
  ),
}).single('documento');

/** Envuelve el middleware de multer para responder 400 con mensaje claro. */
export function conArchivo(middleware) {
  return (req, res, next) =>
    middleware(req, res, (error) => {
      if (error) {
        const esTamano = error.code === 'LIMIT_FILE_SIZE';
        res.status(400).json({
          error: esTamano
            ? `El archivo supera los ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`
            : error.message,
        });
        return;
      }
      next();
    });
}
