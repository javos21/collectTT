import { afterEach, describe, expect, it } from 'vitest';

import {
  areAuctionsVisible,
  assertAuctionBiddingEnabled,
  assertAuctionCreationEnabled,
  assertLegacyFeatureAllowed,
  assertV1ListingTerms,
  auctionMode,
  isAuctionBiddingEnabled,
  isAuctionCreationEnabled,
  isLegacyFeatureAllowed,
  launchScope,
} from '@/lib/launch-scope';

const originalScope = process.env.COLLECTTT_LAUNCH_SCOPE;
const originalAuctionMode = process.env.COLLECTTT_AUCTION_MODE;

afterEach(() => {
  if (originalScope === undefined) delete process.env.COLLECTTT_LAUNCH_SCOPE;
  else process.env.COLLECTTT_LAUNCH_SCOPE = originalScope;
  if (originalAuctionMode === undefined) delete process.env.COLLECTTT_AUCTION_MODE;
  else process.env.COLLECTTT_AUCTION_MODE = originalAuctionMode;
});

describe('auction availability', () => {
  it('fails closed when the mode is missing or invalid', () => {
    delete process.env.COLLECTTT_AUCTION_MODE;
    expect(auctionMode()).toBe('hidden');
    expect(areAuctionsVisible()).toBe(false);
    expect(isAuctionCreationEnabled()).toBe(false);
    expect(isAuctionBiddingEnabled()).toBe(false);
    expect(() => assertAuctionCreationEnabled()).toThrow('Auctions are not currently available.');

    process.env.COLLECTTT_AUCTION_MODE = 'unexpected';
    expect(auctionMode()).toBe('hidden');
  });

  it('drains existing auctions without allowing new ones', () => {
    process.env.COLLECTTT_AUCTION_MODE = 'draining';
    expect(areAuctionsVisible()).toBe(true);
    expect(isAuctionCreationEnabled()).toBe(false);
    expect(isAuctionBiddingEnabled()).toBe(true);
    expect(() => assertAuctionCreationEnabled()).toThrow('existing auctions finish');
    expect(() => assertAuctionBiddingEnabled()).not.toThrow();
  });

  it('enables the complete auction flow explicitly', () => {
    process.env.COLLECTTT_AUCTION_MODE = 'enabled';
    expect(areAuctionsVisible()).toBe(true);
    expect(isAuctionCreationEnabled()).toBe(true);
    expect(isAuctionBiddingEnabled()).toBe(true);
    expect(() => assertAuctionCreationEnabled()).not.toThrow();
    expect(() => assertAuctionBiddingEnabled()).not.toThrow();
  });
});

describe('v1 launch scope', () => {
  it('defaults to v1, allows fixed-price offers and store custody, and blocks other legacy writes', () => {
    delete process.env.COLLECTTT_LAUNCH_SCOPE;
    expect(launchScope()).toBe('v1');
    expect(isLegacyFeatureAllowed('offers')).toBe(true);
    expect(isLegacyFeatureAllowed('store_custody')).toBe(true);
    expect(() => assertLegacyFeatureAllowed('store_custody')).not.toThrow();
    expect(() => assertLegacyFeatureAllowed('reserve_price')).toThrow('Reserve Price');
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

  it('allows any admin-configured payment method in v1', () => {
    delete process.env.COLLECTTT_LAUNCH_SCOPE;
    expect(() => assertV1ListingTerms({
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['wam'],
    })).not.toThrow();
  });
});
