/**
 * Fixed-price offer workflow.
 *
 * Offers are negotiations, not reservations. The listing remains active while offers
 * are pending. Accepting one locks the listing and opens the same payment/custody
 * transaction used by a normal claim. Competing offers remain pending until payment.
 */

import { and, count, desc, eq, sql } from 'drizzle-orm';

import { db, type Tx } from '../db/client';
import { offers } from '../db/schema/offers';
import { listings } from '../db/schema/listings';
import { relayStores } from '../db/schema/custody';
import { profiles } from '../db/schema/profiles';
import { notify } from '../notifications/dispatch';
import { FULFILLMENT_PATHS, type FulfillmentPath } from '../domain/states/transaction';
import { SETTLEMENT_METHODS, type SettlementMethod } from '../domain/policy/settlement';
import type { SizeClass } from '../domain/states/listing';
import { formatMoney } from '../domain/money';
import { activeRestrictions } from './reputation';
import { assertFulfillmentEligible } from './fulfillment-eligibility';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  openTransaction,
} from './transactions';

export interface SubmitOfferInput {
  listingId: string;
  buyerId: string;
  amountCents: number;
  fulfillmentPath: FulfillmentPath;
  /** The buyer's chosen payment method. Required by the web action. */
  settlementMethod?: SettlementMethod;
  relayStoreId?: string | null;
}

export async function submitOffer(input: SubmitOfferInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const listing = await lockedListing(tx, input.listingId);

    const askingPrice = listing.price_cents === null ? null : Number(listing.price_cents);

    if (listing.seller_id === input.buyerId) {
      throw new ForbiddenError('You cannot make an offer on your own listing');
    }
    if (listing.sale_type !== 'straight_sale' || askingPrice === null) {
      throw new ConflictError('Offers are only available on fixed-price listings');
    }
    if (!listing.accepts_offers) {
      throw new ConflictError('This seller is not accepting offers on this listing');
    }
    if (listing.status !== 'active') {
      throw new ConflictError('This listing is no longer available for offers');
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new ConflictError('Enter a valid offer amount');
    }
    if (input.amountCents >= askingPrice) {
      throw new ConflictError('Your offer must be below the asking price');
    }
    assertPath(listing.fulfillment_paths, input.fulfillmentPath);
    const settlementMethod =
      input.settlementMethod ?? (listing.settlement_methods[0] as SettlementMethod | undefined);
    assertSettlementMethod(listing.settlement_methods, settlementMethod);

    const restrictions = await activeRestrictions(tx, input.buyerId);
    if (restrictions.includes('claim_blocked')) {
      throw new ForbiddenError(
        'Making offers is paused on your account because of recent unpaid claims.',
      );
    }
    const relayStoreId = input.fulfillmentPath === 'relay' ? input.relayStoreId ?? null : null;
    await assertFulfillmentEligible(tx, {
      path: input.fulfillmentPath,
      relayStoreId,
      sizeClass: listing.size_class,
      buyerRestrictions: restrictions,
    });

    const existing = await tx
      .select({ id: offers.id })
      .from(offers)
      .where(
        and(
          eq(offers.listingId, input.listingId),
          eq(offers.buyerId, input.buyerId),
          eq(offers.status, 'pending'),
        ),
      )
      .limit(1);
    if (existing[0] !== undefined) return existing[0];

    const inserted = await tx
      .insert(offers)
      .values({
        listingId: input.listingId,
        buyerId: input.buyerId,
        amountCents: input.amountCents,
        fulfillmentPath: input.fulfillmentPath,
        settlementMethod,
        relayStoreId,
        status: 'pending',
      })
      .returning({ id: offers.id });
    const created = inserted[0];
    if (created === undefined) throw new Error('Failed to create offer');

    await notify({
      tx,
      userId: listing.seller_id,
      event: 'offer_received_seller',
      data: {
        listingTitle: listing.title,
        buyerName: await displayName(tx, input.buyerId),
        amount: formatMoney(input.amountCents),
      },
      linkUrl: `/listings/${input.listingId}`,
      idempotencyKey: `offer_received:${created.id}`,
    });

    return created;
  });
}

