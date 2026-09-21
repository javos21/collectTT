import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUser = vi.hoisted(() => vi.fn(async () => ({ userId: 'buyer-1' })));
const claimListing = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}));

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ currentUser }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { claim: { limit: 10, windowSeconds: 60 } },
  enforceUserAndIpRateLimit: vi.fn(),
}));
vi.mock('@/db/atomic/claim-listing', () => ({ claimListing }));

describe('claim failure feedback contract', () => {
  beforeEach(() => {
    vi.resetModules();
    claimListing.mockReset();
    redirect.mockClear();
  });

  it('redirects an unsuccessful buyer back with a structured unavailable outcome', async () => {
    claimListing.mockRejectedValue(new Error('This item was just claimed by another collector.'));
    const { claimAction } = await import('@/app/listings/[id]/actions');
    const formData = new FormData();
    formData.set('listingId', 'listing-1');
    formData.set('deliveryOptionId', 'delivery-1');
    formData.set('settlementMethod', 'cash');
    formData.set('commitmentAcknowledged', 'yes');

    await expect(claimAction(formData)).rejects.toThrow('REDIRECT:');
    expect(redirect).toHaveBeenCalledWith(
      '/listings/listing-1?error=This+item+was+just+claimed+by+another+collector.&errorCode=listing_unavailable',
    );
  });
});
