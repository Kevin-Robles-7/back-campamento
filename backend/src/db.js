import pg from 'pg';
import { config } from './config.js';

/**
 * Conexión a PostgreSQL (Supabase).
 *
 * Dos detalles propios de `pg` que se ajustan aquí:
 *  - `NUMERIC` llega como string para no perder precisión; se convierte a
 *    número porque los montos del campamento son enteros en pesos.
 *  - `DATE` llega como objeto Date en la zona del servidor; se deja como
 *    string `AAAA-MM-DD` para que no se corra un día al serializar.
 */

const { types } = pg;

// NUMERIC / DECIMAL -> number
types.setTypeParser(types.builtins.NUMERIC, (valor) => (valor === null ? null : Number(valor)));
// BIGINT -> number (los ids de este proyecto nunca se acercan al límite seguro)
types.setTypeParser(types.builtins.INT8, (valor) => (valor === null ? null : Number(valor)));
// DATE -> 'AAAA-MM-DD'
types.setTypeParser(types.builtins.DATE, (valor) => valor);

/**
 * Quita los parámetros que Supabase incluye para Prisma (`pgbouncer=true`,
 * `connection_limit`) y que `pg` intentaría enviar al servidor como opciones,
 * provocando un error de conexión.
 */
export function limpiarUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    for (const clave of ['pgbouncer', 'connection_limit', 'pool_timeout', 'schema']) {
      parsed.searchParams.delete(clave);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Opciones de conexión, a partir de una URL o de los valores sueltos. */
export function opcionesConexion(url = config.db.url) {
  const limpia = limpiarUrl(url);
  return limpia
    ? { connectionString: limpia, ssl: { rejectUnauthorized: false } }
    : {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password || undefined,
        database: config.db.database,
        ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
      };
}

export const pool = new pg.Pool({
  ...opcionesConexion(),
  max: config.db.maxConexiones,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (error) => {
  console.error('[db] error en una conexión inactiva:', error.message);
});

/**
 * Ejecuta una consulta parametrizada y devuelve las filas.
 * Los parámetros usan la notación de Postgres: $1, $2, $3…
 */
export async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** Devuelve la primera fila o null. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * Ejecuta un INSERT y devuelve el id generado.
 * La consulta debe terminar en `RETURNING id`.
 */
export async function insert(sql, params = []) {
  const fila = await queryOne(sql, params);
  return fila?.id ?? null;
}

/**
 * Envuelve una serie de operaciones en una transacción.
 * El handler recibe un objeto con los mismos helpers, ligados a la conexión.
 */
export async function withTransaction(handler) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const cx = {
      query: async (sql, params = []) => (await cliente.query(sql, params)).rows,
      queryOne: async (sql, params = []) => {
        const { rows } = await cliente.query(sql, params);
        return rows.length ? rows[0] : null;
      },
      insert: async (sql, params = []) => {
        const { rows } = await cliente.query(sql, params);
        return rows[0]?.id ?? null;
      },
    };

    const resultado = await handler(cx);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}
