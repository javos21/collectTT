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
  listingDeliveryOptions,
  listingFulfillmentTerms,
  categories,
} from '../db/schema/listings';
import { sellerMeetupLocations, sellerMarketplacePreferences } from '../db/schema/seller-settings';
import { listingRelayStores, relayStores } from '../db/schema/custody';
import { images } from '../db/schema/images';
import { profiles, reputationCounters } from '../db/schema/profiles';
import { transactions } from '../db/schema/transactions';
import { marketplaceOptions } from '../db/schema/settings';
import { parseAttributesWithCatalogValues } from './catalog';
import { CATEGORY_LIST } from '../domain/categories/definitions';
import { FULFILLMENT_PATHS, type FulfillmentPath } from '../domain/states/transaction';
import { type ListingStatus } from '../domain/states/listing';
import { assertListingTransition } from '../domain/states/listing';
import { AUCTION_DURATION_HOURS, WINDOWS } from '../domain/policy/windows';
import { enqueue } from '../jobs/enqueue';
import { getFullServiceDeliveryDays, getListingExpiryDays, UnavailableMarketplaceOptionError } from './platform-settings';
import { assertMarketplaceEligible } from './marketplace-eligibility';
import { assertV1ListingTerms, V1_PAYMENT_WINDOW_HOURS, isV1Launch } from '@/lib/launch-scope';

import { SETTLEMENT_METHODS } from '../domain/policy/settlement';
import { recordAnalyticsEvent } from './analytics';

