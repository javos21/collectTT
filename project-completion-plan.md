# CollectTT Project Completion and Launch Plan

**Created:** 26 August 2026  
**Last updated:** 12 September 2026

**Planning basis:** `product-design-document.md`, `README.md`, the current application routes, services, schema, and automated checks  
**Current position:** Core Phase 2 functionality is complete; launch-preparation work is in progress. Store staff and WhatsApp notifications are outside the current design.

## 0. Progress tracking

This document is the source of truth for completion work. Whenever a phase is completed, update its status below, mark the relevant checklist items, record the verification evidence, and add a dated entry to the progress log. A phase is not complete until its exit criteria and release checks are recorded here.

**Status key:** `Complete` means the exit criteria are met and verified; `Partial` means some capabilities exist but the phase is not releasable; `In progress` means active work is underway; `Not started` means no launch-ready implementation exists; `Deferred` means intentionally outside the current beta scope.

### Phase dashboard

| Phase | Focus | Status | Current progress | Exit evidence still needed |
|---|---|---|---|---|
| 0 | Beta contract and baseline | In progress | Beta scope is defined and the core route inventory exists in the repository. | Final scope sign-off, persona/state inventory, `DESIGN.md`, and a clean baseline of the current UI work. |
| 1 | Shared product shell | In progress | Shared styling and newer page treatments exist, but navigation, primitives, responsive states, and accessibility are uneven. | Consistent shell/primitives across member, store, and admin surfaces. |
| 2 | Member experience | In progress | Core buying, selling, deals, custody, listing edit, and listing withdrawal flows exist. | Notification inbox/preferences, profile editing, relist flow, support/content, and final mobile UX. |
| 3 | Platform admin area | Partial | Shared admin authorization now protects the existing pages and the new Listings, Members, Deals, Notifications, and Audit routes; the member lookup/detail, audited member safety actions, listing, deal, notification delivery, audit read-only, and audited email-retry slices are complete. | Notification health on member detail, audited listing/deal support actions, complete audit-writer coverage/tests, and any retained custody-data views. |
| 4 | Test, security, and operations | In progress | Current typecheck and production build pass. | Full test confirmation, browser/accessibility coverage, rate limits, monitoring, backups/restore, and live smoke tests. |
| 5 | Staged beta | Not started | No formal alpha/pilot has been completed. | Internal alpha, trusted pilot, invite-only beta, and expansion metrics. |
| Future communications | Brevo SMS exploration; WhatsApp | Deferred | Beta is email-first for cost and operational simplicity. WhatsApp is not planned. | Revisit SMS only after the core beta demonstrates a clear need and acceptable cost. |

### Progress log

| Date | Update | Verification / decision |
|---|---|---|
| 26 Aug 2026 | Created the completion and launch roadmap from the product documents and repository audit. | Core domain was feature-capable; launch readiness remained open. |
| 11 Sep 2026 | Audited the current application surface. Confirmed partial admin routes, seller listing edit/withdraw, styled HTML email delivery, and removal of the two retired custody notification events from active runtime code. | `npm run typecheck` passes; `npm run build` passes. Full Vitest run did not complete in the current environment and remains unverified. |
| 11 Sep 2026 | Updated product direction: removed store staff from the beta design and selected email-only notifications for now. | Store-staff UI/roles/management are no longer roadmap goals; WhatsApp is deferred and Brevo SMS is future exploration only. |
| 11 Sep 2026 | Began the admin-area phase. Centralized admin authorization, replaced dead hash navigation with real protected routes, and added accessible read-only route foundations. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. The new routes are intentionally read-only placeholders for the next data slices. |
| 11 Sep 2026 | Completed the member read-only slice with server-side search, pagination, protected member detail, account context, trust counters, restrictions, listings, and recent deals. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. Member actions remain intentionally read-only. |
| 12 Sep 2026 | Completed the listing read-only slice with server-side search/status filtering, pagination, protected listing detail, seller context, images, attributes, claims, bids, offers, deal attempts, and listing audit history. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. Listing moderation actions remain intentionally read-only. |
| 12 Sep 2026 | Completed the deal read-only slice with server-side search/state and overdue filtering, protected deal detail, both state tracks, deadlines, participants, retained custody context, disputes, transaction events, and linked notification delivery history. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. Deal support actions remain intentionally read-only. |
| 12 Sep 2026 | Completed the notification operations read-only slice with email-first delivery search/status/channel filters, pagination, delivery detail, attempt/error visibility, linked member and deal/listing context, in-app state, and preference state. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. Retry and notification mutations remain intentionally deferred. |
| 12 Sep 2026 | Added the append-only admin audit schema, transaction-safe `recordAdminAudit` helper, protected `/admin/audit` filters, and audit-event detail view with actor, target, reason, outcome, before/after context, and request metadata. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. The migration is isolated in `drizzle/0020_yellow_sumo.sql`; future admin mutations still need to call the helper. |
| 12 Sep 2026 | Implemented the first audited admin mutation: failed email delivery retry with a required reason, email-only/state guards, transactionally queued worker job, retry job-key idempotency, final-attempt failure visibility, and success/rejection feedback in the delivery detail view. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. The retry action records succeeded and rejected outcomes through `recordAdminAudit`; member/listing/deal mutations and full action tests remain outstanding. |
| 12 Sep 2026 | Completed the member safety-action slice with audited suspend/reactivate controls, admin-sourced restriction add/lift controls, required reasons, stale-state guards, duplicate restriction protection, confirmation prompts, and accessible success/error/loading feedback. Automatic reputation restrictions remain system-controlled. | `npm run typecheck`, `npm run build`, and `git diff --check` pass. Final administrator/self-protection is enforced for suspension; notification health on member detail and full action tests remain outstanding. |

