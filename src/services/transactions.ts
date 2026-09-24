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

import { and, desc, eq, ne, sql, inArray, lt, gt, lte } from 'drizzle-orm';

import { dbNow, type Tx } from '../db/client';
import { transactions, transactionEvents } from '../db/schema/transactions';
import { listings, claims, bids, listingAuditEvents } from '../db/schema/listings';
import { auctionFallbackOffers } from '../db/schema/auction-fallback-offers';
import { offers } from '../db/schema/offers';
import { custodyHoldings } from '../db/schema/custody';
import { profiles } from '../db/schema/profiles';
import { disputes } from '../db/schema/notifications';
import { enqueue } from '../jobs/enqueue';
import { notify } from '../notifications/dispatch';
import { recordAnalyticsEvent } from './analytics';
import { recordEvent, evaluateRestrictions } from './reputation';
import {
  openOrRelinkHolding,
  markPickedUp,
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
import { WINDOWS } from '../domain/policy/windows';
import { recordAdminAudit } from './admin-audit';
import type { SettlementMethod } from '../domain/policy/settlement';
import { acquireCommitmentEligibility } from './marketplace-eligibility';
import { MarketplaceEligibilityError } from './marketplace-eligibility';
import { isV1Launch, V1_HANDOFF_CONFIRMATION_WINDOW_HOURS } from '@/lib/launch-scope';
import {
  assertHandoffTransition,
  initialHandoffState,
  type HandoffState,
} from '@/domain/states/handoff';

/**
 * Promotion jobs are at-least-once. Two deliveries can both pass the open-row check
 * before one wins the database's partial unique index, so that collision is a safe
 * no-op rather than a failed job.
 */
function isOpenTransactionCollision(error: unknown): boolean {
  for (let e: unknown = error; e !== null && e !== undefined; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'tx_one_open_per_listing') return true;
  }
  return false;
}

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
  /** Exact admin-managed delivery choice; null for legacy records. */
  deliveryOptionId?: string | null;
  /** Seller meetup choice captured at commitment time; null for legacy records. */
  meetupLocationId?: string | null;
  source: TransactionSource;
  claimId?: string | null;
  winningBidId?: string | null;
  offerId?: string | null;
  listingTitle: string;
  /** Internal transaction deadline override; cash meetups use it as the meetup-completion window. */
  paymentWindowHours?: number;
  /** Which relay store the buyer chose. Required for the `relay` path only. */
  relayStoreId?: string | null;
  /** The buyer's selected payment method. Nullable for legacy transactions. */
  settlementMethod?: string | null;
  /** Set by the v1 user-facing commitment action. Internal legacy callers may omit it. */
  commitmentAcknowledged?: boolean;
}

/**
 * Open a transaction attempt. Used by the straight-sale claim, the auction close, and
 * candidate promotion — all three produce the same object, so the downstream lifecycle
 * cannot diverge between them.
 */
