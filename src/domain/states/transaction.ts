/**
 * TRANSACTION ROLLUP
 *
 * A transaction carries THREE state values, not one:
 *
 *     payment_state   the money track      (./payment.ts)
 *     custody_state   the item track       (./custody.ts)
 *     state           the rollup           (this file)
 *
 * A single flat enum cannot express "paid but not yet collected" versus "collected but
 * not yet paid", so the two tracks advance independently, in any interleaving, and the
 * rollup is the only thing that couples them:
 *
 *     state = 'completed'  ⟺  payment settled AND custody settled
 *
 * That equivalence is also a database CHECK constraint (`tx_completion_requires_both`).
 * It is asserted in two places on purpose: the constraint makes a bad row impossible to
 * write, this module makes a bad transition impossible to compile.
 */

import type { ActorRole } from './actors';
import { isPaymentSettled, type PaymentState } from './payment';
import { isCustodySettled, type CustodyState } from './custody';

// ---------------------------------------------------------------- fulfillment paths

export const FULFILLMENT_PATHS = [
  'cash_meetup', // 1. platform uninvolved in settlement — the community's heartbeat
  'remote_ship', // 2. remote payment + seller ships — P2P, platform uninvolved
  'relay', // 3. relay store as physical escrow — our rail
  'full_service', // 4. our team collects and delivers end-to-end — our paid rail
] as const;

export type FulfillmentPath = (typeof FULFILLMENT_PATHS)[number];

/** The two paths where the platform takes physical custody of the item. */
export const CUSTODY_PATHS = ['relay', 'full_service'] as const satisfies readonly FulfillmentPath[];

/** The two paths that settle purely peer-to-peer. */
export const P2P_PATHS = ['cash_meetup', 'remote_ship'] as const satisfies readonly FulfillmentPath[];

export function usesCustodyTrack(path: FulfillmentPath): boolean {
  return (CUSTODY_PATHS as readonly FulfillmentPath[]).includes(path);
}

/**
 * ★ The fallback path for a bid or claim that carries none of its own.
 *
 * Pre-Phase-2 bids have neither `fulfillment_path` nor `relay_store_id`, so something
 * has to stand in. Taking `paths[0]` positionally is not safe: on a relay-only listing
 * that produces `path='relay', storeId=null`, which `openOrRelinkHolding` refuses with
 * "A relay drop-off needs a store" — a user-facing error on a buyout, and a *failing
 * worker job* in `auctionClose` and `promoteNextCandidate`, retried to exhaustion,
 * leaving the listing active past its deadline with no winner and nobody notified.
 *
 * So: prefer the first declared path that needs no store. The trailing fallbacks keep
 * behaviour identical for every listing that declares a non-custody path at all.
 */
export function fallbackFulfillmentPath(paths: readonly string[]): FulfillmentPath {
  const declared = paths as readonly FulfillmentPath[];
  return declared.find((p) => !usesCustodyTrack(p)) ?? declared[0] ?? 'cash_meetup';
}

/** The custody state a brand-new transaction on this path must start in. */
export function initialCustodyState(path: FulfillmentPath): CustodyState {
  return usesCustodyTrack(path) ? 'awaiting_dropoff' : 'not_applicable';
}

// ---------------------------------------------------------------- rollup states

export const TRANSACTION_STATES = [
  'open',
  'completed',
  'reneged_buyer',
  'reneged_seller',
  'cancelled',
  'expired',
] as const;

export type TransactionState = (typeof TRANSACTION_STATES)[number];

export const TERMINAL_TRANSACTION_STATES = [
  'completed',
  'reneged_buyer',
  'reneged_seller',
  'cancelled',
  'expired',
] as const satisfies readonly TransactionState[];

/** Terminal states other than success — these free the listing for a next attempt. */
export const FAILED_TRANSACTION_STATES = [
  'reneged_buyer',
  'reneged_seller',
  'cancelled',
  'expired',
] as const satisfies readonly TransactionState[];

export const TRANSACTION_TRANSITIONS = {
  open: ['completed', 'reneged_buyer', 'reneged_seller', 'cancelled', 'expired'],
  completed: [],
  reneged_buyer: [],
  reneged_seller: [],
  cancelled: [],
  expired: [],
} as const satisfies Record<TransactionState, readonly TransactionState[]>;

export type NextTransactionState<S extends TransactionState> =
  (typeof TRANSACTION_TRANSITIONS)[S][number];

export const TRANSACTION_TRANSITION_ACTORS: Record<string, readonly ActorRole[]> = {
  'open->completed': ['system', 'store', 'seller', 'admin'],
  'open->reneged_buyer': ['system', 'admin'],
  'open->reneged_seller': ['system', 'admin'],
  'open->cancelled': ['buyer', 'seller', 'admin'],
  'open->expired': ['system', 'admin'],
};

// ---------------------------------------------------------------- termination reasons

export const TERMINATION_REASONS = [
  'non_payment', // buyer's payment window lapsed
  'buyer_no_show', // buyer never showed for the meetup
  'seller_no_dropoff', // seller never delivered the item to the relay / courier
  'seller_no_show', // seller never showed for the meetup / would not hand over
  'mutual_cancel',
  'admin',
] as const;

export type TerminationReason = (typeof TERMINATION_REASONS)[number];

/** Which rollup state a given termination reason resolves to. */
export const REASON_TO_STATE: Record<TerminationReason, TransactionState> = {
  non_payment: 'reneged_buyer',
  buyer_no_show: 'reneged_buyer',
  seller_no_dropoff: 'reneged_seller',
  seller_no_show: 'reneged_seller',
  mutual_cancel: 'cancelled',
  admin: 'cancelled',
};

