import { describe, expect, it } from 'vitest';

import { listingInputSchema } from '../../src/services/listings';

const baseInput = {
  category: 'collectibles',
  title: 'A valid listing title',
  saleType: 'straight_sale' as const,
  priceCents: 1000,
  fulfillmentPaths: ['cash_meetup'] as const,
  settlementMethods: ['cash'],
};

describe('listing meetup locations', () => {
  it('accepts up to three public meetup choices', () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    expect(listingInputSchema.parse({ ...baseInput, meetupLocationIds: ids }).meetupLocationIds).toEqual(ids);
  });

  it('rejects more than three public meetup choices', () => {
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    const result = listingInputSchema.safeParse({ ...baseInput, meetupLocationIds: ids });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Choose no more than 3 meetup locations');
  });
});
