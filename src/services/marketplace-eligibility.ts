/**
 * The single marketplace-action gate. Callers provide a member and intent; this module
 * owns account, contact, scoped-restriction, and new-buyer commitment rules.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { DbOrTx, Tx } from '@/db/client';
import { profiles, reputationCounters, restrictions } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { THRESHOLDS, type RestrictionType } from '@/domain/policy/reputation';

export type MarketplaceAction =
  | 'persist_listing'
  | 'publish_listing'
  | 'reserve'
  | 'bid'
  | 'create_commitment';

export type EligibilityCode =
  | 'account_unavailable'
  | 'phone_required'
  | 'action_restricted'
  | 'active_commitment_limit';

export interface MarketplaceEligibilityResult {
  eligible: boolean;
  code?: EligibilityCode;
  message?: string;
}

export class MarketplaceEligibilityError extends Error {
  readonly code: EligibilityCode;

  constructor(code: EligibilityCode, message: string) {
    super(message);
    this.name = 'MarketplaceEligibilityError';
    this.code = code;
  }
}

export async function evaluateMarketplaceAction(
  executor: DbOrTx,
  userId: string,
  action: MarketplaceAction,
  options: { lockMember?: boolean } = {},
): Promise<MarketplaceEligibilityResult> {
  if (options.lockMember === true) {
    // Every commitment for one buyer serializes on the same durable row. The open
    // transaction check below therefore cannot be passed concurrently twice.
    await executor.execute(sql`select user_id from profiles where user_id = ${userId} for update`);
  }

  const memberRows = await executor
    .select({
      status: profiles.status,
      phoneE164: profiles.phoneE164,
      buyCompleted: reputationCounters.buyCompleted,
      sellCompleted: reputationCounters.sellCompleted,
    })
    .from(profiles)
    .leftJoin(reputationCounters, eq(reputationCounters.userId, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  const member = memberRows[0];

  if (member === undefined || member.status === 'suspended' || member.status === 'banned') {
    return denied('account_unavailable', 'Marketplace actions are unavailable on this account.');
  }
  if (member.phoneE164 === null) {
    return denied('phone_required', 'Add your mobile number before using marketplace actions.');
  }

  const activeRestrictionRows = await executor
    .select({ type: restrictions.type })
    .from(restrictions)
    .where(and(
      eq(restrictions.userId, userId),
      isNull(restrictions.liftedAt),
      or(isNull(restrictions.expiresAt), sql`${restrictions.expiresAt} > now()`),
    ));
  const active = new Set<RestrictionType>(activeRestrictionRows.map((row) => row.type));
  const restrictionMessage = actionRestriction(active, action);
  if (restrictionMessage !== null) return denied('action_restricted', restrictionMessage);

  if (action === 'bid' || action === 'create_commitment') {
    const completedPurchases = member.buyCompleted ?? 0;
    if (completedPurchases < THRESHOLDS.newMemberCompletedDeals) {
      const openRows = await executor
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.buyerId, userId), eq(transactions.state, 'open')))
        .limit(1);
      if (openRows[0] !== undefined) {
        return denied(
          'active_commitment_limit',
          'New buyers may have one active reservation at a time. Complete or close your current deal first.',
        );
      }
    }
  }

  return { eligible: true };
}

export async function assertMarketplaceEligible(
  executor: DbOrTx,
  userId: string,
  action: MarketplaceAction,
  options?: { lockMember?: boolean },
): Promise<void> {
  const result = await evaluateMarketplaceAction(executor, userId, action, options);
  if (!result.eligible) {
    throw new MarketplaceEligibilityError(
      result.code ?? 'account_unavailable',
      result.message ?? 'This marketplace action is unavailable.',
    );
  }
}

/** The concurrency-safe gate used immediately before inserting an open transaction. */
export async function acquireCommitmentEligibility(tx: Tx, buyerId: string): Promise<void> {
  await assertMarketplaceEligible(tx, buyerId, 'create_commitment', { lockMember: true });
}

function actionRestriction(active: ReadonlySet<RestrictionType>, action: MarketplaceAction): string | null {
  if ((action === 'persist_listing' || action === 'publish_listing') && (active.has('publish_blocked') || active.has('listing_cap'))) {
    return 'Creating listings is paused on this account.';
  }
  if ((action === 'reserve' || action === 'create_commitment') && (active.has('reserve_blocked') || active.has('claim_blocked'))) {
    return 'Buying is paused on this account because of recent incomplete deals.';
  }
  if ((action === 'bid' || action === 'create_commitment') && active.has('bid_blocked')) {
    return 'Bidding is paused on this account because of recent incomplete deals.';
  }
  return null;
}

function denied(code: EligibilityCode, message: string): MarketplaceEligibilityResult {
  return { eligible: false, code, message };
}
