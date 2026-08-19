# Phase 2 — Custody & Store Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the relay custody track reachable end to end — a seller nominates stores, a buyer picks one, a clerk receives, releases and hands over the item through a store board, and an overstayed item flags itself.

**Architecture:** The custody domain and service layer already exists and is not being rewritten. This plan adds the surfaces that call it (`/store` route group, claim-time store picker, deal-page panel), the one missing job handler, three schema additions, and two defect fixes. All writes go through the existing `src/services/custody.ts`, which remains the only writer of `custody_holdings.state`.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Drizzle ORM, Postgres, Graphile Worker, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-phase-2-custody-design.md`

## Global Constraints

- **Never rewrite `src/services/custody.ts`'s existing exported functions.** They are complete and tested-by-design. Add to them; do not restructure them. An urge to rewrite means something has been misread.
- **`src/domain` imports nothing from `db/` or `app/`.** It is imported by both processes.
- **Every job handler is idempotent.** First statement is a conditional read or write that no-ops when state has already moved.
- **Every enqueue is transactional** — `enqueue(tx, task, payload)` inside the transaction that caused the work. There is no non-transactional variant.
- **Server-authoritative time.** Deadlines, ordering and clocks resolve on `now()` in the database, never in the app process and never from a client.
- **Tests need the local database:** `docker compose up -d && npm run setup`. `vitest` runs with `fileParallelism: false` because tests share one database.
- **Run after every task:** `npm test` and `npm run typecheck`. Both must pass before commit.
- Existing verification must keep passing: `npm run verify` (Phase 0) and `npm run verify:phase1`.

---

### Task 1: Schema additions and the drop-off code generator

All three schema changes land in one migration — they are one coherent change, and the `bids` columns are a prerequisite for relay auctions working at all.

**Files:**
- Create: `src/domain/dropoff-code.ts`
- Create: `tests/domain/dropoff-code.test.ts`
- Modify: `src/db/schema/custody.ts` (add `listingRelayStores`; add `dropoffCode` to `custodyHoldings`)
- Modify: `src/db/schema/listings.ts` (add two columns to `bids`)
- Create: `drizzle/0003_*.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `generateDropoffCode(): string`, `DROPOFF_CODE_ALPHABET`, table `listingRelayStores`, column `custodyHoldings.dropoffCode`, columns `bids.fulfillmentPath` and `bids.relayStoreId`.

> **Note on the alphabet.** The spec says "32-character alphabet with I, L, O, 0 and 1 removed". That is arithmetically 31 characters (36 − 5), not 32. Use 31. The space is 31⁴ = 923,521, which still supports the spec's "~1M against a few dozen live holdings" reasoning.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/dropoff-code.test.ts
import { describe, it, expect } from 'vitest';
import { generateDropoffCode, DROPOFF_CODE_ALPHABET } from '../../src/domain/dropoff-code';

describe('drop-off code', () => {
  it('has the CT- prefix and four body characters', () => {
    expect(generateDropoffCode()).toMatch(/^CT-[A-Z2-9]{4}$/);
  });

  it('excludes characters that can be misread', () => {
    for (const confusable of ['I', 'L', 'O', '0', '1']) {
      expect(DROPOFF_CODE_ALPHABET).not.toContain(confusable);
    }
    expect(DROPOFF_CODE_ALPHABET).toHaveLength(31);
  });

  it('does not repeat itself over a large sample', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateDropoffCode()));
    // 31^4 space, 2000 draws — a handful of collisions is expected, a flood is a bug.
    expect(seen.size).toBeGreaterThan(1950);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/dropoff-code.test.ts`
Expected: FAIL — cannot resolve `../../src/domain/dropoff-code`

- [ ] **Step 3: Write the generator**

```ts
// src/domain/dropoff-code.ts
/**
 * The short code a member shows at the counter.
 *
 * It is BOTH the drop-off key and the collection token. A clerk with an unknown code
 * has a system-backed reason to refuse an item, which is the operational half of
 * "if it's not in the log, it doesn't belong there".
 *
 * The alphabet omits I, L, O, 0 and 1 so a misread character cannot resolve to a
 * different valid code.
 */

import { randomInt } from 'node:crypto';

export const DROPOFF_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateDropoffCode(): string {
  let body = '';
  for (let i = 0; i < 4; i += 1) {
    body += DROPOFF_CODE_ALPHABET[randomInt(DROPOFF_CODE_ALPHABET.length)];
  }
  return `CT-${body}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/dropoff-code.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add `listingRelayStores` and `dropoffCode` to the custody schema**

Both go in `src/db/schema/custody.ts`, **not** `listings.ts` — `custody.ts` already imports `listings`, so putting the join table here avoids a circular import between the two schema modules.

```ts
// src/db/schema/custody.ts — add to the custodyHoldings column block,
// immediately after `sizeClass`:
    /**
     * ★ The counter token. Shown to the seller for drop-off and to the buyer for
     *   collection. NOT regenerated when a holding re-links on promotion — the code
     *   belongs to the item on the shelf, not to the buyer.
     */
    dropoffCode: text('dropoff_code').notNull().unique(),
```

```ts
// src/db/schema/custody.ts — append at the end of the file
/**
 * The stores a seller is willing to drop off at. The buyer picks one of these at claim
 * time, so both parties consent to the location before the claim locks.
 *
 * A join table rather than a uuid[] on `listings`, because a store id with no foreign
 * key is a dangling reference waiting to happen. `on delete restrict` means a store
 * with live listings cannot be deleted out from under them — deactivation is what
 * `relay_stores.active` is for.
 */
export const listingRelayStores = pgTable(
  'listing_relay_stores',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => relayStores.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.storeId] })],
);
```

- [ ] **Step 6: Add the two `bids` columns**

```ts
// src/db/schema/listings.ts — add to the `bids` column block, after `isBuyout`:
    /**
     * ★ The bidder's chosen settlement, mirroring what `claims` has always carried.
     *   Without these a relay auction cannot close: openTransaction would insert a
     *   holding with holder='relay_store' and store_id=null, violating
     *   custody_store_required. Nullable because bids predating Phase 2 have neither;
     *   nextFromBidLadder falls back to the listing's first declared path.
     */
    fulfillmentPath: fulfillmentPathEnum('fulfillment_path'),
    relayStoreId: uuid('relay_store_id'),
```

`relayStoreId` is a plain `uuid` with no foreign key, mirroring `claims.relayStoreId` exactly. (That `claims` lacks the FK is pre-existing and out of scope for this phase; the store is re-validated inside `openOrRelinkHolding` either way.) Confirm `fulfillmentPathEnum` and `uuid` are already imported in this file — `fulfillmentPathEnum` is used by `claims`, `uuid` by every table.

- [ ] **Step 7: Generate the migration**

Run: `npm run db:generate`

Then **hand-edit the generated SQL** so `dropoff_code` lands in three steps rather than one, making it replayable against a database that already holds rows. Replace drizzle's single `ADD COLUMN ... NOT NULL` with:

```sql
ALTER TABLE "custody_holdings" ADD COLUMN "dropoff_code" text;

