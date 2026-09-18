/**
 * PHASE 1 FLOW TESTS.
 *
 * These exercise the behaviours that only show up under real concurrency and real
 * scheduling — the ones unit tests structurally cannot reach:
 *
 *   · N simultaneous claims resolve to exactly one winner and reject every loser
 *   · N simultaneous bids produce a total order with no lost updates
 *   · a lapsed auction payment window reneges, records the fact, and creates a fallback offer
 *   · a late bid extends the auction, and the close job reschedules rather than closing
 *   · a reneged auction winner hands off to the runner-up AT THEIR OWN BID
 *
 * Requires the local database: `docker compose up -d && npm run setup`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db, pool } from '../../src/db/client';
import { users } from '../../src/db/schema/auth';
import { profiles, reputationCounters, reputationEvents } from '../../src/db/schema/profiles';
import { sellerMeetupLocations } from '../../src/db/schema/seller-settings';
import { listings, claims, bids } from '../../src/db/schema/listings';
import { auctionFallbackOffers } from '../../src/db/schema/auction-fallback-offers';
import { offers } from '../../src/db/schema/offers';
import { transactions, transactionEvents } from '../../src/db/schema/transactions';
import { notificationDeliveries } from '../../src/db/schema/notifications';
import { claimListing } from '../../src/db/atomic/claim-listing';
import { placeBid } from '../../src/db/atomic/place-bid';
import { markPaid, completeCashMeetup, confirmPayment, disputePayment, markItemHandedOver, confirmItemReceived, acceptAuctionFallbackOffer, rescheduleTransactionDeadlineJobs } from '../../src/services/transactions';
import { submitDispute } from '../../src/services/disputes';
import { acceptOffer, rejectOffer, submitOffer } from '../../src/services/offers';
import { assertMarketplaceEligible } from '../../src/services/marketplace-eligibility';
import { counterpartyContact } from '../../src/services/private-disclosure';
import { auctionClose } from '../../src/jobs/tasks/auction-close';
import {
  paymentWindowExpired,
  promoteNext,
  receiptWindowExpired,
} from '../../src/jobs/tasks/transaction-windows';

// Graphile Worker passes a Helpers object; the handlers only use `logger`.
const helpers = {
  logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
} as never;

const SUFFIX = randomUUID().slice(0, 8);
const seller = `t_seller_${SUFFIX}`;
const buyers = Array.from({ length: 6 }, (_, i) => `t_buyer${i}_${SUFFIX}`);
const newBuyer = `t_newbuyer_${SUFFIX}`;
const missingPhoneBuyer = `t_missing_phone_${SUFFIX}`;
const everyone = [seller, ...buyers, newBuyer, missingPhoneBuyer];

function phoneFor(id: string): string {
  const digits = BigInt(`0x${createHash('sha256').update(id).digest('hex').slice(0, 12)}`) % 10_000_000_000n;
  return `+1${digits.toString().padStart(10, '0')}`;
}

async function createUser(id: string): Promise<void> {
  await db.insert(users).values({ id, name: id, email: `${id}@test.local`, emailVerified: true });
  await db.insert(profiles).values({
    userId: id,
    displayName: id,
    handle: id,
    ...(id === missingPhoneBuyer ? {} : { phoneE164: phoneFor(id) }),
  });
  await db.insert(reputationCounters).values({ userId: id, buyCompleted: id === newBuyer ? 0 : 3 });
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
      fulfillmentPaths: ['cash_meetup'],
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

async function withLegacyScope<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.env.COLLECTTT_LAUNCH_SCOPE;
  process.env.COLLECTTT_LAUNCH_SCOPE = 'legacy';
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.COLLECTTT_LAUNCH_SCOPE;
    else process.env.COLLECTTT_LAUNCH_SCOPE = previous;
  }
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
    await q(`delete from disputes where transaction_id in ${sub}`, [listingIds]);
    await q(`update listings set active_transaction_id = null where id = any($1)`, [listingIds]);
    await q(`delete from reputation_events where transaction_id in ${sub}`, [listingIds]);
    await q(`delete from transactions where listing_id = any($1)`, [listingIds]);
    await q(`delete from claims where listing_id = any($1)`, [listingIds]);
    await q(`delete from auction_fallback_offers where listing_id = any($1)`, [listingIds]);
    await q(`delete from bids where listing_id = any($1)`, [listingIds]);
    await q(`delete from listings where id = any($1)`, [listingIds]);
  }

  await q(`delete from notification_deliveries where user_id = any($1)`, [everyone]);
  await q(`delete from notifications where user_id = any($1)`, [everyone]);
  await q(`delete from reputation_events where user_id = any($1)`, [everyone]);
  await q(`delete from restrictions where user_id = any($1)`, [everyone]);
  await q(`delete from support_cases where reporter_user_id = any($1) or assigned_to = any($1) or resolved_by = any($1)`, [everyone]);
  await q(`delete from reputation_counters where user_id = any($1)`, [everyone]);
  await q(`delete from profiles where user_id = any($1)`, [everyone]);
  await q(`delete from "user" where id = any($1)`, [everyone]);
  await pool.end();
});

// ════════════════════════════════════════════════════════ atomic claim

describe('★ atomic straight-sale claim', () => {
  it('requires an explicit purchase commitment acknowledgement', async () => {
    const listingId = await makeListing();

    await expect(
      claimListing({
        listingId,
        claimantId: buyers[0]!,
        fulfillmentPath: 'cash_meetup',
        commitmentAcknowledged: false,
      }),
    ).rejects.toMatchObject({ code: 'commitment_confirmation_required' });

    const listing = (await db.select({ status: listings.status }).from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('active');
  });

  it('persists the selected meetup location on the claim and transaction', async () => {
    const location = await db.insert(sellerMeetupLocations).values({
      sellerId: seller,
      label: `M3 meetup ${SUFFIX}`,
      area: 'San Fernando',
    }).returning({ id: sellerMeetupLocations.id });
    const listingId = await makeListing({ meetupLocationId: location[0]!.id });

    const result = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      fulfillmentPath: 'cash_meetup',
      commitmentAcknowledged: true,
    });
    const claim = (await db.select({ meetupLocationId: claims.meetupLocationId }).from(claims).where(eq(claims.listingId, listingId)))[0];
    const transaction = (await db.select({ meetupLocationId: transactions.meetupLocationId }).from(transactions).where(eq(transactions.id, result.transactionId)))[0];

    expect(claim?.meetupLocationId).toBe(location[0]!.id);
    expect(transaction?.meetupLocationId).toBe(location[0]!.id);
  });

  it('resolves 6 SIMULTANEOUS claims to exactly one winner with no backup rows', async () => {
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
    const rejected = results.filter((r) => r.status === 'rejected');

    // ★ Exactly one winner, decided by the database, not by luck of ordering.
    expect(claimed).toHaveLength(1);

    expect(rejected).toHaveLength(5);

    const rows = await db.select().from(claims).where(eq(claims.listingId, listingId));
    expect(rows.filter((c) => c.status === 'active')).toHaveLength(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(1);

    // The listing moved to claimed, with exactly one open transaction.
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('claimed');

    const open = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open')));
    expect(open).toHaveLength(1);
  });

  it('allows at most one concurrent active commitment for a new buyer', async () => {
    const firstListingId = await makeListing();
    const secondListingId = await makeListing();
    const results = await Promise.allSettled([
      claimListing({ listingId: firstListingId, claimantId: newBuyer, fulfillmentPath: 'cash_meetup' }),
      claimListing({ listingId: secondListingId, claimantId: newBuyer, fulfillmentPath: 'cash_meetup' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const open = await db.select({ id: transactions.id }).from(transactions)
      .where(and(eq(transactions.buyerId, newBuyer), eq(transactions.state, 'open')));
    expect(open).toHaveLength(1);
  });

  it('blocks marketplace writes when a legacy account has no phone number', async () => {
    await expect(assertMarketplaceEligible(db, missingPhoneBuyer, 'persist_listing')).rejects.toThrow(/add your mobile number/i);
    await expect(assertMarketplaceEligible(db, missingPhoneBuyer, 'publish_listing')).rejects.toThrow(/add your mobile number/i);
    await expect(assertMarketplaceEligible(db, missingPhoneBuyer, 'reserve')).rejects.toThrow(/add your mobile number/i);
    await expect(assertMarketplaceEligible(db, missingPhoneBuyer, 'bid')).rejects.toThrow(/add your mobile number/i);
  });

  it('reveals phone numbers only to the transaction parties', async () => {
    const listingId = await makeListing();
    const result = await claimListing({ listingId, claimantId: buyers[1]!, fulfillmentPath: 'cash_meetup' });

    await expect(counterpartyContact(db, buyers[1]!, result.transactionId)).resolves.toMatchObject({ phoneE164: phoneFor(seller) });
    await expect(counterpartyContact(db, seller, result.transactionId)).resolves.toMatchObject({ phoneE164: phoneFor(buyers[1]!) });
    await expect(counterpartyContact(db, buyers[2]!, result.transactionId)).rejects.toThrow();
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

  it('is idempotent — claiming twice returns the same deal', async () => {
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

describe('★ fixed-price offers (legacy compatibility)', () => {
  const previousLaunchScope = process.env.COLLECTTT_LAUNCH_SCOPE;
  beforeAll(() => { process.env.COLLECTTT_LAUNCH_SCOPE = 'legacy'; });
  afterAll(() => {
    if (previousLaunchScope === undefined) delete process.env.COLLECTTT_LAUNCH_SCOPE;
    else process.env.COLLECTTT_LAUNCH_SCOPE = previousLaunchScope;
  });
  it('records one pending offer without reserving the listing', async () => {
    const listingId = await makeListing({ priceCents: 10_000, acceptsOffers: true });

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
    const listingId = await makeListing({ priceCents: 10_000, acceptsOffers: true });

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
    const listingId = await makeListing({ priceCents: 10_000, acceptsOffers: true });
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

  it('requires a pending offer to be cancelled before claiming at the asking price', async () => {
    const listingId = await makeListing({ priceCents: 10_000, acceptsOffers: true });
    const offer = await submitOffer({
      listingId,
      buyerId: buyers[0]!,
      amountCents: 8_000,
      fulfillmentPath: 'cash_meetup',
    });

    await expect(
      claimListing({
        listingId,
        claimantId: buyers[0]!,
        fulfillmentPath: 'cash_meetup',
      }),
    ).rejects.toThrow(/cancel your pending offer/i);

    const result = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      cancelPendingOfferId: offer.id,
    });
    const cancelled = (await db.select().from(offers).where(eq(offers.id, offer.id)))[0];
    const opened = (await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.listingId, listingId), eq(transactions.state, 'open'))))[0];

    expect(result.outcome).toBe('claimed');
    expect(cancelled?.status).toBe('cancelled');
    expect(opened?.buyerId).toBe(buyers[0]);
    expect(opened?.amountCents).toBe(10_000);
  });

  it('accepts one offer atomically, keeps competitors pending, and opens the normal deal', async () => {
    const listingId = await makeListing({ priceCents: 10_000, acceptsOffers: true });
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
    const competing = (await db.select().from(offers).where(eq(offers.id, second.id)))[0];
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    const opened = (await db.select().from(transactions).where(eq(transactions.id, result.transactionId)))[0];

    expect(accepted?.status).toBe('accepted');
    expect(competing?.status).toBe('pending');
    expect(listing?.status).toBe('claimed');
    expect(opened?.source).toBe('offer_accept');
    expect(opened?.offerId).toBe(first.id);
    expect(opened?.buyerId).toBe(buyers[2]);
    expect(opened?.amountCents).toBe(8_000);

    // An accepted offer uses the normal buyer expiry path and respects the listing's
    // auto-relist setting, rather than leaving the listing permanently claimed.
    await expirePaymentWindow(result.transactionId);
    await paymentWindowExpired({ transactionId: result.transactionId }, helpers);
    expect((await db.select().from(listings).where(eq(listings.id, listingId)))[0]?.status).toBe('active');
    expect((await db.select().from(offers).where(eq(offers.id, second.id)))[0]?.status).toBe('pending');
  });

  it('emails the accepted buyer and rejects competitors only after payment is confirmed', async () => {
    const listingId = await makeListing({ priceCents: 10_000, acceptsOffers: true });
    const acceptedOffer = await submitOffer({
      listingId,
      buyerId: buyers[2]!,
      amountCents: 8_000,
      fulfillmentPath: 'cash_meetup',
    });
    const competingOffer = await submitOffer({
      listingId,
      buyerId: buyers[3]!,
      amountCents: 8_500,
      fulfillmentPath: 'cash_meetup',
    });
    const unrelatedListingId = await makeListing({ priceCents: 12_000, acceptsOffers: true });
    const unrelatedOffer = await submitOffer({
      listingId: unrelatedListingId,
      buyerId: buyers[4]!,
      amountCents: 9_000,
      fulfillmentPath: 'cash_meetup',
    });

    const result = await acceptOffer(acceptedOffer.id, seller);
    const acceptanceEmails = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(
        notificationDeliveries.dedupeKey,
        `tx_opened_buyer:${result.transactionId}:${buyers[2]!}:email`,
      ));

    expect(acceptanceEmails).toHaveLength(1);
    expect((await db.select().from(offers).where(eq(offers.id, competingOffer.id)))[0]?.status).toBe('pending');

    await db.transaction(async (tx) => markPaid(tx, result.transactionId, buyers[2]!));
    await db.transaction(async (tx) => confirmPayment(tx, result.transactionId, seller));

    expect((await db.select().from(offers).where(eq(offers.id, competingOffer.id)))[0]?.status).toBe('rejected');
    expect((await db.select().from(offers).where(eq(offers.id, unrelatedOffer.id)))[0]?.status).toBe('pending');
  });
});

// ════════════════════════════════════════════════════════ handshake

describe('★ mark-paid / confirm-received handshake', () => {
  it('supports the legacy seller hand-off and buyer receipt handshake', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[4]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;

    await db.transaction(async (tx) => markPaid(tx, txId, buyers[4]!));
    await db.transaction(async (tx) => confirmPayment(tx, txId, seller));
    expect((await db.select({ state: transactions.state, handoff: transactions.handoffState }).from(transactions).where(eq(transactions.id, txId)))[0]).toMatchObject({ state: 'open', handoff: 'awaiting_handoff' });

    await db.transaction(async (tx) => markItemHandedOver(tx, txId, seller));
    expect((await db.select({ handoff: transactions.handoffState }).from(transactions).where(eq(transactions.id, txId)))[0]?.handoff).toBe('seller_handed_over');
    await db.transaction(async (tx) => markItemHandedOver(tx, txId, seller));
    await db.transaction(async (tx) => confirmItemReceived(tx, txId, buyers[4]!));
    await db.transaction(async (tx) => confirmItemReceived(tx, txId, buyers[4]!));
    expect((await db.select({ state: transactions.state, handoff: transactions.handoffState }).from(transactions).where(eq(transactions.id, txId)))[0]).toMatchObject({ state: 'completed', handoff: 'buyer_received' });
    expect((await db.select().from(transactionEvents).where(and(eq(transactionEvents.transactionId, txId), eq(transactionEvents.fromState, 'seller_handed_over'))))).toHaveLength(1);
  });

  it('completes an acknowledged v1 meetup in a single buyer action', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[4]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;

    await db.transaction(async (tx) => completeCashMeetup(tx, txId, buyers[4]!));

    const row = (await db.select({ state: transactions.state, paymentState: transactions.paymentState, handoffState: transactions.handoffState }).from(transactions).where(eq(transactions.id, txId)))[0];
    expect(row).toMatchObject({ state: 'completed', paymentState: 'confirmed', handoffState: 'buyer_received' });

    // Idempotent: a repeated delivery is a no-op, not a second completion.
    await db.transaction(async (tx) => completeCashMeetup(tx, txId, buyers[4]!));
    expect((await db.select({ state: transactions.state }).from(transactions).where(eq(transactions.id, txId)))[0]?.state).toBe('completed');
  });

  it('moves a reported problem into the paused dispute track', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[5]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;
    await db.transaction(async (tx) => submitDispute({ tx, transactionId: txId, raisedBy: buyers[5]!, reason: 'item_not_received', detail: 'The seller did not arrive at the agreed meetup location.' }));
    const row = (await db.select({ state: transactions.state, disputeState: transactions.disputeState }).from(transactions).where(eq(transactions.id, txId)))[0];
    expect(row).toMatchObject({ state: 'open', disputeState: 'open' });
    await expect(db.transaction(async (tx) => markPaid(tx, txId, buyers[5]!))).rejects.toThrow(/no longer actionable/i);
  });

  it('does not terminate after a concurrent dispute commits', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[0]!, fulfillmentPath: 'cash_meetup' });
    const txId = claim.transactionId!;
    await expirePaymentWindow(txId);

    let disputeLocked!: () => void;
    const disputeReady = new Promise<void>((resolve) => { disputeLocked = resolve; });
    const disputing = db.transaction(async (tx) => {
      await tx.execute(sql`select id from transactions where id = ${txId} for update`);
      await submitDispute({
        tx,
        transactionId: txId,
        raisedBy: buyers[0]!,
        reason: 'item_not_received',
        detail: 'The seller did not arrive at the agreed meetup location.',
      });
      disputeLocked();
      await tx.execute(sql`select pg_sleep(1)`);
    });

    await disputeReady;
    const expiring = paymentWindowExpired({ transactionId: txId }, helpers);
    await Promise.all([disputing, expiring]);

    const row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0]!;
    expect(row.state).toBe('open');
    expect(row.disputeState).toBe('open');
  });

  it('does not terminate after a concurrent payment confirmation commits', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[1]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;
    await db.transaction(async (tx) => markPaid(tx, txId, buyers[1]!));
    await expirePaymentWindow(txId);

    let confirmationLocked!: () => void;
    const confirmationReady = new Promise<void>((resolve) => { confirmationLocked = resolve; });
    const confirming = db.transaction(async (tx) => {
      await tx.execute(sql`select id from transactions where id = ${txId} for update`);
      await confirmPayment(tx, txId, seller);
      confirmationLocked();
      await tx.execute(sql`select pg_sleep(1)`);
    });

    await confirmationReady;
    const expiring = paymentWindowExpired({ transactionId: txId }, helpers);
    await Promise.all([confirming, expiring]);

    const row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0]!;
    expect(row.state).toBe('open');
    expect(row.paymentState).toBe('confirmed');
  });

  it('keeps a future-deadline deal open when an old payment job runs', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[3]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;

    await paymentWindowExpired({ transactionId: txId }, helpers);

    const row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0]!;
    expect(row.paymentDeadlineAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.state).toBe('open');
  });

  it('does not complete a receipt window before its current deadline', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[4]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;
    await db.transaction(async (tx) => markPaid(tx, txId, buyers[4]!));
    await db.transaction(async (tx) => confirmPayment(tx, txId, seller));
    await db.transaction(async (tx) => markItemHandedOver(tx, txId, seller));

    await receiptWindowExpired({ transactionId: txId }, helpers);

    const row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0]!;
    expect(row.receiptDeadlineAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.state).toBe('open');
    expect(row.handoffState).toBe('seller_handed_over');
  });

  it('auto-completes after the receipt window when no problem is reported', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[3]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;
    await db.transaction(async (tx) => markPaid(tx, txId, buyers[3]!));
    await db.transaction(async (tx) => confirmPayment(tx, txId, seller));
    await db.transaction(async (tx) => markItemHandedOver(tx, txId, seller));
    await db.update(transactions).set({ receiptDeadlineAt: sql`now() - interval '1 hour'` }).where(eq(transactions.id, txId));
    await receiptWindowExpired({ transactionId: txId }, helpers);
    const row = (await db.select({ state: transactions.state, handoff: transactions.handoffState }).from(transactions).where(eq(transactions.id, txId)))[0];
    expect(row).toMatchObject({ state: 'completed', handoff: 'buyer_received' });
  });

  it('resumes receipt progression after a dispute is resolved', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({ listingId, claimantId: buyers[2]!, fulfillmentPath: 'cash_meetup', commitmentAcknowledged: true });
    const txId = claim.transactionId!;
    await db.transaction(async (tx) => markPaid(tx, txId, buyers[2]!));
    await db.transaction(async (tx) => confirmPayment(tx, txId, seller));
    await db.transaction(async (tx) => markItemHandedOver(tx, txId, seller));
    await db.update(transactions).set({
      disputeState: 'resolved',
      receiptDeadlineAt: sql`now() - interval '1 hour'`,
    }).where(eq(transactions.id, txId));

    const receiptJobKey = `receipt_window:${txId}`;
    await pool.query('select graphile_worker.remove_job($1::text)', [receiptJobKey]);
    const resumed = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0]!;
    await db.transaction(async (tx) => rescheduleTransactionDeadlineJobs(tx, resumed));
    const queued = await pool.query<{ task_identifier: string; run_at: Date }>(
      'select task_identifier, run_at from graphile_worker.jobs where key = $1',
      [receiptJobKey],
    );
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.task_identifier).toBe('transaction:receipt_window');
    expect(queued.rows[0]?.run_at.getTime()).toBeLessThan(Date.now());

    await receiptWindowExpired({ transactionId: txId }, helpers);
    await pool.query('select graphile_worker.remove_job($1::text)', [receiptJobKey]);

    const row = (await db.select({ state: transactions.state, handoff: transactions.handoffState }).from(transactions).where(eq(transactions.id, txId)))[0];
    expect(row).toMatchObject({ state: 'completed', handoff: 'buyer_received' });
  });

  it('completes a deal and records the objective facts for both sides', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      fulfillmentPath: 'cash_meetup',
    });
    const txId = claim.transactionId!;
    const pendingOfferRows = await db
      .insert(offers)
      .values({
        listingId,
        buyerId: buyers[2]!,
        amountCents: 8_000,
        fulfillmentPath: 'cash_meetup',
        status: 'pending',
      })
      .returning({ id: offers.id });
    const pendingOfferId = pendingOfferRows[0]!.id;

    await db.transaction(async (tx) => markPaid(tx, txId, buyers[0]!));
    let row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];
    expect(row?.paymentState).toBe('confirmed');
    expect(row?.state).toBe('completed');

    await db.transaction(async (tx) => confirmPayment(tx, txId, seller));
    row = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];

    expect(row?.paymentState).toBe('confirmed');
    expect(row?.state).toBe('completed');
    expect(row?.completedAt).not.toBeNull();

    // The listing is done.
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('ended_won');
    expect((await db.select().from(claims).where(eq(claims.listingId, listingId))).filter((row) => row.status === 'active')).toHaveLength(1);
    expect((await db.select().from(offers).where(eq(offers.id, pendingOfferId)))[0]?.status).toBe('rejected');

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

  it('does not let a seller reverse the buyer payment confirmation', async () => {
    const listingId = await makeListing();
    const claim = await claimListing({
      listingId,
      claimantId: buyers[2]!,
      fulfillmentPath: 'cash_meetup',
    });
    const txId = claim.transactionId!;

    await db.transaction(async (tx) => markPaid(tx, txId, buyers[2]!));
    await expect(db.transaction(async (tx) => disputePayment(tx, txId, seller))).rejects.toThrow();

    const after = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0];
    expect(after?.paymentState).toBe('confirmed');
    expect(after?.markedPaidAt).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════ fixed-price failure

describe('★ fixed-price payment lapse → relist without a backup', () => {
  it('returns the item to the catalog after the sole claimer reneges', async () => {
    const listingId = await makeListing();

    const first = await claimListing({
      listingId,
      claimantId: buyers[0]!,
      fulfillmentPath: 'cash_meetup',
    });
    expect(first.outcome).toBe('claimed');

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

    // Fixed-price claims do not enqueue a promotion job.
    await promoteNext({ listingId, failedTransactionId: firstTxId }, helpers);

    const open = await openTransactionFor(listingId);
    expect(open).toBeUndefined();
    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('active');
    const claimRows = await db.select().from(claims).where(eq(claims.listingId, listingId));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.status).toBe('reneged');
  });

  it('allows a fresh buyer to claim after a failed attempt is relisted', async () => {
    const listingId = await makeListing();
    const first = await claimListing({
      listingId,
      claimantId: buyers[3]!,
      fulfillmentPath: 'cash_meetup',
    });

    await expirePaymentWindow(first.transactionId!);
    await paymentWindowExpired({ transactionId: first.transactionId! }, helpers);
    const second = await claimListing({
      listingId,
      claimantId: buyers[4]!,
      fulfillmentPath: 'cash_meetup',
    });
    expect(second.outcome).toBe('claimed');
    expect(second.transactionId).not.toBe(first.transactionId);
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

  it('closes with no sale when the reserve is not met (legacy compatibility)', async () => withLegacyScope(async () => {
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
  }));

  it('a buyout ends the auction immediately (legacy compatibility)', async () => withLegacyScope(async () => {
    const listingId = await auctionListing({
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      buyoutCents: 40_000,
    });

    const result = await placeBid({ listingId, bidderId: buyers[0]!, amountCents: 40_000 });
    expect(result.transactionId).toBeDefined();

    const listing = (await db.select().from(listings).where(eq(listings.id, listingId)))[0];
    expect(listing?.status).toBe('ended_won');
  }));

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

    const fallback = (await db.select().from(auctionFallbackOffers).where(and(
      eq(auctionFallbackOffers.listingId, listingId),
      eq(auctionFallbackOffers.status, 'pending'),
    )).limit(1))[0];
    expect(fallback?.buyerId).toBe(buyers[0]!);
    expect(fallback?.amountCents).toBe(6_000);
    expect(await openTransactionFor(listingId)).toBeUndefined();

    await db.transaction(async (tx) => {
      await acceptAuctionFallbackOffer(tx, fallback!.id, buyers[0]!);
    });

    const runnerUpTx = await openTransactionFor(listingId);
    expect(runnerUpTx?.buyerId).toBe(buyers[0]!);
    // ★ They owe THEIR bid, not the winner's.
    expect(runnerUpTx?.amountCents).toBe(6_000);
    expect(runnerUpTx?.source).toBe('auction_runner_up');
  });
});
