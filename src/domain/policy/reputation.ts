/**
 * Objective facts vs subjective opinion.
 *
 * `reputation_events` is append-only and is the source of truth. Counters are a cache
 * rebuildable from the events at any time. Star ratings live entirely separately and
 * never feed the automatic restrictions — "did they pay" is a fact, "were they pleasant"
 * is an opinion, and only facts get to restrict someone's account.
 */

export const REPUTATION_EVENT_TYPES = [
  // completions
  'purchase_completed',
  'sale_completed',
  // buyer facts
  'buyer_paid_on_time',
  'buyer_paid_late',
  'buyer_reneged_nonpayment',
  'buyer_no_show',
  // seller facts
  'seller_delivered_on_time',
  'seller_reneged_no_dropoff',
  'seller_no_show',
  // custody facts
  'custody_overstay',
  // subjective, tracked separately and never used for restrictions
  'rating_received',
  // manual
  'admin_adjustment',
] as const;

export type ReputationEventType = (typeof REPUTATION_EVENT_TYPES)[number];

export const RESTRICTION_TYPES = [
  'prepay_required', // must pay before the seller commits anything
  'meetup_only', // cannot use the relay or delivery rails
  'claim_blocked',
  'bid_blocked',
  'listing_cap',
] as const;

export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export const RESTRICTION_SOURCES = ['automatic', 'admin'] as const;

export type RestrictionSource = (typeof RESTRICTION_SOURCES)[number];

/**
 * Automatic restriction thresholds.
 *
 * These are intentionally conservative — a false positive locks a real member out of
 * the community, which costs far more than a false negative. Tune with the group's
 * actual behaviour once there is data.
 */
export const THRESHOLDS = {
  buyer: {
    /** Reneges in the trailing 90 days that trigger "you must prepay". */
    prepayRequiredAt: 2,
    /** Reneges in the trailing 90 days that block claiming entirely. */
    claimBlockedAt: 4,
  },
  seller: {
    /** Failed drop-offs / no-shows in 90 days that force meetup-only. */
    meetupOnlyAt: 2,
    /** Failed drop-offs / no-shows in 90 days that block new listings. */
    listingCapAt: 4,
  },
  /** Below this many completed deals a member counts as "new" for seller policies. */
  newMemberCompletedDeals: 3,
  /** Rolling window all `_90d` counters use. */
  rollingWindowDays: 90,
} as const;

export interface BuyerCounters {
  buyRenegedIn90d: number;
  buyCompleted: number;
}

export interface SellerCounters {
  sellRenegedIn90d: number;
  sellNoShows: number;
  sellCompleted: number;
}

/** Which restrictions a buyer's objective record currently earns them. */
export function buyerRestrictions(c: BuyerCounters): RestrictionType[] {
  const out: RestrictionType[] = [];
  if (c.buyRenegedIn90d >= THRESHOLDS.buyer.claimBlockedAt) out.push('claim_blocked');
  else if (c.buyRenegedIn90d >= THRESHOLDS.buyer.prepayRequiredAt) out.push('prepay_required');
  return out;
}

/** Which restrictions a seller's objective record currently earns them. */
export function sellerRestrictions(c: SellerCounters): RestrictionType[] {
  const out: RestrictionType[] = [];
  const failures = c.sellRenegedIn90d + c.sellNoShows;
  if (failures >= THRESHOLDS.seller.listingCapAt) out.push('listing_cap');
  else if (failures >= THRESHOLDS.seller.meetupOnlyAt) out.push('meetup_only');
  return out;
}

export function isNewMember(completedDeals: number): boolean {
  return completedDeals < THRESHOLDS.newMemberCompletedDeals;
}

/**
 * The public, objective profile line. Deliberately shows the denominator — "3 of 3"
 * reads honestly for a newcomer in a way "100%" does not.
 */
export function objectiveSummary(c: {
  buyCompleted: number;
  buyClaimsTotal: number;
  buyPaidOnTime: number;
  sellCompleted: number;
}): string[] {
  const lines: string[] = [];
  lines.push(`${c.buyCompleted + c.sellCompleted} completed deals`);
  if (c.buyClaimsTotal > 0) {
    lines.push(`paid on time ${c.buyPaidOnTime} of ${c.buyClaimsTotal} times`);
  }
  return lines;
}
