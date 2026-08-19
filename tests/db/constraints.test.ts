/**
 * ADVERSARIAL CONSTRAINT TESTS.
 *
 * For every ★ invariant in the schema, try to violate it with raw SQL and assert the
 * DATABASE refuses. These matter more than the domain tests: application code can be
 * bypassed by a bad migration, a psql session, or a future careless service function,
 * so the invariants that protect someone's item or reputation must hold at the storage
 * layer, not merely in TypeScript.
 *
 * Requires the local Postgres container: `docker compose up -d && npm run setup`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

import { pool } from '../../src/db/client';

const ids = {
  seller: `seller_${randomUUID()}`,
  buyer: `buyer_${randomUUID()}`,
  buyer2: `buyer2_${randomUUID()}`,
  listing: randomUUID(),
  listing2: randomUUID(),
  store: randomUUID(),
};

/** Assert a statement is rejected, optionally by a named constraint. */
async function expectRejected(sqlText: string, params: unknown[], constraint?: string) {
  let error: unknown = null;
  try {
    await pool.query(sqlText, params as never[]);
  } catch (e) {
    error = e;
  }
  expect(error, `expected the database to reject this statement, but it succeeded`).not.toBeNull();
  if (constraint !== undefined) {
    const message = String((error as { constraint?: string; message?: string }).constraint ?? (error as Error).message);
    expect(message).toContain(constraint);
  }
}

async function createUser(id: string): Promise<void> {
  await pool.query(
    `insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)`,
    [id, id, `${id}@test.local`],
  );
  await pool.query(`insert into profiles (user_id, display_name, handle) values ($1, $2, $3)`, [
    id,
    id,
    id,
  ]);
}

async function createListing(id: string, sellerId: string): Promise<void> {
  await pool.query(
    `insert into listings
       (id, seller_id, category, attributes, attributes_version, title, sale_type, status,
        price_cents, fulfillment_paths, settlement_methods)
     values ($1, $2, 'trading_card', '{}'::jsonb, 1, 'Test listing', 'straight_sale', 'active',
             10000, ARRAY['cash_meetup','relay']::fulfillment_path[], ARRAY['cash'])`,
    [id, sellerId],
  );
}

/** Insert an open transaction. Returns its id. */
async function createTransaction(over: {
  listingId: string;
  buyerId: string;
  sellerId: string;
  path?: string;
  paymentState?: string;
  custodyState?: string;
  state?: string;
  dropoffOffsetHours?: number | null;
}): Promise<string> {
  const id = randomUUID();
  const path = over.path ?? 'cash_meetup';
  const dropoff =
    over.dropoffOffsetHours === undefined || over.dropoffOffsetHours === null
      ? null
      : `now() + interval '${over.dropoffOffsetHours} hours'`;

  // attempt_number is unique per listing, so pick the next free one rather than
  // colliding with attempts left behind by earlier tests.
  const { rows: existing } = await pool.query(
    `select coalesce(max(attempt_number), 0) + 1 as next from transactions where listing_id = $1`,
    [over.listingId],
  );
  const attempt = Number(existing[0].next);

  await pool.query(
    `insert into transactions
       (id, listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
        state, payment_state, custody_state,
        payment_deadline_at, seller_dropoff_deadline_at, attempt_number)
     values ($1, $2, $3, $4, 'claim', 10000, $5::fulfillment_path,
             $6::transaction_state, $7::payment_state, $8::custody_state,
             now() + interval '72 hours', ${dropoff === null ? 'null' : dropoff}, $9)`,
    [
      id,
      over.listingId,
      over.sellerId,
      over.buyerId,
      path,
      over.state ?? 'open',
      over.paymentState ?? 'pending',
      over.custodyState ?? (path === 'relay' || path === 'full_service' ? 'awaiting_dropoff' : 'not_applicable'),
      attempt,
    ],
  );
  return id;
}

beforeAll(async () => {
  await createUser(ids.seller);
  await createUser(ids.buyer);
  await createUser(ids.buyer2);
  await createListing(ids.listing, ids.seller);
  await createListing(ids.listing2, ids.seller);
  await pool.query(
    `insert into relay_stores (id, name, area, accepts_size_classes)
     values ($1, 'Test Store', 'Port of Spain', ARRAY['small']::size_class[])`,
    [ids.store],
  );
});

