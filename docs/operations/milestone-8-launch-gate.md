# Milestone 8 launch-candidate gate

Milestone 8 is locally hardening-complete. The repository now has a repeatable HTTP
preflight, the local browser smoke matrix has been exercised at desktop and mobile
viewports, and the real worker/image queue has been verified. This document separates
those local exits from gates that require staging credentials, production-like data,
or a human owner.

Verification note (2026-09-19): the database-free preflight is passing (17/17), the
focused unit/security set is passing (107 tests), and the Next 16 production build is
passing with deterministic single-worker page-data collection. The HTTP preflight could
not reach a running local web process in this environment, so that gate still needs a
local or staging rerun. The Supabase mutation flows (Phase 0 image pipeline, Phase 1
trading loop, and legacy-only Phase 2 custody sweep) also passed; their synthetic rows
and storage objects were cleaned up. Three unrelated pre-existing overdue worker jobs
remain in the remote queue and are recorded separately from this verification.

## Repeatable local checks

Start Docker Postgres/object storage, the web process, and the worker with local
adapters, then run:

```bash
npm run typecheck
npm run build
npm run verify:offline
npm test
npx drizzle-kit check
COLLECTTT_BASE_URL=http://localhost:3000 npm run verify:launch
DATABASE_URL=postgres://collecttt:collecttt_dev@localhost:5434/collecttt \
  APP_URL=http://localhost:3000 \
  BETTER_AUTH_URL=http://localhost:3000 \
  EMAIL_ADAPTER=console npm run verify
```

`verify:launch` checks readiness, public browse/filter routes, legal/support pages,
unauthenticated redirects, missing-object 404s, direct-object 401s, and the application
icon. `verify` exercises the real worker through upload, processing, storage variants,
same-transaction enqueue, and confirmation idempotency.

The browser smoke matrix covers:

- browse, auction filtering, listing detail, sign-in redirect, and legal/support links;
- the 390×844 mobile viewport and expandable navigation;
- the desktop accessibility tree with banner, primary navigation, main heading, search,
  filters, sale-type navigation, listing articles, and footer landmarks; and
- unauthenticated evidence, profile, and evidence-confirmation mutation probes.

Keep browser artifacts under `output/playwright/` when recording screenshots or traces.
Do not use production credentials or production member data for this local pass.

## Gate status

| Gate | Local status | Staging/production owner |
| --- | --- | --- |
| Typecheck, offline, focused Vitest, Drizzle check | Pass | Re-run in CI/staging |
| Production build | Pass (single-worker page-data collection) | Re-run in CI/staging |
| Public route, readiness, redirect, 404, and direct-object HTTP preflight | Blocked: no reachable local web process | Re-run against staging |
| Desktop/mobile accessibility smoke | Pass locally | Add/execute the full A–L browser suite |
| Real worker enqueue, processing, and idempotency | Pass locally and against Supabase synthetic data | Exercise deadline, provider-failure, and recovery drills in staging |
| Notification retry and admin retry intervention | Covered by flow/security tests | Verify with a real provider failure and an audited admin retry |
| Account Terms acceptance | Implemented: required checkbox, server/API guard, stored Terms version, and approved legal copy | Run a staging sign-up acceptance audit |
| Migration forward rehearsal and rollback/forward-fix procedure | Pending | Run on an isolated production-like copy |
| Brevo email and phone-provider verification | Pending | Configure staging credentials and run delivery probes |
| Public image versus private evidence restore | Pending | Complete backup and restore drill |
| Approximately 100 active listings and staged beta gates | Pending | Seller recruitment, alpha, trusted pilot, invite-only beta |
| Legal approval and monitoring alerts | Legal copy approved; public draft markers and placeholders removed | Keep legal versions and monitoring evidence current |

The local implementation is ready for staging rehearsal; Milestone 8 should not be
called a public-launch exit until the pending external gates have owners and evidence.
