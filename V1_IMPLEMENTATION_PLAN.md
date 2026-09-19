# CollectTT v1 Gap Analysis and Implementation Plan

**Status:** Active execution baseline — Milestones 0–7 are locally implemented; Milestone 8 local launch-candidate hardening is complete, with staging/provider/legal/restore/beta exits pending  
**Compared:** COLLECTTT_PRODUCT_SCOPE.md v1.0 (2026-09-12) against the repository working tree  
**Prepared:** 2026-09-12  
**Scope:** v1 only unless a section is explicitly labeled v1.5 or deferred

> This gap analysis records the pre-Milestone 0 comparison. Some file/line references
> intentionally describe the superseded baseline; the reconciled documents and launch
> gate below are the current implementation authority.

## 1. Executive summary

The new product scope is a meaningful product correction, but it does not require a ground-up rewrite. The repository already has a strong technical base: a Next.js web process, a Postgres-backed worker, transactionally enqueued jobs, atomic fixed-price claims and bids, server-authoritative auction deadlines, append-only transaction and administrator events, category-driven listing fields, image uploads, transactional email, and protected admin routes.

The work is nevertheless **large** because several existing domain rules directly conflict with the new v1:

- The current product calls itself a coordination layer rather than a marketplace and makes Store custody a central product rail.
- A fixed-price purchase is called a claim; offers and seller acceptance are supported.
- Cash meetups use one buyer action after the physical exchange: the buyer confirms
  they paid and collected the item, and the server records payment and receipt
  atomically. The older handoff/receipt handshake remains readable for legacy rows.
- Auctions support buyouts and reserve prices.
- A defaulting auction winner is automatically replaced by the next bidder, who is immediately committed.
- Users choose seller-authored payment windows.
- Required onboarding phone collection, action gating for missing legacy contact data, and post-commitment phone disclosure do not exist.
- Fixed-price expiration, duplicate-to-draft, relist-to-new-record, and sold-outside-CollectTT are absent.
- Disputes create support records but do not suspend the transaction or its expiry job.
- The admin console can inspect much of the domain, but cannot perform most required interventions.

The recommended approach is to **keep the infrastructure and replace behavior at existing seams**. In particular, retain the database/worker/notification architecture and the atomic SQL paths, while reshaping the listing lifecycle, commitment rules, direct transaction milestones, auction fallback, identity verification, and admin commands.

### Overall effort

Assuming one experienced full-stack engineer familiar with the repository:

| Estimate | Scope |
|---|---|
| **16–23 engineer-weeks** | Product-complete v1 implementation |
| **3–5 additional weeks** | Launch hardening, browser/accessibility coverage, provider verification, migration rehearsal, monitoring, and pilot fixes |
| **19–28 engineer-weeks total** | Realistic public-launch range |

With two engineers, the dependency structure allows some parallel work after the domain migrations settle, but the result is closer to **11–16 calendar weeks**, not half the single-engineer duration. Legal review, phone-provider onboarding, and production-data remediation are external to these estimates.

This estimate is **high difficulty**. The difficulty comes from concurrency, privacy, migration, and lifecycle correctness rather than raw screen count.

## 2. Source-of-truth decision

The attached product scope should become the v1 product authority. The following existing documents conflict with it and should be marked historical or rewritten before implementation work begins:

- README.md describes CollectTT as “not a marketplace” and Store custody as live launch scope (README.md:3-20).
- PRODUCT.md identifies Store owners/staff as users, Store custody as positioning, and Pro/raffles as MVP scope (PRODUCT.md:9-63).
- product-design-document.md makes physical custody a trust anchor and includes ratings, offers, reserve/buyout auctions, Pro, raffles, and Store operations (product-design-document.md:11-68).
- project-completion-plan.md explicitly says not to replace the existing state-machine design and still uses retained custody in its beta gates (project-completion-plan.md:111-148, 329-375).

These are documentation conflicts, not authorization to preserve the old behavior.

## 3. What should be retained

The following modules have useful depth and should be evolved rather than bypassed:

| Existing foundation | Evidence | Decision |
|---|---|---|
| Web plus persistent worker plus Postgres | README.md:83-118; src/jobs/worker.ts:87-132 | **Retain** |
| Transactional job enqueue and retry model | src/notifications/dispatch.ts:78-156; src/jobs/tasks/transaction-windows.ts:1-8 | **Retain** |
| Atomic fixed-price winner selection | src/db/atomic/claim-listing.ts:196-275 | **Retain and rename at the interface** |
| Atomic bidding and server-time anti-sniping | src/db/atomic/place-bid.ts:151-203; src/jobs/tasks/auction-close.ts:42-57 | **Retain and tighten** |
| One open transaction per listing | src/db/schema/transactions.ts:101-106 | **Retain; include disputed transactions in the invariant** |
| Append-only transaction events | src/db/schema/transactions.ts:152-172 | **Retain and expand** |
| Append-only admin audit | src/db/schema/admin-audit.ts:1-36; src/services/admin-audit.ts:18-40 | **Retain** |
| Category registry and validated JSON attributes | src/domain/categories/definitions.ts:1-110; src/services/listings.ts:39-101 | **Retain and extend only where v1 requires** |
| Image pipeline | src/app/listings/new/image-uploader.tsx; src/app/api/images | **Retain** |
| Email delivery ledger and dedupe key | src/db/schema/notifications.ts:53-80; src/jobs/tasks/dispatch-notification.ts:24-98 | **Retain and expand event coverage** |
| Server-side admin authorization | src/lib/admin.ts:14-49 | **Retain** |
| Objective reputation event source of truth | src/db/schema/profiles.ts:62-87 | **Retain and revise public projection/policy** |

