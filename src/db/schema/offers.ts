/**
 * Negotiated offers on fixed-price listings.
 *
 * A pending offer is not a transaction and does not reserve the item. The seller's
 * acceptance is the atomic moment that claims the listing and opens the normal deal
 * lifecycle at the offered amount.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { listings } from './listings';
import { relayStores } from './custody';
import { fulfillmentPathEnum, offerStatusEnum } from './enums';

export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => profiles.userId),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    fulfillmentPath: fulfillmentPathEnum('fulfillment_path').notNull(),
    relayStoreId: uuid('relay_store_id').references(() => relayStores.id),
    status: offerStatusEnum('status').notNull().default('pending'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('offers_listing_status').on(t.listingId, t.status, t.createdAt.desc()),
    index('offers_buyer').on(t.buyerId, t.createdAt.desc()),
    uniqueIndex('offers_one_pending_per_buyer')
      .on(t.listingId, t.buyerId)
      .where(sql`${t.status} = 'pending'`),
    check('offer_positive_amount', sql`${t.amountCents} > 0`),
    check(
      'offer_relay_store_required',
      sql`${t.fulfillmentPath} <> 'relay' or ${t.relayStoreId} is not null`,
    ),
  ],
);
