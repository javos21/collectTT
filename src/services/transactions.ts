/**
 * THE transaction lifecycle. Every state change on a deal goes through this module.
 *
 * Rules that hold everywhere in here:
 *   - every function takes an open DB transaction, and enqueues its side-effect jobs on
 *     that same transaction (see src/jobs/enqueue.ts)
 *   - every transition is checked against the shared state machine before it is written
 *   - every transition is recorded in `transaction_events` for dispute forensics
 *   - time comes from the DATABASE clock, never this process
 *
 * Both tracks are live. The payment track is driven from here; the custody track is
 * driven by src/services/custody.ts and reaches this module at exactly four points:
 * opening a holding, payment confirmation extending the shelf clock, termination
 * deciding the item's fate, and pickup completing the deal.
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';

import { dbNow, type Tx } from '../db/client';
import { transactions, transactionEvents } from '../db/schema/transactions';
import { listings, claims, bids } from '../db/schema/listings';
import { custodyHoldings } from '../db/schema/custody';
import { profiles } from '../db/schema/profiles';
import { enqueue } from '../jobs/enqueue';
import { notify } from '../notifications/dispatch';
import { recordEvent, evaluateRestrictions, incrementCounter } from './reputation';
import {
  openOrRelinkHolding,
  onPaymentConfirmed,
  onTransactionTerminated,
  returnToSeller,
  CustodyConflictError,
} from './custody';
import {
  assertPaymentTransition,
  assertTransactionTransition,
  canComplete,
  computeDeadlines,
  isFailedTransactionState,
  REASON_TO_STATE,
  statusAfterFailedAttempt,
  usesCustodyTrack,
  fallbackFulfillmentPath,
  type ActorRole,
  type FulfillmentPath,
  type TerminationReason,
  type TransactionSource,
} from '../domain';
import { formatMoney } from '../domain/money';

// ---------------------------------------------------------------- audit log

interface TransitionRecord {
  transactionId: string;
  track: 'overall' | 'payment' | 'custody';
  from: string;
  to: string;
  actorUserId?: string | null;
  actorRole: ActorRole;
  reason?: string;
  metadata?: Record<string, unknown>;
}

async function recordTransition(tx: Tx, r: TransitionRecord): Promise<void> {
  await tx.insert(transactionEvents).values({
    transactionId: r.transactionId,
    track: r.track,
    fromState: r.from,
    toState: r.to,
    actorUserId: r.actorUserId ?? null,
    actorRole: r.actorRole,
    reason: r.reason ?? null,
    metadata: r.metadata ?? {},
  });
}

// ---------------------------------------------------------------- opening

export interface OpenTransactionInput {
  tx: Tx;
  listingId: string;
  sellerId: string;
  buyerId: string;
  amountCents: number;
  fulfillmentPath: FulfillmentPath;
  source: TransactionSource;
  claimId?: string | null;
  winningBidId?: string | null;
  offerId?: string | null;
  listingTitle: string;
  /** Listing-wide seller choice; omitted for legacy rows, which use policy defaults. */
  paymentWindowHours?: number;
  /** Which relay store the buyer chose. Required for the `relay` path only. */
  relayStoreId?: string | null;
}

/**
 * Open a transaction attempt. Used by the straight-sale claim, the auction close, and
 * candidate promotion — all three produce the same object, so the downstream lifecycle
 * cannot diverge between them.
 */
