/**
 * Borra TODOS los datos y vuelve a crear el esquema. Solo para desarrollo.
 * Uso: npm run db:reset          (pide confirmación si la base es remota)
 *      npm run db:reset -- --si  (sin confirmación)
 *
 * Se limita al esquema `public`: no toca los esquemas internos de Supabase
 * (auth, storage), así que es seguro contra un proyecto de pruebas.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import pg from 'pg';
import { config } from '../config.js';
import { opcionesConexion } from '../db.js';

const rutaSchema = path.resolve(process.cwd(), '..', 'database', 'schema.sql');
const url = config.db.urlMigracion;
const remoto = !!url && !/localhost|127\.0\.0\.1/.test(url);
const destino = url ? new URL(url).host : `${config.db.host}:${config.db.port}`;

if (remoto && !process.argv.includes('--si')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = await rl.question(
    `\nVas a BORRAR todos los datos en ${destino}.\nEscribe "borrar" para continuar: `,
  );
  rl.close();
  if (respuesta.trim().toLowerCase() !== 'borrar') {
    console.log('Cancelado.');
    process.exit(0);
  }
}

const cliente = new pg.Client(opcionesConexion(url));
await cliente.connect();

try {
  console.log(`Borrando el esquema public en ${destino}…`);
  await cliente.query('DROP SCHEMA public CASCADE');
  await cliente.query('CREATE SCHEMA public');

  // Permisos que Supabase espera en el esquema public.
  // Se usa CURRENT_USER porque el usuario del pooler ('postgres.<ref>')
  // lleva un punto y habría que citarlo como identificador.
  await cliente.query('GRANT USAGE ON SCHEMA public TO public');
  await cliente.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  await cliente.query('GRANT ALL ON SCHEMA public TO anon, authenticated, service_role');

  await cliente.query(await fs.readFile(rutaSchema, 'utf8'));
  console.log('Esquema recreado desde schema.sql');
} finally {
  await cliente.end();
}
