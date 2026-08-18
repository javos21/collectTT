# CollectTT

Trust and coordination for peer-to-peer trading card, comic and collectible deals in
Trinidad & Tobago.

**This is not a marketplace.** Buyers and sellers pay each other directly — cash, bank
transfer, however they agree. The platform never holds funds, never processes a payment,
and has no PCI scope. It collects only its own service fees, for logistics it actually
performed. See [product-design-document.md](product-design-document.md) for the full
rationale.

**Status: Phase 1 complete.** A full deal now runs end to end, peer to peer: atomic
claims with a backup queue, auctions with anti-snipe soft close, the
mark-paid/confirm-received handshake, automatic renege-and-promote, objective
reputation with automatic restrictions, and blind mutual ratings. Custody and the store
tooling are Phase 2.

---

## Running it locally

Everything runs on your machine. **No vendor account is required** — object storage is a
MinIO container and sign-in links print to your terminal.

```bash
docker compose up -d      # Postgres (:5434) + MinIO (:9000, console :9001)
cp .env.example .env.local
npm install
npm run setup             # migrations + category seed
npm run seed:dev          # optional: sample members and listings

npm run dev               # web process    -> http://localhost:3000
npm run dev:worker        # worker process (separate terminal)
```

Sign in at `/sign-in` with any email — the magic link appears in the terminal running
`npm run dev`, because `EMAIL_ADAPTER=console`.

### Verifying it works

```bash
npm test              # 127 tests: state machine, categories, DB constraints, trading flows
npm run typecheck
npm run verify        # Phase 0 end-to-end: presign -> upload -> worker -> variants
npm run verify:phase1 # Phase 1 end-to-end against the LIVE worker: auction close,
                      # renege, runner-up promotion, backup-claim promotion
```

Both `verify` scripts need all three processes running — they prove the chain
`web -> transactional enqueue -> Graphile Worker -> handler`, which unit tests cannot.

---

## Architecture in one page

**Two persistent processes, one Postgres.** A Next.js web process and a Graphile Worker
process, sharing one database and one `src/domain`. Serverless is ruled out deliberately:
auction soft-close needs second-level accuracy (below cron's one-minute floor), SSE
connections are held open, and both processes want stable pooled connections.

**Postgres is the centre of gravity** — database, job queue, and real-time backplane in
one system. No Redis, no queue vendor, no realtime vendor, no payment processor.

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
MinIO to Cloudflare R2 and email from console to Resend — both are credential changes,
not code changes, because each sits behind an adapter used from day one.

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
accounts (email magic link) · profiles · multi-category listing CRUD · browse with
category *and* attribute filtering · image upload → R2/MinIO → worker-generated
responsive variants · notification dispatcher with in-app + email adapters · the full
schema and state machine for every later phase

**Phase 1 — done**
atomic straight-sale claim + backup-claim stack · auctions with anti-snipe soft close,
reserve and buyout · transaction lifecycle + mark-paid/confirm handshake with the
dispute reversal · payment window → reneged → promote next candidate · symmetric seller
deadlines · objective reputation events, counters and automatic restrictions · blind
mutual ratings · public member trust pages · live auction feed by polling

**Phase 2 — next**
custody track live · relay drop-off · store audit/control log · time-bounded custody ·
size/eligibility gate · unpaid-item return-to-seller

**Later** — WhatsApp adapter + store bot · pickup & delivery rail · vouching ·
subscriptions · promoted listings · grading concierge · SSE upgrade from polling