export async function openTransaction(input: OpenTransactionInput): Promise<{ id: string }> {
  const { tx } = input;
  await acquireCommitmentEligibility(tx, input.buyerId);
  const now = await dbNow(tx);
  const deadlines = computeDeadlines(input.fulfillmentPath, now, input.paymentWindowHours);
  const handoffState = initialHandoffState(input.fulfillmentPath, isV1Launch() && input.commitmentAcknowledged === true);

  // Attempt numbers are unique per listing; an auction runner-up opens the next one.
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
      deliveryOptionId: input.deliveryOptionId ?? null,
      meetupLocationId: input.meetupLocationId ?? null,
      settlementMethod: input.settlementMethod ?? null,
      state: 'open',
      paymentState: 'pending',
      custodyState: usesCustodyTrack(input.fulfillmentPath) ? 'awaiting_dropoff' : 'not_applicable',
      handoffState,
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
    await openOrRelinkHolding({
      tx,
      listingId: input.listingId,
      transactionId: created.id,
      path: input.fulfillmentPath as 'relay' | 'full_service',
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

  // ★ Deadline jobs enqueued in the SAME transaction that opened the deal.
  await enqueue(
    tx,
    'transaction:payment_window',
    { transactionId: created.id },
    { jobKey: `payment_window:${created.id}`, runAt: deadlines.paymentDeadlineAt },
  );

  if (deadlines.sellerDropoffDeadlineAt !== null) {
    await enqueue(
      tx,
      'transaction:dropoff_window',
      { transactionId: created.id },
      { jobKey: `dropoff_window:${created.id}`, runAt: deadlines.sellerDropoffDeadlineAt },
    );
  }

  const buyerEvent =
    input.source === 'auction_win'
      ? 'auction_won'
      : input.source === 'auction_runner_up'
        ? 'auction_runner_up_buyer'
      : input.source === 'offer_accept'
        ? 'offer_accepted_buyer'
        : 'claim_confirmed_buyer';

  await notify({
    tx,
    userId: input.buyerId,
    event: buyerEvent,
    data: {
      listingTitle: input.listingTitle,
      amount: formatMoney(input.amountCents),
      fulfillmentPath: input.fulfillmentPath,
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
      amount: formatMoney(input.amountCents),
      fulfillmentPath: input.fulfillmentPath,
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

/** Buyer records payment. This single assertion settles the payment track. */
export async function markPaid(tx: Tx, transactionId: string, buyerId: string): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.buyerId !== buyerId) throw new ForbiddenError('Only the buyer can mark a deal paid');
  if (row.state !== 'open' || row.disputeState === 'open') throw new ConflictError('This deal is no longer actionable');
  if (row.fulfillmentPath === 'cash_meetup' && row.handoffState === 'awaiting_handoff') {
    throw new ConflictError('Meetup payment is confirmed when the item is handed over.');
  }

  if (row.paymentState === 'confirmed') return;
  assertPaymentTransition(row.paymentState, 'confirmed');

  // Conditional UPDATE: a concurrent expiry job cannot be overtaken.
  const updated = await tx
    .update(transactions)
    .set({
      paymentState: 'confirmed',
      markedPaidAt: sql`coalesce(${transactions.markedPaidAt}, now())`,
      paymentConfirmedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.state, 'open'),
        inArray(transactions.paymentState, ['pending', 'buyer_marked_paid']),
      ),
    )
    .returning({ id: transactions.id });

  if (updated.length === 0) throw new ConflictError('This deal has already moved on');

  await recordTransition(tx, {
    transactionId,
    track: 'payment',
    from: row.paymentState,
    to: 'confirmed',
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

  await afterPaymentConfirmed(tx, transactionId, row);
}

/** Legacy compatibility for deals created under the former seller-confirmation flow. */
export async function confirmPayment(
  tx: Tx,
  transactionId: string,
  sellerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.sellerId !== sellerId) throw new ForbiddenError('Only the seller can confirm payment');
  if (row.paymentState === 'confirmed') return;
  if (row.state !== 'open' || row.disputeState === 'open') throw new ConflictError('This deal is no longer actionable');

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

  await afterPaymentConfirmed(tx, transactionId, row, true);
}

async function afterPaymentConfirmed(
  tx: Tx,
  transactionId: string,
  row: Awaited<ReturnType<typeof load>>,
  notifyBuyer = false,
): Promise<void> {
  if (notifyBuyer) {
    await notify({
      tx,
      userId: row.buyerId,
      event: 'payment_confirmed_buyer',
      data: { listingTitle: row.listingTitle },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `payment_confirmed:${transactionId}`,
    });
  }

  // An accepted offer does not displace competing offers until payment is
  // authoritative. If the accepted buyer never pays, those offers remain available
  // for the seller to review after the failed deal is released.
  if (row.source === 'offer_accept') {
    const competingOffers = await tx
      .select({ id: offers.id, buyerId: offers.buyerId })
      .from(offers)
      .where(and(eq(offers.listingId, row.listingId), eq(offers.status, 'pending')));

    await tx
      .update(offers)
      .set({ status: 'rejected', respondedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(offers.listingId, row.listingId), eq(offers.status, 'pending')));

    for (const offer of competingOffers) {
      await notify({
        tx,
        userId: offer.buyerId,
        event: 'offer_closed_after_payment_buyer',
        data: { listingTitle: row.listingTitle },
        linkUrl: `/listings/${row.listingId}`,
        idempotencyKey: `offer_closed_after_payment:${transactionId}:${offer.id}`,
      });
    }
  }

  // ★ On a custody path this extends the shelf clock and automatically clears a
  //   paid store-held item for collection — paying for an item buys it more time
  //   on the shelf without asking a clerk to approve a second step.
  await onPaymentConfirmed(tx, transactionId);

  // For P2P paths custody is 'not_applicable', so this completes the deal outright.
  // For custody paths it is a no-op until the buyer actually collects.
  await completeIfBothTracksDone(tx, transactionId);
}

/** Buyer confirms that a store-held item is physically in their hands. */
export async function confirmCustodyCollection(
  tx: Tx,
  transactionId: string,
  buyerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.buyerId !== buyerId) throw new ForbiddenError('Only the buyer can confirm collection');
  if (row.state !== 'open' || row.disputeState === 'open') throw new ConflictError('This deal is no longer actionable');
  if (!usesCustodyTrack(row.fulfillmentPath)) throw new ConflictError('This deal does not use store collection');
  if (row.paymentState !== 'confirmed') throw new ConflictError('Mark payment as sent before collecting the item');

  let holdings = await tx
    .select({ id: custodyHoldings.id, state: custodyHoldings.state })
    .from(custodyHoldings)
    .where(eq(custodyHoldings.currentTransactionId, transactionId))
    .limit(1);
  if (holdings[0]?.state === 'at_relay') {
    await onPaymentConfirmed(tx, transactionId);
    holdings = await tx
      .select({ id: custodyHoldings.id, state: custodyHoldings.state })
      .from(custodyHoldings)
      .where(eq(custodyHoldings.currentTransactionId, transactionId))
      .limit(1);
  }
  const holding = holdings[0];
  if (holding === undefined || holding.state !== 'release_authorized') {
    throw new ConflictError('This item is not ready for collection');
  }
  await markPickedUp({ tx, holdingId: holding.id, actorUserId: buyerId, actorRole: 'buyer' });
}

/** Seller records that the paid item was handed to the buyer at the meetup. */
export async function markItemHandedOver(
  tx: Tx,
  transactionId: string,
  sellerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.sellerId !== sellerId) throw new ForbiddenError('Only the seller can mark the item handed over');
  if (row.handoffState === 'seller_handed_over' || row.handoffState === 'buyer_received') return;
  if (row.state !== 'open' || row.disputeState === 'open') throw new ConflictError('This deal is no longer actionable');
  if (row.fulfillmentPath !== 'cash_meetup') throw new ConflictError('Item hand-off is only available for meetup deals');
  if (row.paymentState !== 'confirmed') throw new ConflictError('Payment must be confirmed before hand-off');
  assertHandoffTransition(row.handoffState, 'seller_handed_over');
  const now = await dbNow(tx);

  const updated = await tx.update(transactions).set({
    handoffState: 'seller_handed_over',
    handedOverAt: sql`now()`,
    receiptDeadlineAt: sql`now() + (${V1_HANDOFF_CONFIRMATION_WINDOW_HOURS} || ' hours')::interval`,
    updatedAt: sql`now()`,
  }).where(and(
    eq(transactions.id, transactionId),
    eq(transactions.state, 'open'),
    eq(transactions.handoffState, 'awaiting_handoff'),
  )).returning({ id: transactions.id });
  if (updated.length === 0) throw new ConflictError('This hand-off has already been recorded');

  await recordTransition(tx, {
    transactionId,
    track: 'overall',
    from: 'awaiting_handoff',
    to: 'seller_handed_over',
    actorUserId: sellerId,
    actorRole: 'seller',
  });
  await notify({
    tx,
    userId: row.buyerId,
    event: 'item_handed_over_buyer',
    data: { listingTitle: row.listingTitle, deadline: 'buyer confirmation required' },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `item_handed_over:${transactionId}`,
  });
  const receiptDeadline = new Date(now.getTime() + V1_HANDOFF_CONFIRMATION_WINDOW_HOURS * 60 * 60 * 1000);
  await enqueue(tx, 'transaction:receipt_window', { transactionId }, {
    jobKey: `receipt_window:${transactionId}`,
    runAt: receiptDeadline,
  });
}

/** Buyer confirms receipt after the seller records the hand-off. */
export async function confirmItemReceived(
  tx: Tx,
  transactionId: string,
  buyerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.buyerId !== buyerId) throw new ForbiddenError('Only the buyer can confirm receipt');
  if (row.handoffState === 'buyer_received') return;
  if (row.state !== 'open' || row.disputeState === 'open') throw new ConflictError('This deal is no longer actionable');
  if (row.fulfillmentPath !== 'cash_meetup') throw new ConflictError('Item receipt is only available for meetup deals');
  assertHandoffTransition(row.handoffState, 'buyer_received');

  const updated = await tx.update(transactions).set({
    handoffState: 'buyer_received',
    receivedAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(
    eq(transactions.id, transactionId),
    eq(transactions.state, 'open'),
    eq(transactions.handoffState, 'seller_handed_over'),
  )).returning({ id: transactions.id });
  if (updated.length === 0) throw new ConflictError('This receipt has already been recorded');

  await recordTransition(tx, {
    transactionId,
    track: 'overall',
    from: 'seller_handed_over',
    to: 'buyer_received',
    actorUserId: buyerId,
    actorRole: 'buyer',
  });
  await notify({
    tx,
    userId: row.sellerId,
    event: 'item_received_seller',
    data: { listingTitle: row.listingTitle },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `item_received:${transactionId}`,
  });
  await completeIfBothTracksDone(tx, transactionId);
}

/**
 * v1 cash meetup: the buyer's single action settles payment and receipt together.
 * A cash meetup is one physical moment — cash changes hands and the item is handed
 * over at once — so the v1 flow has no separate seller hand-off step. This records
 * "paid" and "received" atomically, then lets the rollup fall out as complete.
 */
export async function completeCashMeetup(
  tx: Tx,
  transactionId: string,
  buyerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.buyerId !== buyerId) throw new ForbiddenError('Only the buyer can complete the meetup');
  if (row.handoffState === 'buyer_received') return;
  if (row.state !== 'open' || row.disputeState === 'open') throw new ConflictError('This deal is no longer actionable');
  if (row.fulfillmentPath !== 'cash_meetup') throw new ConflictError('This deal is not a meetup');
  if (row.handoffState !== 'awaiting_handoff' && row.handoffState !== 'seller_handed_over') {
    throw new ConflictError('This meetup is not awaiting completion');
  }
  if ((await dbNow(tx)).getTime() >= row.paymentDeadlineAt.getTime()) {
    throw new ConflictError('The meetup window has ended');
  }

  if (row.paymentState !== 'confirmed') {
    assertPaymentTransition(row.paymentState, 'confirmed');
  }

  const updated = await tx
    .update(transactions)
    .set({
      paymentState: 'confirmed',
      markedPaidAt: sql`coalesce(${transactions.markedPaidAt}, now())`,
      paymentConfirmedAt: sql`now()`,
      handoffState: 'buyer_received',
      receivedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.state, 'open'),
        eq(transactions.fulfillmentPath, 'cash_meetup'),
        gt(transactions.paymentDeadlineAt, sql`now()`),
        inArray(transactions.paymentState, ['pending', 'buyer_marked_paid', 'confirmed']),
        inArray(transactions.handoffState, ['awaiting_handoff', 'seller_handed_over']),
      ),
    )
    .returning({ id: transactions.id });

  if (updated.length === 0) throw new ConflictError('This deal has already moved on');

  if (row.paymentState !== 'confirmed') {
    await recordTransition(tx, {
      transactionId,
      track: 'payment',
      from: row.paymentState,
      to: 'confirmed',
      actorUserId: buyerId,
      actorRole: 'buyer',
    });
  }

  await recordTransition(tx, {
    transactionId,
    track: 'overall',
    from: row.handoffState,
    to: 'buyer_received',
    actorUserId: buyerId,
    actorRole: 'buyer',
    reason: 'cash meetup completed',
  });

  // Closes competing offers on an accepted-offer source and — through
  // completeIfBothTracksDone — finishes the deal now that both tracks are settled.
  await afterPaymentConfirmed(tx, transactionId, row);

  await notify({
    tx,
    userId: row.sellerId,
    event: 'item_received_seller',
    data: { listingTitle: row.listingTitle },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `meetup_complete:${transactionId}`,
  });
}

