/**
 * PHASE 2 CUSTODY FLOW TESTS.
 *
 * The physical half of a deal: drop-off, the payment-gated release, collection,
 * return-to-seller, and the re-link that lets a promoted buyer inherit an item that
 * never moved.
 *
 * Requires the local database: `docker compose up -d && npm run setup`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { db, pool } from '../../src/db/client';
import { users } from '../../src/db/schema/auth';
import { profiles, reputationCounters } from '../../src/db/schema/profiles';
import { listings } from '../../src/db/schema/listings';
import { relayStores, relayStoreStaff, custodyHoldings } from '../../src/db/schema/custody';
import { claimListing } from '../../src/db/atomic/claim-listing';

/**
 * A queue of codes the generator hands out before falling back to the real one. It is
 * empty for every test but the collision test, which uses it to force a unique
 * violation on the first INSERT and prove the retry recovers.
 */
const codes = vi.hoisted(() => ({ queue: [] as string[] }));

vi.mock('../../src/domain/dropoff-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/domain/dropoff-code')>();
  return {
    ...actual,
    generateDropoffCode: () => codes.queue.shift() ?? actual.generateDropoffCode(),
  };
});

const SUFFIX = randomUUID().slice(0, 8);
const seller = `c_seller_${SUFFIX}`;
const buyerA = `c_buyerA_${SUFFIX}`;
const buyerB = `c_buyerB_${SUFFIX}`;
const clerk = `c_clerk_${SUFFIX}`;
const everyone = [seller, buyerA, buyerB, clerk];

let storeId: string;

async function createUser(id: string): Promise<void> {
  await db.insert(users).values({ id, name: id, email: `${id}@test.local`, emailVerified: true });
  await db.insert(profiles).values({ userId: id, displayName: id, handle: id });
  await db.insert(reputationCounters).values({ userId: id });
}

async function makeRelayListing(over: Partial<typeof listings.$inferInsert> = {}): Promise<string> {
  const rows = await db
    .insert(listings)
    .values({
      sellerId: seller,
      category: 'trading_card',
      attributes: {},
      attributesVersion: 1,
      title: `Custody listing ${randomUUID().slice(0, 6)}`,
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 10_000,
      fulfillmentPaths: ['relay'],
      settlementMethods: ['cash'],
      sizeClass: 'small',
      publishedAt: new Date(),
      ...over,
    })
    .returning({ id: listings.id });
  const row = rows[0];
  if (row === undefined) throw new Error('failed to create listing');
  return row.id;
}

beforeAll(async () => {
  for (const id of everyone) await createUser(id);
  const stores = await db
    .insert(relayStores)
    .values({
      name: `Test Relay ${SUFFIX}`,
      area: 'Port of Spain',
      acceptsSizeClasses: ['small'],
      paidCustodyDays: 7,
      unpaidCustodyDays: 3,
    })
    .returning({ id: relayStores.id });
  storeId = stores[0]!.id;
  await db.insert(relayStoreStaff).values({ storeId, userId: clerk, role: 'staff' });
});

afterAll(async () => {
  // Raw pool queries: drizzles `sql` tag expands a JS array into separate
  // placeholders, which `= any(...)` will not accept.
  const q = (text: string, params: unknown[]) => pool.query(text, params as never[]);

  const ids = await db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.sellerId, seller));
  const listingIds = ids.map((l) => l.id);

  if (listingIds.length > 0) {
    const sub = `(select id from transactions where listing_id = any($1))`;
    await q(`delete from transaction_events where transaction_id in ${sub}`, [listingIds]);
    await q(`delete from reputation_events where transaction_id in ${sub}`, [listingIds]);
    await q(`update listings set active_transaction_id = null where id = any($1)`, [listingIds]);
    // custody_holdings and transactions reference each other; break the cycle first.
    await q(
      `update custody_holdings set current_transaction_id = null where listing_id = any($1)`,
      [listingIds],
    );
    await q(`delete from transactions where listing_id = any($1)`, [listingIds]);
    await q(`delete from custody_holdings where listing_id = any($1)`, [listingIds]);
    await q(`delete from claims where listing_id = any($1)`, [listingIds]);
    await q(`delete from listings where id = any($1)`, [listingIds]);
  }

  await db.delete(relayStoreStaff).where(eq(relayStoreStaff.storeId, storeId));
  await db.delete(relayStores).where(eq(relayStores.id, storeId));
  await q(`delete from notification_deliveries where user_id = any($1)`, [everyone]);
  await q(`delete from notifications where user_id = any($1)`, [everyone]);
  await q(`delete from reputation_events where user_id = any($1)`, [everyone]);
  await q(`delete from restrictions where user_id = any($1)`, [everyone]);
  await q(`delete from reputation_counters where user_id = any($1)`, [everyone]);
  await q(`delete from profiles where user_id = any($1)`, [everyone]);
  await q(`delete from "user" where id = any($1)`, [everyone]);
  await pool.end();
});

