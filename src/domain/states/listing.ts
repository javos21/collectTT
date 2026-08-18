/**
 * LISTING LIFECYCLE
 *
 *   draft ──publish──► active ──┬── claim (straight sale) ────► claimed
 *                               ├── auction closes w/ bid ────► ended_won
 *                               ├── auction closes no bid ────► ended_no_sale
 *                               ├── seller cancels ───────────► cancelled
 *                               └── ends_at passes ───────────► expired
 *
 *   claimed ──tx terminates, candidates remain ──► claimed  (next attempt opens)
 *   claimed ──tx terminates, none remain, auto_relist ──► active
 *   claimed ──tx terminates, none remain, no relist ────► ended_no_sale
 *   claimed ──tx completes ─────────────────────────────► ended_won
 *
 * A listing is ONE indivisible lot. It resolves to at most one completed transaction,
 * though it may go through several attempts to get there.
 */

import type { ActorRole } from './actors';

export const SALE_TYPES = ['straight_sale', 'auction'] as const;

export type SaleType = (typeof SALE_TYPES)[number];

export const LISTING_STATUSES = [
  'draft',
  'active',
  'claimed',
  'ended_won',
  'ended_no_sale',
  'cancelled',
  'expired',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const TERMINAL_LISTING_STATUSES = [
  'ended_won',
  'ended_no_sale',
  'cancelled',
  'expired',
] as const satisfies readonly ListingStatus[];

export const LISTING_TRANSITIONS = {
  draft: ['active', 'cancelled'],
  // 'claimed' covers both a straight-sale claim and an auction that resolved to a
  // winner but has not completed yet.
  active: ['claimed', 'ended_won', 'ended_no_sale', 'cancelled', 'expired'],
  // A failed attempt with candidates left keeps the listing here; with none left it
  // either returns to the shelf or gives up.
  claimed: ['active', 'ended_won', 'ended_no_sale', 'cancelled'],
  ended_won: [],
  ended_no_sale: ['active'], // seller may relist
  cancelled: [],
  expired: ['active'], // seller may relist
} as const satisfies Record<ListingStatus, readonly ListingStatus[]>;

export type NextListingStatus<S extends ListingStatus> = (typeof LISTING_TRANSITIONS)[S][number];

export const LISTING_TRANSITION_ACTORS: Record<string, readonly ActorRole[]> = {
  'draft->active': ['seller', 'admin'],
  'draft->cancelled': ['seller', 'admin'],
  'active->claimed': ['system'], // via the atomic claim / auction close
  'active->ended_won': ['system'],
  'active->ended_no_sale': ['system'],
  'active->cancelled': ['seller', 'admin'],
  'active->expired': ['system'],
  'claimed->active': ['system'],
  'claimed->ended_won': ['system'],
  'claimed->ended_no_sale': ['system'],
  'claimed->cancelled': ['admin'],
  'ended_no_sale->active': ['seller', 'admin'],
  'expired->active': ['seller', 'admin'],
};

/** COMPILE-TIME guard — see the equivalent in ./payment.ts. */
export function listingTransition<S extends ListingStatus, T extends NextListingStatus<S>>(
  from: S,
  to: T,
): { from: S; to: T } {
  return { from, to };
}

export function canTransitionListing(from: ListingStatus, to: ListingStatus): boolean {
  return (LISTING_TRANSITIONS[from] as readonly ListingStatus[]).includes(to);
}

export function assertListingTransition(from: ListingStatus, to: ListingStatus): void {
  if (!canTransitionListing(from, to)) {
    throw new IllegalListingTransitionError(from, to);
  }
}

export function canActorTransitionListing(
  from: ListingStatus,
  to: ListingStatus,
  actor: ActorRole,
): boolean {
  if (!canTransitionListing(from, to)) return false;
  const allowed = LISTING_TRANSITION_ACTORS[`${from}->${to}`];
  return allowed !== undefined && allowed.includes(actor);
}

export function isTerminalListingStatus(status: ListingStatus): boolean {
  return (TERMINAL_LISTING_STATUSES as readonly ListingStatus[]).includes(status);
}

/** Only an active listing accepts claims or bids. */
export function isOpenForOffers(status: ListingStatus): boolean {
  return status === 'active';
}

/**
 * Where a listing lands when its current transaction attempt fails.
 * Decided in one place so the claim path and the auction path cannot disagree.
 */
export function statusAfterFailedAttempt(opts: {
  hasRemainingCandidates: boolean;
  autoRelistOnRenege: boolean;
}): ListingStatus {
  if (opts.hasRemainingCandidates) return 'claimed';
  return opts.autoRelistOnRenege ? 'active' : 'ended_no_sale';
}

export const SIZE_CLASSES = ['small', 'medium', 'large', 'oversize'] as const;

export type SizeClass = (typeof SIZE_CLASSES)[number];

export class IllegalListingTransitionError extends Error {
  constructor(
    readonly from: ListingStatus,
    readonly to: ListingStatus,
  ) {
    super(`Illegal listing transition: ${from} -> ${to}`);
    this.name = 'IllegalListingTransitionError';
  }
}
