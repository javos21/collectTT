/**
 * BROWSE QUERY TESTS.
 *
 * browseListings backs the /listings page. These pin the two behaviours the page's
 * controls depend on: filtering by sale type, and stable pagination (a consistent
 * total while the returned slice moves with the page).
 *
 * Requires the local database: `docker compose up -d && npm run setup`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { db, pool } from '../../src/db/client';
import { users } from '../../src/db/schema/auth';
import { profiles, reputationCounters } from '../../src/db/schema/profiles';
import { listings } from '../../src/db/schema/listings';
import { browseListings } from '../../src/services/listings';

const SUFFIX = randomUUID().slice(0, 8);
const seller = `b_seller_${SUFFIX}`;
// A category of its own so the fixtures are isolated from any seed data on the shared DB.
const CATEGORY = 'trading_card';
const TAG = `browse-${SUFFIX}`;

async function makeListing(over: Partial<typeof listings.$inferInsert>): Promise<void> {
  await db.insert(listings).values({
    sellerId: seller,
    category: CATEGORY,
    // ★ A unique attribute tag lets the test scope its query to only its own rows,
    //   via the same JSONB-containment path the page uses.
    attributes: { browseTag: TAG },
    attributesVersion: 1,
    title: `Browse ${randomUUID().slice(0, 6)}`,
    saleType: 'straight_sale',
    status: 'active',
    priceCents: 5_000,
    fulfillmentPaths: ['cash_meetup'],
    settlementMethods: ['cash'],
    publishedAt: new Date(),
    ...over,
  });
}

const mine = { browseTag: TAG } as const;

beforeAll(async () => {
  await db.insert(users).values({ id: seller, name: seller, email: `${seller}@test.local`, emailVerified: true });
  await db.insert(profiles).values({ userId: seller, displayName: seller, handle: seller });
  await db.insert(reputationCounters).values({ userId: seller });

  // 5 straight sales + 3 auctions, all tagged.
  for (let i = 0; i < 5; i += 1) await makeListing({ saleType: 'straight_sale' });
  for (let i = 0; i < 3; i += 1) {
    await makeListing({
      saleType: 'auction',
      priceCents: null,
      startBidCents: 5_000,
      endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }
});

afterAll(async () => {
  await db.execute(sql`delete from listings where seller_id = ${seller}`);
  await db.execute(sql`delete from profiles where user_id = ${seller}`);
  await db.execute(sql`delete from "user" where id = ${seller}`);
  await pool.end();
});

describe('browseListings', () => {
  it('returns a total independent of the page slice', async () => {
    const result = await browseListings({ attributes: mine });
    expect(result.total).toBe(8);
    expect(result.rows.length).toBe(8);
  });

  it('filters by sale type', async () => {
    const sales = await browseListings({ attributes: mine, saleType: 'straight_sale' });
    expect(sales.total).toBe(5);
    expect(sales.rows.every((r) => r.saleType === 'straight_sale')).toBe(true);

    const auctions = await browseListings({ attributes: mine, saleType: 'auction' });
    expect(auctions.total).toBe(3);
    expect(auctions.rows.every((r) => r.saleType === 'auction')).toBe(true);
  });

  it('paginates: the slice moves, the total stays', async () => {
    const page1 = await browseListings({ attributes: mine, page: 1, pageSize: 3 });
    expect(page1.total).toBe(8);
    expect(page1.rows.length).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(3);

    const page3 = await browseListings({ attributes: mine, page: 3, pageSize: 3 });
    expect(page3.total).toBe(8);
    expect(page3.rows.length).toBe(2); // 8 rows, third page holds the remaining 2

    const ids1 = new Set(page1.rows.map((r) => r.id));
    expect(page3.rows.some((r) => ids1.has(r.id))).toBe(false);
  });
});
