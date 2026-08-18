/**
 * CUSTODY TRACK
 *
 * The second of the two independent tracks. Custody follows the ITEM, so a
 * `custody_holdings` row belongs to a LISTING, not a transaction — that is what lets
 * a backup claimer be promoted while the item stays exactly where it is on the shelf.
 *
 *   not_applicable                                  (terminal — paths 1 & 2, never leaves)
 *
 *   awaiting_dropoff ──store marks received──► at_relay
 *          │                                     │
 *          │                                     ├──★ GATE: payment confirmed ──► release_authorized
 *          │                                     │                                        │
 *          │                                     │                              buyer collects
 *          │                                     │                                        ▼
 *          │                                     │                                    picked_up ✓
 *          │                                     └──unpaid & tx terminated──► returned_to_seller
 *          └──seller never drops off──► voided (transaction terminates as reneged_seller)
 *
 * The ONE cross-track dependency in the whole system is the release gate: an item can
 * only move at_relay -> release_authorized when the linked transaction's payment_state
 * is 'confirmed'. That check is enforced in SQL (see src/db/atomic/authorize-release.ts),
 * not here — this module defines which transitions are shaped legally at all.
 */

import type { ActorRole } from './actors';

export const CUSTODY_STATES = [
  'not_applicable',
  'awaiting_dropoff',
  'at_relay',
  'release_authorized',
  'picked_up',
  'returned_to_seller',
  'voided',
] as const;

export type CustodyState = (typeof CUSTODY_STATES)[number];

export const TERMINAL_CUSTODY_STATES = [
  'not_applicable',
  'picked_up',
  'returned_to_seller',
  'voided',
] as const satisfies readonly CustodyState[];

export type TerminalCustodyState = (typeof TERMINAL_CUSTODY_STATES)[number];

/**
 * States in which an item is physically in someone else's hands and therefore
 * occupies shelf space / is on a holding clock.
 */
export const LIVE_CUSTODY_STATES = [
  'awaiting_dropoff',
  'at_relay',
  'release_authorized',
] as const satisfies readonly CustodyState[];

export const CUSTODY_TRANSITIONS = {
  // Paths 1 & 2 (cash_meetup, remote_ship) pin here forever. The platform is not
  // part of the handover, so there is nothing to track.
  not_applicable: [],

  awaiting_dropoff: ['at_relay', 'voided'],
  at_relay: ['release_authorized', 'returned_to_seller'],
  release_authorized: ['picked_up', 'returned_to_seller'],

  picked_up: [],
  returned_to_seller: [],
  voided: [],
} as const satisfies Record<CustodyState, readonly CustodyState[]>;

export type NextCustodyState<S extends CustodyState> = (typeof CUSTODY_TRANSITIONS)[S][number];

export const CUSTODY_TRANSITION_ACTORS: Record<string, readonly ActorRole[]> = {
  'awaiting_dropoff->at_relay': ['store', 'admin'],
  'awaiting_dropoff->voided': ['system', 'admin'],
  'at_relay->release_authorized': ['store', 'admin'],
  'at_relay->returned_to_seller': ['store', 'admin'],
  'release_authorized->picked_up': ['store', 'admin'],
  'release_authorized->returned_to_seller': ['store', 'admin'],
};

/**
 * Transitions that may only proceed when the linked transaction's payment track has
 * settled. Exactly one entry today; keeping it as a set means adding another gated
 * transition later is a data change, not a new special case in the services.
 */
export const PAYMENT_GATED_CUSTODY_TRANSITIONS = new Set<string>(['at_relay->release_authorized']);

export function isPaymentGatedTransition(from: CustodyState, to: CustodyState): boolean {
  return PAYMENT_GATED_CUSTODY_TRANSITIONS.has(`${from}->${to}`);
}

/** COMPILE-TIME guard — see the equivalent in ./payment.ts. */
export function custodyTransition<S extends CustodyState, T extends NextCustodyState<S>>(
  from: S,
  to: T,
): { from: S; to: T } {
  return { from, to };
}

export function canTransitionCustody(from: CustodyState, to: CustodyState): boolean {
  return (CUSTODY_TRANSITIONS[from] as readonly CustodyState[]).includes(to);
}

export function assertCustodyTransition(from: CustodyState, to: CustodyState): void {
  if (!canTransitionCustody(from, to)) {
    throw new IllegalCustodyTransitionError(from, to);
  }
}

export function canActorTransitionCustody(
  from: CustodyState,
  to: CustodyState,
  actor: ActorRole,
): boolean {
  if (!canTransitionCustody(from, to)) return false;
  const allowed = CUSTODY_TRANSITION_ACTORS[`${from}->${to}`];
  return allowed !== undefined && allowed.includes(actor);
}

export function isTerminalCustodyState(state: CustodyState): state is TerminalCustodyState {
  return (TERMINAL_CUSTODY_STATES as readonly CustodyState[]).includes(state);
}

/** True while the item physically occupies a shelf or a courier's van. */
export function isLiveCustodyState(state: CustodyState): boolean {
  return (LIVE_CUSTODY_STATES as readonly CustodyState[]).includes(state);
}

/**
 * The custody track is done, in the successful sense, in exactly two situations:
 * the item was collected, or there was never anything to track.
 */
export function isCustodySettled(state: CustodyState): boolean {
  return state === 'picked_up' || state === 'not_applicable';
}

export class IllegalCustodyTransitionError extends Error {
  constructor(
    readonly from: CustodyState,
    readonly to: CustodyState,
  ) {
    super(`Illegal custody transition: ${from} -> ${to}`);
    this.name = 'IllegalCustodyTransitionError';
  }
}
