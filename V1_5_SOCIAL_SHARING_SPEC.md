# CollectTT v1.5 Social Sharing — Implementation Specification

## Current architecture

- The marketplace is a Next.js 16 App Router application. Listing detail pages live at `/listings/[id]` and are server-rendered, but the route currently has no listing-specific metadata.
- Listing records are stored in `listings`. Public listing URLs use the listing UUID and remain readable after a listing becomes sold, expired, cancelled, claimed, or otherwise inactive. Drafts are only returned to their seller; anonymous/public reads receive a not-found response.
- Images upload directly from the browser to the configured S3-compatible bucket (MinIO locally, Cloudflare R2 in production) using a short-lived signed PUT. The worker then creates 320px, 800px, and 1600px WebP variants.
- Listing-to-image ordering is authoritative in `listing_images.position`. New listings write the submitted `imageIds` in order, starting at position 0. Gallery, card, member, and admin reads sort by this column. The first gallery image is therefore the row at position 0. Editing currently preserves existing order and appends new images; there is no reorder UI.
- Browser image rendering uses `/api/images/[id]`, which redirects to a one-hour signed object URL with `private, no-store`. That is intentionally safe for a private bucket, but is not a strong Open Graph target because a crawler may retain the expiring redirect destination.
- The deployment requires `STORAGE_PUBLIC_URL`, but staging verification found that its `r2.dev` domain can return `404` for objects that remain available through the private bucket. Social metadata must therefore not assume this public-domain mapping exposes the listing-image bucket.
- Root metadata currently has only a site title and description. There is no metadata base, canonical URL, Open Graph configuration, Twitter card configuration, robots route, sitemap, middleware, or image hotlink rule in this repository.
- First-party analytics already stores allow-listed events in `analytics_events`, with a subject, optional signed-in user ID, metadata, and an idempotency key. No browser analytics endpoint exists yet.
- A native-share/copy component exists for sharing a seller's listings, but no reusable single-listing share component exists.

## Proposed UX

### Listing detail page

- Put a visible `Share` button beside the listing title so it is available to sellers and buyers without entering the purchase panel.
- Open an accessible modal on desktop and bottom sheet on small screens. It contains:
  - `WhatsApp` — opens the standard `wa.me` composer with listing summary and attributed URL.
  - `Share…` — invokes `navigator.share()` when supported; otherwise copies the link.
  - `Copy link` — writes an attributed listing URL to the clipboard and provides visible/live-region confirmation.
- Keep Facebook and Instagram inside the native device share sheet. Web-to-Instagram URL/image sharing is not consistently available, and a dedicated workaround would be brittle. Open Graph metadata supplies rich previews where the receiving platform supports them.

### After listing creation

- A successful publish redirects to the existing listing page with a transient `published=1` query flag.
- Only the listing's seller sees a `Your listing is live!` callout with immediate `Share listing`, `WhatsApp`, and `Copy link` actions.
- Draft creation keeps the existing edit redirect and does not show sharing UI.

## Technical design

### Listing share component

- Add a reusable client component, `ListingShare`, receiving listing ID, title, formatted price, condition, canonical path, and optional success-callout mode.
- Construct human-readable text from the listing title, condition (when available), price/current bid, and CollectTT URL.
- Use native buttons with at least 44px hit targets, visible focus states, Escape-to-close, focus trapping/restoration, and an `aria-live` status for clipboard feedback.
- Do not add a dependency.

### Open Graph and canonical metadata

- Add `metadataBase` plus default site Open Graph/Twitter metadata at the root.
- Add server-side `generateMetadata()` on `/listings/[id]` using a small public-share query rather than the full listing-page query.
- Use:
  - title: `[Listing title] — [price/current bid] | CollectTT`
  - description: concise price, condition, seller, and availability text
  - image: first listing image (`position = 0`), preferring the 1600px `full` WebP variant
  - URL/canonical: `${APP_URL}/listings/[id]` without referral parameters
  - Twitter card: `summary_large_image`
- Missing images use the existing branded `/assets/collecttt-hero-v2.png` fallback.
- Missing/draft listings emit noindex metadata and never reveal draft details.

### Public social image

- Add a stable, unauthenticated `/api/images/[id]/social` response that reads the preferred existing variant from the private listing-image bucket and returns the actual bytes with the correct content type and public crawler cache headers. The URL contains no signature and does not redirect.
- Validate that production `APP_URL` is HTTPS. The evidence bucket remains separate and is never exposed by this route.
- Deployment verification must confirm this endpoint returns `200`, `Content-Type: image/webp`, and the item bytes to WhatsApp/Facebook user agents.

### First-image selection

- Reuse `listing_images.position`; do not add `primaryImage` or another source of truth.
- Select the social image with `ORDER BY listing_images.position ASC LIMIT 1`, identical to the gallery/card convention.
- A processing image may fall back to its original WebP object. A missing/deleted object returns `404`; operations should treat an object missing behind a retained row as storage corruption.

### Analytics and attribution

- Add allow-listed events:
  - `listing_share_clicked`
  - `listing_share_whatsapp`
  - `listing_share_native`
  - `listing_share_copy_link`
