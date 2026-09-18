import { timestamp, integer, index, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Fixed-window counters shared by the web process and worker process.
 *
 * Rows are keyed by a logical scope plus an actor/IP identity and updated with one
 * atomic upsert. Expired rows are reused by the next request and periodically pruned
 * by the rate-limit helper.
 */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').primaryKey(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }).notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('rate_limit_buckets_expiry').on(table.windowExpiresAt)],
);
