/**
 * Deadline handlers: payment window, seller drop-off window, payment reminder,
 * candidate promotion.
 *
 * ★ Every one is IDEMPOTENT — the first thing each does is a conditional read or write
 *   that no-ops when the state has already moved. Graphile Worker guarantees
 *   at-least-once delivery, not exactly-once, so this is load-bearing rather than
 *   defensive.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db } from '../../db/client';
import { transactions } from '../../db/schema/transactions';
import { listings } from '../../db/schema/listings';
import {
  terminateTransaction,
  promoteNextCandidate,
} from '../../services/transactions';
import { recomputeRollingWindows, evaluateRestrictions } from '../../services/reputation';
import { notify } from '../../notifications/dispatch';
import { profiles } from '../../db/schema/profiles';

// ---------------------------------------------------------------- payment window

interface TxPayload {
  transactionId: string;
}

/**
 * The buyer's payment window lapsed. Terminate, record the fact, promote the next
 * candidate. On a cash-meetup deal the same lapse means "never showed".
 */
export async function paymentWindowExpired(payload: TxPayload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, payload.transactionId), eq(transactions.state, 'open')))
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
      .where(and(eq(transactions.id, payload.transactionId), eq(transactions.state, 'open')))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return;

    // The item made it into custody — nothing to answer for.
    if (row.custodyState !== 'awaiting_dropoff') {
      helpers.logger.info(`transaction ${payload.transactionId} custody is ${row.custodyState} — moot`);
      return;
    }

    await terminateTransaction({
      tx,
      transactionId: payload.transactionId,
      reason: 'seller_no_dropoff',
      actorRole: 'system',
      // The seller failed, not the buyer — do not hand the item to a backup claimer
      // when there is no item on the shelf.
      promoteNext: false,
    });

    helpers.logger.info(`transaction ${payload.transactionId} reneged (seller_no_dropoff)`);
  });
}

/** One terse nudge before the deadline. Not a drip campaign — WhatsApp bills per message. */
export async function paymentReminder(payload: TxPayload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, payload.transactionId), eq(transactions.state, 'open')))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return;
    // Already paid or confirmed — no nagging.
    if (row.paymentState !== 'pending') return;

    const titles = await tx
      .select({ title: listings.title })
      .from(listings)
      .where(eq(listings.id, row.listingId))
      .limit(1);

    await notify({
      tx,
      userId: row.buyerId,
      event: 'payment_reminder',
      data: {
        listingTitle: titles[0]?.title ?? 'your deal',
        deadline: row.paymentDeadlineAt.toLocaleString('en-TT'),
      },
      linkUrl: `/deals/${row.id}`,
      idempotencyKey: `payment_reminder:${row.id}`,
    });

    helpers.logger.info(`reminder sent for ${payload.transactionId}`);
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
        : `listing ${payload.listingId} had no remaining candidates`,
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
