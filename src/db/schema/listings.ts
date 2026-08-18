/**
 * Categories, listings, images-on-listings, and the two candidate ladders
 * (claims for straight sales, bids for auctions).
 *
 * A listing is ONE indivisible lot. It resolves to at most one completed transaction,
 * though it may take several attempts to get there.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  uuid,
  jsonb,
  char,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { images } from './images';
import {
  listingStatusEnum,
  saleTypeEnum,
  fulfillmentPathEnum,
  sizeClassEnum,
  claimStatusEnum,
  bidStatusEnum,
} from './enums';

/**
 * ★ Seeded from src/domain/categories/definitions.ts.
 * Exists so `listings.category` can carry a real foreign key. Adding a category is an
 * INSERT (via `npm run seed:categories`), never a migration.
 */
export const categories = pgTable('categories', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => profiles.userId),

    // ---- multi-category item model
    category: text('category')
      .notNull()
      .references(() => categories.key),
    /** Category-specific fields. Validated by the Zod schema derived from the config. */
    attributes: jsonb('attributes').notNull().default(sql`'{}'::jsonb`),
    /** Which category schema version validated `attributes`. Old listings stay valid. */
    attributesVersion: integer('attributes_version').notNull(),

    title: text('title').notNull(),
    description: text('description'),
    saleType: saleTypeEnum('sale_type').notNull(),
    status: listingStatusEnum('status').notNull().default('draft'),
    currency: char('currency', { length: 3 }).notNull().default('TTD'),

    // ---- straight sale
    priceCents: bigint('price_cents', { mode: 'number' }),

    // ---- auction
    startBidCents: bigint('start_bid_cents', { mode: 'number' }),
    reserveCents: bigint('reserve_cents', { mode: 'number' }),
    buyoutCents: bigint('buyout_cents', { mode: 'number' }),
    currentBidCents: bigint('current_bid_cents', { mode: 'number' }),
    currentBidId: uuid('current_bid_id'),
    bidCount: integer('bid_count').notNull().default(0),

    /** ★ Server-authoritative close time. Moves outward on anti-snipe extension. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    antisnipeWindowS: integer('antisnipe_window_s').notNull().default(120),
    antisnipeExtendS: integer('antisnipe_extend_s').notNull().default(120),
    extensionCount: integer('extension_count').notNull().default(0),
    maxExtensions: integer('max_extensions'),

    // ---- settlement, declared up front so nobody claims blind
    fulfillmentPaths: fulfillmentPathEnum('fulfillment_paths').array().notNull(),
    settlementMethods: text('settlement_methods').array().notNull(),
    sizeClass: sizeClassEnum('size_class').notNull().default('small'),
    autoRelistOnRenege: boolean('auto_relist_on_renege').notNull().default(true),

    /** The currently open transaction attempt, if any. FK added post-create. */
    activeTransactionId: uuid('active_transaction_id'),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('listings_browse').on(t.status, t.category, t.publishedAt.desc()),
    index('listings_seller').on(t.sellerId, t.status),
    // Containment queries over category-specific attributes, from day one.
    index('listings_attrs').using('gin', t.attributes),
    // ★ The auction closer's scan: narrow and partial.
    index('listings_auction_close')
      .on(t.endsAt)
      .where(sql`${t.status} = 'active' and ${t.saleType} = 'auction'`),

    check(
      'listing_straight_sale_shape',
      sql`${t.saleType} <> 'straight_sale' or (${t.priceCents} is not null and ${t.endsAt} is null)`,
    ),
    check(
      'listing_auction_shape',
      sql`${t.saleType} <> 'auction' or (${t.startBidCents} is not null and ${t.endsAt} is not null)`,
    ),
    check(
      'listing_positive_money',
      sql`coalesce(${t.priceCents}, 1) > 0 and coalesce(${t.startBidCents}, 1) > 0 and coalesce(${t.buyoutCents}, 1) > 0`,
    ),
    // coalesce is load-bearing: array_length of an empty array is NULL, and a NULL
    // CHECK expression PASSES. Without it an empty path list slips straight through.
    check('listing_paths_nonempty', sql`coalesce(array_length(${t.fulfillmentPaths}, 1), 0) >= 1`),
  ],
);

export const listingImages = pgTable(
  'listing_images',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    imageId: uuid('image_id')
      .notNull()
      .references(() => images.id),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.imageId] }),
    uniqueIndex('listing_images_position').on(t.listingId, t.position),
  ],
);

/**
 * Straight-sale backup claim stack. A fixed-price claim is a STACK, not a single
 * winner — when the top claimer's window lapses the next person is promoted
 * automatically and the seller does nothing.
 */
export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    claimantId: text('claimant_id')
      .notNull()
      .references(() => profiles.userId),
    position: integer('position').notNull(),
    status: claimStatusEnum('status').notNull(),
    fulfillmentPath: fulfillmentPathEnum('fulfillment_path').notNull(),
    /**
     * Which relay store this claimant chose, for the `relay` path. Stored on the CLAIM
     * rather than the transaction so a backup claimer's choice survives until they are
     * promoted — they may well pick a different store from the person ahead of them.
     */
    relayStoreId: uuid('relay_store_id'),
    transactionId: uuid('transaction_id'),
    /** ★ DB clock. Server receipt order is what resolves "I said mine first". */
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('claims_one_per_claimant').on(t.listingId, t.claimantId),
    uniqueIndex('claims_position').on(t.listingId, t.position),
    // ★ Exactly one live claimant per listing, enforced by the database rather than
    //   by hoping the application never races with itself.
    uniqueIndex('claims_one_active')
      .on(t.listingId)
      .where(sql`${t.status} = 'active'`),
    index('claims_stack').on(t.listingId, t.position),
    check('claim_stack_depth', sql`${t.position} between 1 and 4`),
  ],
);

export const bids = pgTable(
  'bids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    bidderId: text('bidder_id')
      .notNull()
      .references(() => profiles.userId),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    isBuyout: boolean('is_buyout').notNull().default(false),
    status: bidStatusEnum('status').notNull().default('active'),
    /** True if this bid triggered an anti-snipe extension. Shown in the live feed. */
    extendedAuction: boolean('extended_auction').notNull().default(false),
    /** ★ DB clock. */
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // ★ Makes the bid ladder a TOTAL order — no tie ambiguity when a runner-up has to
    //   be promoted after the winner reneges.
    uniqueIndex('bids_amount_unique').on(t.listingId, t.amountCents),
    index('bids_ladder').on(t.listingId, t.amountCents.desc()),
    index('bids_bidder').on(t.bidderId, t.placedAt.desc()),
    check('bid_positive', sql`${t.amountCents} > 0`),
  ],
);
