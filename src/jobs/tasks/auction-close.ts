/**
 * auction:close — resolve an auction at its deadline.
 *
 * ★ IDEMPOTENT AND SNIPE-PROOF. The job re-reads `ends_at` when it fires. If a late bid
 *   pushed the deadline out, the job RESCHEDULES ITSELF and does nothing else. That one
 *   rule makes the soft close immune to races: it does not matter how many times the
 *   deadline moves, or how many duplicate deliveries arrive.
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db, dbNow } from '../../db/client';
import { listings, bids } from '../../db/schema/listings';
import { openTransaction } from '../../services/transactions';
import { CustodyConflictError } from '../../services/custody';
import { notify } from '../../notifications/dispatch';
import { enqueue } from '../enqueue';
import { formatMoney } from '../../domain/money';
import { fallbackFulfillmentPath } from '../../domain/states/transaction';

interface Payload {
  listingId: string;
}

export async function auctionClose(payload: Payload, helpers: Helpers): Promise<void> {
  const { listingId } = payload;

  await db.transaction(async (tx) => {
    const rows = await tx.select().from(listings).where(eq(listings.id, listingId)).limit(1);
    const listing = rows[0];

    if (listing === undefined) {
      helpers.logger.info(`auction ${listingId} not found`);
      return;
    }
    if (listing.status !== 'active' || listing.saleType !== 'auction') {
      helpers.logger.info(`auction ${listingId} is ${listing.status} — nothing to close`);
      return;
    }

    // ★ Has the deadline moved since this job was scheduled? Re-read it, do not trust
    //   the schedule. This is the anti-snipe guarantee.
    const now = await dbNow(tx);

    if (listing.endsAt !== null && listing.endsAt.getTime() > now.getTime()) {
      helpers.logger.info(
        `auction ${listingId} was extended to ${listing.endsAt.toISOString()} — rescheduling`,
      );
      await enqueue(
        tx,
        'auction:close',
        { listingId },
        { jobKey: `auction_close:${listingId}`, runAt: listing.endsAt },
      );
      return;
    }

    // ---- find the winner
    const topBids = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.listingId, listingId), ne(bids.status, 'void'), ne(bids.status, 'retracted')))
      .orderBy(desc(bids.amountCents))
      .limit(1);

    const winner = topBids[0];
    const clearsReserve =
      winner !== undefined &&
      (listing.reserveCents === null || winner.amountCents >= listing.reserveCents);

    // End the auction without a buyer. Shared by "no bids", "reserve not met", and
    // "the winning bid could not be placed in custody".
    const endWithoutSale = async (summary: string): Promise<void> => {
      await tx
        .update(listings)
        .set({
          status: 'ended_no_sale',
          resolvedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(listings.id, listingId), eq(listings.status, 'active')));

      await notify({
        tx,
        userId: listing.sellerId,
        event: 'auction_ended_seller',
        data: { listingTitle: listing.title, summary },
        linkUrl: `/listings/${listingId}`,
        idempotencyKey: `auction_no_sale:${listingId}`,
      });

      helpers.logger.info(`auction ${listingId} closed with no sale`);
    };

    if (winner === undefined || !clearsReserve) {
      await endWithoutSale(
        winner === undefined
          ? 'No bids were placed.'
          : `The top bid of ${formatMoney(winner.amountCents)} did not meet your reserve.`,
      );
      return;
    }

    // ---- we have a winner
    //
    // ★ The whole sale runs in a SAVEPOINT. Custody can refuse to open — the winner's
    //   nominated store was deactivated (the spec's designated way to take a shop
    //   offline), or it no longer accepts this size. Without the savepoint that refusal
    //   fails the JOB, which graphile-worker retries to exhaustion, leaving the listing
    //   `active` past its `endsAt` with no winner and nobody told. Rolling back to the
    //   savepoint restores the listing and the bid ladder exactly as they were, so the
    //   no-sale branch can close it honestly instead.
    let refusal: string | null = null;
    const outcome = await tx
      .transaction(async (sp): Promise<'sold' | 'already_closed'> => {
        const closed = await sp
          .update(listings)
          .set({ status: 'ended_won', resolvedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(listings.id, listingId), eq(listings.status, 'active')))
          .returning({ id: listings.id });

        // Another delivery of this job beat us to it.
        if (closed.length === 0) return 'already_closed';

        await sp.update(bids).set({ status: 'won' }).where(eq(bids.id, winner.id));
        await sp
          .update(bids)
          .set({ status: 'outbid' })
          .where(
            and(eq(bids.listingId, listingId), ne(bids.id, winner.id), eq(bids.status, 'active')),
          );

        const opened = await openTransaction({
          tx: sp,
          listingId,
          sellerId: listing.sellerId,
          buyerId: winner.bidderId,
          amountCents: winner.amountCents,
          // ★ The winner's OWN choice, recorded when they bid. Falls back to the first
          //   store-free declared path only for bids placed before Phase 2, which carry
          //   neither a path nor a store — see fallbackFulfillmentPath.
          fulfillmentPath:
            winner.fulfillmentPath ?? fallbackFulfillmentPath(listing.fulfillmentPaths),
          source: 'auction_win',
          winningBidId: winner.id,
          listingTitle: listing.title,
          relayStoreId: winner.relayStoreId,
        });

        await notify({
          tx: sp,
          userId: listing.sellerId,
          event: 'auction_ended_seller',
          data: {
            listingTitle: listing.title,
            summary: `Sold for ${formatMoney(winner.amountCents)}.`,
          },
          linkUrl: `/deals/${opened.id}`,
          idempotencyKey: `auction_sold:${listingId}`,
        });

        return 'sold';
      })
      .catch((error: unknown) => {
        if (!(error instanceof CustodyConflictError)) throw error;
        refusal = error.message;
        return 'custody_unavailable' as const;
      });

    if (outcome === 'already_closed') return;

    if (outcome === 'custody_unavailable') {
      const reason: string = refusal ?? 'the item could not be placed in custody';
      helpers.logger.warn(
        `auction ${listingId}: the winning bid could not take custody (${reason}) — closing with no sale`,
      );
      await endWithoutSale(`The winning bid could not be fulfilled: ${reason}`);
      return;
    }

    helpers.logger.info(
      `auction ${listingId} closed — won by ${winner.bidderId} at ${winner.amountCents}`,
    );
  });
}
