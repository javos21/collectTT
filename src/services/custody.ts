/**
 * THE custody track. The physical half of a deal.
 *
 * ★ THIS MODULE IS THE ONLY WRITER of `custody_holdings.state` and of the
 *   `transactions.custody_state` mirror. Both are written in the SAME DB transaction,
 *   every time, so the `tx_completion_requires_both` CHECK can be a real database
 *   constraint rather than a convention. The nightly `consistency:check` job asserts
 *   the mirror has not drifted — belt and suspenders, because this is the one
 *   subsystem where being wrong costs somebody their item.
 *
 * ★ CUSTODY FOLLOWS THE ITEM, PAYMENT FOLLOWS THE TRANSACTION. A holding belongs to a
 *   LISTING. When a buyer reneges and a backup is promoted, the item does not move —
 *   the holding just re-links to the new transaction attempt.
 */

import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '../db/client';
import { custodyHoldings, relayStores, relayStoreStaff } from '../db/schema/custody';
import { transactions, transactionEvents } from '../db/schema/transactions';
import { listings } from '../db/schema/listings';
import { profiles } from '../db/schema/profiles';
import { enqueue } from '../jobs/enqueue';
import { notify } from '../notifications/dispatch';
import { custodyExpiry } from '../domain/policy/windows';
import { checkEligibility } from '../domain/policy/eligibility';
import { generateDropoffCode } from '../domain/dropoff-code';
import {
  assertCustodyTransition,
  canActorTransitionCustody,
  isLiveCustodyState,
  type CustodyState,
} from '../domain/states/custody';
import type { ActorRole } from '../domain/states/actors';
import type { FulfillmentPath } from '../domain/states/transaction';
import type { SizeClass } from '../domain/states/listing';

/** How many drop-off codes we will draw before giving up on finding a free one. */
const DROPOFF_CODE_ATTEMPTS = 5;

/**
 * Was this a collision on the drop-off code specifically? Drizzle wraps driver errors,
 * so the pg fields can be one `cause` down. Deliberately narrow: the OTHER unique
 * index on this table (one live holding per listing) must never be retried away.
 */
function isDropoffCodeCollision(error: unknown): boolean {
  for (let e: unknown = error; e !== null && e !== undefined; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint?.includes('dropoff_code') === true) return true;
  }
  return false;
}

export class CustodyError extends Error {}
export class CustodyForbiddenError extends CustodyError {}
export class CustodyConflictError extends CustodyError {}

// ════════════════════════════════════════════════════════ opening a holding

export interface OpenHoldingInput {
  tx: Tx;
  listingId: string;
  transactionId: string;
  path: Extract<FulfillmentPath, 'relay' | 'full_service'>;
  sizeClass: SizeClass;
  /** Required for the relay rail; null routes to our own courier. */
  storeId: string | null;
}

/**
 * Create (or re-link) the holding for a custody-path transaction.
 *
 * Called from `openTransaction`. If a live holding already exists for this listing —
 * the promotion case, where the item is already on the shelf — it is re-linked to the
 * new transaction rather than duplicated. The partial unique index makes duplicating
 * it impossible anyway; this is the graceful half of that guarantee.
 */
