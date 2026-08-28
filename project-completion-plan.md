# CollectTT Project Completion and Launch Plan

**Created:** 26 August 2026  
**Planning basis:** `product-design-document.md`, `README.md`, the current application routes, services, schema, and automated checks  
**Current position:** Phase 2 functionality is complete; the product is entering launch preparation rather than early implementation

## 1. Executive status

CollectTT already has the difficult domain foundation: accounts, listings, auctions, claims and backups, transaction state, reputation, ratings, relay custody, and the store counter workflow are implemented. The automated baseline is healthy:

- 175 automated tests pass across auth safety, domain, database, browse, trading, and custody suites.
- TypeScript checking passes.
- The optimized Next.js production build succeeds.
- The repository contains deployment definitions for a web process, worker, and Postgres.

The project is **feature-capable but not yet launch-ready**. The remaining critical path is the product layer around the domain:

1. establish a coherent, responsive UI system across every member and staff route;
2. build a genuine platform-admin console, separate from the existing relay-store board;
3. close launch-critical workflow gaps such as notification visibility and seller listing management;
4. add browser-level testing, security/abuse controls, monitoring, backup/restore proof, and production smoke tests;
5. run a staged private beta before committing to the whole Phase 3 roadmap.

The recommended launch target is an **invite-only beta using email and in-app notifications, peer-to-peer settlement, and relay-store custody**. WhatsApp, the paid pickup/delivery rail, WhatsApp OTP, and SSE should not block that beta.

## 2. What exists today

| Area | Status | Evidence and remaining concern |
|---|---|---|
| Accounts and profiles | Auth cutover implemented; live-provider validation pending | Better Auth now provides Google-first sign-in plus verified email/password, email verification, and password recovery. Secure same-email account linking preserves stable user ownership. Google production callbacks and a real Brevo delivery still need to be exercised. Profile editing and polished onboarding remain. |
| Listing creation and browse | Built | Category-aware listing creation, image processing, filters, pagination, straight sales, and auctions exist. Seller edit/withdraw/manage controls and general text search are not evident. |
| Trading lifecycle | Built and tested | Atomic claims, backup queue, bidding, soft close, payment handshake, renege handling, and promotion are covered by flow tests. |
| Trust and reputation | Built and tested | Objective counters, restrictions, blind ratings, and public trust pages exist. Admin review/override tooling does not. |
| Relay custody | Built and tested | Store selection, drop-off code, shelf clock, payment-gated release, pickup, return, and overstay behavior exist. |
| Store operations | Functional, visually unfinished | `/store` and `/store/[storeId]` provide staff access and counter actions. This is a store-clerk tool, not the platform-admin side. |
| Platform administration | Not built | The schema has member roles/statuses and the state machines recognize an admin actor, but there is no `/admin` route, admin session guard, moderation queue, user management, listing intervention, transaction support view, store/staff management, or operations dashboard. |
| Notifications | Backend and Brevo adapter built; member UI missing | In-app rows, console/Brevo email delivery, preferences schema, and worker dispatch exist. Brevo sender-domain authentication and live deliverability remain launch checks. No notification inbox or member-facing preference controls are visible in the route tree. |
| UI and design system | In progress, inconsistent | Landing, browse, listing detail, and deal pages have newer styling, while profile, listing creation, store tools, tables, forms, errors, and responsive states still rely on a broad shared stylesheet and uneven page-level patterns. There is no durable `DESIGN.md` yet. |
| Phase 3 | Not started | WhatsApp adapter/bot, paid pickup and delivery, WhatsApp OTP, and SSE remain future work. |
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
- [x] Passed 175 tests, TypeScript checking, the UI detector, and a production build.
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
- A relay-store clerk can receive, hold, release, return, and mark an item collected from a phone or counter computer.
- An administrator can find a user, listing, transaction, holding, store, or failed notification and take a small set of audited support actions.
- Every critical flow works at mobile widths, with keyboard access, visible focus, readable errors, and useful empty/loading/success states.
- Production has monitoring, rate limiting, backups, a tested restore procedure, and a repeatable release/smoke-test checklist.

### Explicit beta non-goals

- Holding or processing buyer/seller funds.
- WhatsApp as a required notification or authentication channel.
- Full-service pickup and delivery.
- Power-seller subscriptions, promoted listings, grading concierge, or sponsorships.
- A large analytics suite or highly configurable back office.
- Replacing the existing domain/state-machine design.

## 4. Priority roadmap

### Milestone 0 — Freeze the beta contract and baseline

**Goal:** stop the launch target from expanding while the UI is being rebuilt.

- [ ] Confirm the invite-only beta scope and explicitly defer the Phase 3 non-goals above.
- [ ] Define the four launch personas: buyer, seller, relay-store staff, and platform administrator.
- [ ] Inventory every route and record its happy, empty, loading, validation, permission, and failure states.
- [ ] Turn the current visual direction into `DESIGN.md`: typography, color, spacing, surfaces, buttons, fields, badges, alerts, tables, navigation, responsive rules, and motion.
- [ ] Decide the minimum admin interventions and which actions are read-only, reversible, or destructive.
- [ ] Capture the existing dirty UI work before broad redesign work begins; do not mix unrelated changes into launch commits.