export async function openTransaction(input: OpenTransactionInput): Promise<{ id: string }> {
  const { tx } = input;
  const now = await dbNow(tx);
  const deadlines = computeDeadlines(input.fulfillmentPath, now, input.paymentWindowHours);

  // Attempt numbers are unique per listing; a promotion opens the next one.
  const prior = await tx
    .select({ n: sql<number>`coalesce(max(${transactions.attemptNumber}), 0)` })
    .from(transactions)
    .where(eq(transactions.listingId, input.listingId));
  const attemptNumber = Number(prior[0]?.n ?? 0) + 1;

  const inserted = await tx
    .insert(transactions)
    .values({
      listingId: input.listingId,
      sellerId: input.sellerId,
      buyerId: input.buyerId,
      attemptNumber,
      source: input.source,
      claimId: input.claimId ?? null,
      winningBidId: input.winningBidId ?? null,
      offerId: input.offerId ?? null,
      amountCents: input.amountCents,
      fulfillmentPath: input.fulfillmentPath,
      state: 'open',
      paymentState: 'pending',
      custodyState: usesCustodyTrack(input.fulfillmentPath) ? 'awaiting_dropoff' : 'not_applicable',
      paymentDeadlineAt: deadlines.paymentDeadlineAt,
      sellerDropoffDeadlineAt: deadlines.sellerDropoffDeadlineAt,
    })
    .returning({ id: transactions.id });

  const created = inserted[0];
  if (created === undefined) throw new Error('Failed to open transaction');

  // ★ Custody paths get a holding. If the item is ALREADY on a shelf — the promotion
  //   case — openOrRelinkHolding re-links the existing holding instead of creating a
  //   second one, because custody follows the item and the item has not moved.
  if (usesCustodyTrack(input.fulfillmentPath)) {
    const sizeRows = await tx
      .select({ sizeClass: listings.sizeClass })
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .limit(1);

    await openOrRelinkHolding({
      tx,
      listingId: input.listingId,
      transactionId: created.id,
      path: input.fulfillmentPath as 'relay' | 'full_service',
      sizeClass: sizeRows[0]?.sizeClass ?? 'small',
      storeId: input.relayStoreId ?? null,
    });
  }

  await tx
    .update(listings)
    .set({ activeTransactionId: created.id, updatedAt: sql`now()` })
    .where(eq(listings.id, input.listingId));

  await recordTransition(tx, {
    transactionId: created.id,
    track: 'overall',
    from: '(none)',
    to: 'open',
    actorRole: 'system',
    reason: input.source,
    metadata: { attemptNumber, amountCents: input.amountCents },
  });

  await incrementCounter(tx, input.buyerId, 'buyClaimsTotal');

  // ★ Deadline jobs enqueued in the SAME transaction that opened the deal.
  await enqueue(
    tx,
    'transaction:payment_window',
    { transactionId: created.id },
    { jobKey: `payment_window:${created.id}`, runAt: deadlines.paymentDeadlineAt },
  );

  // One reminder at the two-thirds mark. Terse and consolidated on purpose — WhatsApp
  // bills per message, so this is one nudge, not a drip campaign.
  const remindAt = new Date(
    now.getTime() + (deadlines.paymentDeadlineAt.getTime() - now.getTime()) * 0.66,
  );
  await enqueue(
    tx,
    'transaction:payment_reminder',
    { transactionId: created.id },
    { jobKey: `payment_reminder:${created.id}`, runAt: remindAt },
  );

  if (deadlines.sellerDropoffDeadlineAt !== null) {
    await enqueue(
      tx,
      'transaction:dropoff_window',
      { transactionId: created.id },
      { jobKey: `dropoff_window:${created.id}`, runAt: deadlines.sellerDropoffDeadlineAt },
    );
  }

  const deadlineText = deadlines.paymentDeadlineAt.toLocaleString('en-TT');
  const buyerEvent =
    input.source === 'auction_win'
      ? 'auction_won'
      : input.source === 'offer_accept'
        ? 'offer_accepted_buyer'
        : 'claim_confirmed_buyer';

  await notify({
    tx,
    userId: input.buyerId,
    event: buyerEvent,
    data: {
      listingTitle: input.listingTitle,
      deadline: deadlineText,
      amount: formatMoney(input.amountCents),
    },
    linkUrl: `/deals/${created.id}`,
    idempotencyKey: `tx_opened_buyer:${created.id}`,
  });

  const buyer = await displayName(tx, input.buyerId);
  await notify({
    tx,
    userId: input.sellerId,
    event: input.source === 'offer_accept' ? 'offer_accepted_seller' : 'listing_claimed_seller',
    data: {
      listingTitle: input.listingTitle,
      buyerName: buyer,
      deadline: deadlineText,
      amount: formatMoney(input.amountCents),
    },
    linkUrl: `/deals/${created.id}`,
    idempotencyKey: `tx_opened_seller:${created.id}`,
  });

  return created;
}

