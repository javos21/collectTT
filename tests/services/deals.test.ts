import { describe, expect, it } from 'vitest';

import { summarizeActiveDeal } from '../../src/services/deals';

const baseDeal = {
  id: 'deal-1',
  listingId: 'listing-1',
  title: 'Charizard holo',
  state: 'open' as const,
  buyerId: 'buyer-1',
  sellerId: 'seller-1',
  amountCents: 125_00,
  fulfillmentPath: 'relay' as const,
  paymentState: 'pending' as const,
  paymentDeadlineAt: new Date('2026-09-08T12:00:00.000Z'),
  sellerDropoffDeadlineAt: new Date('2026-09-07T12:00:00.000Z'),
  custodyState: 'awaiting_dropoff' as const,
  custodyExpiresAt: null,
  storeName: 'Long Circular Relay',
  storeArea: 'St James',
};

describe('shared active-deal summary', () => {
  it('describes a buyer payment task and uses the payment deadline', () => {
    const summary = summarizeActiveDeal(baseDeal, 'buyer-1');

    expect(summary.role).toBe('buying');
    expect(summary.needsAttention).toBe(true);
    expect(summary.currentState).toBe('Offer accepted');
    expect(summary.nextStep).toBe('Pay the seller');
    expect(summary.physicalTask).toBeNull();
    expect(summary.deadlineAt).toBe(baseDeal.paymentDeadlineAt.toISOString());
    expect(summary.canShowCode).toBe(false);
  });

  it('projects a seller drop-off task without exposing the counter code', () => {
    const summary = summarizeActiveDeal(
      { ...baseDeal, paymentState: 'confirmed' as const },
      'seller-1',
    );

    expect(summary.role).toBe('selling');
    expect(summary.needsAttention).toBe(false);
    expect(summary.nextStep).toBe('Drop off item');
    expect(summary.physicalTask).toBe('to_drop_off');
    expect(summary.deadlineAt).toBe(baseDeal.sellerDropoffDeadlineAt?.toISOString());
    expect(summary.canShowCode).toBe(true);
    expect('dropoffCode' in summary).toBe(false);
  });

  it('projects only a buyer-ready pickup as To collect', () => {
    const summary = summarizeActiveDeal(
      {
        ...baseDeal,
        paymentState: 'confirmed' as const,
        custodyState: 'release_authorized' as const,
        custodyExpiresAt: new Date('2026-09-14T12:00:00.000Z'),
      },
      'buyer-1',
    );

    expect(summary.physicalTask).toBe('to_collect');
    expect(summary.currentState).toBe('Ready for pickup');
    expect(summary.nextStep).toBe('Collect item');
    expect(summary.canShowCode).toBe(true);
    expect(summary.deadlineAt).toBe('2026-09-14T12:00:00.000Z');
  });

  it('keeps a shelf item visible as waiting rather than presenting it as actionable', () => {
    const summary = summarizeActiveDeal(
      {
        ...baseDeal,
        paymentState: 'confirmed' as const,
        custodyState: 'at_relay' as const,
        custodyExpiresAt: new Date('2026-09-12T12:00:00.000Z'),
      },
      'seller-1',
    );

    expect(summary.physicalTask).toBe('at_store');
    expect(summary.nextStep).toBe('Waiting for buyer pickup');
    expect(summary.canShowCode).toBe(false);
  });

  it('does not create a physical task for peer-to-peer delivery', () => {
    const summary = summarizeActiveDeal(
      {
        ...baseDeal,
        fulfillmentPath: 'remote_ship' as const,
        custodyState: 'not_applicable' as const,
        paymentState: 'confirmed' as const,
        storeName: null,
        storeArea: null,
      },
      'buyer-1',
    );

    expect(summary.physicalTask).toBeNull();
    expect(summary.location).toBeNull();
    expect(summary.nextStep).toBe('Complete the hand-off');
    expect(summary.canShowCode).toBe(false);
  });
});