**Exit:** one agreed beta scope, a route/state inventory, and a durable UI contract.

### Milestone 1 — Rebuild the shared product shell

**Goal:** make every surface feel like one product before polishing individual pages.

- [ ] Replace the current always-visible sign-in/profile navigation ambiguity with authenticated and signed-out states.
- [ ] Establish desktop navigation and a deliberate mobile tab/menu model, including access to notifications and store/admin tools when authorized.
- [ ] Extract reusable primitives for page headers, cards, data rows, form fields, filters, badges, alerts, dialogs/confirmations, empty states, skeletons, and tables.
- [ ] Split the monolithic styling into durable tokens and component/surface styles without changing domain behavior.
- [ ] Standardize form validation, pending/disabled states, destructive confirmations, redirect messages, and error recovery.
- [ ] Verify color contrast, focus treatment, reduced motion, touch targets, and content reflow at small mobile widths.

**Exit:** new work can be composed from shared primitives; navigation and responsive behavior are consistent.

### Milestone 2 — Finish the member experience

**Goal:** let buyers and sellers complete common work without hidden knowledge or operator help.

Work in this order:

1. **Listing creation and management**
   - [ ] Redesign the creation flow with progressive sections, image status, category-specific guidance, review, and clear publish success.
   - [ ] Add seller controls for eligible edit, withdraw/end, and relist operations with state-aware safeguards.
   - [ ] Replace the minimal profile listing table with a usable seller inventory view.
2. **Browse and listing detail**
   - [ ] Finish mobile browse/filter behavior, image fallbacks, auction urgency, seller trust cues, and clear settlement/fulfillment explanations.
   - [ ] Test realistic long titles, missing images, many attributes, ended listings, full backup queues, and bid errors.
3. **Deals and trust**
   - [ ] Make the next required action unmistakable for each actor and state.
   - [ ] Clarify deadlines, counterparty responsibilities, custody location/code, dispute feedback, and rating availability.
   - [ ] Add transaction-level support/report entry points that create an auditable admin work item or, for the beta, a clearly documented support channel.
4. **Member utilities**
   - [ ] Add an in-app notification inbox with unread state and links to the affected item/deal.
   - [ ] Add notification preferences for the channels that are actually enabled.
   - [ ] Add profile editing for launch-relevant identity/contact fields and explain what is public.
5. **Onboarding and content**
   - [ ] Add first-run guidance for buyers, sellers, and relay users.
   - [ ] Add concise trust/safety, relay, payment, and auction explanations at the point of use.
   - [ ] Add Terms, Privacy, Community Rules, support contact, and prohibited-item guidance before external testing.

**Exit:** seeded beta users can complete the buyer and seller journeys without developer guidance.

### Milestone 3 — Build the two operational surfaces

#### 3A. Relay-store staff board

- [ ] Redesign the board for an `Operate` context: large counter controls, urgent shelf items first, fast code entry, clear refusals, and minimal scrolling.
- [ ] Make destructive/irreversible actions require explicit confirmation and show the item/code being changed.
- [ ] Improve phone/tablet layout and test poor connectivity, duplicate submission, stale tabs, and expired states.
- [ ] Add a scoped history/search view so staff can find an older settled item without exposing other stores.

#### 3B. Platform-admin console

Start narrow and read-heavy. Every write must require an admin role, a reason, and an audit event.

- [ ] Add an admin session/authorization boundary and tests proving ordinary members and store staff cannot enter or call admin actions.
- [ ] Add an overview with actionable counts: open/overdue deals, active auctions, custody overstays, failed notification deliveries, restricted/suspended users, and recent system failures.
- [ ] Add member lookup and detail: profile/status, objective reputation, restrictions, recent deals, and audited suspend/reactivate/restriction actions.
- [ ] Add listing lookup and detail: seller, status, bids/claims, images, and audited hide/unpublish/end actions for policy or safety issues.
- [ ] Add transaction/support detail: both state tracks, deadlines, candidates, notification history, and append-only events. Prefer guided corrective actions over arbitrary state editing.
- [ ] Add relay-store management: store status, address, size rules, custody windows, and staff assignments.
- [ ] Add notification operations: inspect failed deliveries, error detail, and safe retry.
- [ ] Add an admin audit log that records actor, target, action, reason, before/after context, and timestamp.

**Exit:** the beta can be supported without direct database edits or exposing store-scoped tools as platform administration.

### Milestone 4 — Test and harden the launch candidate

#### Automated coverage

