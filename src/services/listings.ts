/**
 * Listing service. All listing writes go through here.
 *
 * Category-specific fields are validated against the schema derived from the category
 * config, and the version that validated them is recorded on the row so a later config
 * bump never invalidates existing listings.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, type DbOrTx } from '../db/client';
import {
  listings,
  listingImages,
  listingAuditEvents,
  listingFulfillmentTerms,
  categories,
} from '../db/schema/listings';
import { listingRelayStores } from '../db/schema/custody';
import { images } from '../db/schema/images';
import { profiles, reputationCounters } from '../db/schema/profiles';
import { parseAttributes } from '../domain/categories/build-schema';
import { CATEGORY_LIST } from '../domain/categories/definitions';
import { FULFILLMENT_PATHS, type FulfillmentPath } from '../domain/states/transaction';
import { SIZE_CLASSES, type ListingStatus } from '../domain/states/listing';
import { assertListingTransition } from '../domain/states/listing';
import { WINDOWS } from '../domain/policy/windows';
import { enqueue } from '../jobs/enqueue';
import { getFullServiceDeliveryDays } from './platform-settings';

export const SETTLEMENT_METHODS = ['cash', 'bank_transfer', 'linx', 'other'] as const;

/** Everything except the category attributes, which are validated separately. */
export const listingInputSchema = z
  .object({
    category: z.string().min(1),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(4000).optional(),
    saleType: z.enum(['straight_sale', 'auction']),
    priceCents: z.number().int().positive().optional(),
    acceptsOffers: z.boolean().default(false),
    paymentWindowHours: z.number().int().min(48).max(168).default(72),
    startBidCents: z.number().int().positive().optional(),
    reserveCents: z.number().int().positive().optional(),
    buyoutCents: z.number().int().positive().optional(),
    durationHours: z.number().int().min(1).max(24 * 14).optional(),
    fulfillmentPaths: z.array(z.enum(FULFILLMENT_PATHS)).min(1),
    settlementMethods: z.array(z.enum(SETTLEMENT_METHODS)).min(1),
    sizeClass: z.enum(SIZE_CLASSES).default('small'),
    autoRelistOnRenege: z.boolean().default(true),
    imageIds: z.array(z.string().uuid()).max(8).default([]),
    /**
     * Candidate relay stores. The buyer picks one of these at claim time.
     * NOTE: "declaring relay requires at least one store" spans two tables and so
     * cannot be a database CHECK — this superRefine is the enforcement point. It is
     * deliberately NOT in the README's invariants table, which is for DB constraints.
     */
    relayStoreIds: z.array(z.string().uuid()).default([]),
    deliveryEstimates: z.record(z.string(), z.number().int().min(1).max(60)).default({}),
    attributes: z.record(z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillmentPaths.includes('relay') && value.relayStoreIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['relayStoreIds'],
        message: 'Nominate at least one relay store for drop-off',
      });
    }
    if (value.saleType === 'straight_sale' && value.priceCents === undefined) {
      ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'A price is required' });
    }
    if (value.saleType === 'auction') {
      if (value.startBidCents === undefined) {
        ctx.addIssue({ code: 'custom', path: ['startBidCents'], message: 'A starting bid is required' });
      }
      if (value.durationHours === undefined) {
        ctx.addIssue({ code: 'custom', path: ['durationHours'], message: 'A duration is required' });
      }
      if (
        value.buyoutCents !== undefined &&
        value.startBidCents !== undefined &&
        value.buyoutCents <= value.startBidCents
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['buyoutCents'],
          message: 'Buyout must be above the starting bid',
        });
      }
    }
  });

export type ListingInput = z.infer<typeof listingInputSchema>;

