/**
 * Deadline handlers: payment/meetup completion window, seller drop-off window,
 * fallback-offer expiry, and candidate advancement.
 *
 * ★ Every one is IDEMPOTENT — the first thing each does is a conditional read or write
 *   that no-ops when the state has already moved. Graphile Worker guarantees
 *   at-least-once delivery, not exactly-once, so this is load-bearing rather than
 *   defensive.
 */

import { sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db } from '../../db/client';
import {
  promoteNextCandidate,
  expireAuctionFallbackOffer,
} from '../../services/transactions';
import { recomputeRollingWindows, evaluateRestrictions } from '../../services/reputation';
import { profiles } from '../../db/schema/profiles';

// ------------------------------------------------ payment / meetup completion window

interface TxPayload {
  transactionId: string;
}

/** Compatibility no-op for payment/meetup jobs queued before deadlines were retired. */
export async function paymentWindowExpired(payload: TxPayload, helpers: Helpers): Promise<void> {
  helpers.logger.info(`payment/meetup deadline retired for ${payload.transactionId}`);
}

/** Compatibility no-op for seller drop-off jobs queued before deadlines were retired. */
export async function dropoffWindowExpired(payload: TxPayload, helpers: Helpers): Promise<void> {
  helpers.logger.info(`seller drop-off deadline retired for ${payload.transactionId}`);
}

/**
 * Compatibility no-op for reminder jobs already queued before the mechanic was
 * removed. New transactions never enqueue this task; retaining the handler prevents
 * old jobs from retrying or failing as unknown tasks during deployment.
 */
export async function paymentReminder(payload: TxPayload & { reminderKind?: 'halfway' | 'two_hours' | 'deadline' }, helpers: Helpers): Promise<void> {
  helpers.logger.info(`payment reminder task retired for ${payload.transactionId}`);
}

/** Compatibility no-op for receipt jobs queued before deadlines were retired. */
export async function receiptWindowExpired(payload: TxPayload, helpers: Helpers): Promise<void> {
  helpers.logger.info(`receipt deadline retired for ${payload.transactionId}`);
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