- [ ] Keep the current 175 auth/domain/DB/flow tests green.
- [ ] Add tests for seller edit/withdraw permissions and invalid state transitions.
- [ ] Add admin authorization and audit-log tests for every admin action.
- [ ] Add notification inbox/preferences and failed-delivery retry tests.
- [ ] Add browser end-to-end tests for sign-in, create listing, claim, bid, payment handshake, rating, relay drop-off/release/pickup, and the principal admin support flow.
- [ ] Add accessibility checks to the browser suite for the primary route templates.
- [ ] Make typecheck, test, production build, and browser smoke tests required checks for a release.

#### Manual acceptance matrix

- [ ] Run every critical flow as buyer, seller, store staff, and admin.
- [ ] Test current iPhone/Android-sized viewports plus desktop, keyboard-only operation, zoom, slow network, repeated submits, expired links, and stale pages.
- [ ] Test realistic minimum/typical/maximum content, including missing images, long names, large listing histories, many bids, and 25+ store audit rows.
- [ ] Verify all notification copy and links using actual email delivery and in-app rows.
- [ ] Conduct a relay-store counter rehearsal with a person who did not build the product.

#### Security and operations

- [ ] Add rate limits for sign-in, sign-up, verification/reset email, image uploads, claims, bids, and sensitive admin actions.
- [ ] Review authorization at every server action and direct-object route; UI hiding is not a security boundary.
- [ ] Add production error monitoring for both web and worker processes and alert on repeated job failures.
- [ ] Provide a dedicated health/readiness endpoint that checks the web process without using a database-heavy public page.
- [ ] Prove database migrations on a production-like copy and document rollback/forward-fix policy.
- [ ] Enable automated Postgres backups, run the periodic export promised in the product document, and complete one restore drill.
- [ ] Verify R2 upload/variant/public delivery, Brevo domain authentication/deliverability, secret rotation, and least-privilege credentials.
- [ ] Run `verify`, `verify:phase1`, and `verify:phase2` against the live web/worker/database environment.

**Exit:** no open launch-blocking defect; production operations and recovery are demonstrated, not assumed.

### Milestone 5 — Staged beta launch

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

After the core beta is stable, implement Phase 3 in the order that produces measurable value:

1. Start or finish Meta Business verification in parallel; it must not hold the main release hostage.
2. Add the WhatsApp notification adapter for only high-value events and monitor cost/delivery quality.
3. Add the store WhatsApp bot only if store-board usage shows a real adoption problem.
4. Replace auction polling with SSE when measured usage justifies it.
5. Design and pilot the paid pickup/delivery rail with real zone, custody, exception, and pricing rules.
6. Add WhatsApp OTP only after the notification channel is operationally reliable.
7. Pilot the complete delivery flow with admin dispatch, courier custody, proof of handoff, exception handling, and per-zone pricing before making it generally available.

Then move into Phase 4 only after the core product has repeat transactions and known seller needs:

- [ ] Validate the vouch model and ship it only if it adds a trust signal that the objective record does not already provide.
- [ ] Define and launch the power-seller package: listing limits, verification criteria, bulk tools, analytics, and billing for CollectTT's own service.
- [ ] Add promoted listings with explicit labeling, placement rules, expiry, and admin controls.
- [ ] Add seller analytics focused on actionable measures rather than vanity totals.
- [ ] Build grading-concierge intake and chain-of-custody tracking as a separate operational flow.
- [ ] Add sponsorship inventory with frequency limits and clear separation from organic listings.
- [ ] Review costs, support load, conversion, repeat usage, and incident history before opening general registration.

For planning purposes, the original project roadmap is **complete** when the stable public product includes the hardened Phase 0–2 core, the platform-admin and store tools, the production-ready UI, Phase 3 communications/delivery, and the selected Phase 4 revenue features. The invite-only beta is an earlier release gate, not a claim that every roadmap feature is finished.

## 7. Immediate next actions

These are the next concrete tasks, in order:

1. Finish Brevo DNS authentication and run one real verification and password-reset delivery.
2. Confirm both localhost and production Google callbacks, including an existing-user
   same-email linking case.
3. Complete a bounded dependency-upgrade/security pass before exposing the beta.
4. Confirm that the platform-admin scope in Milestone 3B matches the intended admin side.
5. Finish the current uncommitted landing/browse/listing/deal UI work as one bounded baseline.
6. Create `DESIGN.md` and a route/state inventory before redesigning the remaining pages.
7. Implement the shared shell and primitives, then finish listing creation/management and member notifications.
8. Build the admin authorization boundary and read-only overview before adding admin mutations.
9. Add browser E2E coverage while each critical surface is completed, not after all UI work.
10. Provision staging, run all three live verification scripts, and rehearse with pilot users.

## 8. Latest verification snapshot

As of 27 August 2026, the authentication/Brevo cutover and fixed-price offers pass **175 automated tests**,
TypeScript checking, the frontend UI detector, and an optimized Next.js production build.
These checks do not replace the pending live Google OAuth callback and Brevo delivery tests.
