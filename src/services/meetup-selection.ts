import { eq } from 'drizzle-orm';

import type { DbOrTx } from '@/db/client';
import { listingMeetupLocations } from '@/db/schema/listings';
import { ConflictError } from '@/services/transactions';

/** Validate the buyer's choice against the exact public points offered on the listing. */
export async function assertListingMeetupLocation(
  tx: DbOrTx,
  listingId: string,
  meetupLocationId: string | null | undefined,
): Promise<string | null> {
  const offered = await tx
    .select({ id: listingMeetupLocations.meetupLocationId })
    .from(listingMeetupLocations)
    .where(eq(listingMeetupLocations.listingId, listingId));
  // Historical listings could be published without a location. Keep those deals
  // operable; every new listing is required to populate this junction.
  if (offered.length === 0) return meetupLocationId ?? null;
  if (meetupLocationId === undefined || meetupLocationId === null || meetupLocationId === '') {
    throw new ConflictError('Choose a public meetup location');
  }
  if (!offered.some((row) => row.id === meetupLocationId)) {
    throw new ConflictError('Choose a meetup location offered by the seller');
  }
  return meetupLocationId;
}
