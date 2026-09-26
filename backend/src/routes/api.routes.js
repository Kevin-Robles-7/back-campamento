import { Router } from 'express';
import { queryOne } from '../db.js';
import { conArchivo, subirComprobante, subirDocumento } from '../middleware/upload.js';
import { analizarComprobante } from '../services/comprobante-ocr.service.js';
import { analizarCapacidad, obtenerConfiguracion } from '../services/configuracion.service.js';
import {
  conEnlace,
  consultarInscripcion,
  crearInscripcion,
  guardarComprobante,
  guardarDocumentoConsentimiento,
  mapearComprobante,
  obtenerInscripcion,
  registrarAbono,
  verificarComprobante,
} from '../services/inscripciones.service.js';
import { descartarComprobante, descartarDocumento } from '../services/limpieza.service.js';
import {
  esquemaAbono,
  esquemaConsulta,
  esquemaCrearInscripcion,
  validar,
} from '../validators.js';

export const router = Router();

const asyncHandler = (handler) => (req, res, next) => handler(req, res, next).catch(next);

const subir = conArchivo(subirComprobante);

// ------------------------------------------------------------
//  Configuracion publica (tarifas, llave de pago, etc.)
// ------------------------------------------------------------
router.get(
  '/configuracion',
  asyncHandler(async (_req, res) => {
    res.json(await obtenerConfiguracion());
  }),
);

// ------------------------------------------------------------
//  Paso 2: subir comprobante. El servidor lo lee, lo valida y decide.
//  No existe forma de editar los datos a mano: así no se puede falsificar.
// ------------------------------------------------------------
router.post(
  '/comprobantes',
  subir,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Adjunta la imagen de tu comprobante.' });
      return;
    }

    const analisis = await analizarComprobante({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    const id = await guardarComprobante(analisis.datos, req.file, analisis.origen, analisis.datos);
    const veredicto = await verificarComprobante(id);

    res.status(201).json({
      comprobante: await conEnlace(mapearComprobante(veredicto.comprobante)),
      aceptado: veredicto.aceptado,
      motivos: veredicto.motivos,
      llavesValidas: veredicto.llavesValidas,
      origen: analisis.origen,
      confianza: analisis.confianza ?? null,
    });
  }),
);

// ------------------------------------------------------------
//  Descartar borradores: se usa al recargar o abandonar la página.
//  Es POST (no DELETE) para poder llamarse con navigator.sendBeacon.
// ------------------------------------------------------------
router.post(
  '/comprobantes/:id/descartar',
  asyncHandler(async (req, res) => {
    const eliminado = await descartarComprobante(req.params.id);
    res.json({ eliminado });
  }),
);

router.post(
  '/consentimientos/documento/:id/descartar',
  asyncHandler(async (req, res) => {
    const eliminado = await descartarDocumento(req.params.id);
    res.json({ eliminado });
  }),
);

// ------------------------------------------------------------
//  Paso 3: analisis de capacidad segun el valor pagado
// ------------------------------------------------------------
router.get(
  '/comprobantes/:id/analisis',
  asyncHandler(async (req, res) => {
    const comprobante = await queryOne('SELECT * FROM comprobantes WHERE id = ?', [req.params.id]);
    if (!comprobante) {
      res.status(404).json({ error: 'Comprobante no encontrado.' });
      return;
    }

    const valor = Number(comprobante.valor_enviado) || 0;
    const [bus, vehiculoPropio] = await Promise.all([
      analizarCapacidad(valor, 'bus'),
      analizarCapacidad(valor, 'vehiculo_propio'),
    ]);

    res.json({
      comprobante: await conEnlace(mapearComprobante(comprobante)),
      opciones: { bus, vehiculoPropio },
    });
  }),
);

// ------------------------------------------------------------
//  Documento de soporte del consentimiento (PDF / Word)
// ------------------------------------------------------------
router.post(
  '/consentimientos/documento',
  conArchivo(subirDocumento),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Adjunta el documento del consentimiento.' });
      return;
    }
    res.status(201).json({ documento: await guardarDocumentoConsentimiento(req.file) });
  }),
);

// ------------------------------------------------------------
//  Paso 4 y 5: crear la inscripcion con las personas
// ------------------------------------------------------------
router.post(
  '/inscripciones',
  asyncHandler(async (req, res) => {
    const datos = validar(esquemaCrearInscripcion, req.body);
    const inscripcion = await crearInscripcion(datos);
    res.status(201).json({ inscripcion });
  }),
);

// ------------------------------------------------------------
//  Consultar inscripcion por documento o transaccion
// ------------------------------------------------------------
router.get(
  '/inscripciones/consultar',
  asyncHandler(async (req, res) => {
    const datos = validar(esquemaConsulta, req.query);
    const inscripcion = await consultarInscripcion(datos);
    if (!inscripcion) {
      res.status(404).json({ error: 'No encontramos ninguna inscripcion con esos datos.' });
      return;
    }
    res.json({ inscripcion });
  }),
);

router.get(
  '/inscripciones/:id',
  asyncHandler(async (req, res) => {
    const inscripcion = await obtenerInscripcion(req.params.id);
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripcion no encontrada.' });
      return;
    }
    res.json({ inscripcion });
  }),
);

// ------------------------------------------------------------
//  Terminar inscripcion: registrar un abono adicional
// ------------------------------------------------------------
router.post(
  '/pagos',
  asyncHandler(async (req, res) => {
    const datos = validar(esquemaAbono, req.body);
    const inscripcion = await registrarAbono(datos);
    res.status(201).json({ inscripcion });
  }),
);
