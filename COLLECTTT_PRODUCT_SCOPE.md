# CollectTT Product Scope and Implementation Specification

**Status:** Product scope baseline for codebase gap analysis  
**Version:** 1.0  
**Date:** 2026-09-12  
**Primary audience:** CollectTT product owner and implementation agents  
**Market context:** Trinidad and Tobago collectibles marketplace

## 1. Purpose

This document freezes the agreed CollectTT product direction and translates it into implementation-ready requirements. It is intended to be compared against the existing CollectTT codebase so that implemented behavior, partial implementations, gaps, conflicts, and obsolete features can be identified before an execution plan is created.

The v1 product loop is:

> **List → Discover → Commit → Transact → Build Trust → Repeat**

CollectTT v1 is a free, structured collectibles marketplace. Its primary promise is to make selling easier than Facebook, Instagram, and WhatsApp by keeping listings discoverable, supporting fixed-price and auction sales, coordinating transactions, and producing behavioral transaction history. CollectTT does not process ordinary v1 payments and does not provide item authentication.

Featured Listings move to **v1.5**. Collect Protect, SMS, and advanced seller capabilities are not v1 dependencies.

## 2. Requirement language and analysis rules

The terms **must**, **should**, and **may** are normative:

- **Must** means required for the named release.
- **Should** means the preferred baseline; a codebase comparison should flag a deviation but may recommend a justified alternative.
- **May** means optional.
- **Open decision** means the product owner has not yet fixed the behavior. Codex must not silently invent a final policy.

When comparing this specification with the repository, classify each requirement as:

- **Implemented** — behavior exists and is verified by code and tests.
- **Partial** — some of the behavior exists, but the requirement is incomplete.
- **Missing** — no implementation was found.
- **Conflicting** — implemented behavior contradicts this specification.
- **Unknown** — evidence is insufficient or depends on external configuration.
- **Out of scope present** — code exists for a feature deliberately excluded from that release.

## 3. Release boundaries

### 3.1 v1 launch scope

v1 must include:

- Accounts with separate private account names and public display names.
- A required private phone number collected during onboarding, without phone verification.
- Seller profiles and behavioral Trust Snapshots.
- Manual fixed-price and auction listing creation.
- Drafts, duplication, expiration, relisting, and sold-outside-CollectTT handling.
- Global keyword search, practical filters, and deterministic sorting.
- Immediate fixed-price reservation after a deliberate buyer confirmation.
- Optional fixed-price buyer offers below the asking price, with seller accept/reject
  controls and an atomic accepted-offer reservation.
- Binding auctions, anti-sniping, and winner/default handling.
- Structured cash-meetup and bank-transfer transaction workflows.
- Seller-defined reusable meetup and payment choices.
- Transaction deadlines, reminders, objective expiry automation, and support extensions.
- Contextual reporting and support.
- Progressive behavioral restrictions.
- An admin application with intervention tools and immutable audit history.
- Transactional email notifications.
- Marketplace, payment, privacy, and authenticity disclaimers.

### 3.2 v1.5 scope

v1.5 introduces **Featured Listings** as the first monetization layer, after marketplace activity makes placement valuable.

### 3.3 v2 scope

v2 candidates are:

- Collect Protect, including protected card payments and a transparent protection/service fee.
- SMS notifications.
- User blocking, if abuse and safety evidence justify it.
- Category-specific discovery fields and filters where real inventory demands them.
- Additional transaction automation supported by production evidence.

Items in this section are directional, not complete v2 specifications. Each requires its own product and technical design before implementation.

### 3.4 Deferred or not planned

- **Pro Seller subscription:** not planned unless high-volume seller demand proves a need.
- Bulk spreadsheet listing import.
- Inventory-management suites.
- Seller analytics and scheduled listings.
- Complex storefront customization.
- In-app chat or messaging.
- Built-in meetup scheduling.
- Government-ID/KYC verification and verification badges.
- Written reviews, star ratings, or a numerical trust score.
- Algorithmic recommendation feeds.
- Proxy or maximum automatic auction bidding.
- Reserve prices.
- Self-service bid retraction.
- Seller bank-account storage.
- Admin impersonation.
- Automatic listing takedown based only on report volume.
- Commission on ordinary direct/off-platform payments.
- Collectible authentication claims or services in v1.