UPDATE "custody_holdings"
   SET "dropoff_code" = 'CT-' || upper(substr(md5(random()::text || id::text), 1, 4))
 WHERE "dropoff_code" IS NULL;

ALTER TABLE "custody_holdings" ALTER COLUMN "dropoff_code" SET NOT NULL;
ALTER TABLE "custody_holdings" ADD CONSTRAINT "custody_holdings_dropoff_code_unique" UNIQUE("dropoff_code");
```

The backfill only has to produce *something* unique for pre-existing rows; new codes come from `generateDropoffCode()`. (`md5` can emit the excluded characters — acceptable for legacy backfill, which no clerk will ever be handed.)

- [ ] **Step 8: Apply and verify the migration**

Run: `npm run db:migrate && npm test && npm run typecheck`
Expected: migration applies; all existing tests still PASS.

- [ ] **Step 9: Commit**

```bash
git add src/domain/dropoff-code.ts tests/domain/dropoff-code.test.ts src/db/schema drizzle
git commit -m "feat(custody): add listing_relay_stores, dropoff_code, and bid path/store columns"
```

---

### Task 2: Generate the drop-off code when a holding opens

**Files:**
- Modify: `src/services/custody.ts` (the insert inside `openOrRelinkHolding`)
- Create: `tests/flows/custody-loop.test.ts` (first test; grows through the plan)

**Interfaces:**
- Consumes: `generateDropoffCode()` from Task 1.
- Produces: every `custody_holdings` row has a `dropoff_code`; the code is stable across re-link.

- [ ] **Step 1: Write the failing test**

Create the file with the shared fixtures the later tasks reuse.

```ts
// tests/flows/custody-loop.test.ts
/**
 * PHASE 2 CUSTODY FLOW TESTS.
 *
 * The physical half of a deal: drop-off, the payment-gated release, collection,
 * return-to-seller, and the re-link that lets a promoted buyer inherit an item that
 * never moved.
 *
 * Requires the local database: `docker compose up -d && npm run setup`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { db, pool } from '../../src/db/client';
import { users } from '../../src/db/schema/auth';
import { profiles, reputationCounters } from '../../src/db/schema/profiles';
import { listings } from '../../src/db/schema/listings';
import { transactions } from '../../src/db/schema/transactions';
import { relayStores, relayStoreStaff, custodyHoldings } from '../../src/db/schema/custody';
import { claimListing } from '../../src/db/atomic/claim-listing';

const SUFFIX = randomUUID().slice(0, 8);
const seller = `c_seller_${SUFFIX}`;
const buyerA = `c_buyerA_${SUFFIX}`;
const buyerB = `c_buyerB_${SUFFIX}`;
const clerk = `c_clerk_${SUFFIX}`;
const everyone = [seller, buyerA, buyerB, clerk];

let storeId: string;

async function createUser(id: string): Promise<void> {
  await db.insert(users).values({ id, name: id, email: `${id}@test.local`, emailVerified: true });
  await db.insert(profiles).values({ userId: id, displayName: id, handle: id });
  await db.insert(reputationCounters).values({ userId: id });
}

async function makeRelayListing(over: Partial<typeof listings.$inferInsert> = {}): Promise<string> {
  const rows = await db
    .insert(listings)
    .values({
      sellerId: seller,
      category: 'trading_card',
      attributes: {},
      attributesVersion: 1,
      title: `Custody listing ${randomUUID().slice(0, 6)}`,
      saleType: 'straight_sale',
      status: 'active',
      priceCents: 10_000,
      fulfillmentPaths: ['relay'],
      settlementMethods: ['cash'],
      sizeClass: 'small',
      publishedAt: new Date(),
      ...over,
    })
    .returning({ id: listings.id });
  const row = rows[0];
  if (row === undefined) throw new Error('failed to create listing');
  return row.id;
}

beforeAll(async () => {
  for (const id of everyone) await createUser(id);
  const stores = await db
    .insert(relayStores)
    .values({
      name: `Test Relay ${SUFFIX}`,
      area: 'Port of Spain',
      acceptsSizeClasses: ['small'],
      paidCustodyDays: 7,
      unpaidCustodyDays: 3,
    })
    .returning({ id: relayStores.id });
  storeId = stores[0]!.id;
  await db.insert(relayStoreStaff).values({ storeId, userId: clerk, role: 'staff' });
});

afterAll(async () => {
  await db.delete(relayStoreStaff).where(eq(relayStoreStaff.storeId, storeId));
  await db.execute(sql`delete from custody_holdings where store_id = ${storeId}`);
  await db.execute(sql`delete from transactions where buyer_id = any(${everyone})`);
  await db.execute(sql`delete from listings where seller_id = ${seller}`);
  await db.delete(relayStores).where(eq(relayStores.id, storeId));
  await db.execute(sql`delete from profiles where user_id = any(${everyone})`);
  await db.execute(sql`delete from users where id = any(${everyone})`);
  await pool.end();
});

describe('drop-off code', () => {
  it('is generated when a holding opens', async () => {
    const listingId = await makeRelayListing();
    await claimListing({
      listingId,
      claimantId: buyerA,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });

    const holdings = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));

    expect(holdings).toHaveLength(1);
    expect(holdings[0]!.dropoffCode).toMatch(/^CT-[A-Z2-9]{4}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/flows/custody-loop.test.ts`
Expected: FAIL — the insert violates `null value in column "dropoff_code"`.

- [ ] **Step 3: Generate the code on insert, with a bounded retry**

In `src/services/custody.ts`, add the import and replace the `tx.insert(custodyHoldings)` call inside `openOrRelinkHolding`:

```ts
import { generateDropoffCode } from '../domain/dropoff-code';
```

```ts
  // ★ Retry on the unique index rather than pre-checking. 31^4 codes against a few
  //   dozen live holdings makes a collision rare; a retry makes it a non-event, and a
  //   pre-check would still race.
  let inserted: Array<{ id: string }> = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      inserted = await tx
        .insert(custodyHoldings)
        .values({
          listingId: input.listingId,
          currentTransactionId: input.transactionId,
          holder: input.path === 'relay' ? 'relay_store' : 'platform_courier',
          storeId: input.path === 'relay' ? input.storeId : null,
          state: 'awaiting_dropoff',
          sizeClass: input.sizeClass,
          dropoffCode: generateDropoffCode(),
        })
        .returning({ id: custodyHoldings.id });
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== '23505' || attempt === 4) throw error;
    }
  }
```

**Important:** a failed `INSERT` aborts the enclosing Postgres transaction, so this retry only works if the statement runs in its own savepoint. Drizzle's `tx.transaction()` opens a savepoint — wrap the retry body in `await tx.transaction(async (sp) => sp.insert(...))` if the plain form fails with `current transaction is aborted`. Verify which is needed by running the test; do not guess.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/flows/custody-loop.test.ts`
Expected: PASS

- [ ] **Step 5: Add the re-link stability test**

Append to `tests/flows/custody-loop.test.ts`:

```ts
  it('survives a re-link unchanged — the code belongs to the item, not the buyer', async () => {
    const listingId = await makeRelayListing();
    const first = await claimListing({
      listingId,
      claimantId: buyerA,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });

    const before = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));
    const originalCode = before[0]!.dropoffCode;

    // The item is on the shelf when the first buyer's window lapses.
    await db
      .update(custodyHoldings)
      .set({ state: 'at_relay', droppedOffAt: sql`now()` })
      .where(eq(custodyHoldings.id, before[0]!.id));

    const { terminateTransaction } = await import('../../src/services/transactions');
    await db.transaction(async (tx) => {
      await terminateTransaction({
        tx,
        transactionId: first.transactionId!,
        reason: 'non_payment',
        actorRole: 'system',
      });
    });

    const after = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));

    expect(after).toHaveLength(1);
    expect(after[0]!.dropoffCode).toBe(originalCode);
    expect(after[0]!.state).toBe('at_relay'); // the item did not move
  });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/flows/custody-loop.test.ts && npm run typecheck`
Expected: PASS (2 tests). The re-link test should pass without production changes — it is a characterization test proving the existing `openOrRelinkHolding` behaviour is what the spec claims.

- [ ] **Step 7: Commit**

```bash
git add src/services/custody.ts tests/flows/custody-loop.test.ts
git commit -m "feat(custody): generate a stable drop-off code when a holding opens"
```

---

### Task 3: Sellers nominate candidate relay stores

**Files:**
- Modify: `src/services/listings.ts` (Zod rule, write the join rows)
- Modify: `src/app/listings/new/page.tsx` (store checkboxes)
- Create: `src/services/relay-stores.ts`
- Test: `tests/flows/custody-loop.test.ts`

**Interfaces:**
- Consumes: `listingRelayStores` (Task 1).
- Produces: `listRelayStores(tx)`, `candidateStoresFor(tx, listingId, sizeClass)` returning `Array<{ id: string; name: string; area: string; address: string | null }>`; `listingInputSchema` accepts `relayStoreIds: string[]`.

- [ ] **Step 1: Write the failing test**

```ts
  it('refuses a relay listing with no nominated store', async () => {
    const { createListing } = await import('../../src/services/listings');
    await expect(
      createListing({
        sellerId: seller,
        input: {
          category: 'trading_card',
          title: 'Relay with no store',
          saleType: 'straight_sale',
          priceCents: 5000,
          fulfillmentPaths: ['relay'],
          settlementMethods: ['cash'],
          sizeClass: 'small',
          relayStoreIds: [],
          attributes: {},
        },
        publish: true,
      } as never),
    ).rejects.toThrow(/at least one relay store/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'no nominated store'`
Expected: FAIL — no such validation; the listing is created.

- [ ] **Step 3: Add the Zod rule and persist the rows**

In `src/services/listings.ts`, add to `listingInputSchema`'s object:

```ts
    /**
     * Candidate relay stores. The buyer picks one of these at claim time.
     * NOTE: "declaring relay requires at least one store" spans two tables and so
     * cannot be a database CHECK — this superRefine is the enforcement point. It is
     * deliberately NOT in the README's invariants table, which is for DB constraints.
     */
    relayStoreIds: z.array(z.string().uuid()).default([]),
