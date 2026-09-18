/**
 * Objective reputation.
 *
 * `reputation_events` is append-only and is the truth. Counters are a cache.
 * Only verified transaction outcomes feed the automatic restrictions.
 *
 * Every function here takes an open transaction: a reputation fact and the state change
 * that caused it must commit together or not at all.
 */

import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { dbNow, type DbOrTx, type Tx } from '../db/client';
import { listings } from '../db/schema/listings';
import {
  reputationEvents,
  reputationCounters,
  restrictions,
  profiles,
} from '../db/schema/profiles';
import { transactions } from '../db/schema/transactions';
import {
  THRESHOLDS,
  buyerRestrictionsWithThresholds,
  sellerRestrictionsWithThresholds,
  type ReputationEventType,
  type RestrictionType,
} from '../domain/policy/reputation';
import { notify } from '../notifications/dispatch';
import { getRestrictionPolicy } from './platform-settings';

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

/** Events safe for the public trust surface. Admin corrections and allegations are
 * intentionally omitted; only transaction outcomes are visible to other members. */
const PUBLIC_REPUTATION_EVENT_TYPES: ReputationEventType[] = [
  'purchase_completed',
  'sale_completed',
  'buyer_paid_on_time',
  'buyer_paid_late',
  'buyer_reneged_nonpayment',
  'buyer_no_show',
  'seller_delivered_on_time',
  'seller_reneged_no_dropoff',
  'seller_no_show',
  'custody_overstay',
];

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
  // Rolling counters are recomputed nightly — they cannot be maintained incrementally
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
 * Recompute the rolling policy windows from the append-only events.
 * Called nightly by `reputation:recompute`, and after any renege so a restriction
 * takes effect immediately rather than at 3am.
 */