The core architectural seam should remain: user-facing actions call a small domain interface, which owns authorization, invariants, events, jobs, notifications, and idempotency in one transaction.

## 4. Major differences and effort

Effort assumes implementation, migrations, UI, notifications, and meaningful automated coverage.

| Area | Current behavior | Required v1 behavior | Status | Difficulty / effort |
|---|---|---|---|---|
| Product position | “Not a marketplace”; Store custody is central | Free structured marketplace; ordinary payments remain direct; Store custody is not v1 | **Conflicting** | Medium, 3–5 days for docs/navigation/feature flags; legacy data makes deletion a later concern |
| Identity names | Signup username becomes both display name and generated public handle | Separate private account name and public display name | **Conflicting** | Medium, 4–7 days |
| Private phone contact | Column exists, but onboarding does not collect it and no marketplace gate exists | Phone required during onboarding and for marketplace actions; disclosed only after commitment | **Missing** | Medium, 3–5 days |
| Seller defaults | Admin-managed global delivery/payment choices; no seller preference store | Reusable seller meetup locations and default payment/meetup choices | **Missing** | Medium, 1–1.5 weeks |
| Required listing data | Category attributes and images exist; description is nullable in the service; store/delivery rails exceed scope | Description, category/game, condition, image, price/auction duration, meetup and payment options | **Partial / conflicting** | Medium, 1–1.5 weeks |
| Drafts | Service can create drafts, but the only creation action always publishes | Save and resume drafts | **Partial** | Medium, 3–5 days |
| Duplicate and relist | Failed transactions may reactivate the same listing record | Duplicate/relist into a distinct editable draft preserving media/details | **Conflicting / missing** | Medium, 4–7 days |
| Sold outside | No dedicated terminal state or action | Terminal SOLD_OUTSIDE without verified transaction history | **Missing** | Low-medium, 2–4 days |
| Fixed-price expiry | No listing-lifetime field or expiry job | Configured automatic expiry, seller email, quick relist | **Missing** | Medium, 4–6 days |
| Listing edit locks | All listings lock after any bid, active claim, or open transaction | Fixed-price editable until reserved; auction editable until first valid bid | **Mostly implemented** | Low, 1–3 days plus tests |
| Offers/negotiation | Active fixed-price offer flow with seller accept/reject | Supported for fixed-price listings | **Implemented** | Preserve existing flow and acceptance coverage |
| Discovery default | Unfiltered browse defaults to fixed-price only; Newest sort | General marketplace should include all sale types; auction view emphasizes Ending Soon | **Partial / conflicting** | Low, 1–2 days |
| Search and filters | Title/description search; category, category fields, price, delivery, payment; offset paging | Add location and dependable set/condition behavior; stable pagination | **Partial** | Medium, 4–7 days |
| Reservation UX | Buyer submits a claim form; no explicit commitment acknowledgement | Strong deliberate purchase confirmation | **Partial** | Low-medium, 2–4 days |
| Reservation concurrency | One conditional update selects a single buyer | Exactly one reservation and transaction | **Implemented** | Preserve; add v1 acceptance coverage |
| New-buyer commitment cap | No cross-listing active-reservation gate | At most one active reservation for a new buyer | **Missing** | High, 3–5 days because the check must be concurrency-safe |
| Contact disclosure | Deal pages never fetch participant phones | Reveal both private phone numbers immediately after valid reservation/settlement, only to parties/admin | **Missing** | High, 4–7 days including direct-object tests |
| Cash meetup lifecycle | Seller payment confirmation completes a P2P transaction | Buyer confirms **I paid and collected the item** once; payment and receipt complete atomically | **Implemented** | Preserve idempotency, dispute handling, and legacy-row readability |
| Bank transfer lifecycle | Mark-paid and seller-confirm-payment exist; confirmation completes direct transactions | Optional evidence, clear disclaimer, cleared-funds confirmation, then handoff/receipt | **Partial / conflicting** | High, 1.5–2.5 weeks |
| Evidence uploads | Listing images only | Private transaction evidence with strict authorization | **Missing** | High, 4–7 days |
| Transaction states | One OPEN rollup plus payment/custody tracks; no disputed rollup | Required actions, in-progress, confirmation, disputed pause, terminal outcomes or equivalent | **Partial / conflicting** | High, 2–3 weeks; can evolve tracks rather than flattening |
| Deadlines | Listing-author payment window; one reminder around 66%; expiry does not check support disputes | Platform policy; reminders at 50%, 2 hours, and deadline; dispute pause; admin extension | **Conflicting** | High, 1–2 weeks |
| Auction durations | Predefined UI values, but service accepts any 1–336 hours | Platform-defined configured values | **Partial** | Low-medium, 2–3 days |
| Auction reserve and buyout | Schema and close/bid logic support both | Both prohibited in v1 | **Conflicting** | Medium, 3–5 days; freeze legacy rows |
| Bid confirmation | Choice form directly places bid | Explicit binding-commitment confirmation | **Partial** | Low-medium, 2–4 days |
| Anti-sniping | Atomic repeating 2-minute extension; close job re-reads effective end | Same, plus relevant extension email | **Core implemented; notification missing** | Low-medium, 2–4 days |
| Auction close | Idempotent winner transaction creation | Same | **Implemented with legacy options** | Preserve and retest after state changes |
| Runner-up fallback | Next eligible bidder is immediately promoted into an open transaction | Send a time-limited offer; explicit acceptance creates transaction | **Conflicting** | High, 1.5–2 weeks |
| Trust Snapshot | Member since, purchases, sales, paid-on-time and public raw issue counters | Purchases, sales, successful auctions, adjudicated/objective recent issues; no composite score/reviews | **Partial** | Medium, 4–7 days |
| Restrictions | Automatic thresholds and admin actions exist; scopes include legacy prepay/meetup concepts; creation gate is incomplete | Progressive warning/restriction policy with independent buy, bid, and listing scopes | **Partial / conflicting** | High, 1–2 weeks |
| Reporting | Transaction dispute exists | Contextual reports/support for listing, auction, transaction, and account; private reporter/evidence | **Partial** | High, 1–2 weeks |
| Dispute effect | Support row only; transaction remains open and expiry continues | Suspend auto-completion and blame until adjudication | **Conflicting** | High, included in transaction refactor |
| Admin inspection | Good read views for members, listings, deals, events, custody, notifications, and audit | Broader complete history/evidence/reports | **Partial** | Medium |
| Admin intervention | Dispute close, member status/restrictions, email retry; no transaction cancel/extend, listing removal/reactivation, bid invalidation, trust correction | Full guided audited intervention set | **Mostly missing** | High, 2–3 weeks |
| Notifications | Email/in-app framework is robust; required event catalogue is incomplete; preferences are not enforced | Required transactional email set, retry-safe and deduplicated | **Partial** | Medium-high, 1–1.5 weeks |
| Privacy/legal | Deal authorization exists; required disclaimers/pages are missing; contact boundary unimplemented | All sensitive objects authorized; authenticity/direct-payment notices; legal pages and retention rules | **Partial / missing** | High, 1–2 weeks plus legal review |
| Analytics/operations | Admin counts and delivery logs exist; no defined product analytics or production error monitoring | v1 funnel/outcome metrics and launch monitoring | **Mostly missing** | Medium, 1–2 weeks |
| Featured Listings | Not implemented | v1.5 only | **Correctly absent** | No v1 work |