```

and to its `.superRefine`:

```ts
    if (value.fulfillmentPaths.includes('relay') && value.relayStoreIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['relayStoreIds'],
        message: 'Nominate at least one relay store for drop-off',
      });
    }
```

Then, inside `createListing`'s transaction, immediately after `attachImages(...)`:

```ts
    if (input.relayStoreIds.length > 0) {
      await tx.insert(listingRelayStores).values(
        input.relayStoreIds.map((storeId) => ({ listingId: listing.id, storeId })),
      );
    }
```

Import `listingRelayStores` from `../db/schema/custody`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'no nominated store'`
Expected: PASS

- [ ] **Step 5: Add the store read service**

```ts
// src/services/relay-stores.ts
/**
 * Reads over relay stores. Writes to custody live in src/services/custody.ts; this is
 * only the lookup half — what a seller may nominate and what a buyer may pick.
 */

import { and, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../db/client';
import { relayStores, listingRelayStores } from '../db/schema/custody';
import type { SizeClass } from '../domain/states/listing';

export interface RelayStoreOption {
  id: string;
  name: string;
  area: string;
  address: string | null;
}

/** Every active store — what a seller chooses from when listing. */
export async function listRelayStores(tx: DbOrTx): Promise<RelayStoreOption[]> {
  return tx
    .select({
      id: relayStores.id,
      name: relayStores.name,
      area: relayStores.area,
      address: relayStores.address,
    })
    .from(relayStores)
    .where(eq(relayStores.active, true))
    .orderBy(relayStores.area, relayStores.name);
}

/**
 * What a BUYER may pick for this listing: the seller's nominations, intersected with
 * active stores, intersected with those that accept the item's size class.
 *
 * ★ This is UX filtering only. `claimListing` re-runs the size gate server-side,
 *   because the form is client-supplied.
 */
export async function candidateStoresFor(
  tx: DbOrTx,
  listingId: string,
  sizeClass: SizeClass,
): Promise<RelayStoreOption[]> {
  return tx
    .select({
      id: relayStores.id,
      name: relayStores.name,
      area: relayStores.area,
      address: relayStores.address,
    })
    .from(listingRelayStores)
    .innerJoin(relayStores, eq(relayStores.id, listingRelayStores.storeId))
    .where(
      and(
        eq(listingRelayStores.listingId, listingId),
        eq(relayStores.active, true),
        sql`${sizeClass} = any(${relayStores.acceptsSizeClasses})`,
      ),
    )
    .orderBy(relayStores.area, relayStores.name);
}
```

- [ ] **Step 6: Add the checkboxes to the listing form**

In `src/app/listings/new/page.tsx`: load `listRelayStores(db)` in the server component, render a checkbox group named `relayStoreIds` (mirroring the existing `fulfillmentPaths` checkbox group), and add to the form's parse block alongside `fulfillmentPaths`:

```ts
    relayStoreIds: formData.getAll('relayStoreIds').map(String),
```

