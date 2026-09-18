import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db, type DbOrTx } from '@/db/client';
import { marketplaceOptions, platformSettings } from '@/db/schema/settings';
import { listingDeliveryOptions } from '@/db/schema/listings';
import type { FulfillmentPath } from '@/domain/states/transaction';
import { assertLegacyFeatureAllowed, isV1Launch } from '@/lib/launch-scope';

export const FULL_SERVICE_DELIVERY_DAYS_KEY = 'full_service_delivery_days';
export const DEFAULT_FULL_SERVICE_DELIVERY_DAYS = 14;
export const LISTING_EXPIRY_DAYS_KEY = 'listing_expiry_days';
export const DEFAULT_LISTING_EXPIRY_DAYS = 30;
export const RESTRICTION_LOOKBACK_DAYS_KEY = 'restriction_lookback_days';
export const RESTRICTION_DURATION_HOURS_KEY = 'restriction_duration_hours';
export const BUYER_BID_BLOCKED_AT_KEY = 'buyer_bid_blocked_at';
export const BUYER_PREPAY_REQUIRED_AT_KEY = 'buyer_prepay_required_at';
export const BUYER_RESERVE_BLOCKED_AT_KEY = 'buyer_reserve_blocked_at';
export const SELLER_PUBLISH_BLOCKED_AT_KEY = 'seller_publish_blocked_at';

export const DEFAULT_RESTRICTION_LOOKBACK_DAYS = 90;
export const DEFAULT_RESTRICTION_DURATION_HOURS = 168;
export const DEFAULT_BUYER_BID_BLOCKED_AT = 2;
export const DEFAULT_BUYER_PREPAY_REQUIRED_AT = 2;
export const DEFAULT_BUYER_RESERVE_BLOCKED_AT = 4;
export const DEFAULT_SELLER_PUBLISH_BLOCKED_AT = 4;

export interface RestrictionPolicy {
  lookbackDays: number;
  durationHours: number;
  buyer: { prepayRequiredAt: number; bidBlockedAt: number; reserveBlockedAt: number };
  seller: { meetupOnlyAt: number; publishBlockedAt: number };
}
export type MarketplaceOptionKind = 'delivery' | 'payment';
export type MarketplaceOption = typeof marketplaceOptions.$inferSelect;

export async function getFullServiceDeliveryDays(): Promise<number> {
  const rows = await db
    .select({ days: platformSettings.integerValue })
    .from(platformSettings)
    .where(eq(platformSettings.key, FULL_SERVICE_DELIVERY_DAYS_KEY))
    .limit(1);
  return rows[0]?.days ?? DEFAULT_FULL_SERVICE_DELIVERY_DAYS;
}

export async function setFullServiceDeliveryDays(days: number, adminUserId: string): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ key: FULL_SERVICE_DELIVERY_DAYS_KEY, integerValue: days, updatedBy: adminUserId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { integerValue: days, updatedBy: adminUserId, updatedAt: new Date() },
    });
}

/** Platform-configured fixed-price lifetime. Product baseline is 30 days. */
export async function getListingExpiryDays(executor: DbOrTx = db): Promise<number> {
  const rows = await executor
    .select({ days: platformSettings.integerValue })
    .from(platformSettings)
    .where(eq(platformSettings.key, LISTING_EXPIRY_DAYS_KEY))
    .limit(1);
  const days = rows[0]?.days ?? DEFAULT_LISTING_EXPIRY_DAYS;
  return Math.max(1, Math.min(365, days));
}

