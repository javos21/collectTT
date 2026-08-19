# Phase 2 — Custody & Store Tooling

**Date:** 2026-08-18
**Status:** Approved design, ready for implementation planning
**Deliverable (from the PDD):** relay escrow works; stores get their control tool.

---

## 1. Context

Phase 2 is not a greenfield build. The custody **domain and service layer already
exists** — it was written alongside Phase 0/1 so that the state machine and schema for
every later phase could be agreed before the flows that use them. What has never
existed is any way for a user to reach it.

Already complete:

| Component | What it provides |
|---|---|
| `src/domain/states/custody.ts` | States, legal transitions, actor table, payment-gated transition set |
| `src/db/schema/custody.ts` | `relay_stores`, `relay_store_staff`, `custody_holdings`; the `custody_one_live_per_listing` partial unique index; store-board and shelf-clock indexes; `custody_store_required` and `custody_courier_has_no_store` CHECKs |
| `src/services/custody.ts` | `openOrRelinkHolding`, `markReceived`, `authorizeRelease`, `markPickedUp`, `returnToSeller`, `voidHolding`, `recomputeShelfClock`, `onPaymentConfirmed`, `onTransactionTerminated`, `storeBoard`, `storesForStaff` |
| `src/db/atomic/authorize-release.ts` | The one cross-track gate, enforced in SQL |
| `src/domain/policy/eligibility.ts` | `checkEligibility`, `availablePaths` — the size gate |
| `src/domain/policy/windows.ts` | Shelf clocks; confirming payment *extends* the clock |
| `src/notifications/events.ts` | All four custody events declared |
| `recomputeShelfClock` | Already enqueues `custody:overstay` transactionally, with a `jobKey` and a `runAt` |

`storeBoard()`, `checkEligibility()` and `availablePaths()` have **zero callers** today.
`src/services/transactions.ts` already calls into custody at all four lifecycle seams.

Phase 2 is therefore mostly **wiring, surfaces and two defect fixes** — not new domain
logic. The plan should treat any urge to rewrite `src/services/custody.ts` as a signal
that something has been misunderstood.

---

## 2. Decisions

These were settled during brainstorming and are not open in the plan.

1. **Store staff authenticate with the existing magic link.** A clerk is a member who
   appears in `relay_store_staff`. No new credential type. This keeps
   `received_by_user_id` / `released_by_user_id` — already `profiles` foreign keys —
   meaningful, which is half of what an audit log is for. A shared-device mode belongs
   with the Phase 3 WhatsApp store bot, which is the real answer to shop-floor friction.

2. **The seller nominates candidate stores; the buyer picks one at claim time.** Both
   parties consent to the location before the claim locks. The seller controls where
   they must travel to drop off; the buyer controls where they must travel to collect.

3. **Overstay flags and notifies. It records no reputation event.** Reputation stays
   about deal-breaking. A paid-but-uncollected item has already settled on the money
   track, and life gets in the way of a pickup.

4. **Every holding carries a short drop-off code**, used for both drop-off and
   collection. It is the clerk's lookup key and the member's token.

5. **Approach: a `/store` route group in the existing Next app**, with server actions
   calling `src/services/custody.ts` directly. No API tier — the Phase 3 WhatsApp bot
   runs in the worker process and can import the same service module, so the shared
   layer the PDD wants already exists and is the service, not an HTTP surface. An API
   tier would put custody authorisation logic in two places.

---

## 3. Data model

One migration, `drizzle/0003_*.sql`, generated via `npm run db:generate`. All three
changes land together: they are one coherent change, and the `bids` columns are a
prerequisite for relay auctions working at all (see §6.1).

### 3.1 `listing_relay_stores`

The seller's candidate stores. Composite-PK join table, mirroring the existing
`relay_store_staff` shape.

```
listing_id  uuid  not null  FK -> listings.id      on delete cascade
store_id    uuid  not null  FK -> relay_stores.id  on delete restrict
primary key (listing_id, store_id)
```

`on delete restrict` on the store side is deliberate: a store with live listings
pointing at it must not be deletable out from under them. Deactivation is what
`relay_stores.active` is for, and the claim-time picker filters on it.

A join table rather than a `uuid[]` column on `listings`, because this repo keeps real
foreign keys everywhere integrity matters — `listings.category` is an FK to a seeded
lookup for exactly this reason. `fulfillment_paths` is allowed to be an array because
its values are enum-checked; store ids are not.

