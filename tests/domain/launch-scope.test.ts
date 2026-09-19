import { afterEach, describe, expect, it } from 'vitest';

import {
  assertLegacyFeatureAllowed,
  assertV1ListingTerms,
  isLegacyFeatureAllowed,
  launchScope,
} from '@/lib/launch-scope';

const originalScope = process.env.COLLECTTT_LAUNCH_SCOPE;

afterEach(() => {
  if (originalScope === undefined) delete process.env.COLLECTTT_LAUNCH_SCOPE;
  else process.env.COLLECTTT_LAUNCH_SCOPE = originalScope;
});

describe('v1 launch scope', () => {
  it('defaults to v1, allows fixed-price offers, and blocks other legacy writes', () => {
    delete process.env.COLLECTTT_LAUNCH_SCOPE;
    expect(launchScope()).toBe('v1');
    expect(isLegacyFeatureAllowed('offers')).toBe(true);
    expect(isLegacyFeatureAllowed('store_custody')).toBe(false);
    expect(() => assertLegacyFeatureAllowed('store_custody')).toThrow('Store Custody');
  });

  it('allows legacy operations only when explicitly selected', () => {
    process.env.COLLECTTT_LAUNCH_SCOPE = 'legacy';
    expect(launchScope()).toBe('legacy');
    expect(isLegacyFeatureAllowed('offers')).toBe(true);
    expect(() => assertLegacyFeatureAllowed('offers')).not.toThrow();
  });

  it('rejects prohibited terms for new v1 listings while allowing configured delivery paths and offers', () => {
    delete process.env.COLLECTTT_LAUNCH_SCOPE;
    expect(() => assertV1ListingTerms({
      fulfillmentPaths: ['relay'],
      settlementMethods: ['cash'],
    })).not.toThrow();
    expect(() => assertV1ListingTerms({
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
      acceptsOffers: true,
    })).not.toThrow();
    expect(() => assertV1ListingTerms({
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['bank_transfer'],
      buyoutCents: 1000,
    })).toThrow('Auction buyouts');
  });
});
