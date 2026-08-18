/**
 * THE two-track core.
 *
 * Three state columns, not one:
 *   payment_state   the money track
 *   custody_state   the item track (mirrored from custody_holdings)
 *   state           the rollup
 *
 * with `state = 'completed'` gated by a CHECK on both tracks being settled. The tracks
 * advance independently and in any interleaving; the rollup is the only coupling.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  uuid,
  jsonb,
  char,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { listings, claims, bids } from './listings';
import { relayStores, custodyHoldings } from './custody';
import {
  transactionStateEnum,
  paymentStateEnum,
  custodyStateEnum,
  fulfillmentPathEnum,
  transactionSourceEnum,
  terminationReasonEnum,
  actorRoleEnum,
  eventTrackEnum,
} from './enums';

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    sellerId: text('seller_id')
      .notNull()
      .references(() => profiles.userId),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => profiles.userId),

    /** Attempt 1 is the first candidate; a renege opens attempt 2 for the next one. */
    attemptNumber: integer('attempt_number').notNull().default(1),
    source: transactionSourceEnum('source').notNull(),
    claimId: uuid('claim_id').references(() => claims.id),
    winningBidId: uuid('winning_bid_id').references(() => bids.id),

    /** Locked at creation — a promoted runner-up owes their OWN bid, not the winner's. */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('TTD'),
    fulfillmentPath: fulfillmentPathEnum('fulfillment_path').notNull(),

    // ---- ★ the three state columns
    state: transactionStateEnum('state').notNull().default('open'),
    paymentState: paymentStateEnum('payment_state').notNull().default('pending'),
    /**
     * Mirrored from the linked custody_holdings row, written only by
     * src/services/custody.ts inside the same DB transaction. Duplicated deliberately
     * so `tx_completion_requires_both` can be a real database constraint; the nightly
     * `consistency:check` task asserts zero drift.
     */
    custodyState: custodyStateEnum('custody_state').notNull().default('not_applicable'),

    // ---- clocks, all set from the DB clock
    paymentDeadlineAt: timestamp('payment_deadline_at', { withTimezone: true }).notNull(),
    sellerDropoffDeadlineAt: timestamp('seller_dropoff_deadline_at', { withTimezone: true }),
    ratingWindowEndsAt: timestamp('rating_window_ends_at', { withTimezone: true }),

    markedPaidAt: timestamp('marked_paid_at', { withTimezone: true }),
    paymentConfirmedAt: timestamp('payment_confirmed_at', { withTimezone: true }),
    paymentDisputedAt: timestamp('payment_disputed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    terminatedReason: terminationReasonEnum('terminated_reason'),

    relayStoreId: uuid('relay_store_id').references(() => relayStores.id),
    custodyHoldingId: uuid('custody_holding_id').references(() => custodyHoldings.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // ★ At most ONE open transaction per listing. The database, not a code path.
    uniqueIndex('tx_one_open_per_listing')
      .on(t.listingId)
      .where(sql`${t.state} = 'open'`),
    uniqueIndex('tx_listing_attempt').on(t.listingId, t.attemptNumber),
    index('tx_buyer').on(t.buyerId, t.state),
    index('tx_seller').on(t.sellerId, t.state),
    index('tx_deadlines')
      .on(t.paymentDeadlineAt)
      .where(sql`${t.state} = 'open'`),
    index('tx_dropoff_deadlines')
      .on(t.sellerDropoffDeadlineAt)
      .where(sql`${t.state} = 'open'`),

    check('tx_distinct_parties', sql`${t.buyerId} <> ${t.sellerId}`),
    check('tx_positive_amount', sql`${t.amountCents} > 0`),

    // ★ P2P paths never touch the custody track.
    check(
      'tx_p2p_no_custody',
      sql`${t.fulfillmentPath} not in ('cash_meetup', 'remote_ship')
          or (${t.custodyState} = 'not_applicable' and ${t.relayStoreId} is null)`,
    ),

    // ★ Custody paths always do, and always carry a seller deadline.
    check(
      'tx_custody_required',
      sql`${t.fulfillmentPath} not in ('relay', 'full_service')
          or (${t.custodyState} <> 'not_applicable' and ${t.sellerDropoffDeadlineAt} is not null)`,
    ),

    // ★★ The seller's clock expires BEFORE the buyer's, so a seller who never drops off
    //    is caught while the buyer's payment window is still open and the buyer can be
    //    told to stop. This is what keeps "payment window starts at claim" safe on the
    //    relay path.
    check(
      'tx_dropoff_before_payment',
      sql`${t.sellerDropoffDeadlineAt} is null
          or ${t.sellerDropoffDeadlineAt} < ${t.paymentDeadlineAt}`,
    ),

    // ★★ THE completion invariant: both tracks finished, or it is not complete.
    check(
      'tx_completion_requires_both',
      sql`${t.state} <> 'completed'
          or (${t.paymentState} = 'confirmed'
              and ${t.custodyState} in ('not_applicable', 'picked_up'))`,
    ),
  ],
);

/**
 * Append-only audit of EVERY transition on either track.
 * Doubles as the store-side activity log and as dispute forensics.
 */
export const transactionEvents = pgTable(
  'transaction_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    track: eventTrackEnum('track').notNull(),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    actorUserId: text('actor_user_id').references(() => profiles.userId),
    actorRole: actorRoleEnum('actor_role').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tx_events_by_tx').on(t.transactionId, t.occurredAt)],
);