export async function createListing(
  sellerId: string,
  raw: unknown,
  opts: { publish?: boolean } = {},
): Promise<{ id: string }> {
  const input = listingInputSchema.parse(raw);
  const fullServiceDays = input.fulfillmentPaths.includes('full_service')
    ? await getFullServiceDeliveryDays()
    : null;
  // Throws UnknownCategoryError for an unseeded category, and ZodError with per-field
  // issues for bad attribute values.
  const { attributes, version } = parseAttributes(input.category, input.attributes);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(listings)
      .values({
        sellerId,
        category: input.category,
        attributes,
        attributesVersion: version,
        title: input.title,
        description: input.description ?? null,
        saleType: input.saleType,
        status: opts.publish === true ? 'active' : 'draft',
        priceCents: input.saleType === 'straight_sale' ? (input.priceCents ?? null) : null,
        acceptsOffers: input.saleType === 'straight_sale' ? input.acceptsOffers : false,
        paymentWindowHours: input.paymentWindowHours,
        startBidCents: input.saleType === 'auction' ? (input.startBidCents ?? null) : null,
        reserveCents: input.saleType === 'auction' ? (input.reserveCents ?? null) : null,
        buyoutCents: input.saleType === 'auction' ? (input.buyoutCents ?? null) : null,
        // ★ Server-authoritative: the close time is computed by the DATABASE clock,
        //   never by the browser and never by this process.
        endsAt:
          input.saleType === 'auction'
            ? sql`now() + (${input.durationHours ?? 24} || ' hours')::interval`
            : null,
        antisnipeWindowS: WINDOWS.antiSnipe.windowSeconds,
        antisnipeExtendS: WINDOWS.antiSnipe.extensionSeconds,
        maxExtensions: WINDOWS.antiSnipe.maxExtensions,
        fulfillmentPaths: input.fulfillmentPaths,
        settlementMethods: [...input.settlementMethods],
        sizeClass: input.sizeClass,
        autoRelistOnRenege: input.autoRelistOnRenege,
        publishedAt: opts.publish === true ? sql`now()` : null,
      })
      .returning({ id: listings.id, endsAt: listings.endsAt });

    const listing = inserted[0];
    if (listing === undefined) throw new Error('Failed to create listing');

    await attachImages(tx, listing.id, sellerId, input.imageIds);

    await tx.insert(listingFulfillmentTerms).values(
      input.fulfillmentPaths.map((path) => ({
        listingId: listing.id,
        fulfillmentPath: path,
        expectedDeliveryDays: input.deliveryEstimates[path] ?? fullServiceDays ?? 14,
      })),
    );

    await tx.insert(listingAuditEvents).values({
      listingId: listing.id,
      actorUserId: sellerId,
      eventType: 'created',
      metadata: { status: opts.publish === true ? 'active' : 'draft' },
    });

    if (input.relayStoreIds.length > 0) {
      await tx.insert(listingRelayStores).values(
        input.relayStoreIds.map((storeId) => ({ listingId: listing.id, storeId })),
      );
    }

    // ★ The close job is enqueued in the SAME transaction that created the auction, so
    //   an auction cannot exist without something scheduled to resolve it. The job
    //   re-reads ends_at when it fires, so anti-snipe extensions are handled there.
    if (input.saleType === 'auction' && opts.publish === true && listing.endsAt !== null) {
      await enqueue(
        tx,
        'auction:close',
        { listingId: listing.id },
        { jobKey: `auction_close:${listing.id}`, runAt: listing.endsAt },
      );
    }

    return { id: listing.id };
  });
}

async function attachImages(tx: DbOrTx, listingId: string, ownerUserId: string, imageIds: string[]): Promise<void> {
  if (imageIds.length === 0) return;

  const ownedImages = await tx
    .select({ id: images.id })
    .from(images)
    .where(and(inArray(images.id, imageIds), eq(images.ownerUserId, ownerUserId)));
  if (ownedImages.length !== imageIds.length) throw new Error('One or more images do not belong to you');

  await tx.insert(listingImages).values(
    imageIds.map((imageId, index) => ({ listingId, imageId, position: index })),
  );
}

export async function publishListing(sellerId: string, listingId: string): Promise<void> {
  const current = await db
    .select({ status: listings.status })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)))
    .limit(1);

  const row = current[0];
  if (row === undefined) throw new Error('Listing not found');
  // Compile-time-checked machine, asserted again at runtime for a DB-read value.
  assertListingTransition(row.status, 'active');

  await db
    .update(listings)
    .set({ status: 'active', publishedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId), eq(listings.status, 'draft')));
}

const listingEditSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional(),
  priceCents: z.number().int().positive().optional(),
  acceptsOffers: z.boolean().optional(),
  paymentWindowHours: z.number().int().min(48).max(168).optional(),
  deliveryEstimates: z.record(z.string(), z.number().int().min(1).max(60)).optional(),
  imageIds: z.array(z.string().uuid()).max(8).default([]),
});

export class ListingLockedError extends Error {
  constructor(message = 'This listing is locked because buyers have already interacted with it.') {
    super(message);
    this.name = 'ListingLockedError';
  }
}

export interface ListingActivity {
  hasBidActivity: boolean;
  hasLiveClaims: boolean;
  hasOpenTransaction: boolean;
  locked: boolean;
}

function activityFromRow(row: {
  has_bid_activity?: boolean | string;
  has_live_claims?: boolean | string;
  has_open_transaction?: boolean | string;
} | undefined): ListingActivity {
  const hasBidActivity = row?.has_bid_activity === true || row?.has_bid_activity === 't';
  const hasLiveClaims = row?.has_live_claims === true || row?.has_live_claims === 't';
  const hasOpenTransaction = row?.has_open_transaction === true || row?.has_open_transaction === 't';
  return { hasBidActivity, hasLiveClaims, hasOpenTransaction, locked: hasBidActivity || hasLiveClaims || hasOpenTransaction };
}

async function readListingActivity(executor: DbOrTx, listingId: string): Promise<ListingActivity> {
  const result = await executor.execute(sql`
    select
      exists (
        select 1 from bids
        where listing_id = ${listingId}
          and status not in ('retracted', 'void')
      ) as has_bid_activity,
      exists (
        select 1 from claims
        where listing_id = ${listingId}
          and status in ('active', 'queued', 'promoted')
      ) as has_live_claims,
      exists (
        select 1 from transactions
        where listing_id = ${listingId}
          and state = 'open'
      ) as has_open_transaction
  `);
  return activityFromRow(result.rows[0] as {
    has_bid_activity?: boolean | string;
    has_live_claims?: boolean | string;
    has_open_transaction?: boolean | string;
  } | undefined);
}

export async function getListingActivity(listingId: string): Promise<ListingActivity> {
  return readListingActivity(db, listingId);
}

async function assertListingUnlocked(tx: DbOrTx, listingId: string): Promise<void> {
  const activity = await readListingActivity(tx, listingId);
  if (activity.locked) throw new ListingLockedError();
}

/**
 * Update seller-editable listing details without changing the sale type, delivery
 * terms, payment terms, or auction clock. Those terms can affect existing buyers
 * and transactions, so they remain immutable after publication.
 */