## 5. Critical acceptance scenarios

| Scenario | Result today | Evidence / gap |
|---|---|---|
| A. Concurrent reservation | **Implemented** | Conditional listing update and one-open-transaction constraint; tests exercise six simultaneous claims (src/db/atomic/claim-listing.ts:196-275; tests/flows/trading-loop.test.ts:133-170) |
| B. New-buyer limit | **Missing** | No active commitment count or concurrency guard in claim/bid paths |
| C. Cash meetup completion | **Conflicting** | Cash uses custody NOT_APPLICABLE and seller payment confirmation auto-completes (src/services/transactions.ts:395-402) |
| D. Bank-transfer evidence | **Partial** | Mark sent and seller confirmation exist; evidence and disclaimer-specific handling do not |
| E. Deadline expiry | **Partial / conflicting** | Idempotent termination and release exist, but reminder policy differs and open disputes do not pause jobs |
| F. Dispute before auto-completion | **Conflicting** | A dispute is explicitly “not a direct transaction-state mutation” (src/services/disputes.ts:1-6) |
| G. Auction anti-sniping | **Core implemented** | Atomic deadline extension and re-reading close job exist; required extension email is absent |
| H. Auction edit lock | **Partial** | Seller lock exists; audited admin auction intervention does not |
| I. Winner fallback | **Conflicting** | Promotion immediately opens the next transaction instead of an explicit offer (src/services/transactions.ts:751-868) |
| J. Phone privacy | **Missing** | Profile phone columns exist but member verification, disclosure interface, and access tests do not |
| K. Report moderation | **Partial** | Transaction disputes exist; general contextual cases, evidence, assignment, listing/account actions are missing |
| L. Relist history | **Missing / conflicting** | Current state model allows terminal listing reactivation; no copy-to-new-draft workflow |
| M. Featured lifecycle | **Not applicable to v1** | Correctly defer to v1.5 |

## 6. Security, privacy, concurrency, and integrity priorities

These are launch blockers, not cleanup:

1. **Commitment cap must be atomic.** A read-then-write count can allow two simultaneous reservations. Enforce the new-buyer cap using a transaction-scoped advisory lock or a dedicated active-commitment slot with a unique constraint.
2. **Disputed must count as active.** If the transaction state becomes DISPUTED, the one-active-transaction index and listing reservation rules must include it. Otherwise a disputed listing can be sold twice.
3. **Contact disclosure needs one interface.** Introduce a small authorized contact-disclosure module that returns counterparty contact only when the viewer is a participant in the active/settled transaction or an authorized admin. Do not expose phone fields through general profile projections.
4. **Evidence must be private by default.** Use distinct storage keys and an authenticated download route; do not reuse public listing-image delivery behavior.
5. **Expiry and close jobs must re-read authoritative state.** Every job should no-op for stale deadlines, disputed cases, already-completed transitions, or superseded fallback offers.
6. **Runner-up acceptance must not create two buyers.** Offer acceptance should atomically verify offer eligibility, transaction absence, listing reservation ownership, and expiry before creating the transaction.
7. **Admin commands must share one guard.** Every high-impact command must validate role, state/version, reason, and idempotency and write its audit event in the same transaction.
8. **Legacy workflow data must remain readable.** Do not reinterpret historic custody, offer, reserve-price, or buyout rows as though they followed v1 rules.

## 7. Proposed domain model and module seams

Use the following canonical terms going forward:

- **Listing:** one sellable offer and one immutable lifecycle record.
- **Reservation:** the exclusive fixed-price commitment linking one buyer to one listing.
- **Bid:** a binding auction commitment at an explicit amount.
- **Fixed-price Offer:** an optional below-ask buyer proposal on a fixed-price listing;
  it is not a reservation until the seller accepts it.
- **Fallback Offer:** a time-limited invitation to a prior bidder; it is not a commitment until accepted.
- **Transaction:** the coordinated completion attempt created by a reservation, an
  accepted fixed-price offer, an auction win, or an accepted fallback offer.
- **Milestone:** an actor-confirmed fact such as payment sent, payment received, item handed over, or item received.
- **Dispute:** a state that pauses automatic completion, automatic expiry/blame, and ordinary party transitions until admin resolution.
- **Trust Event:** an immutable platform-established behavioral fact.
- **Restriction:** a time-bounded capability denial with explicit scope and provenance.

Recommended external interfaces:

1. **Listing lifecycle module**
   - createDraft
   - publish
   - edit
   - endOutsideCollectTT
   - duplicateToDraft
   - expire

2. **Commitment module**
   - reserveFixedPrice
   - placeBid
   - settleAuction
   - offerFallback
   - acceptFallback

3. **Transaction workflow module**
   - advanceMilestone
   - reportProblem
   - resolveDispute
   - expireRequiredAction
   - extendDeadline

4. **Marketplace eligibility module**
   - evaluateAction(user, action)
   - cover required contact data, account status, active-commitment cap, and scoped restrictions in one result

5. **Private disclosure module**
   - counterpartyContact(viewer, transaction)
   - evidenceAccess(viewer, evidence)

These modules should be deep: callers provide identity, target, and intent; the module owns validation, state changes, events, jobs, notifications, and audit side effects. Avoid adding new v1 behavior beside the old claim/custody paths as a parallel layer.

## 8. Dependency-ordered v1 implementation plan

### Milestone 0 — Freeze v1 and quarantine legacy scope

**Effort:** 3–5 days  
**Difficulty:** Medium  
**Goal:** Prevent old product assumptions from continuing to drive new work.

Work (implemented in the current worktree):

- [x] Commit the product scope into the repository as the v1 authority.
- [x] Rewrite README.md, PRODUCT.md, and project-completion-plan.md around the new v1.
- [x] Mark product-design-document.md and Phase 2 custody plans as historical.
- [x] Disable Store application/custody entry points, reserve prices, buyouts, seller-authored payment windows, and any Pro/raffle messaging for new v1 listings behind one launch flag; keep fixed-price offers available.
- [x] Preserve legacy tables and records read-only until the migration strategy is proven.
- [x] Create a route/state inventory and map every legacy route to keep, hide, or retire.

Exit (pending final product-owner review):

- No new listing can enter a v1-prohibited flow.
- Existing legacy records remain inspectable.
- Product documents no longer disagree about launch scope.

Validation completed locally: `npm run verify:offline`, `npx drizzle-kit check`,
`npm run typecheck`, `npm run build`, `npm test` (20 files, 216 tests), and
`git diff --check` pass. Render staging migration and provider delivery remain pending.

### Milestone 1 — Identity, onboarding contact, and eligibility

**Effort:** 1.5–2.5 weeks  
**Difficulty:** High  
**Depends on:** Milestone 0

**Implementation status (2026-09-13):** Implemented and verified against local Docker
Postgres. Schema, server gates, onboarding contact collection, account UI, concurrency
protection, private contact projection, and admin-access auditing are present. Render
staging migration and launch smoke tests remain prerequisites.

Work:

- Separate private account name from public display name and remove public handle/account-name leakage.
- Add profile editing and clear public/private explanations.
- Collect and normalize a required private phone number during onboarding.
- Require a phone number for persisted listing creation (including drafts), publish, reserve, and bid on the server so legacy accounts complete the missing field.
- Add one eligibility module for account status, action-scoped restrictions, and new-buyer active-commitment limit.
- Make the commitment-limit operation concurrency-safe.
- Add the authorized post-commitment phone-disclosure projection.
- Audit admin access to phone information.

Verification:

- Unverified users may browse but cannot persist a draft, publish, reserve, or bid.
- Two concurrent commitment attempts by a capped new buyer produce at most one active commitment.
- Phone numbers are inaccessible before commitment and to unrelated users afterward.

### Milestone 2 — v1 listings, seller choices, and discovery

**Effort:** 2–3 weeks  
**Difficulty:** Medium-high  
**Depends on:** Milestone 1

Work:

- [x] Add seller-managed reusable meetup locations and default payment/meetup choices.
- [x] Prefill defaults during creation while permitting listing-specific changes.
- [x] Require v1 listing data, including description, image, condition, and applicable game/category.
- [x] Add explicit Save Draft and resume behavior.
- [x] Add duplicate-to-draft and relist-to-new-draft, preserving image references safely.
- [x] Add SOLD_OUTSIDE and a guarded seller action.
- [x] Add configured fixed-price expiry and seller expiry/relist email.
- [x] Make original listing records terminal; never reactivate EXPIRED or SOLD_OUTSIDE records.
- [x] Set auctions with no winning transaction to EXPIRED rather than a legacy no-sale/reactivatable state.
- [x] Add location filtering and normalize set/condition filters where applicable.
- [x] Change unfiltered marketplace browse to include both sale types; default auction views to Ending Soon.
- [x] Replace offset paging with cursor/keyset paging or a snapshot strategy that satisfies stable browsing.

Verification:

- [x] Acceptance scenario L passes locally (`tests/flows/listing-lifecycle.test.ts`).
- [x] Active, reserved, terminal, and draft visibility rules are enforced directly.
- [x] Seller defaults never permit a buyer to select an option omitted from that listing.

### Milestone 3 — Fixed-price commitment vertical slice

**Effort:** 1–1.5 weeks  
**Difficulty:** High  
**Depends on:** Milestones 1–2

**Implementation status (2026-09-13):** Docker-verified locally. The fixed-price path
now presents a deliberate Reserve / buy acknowledgement, persists the selected meetup
location on claim and transaction records, keeps the new-buyer cap inside the atomic
commitment transaction, returns structured eligibility/unavailable codes to the UI, and
supports fixed-price offers in v1 while preserving historical offer records. Render
staging and browser/provider smoke checks remain pending.

Work:

- [x] Rename the user-facing action from Claim to Reserve/Buy while retaining the proven atomic SQL pattern.
- [x] Add the explicit commitment confirmation and persist the chosen meetup/payment options.
- [x] Atomically create the reservation/transaction, reserve the listing, enqueue deadlines/emails, and unlock contact disclosure.
- [x] Keep the direct reservation path independent of offer state; fixed-price offers
  use the separate seller accept/reject path and converge on the same transaction flow.
- [x] Apply the new-buyer active commitment cap inside the same concurrency-safe operation.
- [x] Add structured unavailable/restricted/unverified outcomes.

Verification:

- [x] Acceptance scenarios A, B, and J pass under concurrent Docker database tests; browser coverage remains a staging exit check.
- [x] Retry returns the same transaction without duplicate events or emails.
- [x] `npm test` passes: 20 files, 216 tests; typecheck, build, offline preflight, Drizzle check, and diff check pass.

### Milestone 4 — Direct transaction workflows, evidence, deadlines, and disputes

**Effort:** 3–4 weeks  
**Difficulty:** Very high  
**Depends on:** Milestone 3

**Implementation status (2026-09-13):** Docker-verified locally. v1 acknowledged cash
meetup commitments complete through one idempotent buyer action that records payment
and receipt together. The older seller hand-off/buyer receipt transitions remain
readable for historical rows. Member reports pause the dispute track; support can
resume or resolve to a terminal outcome with an audit trail. Bank-transfer evidence
has private storage tickets, confirmation, and party-only download authorization,
while the exact direct-payment disclaimer is shown in the deal room.
Render staging and storage/provider/browser smoke checks remain pending.

Work:

- [x] Evolve the transaction state model to represent responsible actor and required action without discarding the useful separate tracks.
- [x] Cash meetup: buyer confirms **I paid and collected the item** once after the
  physical exchange; payment and receipt are recorded atomically. Legacy hand-off /
  receipt rows remain readable.