/** Seller says the money never arrived. The deadline is NOT extended. */
export async function disputePayment(
  tx: Tx,
  transactionId: string,
  sellerId: string,
): Promise<void> {
  const row = await load(tx, transactionId);
  if (row.sellerId !== sellerId) throw new ForbiddenError('Only the seller can dispute');
  if (row.state !== 'open' || row.disputeState === 'open') throw new ConflictError('This deal is no longer actionable');

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

  // Keep the seller's binary payment response visible in the dispute work queue as
  // well as in the payment timeline. Do not create duplicates when a payment is
  // marked and disputed repeatedly before support has reviewed the first report.
  const existingDispute = await tx
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(
      eq(disputes.transactionId, transactionId),
      eq(disputes.raisedBy, sellerId),
      eq(disputes.reason, 'payment_not_received'),
      eq(disputes.status, 'open'),
    ))
    .limit(1);
  if (existingDispute[0] === undefined) {
    await tx.insert(disputes).values({
      transactionId,
      raisedBy: sellerId,
      reason: 'payment_not_received',
      detail: 'The seller reported that the buyer marked the payment as sent, but the payment was not received.',
    });
  }

  await notify({
    tx,
    userId: row.buyerId,
    event: 'payment_disputed_buyer',
    data: { listingTitle: row.listingTitle },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `payment_disputed:${transactionId}:${Date.now()}`,
  });
}

/** Admin/support extension. Sellers and buyers cannot move platform deadlines. */
export async function extendPaymentDeadline(input: {
  tx: Tx;
  transactionId: string;
  hours: number;
  reason: string;
  adminUserId: string;
}): Promise<Date> {
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 168) {
    throw new ConflictError('Deadline extensions must be between 1 and 168 hours.');
  }
  if (input.reason.trim().length < 10 || input.reason.trim().length > 500) {
    throw new ConflictError('Enter an extension reason between 10 and 500 characters.');
  }
  const row = await load(input.tx, input.transactionId);
  if (row.state !== 'open') throw new ConflictError('Only an open deal can be extended.');
  const now = await dbNow(input.tx);
  const nextDeadline = new Date(Math.max(row.paymentDeadlineAt.getTime(), now.getTime()) + input.hours * 60 * 60 * 1000);
  const updated = await input.tx.update(transactions).set({ paymentDeadlineAt: nextDeadline, updatedAt: sql`now()` })
    .where(and(eq(transactions.id, input.transactionId), eq(transactions.state, 'open')))
    .returning({ paymentDeadlineAt: transactions.paymentDeadlineAt });
  if (updated.length === 0) throw new ConflictError('The deal changed before its deadline could be extended.');
  await recordTransition(input.tx, {
    transactionId: input.transactionId,
    track: 'overall',
    from: 'open',
    to: 'open',
    actorUserId: input.adminUserId,
    actorRole: 'admin',
    reason: input.reason.trim(),
    metadata: { previousDeadlineAt: row.paymentDeadlineAt.toISOString(), extendedHours: input.hours },
  });
  await enqueue(input.tx, 'transaction:payment_window', { transactionId: input.transactionId }, { jobKey: `payment_window:${input.transactionId}`, runAt: nextDeadline });
  return updated[0]!.paymentDeadlineAt;
}