// ---------------------------------------------------------------- candidate source

export const TRANSACTION_SOURCES = [
  'claim', // straight sale, first claimant
  'claim_promotion', // straight sale, promoted from the backup stack
  'offer_accept', // fixed-price offer accepted by the seller
  'auction_win', // auction, highest bidder
  'auction_runner_up', // auction, promoted down the bid ladder
] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/** Straight-sale sources walk the claim stack; auction sources walk the bid ladder. */
export function candidateLadderFor(source: TransactionSource): 'claims' | 'bids' {
  return source === 'claim' || source === 'claim_promotion' || source === 'offer_accept'
    ? 'claims'
    : 'bids';
}

// ---------------------------------------------------------------- guards

/** COMPILE-TIME guard — see the equivalent in ./payment.ts. */
export function transactionTransition<
  S extends TransactionState,
  T extends NextTransactionState<S>,
>(from: S, to: T): { from: S; to: T } {
  return { from, to };
}

export function canTransitionTransaction(from: TransactionState, to: TransactionState): boolean {
  return (TRANSACTION_TRANSITIONS[from] as readonly TransactionState[]).includes(to);
}

export function assertTransactionTransition(from: TransactionState, to: TransactionState): void {
  if (!canTransitionTransaction(from, to)) {
    throw new IllegalTransactionTransitionError(from, to);
  }
}

export function canActorTransitionTransaction(
  from: TransactionState,
  to: TransactionState,
  actor: ActorRole,
): boolean {
  if (!canTransitionTransaction(from, to)) return false;
  const allowed = TRANSACTION_TRANSITION_ACTORS[`${from}->${to}`];
  return allowed !== undefined && allowed.includes(actor);
}

export function isTerminalTransactionState(state: TransactionState): boolean {
  return (TERMINAL_TRANSACTION_STATES as readonly TransactionState[]).includes(state);
}

export function isFailedTransactionState(state: TransactionState): boolean {
  return (FAILED_TRANSACTION_STATES as readonly TransactionState[]).includes(state);
}

// ---------------------------------------------------------------- cross-track rules

/**
 * ★ THE completion rule. Both tracks, or it is not complete.
 * Mirrored by the `tx_completion_requires_both` CHECK constraint.
 */
export function canComplete(payment: PaymentState, custody: CustodyState): boolean {
  return isPaymentSettled(payment) && isCustodySettled(custody);
}

/**
 * After any transition on either track, ask whether the transaction has just become
 * complete. This is the only way a transaction reaches 'completed' — no caller sets it
 * directly, both tracks simply report in and the rollup falls out.
 */
export function shouldAutoComplete(
  state: TransactionState,
  payment: PaymentState,
  custody: CustodyState,
): boolean {
  return state === 'open' && canComplete(payment, custody);
}

/** A snapshot sufficient to check every cross-track invariant. */
export interface TransactionSnapshot {
  state: TransactionState;
  paymentState: PaymentState;
  custodyState: CustodyState;
  fulfillmentPath: FulfillmentPath;
  paymentDeadlineAt: Date;
  sellerDropoffDeadlineAt: Date | null;
  relayStoreId: string | null;
  buyerId: string;
  sellerId: string;
}

/**
 * Every invariant that spans more than one column, checked in one place.
 * The database enforces these too; this function exists so the service layer can fail
 * fast with a readable message, and so the test suite can enumerate violations.
 *
 * Returns the list of violated invariant names — empty means valid.
 */
export function validateTransaction(tx: TransactionSnapshot): string[] {
  const violations: string[] = [];

  if (tx.buyerId === tx.sellerId) {
    violations.push('tx_distinct_parties');
  }

  // P2P paths never touch the custody track.
  if (!usesCustodyTrack(tx.fulfillmentPath)) {
    if (tx.custodyState !== 'not_applicable') violations.push('tx_p2p_no_custody');
    if (tx.relayStoreId !== null) violations.push('tx_p2p_no_custody');
  }

  // Custody paths always do, and always carry a seller deadline.
  if (usesCustodyTrack(tx.fulfillmentPath)) {
    if (tx.custodyState === 'not_applicable') violations.push('tx_custody_required');
    if (tx.sellerDropoffDeadlineAt === null) violations.push('tx_custody_required');
  }

  // ★★ The seller's clock must expire before the buyer's, so that a seller who never
  // drops off is caught while the buyer's payment window is still open and the buyer
  // can still be told to stop. See the plan's "one consequence to flag".
  if (
    tx.sellerDropoffDeadlineAt !== null &&
    tx.sellerDropoffDeadlineAt.getTime() >= tx.paymentDeadlineAt.getTime()
  ) {
    violations.push('tx_dropoff_before_payment');
  }

  // ★★ Completion requires both tracks.
  if (tx.state === 'completed' && !canComplete(tx.paymentState, tx.custodyState)) {
    violations.push('tx_completion_requires_both');
  }

  return violations;
}

export function assertTransactionValid(tx: TransactionSnapshot): void {
  const violations = validateTransaction(tx);
  if (violations.length > 0) {
    throw new TransactionInvariantError(violations);
  }
}

export class IllegalTransactionTransitionError extends Error {
  constructor(
    readonly from: TransactionState,
    readonly to: TransactionState,
  ) {
    super(`Illegal transaction transition: ${from} -> ${to}`);
    this.name = 'IllegalTransactionTransitionError';
  }
}

export class TransactionInvariantError extends Error {
  constructor(readonly violations: string[]) {
    super(`Transaction invariant(s) violated: ${violations.join(', ')}`);
    this.name = 'TransactionInvariantError';
  }
}
