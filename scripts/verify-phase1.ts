/**
 * Phase 1 end-to-end verification, against the REAL worker process.
 *
 * The flow tests call job handlers directly. This script instead schedules real jobs and
 * waits for the worker to pick them up, which is the only way to prove the chain
 * web -> transactional enqueue -> Graphile Worker -> handler actually closes.
 *
 * Requires Postgres and the worker (it never contacts the web process):
 *   docker compose up -d
 *   npm run start:worker   (or npm run dev:worker)
 *
 * Run with: npm run verify:phase1
 */

import '../src/lib/load-env';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema/auth';
import { profiles, reputationCounters, reputationEvents } from '../src/db/schema/profiles';
import { listings, claims } from '../src/db/schema/listings';
import { transactions } from '../src/db/schema/transactions';
import { claimListing } from '../src/db/atomic/claim-listing';
import { placeBid } from '../src/db/atomic/place-bid';
import { formatMoney } from '../src/domain/money';

const S = randomUUID().slice(0, 6);
const seller = `v1_seller_${S}`;
const buyerA = `v1_buyerA_${S}`;
const buyerB = `v1_buyerB_${S}`;
const everyone = [seller, buyerA, buyerB];

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

  // ─────────────────────────────────────────────── 1. auction close via the worker
  console.log('1. auction: two bids, then let the WORKER close it…');
  const auctionRows = await db
    .insert(listings)
    .values({
      sellerId: seller,
      category: 'trading_card',
      attributes: {},
      attributesVersion: 1,
      title: `Verify auction ${S}`,
      saleType: 'auction',
      status: 'active',
      startBidCents: 5_000,
      endsAt: new Date(Date.now() + 3600_000),
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
      publishedAt: new Date(),
    })
    .returning({ id: listings.id });
  const auctionId = auctionRows[0]!.id;

  await placeBid({ listingId: auctionId, bidderId: buyerA, amountCents: 6_000 });
  const second = await placeBid({ listingId: auctionId, bidderId: buyerB, amountCents: 9_000 });
  console.log(`   top bid ${formatMoney(second.amountCents)} by buyerB`);

  // Bring the deadline forward and let the real worker resolve it.
  await db
    .update(listings)
    .set({ endsAt: sql`now() - interval '1 second'` })
    .where(eq(listings.id, auctionId));
  await scheduleNow('auction:close', { listingId: auctionId }, `auction_close:${auctionId}`);

  const winnerTx = await waitFor('the worker to close the auction', async () => {
    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.listingId, auctionId), eq(transactions.state, 'open')))
      .limit(1);
    return rows[0];
  });

  if (winnerTx.buyerId !== buyerB) throw new Error(`wrong winner: ${winnerTx.buyerId}`);
  if (winnerTx.amountCents !== 9_000) throw new Error(`wrong amount: ${winnerTx.amountCents}`);
  console.log(`   worker closed it — buyerB owes ${formatMoney(winnerTx.amountCents)}`);

  // ─────────────────────────────────────────────── 2. renege + runner-up promotion
  console.log('2. winner never pays — worker should renege and promote the runner-up…');
  await db
    .update(transactions)
    .set({ paymentDeadlineAt: sql`now() - interval '1 hour'` })
    .where(eq(transactions.id, winnerTx.id));
  await scheduleNow(
    'transaction:payment_window',
    { transactionId: winnerTx.id },
    `payment_window:${winnerTx.id}`,
  );

  const promoted = await waitFor('the runner-up to be promoted', async () => {
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.listingId, auctionId),
          eq(transactions.state, 'open'),
          eq(transactions.source, 'auction_runner_up'),
        ),
      )
      .limit(1);
    return rows[0];
  });

  if (promoted.buyerId !== buyerA) throw new Error(`wrong runner-up: ${promoted.buyerId}`);
  // ★ They owe THEIR bid, not the winner's.
  if (promoted.amountCents !== 6_000) {
    throw new Error(`runner-up should owe their own bid 6000, got ${promoted.amountCents}`);
  }
  console.log(`   promoted buyerA at THEIR bid ${formatMoney(promoted.amountCents)}`);

  const reneged = (
    await db.select().from(transactions).where(eq(transactions.id, winnerTx.id))
  )[0];
  if (reneged?.state !== 'reneged_buyer') throw new Error(`expected reneged_buyer`);

  const facts = await db
    .select()
    .from(reputationEvents)
    .where(
      and(eq(reputationEvents.transactionId, winnerTx.id), eq(reputationEvents.userId, buyerB)),
    );
  if (facts.length !== 1) throw new Error(`expected 1 reputation fact, got ${facts.length}`);
  console.log(`   recorded "${facts[0]!.type}" against buyerB exactly once`);

  // ─────────────────────────────────────────────── 3. straight-sale backup stack
  console.log('3. straight sale: claim + backup, then let the window lapse…');
  const saleRows = await db
    .insert(listings)
    .values({
      sellerId: seller,
      category: 'comic',
      attributes: {},
      attributesVersion: 1,
      title: `Verify sale ${S}`,
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 25_000,
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash'],
      publishedAt: new Date(),
    })
    .returning({ id: listings.id });
  const saleId = saleRows[0]!.id;

  const first = await claimListing({
    listingId: saleId,
    claimantId: buyerA,
    fulfillmentPath: 'cash_meetup',
  });
  const backup = await claimListing({
    listingId: saleId,
    claimantId: buyerB,
    fulfillmentPath: 'cash_meetup',
  });
  console.log(`   buyerA ${first.outcome}, buyerB ${backup.outcome} (#${backup.position})`);

  await db
    .update(transactions)
    .set({ paymentDeadlineAt: sql`now() - interval '1 hour'` })
    .where(eq(transactions.id, first.transactionId!));
  await scheduleNow(
    'transaction:payment_window',
    { transactionId: first.transactionId! },
    `payment_window:${first.transactionId!}`,
  );

  const promotedClaim = await waitFor('the backup claimer to be promoted', async () => {
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.listingId, saleId),
          eq(transactions.state, 'open'),
          eq(transactions.source, 'claim_promotion'),
        ),
      )
      .limit(1);
    return rows[0];
  });

  if (promotedClaim.buyerId !== buyerB) throw new Error('wrong claimer promoted');
  if (promotedClaim.amountCents !== 25_000) throw new Error('promoted at the wrong price');
  if (promotedClaim.attemptNumber !== 2) throw new Error('attempt number did not advance');
  console.log(`   worker promoted buyerB at ${formatMoney(promotedClaim.amountCents)} (attempt 2)`);

  // ─────────────────────────────────────────────── 4. notifications actually delivered
  console.log('4. checking the notification dispatcher ran…');
  const delivered = await waitFor('notifications to be dispatched', async () => {
    const rows = await pool.query<{ n: string }>(
      `select count(*)::int as n from notification_deliveries
        where user_id = any($1) and channel = 'email' and status = 'sent'`,
      [everyone] as never[],
    );
    const n = Number(rows.rows[0]?.n ?? 0);
    return n > 0 ? n : undefined;
  });
  console.log(`   ${delivered} email notification(s) delivered by the worker`);

  console.log('\nPASS — Phase 1 trading loop verified against the live worker.');
  await cleanup();
  await pool.end();
}

async function cleanup(): Promise<void> {
  const ids = (
    await db.select({ id: listings.id }).from(listings).where(eq(listings.sellerId, seller))
  ).map((l) => l.id);
  const q = (text: string, params: unknown[]) => pool.query(text, params as never[]);

  if (ids.length > 0) {
    const sub = `(select id from transactions where listing_id = any($1))`;
    await q(`delete from transaction_events where transaction_id in ${sub}`, [ids]);
    await q(`update listings set active_transaction_id = null where id = any($1)`, [ids]);
    await q(`delete from reputation_events where transaction_id in ${sub}`, [ids]);
    await q(`delete from transactions where listing_id = any($1)`, [ids]);
    await q(`delete from claims where listing_id = any($1)`, [ids]);
    await q(`delete from bids where listing_id = any($1)`, [ids]);
    await q(`delete from listings where id = any($1)`, [ids]);
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