### Current scope decisions

- **No store-staff persona:** store staff, staff assignments, staff-only navigation, and a store-staff counter board are not part of the beta design. Existing store/staff code and data should be deprecated or removed in a separate cleanup pass without damaging historical custody records.
- **Email-first notifications:** the beta uses in-app notifications plus email. WhatsApp notifications are deferred because of cost. Brevo SMS may be explored later, but it is not a beta dependency.
- **Custody boundary:** if relay-custody records remain in the product, they are an admin-visible operational record rather than a store-staff workflow. This plan does not add new staff-facing custody features.

## 1. Executive status

CollectTT already has the difficult domain foundation: accounts, listings, auctions, atomic claims, transaction state, reputation, ratings, relay custody, and legacy store-counter workflow code are implemented. The current verification baseline is:

- A historical baseline of 174 automated tests was recorded as passing; the full suite still needs to be confirmed again before release.
- TypeScript checking passes.
- The optimized Next.js production build succeeds.
- The repository contains deployment definitions for a web process, worker, and Postgres.

The project is **feature-capable but not yet launch-ready**. The remaining critical path is the product layer around the domain:

1. establish a coherent, responsive UI system across every member and admin route;
2. build a genuine platform-admin console without a store-staff operating surface;
3. close launch-critical workflow gaps such as notification visibility and seller listing management;
4. add browser-level testing, security/abuse controls, monitoring, backup/restore proof, and production smoke tests;
5. run a staged private beta before committing to deferred roadmap capabilities.

The recommended launch target is an **invite-only beta using email and in-app notifications and peer-to-peer settlement**. WhatsApp, Brevo SMS, the paid pickup/delivery rail, WhatsApp OTP, SSE, and store-staff operations should not block that beta. Relay custody remains conditional on the product decision above.

## 2. What exists today