export async function acceptOffer(
  offerId: string,
  sellerId: string,
): Promise<{ transactionId: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sqlOfferWithListing(offerId));
    const row = rows.rows[0] as OfferWithListingRow | undefined;
    if (row === undefined) throw new NotFoundError('Offer not found');
    if (row.seller_id !== sellerId) throw new ForbiddenError('Only the seller can accept this offer');
    if (row.offer_status !== 'pending') throw new ConflictError('This offer has already been answered');
    if (row.active_transaction_id !== null) {
      throw new ConflictError('A deal is already in progress for this listing');
    }
    if (row.listing_status !== 'active' || row.sale_type !== 'straight_sale') {
      throw new ConflictError('This listing is no longer available for offers');
    }
    if (!row.accepts_offers) {
      throw new ConflictError('This seller is not accepting offers on this listing');
    }
    if (
      row.price_cents === null ||
      Number(row.amount_cents) >= Number(row.price_cents)
    ) {
      throw new ConflictError('This offer is no longer below the asking price');
    }

    assertPath(row.fulfillment_paths, row.fulfillment_path);
    const settlementMethod = row.settlement_method ?? (row.settlement_methods[0] as SettlementMethod | undefined);
    assertSettlementMethod(row.settlement_methods, settlementMethod);
    const relayStoreId = row.fulfillment_path === 'relay' ? row.relay_store_id : null;
    const restrictions = await activeRestrictions(tx, row.buyer_id);
    if (restrictions.includes('claim_blocked')) {
      throw new ForbiddenError('This buyer cannot open a deal right now');
    }
    await assertFulfillmentEligible(tx, {
      path: row.fulfillment_path,
      relayStoreId,
      sizeClass: row.size_class,
      buyerRestrictions: restrictions,
    });

    const claimed = await tx.execute(sql`
      update listings
         set status = 'claimed', resolved_at = now(), updated_at = now()
       where id = ${row.listing_id} and status = 'active' and sale_type = 'straight_sale'
      returning id
    `);
    if (claimed.rows.length === 0) throw new ConflictError('This listing is no longer available');

    await tx
      .update(offers)
      .set({ status: 'accepted', respondedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(offers.id, offerId), eq(offers.status, 'pending')));

    const opened = await openTransaction({
      tx,
      listingId: row.listing_id,
      sellerId: row.seller_id,
      buyerId: row.buyer_id,
      amountCents: Number(row.amount_cents),
      fulfillmentPath: row.fulfillment_path,
      source: 'offer_accept',
      offerId,
      listingTitle: row.listing_title,
      paymentWindowHours: Number(row.payment_window_hours),
      settlementMethod,
      relayStoreId,
    });

    return { transactionId: opened.id };
  });
}

export async function rejectOffer(offerId: string, sellerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.execute(sqlOfferWithListing(offerId));
    const row = rows.rows[0] as OfferWithListingRow | undefined;
    if (row === undefined) throw new NotFoundError('Offer not found');
    if (row.seller_id !== sellerId) throw new ForbiddenError('Only the seller can reject this offer');
    if (row.offer_status !== 'pending') throw new ConflictError('This offer has already been answered');

    const updated = await tx
      .update(offers)
      .set({ status: 'rejected', respondedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(offers.id, offerId), eq(offers.status, 'pending')))
      .returning({ id: offers.id });
    if (updated.length === 0) throw new ConflictError('This offer has already been answered');

    await notify({
      tx,
      userId: row.buyer_id,
      event: 'offer_rejected_buyer',
      data: { listingTitle: row.listing_title },
      linkUrl: `/listings/${row.listing_id}`,
      idempotencyKey: `offer_rejected:${offerId}`,
    });
  });
}

export async function pendingOffersForSeller(listingId: string, sellerId: string) {
  return db
    .select({
      id: offers.id,
      buyerId: offers.buyerId,
      buyerName: profiles.displayName,
      amountCents: offers.amountCents,
      fulfillmentPath: offers.fulfillmentPath,
      settlementMethod: offers.settlementMethod,
      relayStoreId: offers.relayStoreId,
      createdAt: offers.createdAt,
    })
    .from(offers)
    .innerJoin(profiles, eq(profiles.userId, offers.buyerId))
    .innerJoin(listings, eq(listings.id, offers.listingId))
    .where(
      and(
        eq(offers.listingId, listingId),
        eq(offers.status, 'pending'),
        eq(listings.sellerId, sellerId),
      ),
    )
    .orderBy(desc(offers.createdAt));
}

