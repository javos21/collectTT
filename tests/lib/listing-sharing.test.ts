import { describe, expect, it } from 'vitest';

import {
  attributedShareUrl,
  listingConditionLabel,
  listingPriceLabel,
  listingShareText,
  listingSocialDescription,
} from '../../src/lib/listing-sharing';

const listing = {
  title: 'Charizard & Friends',
  saleType: 'straight_sale' as const,
  priceCents: 125_00,
  startBidCents: null,
  currentBidCents: null,
  currency: 'TTD',
  category: 'trading_card',
  attributes: { condition: 'NM' },
  status: 'active',
  sellerName: 'Card Corner',
};

describe('listing sharing', () => {
  it('formats the listing price and catalog-backed condition', () => {
    expect(listingPriceLabel(listing)).toBe('TT$125.00');
    expect(listingConditionLabel(listing)).toBe('Near Mint');
    expect(listingSocialDescription(listing)).toBe(
      'TT$125.00 Condition: Near Mint Listed by Card Corner on CollectTT.',
    );
  });

  it('uses current bid for auctions and includes inactive availability', () => {
    const auction = {
      ...listing,
      saleType: 'auction' as const,
      priceCents: null,
      startBidCents: 80_00,
      currentBidCents: 95_00,
      status: 'ended_no_sale',
    };
    expect(listingPriceLabel(auction)).toBe('TT$95.00');
    expect(listingSocialDescription(auction)).toContain('Current bid TT$95.00');
    expect(listingSocialDescription(auction)).toContain('This auction has ended.');
  });

  it('creates encoded attributed URLs without changing the canonical path', () => {
    const result = new URL(attributedShareUrl('https://collecttt.com/listings/abc?existing=1', 'whatsapp'));
    expect(result.pathname).toBe('/listings/abc');
    expect(result.searchParams.get('existing')).toBe('1');
    expect(result.searchParams.get('ref')).toBe('share');
    expect(result.searchParams.get('utm_source')).toBe('whatsapp');
    expect(result.searchParams.get('utm_medium')).toBe('social');
  });

  it('builds concise share text with the listing URL', () => {
    expect(listingShareText({
      title: listing.title,
      priceLabel: 'TT$125.00',
      conditionLabel: 'Near Mint',
      saleType: 'straight_sale',
      url: 'https://collecttt.com/listings/abc',
    })).toBe('FOR SALE\n\nCharizard & Friends\nNear Mint\nTT$125.00\n\nView on CollectTT:\nhttps://collecttt.com/listings/abc');
  });
});