describe('drop-off code', () => {
  it('is generated when a holding opens', async () => {
    const listingId = await makeRelayListing();
    await claimListing({
      listingId,
      claimantId: buyerA,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });

    const holdings = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));

    expect(holdings).toHaveLength(1);
    expect(holdings[0]!.dropoffCode).toMatch(/^CT-[A-Z2-9]{4}$/);
  });

  it('retries past a collision with a code that is already taken', async () => {
    const takenListingId = await makeRelayListing();
    await claimListing({
      listingId: takenListingId,
      claimantId: buyerA,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });
    const taken = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, takenListingId));
    const takenCode = taken[0]!.dropoffCode;

    // The next holding to open draws a code that is already on the shelf.
    codes.queue.push(takenCode);

    const listingId = await makeRelayListing();
    await claimListing({
      listingId,
      claimantId: buyerB,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });

    expect(codes.queue).toHaveLength(0); // the colliding code really was handed out
    const holdings = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));
    expect(holdings).toHaveLength(1);
    expect(holdings[0]!.dropoffCode).not.toBe(takenCode);
    expect(holdings[0]!.dropoffCode).toMatch(/^CT-[A-Z2-9]{4}$/);
  });

  it('survives a re-link unchanged — the code belongs to the item, not the buyer', async () => {
    const listingId = await makeRelayListing();
    const first = await claimListing({
      listingId,
      claimantId: buyerA,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });
    // A backup buyer is waiting, so the failed attempt is followed by a real promotion.
    await claimListing({
      listingId,
      claimantId: buyerB,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });

    const before = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));
    const originalCode = before[0]!.dropoffCode;

    // The item is on the shelf when the first buyer's window lapses.
    await db
      .update(custodyHoldings)
      .set({ state: 'at_relay', droppedOffAt: sql`now()` })
      .where(eq(custodyHoldings.id, before[0]!.id));

    const { terminateTransaction } = await import('../../src/services/transactions');
    await db.transaction(async (tx) => {
      await terminateTransaction({
        tx,
        transactionId: first.transactionId!,
        reason: 'non_payment',
        actorRole: 'system',
      });
    });

    // The backup is promoted: a new transaction, the same item, the same shelf.
    const { promoteNextCandidate } = await import('../../src/services/transactions');
    const promotion = await db.transaction((tx) =>
      promoteNextCandidate(tx, listingId, first.transactionId!),
    );
    expect(promotion.promoted).toBe(true);

    const after = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));

    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id); // the same holding, re-linked
    expect(after[0]!.currentTransactionId).toBe(promotion.transactionId);
    expect(after[0]!.dropoffCode).toBe(originalCode);
    expect(after[0]!.state).toBe('at_relay'); // the item did not move
  });

  it('gives up rather than looping forever when every attempt collides', async () => {
    const takenListingId = await makeRelayListing();
    await claimListing({
      listingId: takenListingId,
      claimantId: buyerA,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });
    const taken = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, takenListingId));

    // More collisions than the retry is willing to absorb.
    codes.queue.push(...Array<string>(10).fill(taken[0]!.dropoffCode));

    const listingId = await makeRelayListing();
    await expect(
      claimListing({
        listingId,
        claimantId: buyerB,
        fulfillmentPath: 'relay',
        relayStoreId: storeId,
      }),
    ).rejects.toThrow();

    // The whole claim rolled back: no half-open holding left behind.
    const holdings = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));
    expect(holdings).toHaveLength(0);

    codes.queue.length = 0;
  });
});