/** Pending offers across every listing owned by this seller, for their work inbox. */
export async function pendingOffersReceivedBySeller(sellerId: string) {
  return db
    .select({
      id: offers.id,
      listingId: offers.listingId,
      listingTitle: listings.title,
      buyerId: offers.buyerId,
      buyerName: profiles.displayName,
      amountCents: offers.amountCents,
      fulfillmentPath: offers.fulfillmentPath,
      settlementMethod: offers.settlementMethod,
      relayStoreName: relayStores.name,
      relayStoreArea: relayStores.area,
      listingStatus: listings.status,
      activeTransactionId: listings.activeTransactionId,
      createdAt: offers.createdAt,
    })
    .from(offers)
    .innerJoin(profiles, eq(profiles.userId, offers.buyerId))
    .innerJoin(listings, eq(listings.id, offers.listingId))
    .leftJoin(relayStores, eq(relayStores.id, offers.relayStoreId))
    .where(and(eq(offers.status, 'pending'), eq(listings.sellerId, sellerId)))
    .orderBy(desc(offers.createdAt))
    .limit(50);
}

export async function countPendingOffersReceivedBySeller(sellerId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(offers)
    .innerJoin(listings, eq(listings.id, offers.listingId))
    .where(and(eq(offers.status, 'pending'), eq(listings.sellerId, sellerId)));
  return Number(rows[0]?.value ?? 0);
}

export async function latestOfferForBuyer(listingId: string, buyerId: string) {
  const rows = await db
    .select({
      id: offers.id,
      amountCents: offers.amountCents,
      status: offers.status,
      createdAt: offers.createdAt,
    })
    .from(offers)
    .where(and(eq(offers.listingId, listingId), eq(offers.buyerId, buyerId)))
    .orderBy(desc(offers.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

function assertPath(declared: string[], selected: FulfillmentPath): void {
  if (!FULFILLMENT_PATHS.includes(selected) || !declared.includes(selected)) {
    throw new ConflictError('The seller does not accept that fulfillment method');
  }
}

function assertSettlementMethod(
  declared: string[],
  selected: SettlementMethod | undefined,
): asserts selected is SettlementMethod {
  if (selected === undefined || !SETTLEMENT_METHODS.includes(selected) || !declared.includes(selected)) {
    throw new ConflictError('Choose a payment method accepted by the seller');
  }
}

async function displayName(tx: Tx, userId: string): Promise<string> {
  const rows = await tx
    .select({ name: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0]?.name ?? 'A member';
}

async function lockedListing(tx: Tx, listingId: string): Promise<ListingRow> {
  const rows = await tx.execute(sql`
    select id, seller_id, title, sale_type, status, price_cents, fulfillment_paths, settlement_methods, size_class, accepts_offers
      from listings
     where id = ${listingId}
     for update
  `);
  const row = rows.rows[0] as ListingRow | undefined;
  if (row === undefined) throw new NotFoundError('Listing not found');
  return row;
}

function sqlOfferWithListing(offerId: string) {
  return sql`
    select
      o.id as offer_id,
      o.listing_id,
      o.buyer_id,
      o.amount_cents,
      o.fulfillment_path,
      o.settlement_method,
      o.relay_store_id,
      o.status as offer_status,
      l.seller_id,
      l.title as listing_title,
      l.sale_type,
      l.status as listing_status,
      l.active_transaction_id,
      l.price_cents,
      l.fulfillment_paths,
      l.settlement_methods,
      l.accepts_offers,
      l.payment_window_hours,
      l.size_class
      from offers o
      inner join listings l on l.id = o.listing_id
     where o.id = ${offerId}
     for update of o, l
  `;
}

interface ListingRow {
  id: string;
  seller_id: string;
  title: string;
  sale_type: 'straight_sale' | 'auction';
  status: string;
  price_cents: number | string | null;
  fulfillment_paths: string[];
  settlement_methods: string[];
  accepts_offers: boolean;
  size_class: SizeClass;
}

interface OfferWithListingRow {
  offer_id: string;
  listing_id: string;
  buyer_id: string;
  amount_cents: number | string;
  fulfillment_path: FulfillmentPath;
  settlement_method: SettlementMethod | null;
  relay_store_id: string | null;
  offer_status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  seller_id: string;
  listing_title: string;
  sale_type: 'straight_sale' | 'auction';
  listing_status: string;
  active_transaction_id: string | null;
  price_cents: number | string | null;
  fulfillment_paths: string[];
  settlement_methods: string[];
  accepts_offers: boolean;
  payment_window_hours: number | string;
  size_class: SizeClass;
}
