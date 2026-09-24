/**
 * Deadline handlers: payment/meetup completion window, seller drop-off window,
 * fallback-offer expiry, and candidate advancement.
 *
 * ★ Every one is IDEMPOTENT — the first thing each does is a conditional read or write
 *   that no-ops when the state has already moved. Graphile Worker guarantees
 *   at-least-once delivery, not exactly-once, so this is load-bearing rather than
 *   defensive.
 */

import { and, eq, lte, ne, sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db } from '../../db/client';
import { transactions, transactionEvents } from '../../db/schema/transactions';
import {
  terminateTransaction,
  promoteNextCandidate,
  completeIfBothTracksDone,
  expireAuctionFallbackOffer,
} from '../../services/transactions';
import { recomputeRollingWindows, evaluateRestrictions } from '../../services/reputation';
import { profiles } from '../../db/schema/profiles';

// ------------------------------------------------ payment / meetup completion window

interface TxPayload {
  transactionId: string;
}

/**
 * The transaction's completion window lapsed. Terminate, record the fact, and advance
 * an auction to its next explicit fallback offer. Cash meetups use this same internal
 * clock as a meetup-completion window, not as a prepayment deadline.
 */
export async function paymentWindowExpired(payload: TxPayload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(transactions)
      .where(and(
        eq(transactions.id, payload.transactionId),
        eq(transactions.state, 'open'),
        lte(transactions.paymentDeadlineAt, sql`now()`),
      ))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      helpers.logger.info(`transaction ${payload.transactionId} is not open — window moot`);
      return;
    }

    // A confirmed payment that has not completed yet (custody still open, Phase 2) must
    // NOT be reneged — the buyer did their part.
    if (row.paymentState === 'confirmed') {
      helpers.logger.info(`transaction ${payload.transactionId} is paid — window moot`);
      return;
    }

    const reason = row.fulfillmentPath === 'cash_meetup' ? 'buyer_no_show' : 'non_payment';

    const terminated = await terminateTransaction({
      tx,
      transactionId: payload.transactionId,
      reason,
      actorRole: 'system',
      dueAt: row.fulfillmentPath === 'cash_meetup' ? 'meetup' : 'payment',
    });

    helpers.logger.info(
      terminated
        ? `transaction ${payload.transactionId} reneged (${reason})`
        : `transaction ${payload.transactionId} already terminated`,
    );
  });
}

/**
 * The seller's drop-off window lapsed on a custody path. This is the Phase 1 half of
 * symmetric accountability: a seller who strands a buyer takes the hit, and the buyer
 * is told to stop paying while their own window is still open.
 */
export async function dropoffWindowExpired(payload: TxPayload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(transactions)
      .where(and(
        eq(transactions.id, payload.transactionId),
        eq(transactions.state, 'open'),
        lte(transactions.sellerDropoffDeadlineAt, sql`now()`),
      ))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return;

    // The item made it into custody — nothing to answer for.
    if (row.custodyState !== 'awaiting_dropoff') {
      helpers.logger.info(`transaction ${payload.transactionId} custody is ${row.custodyState} — moot`);
      return;
    }

    // The seller's drop-off obligation begins only after payment is authoritative.
    // A pending or buyer-marked payment must be resolved by the buyer payment window;
    // expiring the seller clock here would blame the seller for an item they were not
    // yet required to hand over.
    if (row.paymentState !== 'confirmed') {
      helpers.logger.info(
        `transaction ${payload.transactionId} payment is ${row.paymentState} — seller drop-off not due yet`,
      );
      return;
    }

    await terminateTransaction({
      tx,
      transactionId: payload.transactionId,
      reason: 'seller_no_dropoff',
      actorRole: 'system',
      dueAt: 'seller_dropoff',
      // The seller failed, not the buyer — do not promote an auction runner-up when
      // there is no item on the shelf.
      promoteNext: false,
    });

    helpers.logger.info(`transaction ${payload.transactionId} reneged (seller_no_dropoff)`);
  });
}

/**
 * Compatibility no-op for reminder jobs already queued before the mechanic was
 * removed. New transactions never enqueue this task; retaining the handler prevents
 * old jobs from retrying or failing as unknown tasks during deployment.
 */
export async function paymentReminder(payload: TxPayload & { reminderKind?: 'halfway' | 'two_hours' | 'deadline' }, helpers: Helpers): Promise<void> {
  helpers.logger.info(`payment reminder task retired for ${payload.transactionId}`);
}