async function displayName(tx: Tx, userId: string): Promise<string> {
  const rows = await tx
    .select({ name: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0]?.name ?? 'A member';
}

// ---------------------------------------------------------------- payment track

/** Buyer asserts they have paid (or that the meetup happened and cash changed hands). */
export async function markPaid(tx: Tx, transactionId: string, buyerId: string): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.buyerId !== buyerId) throw new ForbiddenError('Only the buyer can mark a deal paid');
  if (row.state !== 'open') throw new ConflictError('This deal is no longer open');

  assertPaymentTransition(row.paymentState, 'buyer_marked_paid');

  // Conditional UPDATE: a concurrent expiry job cannot be overtaken.
  const updated = await tx
    .update(transactions)
    .set({ paymentState: 'buyer_marked_paid', markedPaidAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.state, 'open'),
        eq(transactions.paymentState, 'pending'),
      ),
    )
    .returning({ id: transactions.id });

  if (updated.length === 0) throw new ConflictError('This deal has already moved on');

  await recordTransition(tx, {
    transactionId,
    track: 'payment',
    from: 'pending',
    to: 'buyer_marked_paid',
    actorUserId: buyerId,
    actorRole: 'buyer',
  });

  await notify({
    tx,
    userId: row.sellerId,
    event: 'payment_marked_paid_seller',
    data: { listingTitle: row.listingTitle, buyerName: await displayName(tx, buyerId) },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `marked_paid:${transactionId}`,
  });
}

/** Seller confirms the money arrived. This is the half of the handshake that matters. */
export async function confirmPayment(
  tx: Tx,
  transactionId: string,
  sellerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.sellerId !== sellerId) throw new ForbiddenError('Only the seller can confirm payment');
  if (row.state !== 'open') throw new ConflictError('This deal is no longer open');

  assertPaymentTransition(row.paymentState, 'confirmed');

  const updated = await tx
    .update(transactions)
    .set({
      paymentState: 'confirmed',
      paymentConfirmedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.state, 'open'),
        eq(transactions.paymentState, 'buyer_marked_paid'),
      ),
    )
    .returning({ id: transactions.id });

  if (updated.length === 0) throw new ConflictError('This deal has already moved on');

  await recordTransition(tx, {
    transactionId,
    track: 'payment',
    from: 'buyer_marked_paid',
    to: 'confirmed',
    actorUserId: sellerId,
    actorRole: 'seller',
  });

  // Objective fact: on time, or late? Measured against the server-set deadline.
  const now = await dbNow(tx);
  const onTime = now.getTime() <= row.paymentDeadlineAt.getTime();
  await recordEvent({
    tx,
    userId: row.buyerId,
    type: onTime ? 'buyer_paid_on_time' : 'buyer_paid_late',
    transactionId,
    counterpartyUserId: row.sellerId,
  });

  await notify({
    tx,
    userId: row.buyerId,
    event: 'payment_confirmed_buyer',
    data: { listingTitle: row.listingTitle },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `payment_confirmed:${transactionId}`,
  });

  // ★ On a custody path this is what unlocks the store's release action, and it
  //   EXTENDS the shelf clock — paying for an item buys it more time on the shelf.
  await onPaymentConfirmed(tx, transactionId);

  // For P2P paths custody is 'not_applicable', so this completes the deal outright.
  // For custody paths it is a no-op until the buyer actually collects.
  await completeIfBothTracksDone(tx, transactionId);
}

/** Seller says the money never arrived. The deadline is NOT extended. */
export async function disputePayment(
  tx: Tx,
  transactionId: string,
  sellerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.sellerId !== sellerId) throw new ForbiddenError('Only the seller can dispute');
  if (row.state !== 'open') throw new ConflictError('This deal is no longer open');

  assertPaymentTransition(row.paymentState, 'pending');

  const updated = await tx
    .update(transactions)
    .set({
      paymentState: 'pending',
      markedPaidAt: null,
      paymentDisputedAt: sql`now()`,
      updatedAt: sql`now()`,
      // ★ payment_deadline_at deliberately untouched. A seller cannot run out a buyer's
      //   clock with repeated disputes, and a buyer cannot buy time with a false claim.
    })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.state, 'open'),
        eq(transactions.paymentState, 'buyer_marked_paid'),
      ),
    )
    .returning({ id: transactions.id });

  if (updated.length === 0) throw new ConflictError('This deal has already moved on');

  await recordTransition(tx, {
    transactionId,
    track: 'payment',
    from: 'buyer_marked_paid',
    to: 'pending',
    actorUserId: sellerId,
    actorRole: 'seller',
    reason: 'seller disputes the payment claim',
  });

  await notify({
    tx,
    userId: row.buyerId,
    event: 'payment_disputed_buyer',
    data: {
      listingTitle: row.listingTitle,
      deadline: row.paymentDeadlineAt.toLocaleString('en-TT'),
    },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `payment_disputed:${transactionId}:${Date.now()}`,
  });
}

