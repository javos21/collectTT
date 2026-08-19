/**
 * ★ ATOMIC BID + ANTI-SNIPE SOFT CLOSE.
 *
 * One conditional UPDATE decides whether a bid is good, and extends the deadline in the
 * same statement if it landed inside the closing window:
 *
 *     UPDATE listings SET current_bid_cents = $amount,
 *            ends_at = CASE WHEN closing soon THEN now() + extension ELSE ends_at END
 *      WHERE status='active' AND ends_at > now() AND $amount >= minimum
 *
 * Because the extension is computed from the DATABASE clock inside the same statement
 * that accepts the bid, there is no window in which a bid is accepted against a stale
 * deadline. "Closes 8:00" means "closes 8:00 unless bids keep landing" — a soft close,
 * communicated up front, not a bug.
 *
 * The (listing_id, amount_cents) unique index makes the bid ladder a TOTAL order, so
 * promoting a runner-up later is never ambiguous.
 */

import { and, eq, ne, sql } from 'drizzle-orm';

import { db, type Tx } from '../client';
import { listings, bids } from '../schema/listings';
import { relayStores } from '../schema/custody';
import { openTransaction, ConflictError, ForbiddenError } from '../../services/transactions';
import { activeRestrictions } from '../../services/reputation';
import { notify } from '../../notifications/dispatch';
import { enqueue } from '../../jobs/enqueue';
import { bidIncrement, formatMoney, minimumNextBid } from '../../domain/money';
import { checkEligibility } from '../../domain/policy/eligibility';
import type { FulfillmentPath } from '../../domain/states/transaction';
import type { SizeClass } from '../../domain/states/listing';

export interface BidResult {
  bidId: string;
  amountCents: number;
  /** True if this bid pushed the deadline out. */
  extended: boolean;
  endsAt: Date;
  /** Set when the bid was a buyout and the auction ended immediately. */
  transactionId?: string;
}

