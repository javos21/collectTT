# CollectTT Design Guidance

Use this file as the default design direction for all new and updated site UI.

## Product feel

- Make CollectTT feel trustworthy, local, calm, and easy to scan.
- Prefer clear hierarchy and useful whitespace over decorative complexity.
- Keep interactions familiar and predictable for buyers and sellers.
- Reuse existing patterns before introducing a new visual treatment.
- Prefer React components from Ultimate UI when an appropriate component is available.
- Adapt Ultimate UI components to CollectTT’s existing palette, typography, spacing, and accessibility requirements rather than introducing a disconnected visual system.
- Reuse and compose available components before building a custom replacement; add a new dependency only when it is compatible with the project and genuinely needed.

## Copy and content

- Use less copy and make it more direct. Every sentence should help the user decide or act.
- Use sentence case for user-facing copy unless an established label requires otherwise.
- Avoid filler, marketing jargon, and repeated explanations.
- Do not add eyebrow labels, kicker text, or ornamental pre-headings unless they communicate essential context.
- Keep actions specific: use “Create Listing”, “View Listing”, “See All”, and similar direct labels.
- Keep button labels short enough to scan comfortably on mobile.

## Color and surfaces

- Do not use gradient colors. Prefer solid palette colors and subtle opacity changes.
- Use indigo/purple for primary actions and links, teal for positive or marketplace-safe states, amber for caution, and red only for urgent or destructive states.
- Keep backgrounds quiet and light. Use one contrasting solid-color panel sparingly to separate an important CTA or state.
- Avoid adding a new color when an existing semantic palette color will work.
- Use borders, spacing, and typography to create hierarchy before adding shadows.
- Keep shadows soft, low-contrast, and reserved for elevated cards or focused actions.

## Typography and layout

- Use the existing site font stack and type scale.
- Prefer readable line lengths and balanced wrapping; do not truncate important information unnecessarily.
- Keep repeated cards uniform in height and structure where practical.
- Align related labels, prices, status indicators, and actions consistently across cards.
- Use responsive layouts that remain comfortable at narrow widths; stack content when horizontal compression harms readability.
- Keep section headings concise and use one clear section action where needed.

## Icons and controls

- Use Lucide icons for interface actions and status indicators, with consistent sizing and spacing.
- Icons should reinforce meaning, not replace necessary text.
- Pair status text with an appropriate icon and a restrained semantic color treatment.
- Use `Eye` for viewing listing details, `Plus` for creating, `Clock3` for auction timing, and check/badge icons for confirmed marketplace states when appropriate.
- Ensure links styled as buttons still have clear hover, focus-visible, and disabled states.

## Listing cards

- Prioritize the title, sale price/current bid, relevant status, and the listing action.
- Remove category or sale-type pills when they add clutter without helping the decision.
- Keep titles to a consistent two-line area and show as much useful text as fits.
- Put auction timing close to the price and use urgency colors consistently: green for more than 24 hours, amber for 12–24 hours, and red for under 12 hours.
- Treat “Offers accepted” as a compact positive status with an icon; do not let it overpower the price.
- Make “View Listing” span the card width when it is the primary card action.

## Navigation and footer

- Keep navigation labels short and use icons only where they improve recognition.
- The shared footer should stay orderly: brand content, grouped links, legal links in their own column, then attribution/copyright.
- Keep third-party attribution understated and clearly clickable.

## Accessibility and verification

- Preserve semantic headings, landmarks, link destinations, and accessible names.
- Every meaningful icon must be hidden from assistive technology when adjacent text already provides its label.
- Maintain visible keyboard focus and sufficient color contrast.
- After UI changes, run typechecking and formatting validation; run the production build for layout or shared-component changes.