// ---------------------------------------------------------------- completion

/**
 * The ONLY way a transaction reaches 'completed'. Both tracks report in and the rollup
 * falls out — no caller sets 'completed' directly.
 */
export async function completeIfBothTracksDone(tx: Tx, transactionId: string): Promise<boolean> {
  const row = await load(tx, transactionId);
  if (row.state !== 'open') return false;
  if (!canComplete(row.paymentState, row.custodyState)) return false;

  assertTransactionTransition('open', 'completed');

  const updated = await tx
    .update(transactions)
    .set({
      state: 'completed',
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(transactions.id, transactionId), eq(transactions.state, 'open')))
    .returning({ id: transactions.id });

  if (updated.length === 0) return false;

  await recordTransition(tx, {
    transactionId,
    track: 'overall',
    from: 'open',
    to: 'completed',
    actorRole: 'system',
  });

  await recordEvent({
    tx,
    userId: row.buyerId,
    type: 'purchase_completed',
    transactionId,
    counterpartyUserId: row.sellerId,
  });
  await recordEvent({
    tx,
    userId: row.sellerId,
    type: 'sale_completed',
    transactionId,
    counterpartyUserId: row.buyerId,
  });

  // The listing is done — this is the one terminal success state.
  await tx
    .update(listings)
    .set({
      status: 'ended_won',
      resolvedAt: sql`now()`,
      activeTransactionId: null,
      updatedAt: sql`now()`,
    })
    .where(eq(listings.id, row.listingId));

  // Any still-queued backup claimers are now moot.
  await tx
    .update(claims)
    .set({ status: 'superseded' })
    .where(and(eq(claims.listingId, row.listingId), eq(claims.status, 'queued')));

  for (const userId of [row.buyerId, row.sellerId]) {
    await notify({
      tx,
      userId,
      event: 'transaction_completed',
      data: { listingTitle: row.listingTitle },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `completed:${transactionId}:${userId}`,
    });
  }

  return true;
}

// ---------------------------------------------------------------- termination

export interface TerminateInput {
  tx: Tx;
  transactionId: string;
  reason: TerminationReason;
  actorRole: ActorRole;
  actorUserId?: string | null;
  /** Skip promoting the next candidate (used when the seller is at fault). */
  promoteNext?: boolean;
}

/**
 * End a transaction attempt unsuccessfully, record the objective facts, and hand the
 * listing to the next candidate if there is one.
 *
 * IDEMPOTENT: the conditional UPDATE means a duplicate job delivery no-ops.
 */
