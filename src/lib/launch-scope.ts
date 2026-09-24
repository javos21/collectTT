/**
 * The single release gate for marketplace features that remain outside the v1 path.
 *
 * v1 is the default. `COLLECTTT_LAUNCH_SCOPE=legacy` is an explicit rollback/test
 * switch for features that remain outside the current marketplace. Fixed-price
 * offers and store custody are supported in v1.
 */

export const LAUNCH_SCOPES = ['v1', 'legacy'] as const;
export type LaunchScope = (typeof LAUNCH_SCOPES)[number];

export const LEGACY_FEATURES = [
  'offers',
  'store_custody',
  'reserve_price',
  'auction_buyout',
  'pro',
  'raffle',
] as const;
export type LegacyFeature = (typeof LEGACY_FEATURES)[number];

export const V1_ALLOWED_FULFILLMENT_PATHS = ['cash_meetup', 'remote_ship', 'relay', 'full_service'] as const;

/** Provisional platform policy from the product scope; keep it centralized. */
export const V1_PAYMENT_WINDOW_HOURS = 72;
/** Buyer receipt confirmation window after the seller marks a meetup hand-off. */
export const V1_HANDOFF_CONFIRMATION_WINDOW_HOURS = 48;

export class V1ScopeError extends Error {
  readonly feature: LegacyFeature;

  constructor(feature: LegacyFeature, message?: string) {
    super(message ?? `${featureLabel(feature)} is not available for v1.`);
    this.name = 'V1ScopeError';
    this.feature = feature;
  }
}

function featureLabel(feature: LegacyFeature): string {
  return feature
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

/** Read dynamically so tests and controlled worker rollbacks can set the flag. */
export function launchScope(): LaunchScope {
  return process.env.COLLECTTT_LAUNCH_SCOPE === 'legacy' ? 'legacy' : 'v1';
}

export function isV1Launch(): boolean {
  return launchScope() === 'v1';
}

export function isLegacyFeatureAllowed(feature: LegacyFeature): boolean {
  // Fixed-price offers and the staffed Store custody flow are deliberately
  // first-class in v1. The remaining legacy rails stay behind the explicit switch.
  if (feature === 'offers' || feature === 'store_custody') return true;
  return !isV1Launch();
}

export function assertLegacyFeatureAllowed(feature: LegacyFeature): void {
  if (!isLegacyFeatureAllowed(feature)) throw new V1ScopeError(feature);
}

export function assertV1ListingTerms(input: {
  fulfillmentPaths: readonly string[];
  settlementMethods: readonly string[];
  acceptsOffers?: boolean;
  reserveCents?: number | null;
  buyoutCents?: number | null;
}): void {
  if (!isV1Launch()) return;

  const unsupportedPath = input.fulfillmentPaths.find(
    (path) => !(V1_ALLOWED_FULFILLMENT_PATHS as readonly string[]).includes(path),
  );
  if (unsupportedPath !== undefined) {
    throw new V1ScopeError(
      'store_custody',
      'This delivery method is not currently available for new listings.',
    );
  }

  if (input.reserveCents !== undefined && input.reserveCents !== null) {
    throw new V1ScopeError('reserve_price', 'Reserve prices are not available in v1 auctions.');
  }
  if (input.buyoutCents !== undefined && input.buyoutCents !== null) {
    throw new V1ScopeError('auction_buyout', 'Auction buyouts are not available in v1.');
  }
}
