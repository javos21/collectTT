/** Expire a fixed-price listing at its platform-configured lifetime. */
import { and, eq, sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db, dbNow } from '../../db/client';
import { listings, listingAuditEvents } from '../../db/schema/listings';
import { notify } from '../../notifications/dispatch';
import { enqueue } from '../enqueue';

interface Payload { listingId: string }

export async function listingExpiry({ listingId }: Payload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.status, 'active'), eq(listings.saleType, 'straight_sale'))).limit(1);
    const listing = rows[0];
    if (listing === undefined || listing.expiresAt === null) {
      helpers.logger.info(`listing ${listingId} is not an expiring active fixed-price listing`);
      return;
    }
    const now = await dbNow(tx);
    if (listing.expiresAt.getTime() > now.getTime()) {
      await enqueue(tx, 'listing:expire', { listingId }, { jobKey: `listing_expire:${listingId}`, runAt: listing.expiresAt });
      return;
    }
    const changed = await tx.update(listings).set({ status: 'expired', resolvedAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(listings.id, listingId), eq(listings.status, 'active'))).returning({ id: listings.id });
    if (changed.length === 0) return;
    await tx.insert(listingAuditEvents).values({ listingId, actorUserId: null, eventType: 'expired', metadata: { reason: 'fixed_price_lifetime' } });
    await notify({
      tx,
      userId: listing.sellerId,
      event: 'listing_expired_seller',
      data: { listingTitle: listing.title },
      linkUrl: `/listings/${listingId}`,
      idempotencyKey: `listing_expired:${listingId}`,
    });
    helpers.logger.info(`listing ${listingId} expired`);
  });
}
