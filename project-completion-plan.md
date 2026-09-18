# CollectTT v1 implementation and completion plan

**Status:** Milestone 0 is locally complete with product-owner review pending. Milestones
1–3 are Docker-verified locally; Milestone 4's direct transaction slice is Docker-verified
locally. Render staging, storage/provider, and browser verification remain before the
release exit gate.

This plan is subordinate to [COLLECTTT_PRODUCT_SCOPE.md](COLLECTTT_PRODUCT_SCOPE.md),
the authoritative v1 product specification. It replaces the earlier beta/custody
completion plan while preserving its implementation history in git.

## Release contract

CollectTT v1 is a free Trinidad & Tobago collectibles marketplace. The vertical loop is
List → Discover → Commit → Transact → Build Trust → Repeat.

Required v1 capabilities:

- separate private account name and public display name;
- required private phone number collected during onboarding;
- manual fixed-price and auction listings, drafts, duplicate/relist, expiration, and
  Sold outside CollectTT;
- deterministic browse/search/filtering;
- seller-defined cash-meetup and direct bank-transfer choices;
- atomic reservations, binding bids, repeated two-minute anti-sniping, deadlines,
  disputes, progressive restrictions, transactional email, and audited admin actions;
- factual Trust Snapshots, contextual support/reporting, privacy and authenticity
  disclaimers.

Fixed-price offers/price negotiation are supported in v1. Explicitly outside v1:
Store applications/staff/custody entry points, reserve prices, auction buyouts, proxy bids, self-service bid retraction,
seller-authored payment windows, ratings/reviews/numerical scores, Pro, raffles,
Featured Listings, Collect Protect, SMS/WhatsApp, chat, payment holding, KYC,
recommendation feeds, bulk imports, inventory suites, storefront customization,
bank-account storage, automatic counterfeit takedowns, and impersonation.

Legacy tables and records are retained for inspection. The single
COLLECTTT_LAUNCH_SCOPE flag defaults to v1 and blocks new writes into legacy paths;
legacy is a controlled rollback/test mode only.

## Milestone dashboard

| Milestone | Focus | Status | Exit evidence |
| --- | --- | --- | --- |
| 0 | Freeze v1 and quarantine legacy scope | Offline-complete; owner review pending | Scope committed, docs reconciled, launch gate enforced, route/state inventory reviewed, legacy records preserved. |
| 1 | Identity, eligibility, and privacy foundation | Docker-verified; staging/provider pending | Migration applied to local Docker Postgres, full suite passes, Render staging migration and OTP provider smoke test remain. |
| 2 | Listing lifecycle and discovery | Docker-verified; staging pending | Seller defaults/meetups, draft/resume, duplicate/relist, sold-outside, fixed expiration, location filtering, all-type browse, auction Ending Soon, and keyset cursor support are implemented; local acceptance coverage passes, while staging verification remains. |
| 3 | Commitment and transaction workflows | Docker-verified locally; staging pending | Fixed-price Reserve / buy acknowledgement, durable meetup/payment choices, atomic commitment cap, structured unavailable/restricted outcomes, and retry-safe reservation path. |
| 4 | Direct transaction workflows, evidence, deadlines, and disputes | Docker-verified locally; staging/provider pending | Cash hand-off/receipt and auto-completion, bank-transfer evidence authorization, direct-payment disclaimer, reminder/expiry scheduling, dispute pause, support deadline extension, and audited dispute outcomes. |
| 5 | Auction close, fallback, and trust | Development-complete locally; acceptance tests pending | Binding bid acknowledgement, anti-sniping, winner default, explicit expiring runner-up offers, admin bid invalidation, and ladder recomputation are implemented; Docker migration is applied, while acceptance/browser checks remain. |
| 6 | Admin, support, notifications, and launch operations | Development-complete locally; acceptance/operations pending | Independent trust restriction scopes, configurable progressive policy, factual public snapshots, private contextual support cases, audited trust/listing/support interventions, and seller notifications are implemented; provider health, monitoring, backups/restore, legal review, and staged beta remain. |

## Milestone 0 — freeze and quarantine

