# CollectTT

Trust and coordination for peer-to-peer trading card, comic and collectible deals in
Trinidad & Tobago.

**This is not a marketplace.** Buyers and sellers pay each other directly — cash, bank
transfer, however they agree. The platform never holds funds, never processes a payment,
and has no PCI scope. It collects only its own service fees, for logistics it actually
performed. See [product-design-document.md](product-design-document.md) for the full
rationale.

**Status: Phase 2 complete — Store custody is live.** A full deal now runs end to end,
peer to peer: atomic claims with a backup queue, auctions with anti-snipe soft close,
the mark-paid/confirm-received handshake, automatic renege-and-promote, objective
reputation with automatic restrictions, and blind mutual ratings. On top of that the
item track is real: a seller drops an item at a Store under a drop-off code, the Store
holds it on a time-bounded shelf clock, and it is released to the buyer only once payment
is confirmed. MVP scope now also includes Pro subscriptions and raffle hosting; WhatsApp
and the paid delivery rail are Phase 3.

---

## Running it locally

The database and object storage run entirely on your machine. Email verification codes
and password-reset links can print to your terminal with `EMAIL_ADAPTER=console`.

```bash
docker compose up -d      # Postgres (:5434) + MinIO (:9000, console :9001)
cp .env.example .env.local
npm install
npm run setup             # migrations + category seed + MinIO bucket CORS
npm run seed:dev          # optional: sample members and listings

npm run dev               # web process    -> http://localhost:3000
npm run dev:worker        # worker process (separate terminal)
```

The browser uploads directly to object storage, so the bucket must allow the web
origin to make `PUT` requests. `npm run setup` configures this for local MinIO. For
staging/R2, set `STORAGE_CORS_ORIGINS` to the exact deployed HTTPS origin and run
`npm run storage:cors` once with the R2 storage credentials; the Render web and worker
services both include this variable for reference.

The admin workspace is served by the main web process at `http://localhost:3000/admin`.
It uses the same database and authentication session, but requires the existing `admin`
profile role. Promote a local account explicitly when needed:

```bash
npm run admin:grant -- you@example.com
```

Sign in at `/sign-in` or create a verified email/password account. In local console
mode, verification codes and password-reset links print in the terminal running
`npm run dev`.

### Verifying it works

```bash
npm test              # 175 tests: auth safety, state machine, categories, DB constraints,
                      # trading flows, custody flows
npm run typecheck
npm run verify        # Phase 0 end-to-end: presign -> upload -> worker -> variants
npm run verify:phase1 # Phase 1 end-to-end against the LIVE worker: auction close,
                      # renege, runner-up promotion, backup-claim promotion
npm run verify:phase2 # Phase 2 end-to-end against the LIVE worker: claim -> drop-off
                      # code -> shelf clock -> overstay sweep -> store eviction notice
```

**Stop the worker before `npm test`.** The flow tests drive job handlers directly, so a
live worker races them for the same rows and the failures look random.

The `verify` scripts prove the chain `transactional enqueue -> Graphile Worker ->
handler`, which unit tests cannot. Only `verify` (Phase 0) drives the web process, for
the presign/upload leg; `verify:phase1` and `verify:phase2` enqueue against the database
directly and need just Postgres and the worker.
The custody flow tests call the overstay handler directly; only `verify:phase2` proves
the worker really picks the scheduled sweep up and runs it.

---

## Architecture in one page

