/**
 * Relay stores and physical custody.
 *
 * ★ KEY MODELLING DECISION: custody follows the ITEM, payment follows the TRANSACTION.
 *   A `custody_holdings` row belongs to a LISTING. That is what makes backup promotion
 *   work when the item is already on the shelf — the buyer changes, the item does not
 *   move, and the holding simply re-links to the new transaction attempt.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { listings } from './listings';
import { sizeClassEnum, custodyStateEnum, custodyHolderEnum, storeStaffRoleEnum } from './enums';

export const relayStores = pgTable('relay_stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  area: text('area').notNull(),
  address: text('address'),
  phoneE164: text('phone_e164'),
  /** The size gate. "If it's not in the log, it doesn't belong there." */
  acceptsSizeClasses: sizeClassEnum('accepts_size_classes').array().notNull(),
  paidCustodyDays: integer('paid_custody_days').notNull().default(7),
  /** Tighter — an unpaid item is pure liability for the store. */
  unpaidCustodyDays: integer('unpaid_custody_days').notNull().default(3),
  /** Seam for the optional, per-store, footfall-amplifying fee models. Unused for now. */
  holdingFeeConfig: jsonb('holding_fee_config').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const relayStoreStaff = pgTable(
  'relay_store_staff',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => relayStores.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    role: storeStaffRoleEnum('role').notNull().default('staff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.userId] })],
);

export const custodyHoldings = pgTable(
  'custody_holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** ★ The ITEM, not the transaction. */
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    /** ★ Re-links on promotion. FK added post-create (transactions references us too). */
    currentTransactionId: uuid('current_transaction_id'),

    holder: custodyHolderEnum('holder').notNull(),
    storeId: uuid('store_id').references(() => relayStores.id),
    state: custodyStateEnum('state').notNull().default('awaiting_dropoff'),
    sizeClass: sizeClassEnum('size_class').notNull(),

    droppedOffAt: timestamp('dropped_off_at', { withTimezone: true }),
    receivedByUserId: text('received_by_user_id').references(() => profiles.userId),
    releaseAuthorizedAt: timestamp('release_authorized_at', { withTimezone: true }),
    releasedByUserId: text('released_by_user_id').references(() => profiles.userId),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),

    /** Shelf clock. Recomputed whenever payment state changes — paying EXTENDS it. */
    custodyExpiresAt: timestamp('custody_expires_at', { withTimezone: true }),
    overstayFlaggedAt: timestamp('overstay_flagged_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // ★ One live holding per item. An item cannot be on two shelves.
    uniqueIndex('custody_one_live_per_listing')
      .on(t.listingId)
      .where(sql`${t.state} not in ('picked_up', 'returned_to_seller', 'voided')`),
    // The store's board view.
    index('custody_store_board').on(t.storeId, t.state),
    // The overstay sweeper's scan.
    index('custody_clock')
      .on(t.custodyExpiresAt)
      .where(sql`${t.state} in ('at_relay', 'release_authorized')`),

    check(
      'custody_store_required',
      sql`${t.holder} <> 'relay_store' or ${t.storeId} is not null`,
    ),
    check(
      'custody_courier_has_no_store',
      sql`${t.holder} <> 'platform_courier' or ${t.storeId} is null`,
    ),
  ],
);
