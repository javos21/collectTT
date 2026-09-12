# Store counter design QA

Date: 2026-09-10

## Comparison target

- Source desktop visual truth: `/Users/javedali/.codex/generated_images/01a08cc6-c1aa-7353-a882-6d71ec68a3fd/exec-9a123fe4-a926-409f-b6ab-0387a00dd0aa.png` (1487 x 1058 px generated concept canvas; no device frame).
- Source mobile visual truth: `/Users/javedali/.codex/generated_images/01a08cc6-c1aa-7353-a882-6d71ec68a3fd/exec-8875784a-655b-4b81-8700-d425e5dcf658.png` (853 x 1844 px generated concept canvas; no device frame).
- Rendered desktop evidence: `/Users/javedali/CollectTT/store-dashboard-audit/06-implemented-desktop.png` (1440 x 1024 px; CSS viewport 1440 x 1024; device scale 1).
- Rendered mobile evidence: `/Users/javedali/CollectTT/store-dashboard-audit/07-implemented-mobile.png` (390 x 844 px; CSS viewport 390 x 844; device scale 1). The final mobile order adjustment was re-checked live at the same viewport after this capture.

The source images are generated concept canvases rather than CSS-sized exports, so density was normalized by comparing relative proportions and focused regions instead of raw pixels. The desktop source shows a populated release result; the implementation capture is the real Gamez Plus Movietowne workspace in release mode with zero active holdings. This is a data-state difference, not a UI-path difference. The implementation's matched-item empty state and the populated source result were reviewed separately to avoid false precision.

## Evidence reviewed

The source and implementation were opened together in the same desktop comparison pass and the same mobile comparison pass. Full-view comparison covered page frame, header hierarchy, two-column desktop composition, stacked mobile composition, mode selection, code entry, result area, inventory summary, and lower inventory/history sections.

Focused regions reviewed:

1. Header and lookup: eyebrow, store name, lede, date, mode cards, code label, scan affordance, and primary action.
2. Result area: empty state in the implementation versus the source's populated item/release state, including image treatment, badges, facts, safety copy, and action placement.
3. Summary and lower lists: shelf/expected counts, inventory/history links, responsive stacking, and empty-list messaging.

## Findings

No actionable P0, P1, or P2 visual findings remain.

- Typography and hierarchy use the existing CollectTT type tokens and the source's strong eyebrow / large store-name / quiet supporting-copy rhythm. Long store names wrap cleanly on the 390 px viewport.
- Spacing and layout preserve the source's generous cards and clear action grouping on desktop, then stack without horizontal overflow on mobile. Mode cards, code controls, links, and primary actions retain touch-friendly minimum heights (44–52 px).
- Colors and semantic tokens preserve the source's white card surfaces, indigo selected state, muted text, green payment/success state, and red release safety state.
- Images and icons use the real listing-image endpoint when available and the existing Lucide icon set; no custom CSS or hand-drawn replacement art was introduced.
- Copy removes the transient “Cleared for release” stage from the clerk-facing process. Clerks now see only Receive item, Release item, the current payment state, and the next safe action.

The populated matched-item and successful release state could not be captured against this Store without changing or inventing data. The release path is wired to the existing payment authorization gate and is covered by the custody-loop tests; a populated Store scenario is the remaining content-state QA follow-up.

## Comparison history

### Pass 1

- Finding: P2 responsive ordering drift. On the first mobile capture, the inventory summary appeared before the primary Receive/Release lookup, while the selected mobile reference leads with the counter action.
- Fix: removed the mobile `order: -1` rule from `.store-counter-summary` so the DOM order stays lookup → matched item → inventory summary on narrow screens.
- Post-fix evidence: live 390 x 844 release-mode render rechecked after the change; mode cards and code lookup appear first, with summary below the matched-item section. Desktop composition remains two-column.

### Pass 2 (final)

- Re-opened both source references and both implementation captures in paired desktop/mobile comparison inputs.
- Re-checked the post-fix mobile render, empty state, release mode, and refusal state. No P0/P1/P2 findings remained.

## Interaction and accessibility checks

- Receive and Release mode links were exercised at desktop and mobile widths.
- Unknown-code lookup (`CT-NOTFOUND`) returned the visible, `role="alert"` message: “No item found with that code at this Store.”
- Empty-state copy clearly explains the next action and does not expose the retired ready stage.
- Labels are associated with the code input; mode links expose their action and current state; success/refusal messages use status/alert semantics.
- Mobile touch targets meet the 44 px minimum in the responsive CSS, and the 390 px render showed no horizontal overflow.
- Browser console error check returned an empty list.
- A real release success was not executed because the authenticated test Store currently has no active shelf rows; backend custody-loop coverage passed for authorization and pickup transitions.