| Area | Status | Evidence and remaining concern |
|---|---|---|
| Accounts and profiles | Auth cutover implemented; live-provider validation pending | Better Auth now provides Google-first sign-in plus verified email/password, email verification, and password recovery. Secure same-email account linking preserves stable user ownership. Google production callbacks and a real Brevo delivery still need to be exercised. Profile editing and polished onboarding remain. |
| Listing creation and browse | Built; management still being finished | Category-aware listing creation, image processing, filters, pagination, straight sales, auctions, seller edit, and seller withdrawal exist. Relist flow, general text search, and final mobile/edge-case polish remain. |
| Trading lifecycle | Built and tested | Atomic winner-only claims, bidding, soft close, payment handshake, renege handling, and auction runner-up promotion are covered by flow tests. |
| Trust and reputation | Built and tested | Objective counters, restrictions, blind ratings, and public trust pages exist. Admin review/override tooling does not. |
| Relay custody | Built and tested | Store selection, drop-off code, shelf clock, payment-gated release, pickup, return, and overstay behavior exist. |
| Store/staff operations | Removed from current design | Existing `/store` and `/store/[storeId]` routes and staff-role data require a deprecation/removal decision and migration plan; no new staff-facing work is planned. |
| Platform administration | Partial implementation | `/admin` has server-side role checks plus overview, store applications, catalog, settings, protected member/listing/deal directories, notification delivery views, an audit log, audited failed-email retry, and audited member safety actions. Listing/deal support actions, member notification health, and action tests remain. |
| Notifications | Backend, HTML email adapter, and admin delivery operations built; member UI missing | In-app rows, console/Brevo email delivery, preferences schema, styled HTML email, worker dispatch, protected admin delivery directory/detail view, and audited failed-email retry exist. The beta is email-first; no member-facing notification inbox or preference controls are visible, preferences are not yet enforced by dispatch, and event-specific email link review still needs completion. |
| UI and design system | In progress, inconsistent | Landing, browse, listing detail, and deal pages have newer styling, while profile, listing creation, legacy store routes, tables, forms, errors, and responsive states still rely on a broad shared stylesheet and uneven page-level patterns. There is no durable `DESIGN.md` yet. |
| Future roadmap | Deferred | Brevo SMS evaluation, paid pickup/delivery, and SSE remain future considerations. WhatsApp notifications, WhatsApp OTP, and store-staff operations are not planned. |
| Deployment and operations | Declared, not launch-proven | `render.yaml` now declares Google and Brevo configuration for the web/worker split. Production credentials, OAuth callbacks, Brevo DNS/deliverability, migrations, R2 behavior, monitoring, backups, restore, and the live verification scripts still require proof in a production-like environment. |

### Latest completed launch slice — authentication and email

- [x] Removed magic-link and Facebook authentication paths.
- [x] Added Google OAuth as the primary Better Auth provider.
- [x] Added verified email/password registration, sign-in, resend-verification,
  forgotten-password, and reset-password flows with a 12-character minimum.
- [x] Added guarded same-email account linking so existing ownership records stay on one
  stable user ID.
- [x] Replaced the Resend dependency and adapter with the official Brevo SDK.
- [x] Added Google and Brevo configuration to `.env.example` and `render.yaml`.
- [x] Added same-origin post-auth redirect validation and tests.
- [x] Preserved validated return destinations through password recovery.
- [x] Hardened unverified sign-in resend, provider/network error handling, and encoded redirect-path validation.
- [x] Passed TypeScript checking and an optimized production build in the current tree.
- [ ] Reconfirm the historical 174-test baseline; the full Vitest run did not complete during the latest audit.
- [x] Removed `custody_ready_for_pickup` and `custody_overstay_store` from active runtime notification events and producers while retaining custody overstay bookkeeping.
- [x] Added the shared HTML email shell with a centered logo, brand styling, and body font stack.
- [ ] Audit every email CTA: only deal activity should use `Go To Deal`; listing activity needs an appropriate listing destination/label.
- [ ] Make the beta notification catalogue email-first: remove WhatsApp from default event channels and prevent unnecessary skipped WhatsApp delivery rows. Keep future SMS evaluation separate from the beta path.
- [ ] Authenticate the sending domain in Brevo and add a production API key/verified sender.
- [ ] Configure and exercise Google OAuth for localhost and the production hostname.
- [ ] Manually test new registration, verification, sign-in, account linking, forgotten
  password, reset, logout, and expired/error paths using real provider delivery.
- [ ] Address the current dependency audit before launch. The latest audit reports 11
  advisories across the existing stack; production-impacting Next/PostCSS/Sharp findings
  and development-only Vitest/Vite findings require a deliberate upgrade pass.

## 3. Launch scope

### Beta must include

- A buyer can discover an item, claim or bid, understand the deal state, complete the payment handshake, and rate the seller.
- A seller can create, review, publish, manage, and withdraw eligible listings; then complete a deal without operator assistance.
- An administrator can find a user, listing, transaction, retained custody record, or failed email notification and take a small set of audited support actions.
- Every critical flow works at mobile widths, with keyboard access, visible focus, readable errors, and useful empty/loading/success states.
- Production has monitoring, rate limiting, backups, a tested restore procedure, and a repeatable release/smoke-test checklist.

