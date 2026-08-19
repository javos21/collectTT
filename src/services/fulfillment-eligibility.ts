/**
 * ★ ONE GATE, TWO DOORS.
 *
 * A buyer reaches a deal through one of two doors — the straight-sale claim or the
 * auction bid — and must be refused for the SAME reasons, in the SAME words, at both.
 * That is not a style preference: "this store accepts small items only" is a sentence a
 * member reads and a clerk repeats, and it cannot depend on which door they came in by.
 *
 * This module is the single copy. Keeping the rule in one place is what makes the
 * guarantee hold when someone later tightens it — a capacity limit, a suspension state,
 * a per-category rule — because there is only one place to edit.
 *
 * It lives here rather than in `relay-stores.ts` because that module is documented as
 * the reads-only lookup half; this one enforces and throws.
 */

import { eq } from 'drizzle-orm';

import type { Tx } from '../db/client';
import { relayStores } from '../db/schema/custody';
import { ConflictError } from './transactions';
import { checkEligibility } from '../domain/policy/eligibility';
import type { SizeClass } from '../domain/states/listing';
import type { FulfillmentPath } from '../domain/states/transaction';

export interface FulfillmentEligibilityInput {
  path: FulfillmentPath;
  /** Which relay store the buyer picked. Required when path === 'relay'. */
  relayStoreId?: string | null;
  sizeClass: SizeClass;
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
  // The size gate runs against THIS store's declared limits, not a global default —
  // "if it's not in the log, it doesn't belong there" starts at the claim.
  let storeAcceptedSizes: readonly SizeClass[] | undefined;
  if (input.path === 'relay') {
    if (input.relayStoreId === undefined || input.relayStoreId === null) {
      throw new ConflictError('Choose which relay store you want to collect from');
    }
    const storeRows = await tx
      .select()
      .from(relayStores)
      .where(eq(relayStores.id, input.relayStoreId))
      .limit(1);
    const store = storeRows[0];
    if (store === undefined || !store.active) {
      throw new ConflictError('That store is not currently accepting items');
    }
    storeAcceptedSizes = store.acceptsSizeClasses;
  }

  const eligibility = checkEligibility({
    path: input.path,
    sizeClass: input.sizeClass,
    buyerRestrictions: input.buyerRestrictions,
    ...(storeAcceptedSizes !== undefined ? { storeAcceptedSizes } : {}),
  });
  if (!eligibility.eligible) {
    throw new ConflictError(eligibility.reasons.join(' '));
  }
}
