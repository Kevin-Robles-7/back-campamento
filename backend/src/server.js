import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { router } from './routes/api.routes.js';

import { cerrarOcr } from './services/comprobante-ocr.service.js';
import { programarLimpieza } from './services/limpieza.service.js';
import * as almacenamiento from './services/almacenamiento.service.js';

const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin: config.corsOrigin.length ? config.corsOrigin : true,
    methods: ['GET', 'POST'],
  }),
);
app.use(express.json({ limit: '1mb' }));
// En desarrollo los archivos se sirven del disco; en producción van al
// almacenamiento externo con enlaces temporales firmados.
if (!almacenamiento.usaS3()) {
  app.use('/uploads', express.static(almacenamiento.rutaLocal(), { maxAge: '1h' }));
}

app.get('/health', async (_req, res) => {
  const estado = almacenamiento.validarConfiguracion();
  try {
    await pool.query('SELECT 1');
    res.json({ ok: estado.ok, db: 'up', almacenamiento: estado });
  } catch (error) {
    res.status(503).json({ ok: false, db: 'down', error: error.message, almacenamiento: estado });
  }
});

app.use('/api', router);

app.use((_req, res) => {
  res.status(404).json({ error: 'Recurso no encontrado.' });
});

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  const estado = error.estado ?? 500;
  if (estado >= 500) console.error('[api]', error);
  res.status(estado).json({
    error: estado >= 500 ? 'Ocurrio un error inesperado. Intenta de nuevo.' : error.message,
    detalles: error.detalles ?? undefined,
  });
});

const servidor = app.listen(config.port, () => {
  console.log(`API del campamento escuchando en http://localhost:${config.port}`);
  console.log(`Extracción de comprobantes: ${config.ocr.provider}`);

  const estado = almacenamiento.validarConfiguracion();
  if (!estado.ok) console.warn(`[almacenamiento] ${estado.mensaje}`);
  else console.log(`Almacenamiento: ${estado.driver}${estado.bucket ? ` (${estado.bucket})` : ''}`);
});

// Borra periódicamente los comprobantes y documentos que nadie confirmó.
const detenerLimpieza = programarLimpieza();

// Cierre ordenado: libera el worker de OCR y las conexiones de MySQL.
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    servidor.close(async () => {
      detenerLimpieza();
      await cerrarOcr();
      await pool.end();
      process.exit(0);
    });
  });
}
