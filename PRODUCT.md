# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Collectors, buyers, sellers, Store owners and staff, and platform administrators in Trinidad
& Tobago. Buyers and sellers use the product to discover and coordinate collectible
deals; Store staff use the custody board to receive, hold, and release items; platform
administrators will operate the support and moderation console required for launch.

## Product Purpose

CollectTT helps people trade cards, comics, and collectibles with visible trust and
coordination. It supports the complete deal lifecycle while keeping payment peer to
peer: the platform never holds buyer or seller funds.

## Positioning

The product combines a buyer/seller transaction state with a separate item-custody
state, including Store custody and payment-gated release. This makes the deal's
money track and physical item track explicit instead of pretending they are one status.

## Operating Context

People browse listings, claim or bid on an item, coordinate payment directly, and may
drop the item at a nominated Store. Sellers and buyers need quick status scanning;
Store staff need an operational board with codes, shelf clocks, and clear counter actions.

## Capabilities and Constraints

The existing app includes Google-first authentication, verified email/password accounts,
password recovery, listings, category-specific filters, image uploads, straight sales,
auctions, backup claims, payment handshakes, reputation, ratings, Store custody, drop-off
codes, shelf clocks, and store controls. Preserve all existing routes, server actions,
state meanings, and accessibility/native browser affordances.

## Account & Store model

- A personal profile can buy and sell. Store staff do not need personal marketplace
  profiles to perform their jobs.
- A Store is a separate business profile with one or more invited staff members. Staff
  share access to the Store workspace for dropped-off and picked-up inventory.
- Any individual seller can choose a Store as a pickup or drop-off location while the
  individual remains the seller and owns the listing reputation.
- A Store may optionally sell Store-owned inventory as the seller. Consigned inventory
  remains owned by the original seller.
- `Verified Store` and `Verified Seller` are separate trust states. A paid Pro
  subscription unlocks seller tools and raffle hosting; payment alone does not create
  verification.

## MVP monetization scope

- Pro subscription is available to sellers and raffle hosts. It is not required for a
  Store to provide basic pickup, drop-off, and custody operations.
- A Pro member may host up to two free raffles per calendar month. Each additional
  raffle in that month is a paid overage.
- Store Pro tools, such as advanced inventory management, multiple locations, and
  expanded staff controls, are outside the MVP.

## Authentication & Communications

- Better Auth remains self-hosted and stores users, sessions, linked identities, and
  password credentials in CollectTT's Postgres database.
- Google is the visually preferred sign-in path. Verified email/password registration
  and password reset remain available as a secondary path.
- Provider accounts may link only when the email addresses match and the required email
  verification checks pass; one person should retain one stable CollectTT identity.
- Brevo sends verification, password-reset, and transactional deal email in production.
  Console delivery keeps those flows testable locally without sending real messages.
- SMS is a future Brevo notification adapter, not an authentication dependency. It must
  add phone verification, consent, delivery logging, and local compliance work before use.

## Brand Commitments

The name CollectTT and Trinidad & Tobago community context are fixed. The user's visual
direction is a more premium, space-efficient interface with richer color, especially
for product tags.

## Evidence on Hand

README.md, product-design-document.md, the current Next.js routes and components, and
the existing visual implementation in src/app/globals.css. No fabricated testimonials,
market data, or commercial claims.

## Product Principles

- Trust should be legible in the interface, not implied by marketing language.
- Keep payment, custody, and responsibility states distinct.
- Keep personal marketplace activity separate from shared Store operations.
- Let collectors scan dense information quickly without losing confidence.
- Make the community and local context feel specific, not like a generic marketplace.

## Accessibility & Inclusion

Maintain semantic HTML, keyboard access, visible focus, readable contrast, reduced-motion
support, and responsive behavior for mobile web.
