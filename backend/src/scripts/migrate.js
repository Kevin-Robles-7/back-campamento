/**
 * Crea o actualiza las tablas en PostgreSQL (Supabase).
 * Uso: npm run db:migrate
 *
 * Usa DIRECT_URL (pooler en modo sesión, puerto 5432) porque el esquema son
 * varias sentencias en una sola consulta, y el modo transacción del puerto
 * 6543 no lo permite.
 *
 * El script es idempotente: se puede correr todas las veces que quieras y
 * NO borra datos.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { opcionesConexion } from '../db.js';

const rutaSchema = path.resolve(process.cwd(), '..', 'database', 'schema.sql');
const url = config.db.urlMigracion;

if (url && url.includes(':6543')) {
  console.warn(
    'Aviso: estás migrando por el puerto 6543 (modo transacción).\n' +
      'Si falla, define DIRECT_URL con el puerto 5432 en tu .env.',
  );
}

const destino = url ? new URL(url).host : `${config.db.host}:${config.db.port}`;
console.log(`Aplicando esquema en ${destino}…`);

const cliente = new pg.Client(opcionesConexion(url));
await cliente.connect();

try {
  await cliente.query(await fs.readFile(rutaSchema, 'utf8'));

  const { rows: tablas } = await cliente.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const { rows: parametros } = await cliente.query(
    'SELECT COUNT(*)::int AS n FROM configuracion',
  );

  console.log(`\nEsquema aplicado. ${tablas.length} tablas:`);
  tablas.forEach((t) => console.log(`  · ${t.table_name}`));
  console.log(`\nParámetros de configuración: ${parametros[0].n}`);
} finally {
  await cliente.end();
}
