# CollectTT product contract

<!-- impeccable:product-schema 1 -->

This file is the concise product contract for the v1 marketplace. The complete,
normative requirements and acceptance scenarios live in
[COLLECTTT_PRODUCT_SCOPE.md](COLLECTTT_PRODUCT_SCOPE.md).

## Platform

CollectTT is a free web marketplace for trading cards, comics, and collectibles in
Trinidad & Tobago. Its promise is to make selling easier than scattered social posts
while keeping ordinary payments peer to peer.

The loop is **List → Discover → Commit → Transact → Build Trust → Repeat**.

## Users and identity

A marketplace user can buy and sell through one account. The private account name is
used for account operations; the public display name is the only public identity
field. A phone number is required during onboarding. Phone numbers stay private before
commitment and are disclosed only to the two
transaction parties or an authorized, audited administrator.

Support and administrators use explicit, permission-checked actions. Every material
admin action records actor, target, reason, before/after context, and timestamp in an
append-only audit trail. Admin impersonation is not supported.

## v1 capabilities

- Manual fixed-price and auction listings with title, description, category/condition,
  image(s), price or starting bid, and predefined duration.
- Drafts, duplicate/relist into a new record, automatic expiration, and Sold outside
  CollectTT closure.
- Global keyword search, practical filters, stable pagination, and deterministic
  Newest/Ending Soon sorting.
- Seller-defined reusable meetup and payment choices, with cash meetup and direct bank
  transfer as the v1 payment methods. CollectTT does not store bank details or funds.
- Cash meetups use one buyer action after the exchange: **I paid and collected the
  item** records payment and receipt together. Historical hand-off/receipt rows remain
  readable but are not the launch experience.
- Fixed-price listings may opt into buyer offers below the asking price; pending offers
  do not reserve the listing, and seller acceptance atomically opens a normal deal at
  the offered amount.
- Deliberate atomic fixed-price reservation and binding bids with two-minute
  anti-sniping, winner/default fallback, deadlines, reminders, disputes, and
  idempotent automation.
- Transaction event timelines, factual behavioral Trust Snapshots, progressive
  restrictions, contextual reporting/support, transactional email, and admin tools.
- Marketplace, direct-payment, privacy, and authenticity disclaimers in the relevant
  flows.

## Explicit v1 non-goals

Store staff, store applications, or custody entry points; reserve prices; auction buyouts;
proxy/max bids; self-service bid retraction;
seller-authored payment windows; ratings, written reviews, or numerical trust scores;
Pro subscriptions; raffles; Featured Listings; Collect Protect; SMS/WhatsApp;
in-app chat; payment holding; government-ID/KYC; recommendation feeds; bulk imports;
inventory suites; storefront customization; bank-account storage; automatic
counterfeit detection/takedown; and administrator impersonation.

Featured Listings are v1.5. Collect Protect and SMS are v2 candidates. Deferred features
must not be placed on the v1 critical path.

## Legacy compatibility

Historical custody records, store applications, and their schema are retained for
controlled inspection and migration planning. Fixed-price offers are a supported v1
flow; the single `COLLECTTT_LAUNCH_SCOPE=v1` flag prevents new writes into the
remaining legacy paths. Setting the flag to `legacy` is reserved for rollback/testing.

## Design and legal principles

Use semantic HTML, keyboard access, visible focus, readable contrast, responsive
layouts, and useful loading/empty/error states. Direct-payment screens state that
payments made directly to another user are not protected by CollectTT. Listing and
trust surfaces state that CollectTT does not authenticate collectibles. Final legal
wording requires review before launch.