// ---------------------------------------------------------------- completion

/**
 * The ONLY way a transaction reaches 'completed'. Both tracks report in and the rollup
 * falls out — no caller sets 'completed' directly.
 */
export async function completeIfBothTracksDone(tx: Tx, transactionId: string): Promise<boolean> {
  const row = await load(tx, transactionId);
  if (row.state !== 'open' || row.disputeState === 'open') return false;
  if (!canComplete(row.paymentState, row.custodyState, row.handoffState)) return false;

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

  await recordAnalyticsEvent(tx, {
    eventName: 'transaction_completed',
    userId: row.buyerId,
    subjectType: 'transaction',
    subjectId: transactionId,
    metadata: { listingId: row.listingId, amountCents: row.amountCents },
    idempotencyKey: `transaction-completed:${transactionId}`,
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

  // Completion is the final authority for the listing. Resolve any pending offers
  // that survived an older or unusual path so buyers cannot see stale actions after
  // the item is complete.
  const pendingOffers = await tx
    .select({ id: offers.id, buyerId: offers.buyerId })
    .from(offers)
    .where(and(eq(offers.listingId, row.listingId), eq(offers.status, 'pending')));
  await tx
    .update(offers)
    .set({ status: 'rejected', respondedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(offers.listingId, row.listingId), eq(offers.status, 'pending')));

  for (const offer of pendingOffers) {
    await notify({
      tx,
      userId: offer.buyerId,
      event: 'offer_rejected_buyer',
      data: { listingTitle: row.listingTitle },
      linkUrl: `/listings/${row.listingId}`,
      idempotencyKey: `offer_rejected:completed:${transactionId}:${offer.id}`,
    });
  }

  // A completed auction supersedes any fallback offer that is still waiting for
  // an answer. Keep the record for audit history, but remove the buyer action.
  const pendingFallbacks = await tx
    .select({ id: auctionFallbackOffers.id, buyerId: auctionFallbackOffers.buyerId })
    .from(auctionFallbackOffers)
    .where(and(eq(auctionFallbackOffers.listingId, row.listingId), eq(auctionFallbackOffers.status, 'pending')));
  await tx
    .update(auctionFallbackOffers)
    .set({ status: 'superseded', respondedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(auctionFallbackOffers.listingId, row.listingId), eq(auctionFallbackOffers.status, 'pending')));
  for (const offer of pendingFallbacks) {
    await notify({
      tx,
      userId: offer.buyerId,
      event: 'auction_fallback_offer_expired_buyer',
      data: { listingTitle: row.listingTitle },
      linkUrl: `/listings/${row.listingId}`,
      idempotencyKey: `fallback_superseded:${row.listingId}:${offer.id}`,
    });
  }

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
  /** Skip auction runner-up promotion when the seller is at fault. */
  promoteNext?: boolean;
  /** Require the relevant deadline to have elapsed at the final mutation. */
  dueAt?: 'payment' | 'meetup' | 'seller_dropoff';
}

/**
 * End a transaction attempt unsuccessfully, record the objective facts, and either
 * hand an auction to its next bid or return a fixed-price listing to the seller.
 *
 * Automatic expiry takes a row lock before reading the state. This serializes expiry
 * with disputes and payment confirmation, while the conditional UPDATE remains a
 * second line of defence if another writer changed the row before the mutation.
 *
 * IDEMPOTENT: the conditional UPDATE means a duplicate job delivery no-ops.
 */
export async function terminateTransaction(input: TerminateInput): Promise<boolean> {
  const { tx, transactionId, reason } = input;

  // Do not read the state and then decide outside the row's lock. A dispute or payment
  // confirmation can otherwise commit between those two operations while leaving the
  // transaction rollup open.
  const locked = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .for('update')
    .limit(1);
  if (locked[0] === undefined) throw new NotFoundError('Deal not found');

  const row = await load(tx, transactionId);
  if (row.state !== 'open' || row.disputeState === 'open') return false;

  // The payment expiry handler may have read "not confirmed" before a concurrent
  // confirmation committed. Re-check the current locked row before assigning blame.
  if ((input.dueAt === 'payment' || input.dueAt === 'meetup') && row.paymentState === 'confirmed') return false;
  if (
    input.dueAt === 'seller_dropoff'
    && (row.paymentState !== 'confirmed' || row.custodyState !== 'awaiting_dropoff')
  ) return false;

  const toState = REASON_TO_STATE[reason];
  assertTransactionTransition('open', toState);

  const duePredicate = input.dueAt === 'payment' || input.dueAt === 'meetup'
    ? lte(transactions.paymentDeadlineAt, sql`now()`)
    : input.dueAt === 'seller_dropoff'
      ? lte(transactions.sellerDropoffDeadlineAt, sql`now()`)
      : undefined;
  const automaticStatePredicate = input.dueAt === undefined
    ? undefined
    : and(
      ne(transactions.disputeState, 'open'),
      eq(transactions.paymentState, row.paymentState),
    );

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
    .where(and(
      eq(transactions.id, transactionId),
      eq(transactions.state, 'open'),
      duePredicate,
      automaticStatePredicate,
    ))
    .returning({ id: transactions.id });

  if (updated.length === 0) return false; // someone else got there first

  await recordAnalyticsEvent(tx, {
    eventName: 'transaction_terminated',
    userId: input.actorUserId ?? null,
    subjectType: 'transaction',
    subjectId: transactionId,
    metadata: { listingId: row.listingId, reason, actorRole: input.actorRole },
    idempotencyKey: `transaction-terminated:${transactionId}`,
  });

  await recordTransition(tx, {
    transactionId,
    track: 'overall',
    from: 'open',
    to: toState,
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole,
    reason,
    metadata: {
      paymentStateAtTermination: row.paymentState,
      custodyStateAtTermination: row.custodyState,
      paymentDeadlineAt: row.paymentDeadlineAt.toISOString(),
      sellerDropoffDeadlineAt: row.sellerDropoffDeadlineAt?.toISOString() ?? null,
      sellerDropoffRequired: row.paymentState === 'confirmed',
    },
  });

  // A meetup no-show is not a payment-timing event. The terminal payment state still
  // records that no money was settled, but the overall no-show transition is the only
  // audit fact needed for the meetup expiry.
  if (row.paymentState !== 'confirmed' && reason !== 'buyer_no_show') {
    await recordTransition(tx, {
      transactionId,
      track: 'payment',
      from: row.paymentState,
      to: 'failed',
      actorRole: 'system',
      reason: reason === 'non_payment'
        ? 'payment deadline expired — no payment was confirmed'
        : 'deal ended before payment was confirmed',
      metadata: {
        paymentDeadlineAt: row.paymentDeadlineAt.toISOString(),
        terminationReason: reason,
      },
    });
  }

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

  // ---- close out the fixed-price claim row, if this transaction came from a claim
  if (row.claimId !== null) {
    await tx
      .update(claims)
      .set({ status: 'reneged' })
      .where(eq(claims.id, row.claimId));
  }

  // ---- notify
  if (toState === 'reneged_buyer') {
    const buyerEvent = reason === 'buyer_no_show'
      ? 'meetup_window_lapsed_buyer'
      : 'payment_window_lapsed_buyer';
    const sellerEvent = reason === 'buyer_no_show'
      ? 'meetup_window_lapsed_seller'
      : 'payment_window_lapsed_seller';
    await notify({
      tx,
      userId: row.buyerId,
      event: buyerEvent,
      data: { listingTitle: row.listingTitle },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `${reason === 'buyer_no_show' ? 'meetup' : 'payment'}_lapsed_buyer:${transactionId}`,
    });
    await notify({
      tx,
      userId: row.sellerId,
      event: sellerEvent,
      data: { listingTitle: row.listingTitle },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `${reason === 'buyer_no_show' ? 'meetup' : 'payment'}_lapsed_seller:${transactionId}`,
    });
  }
  if (toState === 'reneged_seller') {
    await notify({
      tx,
      userId: row.sellerId,
      event: 'seller_dropoff_lapsed',
      data: { listingTitle: row.listingTitle },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `lapsed_seller:${transactionId}`,
    });
    // ★ Tell the buyer to STOP, while their own payment window is still open. This is
    //   what the tx_dropoff_before_payment invariant buys us.
    await notify({
      tx,
      userId: row.buyerId,
      event: 'buyer_told_to_hold_payment',
      data: { listingTitle: row.listingTitle },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `hold_payment:${transactionId}`,
    });
  }

  const listingRows = await tx
    .select({ saleType: listings.saleType, autoRelistOnRenege: listings.autoRelistOnRenege })
    .from(listings)
    .where(eq(listings.id, row.listingId))
    .limit(1);
  const listing = listingRows[0];
  const isAuction = listing?.saleType === 'auction';

  // Fixed-price claims never promote another claimant. Auction winners still walk the bid
  // ladder when the buyer reneges, preserving the existing runner-up behavior.
  const shouldPromote = isAuction && (input.promoteNext ?? toState === 'reneged_buyer');

  // There is no open deal while the next bidder is deciding whether to accept a
  // fallback offer. Clear the pointer atomically; the acceptance path will set it
  // again when it opens the next transaction.
  if (shouldPromote) {
    await tx
      .update(listings)
      .set({ activeTransactionId: null, updatedAt: sql`now()` })
      .where(eq(listings.id, row.listingId));
  }

  // If an auction promotion is coming, custody stays with the item and is re-linked by
  // the promotion job. A fixed-price failure has no next candidate, so the item returns
  // to the seller and may be relisted according to their setting.
  await onTransactionTerminated(tx, transactionId, { candidatesRemain: shouldPromote });

  if (shouldPromote) {
    await enqueue(
      tx,
      'transaction:promote_next',
      { listingId: row.listingId, failedTransactionId: transactionId },
      { jobKey: `promote:${transactionId}` },
    );
  } else {
    await resolveListingAfterFailure(
      tx,
      row.listingId,
      !isAuction && toState === 'reneged_buyer' ? (listing?.autoRelistOnRenege ?? false) : false,
    );
  }

  return true;
}

// ---------------------------------------------------------------- promotion

/**
 * Auction runner-up promotion walks the bid ladder by amount. Fixed-price claims have
 * no fallback candidate; a failed attempt relists (or ends) the item instead.
 */
export async function promoteNextCandidate(
  tx: Tx,
  listingId: string,
  failedTransactionId: string,
): Promise<{ promoted: boolean; transactionId?: string; fallbackOfferId?: string }> {
  const listingRows = await tx.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  const listing = listingRows[0];
  if (listing === undefined) return { promoted: false };
  if (listing.saleType !== 'auction') {
    // Legacy queue jobs can still exist during rollout. Consume only a job for a
    // terminal failed attempt on a still-claimed listing; never let a stale delivery
    // relist an open deal or open a second fixed-price transaction.
    if (listing.status !== 'claimed') return { promoted: false };
    const failedRows = await tx
      .select({ listingId: transactions.listingId, state: transactions.state })
      .from(transactions)
      .where(eq(transactions.id, failedTransactionId))
      .limit(1);
    const failed = failedRows[0];
    if (failed === undefined || failed.listingId !== listingId || failed.state === 'open') {
      return { promoted: false };
    }
    const openRows = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open')))
      .limit(1);
    if (openRows[0] !== undefined) return { promoted: false };
    await resolveListingAfterFailure(tx, listingId, listing.autoRelistOnRenege);
    return { promoted: false };
  }

  // Nothing to do if a later attempt is already open (duplicate job delivery).
  const openRows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open')))
    .limit(1);
  if (openRows[0] !== undefined) return { promoted: false };

  // v1 requires an explicit acceptance step. Keep the legacy immediate-promotion
  // implementation below available behind the rollback scope for historical rows
  // and compatibility tests, but never open a buyer transaction automatically in v1.
  if (isV1Launch()) {
    const pending = await tx
      .select({ id: auctionFallbackOffers.id })
      .from(auctionFallbackOffers)
      .where(and(eq(auctionFallbackOffers.listingId, listingId), eq(auctionFallbackOffers.status, 'pending')))
      .limit(1);
    if (pending[0] !== undefined) return { promoted: false, fallbackOfferId: pending[0].id };

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
    const spentFallbacks = await tx
      .select({ buyerId: auctionFallbackOffers.buyerId })
      .from(auctionFallbackOffers)
      .where(and(
        eq(auctionFallbackOffers.listingId, listingId),
        inArray(auctionFallbackOffers.status, ['accepted', 'declined', 'expired', 'superseded']),
      ));
    for (const fallback of spentFallbacks) excluded.add(fallback.buyerId);

    const candidate = await nextFromBidLadder(tx, listingId, excluded);
    if (candidate === null) {
      await resolveListingAfterFailure(tx, listingId, listing.autoRelistOnRenege);
      return { promoted: false };
    }

    const now = await dbNow(tx);
    const expiresAt = new Date(now.getTime() + WINDOWS.auctionFallback.offerMs);
    const inserted = await tx
      .insert(auctionFallbackOffers)
      .values({
        listingId,
        bidId: candidate.bidId,
        sellerId: listing.sellerId,
        buyerId: candidate.buyerId,
        amountCents: candidate.amountCents,
        fulfillmentPath: candidate.fulfillmentPath,
        deliveryOptionId: candidate.deliveryOptionId ?? null,
        meetupLocationId: candidate.meetupLocationId ?? null,
        settlementMethod: candidate.settlementMethod ?? null,
        relayStoreId: candidate.relayStoreId ?? null,
        status: 'pending',
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: auctionFallbackOffers.id });

    const offerId = inserted[0]?.id;
    if (offerId === undefined) {
      const existing = await tx
        .select({ id: auctionFallbackOffers.id })
        .from(auctionFallbackOffers)
        .where(and(eq(auctionFallbackOffers.listingId, listingId), eq(auctionFallbackOffers.status, 'pending')))
        .limit(1);
      return { promoted: false, fallbackOfferId: existing[0]?.id };
    }

    const expiresText = expiresAt.toLocaleString('en-TT');
    await notify({
      tx,
      userId: candidate.buyerId,
      event: 'auction_fallback_offer_buyer',
      data: {
        listingTitle: listing.title,
        amount: formatMoney(candidate.amountCents),
        expiresAt: expiresText,
      },
      linkUrl: `/listings/${listingId}`,
      idempotencyKey: `fallback_offer:${offerId}:buyer`,
    });
    await notify({
      tx,
      userId: listing.sellerId,
      event: 'auction_fallback_offer_seller',
      data: {
        listingTitle: listing.title,
        amount: formatMoney(candidate.amountCents),
        expiresAt: expiresText,
      },
      linkUrl: `/listings/${listingId}`,
      idempotencyKey: `fallback_offer:${offerId}:seller`,
    });
    await tx.insert(listingAuditEvents).values({
      listingId,
      actorUserId: null,
      eventType: 'auction_fallback_offer_created',
      metadata: { offerId, bidId: candidate.bidId, buyerId: candidate.buyerId, amountCents: candidate.amountCents, expiresAt: expiresAt.toISOString() },
    });
    await enqueue(
      tx,
      'auction:fallback_expire',
      { offerId },
      { jobKey: `auction_fallback_expire:${offerId}`, runAt: expiresAt },
    );
    return { promoted: false, fallbackOfferId: offerId };
  }

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

  // ★ A promotion runs inside a JOB. Custody can refuse to open when the nominated store
  //   was deactivated (the spec's designated way to take a shop offline). That refusal
  //   must not fail the job: a retried-to-death
  //   promotion strands the listing with no open attempt and nobody notified. So each
  //   candidate is attempted in its own SAVEPOINT, and a custody refusal moves to the
  //   next candidate instead of propagating. Anything else still throws.
  for (;;) {
    const candidate = await nextFromBidLadder(tx, listingId, excluded);

    if (candidate === null) {
      await resolveListingAfterFailure(tx, listingId, listing.autoRelistOnRenege);
      return { promoted: false };
    }

    try {
      const transactionId = await tx.transaction(async (sp) => {
        const opened = await openTransaction({
          tx: sp,
          listingId,
          sellerId: listing.sellerId,
          buyerId: candidate.buyerId,
          amountCents: candidate.amountCents,
          fulfillmentPath: candidate.fulfillmentPath,
          deliveryOptionId: candidate.deliveryOptionId ?? null,
          meetupLocationId: candidate.meetupLocationId ?? null,
          source: 'auction_runner_up',
          winningBidId: candidate.bidId,
          listingTitle: listing.title,
          paymentWindowHours: listing.paymentWindowHours,
          settlementMethod: candidate.settlementMethod,
          commitmentAcknowledged: true,
          relayStoreId: candidate.relayStoreId ?? null,
        });

        // A runner-up gets a distinct notification: they were not expecting this, and
        // their payment clock starts when the promotion opens.
        await notify({
          tx: sp,
          userId: candidate.buyerId,
          event: 'auction_runner_up_buyer',
          data: { listingTitle: listing.title, fulfillmentPath: candidate.fulfillmentPath },
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
      if (isOpenTransactionCollision(error)) {
        // Another delivery won the one-open-attempt race. Its transaction is now the
        // authoritative promotion, so this delivery has nothing left to do.
        return { promoted: false };
      }
      if (!(error instanceof CustodyConflictError) && !(error instanceof MarketplaceEligibilityError)) throw error;
      // Everything this candidate wrote has been rolled back to the savepoint.
      console.warn(
        `[promote] listing ${listingId}: candidate ${candidate.buyerId} could not take ` +
          `custody (${error.message}) — trying the next one`,
      );
      excluded.add(candidate.buyerId);
    }
  }
}

/** Accept a pending auction fallback offer and open exactly one transaction. */
export async function acceptAuctionFallbackOffer(
  tx: Tx,
  offerId: string,
  buyerId: string,
): Promise<{ transactionId: string }> {
  const now = await dbNow(tx);
  const accepted = await tx
    .update(auctionFallbackOffers)
    .set({ status: 'accepted', respondedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      eq(auctionFallbackOffers.id, offerId),
      eq(auctionFallbackOffers.buyerId, buyerId),
      eq(auctionFallbackOffers.status, 'pending'),
      gt(auctionFallbackOffers.expiresAt, now),
    ))
    .returning();
  const offer = accepted[0];
  if (offer === undefined) {
    const existing = await tx
      .select({ buyerId: auctionFallbackOffers.buyerId, status: auctionFallbackOffers.status, expiresAt: auctionFallbackOffers.expiresAt })
      .from(auctionFallbackOffers)
      .where(eq(auctionFallbackOffers.id, offerId))
      .limit(1);
    if (existing[0]?.buyerId !== buyerId) throw new ForbiddenError('This fallback offer is not addressed to you');
    throw new ConflictError(
      existing[0]?.status === 'pending' ? 'This fallback offer has expired' : 'This fallback offer is no longer available',
      existing[0]?.status === 'pending' ? 'fallback_offer_expired' : 'fallback_offer_closed',
    );
  }

  const listingRows = await tx.select().from(listings).where(eq(listings.id, offer.listingId)).limit(1);
  const listing = listingRows[0];
  if (listing === undefined || listing.saleType !== 'auction') {
    throw new ConflictError('This auction is no longer available');
  }
  const openRows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.listingId, offer.listingId), eq(transactions.state, 'open')))
    .limit(1);
  if (openRows[0] !== undefined) throw new ConflictError('This auction already has an active buyer');

  try {
    const opened = await openTransaction({
      tx,
      listingId: offer.listingId,
      sellerId: offer.sellerId,
      buyerId: offer.buyerId,
      amountCents: offer.amountCents,
      fulfillmentPath: offer.fulfillmentPath,
      deliveryOptionId: offer.deliveryOptionId,
      meetupLocationId: offer.meetupLocationId,
      source: 'auction_runner_up',
      winningBidId: offer.bidId,
      listingTitle: listing.title,
      paymentWindowHours: listing.paymentWindowHours,
      settlementMethod: offer.settlementMethod,
      commitmentAcknowledged: true,
      relayStoreId: offer.relayStoreId,
    });
    await tx
      .update(auctionFallbackOffers)
      .set({ transactionId: opened.id, updatedAt: sql`now()` })
      .where(eq(auctionFallbackOffers.id, offer.id));
    await tx.update(bids).set({ status: 'won' }).where(eq(bids.id, offer.bidId));
    await tx.insert(listingAuditEvents).values({
      listingId: offer.listingId,
      actorUserId: buyerId,
      eventType: 'auction_fallback_offer_accepted',
      metadata: { offerId: offer.id, transactionId: opened.id, bidId: offer.bidId },
    });
    return { transactionId: opened.id };
  } catch (error) {
    // If opening failed after the offer was marked accepted, roll the offer back
    // so the buyer can retry (the surrounding transaction will normally do this).
    throw error;
  }
}

/** Expire one fallback offer and immediately offer the item to the next bidder. */
export async function expireAuctionFallbackOffer(
  tx: Tx,
  offerId: string,
): Promise<{ expired: boolean; nextOfferId?: string }> {
  const now = await dbNow(tx);
  const expired = await tx
    .update(auctionFallbackOffers)
    .set({ status: 'expired', respondedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      eq(auctionFallbackOffers.id, offerId),
      eq(auctionFallbackOffers.status, 'pending'),
      lt(auctionFallbackOffers.expiresAt, now),
    ))
    .returning({ id: auctionFallbackOffers.id, listingId: auctionFallbackOffers.listingId, buyerId: auctionFallbackOffers.buyerId });
  const offer = expired[0];
  if (offer === undefined) return { expired: false };

  const listingRows = await tx.select({ title: listings.title }).from(listings).where(eq(listings.id, offer.listingId)).limit(1);
  await notify({
    tx,
    userId: offer.buyerId,
    event: 'auction_fallback_offer_expired_buyer',
    data: { listingTitle: listingRows[0]?.title ?? 'the auction' },
    linkUrl: `/listings/${offer.listingId}`,
    idempotencyKey: `fallback_expired:${offer.id}`,
  });
  const next = await promoteNextCandidate(tx, offer.listingId, offer.id);
  return { expired: true, nextOfferId: next.fallbackOfferId };
}

/**
 * Invalidate one auction bid from the admin console. The bid is never deleted;
 * the ladder is recomputed from non-void bids and a winning transaction is
 * terminated before the next fallback offer is generated.
 */
export async function invalidateAuctionBid(
  tx: Tx,
  input: { bidId: string; adminUserId: string; reason: string },
): Promise<{ changed: boolean; listingId?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new ConflictError('A bid invalidation reason of 10–500 characters is required', 'admin_reason_required');
  }
  const rows = await tx
    .select({ bid: bids, listing: listings })
    .from(bids)
    .innerJoin(listings, eq(listings.id, bids.listingId))
    .where(eq(bids.id, input.bidId))
    .limit(1);
  const current = rows[0];
  if (current === undefined) throw new NotFoundError('Bid not found');
  const before = {
    status: current.bid.status,
    amountCents: current.bid.amountCents,
    bidderId: current.bid.bidderId,
    listingId: current.bid.listingId,
  };
  if (current.bid.status === 'void' || current.bid.status === 'retracted') {
    await recordAdminAudit(tx, {
      actorUserId: input.adminUserId,
      targetType: 'bid',
      targetId: input.bidId,
      action: 'invalidate_bid',
      reason,
      outcome: 'rejected',
      beforeContext: before,
      afterContext: before,
      requestMetadata: { source: 'admin_ui', rejection: 'already_invalid' },
    });
    return { changed: false, listingId: current.bid.listingId };
  }

  const updated = await tx
    .update(bids)
    .set({ status: 'void' })
    .where(and(eq(bids.id, input.bidId), ne(bids.status, 'void'), ne(bids.status, 'retracted')))
    .returning({ id: bids.id });
  if (updated.length === 0) return { changed: false, listingId: current.bid.listingId };

  await tx
    .update(listings)
    .set({
      currentBidCents: sql`(
        select amount_cents from bids
        where listing_id = ${current.bid.listingId}
          and status not in ('void', 'retracted')
        order by amount_cents desc
        limit 1
      )`,
      currentBidId: sql`(
        select id from bids
        where listing_id = ${current.bid.listingId}
          and status not in ('void', 'retracted')
        order by amount_cents desc
        limit 1
      )`,
      bidCount: sql`(
        select count(*)::int from bids
        where listing_id = ${current.bid.listingId}
          and status not in ('void', 'retracted')
      )`,
      updatedAt: sql`now()`,
    })
    .where(eq(listings.id, current.bid.listingId));

  const openRows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.listingId, current.bid.listingId), eq(transactions.winningBidId, input.bidId), eq(transactions.state, 'open')))
    .limit(1);
  if (openRows[0] !== undefined) {
    await terminateTransaction({
      tx,
      transactionId: openRows[0].id,
      reason: 'admin',
      actorRole: 'admin',
      actorUserId: input.adminUserId,
      promoteNext: true,
    });
  } else {
    const fallbackRows = await tx
      .select({ id: auctionFallbackOffers.id })
      .from(auctionFallbackOffers)
      .where(and(eq(auctionFallbackOffers.bidId, input.bidId), eq(auctionFallbackOffers.status, 'pending')))
      .limit(1);
    if (fallbackRows[0] !== undefined) {
      await tx.update(auctionFallbackOffers).set({ status: 'declined', respondedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(auctionFallbackOffers.id, fallbackRows[0].id));
      await promoteNextCandidate(tx, current.bid.listingId, input.bidId);
    }
  }

  await notify({
    tx,
    userId: current.bid.bidderId,
    event: 'auction_bid_invalidated_buyer',
    data: {
      listingTitle: current.listing.title,
      amount: formatMoney(current.bid.amountCents),
      reason,
    },
    linkUrl: `/listings/${current.bid.listingId}`,
    idempotencyKey: `bid_invalidated:${input.bidId}`,
  });
  await recordAdminAudit(tx, {
    actorUserId: input.adminUserId,
    targetType: 'bid',
    targetId: input.bidId,
    action: 'invalidate_bid',
    reason,
    beforeContext: before,
    afterContext: { ...before, status: 'void' },
    requestMetadata: { source: 'admin_ui' },
  });
  return { changed: true, listingId: current.bid.listingId };
}

