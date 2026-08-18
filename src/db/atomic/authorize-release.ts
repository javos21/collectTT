/**
 * ★★ THE RELEASE GATE — the one cross-track dependency in the entire system.
 *
 * An item moves at_relay -> release_authorized ONLY when the linked transaction's
 * payment_state is 'confirmed'. The check lives inside the same statement that flips
 * the state:
 *
 *     UPDATE custody_holdings SET state = 'release_authorized'
 *      WHERE state = 'at_relay'
 *        AND EXISTS (SELECT 1 FROM transactions
 *                     WHERE id = current_transaction_id
 *                       AND state = 'open' AND payment_state = 'confirmed')
 *
 * Zero rows returned means the store is told "payment not confirmed yet". There is no
 * code path — none — that can release an unpaid item, and no window between checking
 * and acting in which a payment dispute could slip through.
 *
 * This is the whole escrow guarantee, and it is four lines of SQL: the seller drops the
 * item before the buyer pays, and the store will not hand it over until payment
 * confirms. Both parties are covered without the platform ever touching money.
 */

import { sql } from 'drizzle-orm';

import { loadHolding, CustodyConflictError, CustodyForbiddenError } from '../../services/custody';
import { relayStoreStaff } from '../schema/custody';
import { transactions, transactionEvents } from '../schema/transactions';
import { listings } from '../schema/listings';
import { notify } from '../../notifications/dispatch';
import { assertCustodyTransition } from '../../domain/states/custody';
import { and, eq } from 'drizzle-orm';
import type { StoreActionInput } from '../../services/custody';

export async function authorizeReleaseAtomic(input: StoreActionInput): Promise<void> {
  const { tx, holdingId } = input;
  const holding = await loadHolding(tx, holdingId);
  const actorRole = input.actorRole ?? 'store';

  // Shape check first: is this transition legal at all?
  assertCustodyTransition(holding.state, 'release_authorized');

  // Authority check: only staff of THIS store (or an admin) may release.
  if (actorRole !== 'admin') {
    if (holding.storeId === null) {
      throw new CustodyForbiddenError('This item is with the delivery team, not a store');
    }
    const staff = await tx
      .select({ role: relayStoreStaff.role })
      .from(relayStoreStaff)
      .where(
        and(
          eq(relayStoreStaff.storeId, holding.storeId),
          eq(relayStoreStaff.userId, input.actorUserId),
        ),
      )
      .limit(1);
    if (staff[0] === undefined) {
      throw new CustodyForbiddenError('You are not staff at the store holding this item');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ★ THE GATE. Payment state is checked inside the statement that acts on it.
  // ────────────────────────────────────────────────────────────────────────────
  const result = await tx.execute(sql`
    update custody_holdings h
       set state = 'release_authorized',
           release_authorized_at = now(),
           released_by_user_id = ${input.actorUserId === '' ? null : input.actorUserId},
           updated_at = now()
     where h.id = ${holdingId}
       and h.state = 'at_relay'
       and exists (
         select 1 from transactions t
          where t.id = h.current_transaction_id
            and t.state = 'open'
            and t.payment_state = 'confirmed'
       )
    returning h.id, h.current_transaction_id
  `);

  if (result.rows.length === 0) {
    // Distinguish the two failure modes so the clerk gets a useful sentence rather
    // than a generic error — this is the message a busy shop counter actually reads.
    const current = await loadHolding(tx, holdingId);
    if (current.state !== 'at_relay') {
      throw new CustodyConflictError(
        `This item is "${current.state.replace(/_/g, ' ')}" — it cannot be released from here.`,
      );
    }
    throw new CustodyConflictError(
      'Payment has not been confirmed yet. Do not hand this item over.',
    );
  }

  const row = result.rows[0] as { id: string; current_transaction_id: string | null };
  const transactionId = row.current_transaction_id;
  if (transactionId === null) return;

  // Mirror + audit, in this same transaction.
  await tx
    .update(transactions)
    .set({ custodyState: 'release_authorized', updatedAt: sql`now()` })
    .where(eq(transactions.id, transactionId));

  await tx.insert(transactionEvents).values({
    transactionId,
    track: 'custody',
    fromState: 'at_relay',
    toState: 'release_authorized',
    actorUserId: input.actorUserId === '' ? null : input.actorUserId,
    actorRole,
    reason: 'payment confirmed — cleared for collection',
    metadata: { holdingId },
  });

  const ctx = await tx
    .select({ buyerId: transactions.buyerId, title: listings.title })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .where(eq(transactions.id, transactionId))
    .limit(1);

  const details = ctx[0];
  if (details !== undefined) {
    await notify({
      tx,
      userId: details.buyerId,
      event: 'custody_ready_for_pickup',
      data: { listingTitle: details.title, storeName: 'the store' },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `release_authorized:${holdingId}:${transactionId}`,
    });
  }
}
