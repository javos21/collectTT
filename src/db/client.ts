/**
 * The one connection pool. Used by the web process and the worker process alike
 * (each runs its own instance of this module in its own process).
 *
 * Persistent processes are exactly why the plan rules out serverless: a stable pooled
 * connection, a continuous worker loop, and held-open SSE all want a long-running server.
 */

import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index';

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString === '') {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local, then `docker compose up -d`.',
  );
}

/**
 * SSL is decided by the HOST, not by NODE_ENV.
 *
 * `next start` and `npm run build` both set NODE_ENV=production, so keying off the
 * environment makes a local production build try to negotiate TLS against the docker
 * container — which has none — and every query fails with "server does not support SSL".
 * Render Postgres is remote and wants TLS; a local container never does.
 */
function sslConfig(url: string): { ssl: { rejectUnauthorized: boolean } } | Record<string, never> {
  if (/sslmode=disable/.test(url)) return {};
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  return isLocal ? {} : { ssl: { rejectUnauthorized: false } };
}

export const pool = new Pool({
  connectionString,
  // Small and boring: 50 concurrent users do not need a big pool, and Render Postgres
  // Basic has a modest connection ceiling shared with the worker process.
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ...sslConfig(connectionString),
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

/** A handle inside an open transaction. Service functions take one of these. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either the pool or an open transaction — most services accept both. */
export type DbOrTx = Database | Tx;

/**
 * ★ SERVER-AUTHORITATIVE TIME.
 *
 * Every deadline, claim order and bid resolves on the database clock. Never
 * `new Date()` in application code for anything that a user could dispute.
 */
export async function dbNow(executor: DbOrTx = db): Promise<Date> {
  // Epoch milliseconds rather than a timestamp: raw `execute` returns timestamptz as a
  // driver-formatted STRING ("2026-08-18 03:14:02.7+00"), which is not reliably parsed
  // by `new Date()`. A bigint of millis has exactly one interpretation.
  const result = await executor.execute(
    sql`select (extract(epoch from now()) * 1000)::bigint as ms`,
  );
  const first = result.rows[0] as { ms: string | number } | undefined;
  if (first === undefined) throw new Error('Failed to read database clock');
  return new Date(Number(first.ms));
}

export { schema };