### Explicit beta non-goals

- Holding or processing buyer/seller funds.
- WhatsApp notifications or authentication.
- Store-staff accounts, staff assignments, and a staff-operated counter workflow.
- Full-service pickup and delivery.
- Power-seller subscriptions, promoted listings, grading concierge, or sponsorships.
- A large analytics suite or highly configurable back office.
- Replacing the existing domain/state-machine design.

## 4. Priority roadmap

### Milestone 0 — Freeze the beta contract and baseline

**Goal:** stop the launch target from expanding while the UI is being rebuilt.

**Status:** In progress. The recommended beta scope is documented, but the route/state inventory, durable design contract, and dirty-work baseline still need to be finalized.

- [ ] Confirm the invite-only beta scope and explicitly defer the future-roadmap non-goals above.
- [ ] Define the three launch personas: buyer, seller, and platform administrator.
- [ ] Inventory every route and record its happy, empty, loading, validation, permission, and failure states.
- [ ] Turn the current visual direction into `DESIGN.md`: typography, color, spacing, surfaces, buttons, fields, badges, alerts, tables, navigation, responsive rules, and motion.
- [ ] Decide the minimum admin interventions and which actions are read-only, reversible, or destructive.
- [ ] Capture the existing dirty UI work before broad redesign work begins; do not mix unrelated changes into launch commits.
- [ ] Reconcile README, roadmap, and historical design notes with the current tree, including the partial admin console, current test status, and retired custody notification events.
- [ ] Create a safe legacy cleanup plan for `/store`, `/store/[storeId]`, `/store/apply`, the `store_staff` role, staff assignments, and related schema/code if they are no longer needed; preserve historical custody records and avoid destructive migration without a data decision.

**Exit:** one agreed beta scope, a route/state inventory, and a durable UI contract.

### Milestone 1 — Rebuild the shared product shell

**Goal:** make every surface feel like one product before polishing individual pages.

**Status:** In progress. Several core routes have newer treatments, but the shell, primitives, responsive rules, and accessibility behavior are not yet consistent across the product.

- [ ] Replace the current always-visible sign-in/profile navigation ambiguity with authenticated and signed-out states.
- [ ] Establish desktop navigation and a deliberate mobile tab/menu model, including access to notifications and admin tools when authorized.
- [ ] Extract reusable primitives for page headers, cards, data rows, form fields, filters, badges, alerts, dialogs/confirmations, empty states, skeletons, and tables.
- [ ] Split the monolithic styling into durable tokens and component/surface styles without changing domain behavior.
- [ ] Standardize form validation, pending/disabled states, destructive confirmations, redirect messages, and error recovery.
- [ ] Verify color contrast, focus treatment, reduced motion, touch targets, and content reflow at small mobile widths.

**Exit:** new work can be composed from shared primitives; navigation and responsive behavior are consistent.

### Milestone 2 — Finish the member experience

**Goal:** let buyers and sellers complete common work without hidden knowledge or operator help.

**Status:** In progress. The core transaction experience and seller edit/withdraw path exist; notifications, profile editing, relisting, support/content, and final UX hardening remain.

Work in this order:

1. **Listing creation and management**
   - [ ] Redesign the creation flow with progressive sections, image status, category-specific guidance, review, and clear publish success.
   - [ ] Add seller controls for eligible edit, withdraw/end, and relist operations with state-aware safeguards.
   - [ ] Replace the minimal profile listing table with a usable seller inventory view.
2. **Browse and listing detail**
   - [ ] Finish mobile browse/filter behavior, image fallbacks, auction urgency, seller trust cues, and clear settlement/fulfillment explanations.
   - [ ] Test realistic long titles, missing images, many attributes, ended listings, relists, and bid errors.
3. **Deals and trust**
   - [ ] Make the next required action unmistakable for each actor and state.
   - [ ] Clarify deadlines, counterparty responsibilities, custody location/code, dispute feedback, and rating availability.
   - [ ] Add transaction-level support/report entry points that create an auditable admin work item or, for the beta, a clearly documented support channel.
