/**
 * Reads over relay stores. Writes to custody live in src/services/custody.ts; this is
 * only the lookup half — what a seller may nominate and what a buyer may pick.
 */

import { and, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../db/client';
import { relayStores, listingRelayStores } from '../db/schema/custody';
import type { SizeClass } from '../domain/states/listing';

export interface RelayStoreOption {
  id: string;
  name: string;
  area: string;
  address: string | null;
}

/** Every active store — what a seller chooses from when listing. */
export async function listRelayStores(tx: DbOrTx): Promise<RelayStoreOption[]> {
  return tx
    .select({
      id: relayStores.id,
      name: relayStores.name,
      area: relayStores.area,
      address: relayStores.address,
    })
    .from(relayStores)
    .where(eq(relayStores.active, true))
    .orderBy(relayStores.area, relayStores.name);
}

/**
 * What a BUYER may pick for this listing: the seller's nominations, intersected with
 * active stores, intersected with those that accept the item's size class.
 *
 * ★ This is UX filtering only. `claimListing` re-runs the size gate server-side,
 *   because the form is client-supplied.
 */
export async function candidateStoresFor(
  tx: DbOrTx,
  listingId: string,
  sizeClass: SizeClass,
): Promise<RelayStoreOption[]> {
  return tx
    .select({
      id: relayStores.id,
      name: relayStores.name,
      area: relayStores.area,
      address: relayStores.address,
    })
    .from(listingRelayStores)
    .innerJoin(relayStores, eq(relayStores.id, listingRelayStores.storeId))
    .where(
      and(
        eq(listingRelayStores.listingId, listingId),
        eq(relayStores.active, true),
        sql`${sizeClass} = any(${relayStores.acceptsSizeClasses})`,
      ),
    )
    .orderBy(relayStores.area, relayStores.name);
}
