/**
 * PHASE 1 FLOW TESTS.
 *
 * These exercise the behaviours that only show up under real concurrency and real
 * scheduling — the ones unit tests structurally cannot reach:
 *
 *   · N simultaneous claims resolve to exactly one winner and an ordered backup stack
 *   · N simultaneous bids produce a total order with no lost updates
 *   · a lapsed payment window renegesd, records the fact, and promotes the next candidate
 *   · a late bid extends the auction, and the close job reschedules rather than closing
 *   · a reneged auction winner hands off to the runner-up AT THEIR OWN BID
 *
 * Requires the local database: `docker compose up -d && npm run setup`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db, pool } from '../../src/db/client';
import { users } from '../../src/db/schema/auth';
import { profiles, reputationCounters, reputationEvents } from '../../src/db/schema/profiles';
import { listings, claims, bids } from '../../src/db/schema/listings';
import { offers } from '../../src/db/schema/offers';
import { transactions } from '../../src/db/schema/transactions';
import { claimListing } from '../../src/db/atomic/claim-listing';
import { placeBid } from '../../src/db/atomic/place-bid';
import { markPaid, confirmPayment, disputePayment } from '../../src/services/transactions';
import { acceptOffer, rejectOffer, submitOffer } from '../../src/services/offers';
import { auctionClose } from '../../src/jobs/tasks/auction-close';
import {
  paymentWindowExpired,
  promoteNext,
} from '../../src/jobs/tasks/transaction-windows';

// Graphile Worker passes a Helpers object; the handlers only use `logger`.
const helpers = {
  logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
} as never;

const SUFFIX = randomUUID().slice(0, 8);
const seller = `t_seller_${SUFFIX}`;
const buyers = Array.from({ length: 6 }, (_, i) => `t_buyer${i}_${SUFFIX}`);
const everyone = [seller, ...buyers];

async function createUser(id: string): Promise<void> {
  await db.insert(users).values({ id, name: id, email: `${id}@test.local`, emailVerified: true });
  await db.insert(profiles).values({ userId: id, displayName: id, handle: id });
  await db.insert(reputationCounters).values({ userId: id });
}

async function makeListing(over: Partial<typeof listings.$inferInsert> = {}): Promise<string> {
  const rows = await db
    .insert(listings)
    .values({
      sellerId: seller,
      category: 'trading_card',
      attributes: {},
      attributesVersion: 1,
      title: `Test listing ${randomUUID().slice(0, 6)}`,
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 10_000,
      fulfillmentPaths: ['cash_meetup', 'remote_ship'],
      settlementMethods: ['cash'],
      publishedAt: new Date(),
      ...over,
    })
    .returning({ id: listings.id });
  const row = rows[0];
  if (row === undefined) throw new Error('failed to create listing');
  return row.id;
}

/** Force a deadline into the past so the expiry job has something to do. */
async function expirePaymentWindow(transactionId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ paymentDeadlineAt: sql`now() - interval '1 hour'` })
    .where(eq(transactions.id, transactionId));
}

async function openTransactionFor(listingId: string) {
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open')))
    .limit(1);
  return rows[0];
}

beforeAll(async () => {
  for (const id of everyone) await createUser(id);
});