**Two persistent processes, one Postgres.** A Next.js web process and a Graphile Worker
process, sharing one database and one `src/domain`. Serverless is ruled out deliberately:
auction soft-close needs second-level accuracy (below cron's one-minute floor), SSE
connections are held open, and both processes want stable pooled connections.

**Postgres is the centre of gravity** — database, job queue, and real-time backplane in
one system. No Redis, no queue vendor, no realtime vendor, no payment processor.

**Authentication is self-hosted through Better Auth.** Verified email/password is the
current sign-in and account-creation path. Users, sessions, and password credentials
remain in CollectTT's Postgres, preserving one stable user ID for profiles, listings,
reputation, and deals.

**Brevo is the outbound email provider.** Better Auth uses the same shared email adapter
as deal notifications for verification and password-reset messages. `console` mode prints
messages locally; `brevo` mode sends transactional email through the official Brevo SDK.
Future SMS can be added as a separate notification adapter after phone verification and
consent are designed—it is not coupled to sign-in.

```
src/
  domain/          ★ pure logic, imported by BOTH processes. Imports nothing from db/app.
    states/          the state machine — payment, custody, transaction rollup, listing
    categories/      per-category attribute declarations + derived Zod/filters
    policy/          deadlines, reputation thresholds, eligibility
  db/
    schema/          Drizzle tables; enums mirrored from domain/states
    atomic/        ★ hand-rolled conditional SQL: claim-listing, place-bid
  jobs/
    enqueue.ts     ★ transactional enqueue — the load-bearing utility
    tasks/           every handler idempotent
  notifications/     one dispatcher, pluggable adapters (in-app, email; WhatsApp later)
  services/          all writes go through here
  app/               Next.js App Router
```

### The three ideas worth knowing

**1. A transaction has three state columns, not one.**

```
payment_state    the money track      pending -> buyer_marked_paid -> confirmed
custody_state    the item track       awaiting_dropoff -> at_relay -> ... -> picked_up
state            the rollup           open -> completed / reneged_* / cancelled
```

A flat enum cannot express "paid but not collected" versus "collected but not paid". The
tracks advance independently, in any interleaving. The only coupling is the rollup:

> `state = 'completed'` ⟺ payment settled **and** custody settled

which is a database CHECK (`tx_completion_requires_both`), not a convention. The one
cross-track gate is release: an item moves `at_relay -> release_authorized` only when
payment is confirmed, enforced in SQL with an `EXISTS` clause. There is no code path
that can release an unpaid item.

**2. Custody follows the ITEM; payment follows the TRANSACTION.**

A `custody_holdings` row belongs to a *listing*. That is what lets a backup claimer be
promoted while the item sits untouched on the shelf — the buyer changes, the holding
re-links, the item never moves.

**3. Adding a category requires no migration.**

Categories are declared in `src/domain/categories/definitions.ts`. One config object
feeds four consumers: the Zod validator, the listing form, the browse filters, and the
`categories` seed rows. Adding a category is:

```bash
# 1. add a CategoryDefinition object
npm run seed:categories      # 2. that's it
```

No `ALTER TABLE`, no new table, no enum value, no form code. `listings.category` is a
real foreign key to a seeded lookup table, and `listings.attributes` is JSONB validated
by a `.strict()` schema — so integrity stays strict everywhere it matters and
flexibility lives only where item descriptions genuinely vary.

### Store custody, concretely

A Store listing nominates one or more Stores; the buyer picks one from that list when
they claim (or when they bid), and that choice — not the seller's first-listed Store —
is what the holding opens against. From there the item walks the custody states
`awaiting_dropoff -> at_relay -> release_authorized -> picked_up`, with
`returned_to_seller` as the escape hatch at either shelf state.

**The drop-off code.** Every holding is born with a short `CT-XXXX` code drawn from an
alphabet that omits `I`, `L`, `O`, `0` and `1`, so a misread character cannot resolve to
a different real code. The seller quotes it at the counter and the clerk types it in; a
buyer shows the same code back when collecting. The code belongs to the **item**, not to
the buyer — when a buyer reneges and a backup is promoted, the holding re-links to the
new attempt and the code on the parcel stays valid, because nothing physically moved. A
collision on insert is retried against a fresh code rather than handed to the clerk as
an error.

**Release is two taps, deliberately.** `at_relay -> release_authorized` is the clerk
saying "the money is in, this is cleared"; `release_authorized -> picked_up` is the
separate, later act of a person walking in, showing their code and taking the parcel.
Collapsing them into one button would force the shop to either hold the item as
un-cleared until the buyer happens to appear, or mark it collected before anyone
collected it. Splitting them means the board can honestly show a "ready for collection"
shelf, and the audit trail records *when payment cleared* and *when the item left*
as two different facts.

**The gate is SQL, not a code path.** The first tap is the only cross-track dependency
in the system, and it is enforced inside the same `UPDATE` that flips the state:

```sql
update custody_holdings h set state = 'release_authorized'
 where h.id = $1 and h.state = 'at_relay'
   and exists (select 1 from transactions t
                where t.id = h.current_transaction_id
                  and t.state = 'open' and t.payment_state = 'confirmed')
```

Zero rows back means the clerk is told "payment has not been confirmed yet — do not hand
this item over." There is no window between checking and acting for a dispute to slip
through, and no service function that can be called in the wrong order to bypass it.

Note what kind of guarantee that is: the gate is a **statement, not a constraint**.
Unlike everything in the invariants table below, it binds every path *this application*
takes and nothing else — a stray `psql` session can still write `release_authorized`
onto an unpaid holding by hand. It is the strongest form the check can take while the
condition lives in another table, and it is why the release path is the one place with
no alternative service entry point.

**The shelf clock is settled on the database.** Drop-off starts a countdown — three days
unpaid, seven days paid, both configurable per store. Confirming payment *extends* it,
which is the right incentive: an unpaid item is pure liability for the shop. Each
recompute enqueues a `custody:overstay` sweep in the same transaction, keyed on the
holding so a later extension replaces the earlier job instead of racing it. When the
sweep fires, the handler re-checks expiry against `now()` in Postgres and no-ops if the
clock has since moved; a genuine overstay is flagged and the store is sent the owner's
contact details so they can chase it. An unpaid item with nobody left to hand it to goes
back to the seller rather than becoming the shop's problem.

### Pro subscriptions and raffles

Pro is a seller/creator subscription. It is separate from verification: a `Verified
Seller` or `Verified Store` status comes from the relevant review process, not from
payment. Pro members can host up to **two free raffles per calendar month**. Each
additional raffle in that month is a paid overage, enforced server-side and shown before
the raffle is published. Any member may participate; hosting is the gated capability.

Basic Store custody remains free in the MVP. Store Pro tools for advanced inventory,
multiple locations, and expanded staff controls are later scope.

### Invariants the database enforces

Not the application — the database. These protect someone's item or their reputation,
so they hold even against a bad migration or a stray psql session. Each has an
adversarial test in `tests/db/constraints.test.ts` that tries to violate it.

| Invariant | Guarantees |
|---|---|
| `claims_one_active` | exactly one live claimant per listing |
| `tx_one_open_per_listing` | at most one open transaction attempt per listing |
| `tx_completion_requires_both` | completion needs *both* tracks finished |
| `tx_dropoff_before_payment` | the seller's clock always expires before the buyer's |
| `tx_p2p_no_custody` | cash/ship deals never touch the custody track |
| `custody_one_live_per_listing` | an item cannot be on two shelves |
| `reputation_events_idem` | a retried job cannot double-count a fact |
| `bids_amount_unique` | the bid ladder is a total order — no tie ambiguity |

**Server-authoritative time throughout.** Every deadline, claim order and bid resolves on
the database clock (`now()`), never the app process and never a client.

**Transactional job enqueue.** `enqueue(tx, task, payload)` writes the job inside the
transaction that changed the state, so "marked reneged but forgot to promote the next
buyer" is structurally impossible. There is deliberately no non-transactional variant.

---

## Deploying

`render.yaml` declares the web service, worker service and Postgres. Storage moves from
MinIO to Cloudflare R2 and email from console to Brevo — both are credential changes,
not code changes, because each sits behind an adapter used from day one.

Production authentication/email requires:

- `APP_URL` and `BETTER_AUTH_URL` set to the canonical HTTPS origin;
- `EMAIL_ADAPTER=brevo`, `BREVO_API_KEY`, and a verified `EMAIL_FROM` on the web service;
- the same Brevo delivery settings on the worker for queued deal notifications; and
- Brevo domain verification/DKIM/DMARC records published at the active DNS provider.

```bash
npm run db:migrate && npm run seed:categories   # after first deploy
```

---

### How a deal resolves

```
listing active
   │
   ├─ straight sale ──► ★ atomic claim (one conditional UPDATE picks the winner)
   │                       everyone else joins the backup stack, depth 4
   │
   └─ auction ────────► bids on a total-ordered ladder; a bid inside the closing
                         window pushes the deadline out (soft close)
   │
   ▼
transaction opens ──► payment window starts, deadline jobs enqueued in the same tx
   │
   ├─ buyer marks paid ──► seller confirms ──► COMPLETED ──► blind ratings unlock
   │                          │
   │                          └─ seller disputes ──► back to pending (clock unchanged)
   │
   └─ window lapses ──► reneged_buyer, fact recorded, restrictions re-evaluated
                          │
                          ├─ next candidate exists ──► promoted at THEIR OWN price,
                          │                             fresh window, seller does nothing
                          └─ none left ──► relisted, or ended_no_sale
```

The claim stack and the bid ladder are two ladders feeding **one** promotion algorithm,
which is why a reneged auction winner costs no extra machinery.

## What is built, and what is not

**Phase 0 — done**
accounts (verified email/password, verification and password recovery) ·
profiles · multi-category listing CRUD · browse with category *and* attribute filtering ·
image upload → R2/MinIO → worker-generated responsive variants · notification dispatcher
with in-app + console/Brevo email adapters · the full schema and state machine for every
later phase

**Phase 1 — done**
atomic straight-sale claim + backup-claim stack · auctions with anti-snipe soft close,
reserve and buyout · transaction lifecycle + mark-paid/confirm handshake with the
dispute reversal · payment window → reneged → promote next candidate · symmetric seller
deadlines · objective reputation events, counters and automatic restrictions · blind
mutual ratings · public member trust pages · live auction feed by polling

**Phase 2 — done**
two-track payment/custody model · Store nomination on a listing, Store choice on
the claim *and* the bid · Store drop-off with `CT-XXXX` codes · SQL-enforced
payment-gated release · store audit/control board with receive-by-code and the four
counter actions · per-store time-bounded custody with an overstay sweep · size and
eligibility gate · unpaid-item return-to-seller · per-role custody panel on the deal
page

**MVP additions — next**
shared Store profiles with invited staff access · personal sellers can choose a Store as
their pickup/drop-off location · Store-owned listings can opt into Store Seller mode ·
Pro seller/creator subscription · up to two free raffles per Pro member per month, with
paid overage for additional raffles · separate Verified Seller and Verified Store states

**Phase 3 — next**
WhatsApp notification adapter + store bot · full-service pickup & delivery rail with
per-zone pricing · WhatsApp OTP · SSE upgrade from polling

**Later** — Store Pro tools · vouching · promoted listings · seller analytics · grading
concierge · sponsorship placements