**Known limitation, stated deliberately.** "If you declare the `relay` path you must
nominate at least one store" spans two tables and therefore **cannot be a database
CHECK**. It is a Zod rule in `src/services/listings.ts`. It does **not** belong in the
README's invariants table, which is reserved for constraints the database itself
enforces. A trigger was considered and rejected: the failure mode is mild (a relay
listing nobody can claim via relay), and the atomic claim re-validates the chosen store
anyway.

### 3.2 `custody_holdings.dropoff_code`

`text not null unique`. Format `CT-XXXX` over a 32-character alphabet with `I`, `L`,
`O`, `0` and `1` removed, so a misread character cannot resolve to a different code.

Generated inside `openOrRelinkHolding` with a bounded retry on unique violation. The
space is ~1M against a few dozen live holdings, so a collision is rare and a retry
makes it a non-event.

**The code is not regenerated when a holding re-links on promotion.** The code belongs
to the item on the shelf, not to the buyer — the same reasoning that puts
`custody_holdings` on the listing rather than the transaction. A promoted buyer sees the
existing code; the item never moves and the clerk's log entry never changes identity.

The migration lands the column in three steps — add nullable, backfill generated codes,
set not null — so it is replayable against a database that already holds rows.

### 3.3 `bids.fulfillment_path` and `bids.relay_store_id`

Mirrors what `claims` already carries. See §6.1 for why this is a defect fix, not a
feature.

---

## 4. The store surface

### 4.1 Authentication

`src/lib/store-session.ts` — `requireStoreStaff(storeId)` composes the existing
`currentUser()` with the existing `storesForStaff()`, returning `{ user, store, role }`
or throwing.

Enforcement lives in the service, not here. `assertStoreAuthority` in
`src/services/custody.ts` **already re-checks** membership against the holding's own
store on every write. `requireStoreStaff` is the routing and UX layer — it decides what
a clerk can *see*. A bug in a page cannot release someone else's item.

### 4.2 Routes

- `/store` — zero stores renders a plain "you are not store staff" page; one store
  redirects; two or more render a picker
- `/store/[storeId]` — the board
- `/store/[storeId]/actions.ts` — four server actions wrapping the four existing
  service calls

### 4.3 The board

Four groups rendered from the single existing `storeBoard()` query, which already sorts
urgent-first:

1. **Expected arrivals** (`awaiting_dropoff`) — seller, item, size class, code
2. **On the shelf** (`at_relay`) — paid/unpaid chip, days held, clock; overstayed rows
   pinned to the top with the eviction prompt
3. **Ready for collection** (`release_authorized`)
4. **Recently settled** (`picked_up`, `returned_to_seller`, `voided`) — the audit half

