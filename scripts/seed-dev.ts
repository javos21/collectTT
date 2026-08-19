/**
 * Development fixtures: a few members and one listing per category, so browse and
 * attribute filtering have something to show without clicking through forms.
 *
 * Idempotent — re-running replaces the seeded rows rather than duplicating them.
 * Refuses to run against a non-local database.
 */

import '../src/lib/load-env';
import { eq, inArray } from 'drizzle-orm';

import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema/auth';
import { profiles, reputationCounters } from '../src/db/schema/profiles';
import { listings } from '../src/db/schema/listings';
import { relayStores, relayStoreStaff, listingRelayStores } from '../src/db/schema/custody';
import { parseAttributes } from '../src/domain/categories/build-schema';

const SEED_USERS = [
  { id: 'seed_kavita', name: 'Kavita R.', email: 'kavita@seed.local', area: 'Port of Spain' },
  { id: 'seed_dwayne', name: 'Dwayne M.', email: 'dwayne@seed.local', area: 'San Fernando' },
  { id: 'seed_anisa', name: 'Anisa B.', email: 'anisa@seed.local', area: 'Chaguanas' },
];

/**
 * One relay store, so the store board at /store is reachable locally. Fixed id, and
 * never deleted on re-seed: live custody holdings may reference it.
 */
const SEED_STORE = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Frontline Comics & Games',
  area: 'Port of Spain',
  address: '12 Frederick Street, Port of Spain',
  phoneE164: '+18685550100',
};

const SEED_LISTINGS = [
  {
    sellerId: 'seed_kavita',
    category: 'trading_card',
    title: 'Charizard — Base Set, PSA 8',
    description: 'Held since 1999. Slab is clean, no scratches.',
    saleType: 'auction' as const,
    startBidCents: 150_000,
    buyoutCents: 600_000,
    durationHours: 48,
    attributes: {
      game: 'pokemon',
      set: 'Base Set',
      card_name: 'Charizard',
      card_number: '4/102',
      rarity: 'Holo Rare',
      condition: 'NM',
      graded: true,
      grader: 'PSA',
      grade: 8,
      foil: true,
      language: 'English',
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
      set: 'Proxy',
      card_name: 'Black Lotus (proxy)',
      condition: 'NM',
      graded: false,
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
      title: 'Amazing Fantasy',
      issue: '15',
      publisher: 'marvel',
      year: 1962,
      key_issue: true,
      graded: true,
      grader: 'CGC',
      grade: 4.5,
    },
  },
  {
    sellerId: 'seed_kavita',
    category: 'comic',
    title: 'Saga vol. 1–9 — raw run',
    saleType: 'straight_sale' as const,
    priceCents: 45_000,
    attributes: {
      title: 'Saga',
      issue: 'vol 1-9',
      publisher: 'image',
      year: 2012,
      key_issue: false,
      graded: false,
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
      item_type: 'Sealed booster box',
      brand: 'The Pokémon Company',
      franchise: 'Pokémon',
      year: 2021,
      sealed: true,
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
      buyoutCents: 'buyoutCents' in item ? (item.buyoutCents ?? null) : null,
      endsAt:
        item.saleType === 'auction'
          ? new Date(Date.now() + ('durationHours' in item ? (item.durationHours ?? 48) : 48) * 3600_000)
          : null,
      fulfillmentPaths: ['cash_meetup', 'relay'],
      settlementMethods: ['cash', 'bank_transfer'],
      sizeClass: 'small',
      publishedAt: new Date(),
    });
    console.log(`[seed] listing ${item.title}`);
  }

  // ── the relay store, its staff, and which listings may be dropped there ──────
  await db
    .insert(relayStores)
    .values({
      id: SEED_STORE.id,
      name: SEED_STORE.name,
      area: SEED_STORE.area,
      address: SEED_STORE.address,
      phoneE164: SEED_STORE.phoneE164,
      acceptsSizeClasses: ['small'],
      active: true,
    })
    .onConflictDoUpdate({
      target: relayStores.id,
      set: {
        name: SEED_STORE.name,
        area: SEED_STORE.area,
        acceptsSizeClasses: ['small'],
        active: true,
      },
    });

  const staffUser = SEED_USERS[0];
  if (staffUser === undefined) throw new Error('No seed user to make store staff');
  await db
    .insert(relayStoreStaff)
    .values({ storeId: SEED_STORE.id, userId: staffUser.id, role: 'manager' })
    .onConflictDoNothing();
  console.log(`[seed] store ${SEED_STORE.name} — ${staffUser.name} is manager`);

  // listing_relay_stores rows cascade away with their listing, so this stays idempotent.
  const seeded = await db
    .select({ id: listings.id })
    .from(listings)
    .where(inArray(listings.sellerId, ids));
  if (seeded.length > 0) {
    await db
      .insert(listingRelayStores)
      .values(seeded.map((l) => ({ listingId: l.id, storeId: SEED_STORE.id })))
      .onConflictDoNothing();
  }

  const count = await db.select({ id: listings.id }).from(listings).where(eq(listings.status, 'active'));
  console.log(`\n[seed] done — ${count.length} active listings. Visit http://localhost:3000/listings`);
  console.log(
    `[seed] store board: sign in as ${staffUser.email}, then open http://localhost:3000/store`,
  );

  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('[seed] failed', error);
  await pool.end();
  process.exit(1);
});
