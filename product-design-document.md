# Product Design Document
## Peer-to-Peer Trading Cards, Comics & Collectibles Trust & Coordination Platform (Trinidad & Tobago)

**Status:** Planning / pre-implementation
**Scale target:** ~2,000 members, ≤50 concurrent active users
**Prepared:** August 2026
**Prices verified:** August 2026 (Render, MongoDB, WhatsApp Cloud API, Cloudflare R2). Re-check before committing budget — cloud pricing shifts.

---

## 1. Product Vision

Today, trading happens in a Facebook group: members post items for **straight sale** (first to "claim" in the comments wins) or **auction** (starting bid + buyout, highest bid by the deadline wins). It works socially but breaks down logistically — deals scatter across comments and vanish, newcomers can't establish trust, there's no rating system, and payment behaviour ranges from instant transfer to "cash on meetup, eventually."

This product is **not a marketplace.** It is a **trust and coordination layer over peer-to-peer deals that still settle however the two parties agree.** The software makes the *mechanics* fair, makes *accountability* durable, and lowers *trust friction* for newcomers — without ever moving money.

### Scope: multiple collectible categories, not one game

The platform is **not specific to any single game or format.** It covers **trading card games** (Pokémon, Magic, Yu-Gi-Oh, sports cards, and others), **comics**, and **general collectibles**. Trust, custody, reputation, the relay flow, and the two-track lifecycle are all category-agnostic — they work identically whether the item is a graded card, a key-issue comic, or a sealed collectible. The only place category matters is **how an item describes itself** (see §3, item model, and §4), which the schema handles cleanly via a `category` field plus a JSONB attributes column. The grading concierge (§7) generalizes naturally, since CGC grades comics and cards and the major grading houses cover this whole world.

### Load-bearing principle: never touch the money

The moment the platform holds funds, it inherits escrow logic, chargeback handling, refund flows, KYC pressure, and money-transmitter obligations — the exact regulatory and settlement problems that make card processors unusable locally. Staying out of the money keeps **cash-on-meetup a first-class option**, preserves the community feel, and keeps the build small. The platform collects **only its own service fees** for logistics it actually performed. It is a courier and a storage relay, not an escrow agent holding buyer funds.

### The one object that fixes everything: a Transaction with a lifecycle

In the Facebook group, a "deal" is scattered across comments and disappears. Making it a real entity with states causes payment tracking and reputation to fall out for free:

```
Listing resolves (claimed or auction won)
        │
        ▼
   Transaction created  ──► payment window starts
        │
        ├─ pending
        ├─ buyer_marked_paid      (buyer asserts payment / meetup arranged)
        ├─ seller_confirmed       (seller confirms receipt / meetup done)
        ├─ completed              (unlocks mutual blind rating)
        ├─ reneged                (payment window lapsed → reputation hit)
        └─ expired
```

The **mark-paid / confirm-received handshake** is the core trick: it turns fuzzy "did they pay?" into tracked status, creates the reputation event, and never requires touching a cent.

---

## 2. Guiding Design Principles

1. **Never hold money.** Collect only your own service fees for logistics rendered.
2. **Right-size for the scale.** 2,000 members / 50 concurrent is *tiny*. The engineering goal is the fewest moving parts that are reliable — every extra vendor is another thing to secure, monitor, pay for, and debug for zero benefit at this load.
3. **Postgres is the centre of gravity.** Database, job queue, and real-time backplane in one system. No Redis, no serverless, no payment processor.
4. **Objective facts ≠ subjective opinion.** Whether someone paid, and paid on time, are tracked as hard counters — separate from star ratings.
5. **Physical custody as the trust anchor.** The relay store solves bilateral trust using a shelf and a release-authorization step, achieving an escrow guarantee without touching funds.
6. **Server-authoritative everything.** Every deadline, claim order, and bid resolves on server time. Never trust client clocks.
7. **WhatsApp is an enhancement, not a dependency.** Ship on channels with no gatekeeper (in-app + email); add WhatsApp once Meta Business verification clears.

---

## 3. Technology Stack

Chosen on merits for reliability, speed, and low cost at this scale — not on prior familiarity.

