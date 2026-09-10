import type { FulfillmentPath } from '../states/transaction';

export interface EligibilityInput {
  path: FulfillmentPath;
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
