import 'dotenv/config';

const num = (valor, porDefecto) => {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : porDefecto;
};

const bool = (valor, porDefecto = false) => {
  if (valor === undefined || valor === '') return porDefecto;
  return ['1', 'true', 'yes', 'si'].includes(String(valor).toLowerCase());
};

export const config = {
  port: num(process.env.PORT, 3000),

  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:4200')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean),

  // ---- PostgreSQL (Supabase) ----
  db: {
    // Pooler en modo transacción (puerto 6543). Es el que usa la aplicación:
    // aguanta que Render abra y cierre conexiones constantemente.
    url: process.env.DATABASE_URL ?? '',
    // Pooler en modo sesión (puerto 5432). Solo para migraciones: el modo
    // transacción no admite varias sentencias en una sola consulta.
    urlMigracion: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: num(process.env.DB_PORT, 5432),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'postgres',
    ssl: bool(process.env.DB_SSL, !!process.env.DATABASE_URL),
    maxConexiones: num(process.env.DB_POOL_MAX, 5),
  },

  // ---- Almacenamiento de archivos ----
  almacenamiento: {
    // 'local' en desarrollo, 's3' en produccion (Supabase Storage o R2)
    driver: process.env.STORAGE_DRIVER ?? 'local',
    carpetaLocal: process.env.UPLOAD_DIR ?? 'uploads',
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    // Supabase y R2 requieren el estilo de ruta, no el de subdominio.
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    // Minutos de vigencia de los enlaces temporales a los comprobantes.
    minutosEnlace: num(process.env.S3_URL_MINUTOS, 15),
  },

  maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 8) * 1024 * 1024,

  // ---- Extraccion de datos del comprobante ----
  ocr: {
    provider: process.env.OCR_PROVIDER ?? 'auto',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    // Google retira modelos con cierta frecuencia: si la API responde 404
    // diciendo que el modelo ya no existe, basta cambiar esta variable.
    geminiModelo: process.env.GEMINI_MODELO ?? 'gemini-3.8-flash',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  },

  minutosBorrador: num(process.env.MINUTOS_BORRADOR, 45),
};
