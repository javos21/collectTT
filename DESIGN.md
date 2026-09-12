# CollectTT Design System

**Status:** Current implementation contract
**Last updated:** 12 September 2026
**Scope:** Marketplace, member workspace, Store workspace, and platform-admin surfaces

This document records the visual language already present in CollectTT. It is a guardrail for incremental work, not a request to redesign the product from scratch. New UI should reuse these tokens, proportions, component treatments, and interaction rules before introducing a new pattern.

## Product character

CollectTT should feel like a calm, trustworthy marketplace for real purchases and local hand-offs:

- **Quiet and readable:** white content surfaces on a soft neutral page, with generous breathing room and clear hierarchy.
- **Confident, not loud:** indigo is the primary interactive color; teal communicates trust, success, and safe progress.
- **Operationally clear:** amber marks time-sensitive work and clay red marks refusal, risk, or destructive action.
- **Content first:** listing imagery, item names, prices, transaction state, and the next required action should be easy to scan.
- **Light only for now:** the current product surface is intentionally light. Do not add a dark theme without an explicit product decision.

## Hierarchy and copy

Page titles lead every surface. Use a heading followed by concise supporting copy and then the primary action or content. Do not add decorative text above a page title or section heading.

Use sentence case for user-facing labels and actions. Prefer concrete verbs such as `Browse`, `Sell`, `Claim`, `Bid`, `Receive item`, `Release item`, `Open listing`, and `View deal`.

Use short status labels when they identify a real state, such as `Live`, `Claimed`, `Ended`, `Pending`, `Failed`, or `Read-only`. Do not use small uppercase labels as decoration or as a substitute for a meaningful heading.

## Foundations

### Typography

The product uses Inter throughout the application. The loaded variable font is the preferred face, with system sans-serif fallbacks.

| Role | Current treatment |
|---|---|
| Body | Inter Variable; 16px; line-height 1.55 |
| Page title (`h1`) | Inter Variable; 700; `clamp(2.25rem, 4.4vw, 3.6rem)`; line-height 1.04; tight tracking |
| Section heading (`h2`) | Inter Variable; 700; `clamp(1.45rem, 2.2vw, 1.85rem)`; line-height 1.1; tight tracking |
| Card heading (`h3`) | Inter Variable; 700; compact size; tight tracking |
| Supporting copy | `#52525b` or the appropriate muted token; line-height around 1.45–1.6 |
| Form label | Small but readable, normally `.72rem`–`.78rem`; semibold; always paired with a visible field or an accessible name |
| Codes, IDs, and technical metadata | Space Mono or a system monospace face; use tabular numerals and allow wrapping |

Keep body copy within approximately 68ch. Use `text-wrap: balance` for large hero headings where supported. Never reduce normal body text below 12px.

### Effective shared color tokens

These are the effective values from the current marketplace styling in `src/app/globals.css`. Earlier warm-paper values remain historical CSS and should not be reintroduced into new work without a deliberate migration.

| Token | Value | Use |
|---|---|---|
| `--background` | `#f7f8f5` | Page canvas |
| `--foreground` | `#18181b` | Primary text |
| `--card` | `#ffffff` | Cards, panels, forms, tables |
| `--primary` | `#4338ca` | Primary actions, selected navigation, links |
| `--primary-hover` | `#3730a3` | Primary hover and pressed emphasis |
| `--secondary` | `#0f766e` | Trust and supporting semantic emphasis |
| `--muted` | `#52525b` | Supporting text and metadata |
| `--border` | `#e4e4e7` | Standard borders and dividers |
| `--border-strong` | `#d4d4d8` | Inputs and higher-contrast boundaries |
| `--ring` | `#a5b4fc` | Focus indication |
| `--accent-wash` | `#eef0ff` | Selected and informational indigo surfaces |
| `--ok` | `#0f766e` | Completed, trusted, or safe state |
| `--ok-wash` | `#f0fdfa` | Success and safe-state background |
| `--warn` | `#b45309` | Deadlines, pending work, and caution |
| `--warn-wash` | `#fffbeb` | Warning background |
| `--danger` | `#dc2626` | Errors and destructive actions |
| `--danger-wash` | `#fef2f2` | Error and destructive background |

