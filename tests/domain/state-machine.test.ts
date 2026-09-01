/**
 * EXHAUSTIVE state machine tests.
 *
 * This is the executable half of the pressure test. It enumerates every
 * (state × state) pair on all four machines and every (path × track) combination,
 * asserting each is either declared legal or rejected — which is exactly how a
 * contradiction in the two-track model would surface.
 *
 * Pure domain logic, no database, no I/O.
 */

import { describe, it, expect } from 'vitest';

import {
  PAYMENT_STATES,
  PAYMENT_TRANSITIONS,
  canTransitionPayment,
  assertPaymentTransition,
  isPaymentSettled,
  isTerminalPaymentState,
  canActorTransitionPayment,
  IllegalPaymentTransitionError,
  type PaymentState,
} from '../../src/domain/states/payment';
import {
  CUSTODY_STATES,
  CUSTODY_TRANSITIONS,
  canTransitionCustody,
  isCustodySettled,
  isTerminalCustodyState,
  isPaymentGatedTransition,
  canActorTransitionCustody,
  type CustodyState,
} from '../../src/domain/states/custody';
import {
  TRANSACTION_STATES,
  TRANSACTION_TRANSITIONS,
  FULFILLMENT_PATHS,
  canTransitionTransaction,
  canComplete,
  shouldAutoComplete,
  usesCustodyTrack,
  fallbackFulfillmentPath,
  initialCustodyState,
  validateTransaction,
  REASON_TO_STATE,
  TERMINATION_REASONS,
  candidateLadderFor,
  TRANSACTION_SOURCES,
  type TransactionState,
  type TransactionSnapshot,
} from '../../src/domain/states/transaction';
import {
  LISTING_STATUSES,
  LISTING_TRANSITIONS,
  canTransitionListing,
  statusAfterFailedAttempt,
  type ListingStatus,
} from '../../src/domain/states/listing';
import { WINDOWS, computeDeadlines, assertWindowInvariant } from '../../src/domain/policy/windows';

// ---------------------------------------------------------------- payment track

