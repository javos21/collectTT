/**
 * Explicit, expiring offers made to the next bidder after an auction winner
 * fails to complete.  This is deliberately separate from the legacy fixed-price
 * `offers` table: a fallback offer is created by the auction state machine and
 * can only be accepted by the nominated runner-up.
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
import { listings, bids } from './listings';
import { marketplaceOptions } from './settings';
import { fulfillmentPathEnum, fallbackOfferStatusEnum } from './enums';

export const auctionFallbackOffers = pgTable(
  'auction_fallback_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    bidId: uuid('bid_id').notNull().references(() => bids.id, { onDelete: 'restrict' }),
    sellerId: text('seller_id').notNull().references(() => profiles.userId),
    buyerId: text('buyer_id').notNull().references(() => profiles.userId),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    fulfillmentPath: fulfillmentPathEnum('fulfillment_path').notNull(),
    deliveryOptionId: uuid('delivery_option_id').references(() => marketplaceOptions.id, { onDelete: 'set null' }),
    settlementMethod: text('settlement_method'),
    relayStoreId: uuid('relay_store_id'),
    status: fallbackOfferStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    /** Plain uuid avoids a circular FK; the transaction retains the winning bid too. */
    transactionId: uuid('transaction_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auction_fallback_one_pending_listing')
      .on(t.listingId)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('auction_fallback_one_bid').on(t.bidId),
    index('auction_fallback_buyer').on(t.buyerId, t.status, t.expiresAt),
    index('auction_fallback_expiry').on(t.expiresAt).where(sql`${t.status} = 'pending'`),
    check('auction_fallback_positive_amount', sql`${t.amountCents} > 0`),
    check('auction_fallback_distinct_parties', sql`${t.sellerId} <> ${t.buyerId}`),
  ],
);
