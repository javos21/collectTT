import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { db, pool } from '../../src/db/client';
import { users } from '../../src/db/schema/auth';
import { profiles, reputationCounters } from '../../src/db/schema/profiles';
import { images } from '../../src/db/schema/images';
import { listings, listingImages } from '../../src/db/schema/listings';
import { duplicateListingToDraft, getListing, markListingSoldOutside, relistListing } from '../../src/services/listings';
import { listingExpiry } from '../../src/jobs/tasks/listing-expiry';
import { auctionClose } from '../../src/jobs/tasks/auction-close';
import { notifications } from '../../src/db/schema/notifications';

const helpers = { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } } as never;

const suffix = randomUUID().slice(0, 8);
const seller = `m2_seller_${suffix}`;

beforeAll(async () => {
  await db.insert(users).values({ id: seller, name: seller, email: `${seller}@test.local`, emailVerified: true });
  await db.insert(profiles).values({ userId: seller, displayName: seller, handle: seller, phoneE164: `+1868555${suffix.replace(/\D/g, '').padEnd(4, '0').slice(0, 4)}` });
  await db.insert(reputationCounters).values({ userId: seller });
});

afterAll(async () => {
  await db.execute(sql`delete from listings where seller_id = ${seller}`);
  await db.execute(sql`delete from images where owner_user_id = ${seller}`);
  await db.execute(sql`delete from profiles where user_id = ${seller}`);
  await db.execute(sql`delete from "user" where id = ${seller}`);
  await pool.end();
});

describe('Milestone 2 listing lifecycle', () => {
  it('keeps sold-outside history and relists as a distinct draft with media', async () => {
    const image = await db.insert(images).values({ ownerUserId: seller, status: 'ready', r2KeyOriginal: `m2/${suffix}.jpg`, variants: { thumb: { key: `m2/${suffix}-thumb.jpg` } } }).returning({ id: images.id });
    const listing = await db.insert(listings).values({
      sellerId: seller,
      category: 'trading_card',
      attributes: { game: 'pokemon', condition: 'NM' },
      attributesVersion: 2,
      title: `M2 listing ${suffix}`,
      description: 'A complete v1 listing used by the lifecycle acceptance test.',
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 2500,
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning({ id: listings.id });
    const sourceId = listing[0]!.id;
    await db.insert(listingImages).values({ listingId: sourceId, imageId: image[0]!.id, position: 0 });

    await markListingSoldOutside(seller, sourceId);
    const draft = await relistListing(seller, sourceId);
    const sourceAfter = (await db.select({ status: listings.status }).from(listings).where(eq(listings.id, sourceId)))[0];
    const copy = (await db.select().from(listings).where(eq(listings.id, draft.id)))[0];
    const copiedImages = await db.select().from(listingImages).where(eq(listingImages.listingId, draft.id));

    expect(sourceAfter?.status).toBe('sold_outside');
    expect(copy?.status).toBe('draft');
    expect(copy?.title).toBe(`M2 listing ${suffix}`);
    expect(copiedImages).toEqual([{ listingId: draft.id, imageId: image[0]!.id, position: 0 }]);
  });

  it('rejects relisting a still-active listing through the relist-only entry point', async () => {
    const listing = await db.insert(listings).values({
      sellerId: seller,
      category: 'trading_card',
      attributes: { game: 'pokemon', condition: 'NM' },
      attributesVersion: 2,
      title: `Active M2 ${suffix}`,
      description: 'Active listing for relist guard.',
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 1000,
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
      publishedAt: new Date(),
    }).returning({ id: listings.id });
    await expect(relistListing(seller, listing[0]!.id)).rejects.toThrow(/expired or sold-outside/i);
  });

  it('expires a fixed-price listing once and notifies the seller', async () => {
    const listing = await db.insert(listings).values({
      sellerId: seller,
      category: 'trading_card',
      attributes: { game: 'pokemon', condition: 'NM' },
      attributesVersion: 2,
      title: `Expiry M2 ${suffix}`,
      description: 'Listing that should expire.',
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 1200,
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() - 60_000),
    }).returning({ id: listings.id });
    await listingExpiry({ listingId: listing[0]!.id }, helpers);
    await listingExpiry({ listingId: listing[0]!.id }, helpers);
    const after = (await db.select({ status: listings.status }).from(listings).where(eq(listings.id, listing[0]!.id)))[0];
    const notice = (await db.select().from(notifications).where(eq(notifications.userId, seller))).find((row) => row.eventType === 'listing_expired_seller' && row.data && typeof row.data === 'object' && (row.data as { listingTitle?: string }).listingTitle === `Expiry M2 ${suffix}`);
    expect(after?.status).toBe('expired');
    expect(notice).toBeDefined();
  });

  it('keeps drafts private to the seller', async () => {
    const listing = await db.insert(listings).values({
      sellerId: seller,
      category: 'trading_card',
      attributes: {},
      attributesVersion: 2,
      title: `Private draft ${suffix}`,
      saleType: 'straight_sale',
      status: 'draft',
      priceCents: 1000,
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
    }).returning({ id: listings.id });
    expect(await getListing(listing[0]!.id)).toBeNull();
    expect(await getListing(listing[0]!.id, seller)).not.toBeNull();
  });

  it('marks a no-winner auction expired in v1', async () => {
    const listing = await db.insert(listings).values({
      sellerId: seller,
      category: 'trading_card',
      attributes: { game: 'pokemon', condition: 'NM' },
      attributesVersion: 2,
      title: `Auction expiry ${suffix}`,
      description: 'Auction with no winning transaction.',
      saleType: 'auction',
      status: 'active',
      startBidCents: 1000,
      endsAt: new Date(Date.now() - 60_000),
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
      publishedAt: new Date(),
    }).returning({ id: listings.id });
    await auctionClose({ listingId: listing[0]!.id }, helpers);
    const after = (await db.select({ status: listings.status }).from(listings).where(eq(listings.id, listing[0]!.id)))[0];
    expect(after?.status).toBe('expired');
  });
});