afterAll(async () => {
  const ids = await db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.sellerId, seller));
  const listingIds = ids.map((l) => l.id);

  // Raw pool queries here: drizzle's `sql` tag expands a JS array into separate
  // placeholders, which `= any(...)` will not accept. node-postgres binds it as a
  // real array.
  const q = (text: string, params: unknown[]) => pool.query(text, params as never[]);

  if (listingIds.length > 0) {
    const sub = `(select id from transactions where listing_id = any($1))`;
    await q(`delete from transaction_events where transaction_id in ${sub}`, [listingIds]);
    await q(`update listings set active_transaction_id = null where id = any($1)`, [listingIds]);
    await q(`delete from reputation_events where transaction_id in ${sub}`, [listingIds]);
    await q(`delete from transactions where listing_id = any($1)`, [listingIds]);
    await q(`delete from claims where listing_id = any($1)`, [listingIds]);
    await q(`delete from bids where listing_id = any($1)`, [listingIds]);
    await q(`delete from listings where id = any($1)`, [listingIds]);
  }

  await q(`delete from notification_deliveries where user_id = any($1)`, [everyone]);
  await q(`delete from notifications where user_id = any($1)`, [everyone]);
  await q(`delete from reputation_events where user_id = any($1)`, [everyone]);
  await q(`delete from restrictions where user_id = any($1)`, [everyone]);
  await q(`delete from reputation_counters where user_id = any($1)`, [everyone]);
  await q(`delete from profiles where user_id = any($1)`, [everyone]);
  await q(`delete from "user" where id = any($1)`, [everyone]);
  await pool.end();
});

// ════════════════════════════════════════════════════════ atomic claim

describe('★ atomic straight-sale claim', () => {
  it('resolves 6 SIMULTANEOUS claims to exactly one winner and an ordered stack', async () => {
    const listingId = await makeListing();

    // All six fire at once against the same row.
    const results = await Promise.allSettled(
      buyers.map((b) =>
        claimListing({ listingId, claimantId: b, fulfillmentPath: 'cash_meetup' }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const claimed = fulfilled.filter(
      (r) => (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome === 'claimed',
    );
    const queued = fulfilled.filter(
      (r) => (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome === 'queued',
    );

    // ★ Exactly one winner, decided by the database, not by luck of ordering.
    expect(claimed).toHaveLength(1);

    // The stack is capped at 3 total live claimants (1 active + 2 queued).
    expect(queued.length).toBeLessThanOrEqual(2);
    expect(claimed.length + queued.length).toBeLessThanOrEqual(3);

    const rows = await db.select().from(claims).where(eq(claims.listingId, listingId));
    expect(rows.filter((c) => c.status === 'active')).toHaveLength(1);

    // Positions are unique and contiguous from 1.
    const positions = rows.map((c) => c.position).sort((a, b) => a - b);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions[0]).toBe(1);

    // The listing moved to claimed, with exactly one open transaction.
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('claimed');

    const open = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open')));
    expect(open).toHaveLength(1);
  });

  it('refuses a seller claiming their own listing', async () => {
    const listingId = await makeListing();
    await expect(
      claimListing({ listingId, claimantId: seller, fulfillmentPath: 'cash_meetup' }),
    ).rejects.toThrow(/your own listing/i);
  });

  it('refuses a fulfillment path the seller does not accept', async () => {
    const listingId = await makeListing({ fulfillmentPaths: ['cash_meetup'] });
    await expect(
      claimListing({ listingId, claimantId: buyers[0]!, fulfillmentPath: 'relay' }),
    ).rejects.toThrow(/does not accept/i);
  });

  it('is idempotent — claiming twice returns the same position', async () => {
    const listingId = await makeListing();
    const first = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      fulfillmentPath: 'cash_meetup',
    });
    const second = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      fulfillmentPath: 'cash_meetup',
    });
    expect(second.outcome).toBe(first.outcome);
    expect(second.transactionId).toBe(first.transactionId);
  });
});

