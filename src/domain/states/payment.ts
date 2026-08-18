/**
 * PAYMENT TRACK
 *
 * One of the two independent tracks a transaction advances along. This track is
 * purely about money changing hands between buyer and seller — the platform never
 * touches it, we only record the assertions both sides make about it.
 *
 *   pending ──buyer marks paid──► buyer_marked_paid ──seller confirms──► confirmed ✓
 *      ▲                                 │
 *      └────seller disputes the claim────┘   (the deadline is NEVER extended)
 *
 *   pending | buyer_marked_paid ──window lapses / tx terminates──► failed ✗
 *
 * The dispute reversal is the only loop in the machine. It is safe precisely because
 * `payment_deadline_at` never moves on reversal: a seller cannot run out a buyer's
 * clock with repeated disputes, and a buyer cannot buy time with a false mark-paid.
 */

import type { ActorRole } from './actors';

export const PAYMENT_STATES = ['pending', 'buyer_marked_paid', 'confirmed', 'failed'] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

/** States from which no further movement is possible. */
export const TERMINAL_PAYMENT_STATES = ['confirmed', 'failed'] as const satisfies readonly PaymentState[];

export type TerminalPaymentState = (typeof TERMINAL_PAYMENT_STATES)[number];

/**
 * The single source of truth for legal payment transitions.
 * Imported by both the web process and the worker process.
 */
export const PAYMENT_TRANSITIONS = {
  pending: ['buyer_marked_paid', 'failed'],
  buyer_marked_paid: ['confirmed', 'pending', 'failed'],
  confirmed: [],
  failed: [],
} as const satisfies Record<PaymentState, readonly PaymentState[]>;

/** The states reachable from `S`. Resolves to `never` for terminal states. */
export type NextPaymentState<S extends PaymentState> = (typeof PAYMENT_TRANSITIONS)[S][number];

/**
 * Which actor is permitted to drive each transition.
 * `system` transitions are performed by worker tasks (deadline expiry, cascades).
 */
export const PAYMENT_TRANSITION_ACTORS: Record<string, readonly ActorRole[]> = {
  'pending->buyer_marked_paid': ['buyer'],
  'pending->failed': ['system', 'admin'],
  'buyer_marked_paid->confirmed': ['seller', 'admin'],
  'buyer_marked_paid->pending': ['seller', 'admin'],
  'buyer_marked_paid->failed': ['system', 'admin'],
};

/**
 * COMPILE-TIME guard. Use at call sites where both states are literals:
 *
 *     paymentTransition('pending', 'buyer_marked_paid')   // ok
 *     paymentTransition('confirmed', 'pending')           // ❌ type error
 *
 * `to` is constrained to `NextPaymentState<S>`, so an illegal pair fails to compile
 * rather than failing in production.
 */
export function paymentTransition<S extends PaymentState, T extends NextPaymentState<S>>(
  from: S,
  to: T,
): { from: S; to: T } {
  return { from, to };
}

/**
 * RUNTIME guard, for states that came out of the database and are therefore only
 * known as the wide `PaymentState` union. Backs the same table as the type-level guard.
 */
export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return (PAYMENT_TRANSITIONS[from] as readonly PaymentState[]).includes(to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransitionPayment(from, to)) {
    throw new IllegalPaymentTransitionError(from, to);
  }
}

export function canActorTransitionPayment(
  from: PaymentState,
  to: PaymentState,
  actor: ActorRole,
): boolean {
  if (!canTransitionPayment(from, to)) return false;
  const allowed = PAYMENT_TRANSITION_ACTORS[`${from}->${to}`];
  return allowed !== undefined && allowed.includes(actor);
}

export function isTerminalPaymentState(state: PaymentState): state is TerminalPaymentState {
  return (TERMINAL_PAYMENT_STATES as readonly PaymentState[]).includes(state);
}

/** The payment track is done, in the successful sense, only here. */
export function isPaymentSettled(state: PaymentState): boolean {
  return state === 'confirmed';
}

export class IllegalPaymentTransitionError extends Error {
  constructor(
    readonly from: PaymentState,
    readonly to: PaymentState,
  ) {
    super(`Illegal payment transition: ${from} -> ${to}`);
    this.name = 'IllegalPaymentTransitionError';
  }
}