4. **Member utilities**
   - [ ] Add an in-app notification inbox with unread state and links to the affected item/deal.
   - [ ] Add notification preferences for the channels that are actually enabled and enforce them in dispatch.
   - [ ] Audit event-specific email destinations and CTA labels; use `Go To Deal` only for deal activity.
   - [ ] Add profile editing for launch-relevant identity/contact fields and explain what is public.
5. **Onboarding and content**
   - [ ] Add first-run guidance for buyers, sellers, and administrators.
   - [ ] Add concise trust/safety, payment, and auction explanations at the point of use.
   - [ ] Add Terms, Privacy, Community Rules, support contact, and prohibited-item guidance before external testing.

**Exit:** seeded beta users can complete the buyer and seller journeys without developer guidance.

### Milestone 3 — Build the platform-admin area

**Status:** Partial. The first shell/authorization slice is complete; operational support and moderation workflows are not complete.

**Goal:** give one authorized platform administrator enough visibility and safe, auditable controls to support the beta without direct database edits. Store staff are not a persona, and no staff-facing operating surface is included in this milestone.

**Admin design principles:**

- Every route and server action enforces the admin role on the server.
- Admin writes require a reason, show the target and consequence, and create an audit event.
- Prefer read-only detail and guided corrective actions over arbitrary state editing.
- Keep member data, payment information, and internal failure details scoped to the minimum necessary.
- The beta notification channel is email plus in-app; do not build WhatsApp operations into the admin area.

**Current implementation:** basic server-side admin role checks, overview counters, store-application review, catalog management, and marketplace settings. The sections below are the outstanding admin-area plan.

#### 3A. Admin shell and authorization

- [x] Consolidate the repeated role checks into shared `adminAccess` and `requireAdmin` server helpers and use them for every admin page and action.
- [x] Replace the current Listings, Members, and Deals hash links with real protected routes and active navigation states.
- [ ] Add admin breadcrumbs, search/filter patterns, pagination, and consistent empty/loading/error states.
- [ ] Test direct URL access and direct server-action calls as an ordinary member, an unauthenticated user, and any retained legacy role.

#### 3B. Admin overview

- [ ] Keep the existing member, active-listing, open-deal, and active-claim counts.
- [ ] Add actionable counts for overdue deals, active auctions, retained custody overstays, failed email deliveries, restricted/suspended users, and recent system failures.
- [ ] Link every count to the corresponding filtered admin view.
- [ ] Add a small recent-activity panel showing audited admin actions and critical worker failures.

#### 3C. Member lookup and safety actions

- [x] Add `/admin/members` search by email, handle, display name, and user ID with pagination.
- [x] Add member detail showing account verification/provider state, public profile, reputation counters, restrictions, recent deals, and listings.
- [ ] Add notification delivery health to member detail and audited suspend/reactivate/restriction actions.
- [x] Add audited suspend/reactivate and restriction actions with required reason, confirmation, and safe error handling.
- [x] Prevent an administrator from suspending their own account or another administrator account through the guided member action.
- [ ] Add a broader final-administrator access-review safeguard before any future role/access mutation is introduced.

#### 3D. Listing moderation

- [x] Add `/admin/listings` search by listing ID, title, seller, category, and status with pagination.
- [x] Add listing detail showing seller, images, attributes, claims, bids, offers, current state, deal attempts, and listing audit history.
- [ ] Add audited hide/unpublish/end actions with policy/safety reason and a reversible path where safe.
- [ ] Ensure moderation actions re-check ownership/state server-side and cannot invalidate an active deal silently.

#### 3E. Deal and retained custody support

- [x] Add `/admin/deals` search by transaction ID, listing, buyer, seller, state, and overdue deadline with pagination.
- [x] Add deal detail showing both state tracks, deadlines, candidates, transaction events, notification history, retained custody context, and dispute/support context. The current domain has no separate rating table; reputation facts remain visible on member detail.
- [ ] Add guided support actions only where the state machine defines a safe correction; do not expose arbitrary state mutation.
- [ ] If relay custody remains in the product, show retained custody records, codes/status, shelf clocks, and return/overstay history as admin-visible data only.
- [ ] Explicitly exclude store-staff assignments, staff permissions, and staff counter operations from the beta admin scope.

#### 3F. Notification operations