describe('★ fixed-price offers', () => {
  it('records one pending offer without reserving the listing', async () => {
    const listingId = await makeListing({ priceCents: 10_000 });

    const first = await submitOffer({
      listingId,
      buyerId: buyers[0]!,
      amountCents: 8_000,
      fulfillmentPath: 'cash_meetup',
    });
    const duplicate = await submitOffer({
      listingId,
      buyerId: buyers[0]!,
      amountCents: 7_000,
      fulfillmentPath: 'cash_meetup',
    });

    expect(duplicate.id).toBe(first.id);
    const offer = (await db.select().from(offers).where(eq(offers.id, first.id)))[0];
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    const open = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open')));

    expect(offer?.status).toBe('pending');
    expect(offer?.amountCents).toBe(8_000);
    expect(listing?.status).toBe('active');
    expect(open).toHaveLength(0);
  });

  it('requires a below-asking amount and lets a buyer try again after rejection', async () => {
    const listingId = await makeListing({ priceCents: 10_000 });

    await expect(
      submitOffer({
        listingId,
        buyerId: buyers[1]!,
        amountCents: 10_000,
        fulfillmentPath: 'cash_meetup',
      }),
    ).rejects.toThrow('below the asking price');

    const first = await submitOffer({
      listingId,
      buyerId: buyers[1]!,
      amountCents: 7_500,
      fulfillmentPath: 'cash_meetup',
    });
    await rejectOffer(first.id, seller);

    const second = await submitOffer({
      listingId,
      buyerId: buyers[1]!,
      amountCents: 8_000,
      fulfillmentPath: 'cash_meetup',
    });

    expect(second.id).not.toBe(first.id);
    expect((await db.select().from(offers).where(eq(offers.id, first.id)))[0]?.status).toBe('rejected');
    expect((await db.select().from(offers).where(eq(offers.id, second.id)))[0]?.status).toBe('pending');
  });

  it('rejects pending offers when another buyer claims at the asking price', async () => {
    const listingId = await makeListing({ priceCents: 10_000 });
    const offer = await submitOffer({
      listingId,
      buyerId: buyers[4]!,
      amountCents: 8_000,
      fulfillmentPath: 'cash_meetup',
    });

    await claimListing({
      listingId,
      claimantId: buyers[5]!,
      fulfillmentPath: 'cash_meetup',
    });

    expect((await db.select().from(offers).where(eq(offers.id, offer.id)))[0]?.status).toBe('rejected');
  });

  it('accepts one offer atomically, rejects competitors, and opens the normal deal', async () => {
    const listingId = await makeListing({ priceCents: 10_000 });
    const first = await submitOffer({
      listingId,
      buyerId: buyers[2]!,
      amountCents: 8_000,
      fulfillmentPath: 'cash_meetup',
    });
    const second = await submitOffer({
      listingId,
      buyerId: buyers[3]!,
      amountCents: 8_500,
      fulfillmentPath: 'cash_meetup',
    });

    const result = await acceptOffer(first.id, seller);
    const accepted = (await db.select().from(offers).where(eq(offers.id, first.id)))[0];
    const rejected = (await db.select().from(offers).where(eq(offers.id, second.id)))[0];
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    const opened = (await db.select().from(transactions).where(eq(transactions.id, result.transactionId)))[0];

    expect(accepted?.status).toBe('accepted');
    expect(rejected?.status).toBe('rejected');
    expect(listing?.status).toBe('claimed');
    expect(opened?.source).toBe('offer_accept');
    expect(opened?.offerId).toBe(first.id);
    expect(opened?.buyerId).toBe(buyers[2]);
    expect(opened?.amountCents).toBe(8_000);

    // An accepted offer uses the normal buyer expiry path and respects the listing's
    // auto-relist setting, rather than leaving the listing permanently claimed.
    await expirePaymentWindow(result.transactionId);
    await paymentWindowExpired({ transactionId: result.transactionId }, helpers);
    await promoteNext({ listingId, failedTransactionId: result.transactionId }, helpers);
    expect((await db.select().from(listings).where(eq(listings.id, listingId)))[0]?.status).toBe('active');
  });
});

// ════════════════════════════════════════════════════════ handshake