export async function updateListingBasics(
  sellerId: string,
  listingId: string,
  raw: unknown,
): Promise<void> {
  const input = listingEditSchema.parse(raw);

  await db.transaction(async (tx) => {
    const currentRows = await tx.execute(sql`
      select title, description, sale_type, status, price_cents, accepts_offers, payment_window_hours, fulfillment_paths
      from listings
      where id = ${listingId} and seller_id = ${sellerId}
      for update
    `);
    const current = currentRows.rows[0] as {
      title: string;
      description: string | null;
      sale_type: 'straight_sale' | 'auction';
      status: 'draft' | 'active' | 'claimed' | 'ended_won' | 'ended_no_sale' | 'cancelled' | 'expired';
      price_cents: string | number | null;
      accepts_offers: boolean;
      payment_window_hours: number;
      fulfillment_paths: FulfillmentPath[];
    } | undefined;
    if (current === undefined) throw new Error('Listing not found');
    if (current.status !== 'active' && current.status !== 'draft') {
      throw new Error('Only active or draft listings can be edited.');
    }
    await assertListingUnlocked(tx, listingId);
    if (current.sale_type === 'straight_sale' && input.priceCents === undefined) {
      throw new Error('A price is required for a fixed-price listing.');
    }
    if (input.deliveryEstimates !== undefined) {
      for (const path of current.fulfillment_paths) {
        if (input.deliveryEstimates[path] === undefined) {
          throw new Error('Add an expected delivery time for each selected option.');
        }
      }
    }

    const changes: Record<string, unknown> = {};
    if (current.title !== input.title) changes.title = { from: current.title, to: input.title };
    if ((current.description ?? '') !== (input.description ?? '')) {
      changes.description = { from: current.description, to: input.description ?? null };
    }
    if (current.sale_type === 'straight_sale' && input.priceCents !== undefined) {
      const previousPrice = current.price_cents === null ? null : Number(current.price_cents);
      if (previousPrice !== input.priceCents) changes.priceCents = { from: previousPrice, to: input.priceCents };
    }
    if (current.sale_type === 'straight_sale' && input.acceptsOffers !== undefined && input.acceptsOffers !== current.accepts_offers) {
      changes.acceptsOffers = { from: current.accepts_offers, to: input.acceptsOffers };
    }
    if (input.paymentWindowHours !== undefined && input.paymentWindowHours !== current.payment_window_hours) {
      changes.paymentWindowHours = { from: current.payment_window_hours, to: input.paymentWindowHours };
    }
    if (input.deliveryEstimates !== undefined) {
      const previousTerms = await tx
        .select({ fulfillmentPath: listingFulfillmentTerms.fulfillmentPath, expectedDeliveryDays: listingFulfillmentTerms.expectedDeliveryDays })
        .from(listingFulfillmentTerms)
        .where(eq(listingFulfillmentTerms.listingId, listingId));
      const previous = Object.fromEntries(previousTerms.map((term) => [term.fulfillmentPath, term.expectedDeliveryDays]));
      const termChanges = Object.fromEntries(current.fulfillment_paths.map((path) => [path, { from: previous[path], to: input.deliveryEstimates?.[path] }]));
      if (JSON.stringify(previous) !== JSON.stringify(input.deliveryEstimates)) changes.deliveryEstimates = termChanges;
    }

    await tx
      .update(listings)
      .set({
        title: input.title,
        description: input.description ?? null,
        ...(current.sale_type === 'straight_sale' ? { priceCents: input.priceCents ?? Number(current.price_cents) } : {}),
        ...(current.sale_type === 'straight_sale' && input.acceptsOffers !== undefined ? { acceptsOffers: input.acceptsOffers } : {}),
        ...(input.paymentWindowHours !== undefined ? { paymentWindowHours: input.paymentWindowHours } : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)));

    if (input.imageIds.length > 0) {
      const existingRows = await tx
        .select({ imageId: listingImages.imageId })
        .from(listingImages)
        .where(eq(listingImages.listingId, listingId));
      const existingIds = new Set(existingRows.map((row) => row.imageId));
      const newImageIds = [...new Set(input.imageIds)].filter((imageId) => !existingIds.has(imageId));
      if (existingRows.length + newImageIds.length > 8) throw new Error('A listing can have at most 8 photos.');

      if (newImageIds.length > 0) {
        const ownedImages = await tx
          .select({ id: images.id })
          .from(images)
          .where(and(inArray(images.id, newImageIds), eq(images.ownerUserId, sellerId)));
        if (ownedImages.length !== newImageIds.length) throw new Error('One or more images do not belong to you');

        await tx.insert(listingImages).values(
          newImageIds.map((imageId, index) => ({
            listingId,
            imageId,
            position: existingRows.length + index,
          })),
        );
        changes.photosAdded = newImageIds.length;
      }
    }

    if (input.deliveryEstimates !== undefined) {
      await tx
        .insert(listingFulfillmentTerms)
        .values(current.fulfillment_paths.map((path) => ({
          listingId,
          fulfillmentPath: path,
          expectedDeliveryDays: input.deliveryEstimates?.[path] ?? 5,
        })))
        .onConflictDoUpdate({
          target: [listingFulfillmentTerms.listingId, listingFulfillmentTerms.fulfillmentPath],
          set: { expectedDeliveryDays: sql`excluded.expected_delivery_days` },
        });
    }

    if (Object.keys(changes).length > 0) {
      await tx.insert(listingAuditEvents).values({
        listingId,
        actorUserId: sellerId,
        eventType: 'edited',
        metadata: changes,
      });
    }
  });
}

