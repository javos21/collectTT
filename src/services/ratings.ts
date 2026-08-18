/**
 * Blind mutual ratings.
 *
 * Neither side sees the other's rating until BOTH have submitted, or the window closes.
 * That is the whole anti-retaliation mechanism: you cannot punish a bad review you have
 * not seen, and you cannot wait to see theirs before writing yours. No moderation queue
 * required.
 *
 * Ratings are subjective and are kept strictly apart from the objective counters — they
 * never trigger a restriction.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, type Tx } from '../db/client';
import { ratings, reputationCounters } from '../db/schema/profiles';
import { transactions } from '../db/schema/transactions';
import { listings } from '../db/schema/listings';
import { notify } from '../notifications/dispatch';
import { recordEvent } from './reputation';
import { ConflictError, ForbiddenError, NotFoundError } from './transactions';

export interface SubmitRatingInput {
  transactionId: string;
  raterId: string;
  stars: number;
  comment?: string;
}

export async function submitRating(input: SubmitRatingInput): Promise<{ revealed: boolean }> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new ConflictError('Rating must be a whole number of stars from 1 to 5');
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ t: transactions, title: listings.title })
      .from(transactions)
      .innerJoin(listings, eq(listings.id, transactions.listingId))
      .where(eq(transactions.id, input.transactionId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) throw new NotFoundError('Deal not found');

    // Only completed deals can be rated — an unfinished deal has nothing to judge.
    if (row.t.state !== 'completed') {
      throw new ConflictError('Only completed deals can be rated');
    }

    const isBuyer = row.t.buyerId === input.raterId;
    const isSeller = row.t.sellerId === input.raterId;
    if (!isBuyer && !isSeller) {
      throw new ForbiddenError('Only the two parties to a deal can rate it');
    }

    const rateeId = isBuyer ? row.t.sellerId : row.t.buyerId;

    const inserted = await tx
      .insert(ratings)
      .values({
        transactionId: input.transactionId,
        raterId: input.raterId,
        rateeId,
        direction: isBuyer ? 'buyer_rates_seller' : 'seller_rates_buyer',
        stars: input.stars,
        comment: input.comment ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: ratings.id });

    if (inserted.length === 0) throw new ConflictError('You have already rated this deal');

    // If the counterpart has now also submitted, reveal both immediately — the window
    // exists only to stop a stalemate, not to delay a mutual result.
    const both = await tx
      .select({ id: ratings.id })
      .from(ratings)
      .where(eq(ratings.transactionId, input.transactionId));

    if (both.length === 2) {
      await revealRatings(tx, input.transactionId, row.title);
      return { revealed: true };
    }

    return { revealed: false };
  });
}

/**
 * Reveal whatever ratings exist for a transaction and fold them into the public
 * averages. Called when both sides submit, and by the `ratings:reveal` job when the
 * window closes with only one side in.
 *
 * IDEMPOTENT: guarded on `revealed_at IS NULL`.
 */
export async function revealRatings(
  tx: Tx,
  transactionId: string,
  listingTitle: string,
): Promise<number> {
  const revealed = await tx
    .update(ratings)
    .set({ revealedAt: sql`now()` })
    .where(and(eq(ratings.transactionId, transactionId), isNull(ratings.revealedAt)))
    .returning({
      id: ratings.id,
      rateeId: ratings.rateeId,
      raterId: ratings.raterId,
      stars: ratings.stars,
    });

  for (const rating of revealed) {
    // Recompute the ratee's average from revealed ratings only — an unrevealed rating
    // must not be inferable from a shifting average.
    await tx.execute(sql`
      update reputation_counters c
         set rating_count = sub.n,
             rating_avg = sub.avg
        from (
          select count(*)::int as n, round(avg(stars)::numeric, 2) as avg
            from ratings
           where ratee_id = ${rating.rateeId} and revealed_at is not null
        ) sub
       where c.user_id = ${rating.rateeId}
    `);

    await recordEvent({
      tx,
      userId: rating.rateeId,
      type: 'rating_received',
      transactionId,
      counterpartyUserId: rating.raterId,
      metadata: { stars: rating.stars },
    });

    await notify({
      tx,
      userId: rating.raterId,
      event: 'rating_revealed',
      data: { listingTitle },
      linkUrl: `/deals/${transactionId}`,
      idempotencyKey: `rating_revealed:${rating.id}`,
    });
  }

  return revealed.length;
}

/**
 * What the current viewer may see. Their own rating is always visible to them; the
 * counterpart's only once revealed.
 */
export async function ratingsFor(transactionId: string, viewerId: string) {
  const rows = await db.select().from(ratings).where(eq(ratings.transactionId, transactionId));

  return {
    mine: rows.find((r) => r.raterId === viewerId) ?? null,
    theirs: rows.find((r) => r.raterId !== viewerId && r.revealedAt !== null) ?? null,
    theirsPending: rows.some((r) => r.raterId !== viewerId && r.revealedAt === null),
  };
}

export async function publicRatings(userId: string, limit = 20) {
  return db
    .select({
      stars: ratings.stars,
      comment: ratings.comment,
      submittedAt: ratings.submittedAt,
      direction: ratings.direction,
    })
    .from(ratings)
    .where(and(eq(ratings.rateeId, userId), sql`${ratings.revealedAt} is not null`))
    .orderBy(sql`${ratings.submittedAt} desc`)
    .limit(limit);
}

export { reputationCounters };
