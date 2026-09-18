/**
 * Shared migration runner for the two migration entry points:
 *
 *   scripts/migrate.ts          — DATABASE_URL. Run by Render's `prestart` on both the
 *                                 web and worker services.
 *   scripts/migrate-staging.ts  — STAGING_DATABASE_URL. Run by hand against Supabase.
 *
 * Both apply the Drizzle journal and then the circular foreign keys that cannot be
 * expressed in the schema, and both take the same session-level advisory lock so a web
 * and worker deploy cannot race each other. Safe to run repeatedly: Drizzle skips
 * already-applied migrations and every statement in the follow-up SQL is guarded.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { sslConfig } from '../src/db/ssl';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MIGRATIONS_FOLDER = join(root, 'drizzle');
const JOURNAL = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
const FOLLOW_UP = join(MIGRATIONS_FOLDER, 'post', 'circular-fks.sql');

/**
 * Serializes the web and worker services when both start at once, and any manual run
 * against the same database. Session-scoped, so it needs a session-mode connection.
 */
const MIGRATION_LOCK_KEY = 7_391_204;

/** Host, port and database for an operator-facing log line. Never includes credentials. */
export function describeTarget(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '<not set>';
  try {
    const url = new URL(raw);
    const port = url.port === '' ? '5432' : url.port;
    return `${url.hostname}:${port}${url.pathname}`;
  } catch {
    return '<invalid connection string>';
  }
}

interface MigrationExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

/**
 * Report how many journaled migrations are already recorded, so an operator knows
 * whether a run is a no-op before it touches anything. Read after the lock is held.
 */
async function reportPending(executor: MigrationExecutor, label: string): Promise<void> {
  const journal = JSON.parse(readFileSync(JOURNAL, 'utf8')) as { entries?: unknown[] };
  const journaled = journal.entries?.length ?? 0;

  let applied = 0;
  try {
    const result = await executor.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    const row = result.rows[0] as { n: number } | undefined;
    applied = Number(row?.n ?? 0);
  } catch {
    // A database that has never been migrated has no tracking table yet.
    applied = 0;
  }

  const pending = Math.max(0, journaled - applied);
  console.log(
    `[migrate] ${label}: ${applied} of ${journaled} migrations applied, ${pending} pending`,
  );
}

export async function runMigrations(connectionString: string, label: string): Promise<void> {
  // One connection is all a migration needs, and it keeps a manual run negligible.
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...sslConfig(connectionString),
  });

  const client = await pool.connect();
  try {
    console.log(`[migrate] target ${describeTarget(connectionString)}`);
    console.log('[migrate] waiting for the migration lock…');
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    const migrationDb = drizzle(client);
    await reportPending(migrationDb, label);

    console.log('[migrate] applying drizzle migrations…');
    await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });

    if (existsSync(FOLLOW_UP)) {
      console.log('[migrate] applying circular foreign keys…');
      await migrationDb.execute(sql.raw(readFileSync(FOLLOW_UP, 'utf8')));
    }

    console.log('[migrate] done');
  } finally {
    try {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}
