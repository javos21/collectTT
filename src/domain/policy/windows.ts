/**
 * Every deadline in the system, in one file.
 *
 * These are the numbers the plan deliberately left open — they are community-norm
 * judgements, not architecture. They live here so changing one is a single edit that
 * both the web process and the worker pick up, and so the test suite can assert the
 * relationships between them rather than the values.
 *
 * ★ ALL deadlines are computed from a server-supplied `now`, which callers take from
 *   the database clock (`now()`), never from the app process and never from a client.
 */

import type { FulfillmentPath } from '../states/transaction';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const WINDOWS = {
  /** How long a buyer has to pay (or to complete the meetup) once a deal opens. */
  payment: {
    cash_meetup: 72 * HOUR, // meetup window — needs slack for both schedules
    remote_ship: 48 * HOUR,
    relay: 72 * HOUR,
    full_service: 72 * HOUR,
  } satisfies Record<FulfillmentPath, number>,

  /**
   * How long a seller has to get the item into custody.
   * ★ MUST be shorter than the payment window on the same path — see
   *   `assertWindowInvariant` below and the `tx_dropoff_before_payment` CHECK.
   */
  sellerDropoff: {
    relay: 36 * HOUR,
    full_service: 36 * HOUR,
  } satisfies Record<'relay' | 'full_service', number>,

  /** Blind ratings reveal when both sides submit, or when this elapses. */
  ratingReveal: 7 * DAY,

  /** Default shelf clocks. Per-store values on `relay_stores` override these. */
  custody: {
    paidDays: 7,
    unpaidDays: 3,
  },

  /** Auction anti-snipe soft close. */
  antiSnipe: {
    windowSeconds: 120,
    extensionSeconds: 120,
    maxExtensions: null as number | null, // null = extend until bidding goes quiet
  },

  /** How deep the straight-sale backup claim stack goes. */
  maxClaimStackDepth: 4,
} as const;

export function paymentWindowMs(path: FulfillmentPath): number {
  return WINDOWS.payment[path];
}

export function sellerDropoffWindowMs(path: FulfillmentPath): number | null {
  if (path === 'relay' || path === 'full_service') {
    return WINDOWS.sellerDropoff[path];
  }
  return null;
}

export interface Deadlines {
  paymentDeadlineAt: Date;
  sellerDropoffDeadlineAt: Date | null;
}

/**
 * Compute both deadlines for a new transaction.
 * `now` MUST come from the database clock.
 */
export function computeDeadlines(path: FulfillmentPath, now: Date): Deadlines {
  const dropoffMs = sellerDropoffWindowMs(path);
  return {
    paymentDeadlineAt: new Date(now.getTime() + paymentWindowMs(path)),
    sellerDropoffDeadlineAt: dropoffMs === null ? null : new Date(now.getTime() + dropoffMs),
  };
}

export function ratingRevealDeadline(completedAt: Date): Date {
  return new Date(completedAt.getTime() + WINDOWS.ratingReveal);
}

/**
 * Shelf clock. Confirming payment EXTENDS the clock — which is the right incentive:
 * an unpaid item is pure liability for the store and gets the tighter deadline.
 */
export function custodyExpiry(opts: {
  paid: boolean;
  droppedOffAt: Date;
  paymentConfirmedAt: Date | null;
  paidDays?: number;
  unpaidDays?: number;
}): Date {
  const DAY_MS = DAY;
  if (opts.paid && opts.paymentConfirmedAt !== null) {
    const days = opts.paidDays ?? WINDOWS.custody.paidDays;
    return new Date(opts.paymentConfirmedAt.getTime() + days * DAY_MS);
  }
  const days = opts.unpaidDays ?? WINDOWS.custody.unpaidDays;
  return new Date(opts.droppedOffAt.getTime() + days * DAY_MS);
}

/**
 * ★★ The invariant that protects a relay buyer from paying for an item that never
 * arrives: on custody paths the seller's clock must expire STRICTLY BEFORE the
 * buyer's, so a no-drop-off terminates the deal while the buyer can still be told to
 * stop. Asserted at module load by the test suite, and enforced per-row by a CHECK.
 */
export function assertWindowInvariant(): void {
  for (const path of ['relay', 'full_service'] as const) {
    if (WINDOWS.sellerDropoff[path] >= WINDOWS.payment[path]) {
      throw new Error(
        `Window invariant violated for "${path}": seller drop-off window ` +
          `(${WINDOWS.sellerDropoff[path]}ms) must be strictly shorter than the payment ` +
          `window (${WINDOWS.payment[path]}ms), or a buyer can be asked to pay for an ` +
          `item that will never arrive.`,
      );
    }
  }
}