describe('★ mark-paid / confirm-received handshake', () => {
  it('completes a deal and records the objective facts for both sides', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      fulfillmentPath: 'cash_meetup',
    });
    const txId = claim.transactionId!;

    await db.transaction(async (tx) => markPaid(tx, txId, buyers[0]!));
    let row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];
    expect(row?.paymentState).toBe('buyer_marked_paid');
    expect(row?.state).toBe('open'); // not complete on the buyer's say-so alone

    await db.transaction(async (tx) => confirmPayment(tx, txId, seller));
    row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];

    expect(row?.paymentState).toBe('confirmed');
    expect(row?.state).toBe('completed');
    expect(row?.completedAt).not.toBeNull();

    // The listing is done.
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('ended_won');

    // Objective facts recorded for both parties, exactly once each.
    const events = await db
      .select()
      .from(reputationEvents)
      .where(eq(reputationEvents.transactionId, txId));
    const types = events.map((e) => e.type);
    expect(types).toContain('purchase_completed');
    expect(types).toContain('sale_completed');
    expect(types).toContain('buyer_paid_on_time');
  });

  it('refuses to let the buyer confirm their own payment', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({
      listingId,
      claimantId: buyers[1]!,
      fulfillmentPath: 'cash_meetup',
    });
    const txId = claim.transactionId!;
    await db.transaction(async (tx) => markPaid(tx, txId, buyers[1]!));

    await expect(
      db.transaction(async (tx) => confirmPayment(tx, txId, buyers[1]!)),
    ).rejects.toThrow(/only the seller/i);
  });

  it('★ a dispute returns the deal to pending WITHOUT extending the deadline', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({
      listingId,
      claimantId: buyers[2]!,
      fulfillmentPath: 'cash_meetup',
    });
    const txId = claim.transactionId!;

    const before = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];
    const originalDeadline = before!.paymentDeadlineAt.getTime();

    await db.transaction(async (tx) => markPaid(tx, txId, buyers[2]!));
    await db.transaction(async (tx) => disputePayment(tx, txId, seller));

    const after = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];
    expect(after?.paymentState).toBe('pending');
    expect(after?.markedPaidAt).toBeNull();
    expect(after?.paymentDisputedAt).not.toBeNull();
    // ★ The clock did not move. A seller cannot run out a buyer's window with disputes.
    expect(after!.paymentDeadlineAt.getTime()).toBe(originalDeadline);
  });
});

// ════════════════════════════════════════════════════════ renege + promotion