async function getIntegerSetting(
  key: string,
  fallback: number,
  min: number,
  max: number,
  executor: DbOrTx = db,
): Promise<number> {
  const rows = await executor
    .select({ value: platformSettings.integerValue })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  const value = rows[0]?.value ?? fallback;
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/**
 * Progressive restriction controls. These are intentionally small integer settings
 * so support can tune policy without a code deploy; all callers still clamp values
 * to safe bounds and use conservative defaults when a row is absent.
 */
export async function getRestrictionPolicy(executor: DbOrTx = db): Promise<RestrictionPolicy> {
  const [lookbackDays, durationHours, prepayAt, bidAt, reserveAt, publishAt] = await Promise.all([
    getIntegerSetting(RESTRICTION_LOOKBACK_DAYS_KEY, DEFAULT_RESTRICTION_LOOKBACK_DAYS, 7, 365, executor),
    getIntegerSetting(RESTRICTION_DURATION_HOURS_KEY, DEFAULT_RESTRICTION_DURATION_HOURS, 24, 24 * 365, executor),
    getIntegerSetting(BUYER_PREPAY_REQUIRED_AT_KEY, DEFAULT_BUYER_PREPAY_REQUIRED_AT, 1, 20, executor),
    getIntegerSetting(BUYER_BID_BLOCKED_AT_KEY, DEFAULT_BUYER_BID_BLOCKED_AT, 1, 20, executor),
    getIntegerSetting(BUYER_RESERVE_BLOCKED_AT_KEY, DEFAULT_BUYER_RESERVE_BLOCKED_AT, 1, 50, executor),
    getIntegerSetting(SELLER_PUBLISH_BLOCKED_AT_KEY, DEFAULT_SELLER_PUBLISH_BLOCKED_AT, 1, 50, executor),
  ]);
  return {
    lookbackDays,
    durationHours,
    buyer: {
      prepayRequiredAt: prepayAt,
      bidBlockedAt: bidAt,
      reserveBlockedAt: Math.max(reserveAt, bidAt),
    },
    seller: {
      meetupOnlyAt: 2,
      publishBlockedAt: publishAt,
    },
  };
}

export async function setRestrictionPolicySetting(key: string, value: number, adminUserId: string, executor: DbOrTx = db): Promise<void> {
  const bounds: Record<string, [number, number]> = {
    [RESTRICTION_LOOKBACK_DAYS_KEY]: [7, 365],
    [RESTRICTION_DURATION_HOURS_KEY]: [24, 24 * 365],
    [BUYER_BID_BLOCKED_AT_KEY]: [1, 20],
    [BUYER_PREPAY_REQUIRED_AT_KEY]: [1, 20],
    [BUYER_RESERVE_BLOCKED_AT_KEY]: [1, 50],
    [SELLER_PUBLISH_BLOCKED_AT_KEY]: [1, 50],
  };
  const bound = bounds[key];
  if (bound === undefined || !Number.isInteger(value) || value < bound[0] || value > bound[1]) {
    throw new Error('Invalid restriction policy setting.');
  }
  await executor.insert(platformSettings).values({ key, integerValue: value, updatedBy: adminUserId }).onConflictDoUpdate({
    target: platformSettings.key,
    set: { integerValue: value, updatedBy: adminUserId, updatedAt: new Date() },
  });
}

export async function setListingExpiryDays(days: number, adminUserId: string): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Listing expiry must be between 1 and 365 days.');
  await db
    .insert(platformSettings)
    .values({ key: LISTING_EXPIRY_DAYS_KEY, integerValue: days, updatedBy: adminUserId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { integerValue: days, updatedBy: adminUserId, updatedAt: new Date() },
    });
}

/**
 * Read the options currently enabled by an administrator. Missing rows intentionally
 * default to enabled so existing deployments keep their current behaviour until an
 * admin saves the new controls.
 */
export async function listMarketplaceOptions(
  kind: MarketplaceOptionKind,
  opts: { activeOnly?: boolean } = {},
  executor: DbOrTx = db,
): Promise<MarketplaceOption[]> {
  const rows = await executor
    .select()
    .from(marketplaceOptions)
    .where(opts.activeOnly === true
      ? and(eq(marketplaceOptions.kind, kind), eq(marketplaceOptions.active, true))
      : eq(marketplaceOptions.kind, kind))
    .orderBy(asc(marketplaceOptions.sortOrder), asc(marketplaceOptions.label));

  return rows;
}

export async function getMarketplaceOptionsByIds(
  ids: readonly string[],
  executor: DbOrTx = db,
): Promise<MarketplaceOption[]> {
  if (ids.length === 0) return [];
  return executor.select().from(marketplaceOptions).where(inArray(marketplaceOptions.id, [...new Set(ids)]));
}

export async function getMarketplaceOptionsByKeys(
  kind: MarketplaceOptionKind,
  keys: readonly string[],
  executor: DbOrTx = db,
): Promise<MarketplaceOption[]> {
  if (keys.length === 0) return [];
  return executor
    .select()
    .from(marketplaceOptions)
    .where(and(eq(marketplaceOptions.kind, kind), inArray(marketplaceOptions.key, [...new Set(keys)])));
}

export async function getListingDeliveryOption(
  executor: DbOrTx,
  listingId: string,
  optionId: string,
): Promise<MarketplaceOption | null> {
  const rows = await executor
    .select({ option: marketplaceOptions })
    .from(listingDeliveryOptions)
    .innerJoin(marketplaceOptions, eq(marketplaceOptions.id, listingDeliveryOptions.optionId))
    .where(and(
      eq(listingDeliveryOptions.listingId, listingId),
      eq(listingDeliveryOptions.optionId, optionId),
      eq(marketplaceOptions.kind, 'delivery'),
    ))
    .limit(1);
  return rows[0]?.option ?? null;
}