## 4. Users, roles, and permissions

### 4.1 Marketplace user

A marketplace user may act as both buyer and seller through one account.

- `account_name` and `display_name` must be separate fields.
- The public UI must use the display name where a public identity is needed.
- The account name must remain private unless a separate policy explicitly requires disclosure.
- A phone number is required during onboarding and remains private until a Transaction connects the two parties.
- A new buyer must have no more than **one active reservation** at a time.
- A seller must not approve or reject a buyer before a valid fixed-price reservation is created.
- Business identity may eventually be represented, but v1 must not require materially different marketplace functionality for business and individual accounts.

### 4.2 Support and administrator

Admins must use explicit, permission-controlled actions rather than user impersonation. Every material admin action must record:

- acting admin identifier;
- action type;
- target object and identifier;
- before and after values where applicable;
- reason or internal note;
- timestamp.

Audit entries must be append-only to ordinary admin users.

## 5. Core marketplace and listings

### 5.1 Listing types

- A listing must be either **fixed price** or **auction**, never both simultaneously.
- v1 listings are free to create and publish.
- Lots or bundles are represented as ordinary listings; no special lot engine is required.
- A listing represents one sellable item/lot. A fixed-price listing may optionally
  accept buyer offers below the asking price; an offer is a proposal, not a
  reservation. Multi-quantity inventory behavior is not established and must not be
  assumed without product-owner approval.

### 5.2 Required listing data

A published listing must include:

- title;
- description;
- game or category;
- condition;
- one or more images;
- fixed price, or auction starting price and a predefined duration;
- at least one seller-accepted meetup option;
- at least one seller-accepted payment option.

Set may be captured where relevant and must be filterable if present. Category-specific fields such as rarity, year, grading company, card number, or language are not universal v1 requirements.

### 5.3 Listing creation and reuse

- Sellers must create listings manually in v1.
- Sellers must be able to save a draft.
- Sellers must be able to duplicate an existing listing into a new draft.
- Duplicate and relist operations must preserve images and listing details while creating a distinct listing record.
- The relist flow must allow the seller to adjust price and other editable details before publishing.
- Sellers must be able to mark a listing **Sold outside CollectTT**. This closes the listing without creating verified CollectTT transaction history.

### 5.4 Editing and cancellation rules

- An active fixed-price listing may be edited until it is reserved.
- A reserved listing must not allow seller edits to transaction-relevant fields.
- An auction may be edited before its first valid bid.
- After its first valid bid, an auction must be locked against edits and seller cancellation.
- A no-bid auction may be ended according to the normal listing-management policy.
- Admins may intervene when support or safety requires it; the action must be audited.

### 5.5 Expiration

- Fixed-price listings must expire automatically after a platform-configured duration.
- **Provisional baseline:** 30 days. This value remains configurable because the exact duration was not explicitly finalized.
- Expiration must notify the seller and expose a quick relist action.
- Auctions expire at the auction end time, subject to anti-sniping extensions.

## 6. Search, filtering, and discovery

- Global keyword search must work across categories and return all relevant matching listings.
- Search must at minimum consider listing title and description. If structured game/set data exists, it should also contribute to matching.
- v1 filters must include:
  - sale type;
  - location;
  - game or category;
  - set, where applicable;
  - condition;
  - price range.
- The general marketplace default sort must be **Newest**.
- Auction-specific views must emphasize **Ending Soon**.
- Results must not depend on a personalized or algorithmic recommendation engine.
- Pagination or cursor behavior must produce stable results without duplicates or omissions while browsing.

## 7. Seller preferences, meetup, and payment rules

- Sellers must be able to maintain reusable meetup locations.
- Sellers must be able to define default selling preferences for meetup and payment methods.
- Listing creation should prefill seller defaults but allow per-listing adjustment.
- Buyers may choose only from the meetup and payment options enabled by the seller for that listing.
- v1 does not schedule a precise meetup time. Once contact information is revealed, the parties arrange timing themselves.
- v1 payment methods must support:
  - cash meetup;
  - direct bank transfer.
- CollectTT must not store seller bank-account details in v1.
- The product must avoid presenting bank-transfer screenshots as proof that funds cleared.