export async function placeBid(opts: {
  listingId: string;
  bidderId: string;
  amountCents: number;
  /**
   * ★ The bidder's own settlement choice, recorded on the bid the way the claim stack
   *   has always recorded it. Optional: a bid without one falls back to the listing's
   *   first declared path when the ladder is walked.
   */
  fulfillmentPath?: FulfillmentPath;
  /** Which relay store the bidder will collect from. Required when path === 'relay'. */
  relayStoreId?: string | null;
}): Promise<BidResult> {
  return db.transaction(async (tx) => {
    const listing = await loadListing(tx, opts.listingId);

    if (listing.sellerId === opts.bidderId) {
      throw new ForbiddenError('You cannot bid on your own listing');
    }
    if (listing.saleType !== 'auction') {
      throw new ConflictError('This is a straight sale — claim it instead');
    }
    if (listing.status !== 'active') {
      throw new ConflictError('This auction has closed');
    }

    const restrictions = await activeRestrictions(tx, opts.bidderId);
    if (restrictions.includes('bid_blocked') || restrictions.includes('claim_blocked')) {
      throw new ForbiddenError('Bidding is paused on your account because of recent unpaid deals.');
    }

    // ★ The SAME gate the claim stack uses, in the same words — a bidder and a claimer
    //   must be refused for the same reasons. It only runs when the bidder actually
    //   made a choice; a bid without one carries no path and no store.
    if (opts.fulfillmentPath !== undefined) {
      if (!listing.fulfillmentPaths.includes(opts.fulfillmentPath)) {
        throw new ConflictError('The seller does not accept that fulfillment method');
      }

      // The size gate runs against THIS store's declared limits, not a global default.
      let storeAcceptedSizes: readonly SizeClass[] | undefined;
      if (opts.fulfillmentPath === 'relay') {
        if (opts.relayStoreId === undefined || opts.relayStoreId === null) {
          throw new ConflictError('Choose which relay store you want to collect from');
        }
        const storeRows = await tx
          .select()
          .from(relayStores)
          .where(eq(relayStores.id, opts.relayStoreId))
          .limit(1);
        const store = storeRows[0];
        if (store === undefined || !store.active) {
          throw new ConflictError('That store is not currently accepting items');
        }
        storeAcceptedSizes = store.acceptsSizeClasses;
      }

      const eligibility = checkEligibility({
        path: opts.fulfillmentPath,
        sizeClass: listing.sizeClass,
        buyerRestrictions: restrictions,
        ...(storeAcceptedSizes !== undefined ? { storeAcceptedSizes } : {}),
      });
      if (!eligibility.eligible) {
        throw new ConflictError(eligibility.reasons.join(' '));
      }
    }

    const startBid = listing.startBidCents ?? 0;
    const minimum = minimumNextBid(listing.currentBidCents, startBid);
    const isBuyout =
      listing.buyoutCents !== null && opts.amountCents >= listing.buyoutCents;

    if (!isBuyout && opts.amountCents < minimum) {
      throw new ConflictError(
        `Minimum bid is ${formatMoney(minimum)} (increment ${formatMoney(
          bidIncrement(listing.currentBidCents ?? startBid),
        )}).`,
      );
    }

    // Record the bid first so we have its id for listings.current_bid_id. If the
    // conditional UPDATE below rejects, the whole transaction rolls back and this row
    // never existed.
    const insertedBid = await tx
      .insert(bids)
      .values({
        listingId: opts.listingId,
        bidderId: opts.bidderId,
        amountCents: opts.amountCents,
        isBuyout,
        fulfillmentPath: opts.fulfillmentPath ?? null,
        relayStoreId: opts.relayStoreId ?? null,
        status: 'active',
      })
      .returning({ id: bids.id });

    const bid = insertedBid[0];
    if (bid === undefined) throw new Error('Failed to record bid');

    const previousLeaderId = await currentLeader(tx, opts.listingId, bid.id);

    // ────────────────────────────────────────────────────────────────────────
    // ★ THE atomic accept-and-extend.
    // ────────────────────────────────────────────────────────────────────────
    const result = await tx.execute(sql`
      update listings
         set current_bid_cents = ${opts.amountCents},
             current_bid_id    = ${bid.id},
             bid_count         = bid_count + 1,
             ends_at = case
               when ends_at - now() < (antisnipe_window_s || ' seconds')::interval
                and (max_extensions is null or extension_count < max_extensions)
               then now() + (antisnipe_extend_s || ' seconds')::interval
               else ends_at
             end,
             extension_count = case
               when ends_at - now() < (antisnipe_window_s || ' seconds')::interval
                and (max_extensions is null or extension_count < max_extensions)
               then extension_count + 1
               else extension_count
             end,
             updated_at = now()
       where id = ${opts.listingId}
         and status = 'active'
         and sale_type = 'auction'
         and ends_at > now()
         and (current_bid_cents is null or ${opts.amountCents} > current_bid_cents)
      returning ends_at, extension_count, title, seller_id
    `);

    if (result.rows.length === 0) {
      // Either the auction closed between our read and our write, or someone outbid us
      // in the same instant. Both are "try again", not an error worth a stack trace.
      throw new ConflictError('The auction moved on — refresh and try again.');
    }

    const row = result.rows[0] as {
      ends_at: Date;
      extension_count: number;
      title: string;
      seller_id: string;
    };
    const extended = Number(row.extension_count) > listing.extensionCount;

    if (extended) {
      await tx.update(bids).set({ extendedAuction: true }).where(eq(bids.id, bid.id));
      // The close job re-reads ends_at when it fires, but rescheduling keeps the queue
      // tidy and the wake-up close to the real deadline.
      await enqueue(
        tx,
        'auction:close',
        { listingId: opts.listingId },
        { jobKey: `auction_close:${opts.listingId}`, runAt: new Date(row.ends_at) },
      );
    }

    // Demote the previous leader.
    await tx
      .update(bids)
      .set({ status: 'outbid' })
      .where(
        and(
          eq(bids.listingId, opts.listingId),
          ne(bids.id, bid.id),
          eq(bids.status, 'active'),
        ),
      );

    if (previousLeaderId !== null && previousLeaderId !== opts.bidderId) {
      await notify({
        tx,
        userId: previousLeaderId,
        event: 'auction_outbid',
        data: {
          listingTitle: row.title,
          currentBid: formatMoney(opts.amountCents),
          endsAt: new Date(row.ends_at).toLocaleString('en-TT'),
        },
        linkUrl: `/listings/${opts.listingId}`,
        idempotencyKey: `outbid:${bid.id}:${previousLeaderId}`,
      });
    }

    // ---- buyout ends the auction immediately
    if (isBuyout) {
      await tx
        .update(listings)
        .set({
          status: 'ended_won',
          endsAt: sql`now()`,
          resolvedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(listings.id, opts.listingId));

      await tx.update(bids).set({ status: 'won' }).where(eq(bids.id, bid.id));

      const opened = await openTransaction({
        tx,
        listingId: opts.listingId,
        sellerId: listing.sellerId,
        buyerId: opts.bidderId,
        amountCents: opts.amountCents,
        // ★ The buyer's OWN choice. Falls back to the listing's first declared path
        //   only when the bid carried none.
        fulfillmentPath: (opts.fulfillmentPath ??
          listing.fulfillmentPaths[0] ??
          'cash_meetup') as FulfillmentPath,
        source: 'auction_win',
        winningBidId: bid.id,
        listingTitle: listing.title,
        relayStoreId: opts.relayStoreId ?? null,
      });

      return {
        bidId: bid.id,
        amountCents: opts.amountCents,
        extended: false,
        endsAt: new Date(row.ends_at),
        transactionId: opened.id,
      };
    }

    return {
      bidId: bid.id,
      amountCents: opts.amountCents,
      extended,
      endsAt: new Date(row.ends_at),
    };
  });
}

async function currentLeader(tx: Tx, listingId: string, excludeBidId: string): Promise<string | null> {
  const rows = await tx
    .select({ bidderId: bids.bidderId })
    .from(bids)
    .where(and(eq(bids.listingId, listingId), eq(bids.status, 'active'), ne(bids.id, excludeBidId)))
    .orderBy(sql`${bids.amountCents} desc`)
    .limit(1);
  return rows[0]?.bidderId ?? null;
}

async function loadListing(tx: Tx, listingId: string) {
  const rows = await tx.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  const listing = rows[0];
  if (listing === undefined) throw new ConflictError('Listing not found');
  return listing;
}
