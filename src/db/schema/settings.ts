import { integer, text, timestamp, pgTable } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';

/** Small, typed platform settings used by admin-configured product defaults. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  integerValue: integer('integer_value').notNull(),
  updatedBy: text('updated_by').references(() => profiles.userId, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