- [x] Add `/admin/notifications` with failed/pending email delivery search, error detail, attempts, timestamps, and linked user/deal/listing context.
- [x] Add safe retry for failed email deliveries with idempotency protection, required retry reason, accessible result feedback, and an audit event.
- [x] Show in-app delivery state and member preference state without exposing provider secrets.
- [x] Keep WhatsApp out of the beta delivery catalogue; document Brevo SMS as a future evaluation rather than an active channel.

#### 3G. Admin audit log

- [x] Add an append-only admin audit table recording actor, target type/ID, action, reason, before/after context, request metadata, outcome, and timestamp.
- [ ] Write audit events for every admin mutation, including failed or rejected attempts where useful for security review. Notification retry now records succeeded and rejected attempts; member/listing/deal actions still need writers.
- [x] Add `/admin/audit` filters for actor, target type/ID, action, date range, and outcome, plus event detail.
- [ ] Test that ordinary domain events cannot be mistaken for administrator actions.

#### 3H. Admin verification and rollout

- [ ] Add authorization, mutation, audit, and direct-object tests for every admin route/action.
- [ ] Exercise the console with realistic member, listing, deal, custody, notification-failure, and restriction data.
- [ ] Verify desktop and tablet usability, keyboard operation, destructive confirmations, and PII minimization.
- [ ] Run a support rehearsal where an administrator resolves representative issues without SQL.

**Exit:** an authorized administrator can support members, listings, deals, retained custody records, and failed email deliveries without SQL; every write is reasoned, permission-checked, and auditable; no store-staff workflow is required.

### Milestone 4 — Test and harden the launch candidate

**Status:** In progress. TypeScript checking and the production build pass; the complete release, browser, security, and recovery evidence is still outstanding.

#### Automated coverage

- [ ] Keep the current 175 auth/domain/DB/flow tests green.
- [ ] Add tests for seller edit/withdraw permissions and invalid state transitions.
- [ ] Add admin authorization and audit-log tests for every admin action.
- [ ] Add notification inbox/preferences and failed-delivery retry tests.
- [ ] Add browser end-to-end tests for sign-in, create listing, claim, bid, payment handshake, rating, relay drop-off/release/pickup, and the principal admin support flow.
- [ ] Add accessibility checks to the browser suite for the primary route templates.
- [ ] Make typecheck, test, production build, and browser smoke tests required checks for a release.

#### Manual acceptance matrix

- [ ] Run every critical flow as buyer, seller, and admin.
- [ ] Test current iPhone/Android-sized viewports plus desktop, keyboard-only operation, zoom, slow network, repeated submits, expired links, and stale pages.
- [ ] Test realistic minimum/typical/maximum content, including missing images, long names, large listing histories, many bids, and 25+ store audit rows.
- [ ] Verify all notification copy and links using actual email delivery and in-app rows.
- [ ] Conduct an admin support rehearsal with a person who did not build the product.

#### Security and operations

- [ ] Add rate limits for sign-in, sign-up, verification/reset email, image uploads, claims, bids, and sensitive admin actions.
- [ ] Review authorization at every server action and direct-object route; UI hiding is not a security boundary.
- [ ] Add production error monitoring for both web and worker processes and alert on repeated job failures.
- [ ] Provide a dedicated health/readiness endpoint that checks the web process without using a database-heavy public page.
- [ ] Prove database migrations on a production-like copy and document rollback/forward-fix policy.
- [ ] Enable automated Postgres backups, run the periodic export promised in the product document, and complete one restore drill.
- [ ] Verify R2 upload/variant/public delivery, Brevo domain authentication/deliverability, secret rotation, and least-privilege credentials.
- [ ] Run `verify`, `verify:phase1`, and any retained-custody verification against the live web/worker/database environment.

**Exit:** no open launch-blocking defect; production operations and recovery are demonstrated, not assumed.

### Milestone 5 — Staged beta launch

**Status:** Not started. Begin only after the launch candidate exits Milestone 4 without open blockers.

1. **Internal alpha:** developer/admin accounts and synthetic data; verify telemetry and support procedures.
2. **Trusted pilot:** 3–5 power sellers, one relay store, and a small buyer group; shadow every deal and collect structured feedback.
3. **Invite-only beta:** approximately 20–50 members; seed real inventory, keep the Facebook group running in parallel, and publish clear support hours.
4. **Expansion gate:** widen access only after the beta has completed real straight-sale, auction, payment-handshake, and relay-custody transactions with no unresolved trust or custody incident.

