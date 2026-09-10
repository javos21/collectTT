import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db, type DbOrTx } from '@/db/client';
import { marketplaceOptions, platformSettings } from '@/db/schema/settings';
import { listingDeliveryOptions } from '@/db/schema/listings';
import type { FulfillmentPath } from '@/domain/states/transaction';

export const FULL_SERVICE_DELIVERY_DAYS_KEY = 'full_service_delivery_days';
export const DEFAULT_FULL_SERVICE_DELIVERY_DAYS = 14;
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