The interaction principle is: make the seller's predefined choices the default, while
allowing an explicit, seller-controlled offer path on fixed-price listings that opt in.

## 8. Fixed-price commitment flow

### 8.1 Reservation

1. The buyer selects an allowed meetup option and payment method.
2. The UI shows a strong confirmation explaining that the action is a purchase commitment and that failure may affect trust and buying/bidding access.
3. The buyer deliberately confirms.
4. The system atomically creates the transaction and moves the listing from `ACTIVE` to `RESERVED`.
5. Seller approval is not required.
6. The system immediately reveals each party's phone number to the other.
7. The applicable deadline begins and both parties receive confirmation email.

The reservation operation must be concurrency-safe: at most one buyer can reserve a listing.

### 8.2 Cancellation

- v1 must not expose casual self-service cancellation after commitment.
- A buyer claiming error must contact the seller or support.
- Support may cancel a transaction and decide whether the outcome is neutral, recorded as an issue, or restriction-worthy.
- Seller failure must be tracked as seriously as buyer failure.
- A formal dispute must suspend automatic blame until admin review.

### 8.3 Fixed-price offers

Offers are a supported v1 product flow, separate from auction fallback offers:

1. A seller opts a fixed-price listing into offers with `acceptsOffers`.
2. A buyer chooses one of the seller's allowed meetup/payment choices and submits a
   price below the asking price. A pending offer does not reserve the listing.
3. The seller may accept or reject each pending offer. Accepting one atomically
   reserves the listing and opens the standard transaction at the offered amount.
4. A buyer may cancel a pending offer before the listing is reserved; an accepted
   offer cannot be casually cancelled by either party.
5. Competing pending offers remain auditable while the accepted deal is open and are
   closed only when the accepted transaction reaches its payment-confirmed point.
6. Offer creation, acceptance, rejection, cancellation, and notifications are
   idempotent and authorization-checked. Every transition is visible in the
   listing/deal history and is safe to retry.

## 9. Auction rules

### 9.1 Auction configuration

- Sellers must select from platform-defined auction durations.
- Exact duration choices are configurable and remain an open product value.
- The starting bid must represent the lowest amount the seller is willing to accept.
- Reserve prices are prohibited in v1.
- Proxy/max bidding is prohibited in v1.

### 9.2 Bidding

- Bids are binding once confirmed.
- Before bidding, the bidder must select an allowed meetup option and payment method and accept the commitment warning.
- The system must reject bids below the valid next amount, bids after the effective end time, and attempts by ineligible/restricted users.
- Bid placement and current-price updates must be atomic.
- Self-service bid retraction is prohibited. Support may retract or invalidate a bid and must record the reason in the audit log.
- The seller must not cancel or materially edit an auction after the first valid bid.

### 9.3 Anti-sniping

- A valid bid placed during the final **2 minutes** must extend the effective auction end time by **2 minutes**.
- The rule must repeat for every qualifying late bid.
- All affected bidders/watchers must be notified by email of an extension where notification relevance is established.
- The server-authoritative effective end time controls acceptance, not the client's displayed clock.

### 9.4 Auction close and default

1. At the effective end time, the highest valid bidder becomes the winner.
2. A transaction is created using the meetup/payment selections already made by the winner.
3. The listing becomes `RESERVED`, and the standard transaction workflow begins.
4. If the winner reneges, the system records the outcome, applies the progressive restriction policy, and releases the winner.
5. The next-highest eligible bidder is **offered** the item at that bidder's last valid bid; they are not automatically committed.
6. The offered bidder must explicitly accept within a platform-configured offer window.
7. If accepted, a new transaction is created. If declined or expired, the offer may proceed to the next eligible bidder or end without sale according to an auditable platform rule.

## 10. Transaction model and states

CollectTT coordinates the transaction but does not hold or verify ordinary v1 funds.

### 10.1 Canonical transaction states

The implementation should support the following canonical state model or a demonstrably equivalent one:

| State | Meaning | Allowed next states |
|---|---|---|
| `PENDING_ACTION` | Reservation/win exists and the parties must take the next required action | `IN_PROGRESS`, `DISPUTED`, `CANCELLED`, `EXPIRED` |
| `IN_PROGRESS` | Payment/meetup/handoff coordination is underway | `AWAITING_CONFIRMATION`, `DISPUTED`, `CANCELLED`, `EXPIRED` |
| `AWAITING_CONFIRMATION` | One party marked a milestone and the counterparty must confirm | `COMPLETED`, `DISPUTED`, `CANCELLED`, `EXPIRED` |
| `DISPUTED` | Automatic completion and automatic fault assignment are paused for admin review | `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `EXPIRED` |
| `COMPLETED` | Required transaction confirmation or approved auto-completion occurred | terminal |
| `CANCELLED` | Seller/support ended the transaction before completion | terminal |
| `EXPIRED` | An objective deadline passed without the required action | terminal |

The implementation may use more granular states, but it must preserve the transition rules, responsible actor, timestamps, and a complete event timeline.

For launch v1 cash meetups, the buyer's single **I paid and collected the item**
action records both milestones atomically and may move directly from an open deal to
`COMPLETED`; `AWAITING_CONFIRMATION` remains relevant to bank-transfer or historical
multi-step rows.

### 10.2 Transaction event record

Each meaningful transition must create an immutable event containing:

- transaction identifier;
- event type;
- actor type and identifier, or `SYSTEM`;
- previous and new state where applicable;
- timestamp;
- optional reason and evidence references.

### 10.3 Cash meetup flow

1. Parties coordinate after phone-number disclosure.
2. At the physical meetup, the buyer hands over cash and receives the item.
3. The buyer completes one action: **I paid and collected the item**.
4. The server atomically records payment confirmed and item received, then completes
   the transaction. The action is idempotent and safe to retry.
5. The seller is notified of completion and may report a problem through support;
   dispute handling remains available after the meetup.

The older seller-handoff/buyer-receipt handshake remains readable for historical
transactions, but it is not the launch v1 cash-meetup experience.

### 10.4 Bank-transfer flow

1. Buyer marks **Payment sent** and may upload a screenshot.
2. The UI labels the screenshot as supporting evidence only.
3. Seller marks **Payment received** only after funds actually clear.
4. Parties complete the item handoff/delivery milestone.
5. The transaction becomes `COMPLETED` after the required confirmations.

Every direct-transfer screen must clearly display:

> **Payments made directly to another user are not protected by CollectTT.**

### 10.5 Deadlines and expiry

- Each transaction type must use platform-configured deadlines rather than seller-authored arbitrary deadlines.
- Deadline reminder emails must be sent at:
  - 50% of the allowed time elapsed;
  - 2 hours remaining;
  - deadline reached.
- Where failure is objectively measurable, deadline expiry must atomically:
  - expire/cancel the transaction;
  - release the reservation;
  - return an eligible fixed-price listing to `ACTIVE` or apply the appropriate auction fallback;
  - record the relevant internal trust event;
  - notify both parties.
- Support must be able to extend a deadline with a reason and audit entry.
- Exact deadline durations and auto-completion periods are open configuration values and must not be hardcoded throughout the codebase.

## 11. Listing state model

The canonical listing lifecycle is:

```text
DRAFT → ACTIVE → RESERVED → SOLD
           │          │
           │          └→ ACTIVE        transaction cancelled/expired when relisting is valid
           └→ EXPIRED                 fixed-price timeout or auction ends without a completed sale