afterAll(async () => {
  // Children first — most FKs here are intentionally restrictive.
  await pool.query(`delete from transaction_events where transaction_id in
                      (select id from transactions where listing_id = any($1))`, [[ids.listing, ids.listing2]]);
  await pool.query(`delete from reputation_events where user_id = any($1)`, [
    [ids.seller, ids.buyer, ids.buyer2],
  ]);
  await pool.query(`update listings set active_transaction_id = null where id = any($1)`, [
    [ids.listing, ids.listing2],
  ]);
  await pool.query(`update custody_holdings set current_transaction_id = null where listing_id = any($1)`, [
    [ids.listing, ids.listing2],
  ]);
  await pool.query(`delete from custody_holdings where listing_id = any($1)`, [[ids.listing, ids.listing2]]);
  await pool.query(`delete from claims where listing_id = any($1)`, [[ids.listing, ids.listing2]]);
  await pool.query(`delete from bids where listing_id = any($1)`, [[ids.listing, ids.listing2]]);
  await pool.query(`delete from transactions where listing_id = any($1)`, [[ids.listing, ids.listing2]]);
  await pool.query(`delete from listings where id = any($1)`, [[ids.listing, ids.listing2]]);
  await pool.query(`delete from relay_stores where id = $1`, [ids.store]);
  await pool.query(`delete from profiles where user_id = any($1)`, [
    [ids.seller, ids.buyer, ids.buyer2],
  ]);
  await pool.query(`delete from "user" where id = any($1)`, [[ids.seller, ids.buyer, ids.buyer2]]);
  await pool.end();
});

// ---------------------------------------------------------------- claims

describe('★ claims_one_active — exactly one live claimant per listing', () => {
  it('accepts the first active claim', async () => {
    await pool.query(
      `insert into claims (listing_id, claimant_id, position, status, fulfillment_path)
       values ($1, $2, 1, 'active', 'cash_meetup')`,
      [ids.listing, ids.buyer],
    );
    const { rows } = await pool.query(
      `select count(*)::int as n from claims where listing_id = $1 and status = 'active'`,
      [ids.listing],
    );
    expect(rows[0].n).toBe(1);
  });

  it('REJECTS a second active claim on the same listing', async () => {
    await expectRejected(
      `insert into claims (listing_id, claimant_id, position, status, fulfillment_path)
       values ($1, $2, 2, 'active', 'cash_meetup')`,
      [ids.listing, ids.buyer2],
      'claims_one_active',
    );
  });

  it('allows a queued backup claim alongside the active one', async () => {
    await pool.query(
      `insert into claims (listing_id, claimant_id, position, status, fulfillment_path)
       values ($1, $2, 2, 'queued', 'cash_meetup')`,
      [ids.listing, ids.buyer2],
    );
    const { rows } = await pool.query(
      `select count(*)::int as n from claims where listing_id = $1`,
      [ids.listing],
    );
    expect(rows[0].n).toBe(2);
  });

  it('REJECTS the same person claiming twice', async () => {
    await expectRejected(
      `insert into claims (listing_id, claimant_id, position, status, fulfillment_path)
       values ($1, $2, 3, 'queued', 'cash_meetup')`,
      [ids.listing, ids.buyer],
      'claims_one_per_claimant',
    );
  });

  it('REJECTS a claim stack deeper than 4', async () => {
    await expectRejected(
      `insert into claims (listing_id, claimant_id, position, status, fulfillment_path)
       values ($1, $2, 5, 'queued', 'cash_meetup')`,
      [ids.listing2, ids.buyer],
      'claim_stack_depth',
    );
  });
});

// ---------------------------------------------------------------- bids

describe('★ bids_amount_unique — the bid ladder is a total order', () => {
  it('REJECTS two bids at the same amount on one listing', async () => {
    await pool.query(
      `insert into bids (listing_id, bidder_id, amount_cents) values ($1, $2, 5000)`,
      [ids.listing2, ids.buyer],
    );
    await expectRejected(
      `insert into bids (listing_id, bidder_id, amount_cents) values ($1, $2, 5000)`,
      [ids.listing2, ids.buyer2],
      'bids_amount_unique',
    );
  });

  it('REJECTS a non-positive bid', async () => {
    await expectRejected(
      `insert into bids (listing_id, bidder_id, amount_cents) values ($1, $2, 0)`,
      [ids.listing2, ids.buyer],
      'bid_positive',
    );
  });
});