export async function saveMarketplaceOption(
  input: {
    id?: string;
    kind: MarketplaceOptionKind;
    key: string;
    label: string;
    description?: string | null;
    requiresStore?: boolean;
    sortOrder: number;
  },
  adminUserId: string,
): Promise<MarketplaceOption> {
  if (isV1Launch() && input.kind === 'delivery' && input.requiresStore === true) {
    assertLegacyFeatureAllowed('store_custody');
  }
  if (isV1Launch() && input.kind === 'payment' && !['cash', 'bank_transfer'].includes(input.key)) {
    assertLegacyFeatureAllowed('seller_payment_window');
  }
  const requiresStore = input.kind === 'delivery' && input.requiresStore === true;
  const fulfillmentPath: FulfillmentPath | null = input.kind === 'delivery'
    ? requiresStore ? 'relay' : 'cash_meetup'
    : null;

  if (input.id !== undefined && input.id !== '') {
    const current = await db.select().from(marketplaceOptions).where(eq(marketplaceOptions.id, input.id)).limit(1);
    const option = current[0];
    if (option === undefined) throw new Error('Option not found.');
    if (option.kind !== input.kind) throw new Error('The option type cannot be changed.');
    if (option.kind === 'delivery' && option.requiresStore !== requiresStore) {
      const used = await db.execute(sql`
        select exists (
          select 1 from listing_delivery_options where option_id = ${option.id}
        ) as used
      `);
      const usage = used.rows[0] as { used?: boolean | string } | undefined;
      if (usage?.used === true || usage?.used === 't') {
        throw new Error('Whether a delivery option requires a store cannot change after it has been used on a listing.');
      }
    }
    const updated = await db
      .update(marketplaceOptions)
      .set({
        label: input.label,
        description: input.description ?? null,
        requiresStore,
        fulfillmentPath,
        sortOrder: input.sortOrder,
        active: true,
        updatedBy: adminUserId,
        updatedAt: new Date(),
      })
      .where(eq(marketplaceOptions.id, input.id))
      .returning();
    if (updated[0] === undefined) throw new Error('Option not found.');
    return updated[0];
  }

  const existing = await db
    .select({ id: marketplaceOptions.id })
    .from(marketplaceOptions)
    .where(and(eq(marketplaceOptions.kind, input.kind), eq(marketplaceOptions.key, input.key)))
    .limit(1);
  if (existing[0] !== undefined) {
    return saveMarketplaceOption({ ...input, id: existing[0].id }, adminUserId);
  }

  const inserted = await db
    .insert(marketplaceOptions)
    .values({
      kind: input.kind,
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      requiresStore,
      fulfillmentPath,
      sortOrder: input.sortOrder,
      active: true,
      updatedBy: adminUserId,
    })
    .onConflictDoUpdate({
      target: [marketplaceOptions.kind, marketplaceOptions.key],
      set: {
        label: input.label,
        description: input.description ?? null,
        requiresStore,
        fulfillmentPath,
        sortOrder: input.sortOrder,
        active: true,
        updatedBy: adminUserId,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (inserted[0] === undefined) throw new Error('Failed to save option.');
  return inserted[0];
}

export async function removeMarketplaceOption(id: string, adminUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(marketplaceOptions).where(eq(marketplaceOptions.id, id)).limit(1);
    const option = rows[0];
    if (option === undefined) throw new Error('Option not found.');
    if (isV1Launch() && option.kind === 'payment' && ['cash', 'bank_transfer'].includes(option.key)) {
      throw new Error('Cash and bank transfer are required payment options for v1.');
    }
    if (isV1Launch() && option.kind === 'delivery' && option.fulfillmentPath === 'cash_meetup') {
      throw new Error('Cash meetup is required as the v1 delivery option.');
    }
    const active = await tx
      .select({ id: marketplaceOptions.id })
      .from(marketplaceOptions)
      .where(and(eq(marketplaceOptions.kind, option.kind), eq(marketplaceOptions.active, true)));
    if (active.length <= 1 && option.active) {
      throw new Error(`Keep at least one ${option.kind} option available.`);
    }
    await tx
      .update(marketplaceOptions)
      .set({ active: false, updatedBy: adminUserId, updatedAt: new Date() })
      .where(eq(marketplaceOptions.id, id));
  });
}

export class UnavailableMarketplaceOptionError extends Error {
  constructor(kind: MarketplaceOptionKind) {
    super(`One or more selected ${kind} options are no longer available. Return to the form and choose again.`);
    this.name = 'UnavailableMarketplaceOptionError';
  }
}