export async function cancelListing(sellerId: string, listingId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      select status
      from listings
      where id = ${listingId} and seller_id = ${sellerId}
      for update
    `);
    const current = rows.rows[0] as { status: ListingStatus } | undefined;
    if (current === undefined) throw new Error('Listing not found');
    if (current.status !== 'draft' && current.status !== 'active') {
      throw new Error('This listing is no longer available to cancel.');
    }
    await assertListingUnlocked(tx, listingId);
    assertListingTransition(current.status, 'cancelled');

    await tx
      .update(listings)
      .set({ status: 'cancelled', resolvedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)));
    await tx.insert(listingAuditEvents).values({
      listingId,
      actorUserId: sellerId,
      eventType: 'cancelled',
      metadata: { fromStatus: current.status, toStatus: 'cancelled' },
    });

  });
}

export async function listingAuditForSeller(listingId: string, sellerId: string) {
  return db
    .select({
      eventType: listingAuditEvents.eventType,
      metadata: listingAuditEvents.metadata,
      occurredAt: listingAuditEvents.occurredAt,
    })
    .from(listingAuditEvents)
    .innerJoin(listings, eq(listings.id, listingAuditEvents.listingId))
    .where(and(eq(listingAuditEvents.listingId, listingId), eq(listings.sellerId, sellerId)))
    .orderBy(desc(listingAuditEvents.occurredAt))
    .limit(30);
}

export const BROWSE_PAGE_SIZE = 24;

export const BROWSE_SORTS = ['newest', 'price_low', 'price_high', 'ending_soon'] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];

export interface BrowseFilters {
  /** Optional text search across listing titles and descriptions. */
  query?: string;
  category?: string;
  /** Match any selected category from a checklist facet. */
  categories?: readonly string[];
  /**
   * Category-specific attribute filters, already coerced to their stored JSON types by
   * `coerceFilters` — JSONB containment is type-strict, so raw query strings will not do.
   */
  attributes?: Record<string, string | number | boolean>;
  /** Narrow to one sale type; omitted means both. */
  saleType?: 'straight_sale' | 'auction';
  /** Match listings that offer this delivery/fulfillment path. */
  fulfillmentPath?: FulfillmentPath;
  /** Match listings that offer any selected delivery/fulfillment path. */
  fulfillmentPaths?: readonly FulfillmentPath[];
  /** Match listings that accept this payment method. */
  settlementMethod?: string;
  /** Match listings that accept any selected payment method. */
  settlementMethods?: readonly string[];
  /** Price filters apply to fixed prices and the current/start bid for auctions. */
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: BrowseSort;
  /** Discovery surface: recent means no claims; last chance means one or two live claims. */
  surface?: 'catalog' | 'recent' | 'last_chance';
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
}

export interface BrowsePage {
  rows: Awaited<ReturnType<typeof selectBrowseRows>>;
  /** Total matching the filters, independent of the returned page slice. */
  total: number;
  page: number;
  pageSize: number;
}

function browseConditions(filters: BrowseFilters) {
  const liveClaims = sql`(
    select count(*)::int
      from claims c
     where c.listing_id = ${listings.id}
       and c.status in ('active', 'queued', 'promoted')
  )`;
  const confirmedPayment = sql`exists (
    select 1
      from transactions t
     where t.listing_id = ${listings.id}
       and t.state = 'open'
       and t.payment_state = 'confirmed'
  )`;
  const surface = filters.surface ?? 'catalog';
  const conditions = [
    surface === 'recent'
      ? sql`${listings.status} = 'active' and ${listings.saleType} = 'straight_sale' and ${liveClaims} = 0 and not ${confirmedPayment}`
      : surface === 'last_chance'
        ? sql`${listings.status} = 'claimed' and ${listings.saleType} = 'straight_sale' and ${liveClaims} between 1 and 2 and not ${confirmedPayment}`
        : sql`(
            (${listings.status} = 'active' and ${listings.saleType} = 'auction')
            or (
              ${listings.saleType} = 'straight_sale'
              and ${liveClaims} between 0 and 2
              and ${listings.status} in ('active', 'claimed')
              and not ${confirmedPayment}
            )
          )`,
  ];
  const query = filters.query?.trim();
  if (query !== undefined && query !== '') {
    const pattern = `%${query}%`;
    conditions.push(
      sql`(${listings.title} ilike ${pattern} or coalesce(${listings.description}, '') ilike ${pattern})`,
    );
  }
  if (filters.category !== undefined) {
    conditions.push(eq(listings.category, filters.category));
  }
  if (filters.categories !== undefined && filters.categories.length > 0) {
    conditions.push(inArray(listings.category, [...filters.categories]));
  }
  if (filters.attributes !== undefined && Object.keys(filters.attributes).length > 0) {
    // JSONB containment — served by listings_attrs (GIN).
    conditions.push(sql`${listings.attributes} @> ${JSON.stringify(filters.attributes)}::jsonb`);
  }
  if (filters.saleType !== undefined) {
    conditions.push(eq(listings.saleType, filters.saleType));
  }
  if (filters.fulfillmentPath !== undefined) {
    conditions.push(
      sql`${listings.fulfillmentPaths} @> ARRAY[${filters.fulfillmentPath}]::fulfillment_path[]`,
    );
  }
  if (filters.fulfillmentPaths !== undefined && filters.fulfillmentPaths.length > 0) {
    conditions.push(
      sql`${listings.fulfillmentPaths} && ARRAY[${sql.join(
        filters.fulfillmentPaths.map((path) => sql`${path}`),
        sql`, `,
      )}]::fulfillment_path[]`,
    );
  }
  if (filters.settlementMethod !== undefined) {
    conditions.push(
      sql`${listings.settlementMethods} @> ARRAY[${filters.settlementMethod}]::text[]`,
    );
  }
  if (filters.settlementMethods !== undefined && filters.settlementMethods.length > 0) {
    conditions.push(
      sql`${listings.settlementMethods} && ARRAY[${sql.join(
        filters.settlementMethods.map((method) => sql`${method}`),
        sql`, `,
      )}]::text[]`,
    );
  }
  const browsePrice = sql`coalesce(${listings.priceCents}, ${listings.currentBidCents}, ${listings.startBidCents})`;
  if (filters.minPriceCents !== undefined) {
    conditions.push(sql`${browsePrice} >= ${filters.minPriceCents}`);
  }
  if (filters.maxPriceCents !== undefined) {
    conditions.push(sql`${browsePrice} <= ${filters.maxPriceCents}`);
  }
  return conditions;
}

function browseOrder(sort: BrowseSort = 'newest') {
  const browsePrice = sql`coalesce(${listings.priceCents}, ${listings.currentBidCents}, ${listings.startBidCents})`;
  switch (sort) {
    case 'price_low':
      return [asc(browsePrice), desc(listings.publishedAt), desc(listings.id)] as const;
    case 'price_high':
      return [desc(browsePrice), desc(listings.publishedAt), desc(listings.id)] as const;
    case 'ending_soon':
      return [sql`${listings.endsAt} asc nulls last`, desc(listings.publishedAt), desc(listings.id)] as const;
    case 'newest':
    default:
      return [desc(listings.createdAt), desc(listings.id)] as const;
  }
}

function selectBrowseRows(
  where: ReturnType<typeof and>,
  limit: number,
  offset: number,
  sort: BrowseSort,
) {
  return db
    .select({
      id: listings.id,
      title: listings.title,
      description: listings.description,
      category: listings.category,
      attributes: listings.attributes,
      saleType: listings.saleType,
      priceCents: listings.priceCents,
      acceptsOffers: listings.acceptsOffers,
      paymentWindowHours: listings.paymentWindowHours,
      startBidCents: listings.startBidCents,
      currentBidCents: listings.currentBidCents,
      bidCount: listings.bidCount,
      endsAt: listings.endsAt,
      publishedAt: listings.publishedAt,
      sellerName: profiles.displayName,
      sellerId: profiles.userId,
      sellerRatingAvg: reputationCounters.ratingAvg,
      sellerRatingCount: reputationCounters.ratingCount,
      sellerCompletedSales: reputationCounters.sellCompleted,
      fulfillmentPaths: listings.fulfillmentPaths,
      settlementMethods: listings.settlementMethods,
      liveClaimCount: sql<number>`(
        select count(*)::int
          from claims c
         where c.listing_id = ${listings.id}
           and c.status in ('active', 'queued', 'promoted')
      )`,
      primaryImageId: sql<string | null>`(
        select i.id
        from listing_images li
        inner join images i on i.id = li.image_id
        where li.listing_id = ${listings.id}
        order by li.position asc
        limit 1
      )`,
      primaryImageKey: sql<string | null>`(
        select coalesce(
          i.variants -> 'card' ->> 'key',
          i.variants -> 'thumb' ->> 'key',
          i.r2_key_original
        )
        from listing_images li
        inner join images i on i.id = li.image_id
        where li.listing_id = ${listings.id}
        order by li.position asc
        limit 1
      )`,
    })
    .from(listings)
    .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
    .leftJoin(reputationCounters, eq(reputationCounters.userId, profiles.userId))
    .where(where)
    .orderBy(...browseOrder(sort))
    .limit(limit)
    .offset(offset);
}

/**
 * Browse. All facets resolve in one WHERE, so the count and the page slice always agree.
 * Attribute filtering is served by the GIN index; delivery/payment facets use the
 * listing's declared arrays.
 */
export async function browseListings(filters: BrowseFilters = {}): Promise<BrowsePage> {
  const where = and(...browseConditions(filters));

  const pageSize = filters.pageSize ?? BROWSE_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * pageSize;

  const [rows, totalRows] = await Promise.all([
    selectBrowseRows(where, pageSize, offset, filters.sort ?? 'newest'),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(listings)
      .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
      .where(where),
  ]);

  return { rows, total: totalRows[0]?.n ?? 0, page, pageSize };
}

export async function getListing(id: string) {
  const rows = await db
    .select({
      listing: listings,
      sellerName: profiles.displayName,
      sellerHandle: profiles.handle,
      sellerSince: profiles.memberSince,
    })
    .from(listings)
    .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
    .where(eq(listings.id, id))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const imageRows = await db
    .select({
      id: images.id,
      variants: images.variants,
      r2KeyOriginal: images.r2KeyOriginal,
      status: images.status,
    })
    .from(listingImages)
    .innerJoin(images, eq(images.id, listingImages.imageId))
    .where(eq(listingImages.listingId, id))
    .orderBy(listingImages.position);

  const fulfillmentTerms = await db
    .select({
      fulfillmentPath: listingFulfillmentTerms.fulfillmentPath,
      expectedDeliveryDays: listingFulfillmentTerms.expectedDeliveryDays,
    })
    .from(listingFulfillmentTerms)
    .where(eq(listingFulfillmentTerms.listingId, id));

  return { ...row, images: imageRows, fulfillmentTerms };
}

export async function listingsBySeller(sellerId: string) {
  return db
    .select()
    .from(listings)
    .where(eq(listings.sellerId, sellerId))
    .orderBy(desc(listings.createdAt));
}

export async function activeCategories() {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(categories.sortOrder);
  // Fall back to the config if the seed has not been run yet, so a fresh clone still
  // renders a usable form instead of an empty select.
  return rows.length > 0
    ? rows
    : CATEGORY_LIST.map((c) => ({
        key: c.key,
        label: c.label,
        schemaVersion: c.version,
        sortOrder: c.sortOrder,
        active: true,
        updatedAt: new Date(),
      }));
}
