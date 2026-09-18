/**
 * Apply migrations, then the circular foreign keys that cannot be expressed in the
 * Drizzle schema (listings ↔ transactions, custody_holdings ↔ transactions,
 * reputation_events → transactions).
 *
 * Safe to run repeatedly — every statement in the follow-up SQL is guarded.
 */

import '../src/lib/load-env';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

import { pool } from '../src/db/client';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MIGRATION_LOCK_KEY = 7_391_204;

function safeDatabaseTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (raw === undefined || raw === '') return '<missing DATABASE_URL>';
  try {
    const url = new URL(raw);
    const port = url.port === '' ? (url.protocol === 'postgres:' ? '5432' : '5432') : url.port;
    return `${url.hostname}:${port}${url.pathname}`;
  } catch {
    return '<invalid DATABASE_URL>';
  }
}

async function main(): Promise<void> {
  // Render starts the web and worker services independently. Both run this script,
  // so serialize migrations with a session-level advisory lock on one checked-out
  // connection. The same client is used for migrate + follow-up SQL, then released.
  const client = await pool.connect();
  try {
    console.log(`[migrate] target ${safeDatabaseTarget()}`);
    console.log('[migrate] waiting for the migration lock…');
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    const migrationDb = drizzle(client);
    console.log('[migrate] applying drizzle migrations…');
    await migrate(migrationDb, { migrationsFolder: join(root, 'drizzle') });

    const followUp = join(root, 'drizzle', 'post', 'circular-fks.sql');
    if (existsSync(followUp)) {
      console.log('[migrate] applying circular foreign keys…');
      const statements = readFileSync(followUp, 'utf8');
      await migrationDb.execute(sql.raw(statements));
    }

    console.log('[migrate] done');
  } finally {
    try {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('[migrate] failed', error);
  await pool.end();
  process.exit(1);
});
