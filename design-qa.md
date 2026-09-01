# Design QA — CollectTT home hero

## Comparison target

- Source visual: `/Users/javedali/.codex/generated_images/01a05ec0-e4e5-72b1-9068-00158b8f9f49/exec-dae7c0dd-9914-4c95-98ce-00f6a5c8513b.png`
- Initial implementation capture: `/private/tmp/collecttt-home-desktop.png`
- Combined comparison: `/private/tmp/collecttt-design-comparison.png`
- Intended desktop viewport: 1440 × 1024 CSS px, device scale factor 1.

## Findings and fixes

### P1 — Homepage remained constrained by the operational app shell

- Location: homepage frame, hero, and Live Auctions section.
- Evidence: the initial implementation capture used a 1200px page shell, producing much larger side margins than the approved wide mockup.
- Impact: the ribbon composition felt boxed in and only two auction cards occupied the available row.
- Fix applied: the homepage now uses a homepage-only fluid width of `min(1920px, 100vw - 48px)`, while operational routes retain the existing app shell.
- Post-fix evidence: blocked. The in-app browser rejected the final reload under its local URL policy, so a fresh capture could not be produced after the width correction.

## Required fidelity surfaces

- Fonts and typography: Inter remains the existing product font. The headline weight, compact tracking, centered hierarchy, and blue emphasis on “Collectible.” match the target closely in the initial capture.
- Spacing and layout rhythm: hero padding, search/category spacing, radii, and the reduced hero-to-auction gap match the selected compact direction. The initial width mismatch was corrected in CSS but could not be re-captured.
- Colors and visual tokens: deep navy copy, indigo action color, white controls, and quiet cool background are aligned with the approved concept and existing CollectTT palette.
- Image quality and asset fidelity: the ribbon motif is a dedicated 2098 × 749 raster asset with a clean center and corner-safe composition; it is rendered as a responsive hero background without stretching UI content.
- Copy and content: headline, supporting text, search label, category labels, and Live Auctions copy are preserved exactly. Local listing count/content differs from the concept because the implementation uses real local database data.

## Verification

- Production build: passed.
- Typecheck: passed after build artifacts were generated.
- Automated tests: 165 passed; 6 existing flow tests fail in offer fixtures and Vite alias resolution, unrelated to this hero change.
- Browser interaction: search form and category links retained their original semantic markup and destinations.

## Final result

final result: blocked

The implementation is complete, but the required post-fix browser capture and final visual comparison were blocked by the in-app browser local URL policy.
