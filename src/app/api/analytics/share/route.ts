import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { recordAnalyticsEvent, type AnalyticsEventName } from '@/services/analytics';
import { getPublicListingShareData } from '@/services/listings';

const inputSchema = z.object({
  listingId: z.string().uuid(),
  method: z.enum(['clicked', 'whatsapp', 'native', 'copy_link']),
  eventId: z.string().min(8).max(100),
});

const EVENT_BY_METHOD: Record<z.infer<typeof inputSchema>['method'], AnalyticsEventName> = {
  clicked: 'listing_share_clicked',
  whatsapp: 'listing_share_whatsapp',
  native: 'listing_share_native',
  copy_link: 'listing_share_copy_link',
};

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid share event' }, { status: 400 });

  const listing = await getPublicListingShareData(parsed.data.listingId);
  if (listing === null) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const viewer = await currentUser();
  await recordAnalyticsEvent(db, {
    eventName: EVENT_BY_METHOD[parsed.data.method],
    userId: viewer?.userId,
    subjectType: 'listing',
    subjectId: listing.id,
    metadata: { method: parsed.data.method },
    idempotencyKey: `listing-share:${parsed.data.eventId}`,
  });

  return new NextResponse(null, { status: 204 });
}
