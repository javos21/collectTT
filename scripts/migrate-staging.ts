/**
 * Apply migrations to the Supabase staging database.
 *
 * Staging is reached through STAGING_DATABASE_URL, deliberately separate from
 * DATABASE_URL so that a local `npm run db:migrate` can never touch it. Like the other
 * staging scripts, execution needs an explicit confirmation phrase and a target check.
 *
 *   STAGING_DATABASE_URL="postgresql://…@aws-0-….pooler.supabase.com:5432/postgres" \
 *     CONFIRM_STAGING_MIGRATE=migrate-staging \
 *     npm run db:migrate:staging
 *
 * Use the session pooler (port 5432) or the direct connection (db.<ref>.supabase.co).
 * The advisory lock that serializes concurrent runs is session-scoped and does not hold
 * in transaction pooling mode (port 6543).
 */

import '../src/lib/load-env';

import { describeTarget, runMigrations } from './migrate-core';

const CONFIRMATION = 'migrate-staging';
const TRANSACTION_POOLER_PORT = '6543';

function assertStagingTarget(): string {
  const connectionString = process.env.STAGING_DATABASE_URL ?? '';

  if (process.env.CONFIRM_STAGING_MIGRATE !== CONFIRMATION) {
    throw new Error(`Set CONFIRM_STAGING_MIGRATE=${CONFIRMATION} to continue.`);
  }
  if (connectionString === '') {
    throw new Error(
      'STAGING_DATABASE_URL is not set. Add the Supabase connection string to .env.local.',
    );
  }
  if (/localhost|127\.0\.0\.1/.test(connectionString)) {
    throw new Error(
      'STAGING_DATABASE_URL points at a local address. Use npm run db:migrate for local work.',
    );
  }
  if (!connectionString.includes('supabase.com')) {
    throw new Error('STAGING_DATABASE_URL is not a Supabase host.');
  }

  let port: string;
  try {
    port = new URL(connectionString).port;
  } catch {
    throw new Error('STAGING_DATABASE_URL is not a valid connection string.');
  }
  if (port === TRANSACTION_POOLER_PORT) {
    throw new Error(
      'STAGING_DATABASE_URL uses the transaction pooler (port 6543). Use the session pooler ' +
        '(port 5432) or the direct connection instead: the migration advisory lock is ' +
        'session-scoped and would not hold in transaction mode.',
    );
  }

  return connectionString;
}

async function main(): Promise<void> {
  const connectionString = assertStagingTarget();
  console.log(`[migrate] staging target ${describeTarget(connectionString)}`);
  await runMigrations(connectionString, 'STAGING_DATABASE_URL');
}

main().catch((error: unknown) => {
  console.error('[migrate] failed', error);
  process.exit(1);
});