| Layer | Choice | Why this, at this scale |
|---|---|---|
| **Language** | TypeScript, end-to-end | Web + worker in one repo share the domain types. The Transaction state machine is defined once and imported by both — an illegal transition becomes a compile error, not a production incident. |
| **Web framework** | **Next.js** (App Router), server-rendered monolith | Maximal-ecosystem default; server actions/route handlers cover the mutation-heavy domain (claim, bid, confirm, release). SSR gives the "live room" feel without a heavy SPA. |
| **Process model** | Persistent **web process + worker process** | Rules out serverless. Three needs fight serverless: a continuous worker loop (auction soft-close needs second-level accuracy, below cron's 1-min floor), held-open SSE connections, and stable pooled Postgres connections. All want long-running servers. |
| **Database** | **Render Postgres** | Relational data (transactions ↔ listings ↔ users ↔ custody ↔ reputation) with ACID for the trust-critical multi-step paths. Co-located with app = one vendor, one bill. Portable/open-source (no lock-in). **No Atlas-style scaling cliff.** |
| **ORM / query** | **Drizzle** (SQL-close, lightweight) | Hot atomic paths (claim, bid) hand-written as `UPDATE … WHERE status='active' RETURNING …` so contention resolves in one round-trip. |
| **Validation** | **Zod** | Runtime input validation at every boundary. |
| **Job queue** | **Graphile Worker** (Postgres-backed, `SKIP LOCKED` + `LISTEN/NOTIFY`) | Every "do this later" is a delayed job: payment window expiry → reneged + promote backup; custody clock → overstay flag; notification dispatch. **Killer feature:** enqueue the job in the *same transaction* that changes state — impossible to get "marked reneged but forgot to notify." No Redis. |
| **Real-time** | **Server-Sent Events (SSE)** | Bids are discrete HTTP POSTs; the only push-out is "new bid / countdown extended / outbid" — one-directional, exactly SSE's job, over plain HTTP. No WebSockets, no Pusher/Ably. `LISTEN/NOTIFY` is the fan-out backplane if you ever run multiple web instances. Start with 2–3s polling; SSE is the upgrade. |
| **Auth** | **Better Auth** (self-hosted, owns data in your Postgres) | Phone-verified identity, OTP support, **no per-MAU fees or lock-in** (vs Clerk/Auth0). OTP over WhatsApp when live, **email magic-link as the free fallback** so onboarding isn't hostage to Meta. *(Newish library — sanity-check maturity; the principle "self-hosted, own-your-data" is the durable call.)* |
| **Image storage** | **Cloudflare R2 + CDN** | **Zero egress fees** — the biggest cost lever for a gallery-heavy app serving high-fidelity WebP all day (detail-heavy items — foil cards, comic covers, collectibles). Pre-generate 2–3 responsive sizes + one large zoom variant on upload (via `sharp` in the worker). |
| **Email** | **Resend** | Transactional email (OTP fallback, notifications). Lovely DX, cheap, free tier covers this scale. |
| **Notifications** | Channel-agnostic dispatcher | One dispatch job, pluggable adapters: **in-app** (notifications table + SSE) and **email** ship first (no gatekeeper); **WhatsApp** slots in as a third adapter — a config change, not a rewrite. |
| **Store interface** | **WhatsApp bot** (once verified) | Store staff need only three actions: mark received, mark released, mark picked up. A WhatsApp bot meets a busy shop clerk where they already are, far better adoption than a new dashboard login. Lightweight authenticated web view as fallback. |
| **Hosting** | **Render** (web + worker + Postgres co-located) | Flat, predictable pricing; git deploy; everything on one platform. |
| **Monitoring** | **Sentry** (free tier) + automated Postgres backups + periodic `pg_dump` to R2 | Reputation data is the one thing you genuinely cannot lose — belt and suspenders. |
| **Payments** | **None — by design** | No processor, no PCI scope, no money-transmitter exposure. Payment for the item always flows buyer↔seller directly. |

### Why NOT the reflexive choices

- **No Redis** — Postgres is the queue and the real-time backplane. Redis adds a vendor and a consistency seam for zero benefit at 50 concurrent.
- **No serverless / Vercel** — the worker loop, SSE, and pooled DB connections all want persistent processes.
- **No realtime vendor** (Pusher/Ably/Supabase Realtime) — SSE over your own web process handles 50 concurrent trivially.
- **No per-MAU auth vendor** — self-hosting owns the data and avoids a recurring tax on 2,000 users.
- **No payment processor** — you never touch money.

### The honest alternative on record

If optimizing purely for real-time-bidding performance-per-dollar, **Elixir/Phoenix (LiveView + Channels)** is technically the best fit that exists — it would handle 2,000 live connections on a potato. It is **not** recommended here because for a small team the TS monolith is the more reliable *delivery* choice (bigger ecosystem, faster shipping), and reliability of shipping outweighs architectural purity at this scale. Phoenix wins the benchmark; TypeScript wins the calendar.

---

## 4. Core Technical Mechanisms

**Multi-category item model.** A listing carries a `category` (trading card / comic / collectible, extensible) plus a **JSONB `attributes` column** holding category-specific fields — cards: set/rarity/condition/grade; comics: title/issue/publisher/grade; collectibles: freeform. Each category *declares* the attributes it expects (a small config, not a table), so the schema absorbs new categories without new tables. Foreign keys and integrity stay strict everywhere that matters (transactions, custody, reputation); schemaless flexibility lives only where item descriptions genuinely vary. Browsing and search must be **filterable by category and by category-specific attributes** — this can be a fast-follow, but the data model supports it from day one.

**Atomic claims (straight sale).** First-to-claim becomes a single conditional update — `UPDATE listings SET status='claimed', winner=$user WHERE id=$id AND status='active' RETURNING *`. Server receipt order resolves it deterministically; "I said mine first" disputes disappear.

**Backup-claim queue.** A fixed-price claim is a *stack*, not a single winner (cap depth 3–4). When the top claimer's window lapses (`reneged`), the transaction auto-promotes the next person and notifies them ("you're up, X hours to pay"). The ghoster eats the reliability hit; the seller does nothing.

**Auctions with anti-snipe (soft close).** Same conditional pattern (`currentBid < newBid AND endsAt > now`). A bid inside the final window (e.g. 2 min) pushes `endsAt` out by that window, extending until bidding goes quiet. Server-authoritative clock. Communicate up front that "closes 8:00" now means "closes 8:00 unless bids keep landing" — a soft close, not a bug.

**Two parallel tracks: payment + custody.** A deal completes only when both finish.
- **Payment track:** `pending → deposit_sent → confirmed`
- **Custody track:** `awaiting_dropoff → at_relay → released → picked_up`

The relay store gates custody release on payment confirmation. Seller drops the item *before* the buyer pays; store won't release until payment confirms. Buyer's risk (pay, get nothing) and seller's risk (hand over, not get paid) are both covered — **escrow-grade bilateral trust from a shelf and a release step, without touching money.**

**Fulfillment paths (per-listing field, buyer chooses at claim/checkout):**
1. **Cash on meetup** — platform uninvolved (the community's heartbeat).
2. **Remote payment + seller ships** — P2P, platform uninvolved.
3. **Relay drop-off** — store as physical escrow (your rail).
4. **Full-service pickup & delivery** — your team, end-to-end (your rail).

**Reputation split (objective vs subjective).**
- *Objective facts:* hard counters — "2 unpaid claims in 90 days," "100% paid on time." Trigger automatic restrictions (e.g. low-rep buyers must prepay or do meetup-only).
- *Subjective:* only completed-transaction counterparties can rate, with **blind reveal** — neither side sees the other's rating until both submit or the window closes. Kills retaliation without moderation.

**Cold-start trust for newcomers.** Reputation can't help zero-history users, so lean on **identity + visibility**: phone verification + "member since / X completed deals / 100% paid on time." Sellers can set "prepay required for buyers under N reputation" — a lower-risk on-ramp, not a closed door.

**Vouching (with skin in the game).** A vouch carries accountability: vouch for someone who reneges and it dings a separate **vouch-quality score** (not your transaction reputation) that governs how much future vouches are worth. Cap active vouches (~3). The friction is the point.

**Transactional job integrity.** State change + its side-effect job are enqueued in one DB transaction (Graphile Worker), so the system can never half-complete a reneged-and-promote or a release-and-complete.

**Idempotency.** WhatsApp webhooks (Meta retries) and all job handlers are idempotent.

---

## 5. Relay Stores: The Store-Side Strategy

The stores currently host relay **for free** because it drives **foot traffic** — that's their real incentive, not fee revenue. Leading with "let's add a fee" solves a problem they don't have and threatens the thing they value. Their actual pain is **abuse**: bulky items, indefinite storage, no idea what's paid or whose stuff it is.

**So the audit/control tool is the product — give it away free.** Per store, the log shows: every item held, whose it is, paid/unpaid status, days-in-store, and one-tap release / picked-up. The fee capability lives quietly inside the same tool, switchable on later.

**Kill the abuse structurally:**
- **Time-bounded custody by default.** Every item gets a holding clock on drop-off. Paid items: buyer has X days before nudges. Unpaid: tighter (pure liability). After grace, item flags "overstayed" and the store gets an eviction prompt with the owner's contact.
- **Size/eligibility gate.** Relay is for cards, comics, and small sealed/boxed collectibles. Stores set what they accept; ineligible bulk routes to the delivery team or is refused. **If it's not in the log, it doesn't belong there** — that's the answer to meetup-leakage (someone picking "meetup" then dumping the item at a store): no log entry = illegitimate drop, and the store now has tooling to refuse it.
- **Unpaid-item return path.** After the payment window lapses, an unpaid item is the *seller's* to reclaim; store is notified; "return to seller" action in the log. Never let an unpaid item become the store's problem.

**Fee model — optional, per-store, structured to amplify foot traffic (never mandatory):**
- **Free-if-fast, fee-if-it-lingers** — first 48–72h free (buyer still walks in → footfall preserved), fee only on overstay. Turns the fee into a storage-discipline mechanism aimed at the abuse case.
- **Store credit instead of cash** — relay fee redeemable in-store; the buyer arrives to collect with a small credit burning a hole and spends it. Best structure for footfall-motivated stores.
- **Fee only on unpaid/reneged items** — the ones creating dead storage with no sale to justify them.

Stores keep most/all of the *holding* fee (their shelf, their pain). **Your revenue is the delivery/pickup rail**, where you actually do the work — don't fight the stores for the shelf fee.

---

## 6. Features List

### MVP (must-ship)
- Phone-verified accounts; profile with "member since / completed deals / paid-on-time %"
- Create listing: pick **category** (trading card / comic / collectible) → category-specific attribute fields (JSONB); straight-sale or auction; required fields for **accepted settlement methods** and **fulfillment path**, shown before anyone claims/bids
- Straight-sale claim (atomic) + **backup-claim queue**
- Auction: starting bid, buyout, deadline, **anti-snipe soft close**, live bid feed (polling → SSE)
- Transaction lifecycle + **mark-paid / confirm-received handshake**
- **Payment window** with auto-`reneged` + backup promotion
- Objective reputation counters + automatic low-rep restrictions (prepay/meetup-only)
- **Blind mutual ratings** on completed deals
- Relay custody track + **store audit/control log** (release / picked-up / overstay)
- Time-bounded custody + size/eligibility gate + unpaid-item return path
- Channel-agnostic notifications: **in-app + email** (Resend)
- Image upload → R2 with responsive sizes; standard gallery (no deep zoom)

### Fast-follow
- **Vouching** with vouch-quality scoring
- **WhatsApp** notification adapter + **store WhatsApp bot** (post Meta verification)
- **Full-service pickup & delivery** flow (your paid rail) with per-zone pricing
- WhatsApp OTP (replacing/augmenting email magic-link)
- **Browse/search filterable by category and category-specific attributes**
- Listing analytics for sellers

### Later
- **Power-seller subscription** (more active listings, verified badge, analytics, bulk-listing, reduced promotion fees)
- **Native promoted listings** (bump/highlight)
- **Grading concierge** (batch card *and comic* submission to PSA/CGC via relay stores, handling margin)
- **Local hobby-shop sponsorships** (card / comic / collectible shops)
- True tiled deep-zoom (OpenSeadragon/IIIF) for crystal-level detail
- Store-credit ledger (if stores adopt credit-based fees)

---

## 7. Monetization Model

Ranked by fit for a 2,000-member niche community. **Charge only where you rendered a service.**

1. **Full-service pickup & delivery (anchor rail).** Flat per-zone delivery fee + optional value-tiered handling rate for high-value items. Collected by your team as a service charge (cash on delivery or transfer). You are a courier, not an escrow agent — the *payment for the item* always flows buyer↔seller separately.
2. **Power-seller subscription (best recurring revenue).** Your heavy sellers pay monthly for more concurrent listings, verified badge, analytics, bulk tools, reduced promotion fees. Predictable in a way per-transaction fees never are at this scale. You already know who these people are.
3. **Grading concierge (highest-margin, most on-brand).** Batch-collect cards *and comics* through relay stores, submit to the major grading houses (PSA/CGC — CGC grades both cards and comics) in bulk, charge a handling margin on the grading fee. A service people *want*, not a tax — uses infrastructure you're already building, and it now spans every category on the platform.
4. **Native promoted listings.** Seller pays to bump/highlight. "Ads done right" — your own inventory, zero trust cost.
5. **Local hobby-shop sponsorships** (card shops, comic shops, collectible dealers). One engaged, hyper-targeted local shop paying for storefront/"sponsored by" presence is worth more than millions of programmatic impressions.
6. **Relay holding fees** — optional, per-store, mostly kept by the stores (see §5). Not a platform revenue centre.

### Explicitly avoided
- **Scattered Google/AdSense ads.** At this scale, revenue is cents-to-low-single-digit-dollars/month — real effort for nothing — while signalling the *opposite* of trust in a trust product, risking ads for competing marketplaces or scam sites, and adding page weight and consent overhead. Native promotion + local sponsorship deliver the same money better, kept inside your ecosystem. **One local shop sponsor beats a million AdSense impressions here.**
- **Buyer-protection / insurance fees.** Edges into regulated financial-product territory; physical escrow already covers most of the need.
- **Per-transaction fees on pure P2P cash meetups.** Unenforceable without holding money and would poison the community feel that is your entire moat.

---

## 8. Operating Cost Estimates

All USD/month. Rates verified Aug 2026 — re-check before budgeting.

### MVP (pre-WhatsApp)

| Item | Service | Tier | Cost/mo |
|---|---|---|---|
| Web app | Render web service | Starter (512MB / 0.5 CPU, always-on) | $7 |
| Background worker | Render worker | Starter (512MB / 0.5 CPU) | $7 |
| Database | Render Postgres | Basic dedicated | ~$7 |
| Workspace | Render Hobby | free (5 GB bandwidth) | $0 |
| Image storage + CDN | Cloudflare R2 | within free tier (10 GB, 1M writes, 10M reads) | ~$0 |
| DNS / CDN | Cloudflare | free | $0 |
| Email | Resend | free tier | $0 |
| Error monitoring | Sentry | free tier | $0 |
| Domain | registrar | ~$12/yr amortized | ~$1 |
| **Subtotal (MVP)** | | | **≈ $22–29/mo** |

### With WhatsApp live (fast-follow)

WhatsApp Cloud API (direct, no BSP → no platform fee) bills **per message**, by the **recipient's** country (Trinidad & Tobago), by category. Utility/authentication run ~80–90% cheaper than marketing; service/utility replies inside the 24-hour window are currently free **but become billable from 1 Oct 2026.** At your volume (roughly a few hundred to ~1–2k utility notifications/mo):

| Scenario | Est. WhatsApp cost/mo |
|---|---|
| Low volume (~few hundred utility msgs) | ~$5–15 |
| Moderate (~1–2k utility + some OTP) | ~$15–40 |

**Add ~$15–40/mo** → **total ≈ $40–70/mo** with WhatsApp active.

### Headroom (if you ever need it)
Render Pro workspace ($25, 25 GB bandwidth) + Standard web ($25) + Standard worker: even a comfortable ceiling lands **~$100–150/mo**. Crucially, **no scaling cliff** — nothing here has an Atlas-style "$30 cap then jump to $57" trap. It scales smoothly and stays cheap well past your 50-concurrent ceiling.

---

## 9. Revenue vs. Operating Expenses

The reassuring headline: **infrastructure opex is trivially small (~$25–70/mo).** The real question isn't "can revenue cover opex" — it can, easily — it's "can revenue justify *your time.*"

**How little it takes to break even on infrastructure:**
- **One** power-seller subscription (~US$10–15/mo) covers roughly half of opex on its own.
- **A handful of deliveries per week** at a modest per-delivery service fee covers opex entirely.
- **One grading-concierge batch per month** can exceed a month's opex in margin alone.

Any *one* of your four real revenue streams (delivery rail, subscription, grading, sponsorship) covers full infrastructure cost at low activity. Stacked, they leave comfortable margin for your time. This validates the "never touch money" architecture: by removing the payment processor, PCI scope, and money-transmitter exposure, you also removed the largest cost *and* risk class — which is exactly why break-even is so easy to reach.

---

## 10. Development Plan (Phased)

**Phase 0 — Foundations (data + skeleton)**
Postgres schema for Users, Listings (with `category` + JSONB `attributes`), Bids, Transactions, Custody, RelayStores, ReputationEvents, Vouches, Notifications, Subscriptions — plus the per-category attribute-declaration config. Next.js + Drizzle + Zod scaffold. Better Auth with **email magic-link** (no Meta dependency). Graphile Worker wired. Image upload → R2 pipeline. *Deliverable: accounts, profiles, multi-category listing CRUD.*

**Phase 1 — Core trading loop (MVP heart)**
Straight-sale atomic claim + backup queue. Auctions + anti-snipe soft close. Transaction lifecycle + mark-paid/confirm handshake. Payment window → reneged → promote. Objective reputation counters + restrictions. Blind mutual ratings. Live feed via polling. *Deliverable: a full deal runs end-to-end, P2P.*

**Phase 2 — Custody & store tooling**
Two-track (payment + custody) model. Relay drop-off flow. **Store audit/control log** (release / picked-up / overstay). Time-bounded custody, size gate, unpaid-item return path. In-app + email notifications hardened. *Deliverable: relay escrow works; stores get their control tool.*

**Phase 3 — WhatsApp + your paid rail**
Begin **Meta Business verification early** (it gates this phase — see §11). WhatsApp notification adapter + store bot. Full-service pickup & delivery flow with per-zone pricing. WhatsApp OTP. Upgrade live feed polling → SSE. *Deliverable: your monetizable logistics rail is live.*

**Phase 4 — Monetization & polish**
Vouching. Power-seller subscription. Native promoted listings. Seller analytics. Grading-concierge intake. Sponsorship placements. *Deliverable: revenue streams switched on.*

**Parallel throughout — the real hard part (non-technical).** The build isn't the risk; pulling 2,000 people out of a Facebook group where the network effect already lives is. Plan to **run both in parallel** and **seed the app with your power sellers first.**

---

## 11. Key Risks

**Meta Business verification friction (highest-probability blocker).** You already hit this on the dashboard project. The whole WhatsApp layer — notifications, store bot, OTP — depends on it. **Mitigation (already baked into the architecture):** ship on in-app + email (no gatekeeper); WhatsApp is a pluggable adapter, so verification delay slips *one channel*, not the launch. Start verification paperwork in Phase 0/1, well before you need it.

**WhatsApp cost creep after 1 Oct 2026.** Service/utility-in-window messages stop being free. **Mitigation:** keep notifications terse and consolidated (one clear message, not five fragments); prefer in-app for anything non-urgent; reserve WhatsApp for high-value events (won auction, payment reminder, custody ready).

**Community migration (the actual make-or-break).** Technology won't move the network effect; incentives and seeding will. **Mitigation:** parallel-run, power-seller seeding, and lead store adoption with *their* pain (the free audit tool), not a fee.

**Store resistance to fees.** Solved by decoupling: give the control tool free, make fees optional/per-store/footfall-amplifying (§5).

**Better Auth maturity.** It's a newer library. **Mitigation:** the durable decision is "self-hosted, own-your-data auth in Postgres" — if Better Auth disappoints, the principle survives a swap; sanity-check its maturity before Phase 0 commits.

**Reputation data loss.** The one thing you cannot lose. **Mitigation:** Render automated backups + periodic `pg_dump` to R2.

---

## 12. Open Items for Next Session

- Full Postgres schema (tables, columns, indexes, foreign keys, `category` field + JSONB for variable per-category item attributes; category attribute-declaration config)
- The complete Listing → Transaction state machine drawn as a diagram, including both tracks (payment + custody) and all four fulfillment paths — to pressure-test that the two-track model holds no contradictions before any code is written
- Notification event catalogue (which events fire on which channels)
- Delivery zone/pricing map for Trinidad & Tobago

---

*End of document.*