export async function recomputeRollingWindows(tx: Tx, userId?: string): Promise<void> {
  // Correlated subqueries in SET, not a LATERAL join in FROM: Postgres does not allow
  // a lateral reference to the UPDATE target table.
  const policy = await getRestrictionPolicy(tx);
  const since = sql`now() - make_interval(days => ${policy.lookbackDays})`;
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
  const policy = await getRestrictionPolicy(tx);

  const rows = await tx
    .select()
    .from(reputationCounters)
    .where(eq(reputationCounters.userId, userId))
    .limit(1);

  const c = rows[0];
  if (c === undefined) return [];

  const earned = [
    ...buyerRestrictionsWithThresholds({ buyRenegedIn90d: c.buyReneged90d, buyCompleted: c.buyCompleted }, policy.buyer),
    ...sellerRestrictionsWithThresholds({
      sellRenegedIn90d: c.sellReneged90d,
      sellNoShows: c.sellNoShows,
      sellCompleted: c.sellCompleted,
    }, policy.seller),
  ];

  const now = await dbNow(tx);
  const expiresAt = new Date(now.getTime() + policy.durationHours * 60 * 60 * 1000);
  const recentEvents = await tx
    .select({ id: reputationEvents.id, type: reputationEvents.type })
    .from(reputationEvents)
    .where(eq(reputationEvents.userId, userId))
    .orderBy(desc(reputationEvents.occurredAt))
    .limit(20);
  const sourceEventFor = (type: RestrictionType): string | null => {
    const seller = type === 'meetup_only' || type === 'publish_blocked' || type === 'listing_cap';
    const sourceTypes: ReputationEventType[] = seller
      ? ['seller_reneged_no_dropoff', 'seller_no_show']
      : ['buyer_reneged_nonpayment', 'buyer_no_show'];
    return recentEvents.find((event) => sourceTypes.includes(event.type))?.id ?? null;
  };

  await tx.update(restrictions)
    .set({ lifecycleStatus: 'expired' })
    .where(and(
      eq(restrictions.userId, userId),
      eq(restrictions.lifecycleStatus, 'active'),
      isNull(restrictions.liftedAt),
      lt(restrictions.expiresAt, now),
    ));

  const existing = await tx
    .select({ id: restrictions.id, type: restrictions.type })
    .from(restrictions)
    .where(
      and(
        eq(restrictions.userId, userId),
        eq(restrictions.source, 'automatic'),
        isNull(restrictions.liftedAt),
        or(isNull(restrictions.expiresAt), gte(restrictions.expiresAt, now)),
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
      sourceEventId: sourceEventFor(type),
      sourceActorUserId: null,
      lifecycleStatus: 'active',
      reason: reasonFor(type, c.buyReneged90d, c.sellReneged90d + c.sellNoShows, policy.lookbackDays),
      expiresAt,
    });
    await notify({
      tx,
      userId,
      event: 'restriction_applied',
      data: { reason: reasonFor(type, c.buyReneged90d, c.sellReneged90d + c.sellNoShows, policy.lookbackDays) },
      idempotencyKey: `restriction:${userId}:${type}:${c.buyReneged90d}:${c.sellReneged90d + c.sellNoShows}`,
    });
  }

  // Give members a chance to correct behaviour before the next progressive step.
  const buyerFailureWarnings = [
    { count: c.buyReneged90d, threshold: policy.buyer.prepayRequiredAt, scope: 'buyer prepay' },
    { count: c.buyReneged90d, threshold: policy.buyer.bidBlockedAt, scope: 'buyer bidding' },
    { count: c.buyReneged90d, threshold: policy.buyer.reserveBlockedAt, scope: 'buyer reservations' },
  ];
  const sellerFailureCount = c.sellReneged90d + c.sellNoShows;
  const sellerFailureWarnings = [{ count: sellerFailureCount, threshold: policy.seller.publishBlockedAt, scope: 'seller publishing' }];
  for (const warning of [...buyerFailureWarnings, ...sellerFailureWarnings]) {
    if (warning.threshold <= 1 || warning.count !== warning.threshold - 1) continue;
    await notify({
      tx,
      userId,
      event: 'restriction_warning',
      data: { reason: `${warning.count} incomplete ${warning.scope} event${warning.count === 1 ? '' : 's'} in the last ${policy.lookbackDays} days. One more may pause this scope.` },
      idempotencyKey: `restriction-warning:${userId}:${warning.scope}:${warning.count}`,
    });
  }

  // Lift ones no longer earned — behaviour recovering should clear them without an admin.
  for (const row of existing) {
    if (earned.includes(row.type)) continue;
    await tx
      .update(restrictions)
      .set({ liftedAt: sql`now()`, lifecycleStatus: 'lifted' })
      .where(eq(restrictions.id, row.id));
  }

  return earned;
}