describe('payment track', () => {
  it('declares a transition list for every state', () => {
    for (const state of PAYMENT_STATES) {
      expect(PAYMENT_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('every (from, to) pair is either declared legal or rejected', () => {
    for (const from of PAYMENT_STATES) {
      for (const to of PAYMENT_STATES) {
        const declared = (PAYMENT_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(canTransitionPayment(from, to)).toBe(declared);
      }
    }
  });

  it('terminal states have no outgoing transitions', () => {
    for (const state of PAYMENT_STATES) {
      if (isTerminalPaymentState(state)) {
        expect(PAYMENT_TRANSITIONS[state]).toHaveLength(0);
      }
    }
  });

  it('confirmed is the only settled state', () => {
    for (const state of PAYMENT_STATES) {
      expect(isPaymentSettled(state)).toBe(state === 'confirmed');
    }
  });

  it('the dispute reversal exists and is seller-driven', () => {
    expect(canTransitionPayment('buyer_marked_paid', 'pending')).toBe(true);
    expect(canActorTransitionPayment('buyer_marked_paid', 'pending', 'seller')).toBe(true);
    // A buyer cannot walk their own claim back to buy time.
    expect(canActorTransitionPayment('buyer_marked_paid', 'pending', 'buyer')).toBe(false);
  });

  it('a buyer cannot confirm their own payment', () => {
    expect(canActorTransitionPayment('buyer_marked_paid', 'confirmed', 'buyer')).toBe(false);
    expect(canActorTransitionPayment('buyer_marked_paid', 'confirmed', 'seller')).toBe(true);
  });

  it('rejects a transition out of a terminal state', () => {
    expect(() => assertPaymentTransition('confirmed', 'pending')).toThrow(
      IllegalPaymentTransitionError,
    );
  });

  it('confirmed is unreachable without passing through buyer_marked_paid', () => {
    const reaching = PAYMENT_STATES.filter((s) =>
      (PAYMENT_TRANSITIONS[s] as readonly string[]).includes('confirmed'),
    );
    expect(reaching).toEqual(['buyer_marked_paid']);
  });
});

// ---------------------------------------------------------------- custody track

describe('custody track', () => {
  it('every (from, to) pair is either declared legal or rejected', () => {
    for (const from of CUSTODY_STATES) {
      for (const to of CUSTODY_STATES) {
        const declared = (CUSTODY_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(canTransitionCustody(from, to)).toBe(declared);
      }
    }
  });

  it('not_applicable is a sealed state — P2P paths can never enter the custody track', () => {
    expect(CUSTODY_TRANSITIONS.not_applicable).toHaveLength(0);
    for (const from of CUSTODY_STATES) {
      expect(canTransitionCustody(from, 'not_applicable')).toBe(false);
    }
  });

  it('terminal states have no outgoing transitions', () => {
    for (const state of CUSTODY_STATES) {
      if (isTerminalCustodyState(state)) {
        expect(CUSTODY_TRANSITIONS[state]).toHaveLength(0);
      }
    }
  });

  it('settled means collected, or never applicable', () => {
    const settled = CUSTODY_STATES.filter(isCustodySettled);
    expect(new Set(settled)).toEqual(new Set(['picked_up', 'not_applicable']));
  });

  it('★ release_authorized is reachable ONLY from at_relay, and only through the gate', () => {
    const reaching = CUSTODY_STATES.filter((s) =>
      (CUSTODY_TRANSITIONS[s] as readonly string[]).includes('release_authorized'),
    );
    expect(reaching).toEqual(['at_relay']);
    expect(isPaymentGatedTransition('at_relay', 'release_authorized')).toBe(true);
  });

  it('★ pickup is reachable ONLY through release_authorized', () => {
    const reaching = CUSTODY_STATES.filter((s) =>
      (CUSTODY_TRANSITIONS[s] as readonly string[]).includes('picked_up'),
    );
    expect(reaching).toEqual(['release_authorized']);
  });

  it('an item at the store can always go back to the seller', () => {
    expect(canTransitionCustody('at_relay', 'returned_to_seller')).toBe(true);
    expect(canTransitionCustody('release_authorized', 'returned_to_seller')).toBe(true);
  });

  it('only store staff and admins move the custody track', () => {
    expect(canActorTransitionCustody('at_relay', 'release_authorized', 'store')).toBe(true);
    expect(canActorTransitionCustody('at_relay', 'release_authorized', 'buyer')).toBe(false);
    expect(canActorTransitionCustody('at_relay', 'release_authorized', 'seller')).toBe(false);
  });
});

// ---------------------------------------------------------------- rollup

describe('transaction rollup', () => {
  it('every (from, to) pair is either declared legal or rejected', () => {
    for (const from of TRANSACTION_STATES) {
      for (const to of TRANSACTION_STATES) {
        const declared = (TRANSACTION_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(canTransitionTransaction(from, to)).toBe(declared);
      }
    }
  });

  it('open is the only non-terminal state', () => {
    for (const state of TRANSACTION_STATES) {
      const outgoing = TRANSACTION_TRANSITIONS[state];
      if (state === 'open') expect(outgoing.length).toBeGreaterThan(0);
      else expect(outgoing).toHaveLength(0);
    }
  });

  it('★★ completion requires BOTH tracks — exhaustively', () => {
    for (const payment of PAYMENT_STATES) {
      for (const custody of CUSTODY_STATES) {
        const expected = payment === 'confirmed' && (custody === 'picked_up' || custody === 'not_applicable');
        expect(canComplete(payment, custody)).toBe(expected);
      }
    }
  });

  it('a paid-but-uncollected relay deal is NOT complete', () => {
    expect(canComplete('confirmed', 'at_relay')).toBe(false);
    expect(canComplete('confirmed', 'release_authorized')).toBe(false);
  });

  it('a collected-but-unpaid deal is NOT complete', () => {
    expect(canComplete('pending', 'picked_up')).toBe(false);
    expect(canComplete('buyer_marked_paid', 'picked_up')).toBe(false);
  });

  it('auto-completion only fires from open', () => {
    expect(shouldAutoComplete('open', 'confirmed', 'picked_up')).toBe(true);
    expect(shouldAutoComplete('completed', 'confirmed', 'picked_up')).toBe(false);
    expect(shouldAutoComplete('reneged_buyer', 'confirmed', 'picked_up')).toBe(false);
  });

  it('every termination reason maps to a failed rollup state', () => {
    for (const reason of TERMINATION_REASONS) {
      const state = REASON_TO_STATE[reason];
      expect(TRANSACTION_STATES).toContain(state);
      expect(state).not.toBe('completed');
      expect(state).not.toBe('open');
    }
  });

  it('buyer reasons blame the buyer and seller reasons blame the seller', () => {
    expect(REASON_TO_STATE.non_payment).toBe('reneged_buyer');
    expect(REASON_TO_STATE.buyer_no_show).toBe('reneged_buyer');
    expect(REASON_TO_STATE.seller_no_dropoff).toBe('reneged_seller');
    expect(REASON_TO_STATE.seller_no_show).toBe('reneged_seller');
  });

  it('each source resolves to exactly one candidate ladder', () => {
    for (const source of TRANSACTION_SOURCES) {
      expect(['claims', 'bids']).toContain(candidateLadderFor(source));
    }
    expect(candidateLadderFor('claim')).toBe('claims');
    expect(candidateLadderFor('auction_runner_up')).toBe('bids');
  });
});

// ---------------------------------------------------------------- paths × tracks

describe('fulfillment paths against both tracks', () => {
  it('exactly two paths use the custody track', () => {
    const custodyPaths = FULFILLMENT_PATHS.filter(usesCustodyTrack);
    expect(new Set(custodyPaths)).toEqual(new Set(['relay', 'full_service']));
  });

  it('the pre-Phase-2 fallback never picks a path that needs a store', () => {
    // ★ The §6.1 defect: taking paths[0] positionally hands a relay-only listing
    //   `path='relay', storeId=null`, which openOrRelinkHolding refuses — a failing
    //   worker job in auctionClose and in promotion.
    expect(fallbackFulfillmentPath(['relay', 'cash_meetup'])).toBe('cash_meetup');
    expect(fallbackFulfillmentPath(['full_service', 'remote_ship'])).toBe('remote_ship');

    // Unchanged wherever a non-custody path is declared at all, in declaration order.
    expect(fallbackFulfillmentPath(['remote_ship', 'relay'])).toBe('remote_ship');
    expect(fallbackFulfillmentPath(['cash_meetup'])).toBe('cash_meetup');

    // A listing that offers ONLY custody paths has no store-free option — the old
    // behaviour is kept rather than inventing a path the seller never agreed to.
    expect(fallbackFulfillmentPath(['relay'])).toBe('relay');
    expect(fallbackFulfillmentPath([])).toBe('cash_meetup');
  });

  it('P2P paths start — and stay — outside the custody track', () => {
    for (const path of ['cash_meetup', 'remote_ship'] as const) {
      expect(initialCustodyState(path)).toBe('not_applicable');
      expect(CUSTODY_TRANSITIONS.not_applicable).toHaveLength(0);
    }
  });

  it('custody paths start awaiting drop-off', () => {
    for (const path of ['relay', 'full_service'] as const) {
      expect(initialCustodyState(path)).toBe('awaiting_dropoff');
    }
  });

  const base = (over: Partial<TransactionSnapshot> = {}): TransactionSnapshot => ({
    state: 'open',
    paymentState: 'pending',
    custodyState: 'not_applicable',
    fulfillmentPath: 'cash_meetup',
    paymentDeadlineAt: new Date('2026-01-03T00:00:00Z'),
    sellerDropoffDeadlineAt: null,
    relayStoreId: null,
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    ...over,
  });

  it('a valid snapshot on every path passes', () => {
    for (const path of FULFILLMENT_PATHS) {
      const snapshot = base({
        fulfillmentPath: path,
        custodyState: initialCustodyState(path),
        sellerDropoffDeadlineAt: usesCustodyTrack(path) ? new Date('2026-01-02T00:00:00Z') : null,
        relayStoreId: path === 'relay' ? 'store-1' : null,
      });
      expect(validateTransaction(snapshot)).toEqual([]);
    }
  });

  it('rejects a P2P transaction that entered the custody track', () => {
    expect(validateTransaction(base({ custodyState: 'at_relay' }))).toContain('tx_p2p_no_custody');
  });

  it('rejects a P2P transaction attached to a store', () => {
    expect(validateTransaction(base({ relayStoreId: 'store-1' }))).toContain('tx_p2p_no_custody');
  });

  it('rejects a custody transaction with no custody track', () => {
    const v = validateTransaction(
      base({ fulfillmentPath: 'relay', custodyState: 'not_applicable', sellerDropoffDeadlineAt: null }),
    );
    expect(v).toContain('tx_custody_required');
  });

  it('★★ rejects a seller deadline at or after the buyer deadline', () => {
    const sameTime = validateTransaction(
      base({
        fulfillmentPath: 'relay',
        custodyState: 'awaiting_dropoff',
        paymentDeadlineAt: new Date('2026-01-03T00:00:00Z'),
        sellerDropoffDeadlineAt: new Date('2026-01-03T00:00:00Z'),
      }),
    );
    expect(sameTime).toContain('tx_dropoff_before_payment');

    const later = validateTransaction(
      base({
        fulfillmentPath: 'relay',
        custodyState: 'awaiting_dropoff',
        paymentDeadlineAt: new Date('2026-01-03T00:00:00Z'),
        sellerDropoffDeadlineAt: new Date('2026-01-04T00:00:00Z'),
      }),
    );
    expect(later).toContain('tx_dropoff_before_payment');
  });

  it('★★ rejects completion with either track unfinished', () => {
    expect(
      validateTransaction(base({ state: 'completed', paymentState: 'pending' })),
    ).toContain('tx_completion_requires_both');

    expect(
      validateTransaction(
        base({
          state: 'completed',
          paymentState: 'confirmed',
          fulfillmentPath: 'relay',
          custodyState: 'at_relay',
          sellerDropoffDeadlineAt: new Date('2026-01-02T00:00:00Z'),
        }),
      ),
    ).toContain('tx_completion_requires_both');
  });

  it('rejects a member trading with themselves', () => {
    expect(validateTransaction(base({ buyerId: 'x', sellerId: 'x' }))).toContain(
      'tx_distinct_parties',
    );
  });
});

// ---------------------------------------------------------------- listing

describe('listing lifecycle', () => {
  it('every (from, to) pair is either declared legal or rejected', () => {
    for (const from of LISTING_STATUSES) {
      for (const to of LISTING_STATUSES) {
        const declared = (LISTING_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(canTransitionListing(from, to)).toBe(declared);
      }
    }
  });

  it('a failed attempt with candidates left keeps the listing claimed', () => {
    expect(
      statusAfterFailedAttempt({ hasRemainingCandidates: true, autoRelistOnRenege: true }),
    ).toBe('claimed');
    expect(
      statusAfterFailedAttempt({ hasRemainingCandidates: true, autoRelistOnRenege: false }),
    ).toBe('claimed');
  });

  it('a failed attempt with none left relists or gives up, per the seller flag', () => {
    expect(
      statusAfterFailedAttempt({ hasRemainingCandidates: false, autoRelistOnRenege: true }),
    ).toBe('active');
    expect(
      statusAfterFailedAttempt({ hasRemainingCandidates: false, autoRelistOnRenege: false }),
    ).toBe('ended_no_sale');
  });

  it('ended_won is final — a sold item cannot be resurrected', () => {
    expect(LISTING_TRANSITIONS.ended_won).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- windows

describe('deadline policy', () => {
  it('★★ the seller drop-off window is strictly shorter than the payment window', () => {
    expect(() => assertWindowInvariant()).not.toThrow();
    for (const path of ['relay', 'full_service'] as const) {
      expect(WINDOWS.sellerDropoff[path]).toBeLessThan(WINDOWS.payment[path]);
    }
  });

  it('computed deadlines satisfy the invariant on every path', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    for (const path of FULFILLMENT_PATHS) {
      const d = computeDeadlines(path, now);
      expect(d.paymentDeadlineAt.getTime()).toBeGreaterThan(now.getTime());
      if (usesCustodyTrack(path)) {
        expect(d.sellerDropoffDeadlineAt).not.toBeNull();
        expect(d.sellerDropoffDeadlineAt!.getTime()).toBeLessThan(d.paymentDeadlineAt.getTime());
      } else {
        expect(d.sellerDropoffDeadlineAt).toBeNull();
      }
    }
  });

  it('the claim stack is bounded', () => {
    expect(WINDOWS.maxClaimStackDepth).toBeGreaterThan(1);
    expect(WINDOWS.maxClaimStackDepth).toBeLessThanOrEqual(3);
  });
});