## Implementation checklist

- [x] Simplified Store counter information architecture.
- [x] Added one code lookup that switches between Receive and Release.
- [x] Removed “Cleared for release” from the clerk-facing UI while preserving the payment gate.
- [x] Added shelf, expected, and history summaries with empty states.
- [x] Added responsive desktop/mobile layouts and touch-safe controls.
- [x] Verified typecheck, custody flow tests, browser interactions, and console output.
- [ ] Run one populated Store scenario through lookup → release → success copy when fixture data is available.

Store counter final result: passed

---

# Listings page responsive QA

Date: 2026-09-11

## Comparison target

- Source visual truth: `/Users/javedali/Downloads/CollectTT — Collect with confidence.png` (1179 x 2556 px PNG; mobile screenshot with red annotations marking the requested areas).
- Rendered implementation: `http://localhost:3000/listings?saleType=straight_sale` in the Codex in-app browser.
- Desktop capture: browser-rendered at 1440 x 1024 CSS px, device scale 1.
- Mobile capture: browser-rendered at 390 x 844 CSS px, device scale 1.

The source includes device/browser chrome and annotated circles, while the implementation comparison used the page content region only. The live catalog data is the same 46 straight-sale listing result shown by the source; the state is the Straight Sales tab, Newest listed sort, and the first page of results.

## Evidence reviewed

Source and implementation were opened and reviewed in paired desktop/mobile comparison passes. Full-view comparison covered the page header/search, filter disclosure, sale-type tabs, results count/sort row, and the listing feed. Focused comparison covered the two requested changes and the image rail: the tab row, the `46 Listings` result label, and the card preview column/action balance.

## Findings

No actionable P0, P1, or P2 findings remain.

- The All Listings tab is removed from both breakpoints; only Straight Sales and Auctions remain.
- The result count now renders as `46 Listings` without the sale-type suffix on both breakpoints.
- Listing cards use a wider preview rail with internal padding (`236px` / `16px` desktop, `132px` / `12px` mobile), preserving contain-fit imagery and giving uploaded photos room around their edges.
- Cards remain single-column feed items at narrow widths, with the text, seller, price, and CTA column still readable and no horizontal overflow.
- Straight-sale cards now use a concise `Claim` CTA and auction cards use `Bid`; both preserve the existing listing-detail destination and `#buy-panel` handoff so required information is still completed on the listing page.
- Listing images now load lazily and decode asynchronously; decorative/empty preview text remains aria-hidden while real listing images keep the existing link label.
- Typography, indigo selection state, neutral card surfaces, borders, and spacing stay within the existing CollectTT token system.

## Comparison history

### Pass 1

- Findings: All Listings and the `· Straight Sale` suffix were present; the mobile image rail was too narrow and the price/CTA relationship became crowded when the image area was widened.
- Fixes: removed the All Listings link and sale-type suffix in `src/app/listings/page.tsx`; widened and padded the card image rail in the final catalog CSS; reduced the mobile CTA minimum width and price size to prevent collision.
- Post-fix evidence: live 1440 x 1024 and 390 x 844 renders show only Straight Sales/Auctions, `46 Listings`, a 236px desktop image rail, a 132px mobile image rail, and a fully visible `TT$100.00` price plus View listing action.

### Pass 2

- Accessibility tree confirms tabs are `[Straight Sales, Auctions]` and the result label is `46 Listings`.
- Responsive DOM check confirms mobile `grid-template-columns: 132px 232px` and `document.documentElement.scrollWidth === clientWidth` at 390px.
- Straight-sale verification confirms the first card exposes `Claim`; auction verification confirms the first three cards expose `Bid`; each CTA retains its matching `/listings/:id#buy-panel` href.
- The shorter mobile CTA treatment reclaims card width while retaining a 44px minimum touch height; live auction mobile render remains readable with no horizontal overflow.
- Browser console error check returned an empty list.
- No P0/P1/P2 findings remain; the red circles in the source were treated as annotations, not UI to recreate.

### Pass 3 (final)

- Finding: the auction bid-count pill was right-aligned inside the mobile price block, which separated it from the amount it qualifies.
- Fix: reset the pill's auto margins at the mobile breakpoint so `0 bids` shares the price's left edge on every auction card.
- Post-fix evidence: live 409 x 837 auction render shows the amount, bid count, time remaining, and Bid action in one left-to-right scan with `document.documentElement.scrollWidth === clientWidth`; console errors remained empty.