Use semantic tokens instead of one-off hex values. Color must not be the only signal for a state; pair it with text, icons, or structure.

### Admin color tokens

The admin console uses a slightly denser indigo-and-neutral palette while retaining the same product language.

| Token | Value | Use |
|---|---|---|
| `--admin-page` | `#f7f8fc` | Admin canvas |
| `--admin-surface` | `#ffffff` | Admin panels and cards |
| `--admin-ink` | `#18181b` | Admin primary text |
| `--admin-muted` | `#71717a` | Admin metadata |
| `--admin-line` | `#e4e4e7` | Admin borders and dividers |
| `--admin-primary` | `#4f46e5` | Admin controls and active indicators |
| `--admin-primary-strong` | `#3730a3` | Admin links and high-emphasis actions |
| `--admin-primary-wash` | `#eef2ff` | Selected and informational admin surfaces |
| `--admin-blue` | `#0369a1` | Active or informational operational state |
| `--admin-green` | `#047857` | Successful or confirmed state |
| `--admin-amber` | `#a16207` | Pending, overdue, or caution state |
| `--admin-danger` | `#b91c1c` | Failed or destructive state |

Store and member-specific components may use local semantic aliases, but they should remain legible against the shared neutral and white surfaces.

### Shape and elevation

Use the existing radius scale:

| Token | Value | Typical use |
|---|---:|---|
| `--r-sm` | `10px` | Inputs, buttons, compact controls |
| `--r-md` | `16px` | Cards, panels, filters |
| `--r-lg` | `20px` | Hero and large feature surfaces |
| `--r-pill` | `999px` | Status pills, badges, compact tags |

Default cards use a 1px neutral border, a white background, and the small shadow. Prominent listing and hero surfaces may use the card shadow:

```css
--shadow-sm: 0 1px 2px rgba(16, 24, 40, .05), 0 1px 3px rgba(16, 24, 40, .06);
--shadow-card: 0 16px 44px rgba(79, 70, 229, .1), 0 3px 10px rgba(16, 24, 40, .05);
```

Elevation should establish hierarchy, not make every element float. Avoid heavy shadows, glossy surfaces, and decorative gradients on ordinary content.

## Layout

The shared content wrapper is centered with a maximum width around 1200px and 24px minimum horizontal gutters. The default top spacing is approximately 32px; pages may increase this for a hero or reduce it for dense operational work.

Use a 4/8-based rhythm with common gaps of 4px, 8px, 12px, 16px, 24px, 32px, and 48px. Prefer grid and flex layouts with intrinsic sizing and `minmax(0, 1fr)` over fixed content widths.

Common compositions:

- **Marketplace:** one-column listing feed on small screens; responsive grids or a two-column browse layout on larger screens.
- **Detail pages:** primary content and a clear action panel; the action panel must remain understandable when stacked.
- **Member workspace:** focused navigation plus stacked panels, metrics, activity, and listing management.
- **Admin workspace:** fixed-width sidebar on desktop, dense but readable panels and tables, and stacked detail sections on small screens.
- **Store workspace:** task-first flow ordered as lookup, matched item, summary, active custody, incoming items, and history.

Do not allow horizontal overflow. Long titles, handles, IDs, URLs, and user-provided content must wrap or truncate with a visible recovery path.

## Navigation

### Shared header

The shared header is sticky, light, and quiet:

- Minimum height around 72px on desktop.
- White translucent background with light blur and a bottom border.
- CollectTT logo at approximately 138 × 42px.
- Desktop navigation links include an icon and a text label, with 44px minimum height in the current compact pass.
- `Store` appears when the signed-in profile is attached to a Store.
- `Admin` appears when the signed-in profile has the administrator role.
- The profile control is the authenticated account entry point; signed-out users see `Sign in`.

Navigation visibility is a convenience, not a security boundary. Every Store and Admin route/action must still enforce access on the server.

### Mobile navigation

At widths up to 720px, the header keeps the logo and exposes a 44px menu trigger. The trigger opens an accessible left drawer:

- Drawer width is `min(84vw, 340px)`.
- Primary drawer links have a 52px minimum height and at least 8px separation.
- Links use both an icon and a visible text label.
- Signed-in users see Profile and Sign out.
- Store and Admin remain conditional on the same server-resolved access state as desktop navigation.
- Sign out is separated from navigation links by a divider and remains visually destructive.
- Escape, the close button, and the backdrop close the drawer; focus returns to the trigger.

Keep the core navigation placement consistent across routes. Do not introduce a second competing bottom navigation system.

### Local navigation

Use tabs or a sidebar for sections within a workspace. The active item must be visibly highlighted and exposed with `aria-current` or the component equivalent. Use breadcrumbs for deep admin detail paths when they improve orientation.

## Authentication shell

Sign-in, account creation, email verification, password recovery, and password reset share one `AuthShell` component. The shell keeps account access visually separate from marketplace work while preserving the CollectTT product language.

- On larger screens, use a two-column card with a deep indigo brand context panel and a white form panel.
- The context panel contains the CollectTT brand, one concise trust-oriented statement, two short product benefits, and the Chaconia Labs attribution.
- The active route owns the page-level `h1` in the form panel. The brand statement is supporting context, not a second page heading.
- The form panel uses the existing 44–50px controls, indigo primary action, visible labels, inline feedback, and clear recovery links.
- At widths up to 800px, stack the context and form panels. At widths up to 650px, keep the focused form panel and hide the secondary context panel to protect task space.
- Verification, reset, error, and success states remain inside the same panel so the layout does not jump between unrelated shells.
- The shell must preserve validated return destinations and must never replace server-side authentication or authorization checks.

## Component patterns

### Page headers

Use this order:

1. Page title.
2. One short sentence explaining the job of the page or the next decision.
3. Primary action or relevant filters.

Avoid duplicate titles and decorative preambles. On detail pages, include a predictable back link when the user arrived from a directory or list.

### Cards and listing surfaces

Cards use white surfaces, a 1px border, 16px radius, 16px internal padding, and a subtle shadow. Listing imagery uses a stable aspect ratio, `object-fit: contain` when the full item needs to remain visible, and a neutral image background. Reserve image space to prevent layout shift.

Interactive cards may lift by approximately 3px on hover. The action remains available by keyboard and touch; do not make hover the only way to reveal an action.

### Buttons and links

| Variant | Treatment |
|---|---|
| Primary | Indigo background, white text, 44px minimum height, 10px radius |
| Secondary | White background, neutral border, dark text |
| Tertiary | Transparent background, indigo text, used for low-emphasis actions |
| Destructive | Red background or red-separated action; use only when the consequence is clear |
| Text link | Underline or clear link styling; never depend on color alone |

Buttons should have a visible pressed state, a disabled state, and loading feedback for asynchronous work. Do not shift surrounding layout during interaction.

### Forms and fields

- Use visible labels associated with every field.
- Inputs, selects, and textareas are normally at least 44px high with a white surface, neutral border, and 10px radius.
- Focus uses a visible indigo ring and border change.
- Keep field help close to its field and place errors next to the problem.
- Preserve entered values after validation failure.
- Group related controls with fieldsets where that improves comprehension.
- On mobile, fields and primary actions should use the available width and remain easy to tap.

### Status pills and badges

Pills are compact, rounded, and paired with readable text. Use neutral for ordinary metadata, indigo for selected or categorical context, teal for safe/confirmed, amber for pending/time-sensitive, and red for failed/destructive states. A badge may include a small dot, but the label must still communicate the state.

### Alerts and feedback

Alerts use an icon or structural cue, a concise message, a semantic wash, and a visible border. Use `role="alert"` for urgent errors and `role="status"` or a polite live region for successful non-urgent updates. Toasts must not steal focus.

Every critical route needs useful loading, empty, permission, validation, error, and success states. Empty states explain what is absent and what the user can do next.

### Tables and data rows

Tables are for comparison and operational lookup, not for hiding primary actions. Use readable column headings, row scope where appropriate, tabular numerals for counts and money, and a responsive fallback for narrow screens. On mobile, allow rows to become stacked detail cards when a table would force horizontal scrolling.

Admin tables may be denser, but identifiers and error details must wrap safely. Do not expose provider secrets or unnecessary personal data.

