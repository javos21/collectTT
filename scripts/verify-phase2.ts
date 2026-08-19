/**
 * Phase 2 end-to-end verification, against the REAL worker process.
 *
 * The custody flow tests call `custodyOverstay(...)` directly. That is exactly what
 * this script must NOT do. Its whole reason to exist is to prove the chain
 *
 *     web -> transactional enqueue -> Graphile Worker -> handler
 *
 * actually closes for the custody track. The overstay sweep is the one part of Phase 2
 * that unit tests structurally cannot prove, because it depends on the worker really
 * picking up a scheduled job and running the handler in its own process.
 *
 * Requires Postgres and the worker (it never contacts the web process):
 *   docker compose up -d
 *   npm run start:worker   (or npm run dev:worker)
 *
 * Run with: npm run verify:phase2
 */

import '../src/lib/load-env';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema/auth';
import { profiles, reputationCounters } from '../src/db/schema/profiles';
import { listings } from '../src/db/schema/listings';
import {
  relayStores,
  relayStoreStaff,
  custodyHoldings,
  listingRelayStores,
} from '../src/db/schema/custody';
import { notifications } from '../src/db/schema/notifications';
import { claimListing } from '../src/db/atomic/claim-listing';
import { markReceived } from '../src/services/custody';

const S = randomUUID().slice(0, 6);
const seller = `v2_seller_${S}`;
const buyer = `v2_buyer_${S}`;
const clerk = `v2_clerk_${S}`;
const everyone = [seller, buyer, clerk];

let storeId = '';
/** Job keys this run scheduled, so cleanup can withdraw anything still pending. */
const scheduledJobKeys: string[] = [];

async function mkUser(id: string) {
  await db.insert(users).values({ id, name: id, email: `${id}@verify.local`, emailVerified: true });
  await db.insert(profiles).values({ userId: id, displayName: id, handle: id });
  await db.insert(reputationCounters).values({ userId: id });
}

