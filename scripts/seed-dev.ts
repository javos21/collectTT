/**
 * Development fixtures: a few members and one listing per category, so browse and
 * attribute filtering have something to show without clicking through forms.
 *
 * Idempotent — re-running replaces the seeded rows rather than duplicating them.
 * Refuses to run against a non-local database.
 */

import '../src/lib/load-env';
import { eq, inArray, or } from 'drizzle-orm';

import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema/auth';
import { profiles, reputationCounters, reputationEvents } from '../src/db/schema/profiles';
import { listings } from '../src/db/schema/listings';
import { transactionEvents, transactions } from '../src/db/schema/transactions';
import { custodyHoldings } from '../src/db/schema/custody';
import { transactionEvidence } from '../src/db/schema/transaction-evidence';
import { supportCases } from '../src/db/schema/support-cases';
import { parseAttributes } from '../src/domain/categories/build-schema';

const SEED_USERS = [
  { id: 'seed_kavita', name: 'Kavita R.', email: 'kavita@seed.local', area: 'Port of Spain' },
  { id: 'seed_dwayne', name: 'Dwayne M.', email: 'dwayne@seed.local', area: 'San Fernando' },
  { id: 'seed_anisa', name: 'Anisa B.', email: 'anisa@seed.local', area: 'Chaguanas' },
];

const SEED_LISTINGS = [
  {
    sellerId: 'seed_kavita',
    category: 'trading_card',
    title: 'Charizard — Base Set, PSA 8',
    description: 'Held since 1999. Slab is clean, no scratches.',
    saleType: 'auction' as const,
    startBidCents: 150_000,
    durationHours: 48,
    attributes: {
      game: 'pokemon',
      condition: 'NM',
    },
  },
  {
    sellerId: 'seed_dwayne',
    category: 'trading_card',
    title: 'Black Lotus proxy set — 5 cards',
    description: 'Clearly marked proxies. Playgroup use only.',
    saleType: 'straight_sale' as const,
    priceCents: 12_000,
    attributes: {
      game: 'magic',
      condition: 'NM',
    },
  },
  {
    sellerId: 'seed_anisa',
    category: 'comic',
    title: 'Amazing Fantasy #15 — CGC 4.5',
    description: 'First appearance of Spider-Man. Slabbed and pressed.',
    saleType: 'auction' as const,
    startBidCents: 2_000_000,
    durationHours: 72,
    attributes: {
      publisher: 'marvel',
      condition: 'good',
    },
  },
  {
    sellerId: 'seed_kavita',
    category: 'comic',
    title: 'Saga vol. 1–9 — raw run',
    description: 'Complete first nine-volume run in very fine condition.',
    saleType: 'straight_sale' as const,
    priceCents: 45_000,
    attributes: {
      publisher: 'image',
      condition: 'very_fine',
    },
  },
  {
    sellerId: 'seed_dwayne',
    category: 'collectible',
    title: 'Sealed Pokémon Evolving Skies booster box',
    description: 'Factory sealed, stored in AC.',
    saleType: 'straight_sale' as const,
    priceCents: 350_000,
    attributes: {
      brand: 'The Pokémon Company',
      condition: 'Sealed',
    },
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    throw new Error(`Refusing to seed a non-local database: ${url.replace(/:[^:@]*@/, ':***@')}`);
  }

  const ids = SEED_USERS.map((u) => u.id);

  // Clean previous seed rows so this is idempotent.
  const seededListingIds = (await db
    .select({ id: listings.id })
    .from(listings)
    .where(inArray(listings.sellerId, ids)))
    .map((row) => row.id);
  if (seededListingIds.length > 0) {
    // Legacy custody rows do not cascade from listings. Remove only rows belonging to
    // these development fixtures, in dependency order, so a stale historical fixture
    // cannot make `npm run seed:dev` fail halfway through a reset.
    const seededTransactionIds = (await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(inArray(transactions.listingId, seededListingIds)))
      .map((row) => row.id);
    await db.delete(transactionEvents).where(inArray(transactionEvents.transactionId, seededTransactionIds));
    await db.delete(transactionEvidence).where(inArray(transactionEvidence.transactionId, seededTransactionIds));
    await db.delete(supportCases).where(or(
      inArray(supportCases.targetId, seededListingIds),
      inArray(supportCases.targetId, seededTransactionIds),
    ));
    await db.delete(reputationEvents).where(or(
      inArray(reputationEvents.transactionId, seededTransactionIds),
      inArray(reputationEvents.userId, ids),
      inArray(reputationEvents.counterpartyUserId, ids),
    ));
    await db.delete(transactions).where(inArray(transactions.listingId, seededListingIds));
    await db.delete(custodyHoldings).where(inArray(custodyHoldings.listingId, seededListingIds));
    await db.delete(listings).where(inArray(listings.id, seededListingIds));
  }
  await db.delete(supportCases).where(or(
    inArray(supportCases.reporterUserId, ids),
    inArray(supportCases.assignedTo, ids),
    inArray(supportCases.resolvedBy, ids),
  ));
  await db.delete(reputationEvents).where(or(
    inArray(reputationEvents.userId, ids),
    inArray(reputationEvents.counterpartyUserId, ids),
  ));
  await db.delete(listings).where(inArray(listings.sellerId, ids));
  await db.delete(reputationCounters).where(inArray(reputationCounters.userId, ids));
  await db.delete(profiles).where(inArray(profiles.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));

  for (const user of SEED_USERS) {
    await db.insert(users).values({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: true,
    });
    await db.insert(profiles).values({
      userId: user.id,
      displayName: user.name,
      handle: user.id.replace('seed_', ''),
      area: user.area,
      phoneE164: `+18685550${String(SEED_USERS.indexOf(user) + 1).padStart(2, '0')}`,
    });
    await db.insert(reputationCounters).values({ userId: user.id });
    console.log(`[seed] member ${user.name}`);
  }

  for (const item of SEED_LISTINGS) {
    // Validated through the same path the app uses — if a seed fixture drifts from the
    // category config, this fails loudly instead of writing junk into the JSONB column.
    const { attributes, version } = parseAttributes(item.category, item.attributes);

    await db.insert(listings).values({
      sellerId: item.sellerId,
      category: item.category,
      attributes,
      attributesVersion: version,
      title: item.title,
      description: 'description' in item ? (item.description ?? null) : null,
      saleType: item.saleType,
      status: 'active',
      priceCents: 'priceCents' in item ? (item.priceCents ?? null) : null,
      startBidCents: 'startBidCents' in item ? (item.startBidCents ?? null) : null,
      buyoutCents: null,
      endsAt:
        item.saleType === 'auction'
          ? new Date(Date.now() + ('durationHours' in item ? (item.durationHours ?? 48) : 48) * 3600_000)
          : null,
      fulfillmentPaths: ['cash_meetup'],
      settlementMethods: ['cash', 'bank_transfer'],
      publishedAt: new Date(),
    });
    console.log(`[seed] listing ${item.title}`);
  }

  const count = await db.select({ id: listings.id }).from(listings).where(eq(listings.status, 'active'));
  console.log(`\n[seed] done — ${count.length} active listings. Visit http://localhost:3000/listings`);

  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('[seed] failed', error);
  await pool.end();
  process.exit(1);
});