### Dialogs and confirmations

Use dialogs for focused confirmations or short forms, not primary navigation. Destructive or irreversible actions must state the target, the consequence, and the recovery path. Keep the close action obvious, trap focus while open, support Escape, and return focus to the invoking control.

## Marketplace, member, Store, and admin emphasis

### Marketplace

Listing discovery should privilege the image, title, seller trust cue, price, sale type, and one clear action. Search, filters, sale-type tabs, result counts, and pagination should remain visible and understandable at mobile widths.

### Member workspace

The member area uses indigo for navigation and profile structure, with teal, blue, and purple metric variations only when they communicate distinct verified facts. Activity, bids and offers, trust, and listings are separate jobs. Make the next action and its deadline explicit.

### Store workspace

The Store is a counter tool first. Lead with the lookup and the safe next action. Receive, release, return, payment gating, shelf status, and history must be distinguishable by copy and state, not color alone. Keep operational content more compact than marketing content.

### Platform admin

The admin console is operational and audit-oriented:

- Use the indigo admin sidebar with a clear active indicator.
- Favor read-only detail views and guided corrective actions over arbitrary state editing.
- Every write requires a reason, server-side permission checks, safe state checks, and an audit record.
- Show target, consequence, and result feedback near the action.
- Keep PII and internal failure data to the minimum needed for support.

## Responsive and accessibility rules

The implementation currently uses 720px, 650px, 460px, and route-specific breakpoints. New breakpoints should solve a demonstrated layout problem rather than proliferate variants.

Before considering a surface complete, verify:

- 375px and 390px mobile widths, tablet widths, and desktop widths.
- No horizontal scrolling, clipped labels, or content hidden behind fixed UI.
- Keyboard navigation, visible focus, logical reading order, and predictable back behavior.
- Touch targets of at least 44px for primary controls, with at least 8px spacing between adjacent targets.
- Normal text contrast of at least 4.5:1 and meaningful non-text controls of at least 3:1 against adjacent colors.
- Screen-reader names for icon-only controls and `aria-hidden="true"` for decorative icons beside visible text.
- Reduced-motion behavior: page entrance and hover/drawer transitions must collapse to near-instant transitions when requested.
- Long titles, names, IDs, error messages, and many-item states.

## Motion

Motion is restrained and functional:

- Page entrance: a short opacity plus 8px vertical rise, around `.25s` in the current final pass.
- Hover/focus elevation: around `.15s`–`.2s`, using color, opacity, shadow, or a small transform.
- Button press: a small downward transform without changing layout bounds.
- Drawer: approximately `.24s` transform and `.2s` backdrop opacity.
- Profile menus and field feedback: approximately `.15s`.

Animate `transform` and `opacity` where possible. Every transition must be interruptible and must respect `prefers-reduced-motion`. Do not add decorative motion to data-heavy or safety-critical surfaces.

## Icon and asset rules

- Use the existing Lucide and Untitled UI icon families; keep stroke and sizing consistent within a component.
- Use visible labels alongside navigation icons.
- Give standalone icon controls an accessible name.
- Keep decorative icons out of the accessibility tree.
- Use official CollectTT and Chaconia Labs assets with their proportions intact.
- Do not use emoji as structural icons.

## Implementation guardrails

1. Start with shared tokens and existing primitives before adding route-specific CSS.
2. Prefer semantic class names and component-level styles over raw inline values.
3. Reuse existing button, field, badge, alert, table, drawer, and panel treatments.
4. Keep domain behavior separate from presentation changes.
5. Preserve deep links and meaningful browser back behavior.
6. Add empty, loading, error, permission, and success states with each new critical route.
7. Record visual changes in the relevant QA notes and verify desktop, mobile, keyboard, and reduced-motion behavior.
8. Treat the server as the access boundary; conditional navigation only improves discoverability.

## Current technical note

`src/styles/theme.css` and `src/styles/soft-pop-design-system.css` contain token layers for shared and future component-library adoption. The current document is based on the effective values in `src/app/globals.css`; the optional `data-theme="soft-pop"` aliases are not the active application theme. Consolidating these layers is a future cleanup task and should preserve the visual values documented here.