export async function openOrRelinkHolding(input: OpenHoldingInput): Promise<{
  holdingId: string;
  state: CustodyState;
}> {
  const { tx } = input;

  const existing = await liveHoldingForListing(tx, input.listingId);

  if (existing !== undefined) {
    // ★ The item is already in custody. Re-link, do not move it.
    await tx
      .update(custodyHoldings)
      .set({ currentTransactionId: input.transactionId, updatedAt: sql`now()` })
      .where(eq(custodyHoldings.id, existing.id));

    await mirrorToTransaction(tx, input.transactionId, existing.state, {
      holdingId: existing.id,
      storeId: existing.storeId,
    });

    // The new buyer has not paid, so the tighter unpaid clock applies again.
    await recomputeShelfClock(tx, existing.id);

    return { holdingId: existing.id, state: existing.state };
  }

  if (input.path === 'relay') {
    if (input.storeId === null) {
      throw new CustodyConflictError('A relay drop-off needs a store');
    }
    const store = await loadStore(tx, input.storeId);
    const eligibility = checkEligibility({
      path: 'relay',
      sizeClass: input.sizeClass,
      storeAcceptedSizes: store.acceptsSizeClasses,
    });
    if (!eligibility.eligible) throw new CustodyConflictError(eligibility.reasons.join(' '));
  }

  // ★ Retry on the unique index rather than pre-checking. 31^4 codes against a few
  //   dozen live holdings makes a collision rare; a retry makes it a non-event, and a
  //   pre-check would still race. Each attempt runs in its own SAVEPOINT because a
  //   failed INSERT aborts the enclosing transaction outright — without one, the
  //   second attempt dies on 25P02 instead of retrying.
  let inserted: Array<{ id: string }> = [];
  for (let attempt = 0; attempt < DROPOFF_CODE_ATTEMPTS; attempt += 1) {
    try {
      inserted = await tx.transaction((sp) =>
        sp
          .insert(custodyHoldings)
          .values({
            listingId: input.listingId,
            currentTransactionId: input.transactionId,
            holder: input.path === 'relay' ? 'relay_store' : 'platform_courier',
            storeId: input.path === 'relay' ? input.storeId : null,
            state: 'awaiting_dropoff',
            sizeClass: input.sizeClass,
            dropoffCode: generateDropoffCode(),
          })
          .returning({ id: custodyHoldings.id }),
      );
      break;
    } catch (error) {
      if (!isDropoffCodeCollision(error) || attempt === DROPOFF_CODE_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  const holding = inserted[0];
  if (holding === undefined) throw new CustodyError('Failed to open custody holding');

  await mirrorToTransaction(tx, input.transactionId, 'awaiting_dropoff', {
    holdingId: holding.id,
    storeId: input.path === 'relay' ? input.storeId : null,
  });

  return { holdingId: holding.id, state: 'awaiting_dropoff' };
}

// ════════════════════════════════════════════════════════ the store's actions

export interface StoreActionInput {
  tx: Tx;
  holdingId: string;
  actorUserId: string;
  actorRole?: ActorRole;
}

/** Store marks an item received. This is the moment it becomes the store's problem. */
export async function markReceived(input: StoreActionInput): Promise<void> {
  const holding = await loadHolding(input.tx, input.holdingId);
  await assertStoreAuthority(input.tx, holding, input.actorUserId, input.actorRole);
  assertActor('awaiting_dropoff', 'at_relay', input.actorRole ?? 'store');
  assertCustodyTransition(holding.state, 'at_relay');

  const updated = await input.tx
    .update(custodyHoldings)
    .set({
      state: 'at_relay',
      droppedOffAt: sql`now()`,
      receivedByUserId: input.actorUserId,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(custodyHoldings.id, input.holdingId), eq(custodyHoldings.state, 'awaiting_dropoff')),
    )
    .returning({ id: custodyHoldings.id });

  if (updated.length === 0) throw new CustodyConflictError('This item has already been received');

  await afterCustodyChange(input.tx, input.holdingId, 'awaiting_dropoff', 'at_relay', {
    actorUserId: input.actorUserId,
    actorRole: input.actorRole ?? 'store',
  });

  await recomputeShelfClock(input.tx, input.holdingId);

  const ctx = await holdingContext(input.tx, input.holdingId);
  if (ctx !== null && ctx.buyerId !== null) {
    await notify({
      tx: input.tx,
      userId: ctx.buyerId,
      event: 'custody_received_buyer',
      data: { listingTitle: ctx.listingTitle, storeName: ctx.storeName },
      linkUrl: `/deals/${ctx.transactionId}`,
      idempotencyKey: `custody_received:${input.holdingId}`,
    });
  }
}

/**
 * ★ THE ONE CROSS-TRACK GATE IN THE ENTIRE SYSTEM.
 *
 * Delegates to the atomic SQL in src/db/atomic/authorize-release.ts, which checks
 * `payment_state = 'confirmed'` inside the same statement that flips the state. There
 * is no code path — none — that releases an unpaid item.
 */
export async function authorizeRelease(input: StoreActionInput): Promise<void> {
  const { authorizeReleaseAtomic } = await import('../db/atomic/authorize-release');
  await authorizeReleaseAtomic(input);
}

/** Buyer physically collected it. This is what completes a custody-path deal. */
export async function markPickedUp(input: StoreActionInput): Promise<void> {
  const holding = await loadHolding(input.tx, input.holdingId);
  await assertStoreAuthority(input.tx, holding, input.actorUserId, input.actorRole);
  assertActor('release_authorized', 'picked_up', input.actorRole ?? 'store');
  assertCustodyTransition(holding.state, 'picked_up');

  const updated = await input.tx
    .update(custodyHoldings)
    .set({ state: 'picked_up', pickedUpAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(custodyHoldings.id, input.holdingId),
        eq(custodyHoldings.state, 'release_authorized'),
      ),
    )
    .returning({ id: custodyHoldings.id });

  if (updated.length === 0) {
    throw new CustodyConflictError('This item is not cleared for collection');
  }

  await afterCustodyChange(input.tx, input.holdingId, 'release_authorized', 'picked_up', {
    actorUserId: input.actorUserId,
    actorRole: input.actorRole ?? 'store',
  });

  // Both tracks may now be done. completeIfBothTracksDone is the only thing that
  // decides that, and it re-reads state rather than trusting this caller.
  const holdingNow = await loadHolding(input.tx, input.holdingId);
  if (holdingNow.currentTransactionId !== null) {
    const { completeIfBothTracksDone } = await import('./transactions');
    await completeIfBothTracksDone(input.tx, holdingNow.currentTransactionId);
  }
}

/**
 * Return-to-seller. The answer to "never let an unpaid item become the store's
 * problem." Reachable from at_relay and release_authorized, by the store or by the
 * system when a deal terminates with the item still on the shelf and nobody left to
 * hand it to.
 */
export async function returnToSeller(input: StoreActionInput & { reason?: string }): Promise<void> {
  const holding = await loadHolding(input.tx, input.holdingId);
  const actorRole = input.actorRole ?? 'store';
  if (actorRole === 'store') {
    await assertStoreAuthority(input.tx, holding, input.actorUserId, actorRole);
  }
  assertCustodyTransition(holding.state, 'returned_to_seller');

  const updated = await input.tx
    .update(custodyHoldings)
    .set({ state: 'returned_to_seller', returnedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(custodyHoldings.id, input.holdingId),
        sql`${custodyHoldings.state} in ('at_relay', 'release_authorized')`,
      ),
    )
    .returning({ id: custodyHoldings.id });

  if (updated.length === 0) throw new CustodyConflictError('This item is not on the shelf');

  await afterCustodyChange(input.tx, input.holdingId, holding.state, 'returned_to_seller', {
    actorUserId: input.actorUserId,
    actorRole,
    reason: input.reason ?? 'returned to seller',
  });

  const ctx = await holdingContext(input.tx, input.holdingId);
  if (ctx !== null) {
    await notify({
      tx: input.tx,
      userId: ctx.sellerId,
      event: 'custody_return_to_seller',
      data: { listingTitle: ctx.listingTitle, storeName: ctx.storeName },
      linkUrl: `/listings/${ctx.listingId}`,
      idempotencyKey: `custody_return:${input.holdingId}`,
    });
  }
}

/** The seller never turned up. Voids the holding so the shelf slot is freed. */
export async function voidHolding(tx: Tx, holdingId: string, reason: string): Promise<void> {
  const holding = await loadHolding(tx, holdingId);
  if (holding.state !== 'awaiting_dropoff') return; // nothing was ever dropped off
  assertCustodyTransition('awaiting_dropoff', 'voided');

  const updated = await tx
    .update(custodyHoldings)
    .set({ state: 'voided', updatedAt: sql`now()` })
    .where(and(eq(custodyHoldings.id, holdingId), eq(custodyHoldings.state, 'awaiting_dropoff')))
    .returning({ id: custodyHoldings.id });

  if (updated.length === 0) return;

  await afterCustodyChange(tx, holdingId, 'awaiting_dropoff', 'voided', {
    actorRole: 'system',
    reason,
  });
}

// ════════════════════════════════════════════════════════ clocks

/**
 * Recompute the shelf clock. Called on drop-off, on payment confirmation, and on
 * re-link. Confirming payment EXTENDS the clock — the right incentive, since an unpaid
 * item is pure liability for the store and gets the tighter deadline.
 */
export async function recomputeShelfClock(tx: Tx, holdingId: string): Promise<Date | null> {
  const rows = await tx
    .select({
      h: custodyHoldings,
      paidDays: relayStores.paidCustodyDays,
      unpaidDays: relayStores.unpaidCustodyDays,
      paymentState: transactions.paymentState,
      paymentConfirmedAt: transactions.paymentConfirmedAt,
    })
    .from(custodyHoldings)
    .leftJoin(relayStores, eq(relayStores.id, custodyHoldings.storeId))
    .leftJoin(transactions, eq(transactions.id, custodyHoldings.currentTransactionId))
    .where(eq(custodyHoldings.id, holdingId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  if (row.h.droppedOffAt === null) return null; // the clock starts at drop-off
  if (!isLiveCustodyState(row.h.state)) return null;

  const paid = row.paymentState === 'confirmed';
  const expiresAt = custodyExpiry({
    paid,
    droppedOffAt: row.h.droppedOffAt,
    paymentConfirmedAt: row.paymentConfirmedAt,
    ...(row.paidDays !== null ? { paidDays: row.paidDays } : {}),
    ...(row.unpaidDays !== null ? { unpaidDays: row.unpaidDays } : {}),
  });

  await tx
    .update(custodyHoldings)
    .set({
      custodyExpiresAt: expiresAt,
      // A recomputed clock re-arms the flag: an item flagged on the tight unpaid clock
      // is no longer overstayed once payment lands and the clock extends past now.
      overstayFlaggedAt: expiresAt.getTime() > Date.now() ? null : row.h.overstayFlaggedAt,
      updatedAt: sql`now()`,
    })
    .where(eq(custodyHoldings.id, holdingId));

  // ★ Same DB transaction as the clock change, so the sweeper can never be forgotten.
  await enqueue(
    tx,
    'custody:overstay',
    { holdingId },
    { jobKey: `custody_overstay:${holdingId}`, runAt: expiresAt },
  );

  return expiresAt;
}

/**
 * Payment just settled. Extend the shelf clock and, if the item is already on the
 * shelf, tell the buyer it is collectable. Called from `confirmPayment`.
 */
export async function onPaymentConfirmed(tx: Tx, transactionId: string): Promise<void> {
  const holding = await liveHoldingForTransaction(tx, transactionId);
  if (holding === undefined) return;

  await recomputeShelfClock(tx, holding.id);

  if (holding.state !== 'at_relay') return;

  const ctx = await holdingContext(tx, holding.id);
  if (ctx === null || ctx.buyerId === null) return;

  await notify({
    tx,
    userId: ctx.buyerId,
    event: 'custody_ready_for_pickup',
    data: { listingTitle: ctx.listingTitle, storeName: ctx.storeName },
    linkUrl: `/deals/${transactionId}`,
    idempotencyKey: `custody_ready:${holding.id}:${transactionId}`,
  });
}

/**
 * A transaction terminated. Decide what happens to the item, if it is in custody.
 * Called from `terminateTransaction`.
 *
 *   - never dropped off        -> void the holding, free the shelf slot
 *   - on the shelf, candidates -> leave it exactly where it is; promotion re-links it
 *   - on the shelf, none left  -> return to seller
 */
export async function onTransactionTerminated(
  tx: Tx,
  transactionId: string,
  opts: { candidatesRemain: boolean },
): Promise<void> {
  const holding = await liveHoldingForTransaction(tx, transactionId);
  if (holding === undefined) return;

  if (holding.state === 'awaiting_dropoff') {
    await voidHolding(tx, holding.id, 'transaction terminated before drop-off');
    return;
  }

  if (opts.candidatesRemain) {
    // ★ The item stays exactly where it is. promoteNextCandidate re-links the holding.
    await tx
      .update(custodyHoldings)
      .set({ currentTransactionId: null, updatedAt: sql`now()` })
      .where(eq(custodyHoldings.id, holding.id));
    return;
  }

  await returnToSeller({
    tx,
    holdingId: holding.id,
    actorUserId: '',
    actorRole: 'system',
    reason: 'no remaining buyers — unpaid item returns to the seller',
  });
}

// ════════════════════════════════════════════════════════ store board reads

export interface StoreBoardRow {
  holdingId: string;
  listingId: string;
  listingTitle: string;
  sizeClass: SizeClass;
  state: CustodyState;
  sellerName: string;
  buyerName: string | null;
  paid: boolean;
  droppedOffAt: Date | null;
  custodyExpiresAt: Date | null;
  overstayFlaggedAt: Date | null;
  transactionId: string | null;
  daysHeld: number | null;
}

/**
 * The store's audit/control log. This IS the product for stores — given away free,
 * because their pain is abuse (bulky items, indefinite storage, no idea what is paid),
 * not a missing fee.
 */
export async function storeBoard(tx: Tx, storeId: string): Promise<StoreBoardRow[]> {
  const rows = await tx
    .select({
      h: custodyHoldings,
      listingTitle: listings.title,
      sellerName: profiles.displayName,
      paymentState: transactions.paymentState,
      buyerId: transactions.buyerId,
      transactionId: transactions.id,
    })
    .from(custodyHoldings)
    .innerJoin(listings, eq(listings.id, custodyHoldings.listingId))
    .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
    .leftJoin(transactions, eq(transactions.id, custodyHoldings.currentTransactionId))
    .where(eq(custodyHoldings.storeId, storeId))
    .orderBy(sql`
      case ${custodyHoldings.state}
        when 'at_relay' then 0
        when 'release_authorized' then 1
        when 'awaiting_dropoff' then 2
        else 3 end,
      ${custodyHoldings.custodyExpiresAt} asc nulls last
    `);

  const buyerIds = rows.map((r) => r.buyerId).filter((id): id is string => id !== null);
  const buyerNames = new Map<string, string>();
  if (buyerIds.length > 0) {
    const names = await tx
      .select({ id: profiles.userId, name: profiles.displayName })
      .from(profiles)
      .where(sql`${profiles.userId} = any(${buyerIds})`);
    for (const n of names) buyerNames.set(n.id, n.name);
  }

  const now = Date.now();
  return rows.map((r) => ({
    holdingId: r.h.id,
    listingId: r.h.listingId,
    listingTitle: r.listingTitle,
    sizeClass: r.h.sizeClass,
    state: r.h.state,
    sellerName: r.sellerName,
    buyerName: r.buyerId === null ? null : (buyerNames.get(r.buyerId) ?? null),
    paid: r.paymentState === 'confirmed',
    droppedOffAt: r.h.droppedOffAt,
    custodyExpiresAt: r.h.custodyExpiresAt,
    overstayFlaggedAt: r.h.overstayFlaggedAt,
    transactionId: r.transactionId,
    daysHeld:
      r.h.droppedOffAt === null
        ? null
        : Math.floor((now - r.h.droppedOffAt.getTime()) / (24 * 60 * 60 * 1000)),
  }));
}

/** Stores this user may act for. An empty array means they are not store staff. */
export async function storesForStaff(
  tx: Tx,
  userId: string,
): Promise<Array<{ id: string; name: string; role: string }>> {
  return tx
    .select({ id: relayStores.id, name: relayStores.name, role: relayStoreStaff.role })
    .from(relayStoreStaff)
    .innerJoin(relayStores, eq(relayStores.id, relayStoreStaff.storeId))
    .where(eq(relayStoreStaff.userId, userId));
}

export async function activeStores(tx: Tx) {
  return tx
    .select()
    .from(relayStores)
    .where(eq(relayStores.active, true))
    .orderBy(relayStores.name);
}

// ════════════════════════════════════════════════════════ internals

type Holding = typeof custodyHoldings.$inferSelect;

export async function loadHolding(tx: Tx, holdingId: string): Promise<Holding> {
  const rows = await tx
    .select()
    .from(custodyHoldings)
    .where(eq(custodyHoldings.id, holdingId))
    .limit(1);
  const holding = rows[0];
  if (holding === undefined) throw new CustodyError('Custody record not found');
  return holding;
}

async function liveHoldingForListing(tx: Tx, listingId: string): Promise<Holding | undefined> {
  const rows = await tx
    .select()
    .from(custodyHoldings)
    .where(
      and(
        eq(custodyHoldings.listingId, listingId),
        sql`${custodyHoldings.state} not in ('picked_up', 'returned_to_seller', 'voided')`,
      ),
    )
    .limit(1);
  return rows[0];
}

async function liveHoldingForTransaction(
  tx: Tx,
  transactionId: string,
): Promise<Holding | undefined> {
  const rows = await tx
    .select()
    .from(custodyHoldings)
    .where(
      and(
        eq(custodyHoldings.currentTransactionId, transactionId),
        sql`${custodyHoldings.state} not in ('picked_up', 'returned_to_seller', 'voided')`,
      ),
    )
    .limit(1);
  return rows[0];
}

async function loadStore(tx: Tx, storeId: string) {
  const rows = await tx.select().from(relayStores).where(eq(relayStores.id, storeId)).limit(1);
  const store = rows[0];
  if (store === undefined) throw new CustodyConflictError('Store not found');
  if (!store.active) throw new CustodyConflictError('That store is not currently accepting items');
  return store;
}

/** Only staff of the holding's own store may act on it. Admins may act anywhere. */
async function assertStoreAuthority(
  tx: Tx,
  holding: Holding,
  userId: string,
  actorRole?: ActorRole,
): Promise<void> {
  if (actorRole === 'admin' || actorRole === 'system') return;
  if (holding.storeId === null) {
    throw new CustodyForbiddenError('This item is with the delivery team, not a store');
  }
  const rows = await tx
    .select({ role: relayStoreStaff.role })
    .from(relayStoreStaff)
    .where(and(eq(relayStoreStaff.storeId, holding.storeId), eq(relayStoreStaff.userId, userId)))
    .limit(1);
  if (rows[0] === undefined) {
    throw new CustodyForbiddenError('You are not staff at the store holding this item');
  }
}

function assertActor(from: CustodyState, to: CustodyState, actor: ActorRole): void {
  if (!canActorTransitionCustody(from, to, actor)) {
    throw new CustodyForbiddenError(`A ${actor} may not move custody ${from} -> ${to}`);
  }
}

/**
 * ★ Mirror the holding's state onto the linked transaction and write the audit row.
 *   Every custody transition funnels through here, which is what keeps the mirror
 *   honest and lets the completion CHECK be a real database constraint.
 */
export async function mirrorToTransaction(
  tx: Tx,
  transactionId: string,
  state: CustodyState,
  extra?: { holdingId?: string; storeId?: string | null },
): Promise<void> {
  await tx
    .update(transactions)
    .set({
      custodyState: state,
      ...(extra?.holdingId !== undefined ? { custodyHoldingId: extra.holdingId } : {}),
      ...(extra?.storeId !== undefined ? { relayStoreId: extra.storeId } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(transactions.id, transactionId));
}

async function afterCustodyChange(
  tx: Tx,
  holdingId: string,
  from: CustodyState,
  to: CustodyState,
  meta: { actorUserId?: string; actorRole: ActorRole; reason?: string },
): Promise<void> {
  const holding = await loadHolding(tx, holdingId);
  if (holding.currentTransactionId === null) return;

  await mirrorToTransaction(tx, holding.currentTransactionId, to);
  await tx.insert(transactionEvents).values({
    transactionId: holding.currentTransactionId,
    track: 'custody',
    fromState: from,
    toState: to,
    actorUserId:
      meta.actorUserId !== undefined && meta.actorUserId !== '' ? meta.actorUserId : null,
    actorRole: meta.actorRole,
    reason: meta.reason ?? null,
    metadata: { holdingId },
  });
}

interface HoldingContext {
  listingId: string;
  listingTitle: string;
  sellerId: string;
  buyerId: string | null;
  transactionId: string | null;
  storeName: string;
}

/**
 * Everything the notification templates need about a holding. `buyerId` and
 * `transactionId` are null while a holding sits on the shelf between attempts —
 * callers that address the buyer must check.
 */
async function holdingContext(tx: Tx, holdingId: string): Promise<HoldingContext | null> {
  const rows = await tx
    .select({
      listingId: listings.id,
      listingTitle: listings.title,
      sellerId: listings.sellerId,
      buyerId: transactions.buyerId,
      transactionId: transactions.id,
      storeName: relayStores.name,
    })
    .from(custodyHoldings)
    .innerJoin(listings, eq(listings.id, custodyHoldings.listingId))
    .leftJoin(transactions, eq(transactions.id, custodyHoldings.currentTransactionId))
    .leftJoin(relayStores, eq(relayStores.id, custodyHoldings.storeId))
    .where(eq(custodyHoldings.id, holdingId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    listingId: row.listingId,
    listingTitle: row.listingTitle,
    sellerId: row.sellerId,
    buyerId: row.buyerId,
    transactionId: row.transactionId,
    storeName: row.storeName ?? 'the delivery team',
  };
}