// ---------------------------------------------------------------- transactions

describe('★ tx_one_open_per_listing — at most one open attempt', () => {
  it('accepts the first open transaction', async () => {
    const id = await createTransaction({
      listingId: ids.listing,
      buyerId: ids.buyer,
      sellerId: ids.seller,
    });
    expect(id).toBeTruthy();
  });

  it('REJECTS a second open transaction on the same listing', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'cash_meetup', 'open', 'pending', 'not_applicable',
               now() + interval '72 hours', 2)`,
      [ids.listing, ids.seller, ids.buyer2],
      'tx_one_open_per_listing',
    );
  });

  it('allows a new attempt once the previous one is terminal', async () => {
    await pool.query(
      `update transactions set state = 'reneged_buyer', payment_state = 'failed',
              terminated_at = now(), terminated_reason = 'non_payment'
       where listing_id = $1 and state = 'open'`,
      [ids.listing],
    );
    const id = await createTransaction({
      listingId: ids.listing,
      buyerId: ids.buyer2,
      sellerId: ids.seller,
    });
    expect(id).toBeTruthy();
    // attempt_number is unique per listing
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'cash_meetup', 'cancelled', 'failed', 'not_applicable',
               now() + interval '72 hours', 1)`,
      [ids.listing, ids.seller, ids.buyer],
      'tx_listing_attempt',
    );
  });
});

describe('★★ tx_completion_requires_both — both tracks or it is not complete', () => {
  it('REJECTS completion with payment unconfirmed', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'cash_meetup', 'completed', 'pending', 'not_applicable',
               now() + interval '72 hours', 90)`,
      [ids.listing2, ids.seller, ids.buyer],
      'tx_completion_requires_both',
    );
  });

  it('REJECTS completion while the item is still on the shelf', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at,
          seller_dropoff_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'relay', 'completed', 'confirmed', 'at_relay',
               now() + interval '72 hours', now() + interval '36 hours', 91)`,
      [ids.listing2, ids.seller, ids.buyer],
      'tx_completion_requires_both',
    );
  });

  it('REJECTS completion while the item is merely authorized, not collected', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at,
          seller_dropoff_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'relay', 'completed', 'confirmed', 'release_authorized',
               now() + interval '72 hours', now() + interval '36 hours', 92)`,
      [ids.listing2, ids.seller, ids.buyer],
      'tx_completion_requires_both',
    );
  });

  it('ACCEPTS completion when both tracks are genuinely done', async () => {
    const { rows } = await pool.query(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at,
          seller_dropoff_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'relay', 'completed', 'confirmed', 'picked_up',
               now() + interval '72 hours', now() + interval '36 hours', 93)
       returning id`,
      [ids.listing2, ids.seller, ids.buyer],
    );
    expect(rows[0].id).toBeTruthy();
  });
});

describe('★★ tx_dropoff_before_payment — the seller clock expires first', () => {
  it('REJECTS a drop-off deadline equal to the payment deadline', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at,
          seller_dropoff_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'relay', 'open', 'pending', 'awaiting_dropoff',
               now() + interval '72 hours', now() + interval '72 hours', 94)`,
      [ids.listing2, ids.seller, ids.buyer],
      'tx_dropoff_before_payment',
    );
  });

  it('REJECTS a drop-off deadline after the payment deadline', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at,
          seller_dropoff_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'relay', 'open', 'pending', 'awaiting_dropoff',
               now() + interval '72 hours', now() + interval '96 hours', 95)`,
      [ids.listing2, ids.seller, ids.buyer],
      'tx_dropoff_before_payment',
    );
  });
});