interface Candidate {
  buyerId: string;
  amountCents: number;
  fulfillmentPath: FulfillmentPath;
  deliveryOptionId?: string | null;
  meetupLocationId?: string | null;
  /** The candidate's own payment choice, retained through promotion. */
  settlementMethod?: SettlementMethod | null;
  /** The runner-up's own store choice, not the winner's. */
  relayStoreId?: string | null;
  bidId: string;
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
    .select({
      paths: listings.fulfillmentPaths,
      reserve: listings.reserveCents,
      settlementMethods: listings.settlementMethods,
    })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  const listing = listingRows[0];
  if (listing === undefined) return null;

  for (const row of rows) {
    if (excluded.has(row.bidderId)) continue;
    // A runner-up owes their OWN bid, not the winner's — and only if it clears reserve.
    if (!isV1Launch() && listing.reserve !== null && row.amountCents < listing.reserve) return null;
    return {
      buyerId: row.bidderId,
      amountCents: row.amountCents,
      // ★ The bidder's OWN choice. Falls back to the first store-free declared path
      //   only for bids placed before
      //   Phase 2, which carry neither a path nor a store — see fallbackFulfillmentPath.
      fulfillmentPath: row.fulfillmentPath ?? fallbackFulfillmentPath(listing.paths),
      deliveryOptionId: row.deliveryOptionId,
      meetupLocationId: row.meetupLocationId,
      settlementMethod:
        (row.settlementMethod as SettlementMethod | null) ??
        (listing.settlementMethods[0] as SettlementMethod | undefined),
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
  const listingMeta = await tx
    .select({ saleType: listings.saleType })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  const saleType = listingMeta[0]?.saleType;
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
    try {
      await returnToSeller({
        tx,
        holdingId: strandedHolding.id,
        actorUserId: '',
        actorRole: 'system',
        reason: 'no remaining buyers — unpaid item returns to the seller',
      });
    } catch (error) {
      if (!(error instanceof CustodyConflictError)) throw error;

      // A duplicate promotion can read the same live holding before the first
      // delivery returns it. Re-check after the conflict; if it is no longer live,
      // the other delivery already completed this transition.
      const stillStranded = await tx
        .select({ id: custodyHoldings.id })
        .from(custodyHoldings)
        .where(
          and(
            eq(custodyHoldings.id, strandedHolding.id),
            sql`${custodyHoldings.state} in ('at_relay', 'release_authorized')`,
          ),
        )
        .limit(1);
      if (stillStranded[0] !== undefined) throw error;
    }
  }

  // An auction has no safe "relisted" state: its authoritative close time has
  // already passed and a fresh auction must be a new draft. v1 therefore ends an
  // exhausted auction as expired, while fixed-price rows retain seller auto-relist.
  const status = isV1Launch() && saleType === 'auction'
    ? 'expired'
    : statusAfterFailedAttempt({ hasRemainingCandidates: false, autoRelistOnRenege: autoRelist });

  await tx
    .update(listings)
    .set({
      status,
      activeTransactionId: null,
      resolvedAt: status === 'active' ? null : sql`now()`,
      // A relisted straight sale starts a fresh, winner-only claim attempt.
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
  handoffState: HandoffState;
  disputeState: (typeof transactions.$inferSelect)['disputeState'];
  handedOverAt: Date | null;
  receivedAt: Date | null;
  receiptDeadlineAt: Date | null;
  fulfillmentPath: FulfillmentPath;
  meetupLocationId: string | null;
  settlementMethod: string | null;
  amountCents: number;
  paymentDeadlineAt: Date;
  sellerDropoffDeadlineAt: Date | null;
  claimId: string | null;
  offerId: string | null;
}

/**
 * Re-arm deadline jobs after support resumes an open transaction. Jobs may have been
 * consumed while a dispute was open, so the resume transition must restore work from
 * the transaction's current tracks and clocks in the same database transaction.
 */
export async function rescheduleTransactionDeadlineJobs(
  tx: Tx,
  transaction: Pick<
    LoadedTransaction,
    | 'id'
    | 'paymentState'
    | 'paymentDeadlineAt'
    | 'sellerDropoffDeadlineAt'
    | 'custodyState'
    | 'fulfillmentPath'
    | 'handoffState'
    | 'receiptDeadlineAt'
  >,
): Promise<void> {
  if (transaction.paymentState !== 'confirmed') {
    await enqueue(
      tx,
      'transaction:payment_window',
      { transactionId: transaction.id },
      { jobKey: `payment_window:${transaction.id}`, runAt: transaction.paymentDeadlineAt },
    );
  }

  if (
    transaction.paymentState === 'confirmed'
    && transaction.custodyState === 'awaiting_dropoff'
    && transaction.sellerDropoffDeadlineAt !== null
  ) {
    await enqueue(
      tx,
      'transaction:dropoff_window',
      { transactionId: transaction.id },
      { jobKey: `dropoff_window:${transaction.id}`, runAt: transaction.sellerDropoffDeadlineAt },
    );
  }

  if (
    transaction.fulfillmentPath === 'cash_meetup'
    && transaction.paymentState === 'confirmed'
    && transaction.handoffState === 'seller_handed_over'
    && transaction.receiptDeadlineAt !== null
  ) {
    await enqueue(
      tx,
      'transaction:receipt_window',
      { transactionId: transaction.id },
      { jobKey: `receipt_window:${transaction.id}`, runAt: transaction.receiptDeadlineAt },
    );
  }
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
    handoffState: row.t.handoffState,
    disputeState: row.t.disputeState,
    handedOverAt: row.t.handedOverAt,
    receivedAt: row.t.receivedAt,
    receiptDeadlineAt: row.t.receiptDeadlineAt,
    fulfillmentPath: row.t.fulfillmentPath,
    meetupLocationId: row.t.meetupLocationId,
    settlementMethod: row.t.settlementMethod,
    amountCents: row.t.amountCents,
    paymentDeadlineAt: row.t.paymentDeadlineAt,
    sellerDropoffDeadlineAt: row.t.sellerDropoffDeadlineAt,
    claimId: row.t.claimId,
    offerId: row.t.offerId,
  };
}

export { load as loadTransaction, isFailedTransactionState };

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {
  readonly code: string;

  constructor(message: string, code = 'conflict') {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}