- [x] Bank transfer: buyer marks payment sent and may attach private evidence; seller confirms cleared funds; then the parties complete handoff/receipt.
- [x] Display the direct-payment disclaimer on every bank-transfer step.
- [x] Add transaction evidence records and private storage/download authorization.
- [ ] Move all durations into typed platform policy settings; sellers must not set transaction deadlines. (v1 uses centralized constants; admin duration controls are the next hardening slice.)
- [x] Schedule 50%, two-hour, and deadline notifications with stable dedupe keys.
- [x] Make reportProblem enter the paused DISPUTED track and pause auto-completion, automatic blame, and deadline expiry.
- [x] Let admins extend deadlines and resolve disputes into an explicit next/terminal state.
- [x] Ensure cancellation/release/restoration behavior is atomic and fixed-price restoration creates the correct listing outcome under the new lifecycle.

Verification:

- [x] Acceptance scenarios C–F core paths pass locally (single-action cash meetup,
  dispute pause, evidence authorization); staging/provider scenarios remain pending.
- [x] Replaying the cash-meetup action creates no duplicate completion events;
  legacy hand-off/receipt and deadline jobs use stable dedupe keys.

### Milestone 5 — Binding auctions and fallback offers

**Effort:** 2.5–3.5 weeks  
**Difficulty:** Very high  
**Depends on:** Milestones 1–4

**Implementation status (2026-09-13):** Development-complete locally. v1 auction
creation and bid actions now require an explicit binding-bid acknowledgement, legacy
reserve/buyout terms are rejected at runtime, and runner-up promotion creates a
single expiring fallback offer instead of opening a transaction automatically.
Acceptance is transactional, expiry advances the ladder idempotently, and admin bid
invalidation voids the bid, recomputes the cached leader, records an audit reason, and
can trigger the same fallback flow. Migration `0029_auction_fallback_offers.sql` is
applied to local Docker Postgres only. Concurrency, browser, and staging checks remain
pending by design while development continues.

Work:

- Remove reserve and buyout from v1 creation, validation, detail, bid, and close paths.
- Validate auction durations against configured platform choices.
- Add explicit bid commitment confirmation.
- Preserve atomic minimum validation, bid ordering, two-minute anti-sniping, and server-authoritative close.
- Notify the appropriate bidders/watchers of extensions; define “watcher” only if watch functionality is approved.
- Keep seller edit/cancel locked after the first valid bid.
- Replace automatic runner-up promotion with expiring fallback offers.
- Require explicit acceptance before creating the next transaction.
- Add admin bid invalidation/retraction with ladder recomputation, state checks, reason, notifications, and audit.

Verification:

- Acceptance scenarios G–I pass, including close/extension/acceptance races and duplicate jobs.

### Milestone 6 — Trust, restrictions, reporting, and admin operations

**Effort:** 3–4 weeks  
**Difficulty:** High  
**Depends on:** Milestones 4–5

Work:

- Rebuild the public Trust Snapshot projection to exactly match v1 facts (completed purchases/sales, successful auctions, and verified objective activity only).
- Distinguish completed purchases, completed sales, successful auctions, and recent adjudicated/objective issues.
- Never show unreviewed allegations as public issues.
- Replace legacy prepay/meetup-only restriction semantics with independent reserve, bid, and list/publish scopes.
- Add warning events and configurable progressive thresholds/lookback windows/durations.
- Store restriction source event, actor, lifecycle status, and audit history.
- Build contextual report/support cases for listings, auctions, transactions, and accounts, including category, evidence, assignment, notes, and resolution.
- Keep reporter identity private from reported users.
- Add guided admin commands for transaction cancellation, deadline extension, dispute resolution, eligible listing reactivation/removal, trust correction, restriction changes, bid invalidation, and warnings.
- Use state/version guards and append-only audit for succeeded, rejected, and material failed attempts.

Verification:

- Acceptance scenario K passes.
- Every admin mutation has direct-action authorization, stale-object, audit, idempotency, and notification tests.

Development status: the v1 trust/restriction/reporting/admin slice is implemented and migrated on Docker. Acceptance, browser, provider, and operational testing remains pending.

### Milestone 7 — Notification catalogue, legal surfaces, analytics, and operations

**Effort:** 2–3 weeks  
**Difficulty:** Medium-high  
**Depends on:** Milestones 2–6

Work:

- [x] Complete the required v1 email event catalogue and remove v1 emails for retired behavior.
- [x] Enforce notification preferences only for nonessential events; commitment, security, deadline, dispute, and restriction emails remain mandatory.
- [x] Add listing-expiry, auction extension/loss/fallback, milestone, deadline, dispute, and restriction-change delivery.
- [x] Add authenticity and direct-payment disclaimers at every required point.
- [x] Publish Terms, Privacy, support, prohibited-items, and minors-policy surfaces pending final legal review.
- [x] Define the retention baseline for phone disclosures, reports, evidence, and audit data.
- [x] Instrument first-party funnel/outcome events with stable idempotency keys and a rolling admin summary.
- [x] Add a web readiness endpoint, failed-notification visibility, and a documented backup/restore drill.

Verification:

- [x] Required delivery events are retry-safe and deduplicated.
- [x] No retired v1 feature generates user-facing email in the v1 route scope.
- [x] Metric queries reconcile to transactional event rows; seeded fixture reconciliation and provider checks remain staging exits.

