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
 * Exactly one concurrent caller gets a row back. Everyone else gets zero rows and joins
 * the backup stack instead — which is a feature, not a consolation prize: when the top
 * claimer's window lapses, the next person is promoted automatically and the seller
 * does nothing.
 *
 * Written as literal SQL rather than ORM calls because this is one of the four places
 * where correctness depends on contention behaviour, and it should be readable as SQL.
 */

import { and, eq, sql } from 'drizzle-orm';

import { db, type Tx } from '../client';
import { listings, claims } from '../schema/listings';
import { openTransaction, ConflictError, ForbiddenError } from '../../services/transactions';
import { activeRestrictions } from '../../services/reputation';
import { assertFulfillmentEligible } from '../../services/fulfillment-eligibility';
import { notify } from '../../notifications/dispatch';
import { WINDOWS } from '../../domain/policy/windows';
import type { FulfillmentPath } from '../../domain/states/transaction';

export interface ClaimResult {
  outcome: 'claimed' | 'queued';
  /** Present when outcome === 'claimed'. */
  transactionId?: string;
  /** Present when outcome === 'queued'. */
  position?: number;
}

export async function claimListing(opts: {
  listingId: string;
  claimantId: string;
  fulfillmentPath: FulfillmentPath;
  /** Which relay store the buyer will use. Required when path === 'relay'. */
  relayStoreId?: string | null;
}): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const listing = await loadListingForClaim(tx, opts.listingId);

    if (listing.sellerId === opts.claimantId) {
      throw new ForbiddenError('You cannot claim your own listing');
    }
    if (listing.saleType !== 'straight_sale') {
      throw new ConflictError('This is an auction — place a bid instead');
    }
    if (!listing.fulfillmentPaths.includes(opts.fulfillmentPath)) {
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
      path: opts.fulfillmentPath,
      relayStoreId: opts.relayStoreId,
      sizeClass: listing.sizeClass,
      buyerRestrictions: restrictions,
    });

    // Already in the stack? Idempotent — return their existing position.
    const existing = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.listingId, opts.listingId), eq(claims.claimantId, opts.claimantId)))
      .limit(1);
    if (existing[0] !== undefined) {
      const row = existing[0];
      return row.status === 'active' && row.transactionId !== null
        ? { outcome: 'claimed' as const, transactionId: row.transactionId }
        : { outcome: 'queued' as const, position: row.position };
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
          fulfillmentPath: opts.fulfillmentPath,
          relayStoreId: opts.relayStoreId ?? null,
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
        fulfillmentPath: opts.fulfillmentPath,
        source: 'claim',
        claimId: claim.id,
        listingTitle: listing.title,
        relayStoreId: opts.relayStoreId ?? null,
      });

      await tx.update(claims).set({ transactionId: opened.id }).where(eq(claims.id, claim.id));

      return { outcome: 'claimed' as const, transactionId: opened.id };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Lost the race (or the listing was already claimed) -> join the backup stack.
    //
    // Zero rows from the UPDATE means no row lock was taken, so two simultaneous
    // backups could compute the same position. SELECT ... FOR UPDATE serialises them.
    // Contention here is low, so a row lock costs nothing.
    // ────────────────────────────────────────────────────────────────────────
    const locked = await tx.execute(sql`
      select status from listings where id = ${opts.listingId} for update
    `);
    const status = (locked.rows[0] as { status: string } | undefined)?.status;

    if (status !== 'claimed') {
      throw new ConflictError('This listing is no longer available');
    }

    const depth = await tx.execute(sql`
      select coalesce(max(position), 0) + 1 as next from claims where listing_id = ${opts.listingId}
    `);
    const position = Number((depth.rows[0] as { next: string }).next);

    if (position > WINDOWS.maxClaimStackDepth) {
      throw new ConflictError(
        `The backup queue for this listing is full (${WINDOWS.maxClaimStackDepth} deep).`,
      );
    }

    await tx.insert(claims).values({
      listingId: opts.listingId,
      claimantId: opts.claimantId,
      position,
      status: 'queued',
      fulfillmentPath: opts.fulfillmentPath,
      relayStoreId: opts.relayStoreId ?? null,
    });

    await notify({
      tx,
      userId: opts.claimantId,
      event: 'claim_queued_buyer',
      data: { listingTitle: listing.title, position: String(position) },
      linkUrl: `/listings/${opts.listingId}`,
      idempotencyKey: `queued:${opts.listingId}:${opts.claimantId}`,
    });

    return { outcome: 'queued' as const, position };
  });
}

async function loadListingForClaim(tx: Tx, listingId: string) {
  const rows = await tx.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  const listing = rows[0];
  if (listing === undefined) throw new ConflictError('Listing not found');
  return listing;
}
