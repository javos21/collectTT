/**
 * Apply migrations to DATABASE_URL, then the circular foreign keys that cannot be
 * expressed in the Drizzle schema (listings ↔ transactions, custody_holdings ↔
 * transactions, reputation_events → transactions).
 *
 * Render runs this from `prestart` on both the web and worker services, so it must stay
 * non-interactive. For the Supabase staging database use `npm run db:migrate:staging`.
 *
 * Safe to run repeatedly — Drizzle skips applied migrations and every statement in the
 * follow-up SQL is guarded.
 */

import '../src/lib/load-env';

import { runMigrations } from './migrate-core';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local, then `docker compose up -d`.',
    );
  }

  await runMigrations(connectionString, 'DATABASE_URL');
}

main().catch((error: unknown) => {
  console.error('[migrate] failed', error);
  process.exit(1);
});