Track at minimum:

- listing creation completion and publish failure rate;
- claim/bid-to-completed-deal conversion;
- time spent in each transaction/custody state;
- renege, dispute, return, and overstay counts;
- notification delivery failure rate;
- admin/support interventions per completed deal;
- mobile usability defects and user-reported confusion by route.

## 5. Recommended release gates

### Gate A — UI complete

- All launch routes use the shared system and pass desktop/mobile review.
- No critical action depends on unexplained domain language.
- Empty, loading, error, permission, and success states exist for critical routes.

### Gate B — Admin complete

- Admin access is enforced server-side.
- An operator can support members, listings, transactions, stores, custody, and notification failures without SQL.
- Every admin write is reasoned and auditable.

### Gate C — Launch candidate

- Automated checks, browser flows, and production build pass.
- Live phase verification scripts pass with the deployed worker.
- Monitoring, backups, and restore are proven.
- Legal/community/support content is published.

### Gate D — Public expansion

- The pilot has completed real deals across both direct and relay fulfillment.
- No unresolved payment/custody integrity defect exists.
- Support load is manageable and beta feedback shows users understand their next action.

## 6. Post-beta sequence

After the core beta is stable, revisit deferred capabilities only when evidence justifies their cost and operational complexity:

1. Evaluate Brevo SMS for high-value events, including deliverability, cost per message, opt-in, and fallback behavior.
2. Replace auction polling with SSE only when measured usage justifies it.
3. Design and pilot paid pickup/delivery only after an operator model that does not depend on store staff has been approved.
4. Do not plan WhatsApp notifications, WhatsApp OTP, or a store WhatsApp bot unless the product direction changes explicitly.

Then move into Phase 4 only after the core product has repeat transactions and known seller needs:

- [ ] Validate the vouch model and ship it only if it adds a trust signal that the objective record does not already provide.
- [ ] Define and launch the power-seller package: listing limits, verification criteria, bulk tools, analytics, and billing for CollectTT's own service.
- [ ] Add promoted listings with explicit labeling, placement rules, expiry, and admin controls.
- [ ] Add seller analytics focused on actionable measures rather than vanity totals.
- [ ] Build grading-concierge intake and chain-of-custody tracking as a separate operational flow.
- [ ] Add sponsorship inventory with frequency limits and clear separation from organic listings.
- [ ] Review costs, support load, conversion, repeat usage, and incident history before opening general registration.

For planning purposes, the current beta roadmap is **complete** when the stable public product includes the hardened Phase 0–2 core, the platform-admin area, the production-ready UI, email/in-app communications, and any explicitly approved retained custody capability. The invite-only beta is an earlier release gate, not a claim that every deferred capability is finished.

## 7. Immediate next actions

These are the next concrete tasks, in order:

1. Correct the event-specific email CTA destinations and labels, then test the rendered HTML in real mail clients.
2. Finish Brevo DNS authentication and run one real verification, password-reset, and deal-notification delivery.
3. Confirm both localhost and production Google callbacks, including an existing-user
   same-email linking case.
4. Complete a bounded dependency-upgrade/security pass before exposing the beta.
5. Finalize the no-store-staff cleanup/deprecation decision and capture the current uncommitted landing/browse/listing/deal UI work as one bounded baseline.
6. Create `DESIGN.md` and a route/state inventory before redesigning the remaining pages.
7. Implement the shared shell and primitives, then finish listing management, member notifications, and profile editing.
8. Add audited support actions to the admin listing and deal detail views with required reasons and safe state checks.
9. Add member notification health, then test rejected and failed attempts across all admin mutations.
10. Add browser E2E and accessibility coverage while each critical surface is completed, not after all UI work.
11. Provision staging, run all retained live verification scripts, and rehearse with pilot users.

## 8. Latest verification snapshot

As of 12 September 2026, the current tree passes TypeScript checking and an optimized Next.js production build.
The full Vitest run was started but did not complete in the current environment, so the historical **174-test**
baseline remains a release check rather than a current claim. These checks do not replace the pending live Google
OAuth callback, Brevo delivery, browser-flow, accessibility, and worker verification tests.