`StoreBoardRow` gains `ownerContact` (the seller's `phone_e164`, falling back to email)
for the eviction prompt. The query already joins `profiles` for `sellerName`, so this is
one more column, not another join.

### 4.4 Receive-by-code — the primary counter interaction

One text box at the top of the board. The lookup is scoped to *this store* and to
`awaiting_dropoff`. An unrecognised code returns a refusal, not an error:

> No expected drop-off with that code. Do not accept this item.

That sentence is where "if it's not in the log, it doesn't belong there" stops being
doctrine and becomes a clerk's script for turning someone away. It is the answer to
meetup-leakage.

### 4.5 Release is two actions, not one

At the counter a clerk presses "Authorize release" and then "Mark picked up" — two taps
for one physical handover. They stay separate:

- `release_authorized` is a real, durable state on the `full_service` path, where the
  platform courier collects hours after clearance
- the payment gate is the system's single most important check and deserves its own
  deliberately recorded act, with its own actor and timestamp

Collapsing them would make that check a side effect of a different button.

### 4.6 Seeding

`scripts/seed-dev.ts` gains a relay store, a staff member, and candidate-store links on
its sample listings. Without it there is no way to sign in and see any of this locally.

---

## 5. Member-facing flows

### 5.1 Claim-time store selection and the size gate

The claim form in `src/app/listings/[id]/page.tsx` gains a store picker, revealed when
`relay` is selected. Options are the seller's candidates, intersected with `active`
stores, intersected with those accepting the listing's size class.
`src/app/listings/[id]/actions.ts` passes `relayStoreId` through to `openTransaction`,
which has always accepted it.

**The picker's filtering is UX only.** The server action re-runs `checkEligibility` with
restrictions loaded through the existing `activeRestrictions`. The form is
client-supplied, and `availablePaths` exists precisely so that a `meetup_only`
restriction cannot be bypassed by posting a hand-edited path.

### 5.2 The custody panel on the deal page

`src/app/deals/[id]/page.tsx` currently prints the raw custody state with underscores
stripped. It becomes a per-role panel:

- **Seller**, while `awaiting_dropoff`: the store's name and address, their drop-off
  code, and the drop-off deadline
- **Buyer**, once `at_relay`: the code, the store, and the collection deadline
- **Either**, on `returned_to_seller` or `voided`: what happened and what to do next

---

## 6. Defects fixed in this phase

### 6.1 Auctions on relay listings cannot close

`claims` carries `fulfillment_path` and `relay_store_id`, with a schema comment
explaining that a backup claimer's store choice must survive until promotion. `bids`
carries neither, and `nextFromBidLadder` in `src/services/transactions.ts` says so in a
comment: the ladder falls back to `listing.paths[0]`.

In Phase 1 this was harmless — every path was peer-to-peer and no store was needed. In
Phase 2 it breaks. An auction on a relay-only listing closes, `openTransaction` runs
with `path='relay'` and no `relayStoreId`, `openOrRelinkHolding` inserts
`holder='relay_store'` with `store_id = null`, and the `custody_store_required` CHECK
rejects the insert. The auction cannot close.

**Fix:** add `fulfillment_path` and `relay_store_id` to `bids`, chosen by the bidder when
placing a bid, and carry them through auction close and runner-up promotion. This closes
the hole and preserves the symmetry the README already claims — a promoted runner-up
gets their own price *and* their own collection point.

The bid form gains the same path/store selection as the claim form, under the same
eligibility re-validation.

### 6.2 Two custody notifications render broken sentences

`custody_received_buyer`'s template reads `deadline`; `custody_ready_for_pickup`'s reads
`expiresAt`. Neither `notify` call in `src/services/custody.ts` passes those keys, and
`str()` falls back to the empty string, so they currently render "Pay by ." and "Collect
it by .". Silent degradation, not a crash.

**Fix:** both call sites pass the missing dates.

---

## 7. The overstay handler

`src/jobs/tasks/custody-overstay.ts`, registered in `taskList`. Scheduling already
exists — `recomputeShelfClock` enqueues it transactionally with a `jobKey` and `runAt`,
so jobs are currently being scheduled into a task that does not exist.

The handler, idempotent as every handler must be:

1. Re-read the holding. No-op unless the state is still live **and** `custody_expires_at`
   is genuinely in the past. The clock can extend under an already-queued job — paying
   re-arms it — so the guard read is load-bearing, not defensive decoration.
2. Stamp `overstay_flagged_at`.
3. Fire `custody_overstay_store` with `ownerContact`.

No reputation event, per decision 3.

---

## 8. Testing and verification

**`tests/flows/custody-loop.test.ts`:**

- full happy path: drop-off → payment confirmed → release authorized → picked up →
  transaction completed
- the release gate refuses an unpaid item — asserted against the SQL, not the service
- return-to-seller after a lapsed payment window
- re-link on promotion leaves the item, its shelf position and its code untouched, and
  moves the holding to the new transaction
- the size gate refuses a store that does not accept the listing's size class
- a relay auction closes and opens a holding at the winning bidder's chosen store
  (regression test for §6.1)

**`tests/db/constraints.test.ts`** gains adversarial cases for the two custody CHECKs, in
the existing style.

**`scripts/verify-phase2.ts`**, shaped like the existing phase-1 script, run against the
live worker: drop-off, the overstay sweep firing on a shortened clock, and the
notification landing. The overstay sweep is precisely the part unit tests cannot prove,
because it depends on the worker actually picking up a scheduled job.

Added to `package.json` as `verify:phase2`.

---

## 9. Out of scope

Explicitly deferred, to keep this phase honest:

- WhatsApp adapter and the store bot (Phase 3 — gated on Meta verification)
- The pickup and delivery rail, and the `full_service` path's courier flows beyond the
  `release_authorized` state already modelled
- Holding fees and the store-credit ledger — `holding_fee_config` stays an unused seam
- Shared-device or PIN auth for shop tablets
- SSE upgrade; the store board polls like the auction feed does

---

## 10. Definition of done

- A seller nominates stores, a buyer claims relay and picks one, and the size gate
  refuses an ineligible pairing
- A clerk signs in, sees only their shelf, receives an item by code, and is told to
  refuse an unknown one
- An unpaid item cannot be released, and the refusal is enforced in SQL
- A paid item is released, collected, and completes the transaction
- An overstayed item flags itself and notifies the store with the owner's contact
- An unpaid item after a lapsed window returns to the seller
- A relay auction closes without violating a CHECK
- `npm test`, `npm run typecheck`, `npm run verify:phase1` and `npm run verify:phase2`
  all pass