export { SETTLEMENT_METHODS };

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
    /** Admin-managed option ids used by the listing form. */
    deliveryOptionIds: z.array(z.string().uuid()).default([]),
    /** Stable admin-managed payment keys used by the listing form. */
    paymentOptionKeys: z.array(z.string().trim().min(1)).default([]),
    /** Legacy service inputs retained for existing scripts and historical tests. */
    fulfillmentPaths: z.array(z.enum(FULFILLMENT_PATHS)).default([]),
    settlementMethods: z.array(z.string().trim().min(1)).default([]),
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
    meetupLocationId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.deliveryOptionIds.length === 0 && value.fulfillmentPaths.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['deliveryOptionIds'], message: 'Choose at least one delivery option' });
    }
    if (value.paymentOptionKeys.length === 0 && value.settlementMethods.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['paymentOptionKeys'], message: 'Choose at least one payment option' });
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
      } else if (!(AUCTION_DURATION_HOURS as readonly number[]).includes(value.durationHours)) {
        ctx.addIssue({ code: 'custom', path: ['durationHours'], message: 'Choose one of the available auction lengths' });
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
  const rawRecord = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const [sellerDefaults, meetupLocations] = await Promise.all([
    sellerMarketplacePreferencesFor(sellerId),
    sellerMeetupLocationsFor(sellerId),
  ]);
  const rawDelivery = Array.isArray(rawRecord.deliveryOptionIds) ? rawRecord.deliveryOptionIds : [];
  const rawPayments = Array.isArray(rawRecord.paymentOptionKeys) ? rawRecord.paymentOptionKeys : [];
  const rawMeetup = typeof rawRecord.meetupLocationId === 'string' && rawRecord.meetupLocationId !== '' ? rawRecord.meetupLocationId : undefined;
  const parsedInput = listingInputSchema.parse({
    ...rawRecord,
    ...(rawDelivery.length === 0 && (!Array.isArray(rawRecord.fulfillmentPaths) || rawRecord.fulfillmentPaths.length === 0)
      ? { deliveryOptionIds: sellerDefaults.defaultDeliveryOptionIds }
      : {}),
    ...(rawPayments.length === 0 && (!Array.isArray(rawRecord.settlementMethods) || rawRecord.settlementMethods.length === 0)
      ? { paymentOptionKeys: sellerDefaults.defaultPaymentMethods }
      : {}),
    ...(rawMeetup !== undefined ? { meetupLocationId: rawMeetup } : {}),
  });
  const requestedDeliveryIds = [...new Set(parsedInput.deliveryOptionIds)];
  const requestedPaymentKeys = [...new Set(parsedInput.paymentOptionKeys)];
  const [selectedDeliveryOptions, selectedPaymentOptions] = await Promise.all([
    requestedDeliveryIds.length === 0
      ? Promise.resolve([])
      : db.select().from(marketplaceOptions).where(and(
          eq(marketplaceOptions.kind, 'delivery'),
          eq(marketplaceOptions.active, true),
          inArray(marketplaceOptions.id, requestedDeliveryIds),
        )),
    requestedPaymentKeys.length === 0
      ? Promise.resolve([])
      : db.select().from(marketplaceOptions).where(and(
          eq(marketplaceOptions.kind, 'payment'),
          eq(marketplaceOptions.active, true),
          inArray(marketplaceOptions.key, requestedPaymentKeys),
        )),
  ]);
  if (requestedDeliveryIds.length > 0 && selectedDeliveryOptions.length !== requestedDeliveryIds.length) {
    throw new UnavailableMarketplaceOptionError('delivery');
  }
  if (requestedPaymentKeys.length > 0 && selectedPaymentOptions.length !== requestedPaymentKeys.length) {
    throw new UnavailableMarketplaceOptionError('payment');
  }

  const fulfillmentPaths = requestedDeliveryIds.length > 0
    ? [...new Set(selectedDeliveryOptions.map((option) => option.fulfillmentPath).filter((path): path is FulfillmentPath => path !== null))]
    : parsedInput.fulfillmentPaths;
  const input = {
    ...parsedInput,
    meetupLocationId: fulfillmentPaths.includes('cash_meetup')
      ? parsedInput.meetupLocationId ?? (meetupLocations.filter((location) => location.active).length === 1
        ? meetupLocations.find((location) => location.active)?.id
        : undefined)
      : undefined,
  };
  const settlementMethods = requestedPaymentKeys.length > 0 ? requestedPaymentKeys : input.settlementMethods;
  const relayStoreIds = input.relayStoreIds.length > 0 ? input.relayStoreIds : sellerDefaults.defaultRelayStoreIds;
  if (fulfillmentPaths.length === 0) throw new UnavailableMarketplaceOptionError('delivery');
  if (settlementMethods.length === 0) throw new UnavailableMarketplaceOptionError('payment');
  assertV1ListingTerms({
    fulfillmentPaths,
    settlementMethods,
    acceptsOffers: input.acceptsOffers,
    reserveCents: input.reserveCents,
    buyoutCents: input.buyoutCents,
    paymentWindowHours: input.paymentWindowHours,
  });
  if ((selectedDeliveryOptions.some((option) => option.requiresStore) || fulfillmentPaths.includes('relay')) && relayStoreIds.length === 0) {
    throw new Error('Nominate at least one relay pickup store for store delivery');
  }

  const fullServiceDays = fulfillmentPaths.includes('full_service') ? await getFullServiceDeliveryDays() : null;
  // Throws UnknownCategoryError for an unseeded category, and ZodError with per-field
  // issues for bad attribute values.
  const { attributes, version } = await parseAttributesWithCatalogValues(input.category, input.attributes);

  return db.transaction(async (tx) => {
    await assertMarketplaceEligible(tx, sellerId, 'persist_listing');
    if (input.meetupLocationId !== undefined) {
      const location = await tx
        .select({ id: sellerMeetupLocations.id })
        .from(sellerMeetupLocations)
        .where(and(
          eq(sellerMeetupLocations.id, input.meetupLocationId),
          eq(sellerMeetupLocations.sellerId, sellerId),
          eq(sellerMeetupLocations.active, true),
        ))
        .limit(1);
      if (location[0] === undefined) throw new Error('Choose one of your active meetup locations.');
    }
    const selectedRelayStoreIds = [...new Set(relayStoreIds)];
    if (selectedDeliveryOptions.some((option) => option.requiresStore) || fulfillmentPaths.includes('relay')) {
      const selectedStores = await tx
        .select({ id: relayStores.id, active: relayStores.active })
        .from(relayStores)
        .where(inArray(relayStores.id, selectedRelayStoreIds));
      const selectedStoreIds = new Set(selectedStores.map((store) => store.id));
      if (selectedStores.length !== selectedRelayStoreIds.length || selectedRelayStoreIds.some((id) => !selectedStoreIds.has(id))) {
        throw new Error('One or more selected pickup stores no longer exists. Choose the available stores again.');
      }
      if (selectedStores.some((store) => !store.active)) {
        throw new Error('One or more selected pickup stores is no longer accepting items. Choose the available stores again.');
      }
    }

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
        // v1 uses a platform policy window. Seller-authored windows remain readable
        // on legacy rows but cannot be written onto a new v1 listing.
        paymentWindowHours: isV1Launch() ? V1_PAYMENT_WINDOW_HOURS : input.paymentWindowHours,
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
        fulfillmentPaths,
        settlementMethods,
        autoRelistOnRenege: input.autoRelistOnRenege,
        meetupLocationId: input.meetupLocationId ?? null,
        expiresAt:
          input.saleType === 'straight_sale' && opts.publish === true
            ? sql`now() + (${await getListingExpiryDays(tx)} || ' days')::interval`
            : null,
        publishedAt: opts.publish === true ? sql`now()` : null,
      })
      .returning({ id: listings.id, endsAt: listings.endsAt });

    const listing = inserted[0];
    if (listing === undefined) throw new Error('Failed to create listing');

    await recordAnalyticsEvent(tx, {
      eventName: 'listing_created',
      userId: sellerId,
      subjectType: 'listing',
      subjectId: listing.id,
      metadata: { saleType: input.saleType, published: opts.publish === true },
      idempotencyKey: `listing-created:${listing.id}`,
    });
    if (opts.publish === true) {
      await recordAnalyticsEvent(tx, {
        eventName: 'listing_published',
        userId: sellerId,
        subjectType: 'listing',
        subjectId: listing.id,
        metadata: { saleType: input.saleType },
        idempotencyKey: `listing-published:${listing.id}`,
      });
    }

    await attachImages(tx, listing.id, sellerId, input.imageIds);

    await tx.insert(listingFulfillmentTerms).values(
      fulfillmentPaths.map((path) => ({
        listingId: listing.id,
        fulfillmentPath: path,
        expectedDeliveryDays: input.deliveryEstimates[path] ?? fullServiceDays ?? 14,
      })),
    );

    if (selectedDeliveryOptions.length > 0) {
      await tx.insert(listingDeliveryOptions).values(
        selectedDeliveryOptions.map((option) => ({
          listingId: listing.id,
          optionId: option.id,
          expectedDeliveryDays:
            input.deliveryEstimates[option.id] ??
            (option.fulfillmentPath === null ? 5 : input.deliveryEstimates[option.fulfillmentPath]) ??
            (option.fulfillmentPath === 'full_service' ? fullServiceDays ?? 14 : 5),
        })),
      );
    }

    await tx.insert(listingAuditEvents).values({
      listingId: listing.id,
      actorUserId: sellerId,
      eventType: 'created',
      metadata: { status: opts.publish === true ? 'active' : 'draft' },
    });

    if (fulfillmentPaths.includes('relay') && relayStoreIds.length > 0) {
      await tx.insert(listingRelayStores).values(
        selectedRelayStoreIds.map((storeId) => ({ listingId: listing.id, storeId })),
      );
    }

    // ★ The close job is enqueued in the SAME transaction that created the auction, so
    //   an auction cannot exist without something scheduled to resolve it. The job
    //   re-reads ends_at when it fires, so anti-snipe extensions are handled there.
    if (input.saleType === 'straight_sale' && opts.publish === true && listing.id !== undefined) {
      const expiryRows = await tx.select({ expiresAt: listings.expiresAt }).from(listings).where(eq(listings.id, listing.id)).limit(1);
      const expiresAt = expiryRows[0]?.expiresAt;
      if (expiresAt !== undefined && expiresAt !== null) {
        await enqueue(tx, 'listing:expire', { listingId: listing.id }, { jobKey: `listing_expire:${listing.id}`, runAt: expiresAt });
      }
    }

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

async function assertPublishableListing(tx: DbOrTx, listingId: string): Promise<void> {
  const rows = await tx
    .select({ description: listings.description, saleType: listings.saleType, priceCents: listings.priceCents, startBidCents: listings.startBidCents, endsAt: listings.endsAt })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error('Listing not found');
  if (row.description === null || row.description.trim() === '') throw new Error('A description is required before publishing.');
  if (row.saleType === 'straight_sale' && row.priceCents === null) throw new Error('A price is required before publishing.');
  if (row.saleType === 'auction' && (row.startBidCents === null || row.endsAt === null)) throw new Error('Starting bid and duration are required before publishing.');
  const imagesForListing = await tx.select({ id: listingImages.imageId }).from(listingImages).where(eq(listingImages.listingId, listingId)).limit(1);
  if (imagesForListing.length === 0) throw new Error('Add at least one image before publishing.');
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
  await db.transaction(async (tx) => {
    await assertMarketplaceEligible(tx, sellerId, 'publish_listing');
    const current = await tx
      .select({
        status: listings.status,
        fulfillmentPaths: listings.fulfillmentPaths,
        settlementMethods: listings.settlementMethods,
        acceptsOffers: listings.acceptsOffers,
        reserveCents: listings.reserveCents,
        buyoutCents: listings.buyoutCents,
        paymentWindowHours: listings.paymentWindowHours,
        description: listings.description,
        saleType: listings.saleType,
        priceCents: listings.priceCents,
        startBidCents: listings.startBidCents,
        endsAt: listings.endsAt,
      })
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)))
      .limit(1);

    const row = current[0];
    if (row === undefined) throw new Error('Listing not found');
    await assertPublishableListing(tx, listingId);
    assertV1ListingTerms(row);
    // Compile-time-checked machine, asserted again at runtime for a DB-read value.
    assertListingTransition(row.status, 'active');

    const expiryDays = row.saleType === 'straight_sale' ? await getListingExpiryDays(tx) : null;
    await tx
      .update(listings)
      .set({
        status: 'active',
        publishedAt: sql`now()`,
        expiresAt: expiryDays === null ? null : sql`coalesce(${listings.expiresAt}, now() + (${expiryDays} || ' days')::interval)`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId), eq(listings.status, 'draft')));

    await recordAnalyticsEvent(tx, {
      eventName: 'listing_published',
      userId: sellerId,
      subjectType: 'listing',
      subjectId: listingId,
      metadata: { saleType: row.saleType },
      idempotencyKey: `listing-published:${listingId}`,
    });

    if (expiryDays !== null) {
      const expiryRows = await tx.select({ expiresAt: listings.expiresAt }).from(listings).where(eq(listings.id, listingId)).limit(1);
      const expiresAt = expiryRows[0]?.expiresAt;
      if (expiresAt !== undefined && expiresAt !== null) await enqueue(tx, 'listing:expire', { listingId }, { jobKey: `listing_expire:${listingId}`, runAt: expiresAt });
    }
  });
}

const listingEditSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional(),
  priceCents: z.number().int().positive().optional(),
  acceptsOffers: z.boolean().optional(),
  paymentWindowHours: z.number().int().min(48).max(168).optional(),
  deliveryEstimates: z.record(z.string(), z.number().int().min(1).max(60)).optional(),
  deliveryOptionEstimates: z.record(z.string().uuid(), z.number().int().min(1).max(60)).optional(),
  imageIds: z.array(z.string().uuid()).max(8).default([]),
  meetupLocationId: z.string().uuid().nullable().optional(),
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
          and status = 'active'
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
      select title, description, sale_type, status, price_cents, accepts_offers, payment_window_hours, fulfillment_paths, meetup_location_id
      from listings
      where id = ${listingId} and seller_id = ${sellerId}
      for update
    `);
    const current = currentRows.rows[0] as {
      title: string;
      description: string | null;
      sale_type: 'straight_sale' | 'auction';
      status: 'draft' | 'active' | 'claimed' | 'ended_won' | 'ended_no_sale' | 'cancelled' | 'expired' | 'sold_outside';
      price_cents: string | number | null;
      accepts_offers: boolean;
      payment_window_hours: number;
      fulfillment_paths: FulfillmentPath[];
      meetup_location_id: string | null;
    } | undefined;
    if (current === undefined) throw new Error('Listing not found');
    if (current.status !== 'active' && current.status !== 'draft') {
      throw new Error('Only active or draft listings can be edited.');
    }
    await assertListingUnlocked(tx, listingId);
    if (input.meetupLocationId !== undefined && input.meetupLocationId !== null) {
      const location = await tx.select({ id: sellerMeetupLocations.id }).from(sellerMeetupLocations).where(and(eq(sellerMeetupLocations.id, input.meetupLocationId), eq(sellerMeetupLocations.sellerId, sellerId), eq(sellerMeetupLocations.active, true))).limit(1);
      if (location[0] === undefined) throw new Error('Choose one of your active meetup locations.');
    }
    assertV1ListingTerms({
      fulfillmentPaths: current.fulfillment_paths,
      settlementMethods: [],
      acceptsOffers: input.acceptsOffers,
      paymentWindowHours: input.paymentWindowHours,
    });
    if (current.sale_type === 'straight_sale' && input.priceCents === undefined) {
      throw new Error('A price is required for a fixed-price listing.');
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
    if (input.meetupLocationId !== undefined && input.meetupLocationId !== current.meetup_location_id) {
      changes.meetupLocationId = { from: current.meetup_location_id, to: input.meetupLocationId };
    }
    if (input.deliveryEstimates !== undefined) {
      const previousTerms = await tx
        .select({ fulfillmentPath: listingFulfillmentTerms.fulfillmentPath, expectedDeliveryDays: listingFulfillmentTerms.expectedDeliveryDays })
        .from(listingFulfillmentTerms)
        .where(eq(listingFulfillmentTerms.listingId, listingId));
      const previous = Object.fromEntries(previousTerms.map((term) => [term.fulfillmentPath, term.expectedDeliveryDays]));
      const normalized = Object.fromEntries(current.fulfillment_paths.map((path) => [
        path,
        input.deliveryEstimates?.[path] ?? previous[path] ?? 5,
      ]));
      const termChanges = Object.fromEntries(current.fulfillment_paths.map((path) => [path, { from: previous[path], to: normalized[path] }]));
      if (JSON.stringify(previous) !== JSON.stringify(normalized)) changes.deliveryEstimates = termChanges;
      input.deliveryEstimates = normalized;
    }
    if (input.deliveryOptionEstimates !== undefined) {
      const previousOptions = await tx
        .select({ optionId: listingDeliveryOptions.optionId, expectedDeliveryDays: listingDeliveryOptions.expectedDeliveryDays })
        .from(listingDeliveryOptions)
        .where(eq(listingDeliveryOptions.listingId, listingId));
      const previous = Object.fromEntries(previousOptions.map((option) => [option.optionId, option.expectedDeliveryDays]));
      const normalized = Object.fromEntries(previousOptions.map((option) => [
        option.optionId,
        input.deliveryOptionEstimates?.[option.optionId] ?? option.expectedDeliveryDays,
      ]));
      const optionChanges = Object.fromEntries(previousOptions.map((option) => [option.optionId, {
        from: previous[option.optionId],
        to: normalized[option.optionId],
      }]));
      if (JSON.stringify(previous) !== JSON.stringify(normalized)) changes.deliveryOptionEstimates = optionChanges;
      input.deliveryOptionEstimates = normalized;
    }

    await tx
      .update(listings)
      .set({
        title: input.title,
        description: input.description ?? null,
        ...(current.sale_type === 'straight_sale' ? { priceCents: input.priceCents ?? Number(current.price_cents) } : {}),
        ...(current.sale_type === 'straight_sale' && input.acceptsOffers !== undefined ? { acceptsOffers: input.acceptsOffers } : {}),
        ...(input.paymentWindowHours !== undefined ? { paymentWindowHours: input.paymentWindowHours } : {}),
        ...(input.meetupLocationId !== undefined ? { meetupLocationId: input.meetupLocationId } : {}),
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

    if (input.deliveryOptionEstimates !== undefined) {
      for (const [optionId, expectedDeliveryDays] of Object.entries(input.deliveryOptionEstimates)) {
        await tx
          .update(listingDeliveryOptions)
          .set({ expectedDeliveryDays })
          .where(and(
            eq(listingDeliveryOptions.listingId, listingId),
            eq(listingDeliveryOptions.optionId, optionId),
          ));
      }
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

/** Close an active listing because the seller completed the sale elsewhere. */
export async function markListingSoldOutside(sellerId: string, listingId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ status: listings.status, saleType: listings.saleType })
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)))
      .for('update');
    const current = rows[0];
    if (current === undefined) throw new Error('Listing not found');
    if (current.status !== 'active') throw new Error('Only an active listing can be marked sold outside CollectTT.');
    await assertListingUnlocked(tx, listingId);
    assertListingTransition(current.status, 'sold_outside');
    await tx.update(listings).set({ status: 'sold_outside', resolvedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(listings.id, listingId));
    await tx.insert(listingAuditEvents).values({
      listingId,
      actorUserId: sellerId,
      eventType: 'sold_outside',
      metadata: { fromStatus: current.status, toStatus: 'sold_outside', saleType: current.saleType },
    });
  });
}

/** Seller-managed reusable meetup locations. */
export async function sellerMeetupLocationsFor(sellerId: string) {
  return db.select().from(sellerMeetupLocations).where(eq(sellerMeetupLocations.sellerId, sellerId)).orderBy(desc(sellerMeetupLocations.updatedAt));
}

export async function saveSellerMeetupLocation(
  sellerId: string,
  input: { id?: string; label: string; area: string; instructions?: string | null; active?: boolean },
): Promise<string> {
  const label = input.label.trim();
  const area = input.area.trim();
  if (label.length < 2 || label.length > 120 || area.length < 2 || area.length > 120) throw new Error('Meetup name and area are required.');
  if (input.id !== undefined) {
    const updated = await db.update(sellerMeetupLocations).set({ label, area, instructions: input.instructions?.trim() || null, active: input.active ?? true, updatedAt: sql`now()` }).where(and(eq(sellerMeetupLocations.id, input.id), eq(sellerMeetupLocations.sellerId, sellerId))).returning({ id: sellerMeetupLocations.id });
    if (updated[0] === undefined) throw new Error('Meetup location not found.');
    return updated[0].id;
  }
  const inserted = await db.insert(sellerMeetupLocations).values({ sellerId, label, area, instructions: input.instructions?.trim() || null }).returning({ id: sellerMeetupLocations.id });
  return inserted[0]!.id;
}

export async function sellerMarketplacePreferencesFor(sellerId: string) {
  const rows = await db.select().from(sellerMarketplacePreferences).where(eq(sellerMarketplacePreferences.sellerId, sellerId)).limit(1);
  return rows[0] ?? { sellerId, defaultDeliveryOptionIds: [], defaultRelayStoreIds: [], defaultPaymentMethods: ['cash'], updatedAt: new Date() };
}

export async function saveSellerMarketplacePreferences(
  sellerId: string,
  input: { defaultDeliveryOptionIds: string[]; defaultRelayStoreIds: string[]; defaultPaymentMethods: string[] },
): Promise<void> {
  const deliveryOptionIds = [...new Set(input.defaultDeliveryOptionIds)].filter((id) => id !== '');
  if (deliveryOptionIds.length === 0) throw new Error('Choose at least one default delivery method.');
  const deliveryOptions = await db.select({ id: marketplaceOptions.id }).from(marketplaceOptions).where(and(
    eq(marketplaceOptions.kind, 'delivery'),
    eq(marketplaceOptions.active, true),
    inArray(marketplaceOptions.id, deliveryOptionIds),
  ));
  if (deliveryOptions.length !== deliveryOptionIds.length) throw new Error('Choose only active delivery methods.');
  const relayStoreIds = [...new Set(input.defaultRelayStoreIds)].filter((id) => id !== '');
  if (relayStoreIds.length > 0) {
    const stores = await db.select({ id: relayStores.id }).from(relayStores).where(and(
      eq(relayStores.active, true),
      inArray(relayStores.id, relayStoreIds),
    ));
    if (stores.length !== relayStoreIds.length) throw new Error('Choose only active pickup stores.');
  }
  const methods = [...new Set(input.defaultPaymentMethods)].filter((method) => ['cash', 'bank_transfer'].includes(method));
  if (methods.length === 0) throw new Error('Choose at least one default payment method.');
  await db.insert(sellerMarketplacePreferences).values({ sellerId, defaultDeliveryOptionIds: deliveryOptionIds, defaultRelayStoreIds: relayStoreIds, defaultPaymentMethods: methods }).onConflictDoUpdate({ target: sellerMarketplacePreferences.sellerId, set: { defaultDeliveryOptionIds: deliveryOptionIds, defaultRelayStoreIds: relayStoreIds, defaultPaymentMethods: methods, updatedAt: sql`now()` } });
}

/** Copy a listing into a distinct editable draft, preserving immutable media refs. */
export async function duplicateListingToDraft(sellerId: string, sourceListingId: string): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await assertMarketplaceEligible(tx, sellerId, 'persist_listing');
    const sourceRows = await tx.select().from(listings).where(and(eq(listings.id, sourceListingId), eq(listings.sellerId, sellerId))).limit(1);
    const source = sourceRows[0];
    if (source === undefined) throw new Error('Listing not found');
    if (source.status === 'sold_outside' || source.status === 'expired' || source.status === 'ended_no_sale' || source.status === 'cancelled' || source.status === 'ended_won' || source.status === 'active') {
      // Active duplication is useful for a seller who wants a second similar item;
      // all other statuses are relist history. Reserved/claimed rows are intentionally
      // excluded so a live buyer cannot be copied into a new sale.
    } else {
      throw new Error('This listing cannot be duplicated while a buyer transaction is active.');
    }
    if (source.status === 'active') await assertListingUnlocked(tx, sourceListingId);
    const inserted = await tx.insert(listings).values({
      sellerId,
      category: source.category,
      attributes: source.attributes,
      attributesVersion: source.attributesVersion,
      title: source.title,
      description: source.description,
      saleType: source.saleType,
      status: 'draft',
      currency: source.currency,
      priceCents: source.priceCents,
      acceptsOffers: source.acceptsOffers,
      paymentWindowHours: source.paymentWindowHours,
      startBidCents: source.startBidCents,
      reserveCents: source.reserveCents,
      buyoutCents: source.buyoutCents,
      currentBidCents: null,
      currentBidId: null,
      bidCount: 0,
      endsAt: source.saleType === 'auction' ? sql`now() + interval '48 hours'` : null,
      antisnipeWindowS: source.antisnipeWindowS,
      antisnipeExtendS: source.antisnipeExtendS,
      maxExtensions: source.maxExtensions,
      fulfillmentPaths: source.fulfillmentPaths,
      settlementMethods: source.settlementMethods,
      autoRelistOnRenege: source.autoRelistOnRenege,
      meetupLocationId: source.meetupLocationId,
      expiresAt: null,
      activeTransactionId: null,
      publishedAt: null,
      resolvedAt: null,
    }).returning({ id: listings.id });
    const copy = inserted[0];
    if (copy === undefined) throw new Error('Could not create draft');

    const sourceImages = await tx.select().from(listingImages).where(eq(listingImages.listingId, sourceListingId));
    if (sourceImages.length > 0) await tx.insert(listingImages).values(sourceImages.map((image) => ({ listingId: copy.id, imageId: image.imageId, position: image.position })));
    const sourceTerms = await tx.select().from(listingFulfillmentTerms).where(eq(listingFulfillmentTerms.listingId, sourceListingId));
    if (sourceTerms.length > 0) await tx.insert(listingFulfillmentTerms).values(sourceTerms.map((term) => ({ listingId: copy.id, fulfillmentPath: term.fulfillmentPath, expectedDeliveryDays: term.expectedDeliveryDays })));
    const sourceOptions = await tx.select().from(listingDeliveryOptions).where(eq(listingDeliveryOptions.listingId, sourceListingId));
    if (sourceOptions.length > 0) await tx.insert(listingDeliveryOptions).values(sourceOptions.map((option) => ({ listingId: copy.id, optionId: option.optionId, expectedDeliveryDays: option.expectedDeliveryDays })));
    const sourceStores = await tx.select().from(listingRelayStores).where(eq(listingRelayStores.listingId, sourceListingId));
    if (sourceStores.length > 0) await tx.insert(listingRelayStores).values(sourceStores.map((store) => ({ listingId: copy.id, storeId: store.storeId })));
    await tx.insert(listingAuditEvents).values({ listingId: copy.id, actorUserId: sellerId, eventType: 'duplicated', metadata: { duplicatedFrom: sourceListingId, sourceStatus: source.status } });
    return { id: copy.id };
  });
}

export async function relistListing(sellerId: string, sourceListingId: string): Promise<{ id: string }> {
  const source = await db.select({ status: listings.status, sellerId: listings.sellerId }).from(listings).where(eq(listings.id, sourceListingId)).limit(1);
  if (source[0]?.sellerId !== sellerId) throw new Error('Listing not found');
  if (source[0].status !== 'expired' && source[0].status !== 'sold_outside' && source[0].status !== 'ended_no_sale') throw new Error('Only expired or sold-outside listings can be relisted.');
  return duplicateListingToDraft(sellerId, sourceListingId);
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
  /** Match listings that offer any selected admin-managed delivery option. */
  deliveryOptionIds?: readonly string[];
  /** Match listings that offer this delivery/fulfillment path. */
  fulfillmentPath?: FulfillmentPath;
  /** Match listings that offer any selected delivery/fulfillment path. */
  fulfillmentPaths?: readonly FulfillmentPath[];
  /** Match listings that accept this payment method. */
  settlementMethod?: string;
  /** Match listings that accept any selected payment method. */
  settlementMethods?: readonly string[];
  /** Case-insensitive public meetup area/name filter. */
  location?: string;
  /** Price filters apply to fixed prices and the current/start bid for auctions. */
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: BrowseSort;
  /** Discovery surface: recent means newly published fixed-price listings. */
  surface?: 'catalog' | 'recent';
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
  /** Opaque keyset cursor returned by the previous page. */
  cursor?: string;
}

export interface BrowsePage {
  rows: Awaited<ReturnType<typeof selectBrowseRows>>;
  /** Total matching the filters, independent of the returned page slice. */
  total: number;
  page: number;
  pageSize: number;
  nextCursor?: string;
}

type BrowseCursor = {
  sort: BrowseSort;
  id: string;
  createdAt?: string;
  publishedAt?: string | null;
  endsAt?: string | null;
  priceCents?: number | null;
};

function encodeBrowseCursor(cursor: BrowseCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeBrowseCursor(value: string | undefined): BrowseCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as BrowseCursor;
    if (typeof decoded.id !== 'string' || !BROWSE_SORTS.includes(decoded.sort)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function browseCursorCondition(cursor: BrowseCursor): ReturnType<typeof sql> {
  const createdAt = cursor.createdAt ? new Date(cursor.createdAt) : null;
  const publishedAt = cursor.publishedAt ? new Date(cursor.publishedAt) : null;
  const endsAt = cursor.endsAt ? new Date(cursor.endsAt) : null;
  const price = cursor.priceCents ?? null;
  switch (cursor.sort) {
    case 'newest':
      return createdAt === null ? sql`true` : sql`(${listings.createdAt} < ${createdAt} or (${listings.createdAt} = ${createdAt} and ${listings.id} < ${cursor.id}))`;
    case 'ending_soon':
      if (endsAt === null) return sql`${listings.endsAt} is null and ${listings.id} < ${cursor.id}`;
      return sql`(${listings.endsAt} > ${endsAt} or (${listings.endsAt} = ${endsAt} and ${listings.publishedAt} < ${publishedAt}) or (${listings.endsAt} = ${endsAt} and ${listings.publishedAt} = ${publishedAt} and ${listings.id} < ${cursor.id}) or ${listings.endsAt} is null)`;
    case 'price_low':
      return price === null ? sql`true` : sql`(${browsePriceExpression()} > ${price} or (${browsePriceExpression()} = ${price} and ${listings.publishedAt} < ${publishedAt}) or (${browsePriceExpression()} = ${price} and ${listings.publishedAt} = ${publishedAt} and ${listings.id} < ${cursor.id}))`;
    case 'price_high':
      return price === null ? sql`true` : sql`(${browsePriceExpression()} < ${price} or (${browsePriceExpression()} = ${price} and ${listings.publishedAt} < ${publishedAt}) or (${browsePriceExpression()} = ${price} and ${listings.publishedAt} = ${publishedAt} and ${listings.id} < ${cursor.id}))`;
  }
}

function browsePriceExpression() {
  return sql`coalesce(${listings.priceCents}, ${listings.currentBidCents}, ${listings.startBidCents})`;
}

function browseConditions(filters: BrowseFilters) {
  const surface = filters.surface ?? 'catalog';
  const conditions = [
    surface === 'recent'
      ? sql`${listings.status} = 'active' and ${listings.saleType} = 'straight_sale'`
      : sql`(
          (${listings.status} = 'active' and ${listings.saleType} = 'auction')
          or (${listings.status} = 'active' and ${listings.saleType} = 'straight_sale')
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
  if (filters.deliveryOptionIds !== undefined && filters.deliveryOptionIds.length > 0) {
    conditions.push(sql`exists (
      select 1 from listing_delivery_options ldo
      where ldo.listing_id = ${listings.id}
        and ldo.option_id in (${sql.join(filters.deliveryOptionIds.map((id) => sql`${id}::uuid`), sql`, `)})
    )`);
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
  const location = filters.location?.trim();
  if (location) {
    const pattern = `%${location}%`;
    conditions.push(sql`exists (
      select 1 from seller_meetup_locations sml
      where sml.id = ${listings.meetupLocationId}
        and sml.active = true
        and (sml.area ilike ${pattern} or sml.label ilike ${pattern})
    ) or ${profiles.area} ilike ${pattern}`);
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
      createdAt: listings.createdAt,
      sellerName: profiles.displayName,
      sellerId: profiles.userId,
      sellerCompletedSales: reputationCounters.sellCompleted,
      fulfillmentPaths: listings.fulfillmentPaths,
      settlementMethods: listings.settlementMethods,
      meetupLocation: sql<string | null>`(
        select concat(sml.label, ' — ', sml.area)
        from seller_meetup_locations sml
        where sml.id = ${listings.meetupLocationId}
          and sml.active = true
        limit 1
      )`,
      deliveryOptionLabels: sql<string[]>`coalesce(
        (
          select array_agg(mo.label order by mo.sort_order, mo.label)
          from listing_delivery_options ldo
          inner join marketplace_options mo on mo.id = ldo.option_id
          where ldo.listing_id = ${listings.id}
        ),
        ARRAY[]::text[]
      )`,
      paymentOptionLabels: sql<string[]>`coalesce(
        (
          select array_agg(coalesce(mo.label, replace(method.key, '_', ' ')) order by method.position)
          from unnest(${listings.settlementMethods}) with ordinality as method(key, position)
          left join marketplace_options mo on mo.kind = 'payment' and mo.key = method.key
        ),
        ARRAY[]::text[]
      )`,
      relayStoreNames: sql<string[]>`coalesce(
        (
          select array_agg(rs.name order by rs.name)
          from listing_relay_stores lrs
          inner join relay_stores rs on rs.id = lrs.store_id
          where lrs.listing_id = ${listings.id}
            and rs.active = true
        ),
        ARRAY[]::text[]
      )`,
      liveClaimCount: sql<number>`(
        select count(*)::int
          from claims c
         where c.listing_id = ${listings.id}
           and c.status = 'active'
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
  const baseConditions = browseConditions(filters);
  const cursor = decodeBrowseCursor(filters.cursor);
  const where = and(...baseConditions, ...(cursor !== null ? [browseCursorCondition(cursor)] : []));

  const pageSize = filters.pageSize ?? BROWSE_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const offset = cursor === null ? (page - 1) * pageSize : 0;
  const sort = filters.sort ?? 'newest';

  const [rows, totalRows] = await Promise.all([
    selectBrowseRows(where, pageSize + 1, offset, sort),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(listings)
      .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
      .where(where),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const last = pageRows.at(-1);
  const nextCursor = hasMore && last !== undefined
    ? encodeBrowseCursor({
        sort,
        id: last.id,
        createdAt: last.createdAt.toISOString(),
        publishedAt: last.publishedAt?.toISOString() ?? null,
        endsAt: last.endsAt?.toISOString() ?? null,
        priceCents: last.priceCents ?? last.currentBidCents ?? last.startBidCents,
      })
    : undefined;
  return { rows: pageRows, total: totalRows[0]?.n ?? 0, page, pageSize, ...(nextCursor !== undefined ? { nextCursor } : {}) };
}

/**
 * Fixed-price activity for the homepage. Only successful claims or accepted offers with
 * a live or completed transaction are shown, so a failed attempt never becomes
 * misleading social proof. Buyer identity is intentionally omitted from this public query.
 */
export async function recentlyClaimedListings(limit = 16) {
  return db
    .select({
      id: listings.id,
      title: listings.title,
      saleType: listings.saleType,
      priceCents: listings.priceCents,
      claimedAt: transactions.createdAt,
      primaryImageId: sql<string | null>`(
        select i.id
        from listing_images li
        inner join images i on i.id = li.image_id
        where li.listing_id = ${listings.id}
        order by li.position asc
        limit 1
      )`,
    })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .where(
      and(
        inArray(transactions.source, ['claim', 'offer_accept']),
        sql`${transactions.state} in ('open', 'completed')`,
        sql`${transactions.createdAt} >= now() - interval '72 hours'`,
      ),
    )
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(limit);
}

export async function getListing(id: string, viewerId?: string) {
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
  // Drafts are private seller workspaces. Public callers must not be able to infer
  // title, price, images, or seller details before publication.
  if (row.listing.status === 'draft' && row.listing.sellerId !== viewerId) return null;

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

  let deliveryOptions = await db
    .select({
      id: marketplaceOptions.id,
      key: marketplaceOptions.key,
      label: marketplaceOptions.label,
      description: marketplaceOptions.description,
      requiresStore: marketplaceOptions.requiresStore,
      fulfillmentPath: marketplaceOptions.fulfillmentPath,
      expectedDeliveryDays: listingDeliveryOptions.expectedDeliveryDays,
    })
    .from(listingDeliveryOptions)
    .innerJoin(marketplaceOptions, eq(marketplaceOptions.id, listingDeliveryOptions.optionId))
    .where(eq(listingDeliveryOptions.listingId, id))
    .orderBy(asc(marketplaceOptions.sortOrder), asc(marketplaceOptions.label));

  if (deliveryOptions.length === 0 && row.listing.fulfillmentPaths.length > 0) {
    const legacyOptions = await db
      .select()
      .from(marketplaceOptions)
      .where(and(
        eq(marketplaceOptions.kind, 'delivery'),
        inArray(marketplaceOptions.key, row.listing.fulfillmentPaths),
      ))
      .orderBy(asc(marketplaceOptions.sortOrder));
    deliveryOptions = legacyOptions.map((option) => ({
      id: option.id,
      key: option.key,
      label: option.label,
      description: option.description,
      requiresStore: option.requiresStore,
      fulfillmentPath: option.fulfillmentPath,
      expectedDeliveryDays: fulfillmentTerms.find((term) => term.fulfillmentPath === option.fulfillmentPath)?.expectedDeliveryDays ?? 5,
    }));
  }

  const storedPaymentOptions = row.listing.settlementMethods.length === 0
    ? []
    : await db
        .select()
        .from(marketplaceOptions)
        .where(and(
          eq(marketplaceOptions.kind, 'payment'),
          inArray(marketplaceOptions.key, row.listing.settlementMethods),
        ));
  const paymentByKey = new Map(storedPaymentOptions.map((option) => [option.key, option]));
  const paymentOptions = row.listing.settlementMethods.map((key) => ({
    id: paymentByKey.get(key)?.id ?? key,
    key,
    label: paymentByKey.get(key)?.label ?? key.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase()),
    description: paymentByKey.get(key)?.description ?? null,
  }));

  const listingStoreRows = await db
    .select({ storeId: listingRelayStores.storeId })
    .from(listingRelayStores)
    .where(eq(listingRelayStores.listingId, id));

  const meetupRows = row.listing.meetupLocationId === null
    ? []
    : await db.select({ id: sellerMeetupLocations.id, label: sellerMeetupLocations.label, area: sellerMeetupLocations.area, instructions: sellerMeetupLocations.instructions }).from(sellerMeetupLocations).where(eq(sellerMeetupLocations.id, row.listing.meetupLocationId)).limit(1);

  return { ...row, images: imageRows, fulfillmentTerms, deliveryOptions, paymentOptions, relayStoreIds: listingStoreRows.map((store) => store.storeId), meetupLocation: meetupRows[0] ?? null };
}

export async function listingsBySeller(sellerId: string) {
  return db
    .select({
      id: listings.id,
      title: listings.title,
      category: listings.category,
      saleType: listings.saleType,
      status: listings.status,
      priceCents: listings.priceCents,
      startBidCents: listings.startBidCents,
      currentBidCents: listings.currentBidCents,
      liveClaimCount: sql<number>`(
        select count(*)::int
          from claims c
         where c.listing_id = ${listings.id}
           and c.status = 'active'
      )`,
      liveBidCount: sql<number>`(
        select count(*)::int
          from bids b
         where b.listing_id = ${listings.id}
           and b.status = 'active'
      )`,
      activeTransactionCount: sql<number>`(
        select count(*)::int
          from transactions t
         where t.listing_id = ${listings.id}
           and t.state = 'open'
      )`,
    })
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
