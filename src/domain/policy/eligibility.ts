/**
 * Size / eligibility gate for the custody rails.
 *
 * "If it's not in the log, it doesn't belong there" — this is the code half of that
 * rule. A store declares what it accepts; anything else cannot be routed to it, so a
 * clerk always has a system-backed answer when someone tries to dump a bulk item.
 */

import type { SizeClass } from '../states/listing';
import type { FulfillmentPath } from '../states/transaction';

/** What the relay rail is for. Anything larger goes to the delivery team or is refused. */
export const RELAY_DEFAULT_SIZES: readonly SizeClass[] = ['small'];

/** Our own courier rail can take more than a shop counter can. */
export const FULL_SERVICE_SIZES: readonly SizeClass[] = ['small', 'medium', 'large'];

export interface EligibilityInput {
  path: FulfillmentPath;
  sizeClass: SizeClass;
  /** Sizes this particular store accepts. Ignored for non-relay paths. */
  storeAcceptedSizes?: readonly SizeClass[];
  /** Restrictions currently in force on the buyer and seller. */
  buyerRestrictions?: readonly string[];
  sellerRestrictions?: readonly string[];
}

export interface EligibilityResult {
  eligible: boolean;
  /** Human-readable, shown directly to the member. */
  reasons: string[];
}

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];

  if (input.path === 'relay') {
    const accepted = input.storeAcceptedSizes ?? RELAY_DEFAULT_SIZES;
    if (!accepted.includes(input.sizeClass)) {
      reasons.push(
        `This store accepts ${accepted.join(', ')} items only. ` +
          `Use delivery or arrange a meetup for ${input.sizeClass} items.`,
      );
    }
  }

  if (input.path === 'full_service' && !FULL_SERVICE_SIZES.includes(input.sizeClass)) {
    reasons.push(`Oversize items cannot be handled by the delivery rail — arrange a meetup.`);
  }

  // meetup_only removes both custody rails.
  const restricted = [...(input.buyerRestrictions ?? []), ...(input.sellerRestrictions ?? [])];
  if (restricted.includes('meetup_only') && (input.path === 'relay' || input.path === 'full_service')) {
    reasons.push('One party is currently restricted to meetup-only deals.');
  }

  return { eligible: reasons.length === 0, reasons };
}

/** Narrow a seller's declared paths down to the ones actually usable for this deal. */
export function availablePaths(
  declared: readonly FulfillmentPath[],
  ctx: Omit<EligibilityInput, 'path'>,
): FulfillmentPath[] {
  return declared.filter((path) => checkEligibility({ ...ctx, path }).eligible);
}
