/**
 * Database-free Milestone 0/1/2/3/4/5/6 preflight.
 *
 * This deliberately checks only repository contracts that can be verified without
 * Postgres, object storage, a worker, or provider credentials. It is useful when the
 * local Docker daemon is unavailable; it must not be presented as an end-to-end check.
 *
 * Run with: npm run verify:offline
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  const path = join(root, relativePath);
  if (!existsSync(path)) throw new Error(`missing ${relativePath}`);
  return readFileSync(path, 'utf8');
}

function contains(relativePath: string, ...needles: string[]): void {
  const source = read(relativePath);
  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`${relativePath} is missing required contract: ${needle}`);
    }
  }
}

type Check = { label: string; run: () => void };

const checks: Check[] = [
  {
    label: 'v1 product scope is present',
    run: () => contains('COLLECTTT_PRODUCT_SCOPE.md', '# CollectTT Product Scope and Implementation Specification', '## 1. Purpose'),
  },
  {
    label: 'launch gate defaults safely to v1',
    run: () => contains('src/lib/launch-scope.ts', "process.env.COLLECTTT_LAUNCH_SCOPE === 'legacy' ? 'legacy' : 'v1'", 'assertV1ListingTerms'),
  },
  {
    label: 'listing writes enforce identity and v1 terms',
    run: () => contains('src/services/listings.ts', "'persist_listing'", 'assertMarketplaceEligible', 'assertV1ListingTerms'),
  },
  {
    label: 'reservation and bid writes enforce the launch gate',
    run: () => {
      contains('src/db/atomic/claim-listing.ts', 'assertMarketplaceEligible', 'assertV1ListingTerms');
      contains('src/db/atomic/place-bid.ts', 'assertMarketplaceEligible', 'assertV1ListingTerms');
      contains('src/services/transactions.ts', 'acquireCommitmentEligibility');
    },
  },
  {
    label: 'offers stay in v1 while Store custody remains legacy-only',
    run: () => {
      contains('src/services/offers.ts', "assertLegacyFeatureAllowed('offers')");
      contains('src/app/admin/stores/actions.ts', "assertLegacyFeatureAllowed('store_custody')", 'requireAdminAction');
      const scope = read('src/lib/launch-scope.ts');
      if (!scope.includes("if (feature === 'offers') return true;")) {
        throw new Error('launch scope must explicitly keep fixed-price offers available in v1');
      }
      if (scope.includes("feature === 'store_custody' || feature === 'offers'")) {
        throw new Error('launch scope must not allow Store custody in v1');
      }
    },
  },
  {
    label: 'launch product includes offers and the simplified cash meetup action',
    run: () => {
      contains('COLLECTTT_PRODUCT_SCOPE.md', '### 8.3 Fixed-price offers', '### 10.3 Cash meetup flow', 'I paid and collected the item');
      contains('src/services/offers.ts', 'commitmentAcknowledged: true');
      contains('src/app/deals/[id]/actions.ts', 'completeCashMeetupAction', 'completeCashMeetup(tx, id, user.userId)');
      contains('src/app/deals/[id]/page.tsx', 'completeCashMeetupAction', 'I paid and collected the item');
    },
  },
  {
    label: 'public Store routes are hidden in v1',
    run: () => {
      for (const route of ['src/app/store/page.tsx', 'src/app/store/[storeId]/page.tsx', 'src/app/store/apply/page.tsx']) {
        contains(route, "isLegacyFeatureAllowed('store_custody')", 'notFound()');
      }
    },
  },
  {
    label: 'onboarding requires a private phone without a verification flow',
    run: () => {
      contains('src/app/sign-in/auth-panel.tsx', 'name="phone"', '/api/profile/onboarding');
      contains('src/services/account-profile.ts', 'normalizePhoneE164', 'setInitialOnboardingProfile');
      contains('src/services/marketplace-eligibility.ts', "'phone_required'", 'Add your mobile number');
    },
  },
  {
    label: 'deployment configuration keeps v1 as the default',
    run: () => {
      contains('.env.example', 'COLLECTTT_LAUNCH_SCOPE="v1"');
      contains('render.yaml', 'key: COLLECTTT_LAUNCH_SCOPE', 'value: v1');
      contains('src/lib/env.ts', 'Production requires APP_URL to be set explicitly.');
      const render = read('render.yaml');
      const worker = render.slice(render.indexOf('name: collecttt-worker'));
      if (!worker.includes('key: APP_URL') || !worker.includes('same public URL configured on collecttt-web')) {
        throw new Error('render.yaml worker is missing the public APP_URL contract');
      }
    },
  },
  {
    label: 'focused offline tests exist for the new contracts',
    run: () => {
      for (const test of ['tests/domain/launch-scope.test.ts', 'tests/domain/account-profile.test.ts', 'tests/security/identity-privacy.test.ts']) {
        read(test);
      }
    },
  },
  {
    label: 'listing terminal states and seller reuse contracts are present',
    run: () => {
      contains('src/domain/states/listing.ts', "'sold_outside'", 'expired: []', 'active->sold_outside');
      contains('src/db/schema/seller-settings.ts', 'sellerMeetupLocations', 'sellerMarketplacePreferences');
      contains('src/services/listings.ts', 'duplicateListingToDraft', 'relistListing', 'markListingSoldOutside');
    },
  },
  {
    label: 'fixed-price expiry is transactionally scheduled',
    run: () => {
      contains('src/db/schema/listings.ts', 'expiresAt', 'listings_fixed_price_expiry');
      contains('drizzle/0024_left_morlun.sql', "ADD VALUE 'sold_outside'", 'ADD COLUMN "expires_at"');
      contains('src/jobs/tasks/listing-expiry.ts', "status: 'expired'", 'listing_expired_seller');
      contains('src/jobs/tasks/index.ts', "'listing:expire'", 'listingExpiry');
    },
  },
  {
    label: 'browse defaults and keyset cursor contracts are present',
    run: () => {
      contains('src/app/listings/page.tsx', 'const saleType = requestedSaleType;', "saleType === 'auction' ? 'ending_soon'", 'nextCursor');
      contains('src/services/listings.ts', 'cursor?: string', 'encodeBrowseCursor', 'browseCursorCondition');
    },
  },
  {
    label: 'fixed-price commitment is deliberate, durable, and v1-scoped',
    run: () => {
      contains('src/db/atomic/claim-listing.ts', 'commitmentAcknowledged', 'meetupLocationId', "isLegacyFeatureAllowed('offers')", "'listing_unavailable'");
      contains('src/db/schema/listings.ts', 'meetupLocationId');
      contains('src/db/schema/transactions.ts', 'meetupLocationId');
      contains('src/app/listings/[id]/page.tsx', 'commitmentAcknowledged', 'Reserve / buy now', 'errorCode');
      contains('src/app/listings/[id]/actions.ts', 'commitment_confirmation_required');
      contains('src/services/marketplace-eligibility.ts', "'active_commitment_limit'");
      contains('drizzle/0025_shallow_prima.sql', 'ADD COLUMN "meetup_location_id"', 'UPDATE "transactions"');
      read('tests/flows/trading-loop.test.ts');
    },
  },
  {
    label: 'direct transaction workflow, evidence, deadlines, and dispute contracts are present',
    run: () => {
      contains('src/domain/states/handoff.ts', 'HANDOFF_STATES', 'seller_handed_over', 'buyer_received');
      contains('src/services/transactions.ts', 'markItemHandedOver', 'confirmItemReceived', 'extendPaymentDeadline', 'receipt_window');
      contains('src/services/disputes.ts', "disputeState: 'open'", 'transactionEvents');
      contains('src/db/schema/transaction-evidence.ts', 'transaction_evidence', 'storageKey', 'status');
      contains('src/lib/storage.ts', 'evidenceBucket', 'bucketName');
      contains('src/services/transaction-evidence.ts', 'evidenceBucket()', 'bucketName');
      contains('.env.example', 'STORAGE_EVIDENCE_BUCKET', 'collecttt-evidence');
      contains('src/app/deals/[id]/page.tsx', 'Payments made directly to another user are not protected by CollectTT.', 'EvidenceUpload');
      contains('src/jobs/tasks/index.ts', "'transaction:receipt_window'", 'reminderKind');
      contains('drizzle/0026_parallel_pretty_boy.sql', 'handoff_state', 'transaction_evidence');
      read('drizzle/0027_sharp_kulan_gath.sql');
      contains('drizzle/0028_wide_grandmaster.sql', 'dispute_state', 'tx_completion_requires_both');
    },
  },
  {
    label: 'binding auctions and explicit fallback offers are present',
    run: () => {
      contains('src/db/schema/auction-fallback-offers.ts', 'auctionFallbackOffers', 'expiresAt', 'fallbackOfferStatusEnum');
      contains('drizzle/0029_auction_fallback_offers.sql', 'fallback_offer_status', 'auction_fallback_offers', 'auction_fallback_one_pending_listing');
      contains('src/db/atomic/place-bid.ts', 'commitmentAcknowledged', 'commitment_confirmation_required');
      contains('src/services/listings.ts', 'AUCTION_DURATION_HOURS', 'available auction lengths');
      contains('src/services/transactions.ts', 'acceptAuctionFallbackOffer', 'expireAuctionFallbackOffer', 'auction:fallback_expire', 'invalidateAuctionBid');
      contains('src/jobs/tasks/index.ts', "'auction:fallback_expire'", 'fallbackOfferExpired');
      contains('src/app/listings/[id]/page.tsx', 'acceptFallbackOfferAction', 'Accept fallback offer');
      contains('src/app/admin/actions.ts', 'invalidateAuctionBidAction', 'invalidateAuctionBid');
      read('src/notifications/events.ts');
    },
  },
  {
    label: 'trust scopes, progressive restrictions, and private support cases are present',
    run: () => {
      contains('src/domain/policy/reputation.ts', "'reserve_blocked'", "'publish_blocked'", 'buyerRestrictionsWithThresholds');
      contains('src/services/platform-settings.ts', 'getRestrictionPolicy', 'RESTRICTION_DURATION_HOURS_KEY', 'setRestrictionPolicySetting');
      contains('src/services/reputation.ts', 'restriction_warning', 'PUBLIC_REPUTATION_EVENT_TYPES', 'successfulAuctions');
      contains('src/services/marketplace-eligibility.ts', 'reserve_blocked', 'publish_blocked');
      contains('src/db/schema/support-cases.ts', 'supportCases', 'reporterUserId', 'targetType');
      contains('drizzle/0031_trust_restrictions_support.sql', 'support_cases', 'reserve_blocked', 'publish_blocked');
      contains('drizzle/0033_restriction_lifecycle_audit.sql', 'source_event_id', 'source_actor_user_id', 'lifecycle_status');
      contains('src/db/schema/profiles.ts', 'sourceEventId', 'sourceActorUserId', 'lifecycleStatus');
      contains('src/services/support-cases.ts', 'createSupportCase', 'updateSupportCase');
      contains('src/app/admin/support/page.tsx', 'Support cases', 'Reporter identity is visible only to administrators');
      contains('src/app/admin/actions.ts', 'updateSupportCaseAction', 'update_support_case');
      contains('src/app/admin/actions.ts', 'cancelDealAction', 'removeListingAction', 'reactivateListingAction', 'addTrustAdjustmentAction');
      contains('src/app/members/[id]/page.tsx', 'Successful auctions');
    },
  },
];

let failures = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`PASS  ${check.label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${check.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} offline preflight check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS — ${checks.length} database-free Milestone 0/1/2/3/4/5/6 checks passed.`);
  console.log('Pending outside this preflight: run Postgres-backed acceptance flows, browser checks, and smoke-test provider delivery.');
}
