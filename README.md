# CollectTT

CollectTT is a free, structured collectibles marketplace for Trinidad & Tobago.

The v1 loop is **List → Discover → Commit → Transact → Build Trust → Repeat**. Buyers and
sellers use one account, choose fixed-price or auction listings, select seller-defined
delivery and direct cash/bank-transfer options, and coordinate the transaction without
CollectTT holding ordinary funds.

## Source of truth

- [Product scope](COLLECTTT_PRODUCT_SCOPE.md) — authoritative v1 requirements and acceptance scenarios.
- [V1 implementation plan](V1_IMPLEMENTATION_PLAN.md) — dependency-ordered delivery milestones.
- [Route/state inventory](V1_ROUTE_STATE_INVENTORY.md) — route treatment and state coverage.
- [Domain context](CONTEXT.md) — codebase vocabulary and invariants.
- [Operations runbook](docs/operations/v1-operations-runbook.md) — readiness, metrics, retention, and restore checks.
- [Milestone 8 launch gate](docs/operations/milestone-8-launch-gate.md) — repeatable launch-candidate checks and remaining staging exits.

Older custody/Pro/raffle documents are retained as historical archives. They do not
override the v1 scope.

## v1 boundaries

v1 includes:

- private account name plus public display name;
- verified email and phone before selling, reserving, or bidding;
- manual fixed-price and auction listings, drafts, duplication, expiration, relisting,
  and Sold outside CollectTT;
- fixed-price listings with optional buyer offers below the asking price;
- cash meetups completed by one buyer confirmation after payment and collection;
- global search, practical filters, deterministic sorting, and factual Trust Snapshots;
- atomic reservations, binding bids, repeated two-minute anti-sniping, deadlines,
  reminders, disputes, progressive restrictions, and audited admin intervention;
- structured seller-configured delivery and direct bank-transfer workflows;
- transactional email and contextual reporting/support.

v1 does not include reserve prices, auction buyouts, proxy bids, bid retraction, seller-authored payment
windows, ratings/reviews, Pro subscriptions, raffles, Featured Listings, Collect
Protect, SMS/WhatsApp, in-app chat, or payment holding. Legacy tables and records remain
available for controlled inspection; `COLLECTTT_LAUNCH_SCOPE=v1` prevents new writes into
those legacy paths.

## Run locally

The database and object storage run on your machine. Console adapters print email and
phone OTP messages to the terminal.

```bash
docker compose up -d
cp .env.example .env.local
npm install
npm run setup
npm run seed:dev       # optional sample data

npm run dev            # http://localhost:3000
npm run dev:worker     # separate terminal
```

The admin workspace is at `/admin` and requires an account with the admin profile role:

```bash
npm run admin:grant -- you@example.com
```

Keep `COLLECTTT_LAUNCH_SCOPE=v1` in local and deployed environments. Set it to
`legacy` only for a controlled rollback or historical-flow test.

## Verify changes

```bash
npm run typecheck
npm run build
npm run verify:offline
npm test
npm run verify:launch
npm run verify
npm run verify:phase1
COLLECTTT_LAUNCH_SCOPE=legacy npm run verify:phase2  # historical custody check only
```

`npm run db:migrate` is environment-driven and Render-safe: it uses the service's
`DATABASE_URL`, prints only a sanitized host/database target, and serializes concurrent
web/worker startup migrations with a Postgres advisory lock. Render's `prestart` hook
runs this command automatically before the web process starts.

The Supabase staging database has its own guarded entry point, `npm run db:migrate:staging`,
which reads `STAGING_DATABASE_URL` instead so a local migration can never reach staging.
See the [operations runbook](docs/operations/v1-operations-runbook.md#database-migrations).

The verification scripts require Postgres, object storage, and (for phase 1/2) the
worker. Stop the worker before running flow tests that invoke handlers directly.
Provider delivery, migrations, backups, monitoring, and production smoke tests still
need a production-like environment before launch.

## Architecture

The app has a Next.js web process, a Graphile Worker process, and Postgres. Postgres
stores domain data and the transactional job queue. Better Auth stores users, sessions,
and credentials in the same database. Brevo is the production email and phone-OTP
adapter; nonessential SMS notifications are reserved for v2. Local console adapters
keep development offline.

```text
src/domain/       pure state machines, policy, categories, and validation
src/db/           Drizzle schema and atomic claim/bid operations
src/services/     authorization and business workflows
src/jobs/         transactional enqueue plus idempotent handlers
src/notifications/ email/in-app dispatch and delivery adapters
src/app/          Next.js routes, server actions, and UI
```

All sensitive actions must be authorized on the server. Phone numbers remain private
before commitment and are disclosed only to the two transaction parties or an
authorized, audited administrator. CollectTT does not authenticate collectibles, and
direct payments are not protected by CollectTT; both disclaimers are shown in the
relevant v1 flows.