describe('★ path/track coherence', () => {
  it('REJECTS a P2P transaction that entered the custody track', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'cash_meetup', 'open', 'pending', 'at_relay',
               now() + interval '72 hours', 96)`,
      [ids.listing2, ids.seller, ids.buyer],
      'tx_p2p_no_custody',
    );
  });

  it('REJECTS a relay transaction with no custody track', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at,
          seller_dropoff_deadline_at, attempt_number)
       values ($1, $2, $3, 'claim', 10000, 'relay', 'open', 'pending', 'not_applicable',
               now() + interval '72 hours', now() + interval '36 hours', 97)`,
      [ids.listing2, ids.seller, ids.buyer],
      'tx_custody_required',
    );
  });

  it('REJECTS a member trading with themselves', async () => {
    await expectRejected(
      `insert into transactions
         (listing_id, seller_id, buyer_id, source, amount_cents, fulfillment_path,
          state, payment_state, custody_state, payment_deadline_at, attempt_number)
       values ($1, $2, $2, 'claim', 10000, 'cash_meetup', 'open', 'pending', 'not_applicable',
               now() + interval '72 hours', 98)`,
      [ids.listing2, ids.seller],
      'tx_distinct_parties',
    );
  });
});

// ---------------------------------------------------------------- custody

describe('★ custody_one_live_per_listing — an item cannot be on two shelves', () => {
  it('accepts the first live holding', async () => {
    await pool.query(
      `insert into custody_holdings (listing_id, holder, store_id, state, size_class, dropoff_code)
       values ($1, 'relay_store', $2, 'at_relay', 'small', 'CT-TEST')`,
      [ids.listing, ids.store],
    );
    const { rows } = await pool.query(
      `select count(*)::int as n from custody_holdings where listing_id = $1`,
      [ids.listing],
    );
    expect(rows[0].n).toBe(1);
  });

  it('REJECTS a second live holding for the same item', async () => {
    await expectRejected(
      `insert into custody_holdings (listing_id, holder, store_id, state, size_class, dropoff_code)
       values ($1, 'relay_store', $2, 'awaiting_dropoff', 'small', 'CT-TES2')`,
      [ids.listing, ids.store],
      'custody_one_live_per_listing',
    );
  });

  it('allows a new holding once the previous one is terminal', async () => {
    await pool.query(
      `update custody_holdings set state = 'returned_to_seller', returned_at = now()
       where listing_id = $1`,
      [ids.listing],
    );
    const { rows } = await pool.query(
      `insert into custody_holdings (listing_id, holder, store_id, state, size_class, dropoff_code)
       values ($1, 'relay_store', $2, 'awaiting_dropoff', 'small', 'CT-TES3') returning id`,
      [ids.listing, ids.store],
    );
    expect(rows[0].id).toBeTruthy();
  });

  it('REJECTS a relay holding with no store', async () => {
    await expectRejected(
      `insert into custody_holdings (listing_id, holder, state, size_class, dropoff_code)
       values ($1, 'relay_store', 'awaiting_dropoff', 'small', 'CT-TES4')`,
      [ids.listing2],
      'custody_store_required',
    );
  });

  it('REJECTS a courier holding attached to a store', async () => {
    await expectRejected(
      `insert into custody_holdings (listing_id, holder, store_id, state, size_class, dropoff_code)
       values ($1, 'platform_courier', $2, 'awaiting_dropoff', 'small', 'CT-TES5')`,
      [ids.listing2, ids.store],
      'custody_courier_has_no_store',
    );
  });
});

// ---------------------------------------------------------------- reputation

describe('★ reputation_events_idem — a retried job cannot double-count', () => {
  it('REJECTS a duplicate (transaction, user, type) fact', async () => {
    const txId = await createTransaction({
      listingId: ids.listing2,
      buyerId: ids.buyer,
      sellerId: ids.seller,
    });

    await pool.query(
      `insert into reputation_events (user_id, transaction_id, type)
       values ($1, $2, 'buyer_reneged_nonpayment')`,
      [ids.buyer, txId],
    );

    await expectRejected(
      `insert into reputation_events (user_id, transaction_id, type)
       values ($1, $2, 'buyer_reneged_nonpayment')`,
      [ids.buyer, txId],
      'reputation_events_idem',
    );
  });

  it('allows the same fact type for a different transaction', async () => {
    const { rows } = await pool.query(
      `insert into reputation_events (user_id, transaction_id, type)
       values ($1, null, 'admin_adjustment') returning id`,
      [ids.buyer],
    );
    expect(rows[0].id).toBeTruthy();
  });
});

