/**
 * Sync src/domain/categories/definitions.ts -> the `categories` table.
 *
 * THIS is the "adding a category needs no migration" mechanism. The TS config is the
 * authority; the table exists only so `listings.category` can carry a real foreign key.
 *
 *   1. add a CategoryDefinition object
 *   2. npm run seed:categories
 *
 * Categories removed from the config are DEACTIVATED, never deleted — existing listings
 * still reference them and their attribute history must stay valid.
 */

import '../src/lib/load-env';
import { sql, notInArray } from 'drizzle-orm';

import { db, pool } from '../src/db/client';
import { categories } from '../src/db/schema/listings';
import { CATEGORY_LIST } from '../src/domain/categories/definitions';
import { recommendedIndexes } from '../src/domain/categories/filters';

async function main(): Promise<void> {
  const keys = CATEGORY_LIST.map((c) => c.key);

  for (const def of CATEGORY_LIST) {
    await db
      .insert(categories)
      .values({
        key: def.key,
        label: def.label,
        schemaVersion: def.version,
        sortOrder: def.sortOrder,
        active: true,
      })
      .onConflictDoUpdate({
        target: categories.key,
        set: {
          label: def.label,
          schemaVersion: def.version,
          sortOrder: def.sortOrder,
          active: true,
          updatedAt: sql`now()`,
        },
      });

    const attrs = def.attributes.length;
    const filterable = def.attributes.filter((a) => a.filterable === true).length;
    console.log(
      `[categories] ${def.key.padEnd(14)} v${def.version}  ${attrs} attributes (${filterable} filterable)`,
    );
  }

  // Deactivate anything no longer declared, rather than deleting it.
  if (keys.length > 0) {
    const deactivated = await db
      .update(categories)
      .set({ active: false, updatedAt: sql`now()` })
      .where(notInArray(categories.key, keys))
      .returning({ key: categories.key });

    for (const row of deactivated) {
      console.log(`[categories] ${row.key.padEnd(14)} deactivated (no longer declared)`);
    }
  }

  console.log(`\n[categories] ${CATEGORY_LIST.length} categories synced. No migration required.`);

  const indexes = recommendedIndexes();
  console.log(
    `\n[categories] ${indexes.length} expression indexes are AVAILABLE for filterable attributes.`,
  );
  console.log(
    '[categories] Not created automatically — the GIN index on attributes covers browse',
  );
  console.log('[categories] today, and every extra index costs write throughput. Add them');
  console.log('[categories] deliberately when a filter proves slow:\n');
  for (const stmt of indexes.slice(0, 5)) console.log(`  ${stmt}`);
  if (indexes.length > 5) console.log(`  … and ${indexes.length - 5} more`);

  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('[categories] failed', error);
  await pool.end();
  process.exit(1);
});
