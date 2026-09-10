/**
 * ★ ATOMIC STRAIGHT-SALE CLAIM.
 *
 * "First to claim wins" becomes a single conditional UPDATE. Server receipt order
 * resolves it deterministically, so "I said mine first" disputes stop existing:
 *
 *     UPDATE listings SET status='claimed'
 *      WHERE id=$1 AND status='active'
 *     RETURNING *
 *
 * Exactly one concurrent caller gets a row back. Everyone else gets zero rows and is
 * told that the item was claimed by another collector. There is deliberately no
 * fixed-price backup queue: a claim is a single winner, and a later relist starts a
 * fresh claim attempt.
 *
 * Written as literal SQL rather than ORM calls because this is one of the four places
 * where correctness depends on contention behaviour, and it should be readable as SQL.
 */

import { and, eq, sql } from 'drizzle-orm';

import { db, type Tx } from '../client';
import { listings, claims } from '../schema/listings';
import { offers } from '../schema/offers';
import { openTransaction, ConflictError, ForbiddenError } from '../../services/transactions';
import { activeRestrictions } from '../../services/reputation';
import { assertFulfillmentEligible } from '../../services/fulfillment-eligibility';
import { notify } from '../../notifications/dispatch';
import type { FulfillmentPath } from '../../domain/states/transaction';
import type { SettlementMethod } from '../../domain/policy/settlement';
import { getListingDeliveryOption } from '../../services/platform-settings';

export interface ClaimResult {
  outcome: 'claimed';
  transactionId: string;
}