## Implementation checklist

- [x] Removed All Listings tab on desktop and mobile.
- [x] Changed count copy to `46 Listings` on desktop and mobile.
- [x] Gave listing imagery more breathing room with wider, padded preview rails.
- [x] Added sale-type-specific `Claim` and `Bid` CTAs while preserving listing destinations.
- [x] Left-aligned auction bid-count pills with the price on mobile.
- [x] Preserved functional sale-type navigation, search, filters, sort, pagination, and listing links.
- [x] Verified 1440px and 390px layouts, accessible labels, no overflow, sale-type CTA labels, and no browser console errors.

Listings final result: passed

---

# Profile navigation responsive QA

Date: 2026-09-11

## Evidence reviewed

- Desktop profile page: `http://localhost:3000/me` at 1440 x 1024 CSS px.
- Mobile navigation: `http://localhost:3000/listings` at 390 x 844 CSS px with the drawer open.
- Profile section deep link: `http://localhost:3000/me?tab=listings`.

## Findings

No actionable P0, P1, or P2 findings remain.

- The mobile drawer now ends with a separated, full-width Sign out action using a 52px touch target.
- The desktop profile control opens a labelled dropdown that mirrors the four focused profile destinations: Activity, Bids & Offers, Trust, and Listings.
- Dropdown section links preserve the existing profile navigation by opening `/me?tab=…` and selecting the matching tab panel.
- Escape closes the desktop dropdown and the existing mobile drawer focus return remains intact; no horizontal overflow was observed.

## Verification checklist

- [x] Desktop profile dropdown opens and exposes all profile sections plus Sign out.
- [x] Listings dropdown item opens `/me?tab=listings` and selects the Listings panel.
- [x] Mobile drawer exposes Sign out only for signed-in users.
- [x] Mobile Sign out control measures 52px high and spans the drawer content width.
- [x] Typecheck and whitespace checks passed; browser console error check returned an empty list.

---

# Mobile route scroll QA

Date: 2026-09-11

## Evidence reviewed

- Mobile viewport: 390 x 844 CSS px in the Codex in-app browser.
- Plain listing detail: `http://localhost:3000/listings/46baee34-08a3-4c01-9748-9ca37f90c2c5`.
- Create listing route: `http://localhost:3000/listings/new`.
- Intentional listing action anchor: `http://localhost:3000/listings/46baee34-08a3-4c01-9748-9ca37f90c2c5#buy-panel`.

## Findings

No actionable P0, P1, or P2 findings remain.

- Added a shared route-level scroll reset so new pathname navigations start at the top on mobile and desktop.
- Hash destinations are preserved: the listing action anchor still lands directly on `#buy-panel` instead of being overridden by the reset.
- Mobile navigation from a scrolled page into Create a listing now returns `scrollY: 0`; plain listing detail navigation also returns `scrollY: 0`.
- The existing drawer focus behavior and page layout remain unchanged; no horizontal overflow was observed.

## Verification checklist

- [x] Scrolled source page before opening `/listings/new`; new route opened at the top.
- [x] Plain listing detail opened at the top on mobile.
- [x] `#buy-panel` navigation remained anchored to the buy panel.
- [x] Browser console error check returned an empty list.
- [x] Typecheck and whitespace checks passed.

---

# Profile area simplification QA

Date: 2026-09-11

## Review outcome

The profile workspace is now organized around four jobs instead of seven competing sections:

- Activity combines claims, bids, offers, and transactions in one newest-first timeline.
- Bids & Offers shows only actions the user sent, split into auction bids and offers sent.
- Trust keeps the verified trust snapshot alongside the transactions and outcomes that affect it.
- Listings keeps the seller’s auction and straight-sale lists, with active listings shown first and inactive listings revealed on demand.

Legacy profile links continue to resolve to the closest new destination, so existing desktop dropdown links and shared URLs do not land on removed sections.

## Verification checklist

- [x] Shared profile navigation exposes four focused destinations on desktop and mobile.
- [x] `/me` defaults to the Activity timeline rather than the former details panel.
- [x] Received offers are removed from the buyer-facing Bids & Offers workspace.
- [x] Activity rows retain status, dates, and deal links where a transaction exists.
- [x] Existing active/inactive listing toggles and mobile single-column layout remain intact.
- [x] Typecheck and whitespace checks passed.

final result: passed