- Add a small POST endpoint that accepts listing ID, share method, and a client-generated event UUID; it records the signed-in viewer ID when available, the listing as subject, and no personal/message content.
- Append `ref=share`, `utm_source=<whatsapp|native_share|copy_link>`, and `utm_medium=social` to shared links. Canonical and Open Graph URLs remain clean. These parameters allow later inbound attribution without changing listing routing.

## Data changes

No schema or migration is required. Existing image positions and analytics JSON metadata are sufficient.

## API changes

- New `POST /api/analytics/share` endpoint for lightweight share events.
- New `GET /api/images/[id]/social` endpoint for stable crawler-safe listing image bytes.
- No social-network API and no WhatsApp Business API.
- Existing image upload and display APIs remain unchanged.

## Files to modify

- `src/app/layout.tsx` — site metadata base and branded fallback social metadata.
- `src/app/listings/[id]/page.tsx` — listing metadata, Share placement, and publish-success callout.
- `src/app/listings/new/actions.ts` — add the post-publish success flag.
- `src/components/listing-share.tsx` — reusable share UI and browser integrations.
- `src/services/listings.ts` — minimal public listing/share metadata query.
- `src/services/analytics.ts` — share event definitions.
- `src/app/api/analytics/share/route.ts` — share-event ingestion.
- `src/app/api/images/[id]/social/route.ts` — stable public social-image response.
- `src/lib/env.ts` — production HTTPS validation.
- `src/app/globals.css` — responsive, accessible share modal/callout styles.
- `src/app/admin/analytics/page.tsx` — labels for new events.
- Tests under `tests/` — metadata/share helpers, analytics endpoint, image ordering, and workflow wiring.

## Edge cases

- No images: use the branded fallback image.
- First row exists but object is deleted: metadata remains deterministic; the CDN request exposes the storage integrity fault rather than silently changing the listing's primary image.
- Draft/private listing: do not expose metadata; return noindex/not-found behavior.
- Sold, expired, claimed, cancelled, or ended listing: keep the stable URL and preview, include an unavailable/ended description, and allow copying/sharing the historical listing.
- Mobile with Web Share: open native sheet, including WhatsApp/Facebook/Instagram when the OS exposes them.
- Desktop or unsupported Web Share: `Share…` gracefully copies the link; explicit WhatsApp and Copy Link remain available.
- Clipboard API unavailable/denied: use a short-lived hidden textarea fallback; if that also fails, show an error and keep the URL selectable.
- Long titles/descriptions: metadata descriptions are normalized and bounded; share text remains concise.
- Unusual characters: `URLSearchParams`/URL encoding is used for WhatsApp and attribution URLs.
- Old listing URLs: continue to resolve; clean canonical metadata prevents UTM/referral variants from becoming separate indexed pages.
- Optimized image/crawler access: Open Graph uses the direct public WebP variant, not the signed redirect route or Next image optimizer.

## Testing plan

### Automated

- Verify the public-share query orders by `listing_images.position` and excludes drafts.
- Verify metadata uses the first image, formatted title/description, canonical URL, Twitter card, and fallback image.
- Verify share text and attributed URLs for WhatsApp, native share, and copy link.
- Verify analytics payload validation, event mapping, and absence of message/personal content.
- Run lint, TypeScript, focused tests, then the full test suite/build as practical.

### Manual browser/device

- Desktop Chrome/Safari/Firefox: open/close by click, backdrop, and Escape; keyboard focus trap/restoration; Copy Link; unsupported-native fallback.
- Android Chrome: native share sheet, WhatsApp target, attributed URL, and 44px+ controls.
- iPhone/iOS Safari: native share sheet, WhatsApp/Instagram/Facebook targets as installed, Copy Link fallback, safe bottom-sheet layout.
- Listings with one image, multiple images, no image, processing image, long/unusual title, and each inactive status.
- Confirm photo 1 in the gallery is exactly the Open Graph image URL.

### Social preview debugging

1. Deploy to an HTTPS environment accessible without login.
2. View page source or run `curl -L` and confirm `og:title`, `og:description`, `og:image`, `og:url`, canonical, and Twitter tags are present in the initial HTML.
3. Run `curl -I '<og:image URL>'` and confirm a direct `200`, HTTPS, a supported image content type, and no cookie/auth requirement.
4. Use Facebook Sharing Debugger's **Scrape Again** to refresh Facebook/WhatsApp-adjacent caches, and send the URL to a WhatsApp test chat. WhatsApp has no fully reliable public cache-purge tool, so test with a fresh query string only for debugging; the page canonical must remain clean.
5. Validate the same URL with a general Open Graph inspector and an X/Twitter card validator where available.

## Cost and scope

- No paid API, dependency, additional image copy, database migration, or scheduled job.
- Share events add one small database row per interaction. Social crawler requests pass through the web service before being cached, adding a small amount of Render bandwidth/compute. No new storage is used; R2 has no egress charge in the current architecture, and public cache headers minimize repeat origin work.
- Checkout, payments, delivery, stores, messaging, notifications, authentication, and feed behavior are unchanged.