Label it: **"Where will you drop it off?"** with helper text *"Pick every store you're willing to use — the buyer chooses one of these."*

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/services/listings.ts src/services/relay-stores.ts src/app/listings/new/page.tsx tests/flows/custody-loop.test.ts
git commit -m "feat(custody): sellers nominate candidate relay stores when listing"
```

---

### Task 4: Buyers pick a store at claim time

`claimListing` already accepts `relayStoreId`, validates the store is active, and runs the size gate ([src/db/atomic/claim-listing.ts](../../../src/db/atomic/claim-listing.ts)). Only the form and the server action are missing.

**Files:**
- Modify: `src/app/listings/[id]/actions.ts` (pass `relayStoreId`)
- Modify: `src/app/listings/[id]/page.tsx` (store picker)
- Test: `tests/flows/custody-loop.test.ts`

**Interfaces:**
- Consumes: `candidateStoresFor` (Task 3), `claimListing`.
- Produces: nothing new — wiring only.

- [ ] **Step 1: Write the failing test**

```ts
  it('refuses a store that does not accept the size class', async () => {
    const bigListing = await makeRelayListing({ sizeClass: 'large' });
    await expect(
      claimListing({
        listingId: bigListing,
        claimantId: buyerA,
        fulfillmentPath: 'relay',
        relayStoreId: storeId, // accepts 'small' only
      }),
    ).rejects.toThrow(/accepts small items only/i);
  });

  it('refuses a relay claim with no store chosen', async () => {
    const listingId = await makeRelayListing();
    await expect(
      claimListing({ listingId, claimantId: buyerA, fulfillmentPath: 'relay' }),
    ).rejects.toThrow(/choose which relay store/i);
  });
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'size class'`
Expected: PASS immediately — these are characterization tests locking in behaviour that `claimListing` already has. If either FAILS, stop: the gate is not doing what the spec claims and that must be understood before wiring a UI on top of it.

- [ ] **Step 3: Pass the store through the server action**

In `src/app/listings/[id]/actions.ts`, inside `claimAction`:

```ts
  const storeIdRaw = String(formData.get('relayStoreId') ?? '');
  const relayStoreId = storeIdRaw === '' ? null : storeIdRaw;

  let result;
  try {
    result = await claimListing({
      listingId,
      claimantId: user.userId,
      fulfillmentPath: path,
      relayStoreId,
    });
```

- [ ] **Step 4: Add the picker to the claim form**

In `src/app/listings/[id]/page.tsx`, load candidates in the server component:

```tsx
const relayCandidates = listing.fulfillmentPaths.includes('relay')
  ? await candidateStoresFor(db, id, listing.sizeClass)
  : [];
```

and render inside the existing `<form action={claimAction}>`, after the path `<select>`:

```tsx
{relayCandidates.length > 0 && (
  <>
    <label htmlFor="relayStoreId">Which store will you collect from?</label>
    <select id="relayStoreId" name="relayStoreId" defaultValue={relayCandidates[0]!.id}>
      {relayCandidates.map((store) => (
        <option key={store.id} value={store.id}>
          {store.name} — {store.area}
        </option>
      ))}
    </select>
    <p className="muted">Only used if you pick relay drop-off.</p>
  </>
)}
```

Keep it always-visible rather than toggling on the path `<select>` — this page is server-rendered with no client JS, and `claimListing` ignores `relayStoreId` on non-relay paths.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "src/app/listings/[id]" tests/flows/custody-loop.test.ts
git commit -m "feat(custody): buyers choose a relay store when claiming"
```

---

### Task 5: Fix the bid ladder — relay auctions cannot close

**Defect.** `claims` carries `fulfillment_path` and `relay_store_id`; `bids` carries neither, so `nextFromBidLadder` falls back to `listing.paths[0]`. On a relay-only auction that means `openTransaction` runs with `path='relay'` and no store, `openOrRelinkHolding` inserts `holder='relay_store'` with `store_id = null`, and `custody_store_required` rejects it. The auction cannot close.

**Files:**
- Modify: `src/db/atomic/place-bid.ts`
- Modify: `src/services/transactions.ts` (`nextFromBidLadder`, and the winner path in auction close)
- Modify: `src/app/listings/[id]/actions.ts`, `src/app/listings/[id]/bid-panel.tsx`
- Test: `tests/flows/custody-loop.test.ts`

**Interfaces:**
- Consumes: `bids.fulfillmentPath`, `bids.relayStoreId` (Task 1); `candidateStoresFor` (Task 3).
- Produces: `placeBid` accepts `fulfillmentPath?: FulfillmentPath` and `relayStoreId?: string | null`.

- [ ] **Step 1: Write the failing test**

```ts
  it('closes a relay auction at the winning bidder\'s chosen store', async () => {
    const { placeBid } = await import('../../src/db/atomic/place-bid');
    const { auctionClose } = await import('../../src/jobs/tasks/auction-close');
    const helpers = { logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } } as never;

    const listingId = await makeRelayListing({
      saleType: 'auction',
      priceCents: null,
      startBidCents: 5_000,
      endsAt: sql`now() + interval '1 hour'`,
    });

    await placeBid({
      listingId,
      bidderId: buyerA,
      amountCents: 6_000,
      fulfillmentPath: 'relay',
      relayStoreId: storeId,
    });

    await db.update(listings).set({ endsAt: sql`now() - interval '1 minute'` }).where(eq(listings.id, listingId));
    await auctionClose({ listingId }, helpers);

    const holdings = await db
      .select()
      .from(custodyHoldings)
      .where(eq(custodyHoldings.listingId, listingId));

    expect(holdings).toHaveLength(1);
    expect(holdings[0]!.storeId).toBe(storeId);
    expect(holdings[0]!.holder).toBe('relay_store');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'relay auction'`
Expected: FAIL — `new row for relation "custody_holdings" violates check constraint "custody_store_required"`. **This failure is the defect.** Record the exact message; it is the regression this task fixes.

- [ ] **Step 3: Accept and store the choice in `placeBid`**

In `src/db/atomic/place-bid.ts`, extend the options and validate exactly as `claimListing` does — the same store-active check and the same `checkEligibility` call — then persist on the bid row:

```ts
  fulfillmentPath?: FulfillmentPath;
  relayStoreId?: string | null;
```

```ts
      .insert(bids)
      .values({
        listingId: opts.listingId,
        bidderId: opts.bidderId,
        amountCents: opts.amountCents,
        isBuyout,
        fulfillmentPath: opts.fulfillmentPath ?? null,
        relayStoreId: opts.relayStoreId ?? null,
      })
```

Reuse the validation block from `claim-listing.ts` verbatim (store loaded from `relayStores`, `active` checked, `storeAcceptedSizes` fed into `checkEligibility`). Do not invent a second, differently-worded gate — a bidder and a claimer must be refused for the same reasons in the same words.

- [ ] **Step 4: Carry the choice through promotion**

In `src/services/transactions.ts`, replace the fallback comment and return in `nextFromBidLadder`:

```ts
    return {
      buyerId: row.bidderId,
      amountCents: row.amountCents,
      // ★ The bidder's OWN choice, mirroring how the claim stack has always worked.
      //   Falls back to the listing's first path only for bids placed before Phase 2.
      fulfillmentPath: (row.fulfillmentPath ?? listing.paths[0] ?? 'cash_meetup') as FulfillmentPath,
      relayStoreId: row.relayStoreId,
      bidId: row.id,
    };
```

Then find where `auctionClose` opens the winner's transaction and pass `relayStoreId` from the winning bid row the same way. Grep for `openTransaction(` in `src/jobs/tasks/auction-close.ts` and `src/services/transactions.ts` and make sure **every** call site on an auction path supplies it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'relay auction'`
Expected: PASS

- [ ] **Step 6: Add the picker to the bid form**

Mirror Task 4 exactly in `src/app/listings/[id]/bid-panel.tsx` (or the bid form in `page.tsx`) and read both fields in `bidAction`:

```ts
  const path = String(formData.get('fulfillmentPath') ?? '') as FulfillmentPath | '';
  const storeIdRaw = String(formData.get('relayStoreId') ?? '');

  result = await placeBid({
    listingId,
    bidderId: user.userId,
    amountCents,
    ...(path !== '' ? { fulfillmentPath: path } : {}),
    relayStoreId: storeIdRaw === '' ? null : storeIdRaw,
  });
```

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS, including all Phase 1 auction tests in `tests/flows/trading-loop.test.ts` — those exercise `nextFromBidLadder` and must not regress.

- [ ] **Step 8: Commit**

```bash
git add src/db/atomic/place-bid.ts src/services/transactions.ts "src/app/listings/[id]" tests/flows/custody-loop.test.ts
git commit -m "fix(custody): bids carry fulfillment path and relay store so relay auctions can close"
```

---

### Task 6: Fix the two broken notification strings

**Defect.** `custody_received_buyer`'s template reads `deadline` and `custody_ready_for_pickup`'s reads `expiresAt`; neither `notify` call passes them, and `str()` falls back to `''`, rendering "Pay by ." and "Collect it by .".

**Files:**
- Modify: `src/services/custody.ts` (two `notify` calls, and `holdingContext`)
- Test: `tests/flows/custody-loop.test.ts`

**Interfaces:**
- Consumes: existing `notify`, `holdingContext`.
- Produces: `HoldingContext` gains `paymentDeadlineAt: Date | null` and `custodyExpiresAt: Date | null`.

- [ ] **Step 1: Write the failing test**

```ts
  it('renders custody notifications with real dates', async () => {
    const { notifications } = await import('../../src/db/schema/notifications');
    const { markReceived } = await import('../../src/services/custody');

    const listingId = await makeRelayListing();
    await claimListing({ listingId, claimantId: buyerA, fulfillmentPath: 'relay', relayStoreId: storeId });
    const held = await db.select().from(custodyHoldings).where(eq(custodyHoldings.listingId, listingId));

    await db.transaction(async (tx) => {
      await markReceived({ tx, holdingId: held[0]!.id, actorUserId: clerk, actorRole: 'store' });
    });

    const inbox = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, buyerA));
    const received = inbox.find((n) => n.eventType === 'custody_received_buyer');

    expect(received).toBeDefined();
    expect(received!.body).not.toMatch(/Pay by \.$/);
    expect(received!.body).toMatch(/Pay by \S+/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'real dates'`
Expected: FAIL — body ends "Pay by ."

- [ ] **Step 3: Carry the dates into the templates**

Extend `holdingContext` in `src/services/custody.ts` to select `transactions.paymentDeadlineAt` and `custodyHoldings.custodyExpiresAt`, then pass them at both call sites:

```ts
    // markReceived
      data: {
        listingTitle: ctx.listingTitle,
        storeName: ctx.storeName,
        deadline: ctx.paymentDeadlineAt?.toLocaleString('en-TT') ?? 'your payment deadline',
      },
```

```ts
    // onPaymentConfirmed
    data: {
      listingTitle: ctx.listingTitle,
      storeName: ctx.storeName,
      expiresAt: ctx.custodyExpiresAt?.toLocaleString('en-TT') ?? 'the collection deadline',
    },
```

In `onPaymentConfirmed`, read the context **after** `recomputeShelfClock` so `custodyExpiresAt` reflects the extended clock, not the tight unpaid one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'real dates'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/custody.ts tests/flows/custody-loop.test.ts
git commit -m "fix(notifications): pass the dates the custody templates already read"
```

---

### Task 7: The `custody:overstay` handler

Scheduling already exists — `recomputeShelfClock` enqueues this transactionally with a `jobKey` and `runAt`. Jobs are currently being scheduled into a task that does not exist.

**Files:**
- Create: `src/jobs/tasks/custody-overstay.ts`
- Modify: `src/jobs/tasks/index.ts` (register in `taskList`)
- Modify: `src/services/custody.ts` (`holdingContext` gains `ownerContact`)
- Test: `tests/flows/custody-loop.test.ts`

**Interfaces:**
- Consumes: `custodyHoldings`, `notify`, event `custody_overstay_store`.
- Produces: `custodyOverstay(payload: { holdingId: string }, helpers: Helpers): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
  it('flags an overstayed item and no-ops when the clock has moved', async () => {
    const { custodyOverstay } = await import('../../src/jobs/tasks/custody-overstay');
    const { markReceived } = await import('../../src/services/custody');
    const helpers = { logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } } as never;

    const listingId = await makeRelayListing();
    await claimListing({ listingId, claimantId: buyerA, fulfillmentPath: 'relay', relayStoreId: storeId });
    const held = await db.select().from(custodyHoldings).where(eq(custodyHoldings.listingId, listingId));
    const holdingId = held[0]!.id;

    await db.transaction(async (tx) => {
      await markReceived({ tx, holdingId, actorUserId: clerk, actorRole: 'store' });
    });

    // Not yet expired — the handler must do nothing.
    await custodyOverstay({ holdingId }, helpers);
    let row = await db.select().from(custodyHoldings).where(eq(custodyHoldings.id, holdingId));
    expect(row[0]!.overstayFlaggedAt).toBeNull();

    // Force the clock into the past.
    await db
      .update(custodyHoldings)
      .set({ custodyExpiresAt: sql`now() - interval '1 hour'` })
      .where(eq(custodyHoldings.id, holdingId));

    await custodyOverstay({ holdingId }, helpers);
    row = await db.select().from(custodyHoldings).where(eq(custodyHoldings.id, holdingId));
    expect(row[0]!.overstayFlaggedAt).not.toBeNull();

    // Idempotent: a redelivery must not move the timestamp.
    const firstFlag = row[0]!.overstayFlaggedAt!.getTime();
    await custodyOverstay({ holdingId }, helpers);
    row = await db.select().from(custodyHoldings).where(eq(custodyHoldings.id, holdingId));
    expect(row[0]!.overstayFlaggedAt!.getTime()).toBe(firstFlag);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'overstayed'`
Expected: FAIL — cannot resolve `custody-overstay`

- [ ] **Step 3: Write the handler**

```ts
// src/jobs/tasks/custody-overstay.ts
/**
 * The shelf clock ran out.
 *
 * Flags the holding and prompts the store to evict, with the owner's contact. It does
 * NOT record a reputation event: reputation stays about deal-breaking, and a
 * paid-but-uncollected item has already settled on the money track.
 *
 * ★ IDEMPOTENT, and the guard is load-bearing rather than defensive: the clock can
 *   EXTEND under a job that is already queued, because confirming payment pushes the
 *   deadline out. A job scheduled against the tight unpaid clock will routinely fire
 *   on an item that is no longer overstayed.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db } from '../../db/client';
import { custodyHoldings } from '../../db/schema/custody';
import { notify } from '../../notifications/dispatch';
import { holdingNotificationContext } from '../../services/custody';

interface Payload {
  holdingId: string;
}

export async function custodyOverstay(payload: Payload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    // ★ One conditional UPDATE decides everything: still live, genuinely expired, and
    //   not already flagged. Zero rows back means there is nothing to do.
    const flagged = await tx
      .update(custodyHoldings)
      .set({ overstayFlaggedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(custodyHoldings.id, payload.holdingId),
          sql`${custodyHoldings.state} in ('at_relay', 'release_authorized')`,
          sql`${custodyHoldings.custodyExpiresAt} is not null`,
          sql`${custodyHoldings.custodyExpiresAt} < now()`,
          isNull(custodyHoldings.overstayFlaggedAt),
        ),
      )
      .returning({ id: custodyHoldings.id });

    if (flagged.length === 0) {
      helpers.logger.info(`holding ${payload.holdingId} is not overstayed — nothing to do`);
      return;
    }

    const ctx = await holdingNotificationContext(tx, payload.holdingId);
    if (ctx === null || ctx.storeStaffIds.length === 0) return;

    for (const staffId of ctx.storeStaffIds) {
      await notify({
        tx,
        userId: staffId,
        event: 'custody_overstay_store',
        data: {
          listingTitle: ctx.listingTitle,
          droppedOffAt: ctx.droppedOffAt?.toLocaleDateString('en-TT') ?? 'an unknown date',
          ownerContact: ctx.ownerContact,
        },
        linkUrl: ctx.storeId === null ? '/store' : `/store/${ctx.storeId}`,
        idempotencyKey: `custody_overstay:${payload.holdingId}`,
      });
    }
  });
}
```

- [ ] **Step 4: Export the notification context and register the task**

`holdingContext` in `src/services/custody.ts` is currently private. Export a thin public wrapper rather than widening the private one's callers:

```ts
export interface HoldingNotificationContext {
  listingTitle: string;
  storeName: string;
  storeId: string | null;
  droppedOffAt: Date | null;
  /** The seller's phone, falling back to their email — for the eviction prompt. */
  ownerContact: string;
  storeStaffIds: string[];
}

export async function holdingNotificationContext(
  tx: Tx,
  holdingId: string,
): Promise<HoldingNotificationContext | null> {
  // Join custody_holdings -> listings -> profiles (seller) for ownerContact,
  // and relay_store_staff for storeStaffIds. Fall back to the seller's auth email
  // via the `users` table when phone_e164 is null.
}
```

Implement that body following the existing `holdingContext` query style in the same file. Then register:

```ts
// src/jobs/tasks/index.ts
import { custodyOverstay } from './custody-overstay';
// …in taskList, under a new "// Phase 2" comment:
  'custody:overstay': custodyOverstay as Task,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'overstayed' && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/jobs/tasks src/services/custody.ts tests/flows/custody-loop.test.ts
git commit -m "feat(custody): implement and register the custody:overstay handler"
```

---

### Task 8: Board reads — owner contact and receive-by-code

**Files:**
- Modify: `src/services/custody.ts` (`StoreBoardRow.ownerContact`, new `findHoldingByCode`)
- Test: `tests/flows/custody-loop.test.ts`

**Interfaces:**
- Consumes: `storeBoard`, `custodyHoldings.dropoffCode`.
- Produces: `StoreBoardRow` gains `ownerContact: string` and `dropoffCode: string`; `findHoldingByCode(tx, storeId, code): Promise<{ holdingId: string; listingTitle: string } | null>`.

- [ ] **Step 1: Write the failing test**

```ts
  it('finds a holding by code, scoped to the store', async () => {
    const { findHoldingByCode } = await import('../../src/services/custody');

    const listingId = await makeRelayListing();
    await claimListing({ listingId, claimantId: buyerA, fulfillmentPath: 'relay', relayStoreId: storeId });
    const held = await db.select().from(custodyHoldings).where(eq(custodyHoldings.listingId, listingId));
    const code = held[0]!.dropoffCode;

    const found = await findHoldingByCode(db, storeId, code.toLowerCase());
    expect(found?.holdingId).toBe(held[0]!.id);

    // An unknown code is a refusal, not an error.
    expect(await findHoldingByCode(db, storeId, 'CT-ZZZZ')).toBeNull();

    // Another store cannot see it.
    const otherStore = await db
      .insert(relayStores)
      .values({ name: `Other ${SUFFIX}`, area: 'San Fernando', acceptsSizeClasses: ['small'] })
      .returning({ id: relayStores.id });
    expect(await findHoldingByCode(db, otherStore[0]!.id, code)).toBeNull();
    await db.delete(relayStores).where(eq(relayStores.id, otherStore[0]!.id));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'by code'`
Expected: FAIL — `findHoldingByCode` is not exported

- [ ] **Step 3: Implement the lookup**

```ts
// src/services/custody.ts — in the "store board reads" section
/**
 * The counter lookup. Scoped to THIS store and to items actually expected, so an
 * unknown code produces a refusal a clerk can act on rather than a row they should
 * never have seen.
 */
export async function findHoldingByCode(
  tx: DbOrTx,
  storeId: string,
  code: string,
): Promise<{ holdingId: string; listingTitle: string } | null> {
  const rows = await tx
    .select({ id: custodyHoldings.id, listingTitle: listings.title })
    .from(custodyHoldings)
    .innerJoin(listings, eq(listings.id, custodyHoldings.listingId))
    .where(
      and(
        eq(custodyHoldings.storeId, storeId),
        eq(custodyHoldings.state, 'awaiting_dropoff'),
        sql`upper(${custodyHoldings.dropoffCode}) = upper(${code.trim()})`,
      ),
    )
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : { holdingId: row.id, listingTitle: row.listingTitle };
}
```

- [ ] **Step 4: Add `ownerContact` and `dropoffCode` to the board**

Extend the `StoreBoardRow` interface and the existing `storeBoard` query — it already joins `profiles` for `sellerName`, so add `profiles.phoneE164` to the select and a `users.email` fallback, then map:

```ts
    dropoffCode: r.h.dropoffCode,
    ownerContact: r.sellerPhone ?? r.sellerEmail ?? 'no contact on file',
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/flows/custody-loop.test.ts -t 'by code' && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/custody.ts tests/flows/custody-loop.test.ts
git commit -m "feat(custody): board carries owner contact and codes; add counter lookup"
```

---

### Task 9: The store surface

**Files:**
- Create: `src/lib/store-session.ts`
- Create: `src/app/store/page.tsx`
- Create: `src/app/store/[storeId]/page.tsx`
- Create: `src/app/store/[storeId]/actions.ts`
- Modify: `scripts/seed-dev.ts`

**Interfaces:**
- Consumes: `storesForStaff`, `storeBoard`, `findHoldingByCode`, `markReceived`, `authorizeRelease`, `markPickedUp`, `returnToSeller`.
- Produces: `requireStoreStaff(storeId): Promise<{ user: CurrentUser; store: { id: string; name: string }; role: string }>`.

- [ ] **Step 1: Write `store-session.ts`**

```ts
// src/lib/store-session.ts
/**
 * Store staff are members who appear in `relay_store_staff` — no separate credential.
 *
 * ★ THIS IS NOT THE SECURITY BOUNDARY. `assertStoreAuthority` in services/custody.ts
 *   re-checks membership against each holding's OWN store on every write. This decides
 *   what a clerk can SEE; a bug in a page cannot release someone else's item.
 */

import { db } from '../db/client';
import { storesForStaff } from '../services/custody';
import { requireUser, type CurrentUser } from './session';

export class NotStoreStaffError extends Error {}

export interface StoreSession {
  user: CurrentUser;
  store: { id: string; name: string };
  role: string;
}

export async function staffStores(): Promise<{
  user: CurrentUser;
  stores: Array<{ id: string; name: string; role: string }>;
}> {
  const user = await requireUser();
  return { user, stores: await storesForStaff(db, user.userId) };
}

export async function requireStoreStaff(storeId: string): Promise<StoreSession> {
  const { user, stores } = await staffStores();
  const match = stores.find((s) => s.id === storeId);
  if (match === undefined) throw new NotStoreStaffError('You do not work at this store');
  return { user, store: { id: match.id, name: match.name }, role: match.role };
}
```

- [ ] **Step 2: Write the entry page**

`src/app/store/page.tsx` — a server component: call `staffStores()`; zero stores renders "You're not registered as store staff." with no further detail; one store `redirect(`/store/${stores[0].id}`)`; two or more render a list of links.

- [ ] **Step 3: Write the four server actions**

```ts
// src/app/store/[storeId]/actions.ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { requireStoreStaff } from '@/lib/store-session';
import {
  findHoldingByCode,
  markReceived,
  authorizeRelease,
  markPickedUp,
  returnToSeller,
} from '@/services/custody';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

/** The counter's primary interaction: a code in, an item on the shelf or a refusal. */
export async function receiveByCodeAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const code = String(formData.get('code') ?? '');
  const session = await requireStoreStaff(storeId);

  const found = await findHoldingByCode(db, storeId, code);
  if (found === null) {
    redirect(
      `/store/${storeId}?refuse=${encodeURIComponent(
        'No expected drop-off with that code. Do not accept this item.',
      )}`,
    );
  }

  try {
    await db.transaction(async (tx) => {
      await markReceived({
        tx,
        holdingId: found.holdingId,
        actorUserId: session.user.userId,
        actorRole: 'store',
      });
    });
  } catch (error) {
    redirect(`/store/${storeId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/store/${storeId}`);
  redirect(`/store/${storeId}?ok=${encodeURIComponent(`Received "${found.listingTitle}"`)}`);
}
```

Write `authorizeReleaseAction`, `markPickedUpAction` and `returnToSellerAction` in the same shape: read `storeId` and `holdingId` from the form, `requireStoreStaff(storeId)`, wrap the service call in `db.transaction`, redirect with `?error=` on throw and `?ok=` on success. `returnToSellerAction` also reads an optional `reason` field.

- [ ] **Step 4: Write the board**

`src/app/store/[storeId]/page.tsx` — server component:

```tsx
const session = await requireStoreStaff(storeId);
const rows = await storeBoard(db, storeId);

const expected = rows.filter((r) => r.state === 'awaiting_dropoff');
const onShelf = rows.filter((r) => r.state === 'at_relay');
const ready = rows.filter((r) => r.state === 'release_authorized');
const settled = rows.filter((r) =>
  ['picked_up', 'returned_to_seller', 'voided'].includes(r.state),
);
```

Render, in order:

1. The receive-by-code form (`receiveByCodeAction`), plus the `?refuse=` banner styled as an error — it is the clerk's script for turning someone away.
2. **On the shelf** — overstayed rows first (`overstayFlaggedAt !== null`), each showing days held, paid/unpaid, and the eviction prompt with `ownerContact`. Paid rows get an "Authorize release" button; every row gets "Return to seller".
3. **Ready for collection** — "Mark picked up" plus the code the buyer must show.
4. **Expected arrivals** — seller, item, size class, code.
5. **Recently settled** — read-only audit rows.

Both release buttons stay separate, per spec §4.5. Add a one-line note under the shelf section: *"Authorize release only after payment shows confirmed — the system will refuse otherwise."*

- [ ] **Step 5: Seed a store so this is reachable locally**

In `scripts/seed-dev.ts`, insert one `relay_stores` row (`acceptsSizeClasses: ['small']`), add the first seeded member to `relay_store_staff` as `manager`, add `listing_relay_stores` rows for the seeded listings, and log the sign-in email plus `http://localhost:3000/store`.

- [ ] **Step 6: Verify by hand**

Run: `npm run seed:dev`, then `npm run dev`, sign in as the seeded staff member, open `/store`.
Confirm: the board renders; an unknown code shows the refusal sentence; a real code moves the item to the shelf.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/store-session.ts src/app/store scripts/seed-dev.ts
git commit -m "feat(store): the audit/control board with receive-by-code and the four counter actions"
```

---

### Task 10: The member-facing custody panel

**Files:**
- Modify: `src/app/deals/[id]/page.tsx`
- Modify: `src/services/custody.ts` (add `custodyPanelFor`)

**Interfaces:**
- Consumes: `custodyHoldings`, `relayStores`.
- Produces: `custodyPanelFor(tx, transactionId): Promise<CustodyPanel | null>` with `{ state, dropoffCode, storeName, storeAddress, storeArea, custodyExpiresAt }`.

- [ ] **Step 1: Add the read**

```ts
// src/services/custody.ts
export interface CustodyPanel {
  state: CustodyState;
  dropoffCode: string;
  storeName: string | null;
  storeArea: string | null;
  storeAddress: string | null;
  custodyExpiresAt: Date | null;
}

/** Everything the deal page needs to tell a member where their item is. */
export async function custodyPanelFor(
  tx: DbOrTx,
  transactionId: string,
): Promise<CustodyPanel | null> {
  const rows = await tx
    .select({
      state: custodyHoldings.state,
      dropoffCode: custodyHoldings.dropoffCode,
      custodyExpiresAt: custodyHoldings.custodyExpiresAt,
      storeName: relayStores.name,
      storeArea: relayStores.area,
      storeAddress: relayStores.address,
    })
    .from(custodyHoldings)
    .leftJoin(relayStores, eq(relayStores.id, custodyHoldings.storeId))
    .where(eq(custodyHoldings.currentTransactionId, transactionId))
    .limit(1);

  return rows[0] ?? null;
}
```

- [ ] **Step 2: Replace the placeholder row**

In `src/app/deals/[id]/page.tsx`, delete the `— the store flow lands in Phase 2` span and render a panel below the progress table when `usesCustodyTrack(t.fulfillmentPath)` and the panel is non-null:

- **Seller**, `awaiting_dropoff`: store name, area, address; the code in a `<strong>`; "Drop it off by {sellerDropoffDeadlineAt}". Copy: *"Show this code at the counter."*
- **Buyer**, `awaiting_dropoff`: "Waiting for the seller to drop it off at {storeName}."
- **Buyer**, `at_relay`: the code, the store, and — if payment is confirmed — "Collect by {custodyExpiresAt}"; if not, *"Confirm your payment and the store will release it."*
- **Buyer**, `release_authorized`: "Cleared for collection at {storeName}. Show code {code}."
- **Either**, `returned_to_seller`: "This item went back to the seller."
- **Either**, `voided`: "This item was never dropped off."

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`, claim a relay listing as a buyer, open the deal as each side.
Confirm: the seller sees the address and code; the buyer sees the waiting state.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "src/app/deals/[id]/page.tsx" src/services/custody.ts
git commit -m "feat(custody): per-role custody panel on the deal page"
```

---

### Task 11: The full loop, the release gate, and `verify:phase2`

**Files:**
- Modify: `tests/flows/custody-loop.test.ts` (happy path, gate, return-to-seller)
- Modify: `tests/db/constraints.test.ts` (two custody CHECKs)
- Create: `scripts/verify-phase2.ts`
- Modify: `package.json`, `README.md`

- [ ] **Step 1: Write the remaining flow tests**

```ts
  it('runs the full loop: drop-off -> pay -> release -> collect -> complete', async () => {
    const { markReceived, authorizeRelease, markPickedUp } = await import('../../src/services/custody');
    const { markPaid, confirmPayment } = await import('../../src/services/transactions');

    const listingId = await makeRelayListing();
    const claim = await claimListing({
      listingId, claimantId: buyerA, fulfillmentPath: 'relay', relayStoreId: storeId,
    });
    const txId = claim.transactionId!;
    const held = await db.select().from(custodyHoldings).where(eq(custodyHoldings.listingId, listingId));
    const holdingId = held[0]!.id;

    await db.transaction(async (tx) => {
      await markReceived({ tx, holdingId, actorUserId: clerk, actorRole: 'store' });
    });

    // ★ THE GATE: unpaid items do not move.
    await expect(
      db.transaction(async (tx) => {
        await authorizeRelease({ tx, holdingId, actorUserId: clerk, actorRole: 'store' });
      }),
    ).rejects.toThrow();

    await db.transaction(async (tx) => {
      await markPaid({ tx, transactionId: txId, actorUserId: buyerA });
      await confirmPayment({ tx, transactionId: txId, actorUserId: seller });
    });

    await db.transaction(async (tx) => {
      await authorizeRelease({ tx, holdingId, actorUserId: clerk, actorRole: 'store' });
    });
    await db.transaction(async (tx) => {
      await markPickedUp({ tx, holdingId, actorUserId: clerk, actorRole: 'store' });
    });

    const finished = await db.select().from(transactions).where(eq(transactions.id, txId));
    expect(finished[0]!.state).toBe('completed');
    expect(finished[0]!.custodyState).toBe('picked_up');
  });
```

Check `markPaid` / `confirmPayment`'s real signatures in `src/services/transactions.ts` before writing this — match them exactly rather than assuming the shape above.

Add a second test: after `markReceived`, expire the payment window, run `paymentWindowExpired`, and assert the holding reaches `returned_to_seller` with no candidates left.

- [ ] **Step 2: Add the constraint tests**

In `tests/db/constraints.test.ts`, following the existing adversarial style, assert that a raw insert violates `custody_store_required` (holder `relay_store`, `store_id` null) and `custody_courier_has_no_store` (holder `platform_courier` with a `store_id`).

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Write `scripts/verify-phase2.ts`**

Copy the structure of `scripts/verify-phase1.ts` — same `mkUser`, `waitFor`, `scheduleNow` helpers and the same cleanup discipline. Steps:

1. Create a store, staff member, seller and buyer; create a relay listing nominating that store.
2. Claim it with `relayStoreId`; assert a holding exists with a `CT-` code.
3. `markReceived`; assert the shelf clock is set and a `custody:overstay` job exists in `graphile_worker.jobs` with a future `run_at`.
4. Push `custody_expires_at` into the past, `scheduleNow('custody:overstay', { holdingId }, ...)`, and `waitFor` the **worker** to set `overstay_flagged_at`. **This is the point of the script** — it proves enqueue → worker → handler closes for custody, which unit tests cannot.
5. Assert a `custody_overstay_store` notification landed for the staff member.
6. Print `PASS — Phase 2 custody rail verified against the live worker.`

- [ ] **Step 5: Wire the script up and run it**

```json
"verify:phase2": "tsx scripts/verify-phase2.ts",
```

Run (all three processes up): `npm run verify:phase2`
Expected: PASS

- [ ] **Step 6: Update the README**

- Status line: Phase 2 complete; custody live.
- Move the Phase 2 bullets from "next" to "done"; promote the Phase 3 bullets to "next".
- Add `npm run verify:phase2` to "Verifying it works" and update the test count.
- Add a "Relay custody" paragraph to the architecture section: the drop-off code, the two-tap release, and the fact that the release gate is SQL.
- **Do not** add the "relay listings need a nominated store" rule to the invariants table — it is a service-level Zod rule, not a DB constraint (spec §3.1).

- [ ] **Step 7: Final full verification**

Run: `npm test && npm run typecheck && npm run verify && npm run verify:phase1 && npm run verify:phase2`
Expected: all PASS. Report the actual output; do not claim completion without it.

- [ ] **Step 8: Commit**

```bash
git add tests scripts package.json README.md
git commit -m "test(custody): full loop, release gate, constraints, and verify:phase2"
```

---

## Self-Review

**Spec coverage.** §3.1 join table → Task 1 + 3. §3.2 drop-off code → Task 1 + 2. §3.3 bid columns → Task 1 + 5. §4.1 auth → Task 9. §4.2 routes → Task 9. §4.3 board + `ownerContact` → Task 8 + 9. §4.4 receive-by-code → Task 8 + 9. §4.5 two-action release → Task 9. §4.6 seeding → Task 9. §5.1 claim picker → Task 4. §5.2 deal panel → Task 10. §6.1 bid defect → Task 5. §6.2 notification defect → Task 6. §7 overstay handler → Task 7. §8 testing → Tasks 2–11. §10 definition of done → Task 11 step 7. No gaps.

**Known soft spots**, flagged rather than hidden:

- **Task 2, step 3** — whether the insert retry needs a savepoint depends on Drizzle's transaction behaviour. The step says to find out by running the test rather than guessing.
- **Task 7, step 4** — `holdingNotificationContext`'s body is described, not written, because it must follow the existing private `holdingContext` query in the same file. This is the one place the plan hands over a shape instead of code; the surrounding pattern is three lines away in the file being edited.
- **Task 11, step 1** — `markPaid` / `confirmPayment` signatures must be read from the source, not assumed.

**Type consistency.** `generateDropoffCode` (Task 1) is used in Task 2. `candidateStoresFor` (Task 3) is used in Tasks 4 and 5. `findHoldingByCode` (Task 8) is used in Task 9. `holdingNotificationContext` (Task 7) is used only by the overstay handler. `requireStoreStaff` (Task 9) is used by the board and all four actions. `custodyPanelFor` (Task 10) is used only by the deal page. Names match across tasks.
