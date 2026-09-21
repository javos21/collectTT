import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';

/** Seller-owned reusable meetup choices. Only the label/area are public. */
export const sellerMeetupLocations = pgTable(
  'seller_meetup_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: text('seller_id').notNull().references(() => profiles.userId, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    area: text('area').notNull(),
    instructions: text('instructions'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('seller_meetup_locations_owner').on(t.sellerId, t.active)],
);

/** Seller-level defaults for reusable listing choices. */
export const sellerMarketplacePreferences = pgTable('seller_marketplace_preferences', {
  sellerId: text('seller_id').primaryKey().references(() => profiles.userId, { onDelete: 'cascade' }),
  defaultDeliveryOptionIds: uuid('default_delivery_option_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  defaultRelayStoreIds: uuid('default_relay_store_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  defaultPaymentMethods: text('default_payment_methods').array().notNull().default(sql`ARRAY[]::text[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
