/**
 * Apply migrations, then the circular foreign keys that cannot be expressed in the
 * Drizzle schema (listings ↔ transactions, custody_holdings ↔ transactions,
 * reputation_events → transactions, ratings → transactions).
 *
 * Safe to run repeatedly — every statement in the follow-up SQL is guarded.
 */

import '../src/lib/load-env';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';

import { db, pool } from '../src/db/client';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function main(): Promise<void> {
  console.log('[migrate] applying drizzle migrations…');
  await migrate(db, { migrationsFolder: join(root, 'drizzle') });

  const followUp = join(root, 'drizzle', 'post', 'circular-fks.sql');
  if (existsSync(followUp)) {
    console.log('[migrate] applying circular foreign keys…');
    const statements = readFileSync(followUp, 'utf8');
    await db.execute(sql.raw(statements));
  }

  console.log('[migrate] done');
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('[migrate] failed', error);
  await pool.end();
  process.exit(1);
});
