/**
 * Listing service. All listing writes go through here.
 *
 * Category-specific fields are validated against the schema derived from the category
 * config, and the version that validated them is recorded on the row so a later config
 * bump never invalidates existing listings.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, type DbOrTx } from '../db/client';
import { listings, listingImages, categories } from '../db/schema/listings';
import { listingRelayStores } from '../db/schema/custody';
import { images } from '../db/schema/images';
import { profiles } from '../db/schema/profiles';
import { parseAttributes } from '../domain/categories/build-schema';
import { CATEGORY_LIST } from '../domain/categories/definitions';
import { FULFILLMENT_PATHS } from '../domain/states/transaction';
import { SIZE_CLASSES } from '../domain/states/listing';
import { assertListingTransition } from '../domain/states/listing';
import { WINDOWS } from '../domain/policy/windows';
import { enqueue } from '../jobs/enqueue';

export const SETTLEMENT_METHODS = ['cash', 'bank_transfer', 'linx', 'other'] as const;

/** Everything except the category attributes, which are validated separately. */
export const listingInputSchema = z
  .object({
    category: z.string().min(1),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(4000).optional(),
    saleType: z.enum(['straight_sale', 'auction']),
    priceCents: z.number().int().positive().optional(),
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

    await attachImages(tx, listing.id, input.imageIds);

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

async function attachImages(tx: DbOrTx, listingId: string, imageIds: string[]): Promise<void> {
  if (imageIds.length === 0) return;
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

export const BROWSE_PAGE_SIZE = 24;

export interface BrowseFilters {
  category?: string;
  /**
   * Category-specific attribute filters, already coerced to their stored JSON types by
   * `coerceFilters` — JSONB containment is type-strict, so raw query strings will not do.
   */
  attributes?: Record<string, string | number | boolean>;
  /** Narrow to one sale type; omitted means both. */
  saleType?: 'straight_sale' | 'auction';
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
  const conditions = [eq(listings.status, 'active')];
  if (filters.category !== undefined) {
    conditions.push(eq(listings.category, filters.category));
  }
  if (filters.attributes !== undefined && Object.keys(filters.attributes).length > 0) {
    // JSONB containment — served by listings_attrs (GIN).
    conditions.push(sql`${listings.attributes} @> ${JSON.stringify(filters.attributes)}::jsonb`);
  }
  if (filters.saleType !== undefined) {
    conditions.push(eq(listings.saleType, filters.saleType));
  }
  return conditions;
}

function selectBrowseRows(where: ReturnType<typeof and>, limit: number, offset: number) {
  return db
    .select({
      id: listings.id,
      title: listings.title,
      category: listings.category,
      attributes: listings.attributes,
      saleType: listings.saleType,
      priceCents: listings.priceCents,
      startBidCents: listings.startBidCents,
      currentBidCents: listings.currentBidCents,
      bidCount: listings.bidCount,
      endsAt: listings.endsAt,
      publishedAt: listings.publishedAt,
      sellerName: profiles.displayName,
      sellerId: profiles.userId,
    })
    .from(listings)
    .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
    .where(where)
    .orderBy(desc(listings.publishedAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Browse. Category, attribute and sale-type filtering all resolve in one WHERE, so the
 * count and the page slice always agree. Attribute filtering is served by the GIN index.
 */
export async function browseListings(filters: BrowseFilters = {}): Promise<BrowsePage> {
  const where = and(...browseConditions(filters));

  const pageSize = filters.pageSize ?? BROWSE_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * pageSize;

  const [rows, totalRows] = await Promise.all([
    selectBrowseRows(where, pageSize, offset),
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
    .select({ id: images.id, variants: images.variants, status: images.status })
    .from(listingImages)
    .innerJoin(images, eq(images.id, listingImages.imageId))
    .where(eq(listingImages.listingId, id))
    .orderBy(listingImages.position);

  return { ...row, images: imageRows };
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