- [x] Copy the attached product specification into the repository.
- [x] Rewrite README and PRODUCT around the marketplace v1 contract.
- [x] Mark the old product-design and Phase 2 custody documents historical.
- [x] Add one v1/legacy launch flag with v1 as the safe default.
- [x] Reject prohibited fulfillment, payment, offer, reserve, buyout, and seller-window
      inputs in the listing service.
- [x] Hide Store entry/application/counter routes in v1 and reject their server writes.
- [x] Hide offer creation/accept/reject controls in v1 while retaining historical reads.
- [x] Add the route/state inventory covering public, member, admin, API, and legacy routes.
- [ ] Review the inventory with the product owner and approve any open policy values.

## Milestone 1 — identity, eligibility, and privacy

Implemented in the current worktree:

- private account name and public display name onboarding/editing;
- phone normalization, hashed six-digit OTPs, expiry, attempt limits, consumed state,
  console/Brevo SMS adapters, and account UI;
- server-side eligibility gates for listing, publish, reserve, bid, and commitment;
- one active reservation/commitment guard for new buyers;
- party-only post-commitment phone disclosure and audited admin access;
- focused phone, identity/privacy, and trading-flow tests.

Still required for the full Milestone 1 release exit gate:

- apply the generated Drizzle migration to the intended Render staging database;
- run `npm run db:migrate` against the intended database target; the script is
  environment-driven and serializes concurrent Render web/worker starts;
- exercise console and Brevo provider paths without exposing secrets;
- validate all listing/bid/claim/deal endpoints with browser and direct-object tests;
- decide retention windows for phone challenges, disclosures, and audit data.

Verification completed locally: `npm test` (20 files, 216 tests), `npm run typecheck`,
`npm run build`, `npm run verify:offline`, `npx drizzle-kit check`, and `git diff --check`.
The Render staging database and production Brevo delivery path remain untouched.

## Dependency-ordered implementation plan

### 2. Listing lifecycle and discovery

Implement drafts, duplicate/relist into a new record, Sold outside CollectTT, fixed-price
expiration, global title/description search, required filters, stable pagination, and
platform-configured auction durations. Keep legacy listing states readable and never
rewrite history. Add service/UI/API authorization, worker jobs, analytics events, and
acceptance tests for relisting, expiration, and deterministic browsing.

### 3. Commitment and transaction

Align the existing granular payment/custody implementation with the v1-equivalent
transaction lifecycle. Implement deliberate reservation confirmation, cash handoff and
receipt milestones, bank-transfer evidence-only uploads, seller confirmation of cleared
funds, platform deadlines/reminders/expiry, support extensions, dispute pause, and
contextual reporting. Preserve direct-payment disclaimers and event timelines. Prove
concurrency, retry idempotency, and objective expiry with database-backed tests.

### 4. Auctions and behavioral trust

Keep binding bids and server-authoritative anti-sniping. Remove buyout/reserve/proxy
inputs from new v1 rows. Make close/winner/default/fallback idempotent; the next bidder
must explicitly accept before a new transaction is created. Add factual Trust Snapshot
fields, adjudicated recent issues, progressive restriction policy tables, and admin
controls with audit reasons.

### 5. Admin and launch operations

Finish listing/member/deal moderation actions, report/support queue, evidence access,
deadline extension, restriction and trust-event correction, notification health, and
immutable audit coverage. Keep historical custody/store views admin-only. Verify email
dedupe/retry, monitoring, backups/restore, migration rehearsal, legal copy, and staged
alpha → trusted pilot → invite-only beta gates.

## Verification checklist

For every slice, verify:

- user-visible happy, empty, loading, validation, permission, and failure states;
- server/API authorization and direct-object denial;
- schema constraints and migration rollback/data-retention impact;
- worker scheduling, retry safety, and idempotency;
- email event, dedupe key, and delivery failure behavior;
- admin audit actor/target/reason/before-after records;
- mobile keyboard/focus/contrast behavior;
- focused tests, typecheck, production build, and git diff check.

Current safe checks: `npm run typecheck`, `npm run build`, `npm run verify:offline`,
`npx drizzle-kit check`, `git diff --check`, and the full Docker-backed suite pass in
this worktree (20 files, 216 tests). Render staging/provider/browser checks remain
outside this local verification.