export async function terminateTransaction(input: TerminateInput): Promise<boolean> {
  const { tx, transactionId, reason } = input;
  const row = await load(tx, transactionId);
  if (row.state !== 'open') return false;

  const toState = REASON_TO_STATE[reason];
  assertTransactionTransition('open', toState);

  const updated = await tx
    .update(transactions)
    .set({
      state: toState,
      // The payment track fails with the deal unless it had already settled.
      paymentState: row.paymentState === 'confirmed' ? 'confirmed' : 'failed',
      terminatedAt: sql`now()`,
      terminatedReason: reason,
      updatedAt: sql`now()`,
    })
    .where(and(eq(transactions.id, transactionId), eq(transactions.state, 'open')))
    .returning({ id: transactions.id });

  if (updated.length === 0) return false; // someone else got there first

  await recordTransition(tx, {
    transactionId,
    track: 'overall',
    from: 'open',
    to: toState,
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole,
    reason,
  });

  // ---- objective facts
  const factByReason = {
    non_payment: { user: row.buyerId, type: 'buyer_reneged_nonpayment' },
    buyer_no_show: { user: row.buyerId, type: 'buyer_no_show' },
    seller_no_dropoff: { user: row.sellerId, type: 'seller_reneged_no_dropoff' },
    seller_no_show: { user: row.sellerId, type: 'seller_no_show' },
  } as const;

  const fact = reason in factByReason ? factByReason[reason as keyof typeof factByReason] : null;
  if (fact !== null) {
    await recordEvent({
      tx,
      userId: fact.user,
      type: fact.type,
      transactionId,
      counterpartyUserId: fact.user === row.buyerId ? row.sellerId : row.buyerId,
    });
    await evaluateRestrictions(tx, fact.user);
  }

  // ---- close out the claim row, if this came from the claim stack
  if (row.claimId !== null) {
    await tx
      .update(claims)
      .set({ status: 'reneged' })
      .where(eq(claims.id, row.claimId));
  }

  // ---- notify
  if (toState === 'reneged_buyer') {
    await notify({
      tx,
      userId: row.buyerId,
      event: 'payment_window_lapsed_buyer',
      data: { listingTitle: row.listingTitle },
      idempotencyKey: `lapsed_buyer:${transactionId}`,
    });
  }
  if (toState === 'reneged_seller') {
    await notify({
      tx,
      userId: row.sellerId,
      event: 'seller_dropoff_lapsed',
      data: { listingTitle: row.listingTitle },
      idempotencyKey: `lapsed_seller:${transactionId}`,
    });
    // ★ Tell the buyer to STOP, while their own payment window is still open. This is
    //   what the tx_dropoff_before_payment invariant buys us.
    await notify({
      tx,
      userId: row.buyerId,
      event: 'buyer_told_to_hold_payment',
      data: { listingTitle: row.listingTitle },
      idempotencyKey: `hold_payment:${transactionId}`,
    });
  }

  // ---- hand on to the next candidate, unless the seller was at fault
  const shouldPromote = input.promoteNext ?? toState === 'reneged_buyer';

  // ★ Decide what happens to the ITEM. If a promotion is coming, the item stays exactly
  //   where it is and simply unlinks from this dead attempt — the whole point of
  //   attaching custody to the listing. If nothing is coming, resolveListingAfterFailure
  //   sends it back to the seller.
  await onTransactionTerminated(tx, transactionId, { candidatesRemain: shouldPromote });

  if (shouldPromote) {
    await enqueue(
      tx,
      'transaction:promote_next',
      { listingId: row.listingId, failedTransactionId: transactionId },
      { jobKey: `promote:${transactionId}` },
    );
  } else {
    await resolveListingAfterFailure(tx, row.listingId, false);
  }

  return true;
}

// ---------------------------------------------------------------- promotion

/**
 * ★ One algorithm, two ladders. A straight sale walks the claim stack by position; an
 *   auction walks the bid ladder by amount. Everything downstream of "who is next" is
 *   identical, which is why a reneged auction winner costs no extra machinery.
 */