**Implementation status (2026-09-13):** The notification preference gate, auction
extension email, legal/support surfaces, transactional analytics events, admin summary,
readiness endpoint, and operations runbook are implemented locally. Final legal review,
provider delivery, production monitoring, and restore rehearsal remain launch exits.

### Milestone 8 — Launch-candidate hardening and staged beta

**Effort:** 3–5 weeks  
**Difficulty:** High  
**Depends on:** All prior milestones

Work:

- [x] Add a repeatable launch-candidate HTTP preflight and exercise the local browser smoke matrix for public routes, redirects, legal/support surfaces, and principal unauthenticated authorization probes.
- [x] Add local accessibility-tree checks, mobile viewport coverage, and application-shell hardening; the full committed A–L browser suite remains a staging exit.
- [x] Keep repeated-submit/idempotency and stale-object protections covered by the existing flow/security suites and live worker idempotency check.
- Run migration rehearsal on a production-like copy and verify forward-fix/rollback procedures.
- Exercise worker recovery, delayed jobs, provider failures, and notification retries.
- Complete Brevo and phone-provider production verification.
- Seed approximately 100 active listings through seller recruitment.
- Run internal alpha, trusted pilot, invite-only beta, and public expansion gates.

Exit:

- All v1 acceptance scenarios pass.
- No unresolved privacy, concurrency, state-integrity, or admin-audit defect remains.
- Monitoring, backups, restore, provider delivery, and support rehearsal are proven.

## 9. Migration and rollout strategy

1. **Inventory production data first.** Count records by listing state/type, transaction state/source, fulfillment path, reserve/buyout usage, offers, custody state, phone presence, and open jobs. Until this is done, production migration complexity is **Unknown**.
2. **Use additive migrations.** Add v1 states and tables before changing writers. Avoid destructive enum replacement in the first release.
3. **Add a workflow version.** Mark new v1 listings/transactions separately so legacy records remain interpretable under the rules that created them.
4. **Quarantine legacy creation.** Stop only legacy offer/custody/reserve/buyout
   writers and seller-authored deadlines before backfilling; v1 fixed-price offers
   remain enabled through their dedicated workflow.
5. **Backfill active records explicitly.** Map draft/active records to v1 only when their required seller choices and verification data are valid. Keep incompatible records legacy or require seller review.
6. **Preserve history.** Do not rewrite legacy transaction, custody, offer, or audit events into v1 semantics.
7. **Update constraints with state changes.** In particular, active-transaction uniqueness must include OPEN and DISPUTED, and listing exclusivity must include RESERVED.
8. **Deploy reads before writes.** First deploy code that can read both legacy and v1 rows, then migrations/backfills, then v1 writers, then route removal/feature flags.
9. **Reconcile jobs.** Cancel or no-op obsolete scheduled jobs by workflow version and create the required v1 jobs with stable keys.
10. **Remove only after observation.** Keep obsolete tables/enum values through at least one stable release. Remove them only after backups, export, and a verified no-reader/no-writer check.

High-risk/irreversible work:

- Removing PostgreSQL enum values.
- Deleting custody, offer, Store, or legacy transaction data.
- Reusing old terminal listings as new v1 records.
- Publicly exposing private phone values.
- Reclassifying historical reputation outcomes under a new policy.

## 10. Open decisions that block or shape implementation

The product scope already lists fourteen policy decisions. The following should be answered first because they change schema, providers, or acceptance tests:

1. Whether changing a phone number should create a notification or cooling-off period.
2. Definition of a “new buyer” and whether the one-active-commitment limit includes active auction wins, fallback offers, bids, or only reservations.
3. Exact transaction milestone order for cash and bank transfer, especially cash paid at meetup and bank transfer before/after handoff.
4. Deadline and auto-completion values, including how admin extensions interact with already-enqueued reminders.
5. Auction duration choices and minimum bid increment table.
6. Runner-up offer duration, number of sequential offers, and when the listing becomes available again.
7. Restriction thresholds/durations and what constitutes an objective versus adjudicated issue.
8. Fixed-price listing lifetime.
9. Set/location vocabulary and whether meetup locations are private labels, public locations, or reusable structured places.
10. Minors policy, evidence/contact retention, and final legal wording.

Recommended implementation defaults, subject to product-owner approval:

- Treat “new buyer” as fewer than three completed purchases.
- Count only reservations, auction wins, and accepted fallback offers as active commitments; ordinary bids do not consume the slot until they win.
- Keep current 1/2/3/7-day auction duration choices.
- Keep the current tiered bid increments until product data justifies change.
- Use a 24-hour runner-up offer window and proceed through at most two eligible runners-up.
- Keep fixed-price lifetime at the provisional 30 days.

## 11. v1.5 and deferred code

### v1.5 Featured Listings

Do not put Featured Listings on the v1 critical path. After v1 stabilizes, implement it as an eligibility/ranking adapter around active listings with:

- configurable packages/prices;
- labeled placement;
- an interleaving cap;
- timestamped activation/expiry;
- immediate eligibility loss when the listing leaves ACTIVE;
- payment/refund/admin behavior from a separate approved specification.