ACTIVE → SOLD_OUTSIDE                  seller closes an externally completed sale
EXPIRED/SOLD_OUTSIDE → DRAFT           duplicate/relist creates a new listing record
```

Rules:

- `DRAFT` is visible only to its owner and authorized admins.
- `ACTIVE` is discoverable and eligible for reservation or bidding.
- `RESERVED` is not available to other buyers.
- `SOLD`, `EXPIRED`, and `SOLD_OUTSIDE` are terminal for that listing record.
- Relisting must create a new lifecycle/record rather than erasing the prior history.
- Auction settlement must be idempotent; repeated jobs must not create duplicate winners or transactions.

## 12. Trust Snapshot and behavioral history

### 12.1 Public Trust Snapshot

The public Trust Snapshot must be factual and platform-generated. It must not include stars, a composite score, or written reviews.

Display:

- member since;
- completed purchases;
- completed sales;
- successful/completed auctions;
- recent transaction issues;
- protected transactions completed, once Collect Protect exists.

The protected-transactions field may be reserved in the data model during v1 but should not be misleadingly displayed before the feature exists.

### 12.2 Internal behavioral events

The platform must internally retain relevant behavioral events, including:

- buyer failure to complete a commitment;
- seller failure to honor a committed sale;
- auction-winner default;
- support-approved neutral cancellation;
- dispute creation and resolution;
- restriction application and removal;
- successful completion.

Only transactions completed through the CollectTT workflow earn verified positive history. Moving a transaction outside CollectTT is not itself punishable; it simply earns no verified completion.

### 12.3 Recent issues

- Public issues must be derived from adjudicated or objectively established events, not unreviewed allegations.
- Formal disputes must not automatically penalize either party.
- The timeframe and aggregation rules for “recent” remain an open policy/configuration decision.

## 13. Restrictions and abuse controls

Consequences must be progressive rather than an automatic ban after one failure.

**Policy baseline:**

1. First established issue: warning plus behavioral-history event.
2. Repeated issue: short capability restriction.
3. Further repeated abuse: longer restriction and/or manual review.

Restrictions may independently prevent:

- reserving/purchasing;
- bidding;
- creating or publishing listings.

The restriction engine must store scope, reason, source event, start time, end time, status, and admin/system actor. The UI must prevent restricted actions on the server and explain the applicable restriction to the user. Exact thresholds and durations are configurable policy values; example values discussed previously are not final requirements.

## 14. Reporting, support, and moderation

- Users must be able to choose **Report a problem** or **Contact support**.
- Support entry points should be contextual and attach the relevant listing, auction, transaction, or account whenever possible.
- Generic contact support may exist for issues with no applicable object.
- Reporter identity must remain private from the reported user.
- A report must not automatically remove a listing based on report count.
- Admin review decides whether to leave, warn, restrict, remove, cancel, or otherwise intervene.
- The system should preserve report status, category, description, linked objects, evidence, internal notes, assigned admin, timestamps, and resolution.

## 15. Admin tooling

The v1 admin application is a core launch dependency.

Admins must be able to inspect:

- complete transaction timeline;
- buyer and seller history;
- auction and bid history;
- uploaded evidence;
- reports and support cases;
- public and internal Trust Snapshot history;
- current and historical restrictions;
- listing state/history;
- related audit entries.

Admins must be able to:

- cancel a transaction;
- extend a deadline;
- resolve a dispute;
- reactivate an eligible listing;
- add, remove, or correct a trust event with a reason;
- apply, change, or remove a restriction;
- retract/invalidate a bid or otherwise intervene in an auction;
- remove a listing;
- warn or restrict an account.

Admin actions must be permission-checked, confirmed for high-impact operations, idempotent where jobs/retries are possible, and audited. Admin impersonation is out of scope.

## 16. Notifications

v1 must send transactional **email** notifications. SMS moves to v2. An in-app notification center is not a confirmed v1 requirement.

Required email events include, where relevant to the recipient:

- item reserved;
- valid bid activity;
- outbid, sent immediately;
- auction ending, won, or lost;
- anti-snipe extension;
- next-highest-bidder offer;
- fixed-price offer received, accepted, rejected, or cancelled;
- payment marked sent;
- payment confirmed/received;
- handoff/item-received status change;
- transaction completed;
- transaction disputed or resolved;
- deadline reminders and expiry;
- listing sold or expired;
- restriction applied, changed, or removed.

Notification delivery must be retry-safe and deduplicated so repeated background jobs do not send duplicate messages for the same event. User preferences may control nonessential messages, but commitment, security, restriction, dispute, and deadline messages must not be silently suppressed.

## 17. Privacy, identity, and safety disclosures

- Phone numbers remain private before commitment.
- Upon a valid fixed-price reservation or auction settlement, both parties' phone numbers are revealed immediately to each other.
- The disclosure must be limited to the parties, authorized admins, and necessary service processing.
- A private phone number is required for marketplace actions, but it is not an identity-verification signal and v1 has no government-ID verification or public verification badge.
- CollectTT must not store seller bank details in v1.
- Evidence uploads and report data must not be publicly accessible.
- Reporter identity must not be disclosed to the reported user.
- Authorization checks must protect every nonpublic listing, transaction, bid, report, restriction, evidence, and admin endpoint.

Required authenticity disclaimer:

> **CollectTT does not authenticate collectibles. Buyers are responsible for inspecting and authenticating items unless CollectTT explicitly offers a separate authentication service.**

Required direct-payment disclaimer:

> **Payments made directly to another user are not protected by CollectTT.**

The exact legal wording should be reviewed before launch.

## 18. Featured Listings v1.5

Featured Listings are paid placement attached to an individual listing, not a seller subscription.

### 18.1 Initial packages

| Duration | Launch price |
|---|---:|
| 2 days | TT$5 |
| 5 days | TT$10 |
| 7 days | TT$15 |

Prices must be configurable rather than hardcoded and may be revised after launch.

### 18.2 Placement and ranking rules

- Featured listings may appear on the homepage, in relevant categories, and in search.
- Every paid placement must be visibly labeled **Featured**.
- Organic relevance and usability must be preserved.
- The product should cap consecutive featured results at one or two before showing organic inventory; the exact cap is configurable.
- Auctions may be featured.
- Featured placement must never make an ineligible, inactive, expired, reserved, removed, or sold listing purchasable.

### 18.3 Lifecycle

- A feature period begins at successful activation and ends at its purchased timestamp.
- Featured status ends immediately when the listing becomes reserved, sold, expired, sold outside CollectTT, or removed.
- The clock does not pause.
- No automatic refund is issued when the listing ends early.
- Purchase, payment-provider, refund-exception, and admin-override details require a separate v1.5 payment specification.

## 19. Collect Protect v2 direction

Collect Protect should be designed only after the base marketplace proves real transaction activity. Its intended value is to let users pay by card and obtain an explicitly protected flow.

Future design constraints:

- Display a transparent protection/service fee before commitment.
- Clearly distinguish protected payments from cash and direct bank transfers.
- Feed completed protected transactions into the Trust Snapshot.
- Define custody, settlement, refunds, disputes, chargebacks, fraud controls, and regulatory obligations before implementation.
- Do not imply protection for ordinary direct payments.

This document does not authorize implementation of a payment-holding or protection flow without a separate approved specification.

## 20. Success metrics and launch readiness

The primary proof of product value is completed transactions, not registrations alone.

### 20.1 Baseline targets

- Approximately **100 active listings before public launch**, seeded through direct seller recruitment.
- **50 completed transactions in the first month**.
- At least **20 active sellers in the first month**.

### 20.2 Required measurement

The product should measure:

- active listings;
- new listings and listing activation rate;
- active sellers;
- reservations and auction settlements;
- completed transactions by payment/transaction type;
- reservation-to-completion rate;
- median time to completion;
- expired/cancelled/disputed transaction rate;
- auction-winner default rate;
- repeat buyers and sellers;
- notification delivery failures;
- support case volume and resolution time.

Metric definitions must specify time window, unique-entity rules, and excluded admin/test data.

### 20.3 Operational launch gate

Before public launch, v1 should demonstrate:

- authorization and privacy checks for all sensitive objects;
- concurrency safety for reservation, bidding, auction close, and expiry;
- reliable scheduled jobs for auction close, deadlines, expiry, and email;
- complete admin audit logs;
- tested recovery/idempotency for retried jobs;
- usable contextual reporting and dispute handling;
- production monitoring for failed jobs and notification delivery;
- acceptance tests for the critical end-to-end flows in Section 23;
- legal review of Terms, Privacy Policy, minors policy, and user-facing disclaimers.

## 21. Open decisions

The following decisions remain unresolved and must be surfaced—not guessed—during implementation planning:

1. Minimum age/minors policy and related Terms language.
2. Exact fixed-price listing lifetime; 30 days is provisional.
3. Exact predefined auction duration choices.
4. Minimum bid increment rules.
5. Exact transaction deadlines by payment/fulfillment type.
6. Auto-completion policy for historical handoff rows and any bank-transfer milestone
   that still requires a pending confirmation.
7. Next-highest-bidder offer window and how many bidders may be offered sequentially.
8. Exact restriction thresholds, lookback windows, and durations.
9. Definition and display window for “recent transaction issues.”
10. Detailed bank-transfer handoff milestones when payment and physical exchange occur in different orders.
11. Whether multi-quantity listings are needed.
12. Whether business identity is displayed in v1 and, if so, what evidence supports it.
13. Whether nonessential bid-activity emails are required beyond outbid/win/loss events.
14. Exact retention rules for phone disclosures, reports, audit data, and uploaded evidence.

Prefer configuration and explicit policy tables for unresolved numeric values so final decisions do not require architectural rewrites.

## 22. Explicit v1 non-goals

For avoidance of doubt, v1 must not be delayed to add:

- Featured Listings or any other paid placement;
- Collect Protect or platform-processed card payments;
- commissions on direct transactions;
- SMS or WhatsApp notifications;
- in-app chat;
- exact meetup scheduling;
- seller approval of buyers;
- simultaneous Buy Now and Auction modes;
- public reviews, ratings, or trust scores;
- government-ID/KYC verification;
- public verification badges;
- user blocking;
- recommendation feeds;
- proxy/max bids, reserve prices, or self-service bid retraction;
- bulk imports, inventory suites, analytics, scheduled listings, or storefront customization;
- bank-account storage;
- automated counterfeit detection or automatic takedown by report count;
- administrator impersonation;
- collectible authentication.

## 23. Critical acceptance scenarios

Codex should use these scenarios to evaluate implementation completeness and propose tests.

### Scenario A — Concurrent fixed-price reservation

Two eligible buyers attempt to reserve the same active listing. Exactly one transaction is created, the listing becomes reserved once, only the winning buyer receives contact details, and the other buyer receives an unavailable response.

### Scenario B — New-buyer reservation limit

A new buyer with one active reservation attempts another reservation or an auction action that would create a second active commitment. The server rejects it according to the configured concurrency policy and explains why.

### Scenario C — Cash meetup completion

The buyer completes the single **I paid and collected the item** action after the
meetup. Payment and receipt are recorded atomically, the transaction completes once,
both Trust Snapshots update correctly, and retrying the request creates no duplicate
events.

### Scenario N — Fixed-price offer acceptance

A seller opts a fixed-price listing into offers. A buyer submits a below-ask offer
with an allowed meetup/payment choice; the listing remains active while it is
pending. The seller accepts one offer, the listing is reserved atomically, the
accepted offer opens a normal deal at the offered amount, and competing offers remain
auditable until the accepted deal reaches payment confirmation. Replaying submit,
accept, reject, or cancel requests creates no duplicate offer, reservation, event, or
notification.

### Scenario D — Bank-transfer evidence

The buyer marks payment sent and optionally uploads evidence. The seller—not the upload—confirms cleared funds. The UI shows the direct-payment disclaimer and never labels the upload as verified payment.

### Scenario E — Objective deadline expiry

The required action is not completed by the deadline. One expiry job releases the reservation, returns an eligible fixed-price listing to active, records the correct event, and sends deduplicated emails. Re-running the job changes nothing.

### Scenario F — Dispute before auto-completion

A party reports a problem before auto-completion. The transaction enters disputed state, auto-completion and automatic fault assignment stop, and an admin can inspect the complete timeline and resolve the case with an audit entry.

### Scenario G — Auction anti-sniping

A valid bid in the final two minutes extends the effective end by two minutes. Additional qualifying bids repeat the extension. A close job using an earlier timestamp does not settle the auction.

### Scenario H — Auction edit lock

After the first valid bid, seller attempts to edit or cancel are rejected on the server. An authorized admin may intervene only with a reason and audit record.

### Scenario I — Winner default and fallback offer

The winner fails to complete. The system records the default and offers the item to the next eligible bidder without committing them. Only explicit acceptance creates a transaction.

### Scenario J — Privacy boundary

Before commitment, users cannot retrieve another user's phone number. After a valid reservation, only the two parties and authorized admins can access the disclosed numbers.

### Scenario K — Report moderation

A counterfeit report creates a contextual case but does not automatically remove the listing or reveal the reporter. An admin decision and every resulting action are audited.

### Scenario L — Relist history

An expired or sold-outside listing can be copied into a new draft with preserved media/details and editable price. Publishing creates a new active listing without erasing the original record.

### Scenario M — Featured lifecycle in v1.5

A featured listing is labeled and interleaved with organic results. Reservation ends its featured placement immediately without refund, and expired/sold listings cannot remain eligible for paid placement.

## 24. Guidance for implementation planning

The codebase comparison should treat end-to-end vertical flows as the planning unit, not isolated pages. Each proposed work item should identify:

- user-visible behavior;
- domain/state-model changes;
- database migration needs;
- server/API authorization and validation;
- background jobs and retry/idempotency behavior;
- UI changes;
- notification changes;
- admin capabilities;
- analytics/observability;
- automated tests;
- dependencies and rollout risks.

Prioritize the smallest sequence that proves the v1 loop. Do not recommend v1.5 or v2 work as a prerequisite unless the existing architecture makes a narrowly scoped enabling change unavoidable.

## 25. Ready-to-use Codex comparison prompt

Copy the prompt below into a Codex task opened at the root of the CollectTT repository.

```text
Compare the existing CollectTT codebase against the product specification at:

<PATH_TO_THIS_REPOSITORY>/COLLECTTT_PRODUCT_SCOPE.md

Your goal is to produce an evidence-backed gap analysis and an implementation plan. Do not implement changes yet.

Instructions:

1. Read the complete specification before evaluating the codebase.
2. Inspect repository guidance first, including AGENTS.md, README files, architecture documents, package scripts, schema/migrations, environment examples, tests, and deployment configuration.
3. Trace actual end-to-end behavior across UI, APIs/server actions, database models, background jobs, email delivery, authorization, admin tooling, analytics, and tests. Do not infer that a feature is complete from a route name, component, schema field, mock, or TODO alone.
4. For every normative v1 requirement and every critical acceptance scenario, classify the code as Implemented, Partial, Missing, Conflicting, Unknown, or Out of scope present.
5. Cite concrete evidence using repository-relative file paths and line numbers. Note tests that prove behavior and identify important behavior with no test coverage.
6. Treat configuration-dependent or external-service behavior as Unknown unless the repository provides verifiable evidence. Do not expose secrets or include secret values in the report.
7. Identify current behavior that conflicts with this specification, especially state transitions, permissions, transaction deadlines, auction settlement, privacy, restrictions, admin actions, and notification behavior.
8. Keep v1, v1.5, v2, and deferred/not-planned work separate. Featured Listings are v1.5 and must not be placed on the v1 critical path.
9. Surface every open product decision from the spec. Recommend a safe implementation default where useful, but label it as a recommendation requiring product-owner approval.
10. Identify obsolete, speculative, or premature code that implements deferred features. Recommend whether to leave dormant, feature-flag, simplify, or remove it; do not delete anything.
11. Produce a dependency-ordered implementation plan using vertical slices. For each slice include scope, affected areas/files, schema/API/job/UI/admin/email/test work, dependencies, risks, and a verification checklist.
12. Prioritize correctness and abuse resistance for reservation concurrency, bid placement, anti-sniping, auction close, transaction expiry, privacy/authorization, audit logging, and job idempotency.
13. Include a proposed migration and rollout strategy for any existing production data. Flag irreversible or high-risk migrations.
14. Run only read-only inspection and safe validation commands. Do not modify files, install dependencies, migrate databases, or call production services unless I explicitly approve it.

Deliver the report in this structure:

A. Executive summary
B. Repository architecture relevant to the spec
C. Requirement traceability matrix
D. Critical acceptance scenario results
E. Conflicts and behavioral risks
F. Security, privacy, concurrency, and data-integrity findings
G. Open product decisions requiring answers
H. Dependency-ordered v1 implementation plan
I. v1.5 plan for Featured Listings
J. v2 and deferred-feature observations
K. Test strategy and launch-readiness checklist
L. Questions or unknowns that could not be resolved from the repository

End with a short recommended first implementation milestone and explain why it is the best place to start.
```

---

This specification records product intent. Where implementation, law, payment-provider rules, or marketplace evidence reveals a conflict, document the conflict and return it for explicit product-owner decision rather than silently changing the intended behavior.