async function waitFor<T>(
  label: string,
  probe: () => Promise<T | undefined>,
  timeoutMs = 45_000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label} — is the worker running?`);
}

/** Schedule a task to run now, replacing any existing job with the same key. */
async function scheduleNow(task: string, payload: object, jobKey: string) {
  await pool.query(
    `select graphile_worker.add_job($1::text, $2::json, null, now(), 10, $3::text, 0, null, 'replace')`,
    [task, JSON.stringify(payload), jobKey],
  );
}

async function main(): Promise<void> {
  for (const id of everyone) await mkUser(id);

  // ─────────────────────────────────────────────── 1. a store, a shelf, an item
  console.log('1. standing up a relay store and a listing that nominates it…');
  const stores = await db
    .insert(relayStores)
    .values({
      name: `Verify Relay ${S}`,
      area: 'Port of Spain',
      acceptsSizeClasses: ['small'],
      paidCustodyDays: 7,
      unpaidCustodyDays: 3,
    })
    .returning({ id: relayStores.id });
  storeId = stores[0]!.id;
  await db.insert(relayStoreStaff).values({ storeId, userId: clerk, role: 'staff' });

  const listingRows = await db
    .insert(listings)
    .values({
      sellerId: seller,
      category: 'trading_card',
      attributes: {},
      attributesVersion: 1,
      title: `Verify custody ${S}`,
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 12_000,
      fulfillmentPaths: ['relay'],
      settlementMethods: ['cash'],
      sizeClass: 'small',
      publishedAt: new Date(),
    })
    .returning({ id: listings.id });
  const listingId = listingRows[0]!.id;
  await db.insert(listingRelayStores).values({ listingId, storeId });
  console.log(`   store ${storeId} accepts small items; listing ${listingId} nominates it`);

  // ─────────────────────────────────────────────── 2. claim opens the holding
  console.log('2. buyer claims on the relay path — a holding and a drop-off code open…');
  const claim = await claimListing({
    listingId,
    claimantId: buyer,
    fulfillmentPath: 'relay',
    relayStoreId: storeId,
  });
  if (claim.transactionId === undefined) throw new Error('the claim did not open a transaction');

  const opened = await db
    .select()
    .from(custodyHoldings)
    .where(eq(custodyHoldings.listingId, listingId));
  const holding = opened[0];
  if (holding === undefined) throw new Error('no custody holding was opened by the claim');
  if (!/^CT-[A-Z2-9]{4}$/.test(holding.dropoffCode)) {
    throw new Error(`drop-off code is not shaped like CT-XXXX: ${holding.dropoffCode}`);
  }
  if (holding.state !== 'awaiting_dropoff') throw new Error(`unexpected state ${holding.state}`);
  const holdingId = holding.id;
  console.log(`   holding ${holdingId} is awaiting drop-off under code ${holding.dropoffCode}`);

  // ─────────────────────────────────────────────── 3. drop-off arms the shelf clock
  console.log('3. the store receives the item — shelf clock set, sweeper enqueued…');
  await db.transaction(async (tx) => {
    await markReceived({ tx, holdingId, actorUserId: clerk, actorRole: 'store' });
  });

  const received = (
    await db.select().from(custodyHoldings).where(eq(custodyHoldings.id, holdingId))
  )[0];
  if (received?.state !== 'at_relay') throw new Error('the item was not marked received');
  if (received.custodyExpiresAt === null) throw new Error('the shelf clock was not set');
  if (received.droppedOffAt === null) throw new Error('the drop-off time was not recorded');
  console.log(`   on the shelf until ${received.custodyExpiresAt.toISOString()} (unpaid clock)`);

  // ★ The enqueue happened inside the same DB transaction as the clock change, so by
  //   the time that commit is visible the job must already be queued.
  const jobKey = `custody_overstay:${holdingId}`;
  scheduledJobKeys.push(jobKey);
  const queued = await pool.query<{ run_at: Date; future: boolean }>(
    `select run_at, run_at > now() as future
       from graphile_worker.jobs
      where task_identifier = 'custody:overstay' and key = $1`,
    [jobKey] as never[],
  );
  if (queued.rows.length !== 1) {
    throw new Error(`expected exactly 1 queued custody:overstay job, got ${queued.rows.length}`);
  }
  if (!queued.rows[0]!.future) {
    throw new Error('the sweeper was queued in the past — the shelf clock is wrong');
  }
  console.log(`   custody:overstay queued transactionally for ${queued.rows[0]!.run_at.toISOString()}`);

  // ─────────────────────────────────────────────── 4. THE POINT OF THIS SCRIPT
  console.log('4. forcing the shelf clock into the past and handing it to the WORKER…');
  // Server-authoritative time: the deadline moves on the DATABASE clock, never here.
  await db
    .update(custodyHoldings)
    .set({ custodyExpiresAt: sql`now() - interval '1 hour'` })
    .where(eq(custodyHoldings.id, holdingId));

  await scheduleNow('custody:overstay', { holdingId }, jobKey);

  const flagged = await waitFor('the worker to flag the overstay', async () => {
    const rows = await db
      .select()
      .from(custodyHoldings)
      .where(and(eq(custodyHoldings.id, holdingId), sql`overstay_flagged_at is not null`))
      .limit(1);
    return rows[0];
  });
  console.log(`   the worker flagged it at ${flagged.overstayFlaggedAt!.toISOString()}`);

  // ─────────────────────────────────────────────── 5. the store was actually told
  console.log('5. checking the store got an eviction notice with the owner contact…');
  const notice = await waitFor('the overstay notification for the store', async () => {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, clerk), eq(notifications.eventType, 'custody_overstay_store')),
      )
      .limit(1);
    return rows[0];
  });
  if (!notice.body.includes(`${seller}@verify.local`)) {
    throw new Error(`the eviction notice carries no owner contact: ${notice.body}`);
  }
  console.log(`   "${notice.title}" — contact ${seller}@verify.local`);

  console.log('\nPASS — Phase 2 custody rail verified against the live worker.');
  await cleanup();
  await pool.end();
}

async function cleanup(): Promise<void> {
  const q = (text: string, params: unknown[]) => pool.query(text, params as never[]);

  // Withdraw any sweep still pending against a holding we are about to delete. It would
  // no-op anyway (the handler's guard finds no row), but leaving orphans behind makes a
  // failed run's residue indistinguishable from real work.
  for (const key of scheduledJobKeys) {
    await q(`select graphile_worker.remove_job($1::text)`, [key]);
  }

  const ids = (
    await db.select({ id: listings.id }).from(listings).where(eq(listings.sellerId, seller))
  ).map((l) => l.id);

  if (ids.length > 0) {
    const sub = `(select id from transactions where listing_id = any($1))`;
    await q(`delete from transaction_events where transaction_id in ${sub}`, [ids]);
    await q(`delete from reputation_events where transaction_id in ${sub}`, [ids]);
    await q(`update listings set active_transaction_id = null where id = any($1)`, [ids]);
    // custody_holdings and transactions point at each other; break the cycle first.
    await q(`update custody_holdings set current_transaction_id = null where listing_id = any($1)`, [ids]);
    await q(`delete from transactions where listing_id = any($1)`, [ids]);
    await q(`delete from custody_holdings where listing_id = any($1)`, [ids]);
    // ★ claims.relay_store_id has no cascade, so claims must go before the store row.
    await q(`delete from claims where listing_id = any($1)`, [ids]);
    await q(`delete from bids where listing_id = any($1)`, [ids]);
    await q(`delete from listing_relay_stores where listing_id = any($1)`, [ids]);
    await q(`delete from listings where id = any($1)`, [ids]);
  }

  if (storeId !== '') {
    await q(`delete from relay_store_staff where store_id = $1`, [storeId]);
    await q(`delete from relay_stores where id = $1`, [storeId]);
  }

  await q(`delete from notification_deliveries where user_id = any($1)`, [everyone]);
  await q(`delete from notifications where user_id = any($1)`, [everyone]);
  await q(`delete from reputation_events where user_id = any($1)`, [everyone]);
  await q(`delete from restrictions where user_id = any($1)`, [everyone]);
  await q(`delete from reputation_counters where user_id = any($1)`, [everyone]);
  await q(`delete from profiles where user_id = any($1)`, [everyone]);
  await q(`delete from "user" where id = any($1)`, [everyone]);
}

main().catch(async (error: unknown) => {
  console.error('\nFAIL', error);
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
  await pool.end();
  process.exit(1);
});