Estimated effort after payment-provider decisions: **3–5 engineer-weeks**.

### Deferred/obsolete behavior

| Existing behavior | v1 treatment |
|---|---|
| Fixed-price offers and seller acceptance | Supported in v1 for opt-in fixed-price listings; keep historical records readable and keep auction fallback offers distinct |
| Store applications, relay Store custody, staff roles/routes | Hide from v1 navigation and new listings; preserve historical data; remove only after a separate decision |
| Remote shipping and full-service delivery | Disable as selectable v1 choices unless the product scope is amended |
| Reserve prices and auction buyout | Disable for new v1 auctions; preserve legacy display/settlement |
| In-app notifications | May remain if already useful, but must not delay required email behavior |
| SMS notification seam | Not part of v1; introduce only through a separate product decision |
| Pro/raffle/ratings claims in docs | Remove from active v1 documentation; no clear runtime implementation was found |

## 12. Verification and launch gate

Required automated layers:

- Pure state/policy tests for every transition and actor.
- Database constraint/adversarial tests for exclusivity, cap, privacy lookup, and terminal history.
- Concurrent flow tests for reservation, bid, auction close, expiry, fallback acceptance, and admin races.
- Job replay tests for all scheduled transitions and emails.
- Direct-object authorization tests for phones, evidence, reports, restrictions, transactions, listings, bids, and admin actions.
- Browser tests for all scenarios A–L, plus signup/onboarding contact and legal/disclaimer visibility.
- Accessibility tests for signup, create listing, browse, listing detail, transaction, report, and admin flows.

Operational launch gate:

- Typecheck, unit/flow/security tests, production build, and browser suite pass.
- Migrations succeed on a production-like copy and a forward-fix rehearsal is documented.
- Worker auction/deadline/email verification passes in staging.
- R2 private evidence and public listing image access are separately verified.
- Brevo and phone OTP delivery are verified with production configuration.
- Monitoring alerts on repeated job and email failures.
- Backups and one restore drill are complete.
- Legal review is complete.
- An admin can resolve representative reservation, auction, deadline, dispute, restriction, listing, and notification incidents without SQL.

## 13. Milestones 2–7 implementation handoff

Milestones 0–1 are the completed local foundation. Milestone 2's core listing/discovery
slice, Milestone 3's fixed-price commitment slice, Milestone 4's direct transaction
slice, Milestone 5's binding-auction/fallback slice, Milestone 6's trust,
support, and admin-operations slice, and Milestone 7's notification, legal,
analytics, and operations slice are implemented locally; staging/provider, legal,
restore, and broader acceptance checks remain.

This is the best starting point because the repository is currently continuing to express two incompatible products. Disabling new legacy behavior prevents more data from entering paths that must later be migrated, while identity and eligibility are prerequisites for every publish, reserve, and bid operation. Starting with transaction UI or auction polish before those seams are settled would create rework.

## 14. Validation performed for this analysis

- Read the complete attached product scope.
- Inspected repository guidance, product documents, schema, domain states/policies, atomic operations, jobs, notifications, member pages, listing flows, transaction flows, admin flows, tests, and deployment declaration.
- Milestone 1 application code and migration `0023_overconfident_prowler.sql` are in the worktree and applied to the local Docker Postgres database; no Render or production database was changed.
- Milestone 2 migration `0024_left_morlun.sql` is applied to the local Docker Postgres database. It adds seller meetup/default tables, the Sold outside terminal state, and fixed-price expiry metadata; no Render or production database was changed.
- Milestone 3 migration `0025_shallow_prima.sql` is applied to the local Docker Postgres database. It adds durable meetup-location references to claims and transactions; no Render or production database was changed.
- Milestone 4 migrations `0026_parallel_pretty_boy.sql`, `0027_sharp_kulan_gath.sql`, and `0028_wide_grandmaster.sql` are applied to the local Docker Postgres database. They add hand-off/receipt state, private transaction evidence, the paused dispute track, and the completion invariant; no Render or production database was changed.
- Milestone 5 migration `0029_auction_fallback_offers.sql` is applied to the local Docker Postgres database. It adds the explicit fallback-offer status/table and expiry indexes; no Render or production database was changed.
- Milestone 7 migration `0035_fat_mercury.sql` is applied to the local Docker Postgres database. It adds idempotent first-party analytics events; no Render or production database was changed.
- TypeScript checking, the production build, the offline preflight, Drizzle consistency check, and diff check pass.
- The full Vitest run passes against Docker: 20 files and 218 tests, including database constraints, trading, custody, browse, listing lifecycle, phone/privacy, notification catalogue, and launch-scope coverage.
- Milestone 8 local HTTP/browser smoke and real-worker image-pipeline checks pass; see `docs/operations/milestone-8-launch-gate.md`.
- Production-like migration rehearsal, Brevo email/phone provider smoke tests, backup/restore, legal approval, monitoring, seller recruitment, and staged beta gates remain before public launch.