export async function promoteNextCandidate(
  tx: Tx,
  listingId: string,
  failedTransactionId: string,
): Promise<{ promoted: boolean; transactionId?: string }> {
  const listingRows = await tx.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  const listing = listingRows[0];
  if (listing === undefined) return { promoted: false };

  // Nothing to do if a later attempt is already open (duplicate job delivery).
  const openRows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open')))
    .limit(1);
  if (openRows[0] !== undefined) return { promoted: false };

  // Everyone who has already failed on this listing is excluded from re-promotion.
  const failed = await tx
    .select({ buyerId: transactions.buyerId })
    .from(transactions)
    .where(
      and(
        eq(transactions.listingId, listingId),
        ne(transactions.state, 'completed'),
        ne(transactions.state, 'open'),
      ),
    );
  const excluded = new Set(failed.map((f) => f.buyerId));

  // ★ A promotion runs inside a JOB. Custody can refuse to open — the nominated store
  //   was deactivated (the spec's designated way to take a shop offline), or it no
  //   longer accepts this size. That refusal must not fail the job: a retried-to-death
  //   promotion strands the listing with no open attempt and nobody notified. So each
  //   candidate is attempted in its own SAVEPOINT, and a custody refusal moves to the
  //   next candidate instead of propagating. Anything else still throws.
  for (;;) {
    const candidate =
      listing.saleType === 'straight_sale'
        ? await nextFromClaimStack(tx, listingId, excluded)
        : await nextFromBidLadder(tx, listingId, excluded);

    if (candidate === null) {
      await resolveListingAfterFailure(tx, listingId, listing.autoRelistOnRenege);
      return { promoted: false };
    }

    try {
      const transactionId = await tx.transaction(async (sp) => {
        if (candidate.claimId !== undefined) {
          // A promoted backup becomes the new first claimant. Re-number the remaining
          // live queue behind them so a failed first claim frees the third slot for a
          // new buyer instead of leaving a misleading historical position gap.
          await sp
            .update(claims)
            .set({ status: 'active', position: 1 })
            .where(eq(claims.id, candidate.claimId));
          const remaining = await sp
            .select({ id: claims.id })
            .from(claims)
            .where(and(eq(claims.listingId, listingId), eq(claims.status, 'queued')))
            .orderBy(claims.position);
          for (const [index, queued] of remaining.entries()) {
            await sp.update(claims).set({ position: index + 2 }).where(eq(claims.id, queued.id));
          }
        }

        const opened = await openTransaction({
          tx: sp,
          listingId,
          sellerId: listing.sellerId,
          buyerId: candidate.buyerId,
          amountCents: candidate.amountCents,
          fulfillmentPath: candidate.fulfillmentPath,
          source: listing.saleType === 'straight_sale' ? 'claim_promotion' : 'auction_runner_up',
          claimId: candidate.claimId ?? null,
          winningBidId: candidate.bidId ?? null,
          listingTitle: listing.title,
          paymentWindowHours: listing.paymentWindowHours,
          relayStoreId: candidate.relayStoreId ?? null,
        });

        if (candidate.claimId !== undefined) {
          await sp
            .update(claims)
            .set({ transactionId: opened.id })
            .where(eq(claims.id, candidate.claimId));
        }

        // A promoted candidate gets a distinct, louder notification than a first
        // claimer: they were not expecting this, and their clock is already running.
        await notify({
          tx: sp,
          userId: candidate.buyerId,
          event: 'claim_promoted_buyer',
          data: {
            listingTitle: listing.title,
            deadline: (await load(sp, opened.id)).paymentDeadlineAt.toLocaleString('en-TT'),
          },
          linkUrl: `/deals/${opened.id}`,
          idempotencyKey: `promoted:${opened.id}`,
        });

        await recordTransition(sp, {
          transactionId: opened.id,
          track: 'overall',
          from: '(promotion)',
          to: 'open',
          actorRole: 'system',
          reason: `promoted after ${failedTransactionId} failed`,
        });

        return opened.id;
      });

      return { promoted: true, transactionId };
    } catch (error) {
      if (!(error instanceof CustodyConflictError)) throw error;
      // Everything this candidate wrote has been rolled back to the savepoint.
      console.warn(
        `[promote] listing ${listingId}: candidate ${candidate.buyerId} could not take ` +
          `custody (${error.message}) — trying the next one`,
      );
      excluded.add(candidate.buyerId);
    }
  }
}

interface Candidate {
  buyerId: string;
  amountCents: number;
  fulfillmentPath: FulfillmentPath;
  /** The promoted claimer's OWN store choice, not the person's ahead of them. */
  relayStoreId?: string | null;
  claimId?: string;
  bidId?: string;
}

async function nextFromClaimStack(
  tx: Tx,
  listingId: string,
  excluded: Set<string>,
): Promise<Candidate | null> {
  const rows = await tx
    .select()
    .from(claims)
    .where(and(eq(claims.listingId, listingId), eq(claims.status, 'queued')))
    .orderBy(claims.position);

  const listingRows = await tx
    .select({ priceCents: listings.priceCents })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  const price = listingRows[0]?.priceCents;
  if (price === null || price === undefined) return null;

  for (const row of rows) {
    if (excluded.has(row.claimantId)) continue;
    return {
      buyerId: row.claimantId,
      amountCents: price,
      fulfillmentPath: row.fulfillmentPath,
      relayStoreId: row.relayStoreId,
      claimId: row.id,
    };
  }
  return null;
}