describe('★ payment window lapse → renege → promote the backup', () => {
  it('hands the item to the next claimer at the same price, with a fresh window', async () => {
    const listingId = await makeListing();

    const first = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      fulfillmentPath: 'cash_meetup',
    });
    const backup = await claimListing({
      listingId,
      claimantId: buyers[1]!,
      fulfillmentPath: 'cash_meetup',
    });
    expect(first.outcome).toBe('claimed');
    expect(backup.outcome).toBe('queued');

    const firstTxId = first.transactionId!;
    await expirePaymentWindow(firstTxId);
    await paymentWindowExpired({ transactionId: firstTxId }, helpers);

    // The first buyer reneged and the fact is on their record.
    const failed = (await db.select().from(transactions).where(eq(transactions.id, firstTxId)))[0];
    expect(failed?.state).toBe('reneged_buyer');
    expect(failed?.paymentState).toBe('failed');
    expect(failed?.terminatedReason).toBe('buyer_no_show'); // cash_meetup reads as a no-show

    const facts = await db
      .select()
      .from(reputationEvents)
      .where(
        and(eq(reputationEvents.transactionId, firstTxId), eq(reputationEvents.userId, buyers[0]!)),
      );
    expect(facts.length).toBeGreaterThan(0);

    // Promotion runs as its own job (enqueued in the same transaction as the renege).
    await promoteNext({ listingId, failedTransactionId: firstTxId }, helpers);

    const promoted = await openTransactionFor(listingId);
    expect(promoted).toBeDefined();
    expect(promoted?.buyerId).toBe(buyers[1]!);
    expect(promoted?.attemptNumber).toBe(2);
    expect(promoted?.source).toBe('claim_promotion');
    expect(promoted?.amountCents).toBe(10_000);
    // A fresh window, not the inherited one.
    expect(promoted!.paymentDeadlineAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('never re-promotes someone who already reneged on the same listing', async () => {
    const listingId = await makeListing();
    const first = await claimListing({
      listingId,
      claimantId: buyers[3]!,
      fulfillmentPath: 'cash_meetup',
    });

    await expirePaymentWindow(first.transactionId!);
    await paymentWindowExpired({ transactionId: first.transactionId! }, helpers);
    await promoteNext({ listingId, failedTransactionId: first.transactionId! }, helpers);

    // No backups existed, and the reneged buyer must not be handed it again.
    const open = await openTransactionFor(listingId);
    expect(open).toBeUndefined();

    // auto_relist defaults true, so the listing goes back on the shelf.
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('active');
  });

  it('does not renege a deal whose payment was already confirmed', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({
      listingId,
      claimantId: buyers[4]!,
      fulfillmentPath: 'cash_meetup',
    });
    const txId = claim.transactionId!;

    await db.transaction(async (tx) => markPaid(tx, txId, buyers[4]!));
    await db.transaction(async (tx) => confirmPayment(tx, txId, seller));

    await expirePaymentWindow(txId);
    await paymentWindowExpired({ transactionId: txId }, helpers);

    const row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];
    expect(row?.state).toBe('completed'); // untouched
  });

  it('is idempotent — a duplicate expiry delivery changes nothing', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({
      listingId,
      claimantId: buyers[5]!,
      fulfillmentPath: 'cash_meetup',
    });
    const txId = claim.transactionId!;

    await expirePaymentWindow(txId);
    await paymentWindowExpired({ transactionId: txId }, helpers);
    await paymentWindowExpired({ transactionId: txId }, helpers);
    await paymentWindowExpired({ transactionId: txId }, helpers);

    // The unique index on (transaction, user, type) means the fact is recorded once.
    const facts = await db
      .select()
      .from(reputationEvents)
      .where(
        and(eq(reputationEvents.transactionId, txId), eq(reputationEvents.userId, buyers[5]!)),
      );
    expect(facts).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════ auctions

describe('★ auctions: bidding, anti-snipe, close', () => {
  const auctionListing = async (over: Partial<typeof listings.$inferInsert> = {}) =>
    makeListing({
      saleType: 'auction',
      priceCents: null,
      startBidCents: 5_000,
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      antisnipeWindowS: 120,
      antisnipeExtendS: 120,
      ...over,
    });

  it('produces a TOTAL ORDER under 6 simultaneous bids, with no lost updates', async () => {
    const listingId = await auctionListing();

    // Distinct amounts; the unique index rejects ties outright.
    const amounts = [6_000, 7_000, 8_000, 9_000, 10_000, 11_000];
    const results = await Promise.allSettled(
      amounts.map((amount, i) =>
        placeBid({ listingId, bidderId: buyers[i]!, amountCents: amount }),
      ),
    );

    const accepted = results.filter((r) => r.status === 'fulfilled');
    expect(accepted.length).toBeGreaterThan(0);

    const stored = await db
      .select()
      .from(bids)
      .where(eq(bids.listingId, listingId))
      .orderBy(sql`${bids.amountCents} desc`);

    // Every stored amount is unique — the ladder is a total order.
    const storedAmounts = stored.map((b) => b.amountCents);
    expect(new Set(storedAmounts).size).toBe(storedAmounts.length);

    // The listing's cached leader matches the actual top bid — no lost update.
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.currentBidCents).toBe(Math.max(...storedAmounts));
    expect(listing?.bidCount).toBe(stored.length);
  });

  it('rejects a bid below the minimum increment', async () => {
    const listingId = await auctionListing();
    await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 10_000 });
    await expect(
      placeBid({ listingId, bidderId: buyers[1]!, amountCents: 10_050 }),
    ).rejects.toThrow(/minimum bid/i);
  });

  it('rejects the seller bidding on their own auction', async () => {
    const listingId = await auctionListing();
    await expect(
      placeBid({ listingId, bidderId: seller, amountCents: 9_000 }),
    ).rejects.toThrow(/your own listing/i);
  });

  it('★ a late bid EXTENDS the deadline (soft close)', async () => {
    // Ends in 30s, inside the 120s anti-snipe window.
    const listingId = await auctionListing({
      endsAt: new Date(Date.now() + 30 * 1000),
    });

    const before = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    const result = await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 6_000 });

    expect(result.extended).toBe(true);
    expect(result.endsAt.getTime()).toBeGreaterThan(before!.endsAt!.getTime());

    const after = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(after?.extensionCount).toBe(1);
  });

  it('a bid well before the deadline does NOT extend it', async () => {
    const listingId = await auctionListing({ endsAt: new Date(Date.now() + 60 * 60 * 1000) });
    const result = await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 6_000 });
    expect(result.extended).toBe(false);
  });

  it('★ the close job RESCHEDULES itself when the deadline has moved', async () => {
    const listingId = await auctionListing({ endsAt: new Date(Date.now() + 30 * 1000) });
    await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 6_000 }); // extends

    // Fire the close job as if it were scheduled for the ORIGINAL deadline.
    await auctionClose({ listingId }, helpers);

    // It must not have closed the auction — the deadline moved.
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('active');
  });

  it('closes with a winner and opens a transaction at the winning bid', async () => {
    const listingId = await auctionListing({ endsAt: new Date(Date.now() + 60 * 60 * 1000) });
    await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 6_000 });
    await placeBid({ listingId, bidderId: buyers[1]!, amountCents: 9_000 });

    // Deadline reached.
    await db
      .update(listings)
      .set({ endsAt: sql`now() - interval '1 minute'` })
      .where(eq(listings.id, listingId));

    await auctionClose({ listingId }, helpers);

    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('ended_won');

    const tx = await openTransactionFor(listingId);
    expect(tx?.buyerId).toBe(buyers[1]!);
    expect(tx?.amountCents).toBe(9_000);
    expect(tx?.source).toBe('auction_win');
  });

  it('closes with no sale when the reserve is not met', async () => {
    const listingId = await auctionListing({
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      reserveCents: 50_000,
    });
    await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 6_000 });

    await db
      .update(listings)
      .set({ endsAt: sql`now() - interval '1 minute'` })
      .where(eq(listings.id, listingId));
    await auctionClose({ listingId }, helpers);

    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('ended_no_sale');
    expect(await openTransactionFor(listingId)).toBeUndefined();
  });

  it('a buyout ends the auction immediately', async () => {
    const listingId = await auctionListing({
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      buyoutCents: 40_000,
    });

    const result = await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 40_000 });
    expect(result.transactionId).toBeDefined();

    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('ended_won');
  });

  it('★ a reneged winner hands off to the runner-up AT THEIR OWN BID', async () => {
    const listingId = await auctionListing({ endsAt: new Date(Date.now() + 60 * 60 * 1000) });
    await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 6_000 });
    await placeBid({ listingId, bidderId: buyers[1]!, amountCents: 12_000 });

    await db
      .update(listings)
      .set({ endsAt: sql`now() - interval '1 minute'` })
      .where(eq(listings.id, listingId));
    await auctionClose({ listingId }, helpers);

    const winnerTx = await openTransactionFor(listingId);
    expect(winnerTx?.buyerId).toBe(buyers[1]!);
    expect(winnerTx?.amountCents).toBe(12_000);

    // The winner never pays.
    await expirePaymentWindow(winnerTx!.id);
    await paymentWindowExpired({ transactionId: winnerTx!.id }, helpers);
    await promoteNext({ listingId, failedTransactionId: winnerTx!.id }, helpers);

    const runnerUpTx = await openTransactionFor(listingId);
    expect(runnerUpTx?.buyerId).toBe(buyers[0]!);
    // ★ They owe THEIR bid, not the winner's.
    expect(runnerUpTx?.amountCents).toBe(6_000);
    expect(runnerUpTx?.source).toBe('auction_runner_up');
  });
});