export async function claimListing(opts: {
  listingId: string;
  claimantId: string;
  fulfillmentPath?: FulfillmentPath;
  /** Exact admin-managed delivery choice selected by the buyer. */
  deliveryOptionId?: string;
  /** Which payment method the buyer will use. Required by the web action. */
  settlementMethod?: SettlementMethod;
  /** Which relay store the buyer will use. Required when path === 'relay'. */
  relayStoreId?: string | null;
  /** Cancel this buyer's pending offer as part of the same atomic claim. */
  cancelPendingOfferId?: string;
}): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const listing = await loadListingForClaim(tx, opts.listingId);

    if (listing.sellerId === opts.claimantId) {
      throw new ForbiddenError('You cannot claim your own listing');
    }
    if (listing.saleType !== 'straight_sale') {
      throw new ConflictError('This is an auction — place a bid instead');
    }

    let fulfillmentPath = opts.fulfillmentPath;
    let deliveryOptionId = opts.deliveryOptionId;
    let settlementMethod = opts.settlementMethod;
    let relayStoreId = opts.relayStoreId;
    let offerToCancel: {
      id: string;
      fulfillmentPath: FulfillmentPath;
      settlementMethod: SettlementMethod | null;
      relayStoreId: string | null;
      deliveryOptionId: string | null;
    } | null = null;

    if (opts.cancelPendingOfferId !== undefined) {
      const pendingOfferRows = await tx.execute(sql`
        select id, fulfillment_path, delivery_option_id, settlement_method, relay_store_id
          from offers
         where id = ${opts.cancelPendingOfferId}
           and listing_id = ${opts.listingId}
           and buyer_id = ${opts.claimantId}
           and status = 'pending'
         for update
      `);
      const pendingOffer = pendingOfferRows.rows[0] as {
        id: string;
        fulfillment_path: FulfillmentPath;
        delivery_option_id: string | null;
        settlement_method: SettlementMethod | null;
        relay_store_id: string | null;
      } | undefined;
      if (pendingOffer === undefined) {
        throw new ConflictError('This offer is no longer pending');
      }
      fulfillmentPath = pendingOffer.fulfillment_path;
      deliveryOptionId = pendingOffer.delivery_option_id ?? undefined;
      if (settlementMethod === undefined) settlementMethod = pendingOffer.settlement_method ?? undefined;
      if (relayStoreId === undefined) relayStoreId = pendingOffer.relay_store_id;
      offerToCancel = {
        id: pendingOffer.id,
        fulfillmentPath: pendingOffer.fulfillment_path,
        settlementMethod: pendingOffer.settlement_method,
        relayStoreId: pendingOffer.relay_store_id,
        deliveryOptionId: pendingOffer.delivery_option_id,
      };
    } else {
      const pendingOfferRows = await tx.execute(sql`
        select id
          from offers
         where listing_id = ${opts.listingId}
           and buyer_id = ${opts.claimantId}
           and status = 'pending'
         for update
      `);
      if (pendingOfferRows.rows.length > 0) {
        throw new ConflictError('Cancel your pending offer before claiming this item');
      }
    }

    if (deliveryOptionId !== undefined) {
      const option = await getListingDeliveryOption(tx, opts.listingId, deliveryOptionId);
      if (option === null || option.fulfillmentPath === null) {
        throw new ConflictError('Choose a delivery option offered by the seller');
      }
      fulfillmentPath = option.fulfillmentPath as FulfillmentPath;
      if (option.requiresStore && (relayStoreId === undefined || relayStoreId === null)) {
        throw new ConflictError('Choose which pickup store you want to collect from');
      }
    }

    if (fulfillmentPath === undefined) {
      throw new ConflictError('Choose a delivery option');
    }
    settlementMethod ??= listing.settlementMethods[0] as SettlementMethod | undefined;
    if (settlementMethod === undefined || !listing.settlementMethods.includes(settlementMethod)) {
      throw new ConflictError('Choose a payment method accepted by the seller');
    }
    if (!listing.fulfillmentPaths.includes(fulfillmentPath)) {
      throw new ConflictError('The seller does not accept that fulfillment method');
    }

    // Objective-record gates. A restricted buyer is told why, not silently failed.
    const restrictions = await activeRestrictions(tx, opts.claimantId);
    if (restrictions.includes('claim_blocked')) {
      throw new ForbiddenError(
        'Claiming is paused on your account because of recent unpaid claims.',
      );
    }
    // ★ The shared gate — the same one `placeBid` runs, so a claimer and a bidder are
    //   refused for the same reasons in the same words.
    await assertFulfillmentEligible(tx, {
      listingId: opts.listingId,
      path: fulfillmentPath,
      requireListedStore: deliveryOptionId !== undefined,
      relayStoreId,
      buyerRestrictions: restrictions,
    });

    if (offerToCancel !== null) {
      const cancelled = await tx
        .update(offers)
        .set({ status: 'cancelled', respondedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(offers.id, offerToCancel.id), eq(offers.status, 'pending')))
        .returning({ id: offers.id });
      if (cancelled.length === 0) throw new ConflictError('This offer is no longer pending');

      await notify({
        tx,
        userId: listing.sellerId,
        event: 'offer_cancelled_seller',
        data: { listingTitle: listing.title },
        linkUrl: `/listings/${opts.listingId}`,
        idempotencyKey: `offer_cancelled:${offerToCancel.id}`,
      });
    }

    // A duplicate submission by the same buyer is idempotent while their deal is open.
    // Terminal historical claims do not block a later relist from being claimed again.
    const existing = await tx
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.listingId, opts.listingId),
          eq(claims.claimantId, opts.claimantId),
          eq(claims.status, 'active'),
        ),
      )
      .limit(1);
    if (existing[0] !== undefined) {
      const row = existing[0];
      if (row.transactionId !== null) {
        return { outcome: 'claimed' as const, transactionId: row.transactionId };
      }
      throw new ConflictError('Your claim is still being processed — please refresh.');
    }

    // ────────────────────────────────────────────────────────────────────────
    // ★ THE atomic claim. One statement decides the winner.
    // ────────────────────────────────────────────────────────────────────────
    const won = await tx.execute(sql`
      update listings
         set status = 'claimed',
             resolved_at = now(),
             updated_at = now()
       where id = ${opts.listingId}
         and status = 'active'
         and sale_type = 'straight_sale'
      returning id, price_cents, seller_id, title
    `);

    if (won.rows.length > 0) {
      // This caller won the race.
      const price = Number((won.rows[0] as { price_cents: string }).price_cents);

      const claimRows = await tx
        .insert(claims)
        .values({
          listingId: opts.listingId,
          claimantId: opts.claimantId,
          position: 1,
          status: 'active',
          fulfillmentPath,
          deliveryOptionId: deliveryOptionId ?? null,
          settlementMethod,
          relayStoreId: relayStoreId ?? null,
        })
        .returning({ id: claims.id });

      const claim = claimRows[0];
      if (claim === undefined) throw new Error('Failed to record claim');

      const opened = await openTransaction({
        tx,
        listingId: opts.listingId,
        sellerId: listing.sellerId,
        buyerId: opts.claimantId,
        amountCents: price,
        fulfillmentPath,
        deliveryOptionId: deliveryOptionId ?? null,
        source: 'claim',
        claimId: claim.id,
        listingTitle: listing.title,
        paymentWindowHours: listing.paymentWindowHours,
        settlementMethod,
        relayStoreId: relayStoreId ?? null,
      });

      await tx.update(claims).set({ transactionId: opened.id }).where(eq(claims.id, claim.id));

      const pendingOffers = await tx
        .select({ buyerId: offers.buyerId })
        .from(offers)
        .where(and(eq(offers.listingId, opts.listingId), eq(offers.status, 'pending')));
      await tx
        .update(offers)
        .set({ status: 'rejected', respondedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(offers.listingId, opts.listingId), eq(offers.status, 'pending')));
      for (const offer of pendingOffers) {
        await notify({
          tx,
          userId: offer.buyerId,
          event: 'offer_rejected_buyer',
          data: { listingTitle: listing.title },
          linkUrl: `/listings/${opts.listingId}`,
          idempotencyKey: `offer_rejected:claim:${claim.id}:${offer.buyerId}`,
        });
      }

      return { outcome: 'claimed' as const, transactionId: opened.id };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Lost the race (or the listing was already claimed). No claim record or transaction
    // is created for the loser; the conditional UPDATE above is the source of truth.
    // ────────────────────────────────────────────────────────────────────────
    throw new ConflictError('This item was just claimed by another collector.');
  });
}

async function loadListingForClaim(tx: Tx, listingId: string) {
  const rows = await tx.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  const listing = rows[0];
  if (listing === undefined) throw new ConflictError('Listing not found');
  return listing;
}
