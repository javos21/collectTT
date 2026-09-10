/**
 * ★ ONE GATE, TWO DOORS.
 *
 * A buyer reaches a deal through one of two doors — the straight-sale claim or the
 * auction bid — and must be refused for the SAME reasons, in the SAME words, at both.
 * The buyer should receive the same clear refusal regardless of which door they came in
 * by.
 *
 * This module is the single copy. Keeping the rule in one place is what makes the
 * guarantee hold when someone later tightens it — a suspension state or a per-category
 * rule — because there is only one place to edit.
 *
 * It lives here rather than in `relay-stores.ts` because that module is documented as
 * the reads-only lookup half; this one enforces and throws.
 */

import { and, eq } from 'drizzle-orm';

import type { Tx } from '../db/client';
import { listingRelayStores, relayStores } from '../db/schema/custody';
import { ConflictError } from './transactions';
import { checkEligibility } from '../domain/policy/eligibility';
import type { FulfillmentPath } from '../domain/states/transaction';

export interface FulfillmentEligibilityInput {
  listingId: string;
  path: FulfillmentPath;
  /** New option-based requests must choose a store the seller attached to the listing. */
  requireListedStore?: boolean;
  /** Which relay store the buyer picked. Required when path === 'relay'. */
  relayStoreId?: string | null;
  /** Restrictions already loaded for the buyer by the caller. */
  buyerRestrictions: readonly string[];
}

/**
 * Throws `ConflictError` if this buyer may not take this item down this path. Returns
 * silently when they may.
 *
 * The caller keeps the checks that genuinely differ between the two doors — whose
 * listing it is, the sale type, and the door-specific restriction (`claim_blocked` vs
 * `bid_blocked`) — and whether the seller declared this path at all.
 */
export async function assertFulfillmentEligible(
  tx: Tx,
  input: FulfillmentEligibilityInput,
): Promise<void> {
  if (input.path === 'relay') {
    if (input.relayStoreId === undefined || input.relayStoreId === null) {
      throw new ConflictError('Choose which relay store you want to collect from');
    }
    if (input.requireListedStore === true) {
      const storeRows = await tx
        .select({ active: relayStores.active })
        .from(listingRelayStores)
        .innerJoin(relayStores, eq(relayStores.id, listingRelayStores.storeId))
        .where(and(
          eq(listingRelayStores.listingId, input.listingId),
          eq(listingRelayStores.storeId, input.relayStoreId),
        ))
        .limit(1);
      if (storeRows[0]?.active !== true) {
        throw new ConflictError('Choose a pickup store offered on this listing');
      }
    } else {
      const storeRows = await tx
        .select({ active: relayStores.active })
        .from(relayStores)
        .where(eq(relayStores.id, input.relayStoreId))
        .limit(1);
      if (storeRows[0]?.active !== true) {
        throw new ConflictError('That store is not currently accepting items');
      }
    }
  }

  const eligibility = checkEligibility({
    path: input.path,
    buyerRestrictions: input.buyerRestrictions,
  });
  if (!eligibility.eligible) {
    throw new ConflictError(eligibility.reasons.join(' '));
  }
}