function reasonFor(type: RestrictionType, buyerFailures: number, sellerFailures: number, lookbackDays: number = THRESHOLDS.rollingWindowDays): string {
  switch (type) {
    case 'prepay_required':
      return `${buyerFailures} unpaid claims in the last ${lookbackDays} days — sellers may require payment up front.`;
    case 'claim_blocked':
      return `${buyerFailures} unpaid claims in the last ${lookbackDays} days — claiming is paused.`;
    case 'meetup_only':
      return `${sellerFailures} undelivered sales in the last ${lookbackDays} days — meetup deals only.`;
    case 'listing_cap':
      return `${sellerFailures} undelivered sales in the last ${lookbackDays} days — new listings are paused.`;
    case 'bid_blocked':
      return 'Bidding is paused on this account.';
    case 'reserve_blocked':
      return `${buyerFailures} incomplete purchases in the recent policy window — reservations are paused.`;
    case 'publish_blocked':
      return `${sellerFailures} incomplete sales in the recent policy window — publishing is paused.`;
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
      memberSince: profiles.memberSince,
      counters: reputationCounters,
    })
    .from(profiles)
    .leftJoin(reputationCounters, eq(reputationCounters.userId, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export type TrustSnapshot = {
  userId: string;
  displayName: string;
  area: string | null;
  memberSince: Date;
  counters: {
    buyClaimsTotal: number;
    buyCompleted: number;
    buyReneged90d: number;
    buyPaidOnTime: number;
    sellCompleted: number;
    sellReneged90d: number;
    successfulAuctions: number;
  };
  events: Array<{
    id: string;
    type: ReputationEventType;
    title: string | null;
    occurredAt: Date;
  }>;
};

/**
 * Read the small, public trust surface used when a seller reviews a buyer.
 * Activity is capped per member so opening the modal never requires loading a full
 * account history into the page.
 */
export async function trustSnapshotsForMembers(
  tx: DbOrTx,
  userIds: readonly string[],
): Promise<Map<string, TrustSnapshot>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();

  const [profileRows, eventRows, auctionRows] = await Promise.all([
    tx
      .select({
        userId: profiles.userId,
        displayName: profiles.displayName,
        area: profiles.area,
        memberSince: profiles.memberSince,
        buyClaimsTotal: reputationCounters.buyClaimsTotal,
        buyCompleted: reputationCounters.buyCompleted,
        buyReneged90d: reputationCounters.buyReneged90d,
        buyPaidOnTime: reputationCounters.buyPaidOnTime,
        sellCompleted: reputationCounters.sellCompleted,
        sellReneged90d: reputationCounters.sellReneged90d,
      })
      .from(profiles)
      .leftJoin(reputationCounters, eq(reputationCounters.userId, profiles.userId))
      .where(inArray(profiles.userId, ids)),
    tx
      .select({
        id: reputationEvents.id,
        userId: reputationEvents.userId,
        type: reputationEvents.type,
        title: listings.title,
        occurredAt: reputationEvents.occurredAt,
      })
      .from(reputationEvents)
      .leftJoin(transactions, eq(transactions.id, reputationEvents.transactionId))
      .leftJoin(listings, eq(listings.id, transactions.listingId))
      .where(and(inArray(reputationEvents.userId, ids), inArray(reputationEvents.type, PUBLIC_REPUTATION_EVENT_TYPES)))
      .orderBy(desc(reputationEvents.occurredAt)),
    tx
      .select({ buyerId: transactions.buyerId, sellerId: transactions.sellerId })
      .from(transactions)
      .where(and(
        or(inArray(transactions.buyerId, ids), inArray(transactions.sellerId, ids)),
        eq(transactions.state, 'completed'),
        inArray(transactions.source, ['auction_win', 'auction_runner_up']),
      )),
  ]);

  const auctionCountByUser = new Map<string, number>();
  for (const row of auctionRows) {
    for (const id of [row.buyerId, row.sellerId]) {
      if (ids.includes(id)) auctionCountByUser.set(id, (auctionCountByUser.get(id) ?? 0) + 1);
    }
  }

  const eventsByUser = new Map<string, TrustSnapshot['events']>();
  for (const event of eventRows) {
    const events = eventsByUser.get(event.userId) ?? [];
    if (events.length < 8) events.push(event);
    eventsByUser.set(event.userId, events);
  }

  return new Map(
    profileRows.map((profile) => [
      profile.userId,
      {
        userId: profile.userId,
        displayName: profile.displayName,
        area: profile.area,
        memberSince: profile.memberSince,
        counters: {
          buyClaimsTotal: profile.buyClaimsTotal ?? 0,
          buyCompleted: profile.buyCompleted ?? 0,
          buyReneged90d: profile.buyReneged90d ?? 0,
          buyPaidOnTime: profile.buyPaidOnTime ?? 0,
          sellCompleted: profile.sellCompleted ?? 0,
          sellReneged90d: profile.sellReneged90d ?? 0,
          successfulAuctions: auctionCountByUser.get(profile.userId) ?? 0,
        },
        events: eventsByUser.get(profile.userId) ?? [],
      },
    ] as const),
  );
}
