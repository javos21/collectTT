/**
 * Objective reputation.
 *
 * `reputation_events` is append-only and is the truth. Counters are a cache.
 * Only verified transaction outcomes feed the automatic restrictions.
 *
 * Every function here takes an open transaction: a reputation fact and the state change
 * that caused it must commit together or not at all.
 */

import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';

import type { Tx } from '../db/client';
import {
  reputationEvents,
  reputationCounters,
  restrictions,
  profiles,
} from '../db/schema/profiles';
import {
  THRESHOLDS,
  buyerRestrictions,
  sellerRestrictions,
  type ReputationEventType,
  type RestrictionType,
} from '../domain/policy/reputation';
import { notify } from '../notifications/dispatch';

/** Which counter column each event type increments. */
const COUNTER_COLUMN: Partial<Record<ReputationEventType, keyof typeof reputationCounters.$inferSelect>> = {
  purchase_completed: 'buyCompleted',
  sale_completed: 'sellCompleted',
  buyer_paid_on_time: 'buyPaidOnTime',
  buyer_reneged_nonpayment: 'buyRenegedTotal',
  buyer_no_show: 'buyNoShows',
  seller_reneged_no_dropoff: 'sellRenegedTotal',
  seller_no_show: 'sellNoShows',
};

export interface RecordEventInput {
  tx: Tx;
  userId: string;
  type: ReputationEventType;
  transactionId?: string | null;
  counterpartyUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record one objective fact.
 *
 * ★ IDEMPOTENT. The (transaction_id, user_id, type) unique index means a retried job
 *   cannot double-count, and `onConflictDoNothing` turns that into a silent no-op
 *   rather than an error — so job handlers do not need to guard.
 *
 * Returns true if the fact was newly recorded, false if it already existed.
 */
export async function recordEvent(input: RecordEventInput): Promise<boolean> {
  const inserted = await input.tx
    .insert(reputationEvents)
    .values({
      userId: input.userId,
      type: input.type,
      transactionId: input.transactionId ?? null,
      counterpartyUserId: input.counterpartyUserId ?? null,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: reputationEvents.id });

  if (inserted.length === 0) return false;

  await ensureCounters(input.tx, input.userId);

  // Increment the lifetime counter for this fact, if it maps to one. The rolling
  // 90-day counters are recomputed nightly — they cannot be maintained incrementally
  // without a decay job, and a full recompute at 2,000 members is milliseconds.
  const column = COUNTER_COLUMN[input.type];
  if (column !== undefined) {
    await input.tx
      .update(reputationCounters)
      .set({ [column]: sql`${reputationCounters[column]} + 1` })
      .where(eq(reputationCounters.userId, input.userId));
  }

  return true;
}

export async function ensureCounters(tx: Tx, userId: string): Promise<void> {
  await tx.insert(reputationCounters).values({ userId }).onConflictDoNothing();
}

/** Bump a counter that has no corresponding event (e.g. claims attempted). */
export async function incrementCounter(
  tx: Tx,
  userId: string,
  column: 'buyClaimsTotal' | 'sellListingsResolved',
): Promise<void> {
  await ensureCounters(tx, userId);
  await tx
    .update(reputationCounters)
    .set({ [column]: sql`${reputationCounters[column]} + 1` })
    .where(eq(reputationCounters.userId, userId));
}

/**
 * Recompute the rolling 90-day windows from the append-only events.
 * Called nightly by `reputation:recompute`, and after any renege so a restriction
 * takes effect immediately rather than at 3am.
 */
export async function recomputeRollingWindows(tx: Tx, userId?: string): Promise<void> {
  // Correlated subqueries in SET, not a LATERAL join in FROM: Postgres does not allow
  // a lateral reference to the UPDATE target table.
  const since = sql`now() - make_interval(days => ${THRESHOLDS.rollingWindowDays})`;
  const scope = userId === undefined ? sql`true` : sql`c.user_id = ${userId}`;

  await tx.execute(sql`
    update reputation_counters c
       set buy_reneged_90d = (
             select count(*)::int from reputation_events e
              where e.user_id = c.user_id
                and e.type in ('buyer_reneged_nonpayment', 'buyer_no_show')
                and e.occurred_at >= ${since}
           ),
           sell_reneged_90d = (
             select count(*)::int from reputation_events e
              where e.user_id = c.user_id
                and e.type in ('seller_reneged_no_dropoff', 'seller_no_show')
                and e.occurred_at >= ${since}
           ),
           recomputed_at = now()
     where ${scope}
  `);
}

/**
 * Apply (or lift) the automatic restrictions a member's objective record earns them.
 *
 * Deliberately conservative — a false positive locks a real member out of a small
 * community, which costs far more than a false negative. Restrictions are derived
 * fresh each time, so recovering behaviour lifts them automatically.
 */
export async function evaluateRestrictions(tx: Tx, userId: string): Promise<RestrictionType[]> {
  await recomputeRollingWindows(tx, userId);

  const rows = await tx
    .select()
    .from(reputationCounters)
    .where(eq(reputationCounters.userId, userId))
    .limit(1);

  const c = rows[0];
  if (c === undefined) return [];

  const earned = [
    ...buyerRestrictions({ buyRenegedIn90d: c.buyReneged90d, buyCompleted: c.buyCompleted }),
    ...sellerRestrictions({
      sellRenegedIn90d: c.sellReneged90d,
      sellNoShows: c.sellNoShows,
      sellCompleted: c.sellCompleted,
    }),
  ];

  const existing = await tx
    .select({ id: restrictions.id, type: restrictions.type })
    .from(restrictions)
    .where(
      and(
        eq(restrictions.userId, userId),
        eq(restrictions.source, 'automatic'),
        isNull(restrictions.liftedAt),
      ),
    );

  const existingTypes = new Set(existing.map((r) => r.type));

  // Apply newly earned restrictions.
  for (const type of earned) {
    if (existingTypes.has(type)) continue;
    await tx.insert(restrictions).values({
      userId,
      type,
      source: 'automatic',
      reason: reasonFor(type, c.buyReneged90d, c.sellReneged90d + c.sellNoShows),
    });
    await notify({
      tx,
      userId,
      event: 'restriction_applied',
      data: { reason: reasonFor(type, c.buyReneged90d, c.sellReneged90d + c.sellNoShows) },
      idempotencyKey: `restriction:${userId}:${type}:${Date.now()}`,
    });
  }

  // Lift ones no longer earned — behaviour recovering should clear them without an admin.
  for (const row of existing) {
    if (earned.includes(row.type)) continue;
    await tx
      .update(restrictions)
      .set({ liftedAt: sql`now()` })
      .where(eq(restrictions.id, row.id));
  }

  return earned;
}

function reasonFor(type: RestrictionType, buyerFailures: number, sellerFailures: number): string {
  switch (type) {
    case 'prepay_required':
      return `${buyerFailures} unpaid claims in the last ${THRESHOLDS.rollingWindowDays} days — sellers may require payment up front.`;
    case 'claim_blocked':
      return `${buyerFailures} unpaid claims in the last ${THRESHOLDS.rollingWindowDays} days — claiming is paused.`;
    case 'meetup_only':
      return `${sellerFailures} undelivered sales in the last ${THRESHOLDS.rollingWindowDays} days — meetup deals only.`;
    case 'listing_cap':
      return `${sellerFailures} undelivered sales in the last ${THRESHOLDS.rollingWindowDays} days — new listings are paused.`;
    case 'bid_blocked':
      return 'Bidding is paused on this account.';
  }
}

/** Restrictions currently in force. Used by the claim/bid guards and the size gate. */
export async function activeRestrictions(tx: Tx, userId: string): Promise<RestrictionType[]> {
  const rows = await tx
    .select({ type: restrictions.type })
    .from(restrictions)
    .where(
      and(
        eq(restrictions.userId, userId),
        isNull(restrictions.liftedAt),
        or(isNull(restrictions.expiresAt), gte(restrictions.expiresAt, sql`now()`)),
      ),
    );
  return rows.map((r) => r.type);
}

export async function publicProfile(tx: Tx, userId: string) {
  const rows = await tx
    .select({
      displayName: profiles.displayName,
      handle: profiles.handle,
      memberSince: profiles.memberSince,
      counters: reputationCounters,
    })
    .from(profiles)
    .leftJoin(reputationCounters, eq(reputationCounters.userId, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