/** Auto-complete a cash meetup after the receipt window if no problem was reported. */
export async function receiptWindowExpired(payload: TxPayload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(transactions).where(and(
      eq(transactions.id, payload.transactionId),
      eq(transactions.state, 'open'),
      ne(transactions.disputeState, 'open'),
      eq(transactions.fulfillmentPath, 'cash_meetup'),
      eq(transactions.paymentState, 'confirmed'),
      eq(transactions.handoffState, 'seller_handed_over'),
      lte(transactions.receiptDeadlineAt, sql`now()`),
    )).limit(1);
    const row = rows[0];
    if (row === undefined) return;
    // A member-reported problem moves the rollup to disputed, so this conditional
    // update cannot auto-complete while support is reviewing the deal.
    const updated = await tx.update(transactions).set({
      handoffState: 'buyer_received',
      receivedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(and(
      eq(transactions.id, payload.transactionId),
      eq(transactions.state, 'open'),
      ne(transactions.disputeState, 'open'),
      eq(transactions.paymentState, 'confirmed'),
      eq(transactions.fulfillmentPath, 'cash_meetup'),
      eq(transactions.handoffState, 'seller_handed_over'),
      lte(transactions.receiptDeadlineAt, sql`now()`),
    )).returning({ id: transactions.id });
    if (updated.length === 0) return;
    await tx.insert(transactionEvents).values({
      transactionId: row.id,
      track: 'overall',
      fromState: 'seller_handed_over',
      toState: 'buyer_received',
      actorRole: 'system',
      reason: 'receipt confirmation window elapsed without a reported problem',
      metadata: {},
    });
    await completeIfBothTracksDone(tx, row.id);
    helpers.logger.info(`transaction ${row.id} auto-completed after receipt window`);
  });
}

// ---------------------------------------------------------------- auction fallback

export async function fallbackOfferExpired(payload: { offerId: string }, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await expireAuctionFallbackOffer(tx, payload.offerId);
    helpers.logger.info(
      result.expired
        ? `auction fallback offer ${payload.offerId} expired${result.nextOfferId === undefined ? '' : `; next offer ${result.nextOfferId}`}`
        : `auction fallback offer ${payload.offerId} is already closed`,
    );
  });
}

// ---------------------------------------------------------------- promotion

interface PromotePayload {
  listingId: string;
  failedTransactionId: string;
}

export async function promoteNext(payload: PromotePayload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await promoteNextCandidate(tx, payload.listingId, payload.failedTransactionId);
    helpers.logger.info(
      result.promoted
        ? `listing ${payload.listingId} promoted to transaction ${result.transactionId}`
        : result.fallbackOfferId === undefined
          ? `listing ${payload.listingId} had no remaining candidates`
          : `listing ${payload.listingId} sent fallback offer ${result.fallbackOfferId}`,
    );
  });
}

// ---------------------------------------------------------------- nightly

/**
 * Rolling 90-day reputation windows cannot be maintained incrementally without a decay
 * job, so they are recomputed from the append-only events nightly. At 2,000 members
 * this is milliseconds, and it means the counters are always rebuildable from truth.
 */
export async function reputationRecompute(_payload: unknown, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    await recomputeRollingWindows(tx);

    // Re-evaluate restrictions so ones that have aged out get lifted without an admin.
    const users = await tx.select({ id: profiles.userId }).from(profiles);
    for (const user of users) {
      await evaluateRestrictions(tx, user.id);
    }

    helpers.logger.info(`recomputed reputation windows for ${users.length} member(s)`);
  });
}

/**
 * Nightly assertion that nothing has drifted. Phase 2 adds the custody mirror check;
 * for now it catches orphaned open transactions and listings pointing at stale deals.
 */
export async function consistencyCheck(_payload: unknown, helpers: Helpers): Promise<void> {
  const problems: string[] = [];

  const orphaned = await db.execute(sql`
    select t.id from transactions t
     where t.state = 'open'
       and not exists (select 1 from listings l where l.id = t.listing_id
                         and l.status in ('claimed', 'ended_won'))
  `);
  if (orphaned.rows.length > 0) {
    problems.push(`${orphaned.rows.length} open transaction(s) on a non-claimed listing`);
  }

  const stalePointers = await db.execute(sql`
    select l.id from listings l
     join transactions t on t.id = l.active_transaction_id
    where t.state <> 'open'
  `);
  if (stalePointers.rows.length > 0) {
    problems.push(`${stalePointers.rows.length} listing(s) pointing at a closed transaction`);
  }

  const custodyDrift = await db.execute(sql`
    select t.id from transactions t
     join custody_holdings h on h.id = t.custody_holding_id
    where h.state::text <> t.custody_state::text
  `);
  if (custodyDrift.rows.length > 0) {
    problems.push(`${custodyDrift.rows.length} transaction(s) whose custody mirror has drifted`);
  }

  if (problems.length > 0) {
    helpers.logger.error(`CONSISTENCY PROBLEMS: ${problems.join('; ')}`);
  } else {
    helpers.logger.info('consistency check clean');
  }
}
