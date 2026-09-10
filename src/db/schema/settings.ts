import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { fulfillmentPathEnum } from './enums';

/** Small, typed platform settings used by admin-configured product defaults. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  integerValue: integer('integer_value').notNull(),
  updatedBy: text('updated_by').references(() => profiles.userId, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Delivery and payment choices managed by platform administrators.
 *
 * `fulfillmentPath` is an internal compatibility mapping for the transaction and
 * custody engine. It is deliberately not exposed in the admin UI. New delivery
 * options only need to say whether they require a pickup store; the service maps that
 * to the existing direct/store behavior behind the scenes.
 */
export const marketplaceOptions = pgTable(
  'marketplace_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    requiresStore: boolean('requires_store').notNull().default(false),
    fulfillmentPath: fulfillmentPathEnum('fulfillment_path'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    updatedBy: text('updated_by').references(() => profiles.userId, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('marketplace_options_kind_key').on(t.kind, t.key),
    check('marketplace_options_kind_valid', sql`${t.kind} in ('delivery', 'payment')`),
    check(
      'marketplace_options_shape',
      sql`(${t.kind} = 'delivery' and ${t.fulfillmentPath} is not null)
          or (${t.kind} = 'payment' and ${t.fulfillmentPath} is null and ${t.requiresStore} = false)`,
    ),
  ],
);