// ---------------------------------------------------------------- categories

describe('★ category integrity', () => {
  it('REJECTS a listing in a category that does not exist', async () => {
    await expectRejected(
      `insert into listings
         (seller_id, category, attributes, attributes_version, title, sale_type, status,
          price_cents, fulfillment_paths, settlement_methods)
       values ($1, 'warhammer_army', '{}'::jsonb, 1, 'x', 'straight_sale', 'active',
               100, ARRAY['cash_meetup']::fulfillment_path[], ARRAY['cash'])`,
      [ids.seller],
      'listings_category',
    );
  });

  it('accepts every seeded category', async () => {
    const { rows } = await pool.query(`select key from categories where active order by sort_order`);
    expect(rows.map((r: { key: string }) => r.key)).toEqual([
      'trading_card',
      'comic',
      'collectible',
    ]);
  });
});

// ---------------------------------------------------------------- listing shape

describe('★ listing shape', () => {
  it('REJECTS an auction with no end time', async () => {
    await expectRejected(
      `insert into listings
         (seller_id, category, attributes, attributes_version, title, sale_type, status,
          start_bid_cents, fulfillment_paths, settlement_methods)
       values ($1, 'comic', '{}'::jsonb, 1, 'x', 'auction', 'active',
               1000, ARRAY['cash_meetup']::fulfillment_path[], ARRAY['cash'])`,
      [ids.seller],
      'listing_auction_shape',
    );
  });

  it('REJECTS a straight sale with no price', async () => {
    await expectRejected(
      `insert into listings
         (seller_id, category, attributes, attributes_version, title, sale_type, status,
          fulfillment_paths, settlement_methods)
       values ($1, 'comic', '{}'::jsonb, 1, 'x', 'straight_sale', 'active',
               ARRAY['cash_meetup']::fulfillment_path[], ARRAY['cash'])`,
      [ids.seller],
      'listing_straight_sale_shape',
    );
  });

  it('REJECTS a listing accepting no fulfillment path at all', async () => {
    await expectRejected(
      `insert into listings
         (seller_id, category, attributes, attributes_version, title, sale_type, status,
          price_cents, fulfillment_paths, settlement_methods)
       values ($1, 'comic', '{}'::jsonb, 1, 'x', 'straight_sale', 'active',
               1000, ARRAY[]::fulfillment_path[], ARRAY['cash'])`,
      [ids.seller],
      'listing_paths_nonempty',
    );
  });
});

// ---------------------------------------------------------------- ratings

describe('★ ratings', () => {
  it('REJECTS a star value outside 1..5', async () => {
    const txId = await createTransaction({
      listingId: ids.listing,
      buyerId: ids.buyer,
      sellerId: ids.seller,
      state: 'cancelled',
    });
    await expectRejected(
      `insert into ratings (transaction_id, rater_id, ratee_id, direction, stars)
       values ($1, $2, $3, 'buyer_rates_seller', 6)`,
      [txId, ids.buyer, ids.seller],
      'rating_stars_range',
    );
  });

  it('REJECTS an invalid rating direction', async () => {
    const { rows } = await pool.query(
      `select id from transactions where listing_id = $1 order by attempt_number desc limit 1`,
      [ids.listing],
    );
    await expectRejected(
      `insert into ratings (transaction_id, rater_id, ratee_id, direction, stars)
       values ($1, $2, $3, 'buyer_rates_buyer', 5)`,
      [rows[0].id, ids.buyer, ids.seller],
      'ratings_direction_valid',
    );
  });

  it('REJECTS rating yourself', async () => {
    const { rows } = await pool.query(
      `select id from transactions where listing_id = $1 order by attempt_number desc limit 1`,
      [ids.listing],
    );
    await expectRejected(
      `insert into ratings (transaction_id, rater_id, ratee_id, direction, stars)
       values ($1, $2, $2, 'buyer_rates_seller', 5)`,
      [rows[0].id, ids.buyer],
      'rating_distinct',
    );
  });
});