async function nextFromBidLadder(
  tx: Tx,
  listingId: string,
  excluded: Set<string>,
): Promise<Candidate | null> {
  const rows = await tx
    .select()
    .from(bids)
    .where(and(eq(bids.listingId, listingId), ne(bids.status, 'void'), ne(bids.status, 'retracted')))
    .orderBy(desc(bids.amountCents));

  const listingRows = await tx
    .select({ paths: listings.fulfillmentPaths, reserve: listings.reserveCents })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  const listing = listingRows[0];
  if (listing === undefined) return null;

  for (const row of rows) {
    if (excluded.has(row.bidderId)) continue;
    // A runner-up owes their OWN bid, not the winner's — and only if it clears reserve.
    if (listing.reserve !== null && row.amountCents < listing.reserve) return null;
    return {
      buyerId: row.bidderId,
      amountCents: row.amountCents,
      // ★ The bidder's OWN choice, mirroring how the claim stack has always worked.
      //   Falls back to the first store-free declared path only for bids placed before
      //   Phase 2, which carry neither a path nor a store — see fallbackFulfillmentPath.
      fulfillmentPath: row.fulfillmentPath ?? fallbackFulfillmentPath(listing.paths),
      relayStoreId: row.relayStoreId,
      bidId: row.id,
    };
  }
  return null;
}

/** No candidates left: relist, or give up, per the seller's flag. */
async function resolveListingAfterFailure(
  tx: Tx,
  listingId: string,
  autoRelist: boolean,
): Promise<void> {
  // ★ Nobody is left to hand the item to. If it is sitting on a shelf, it becomes the
  //   seller's to reclaim — an unpaid item must never become the store's problem.
  const stranded = await tx
    .select({ id: custodyHoldings.id })
    .from(custodyHoldings)
    .where(
      and(
        eq(custodyHoldings.listingId, listingId),
        sql`${custodyHoldings.state} in ('at_relay', 'release_authorized')`,
      ),
    )
    .limit(1);

  const strandedHolding = stranded[0];
  if (strandedHolding !== undefined) {
    await returnToSeller({
      tx,
      holdingId: strandedHolding.id,
      actorUserId: '',
      actorRole: 'system',
      reason: 'no remaining buyers — unpaid item returns to the seller',
    });
  }

  const status = statusAfterFailedAttempt({
    hasRemainingCandidates: false,
    autoRelistOnRenege: autoRelist,
  });

  await tx
    .update(listings)
    .set({
      status,
      activeTransactionId: null,
      resolvedAt: status === 'active' ? null : sql`now()`,
      // A relisted straight sale starts a fresh stack.
      updatedAt: sql`now()`,
    })
    .where(eq(listings.id, listingId));

  if (status === 'active') {
    await tx
      .update(claims)
      .set({ status: 'superseded' })
      .where(and(eq(claims.listingId, listingId), ne(claims.status, 'reneged')));
  }
}

// ---------------------------------------------------------------- reads

export interface LoadedTransaction {
  id: string;
  listingId: string;
  listingTitle: string;
  sellerId: string;
  buyerId: string;
  source: (typeof transactions.$inferSelect)['source'];
  state: (typeof transactions.$inferSelect)['state'];
  paymentState: (typeof transactions.$inferSelect)['paymentState'];
  custodyState: (typeof transactions.$inferSelect)['custodyState'];
  fulfillmentPath: FulfillmentPath;
  amountCents: number;
  paymentDeadlineAt: Date;
  claimId: string | null;
  offerId: string | null;
}

async function load(tx: Tx, transactionId: string): Promise<LoadedTransaction> {
  const rows = await tx
    .select({ t: transactions, listingTitle: listings.title })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .where(eq(transactions.id, transactionId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new NotFoundError('Deal not found');

  return {
    id: row.t.id,
    listingId: row.t.listingId,
    listingTitle: row.listingTitle,
    sellerId: row.t.sellerId,
    buyerId: row.t.buyerId,
    source: row.t.source,
    state: row.t.state,
    paymentState: row.t.paymentState,
    custodyState: row.t.custodyState,
    fulfillmentPath: row.t.fulfillmentPath,
    amountCents: row.t.amountCents,
    paymentDeadlineAt: row.t.paymentDeadlineAt,
    claimId: row.t.claimId,
    offerId: row.t.offerId,
  };
}

export { load as loadTransaction, isFailedTransactionState };

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
