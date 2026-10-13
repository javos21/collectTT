import { afterEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

// Keep Drizzle's real column decoders; only replace the PostgreSQL connection.
vi.mock('../../src/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  return { db: drizzle({ query } as never) };
});

import { updateListingBasics } from '../../src/services/listings';

afterEach(() => {
  vi.unstubAllEnvs();
  query.mockReset();
});

describe('listing edits with PostgreSQL enum arrays', () => {
  it('saves an edit when the driver returns fulfillment_paths as PostgreSQL array text', async () => {
    vi.stubEnv('COLLECTTT_LAUNCH_SCOPE', 'v1');
    const current = {
      title: 'Original title',
      description: null,
      sale_type: 'straight_sale',
      status: 'active',
      price_cents: '1000',
      accepts_offers: false,
      payment_window_hours: 72,
      // Custom enum array OIDs are not decoded by node-postgres by default.
      fulfillment_paths: '{cash_meetup,remote_ship}',
      meetup_location_id: null,
    };
    query.mockImplementation(async (config: { text: string; rowMode?: string }) => {
      if (/select[\s\S]*from "?listings"?\s+where/i.test(config.text)) {
        return { rows: config.rowMode === 'array' ? [Object.values(current)] : [current] };
      }
      if (config.text.includes('has_bid_activity')) {
        return { rows: [{ has_bid_activity: false, has_live_claims: false, has_open_transaction: false }] };
      }
      return { rows: [] };
    });

    await expect(updateListingBasics('seller', crypto.randomUUID(), {
      title: 'Updated title',
      priceCents: 1200,
      deliveryEstimates: { cash_meetup: 2, remote_ship: 7 },
    })).resolves.toBeUndefined();

    const writes = query.mock.calls.map(([config, params]) => ({ text: config.text as string, params }));
    expect(writes.find((write) => write.text.startsWith('update "listings"'))?.params).toContain('Updated title');
    const terms = writes.find((write) => write.text.startsWith('insert into "listing_fulfillment_terms"'));
    expect(terms?.params).toEqual(expect.arrayContaining(['cash_meetup', 2, 'remote_ship', 7]));
    expect(writes.some((write) => write.text.startsWith('insert into "listing_audit_events"'))).toBe(true);
  });
});
