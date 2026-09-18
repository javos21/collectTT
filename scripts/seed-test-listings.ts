/**
 * Local-only marketplace fixtures for manual flow testing.
 *
 * Creates active listings for existing, human-created profiles and uploads generated
 * WebP images (including responsive variants) to the configured local MinIO bucket.
 * Automated t_* and seed_* profiles are deliberately ignored.
 */

import '../src/lib/load-env';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq, ne, notLike, sql } from 'drizzle-orm';
import sharp from 'sharp';

import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema/auth';
import { images } from '../src/db/schema/images';
import {
  listingAuditEvents,
  listingFulfillmentTerms,
  listingImages,
  listings,
} from '../src/db/schema/listings';
import { profiles } from '../src/db/schema/profiles';
import { parseAttributes } from '../src/domain/categories/build-schema';
import { enqueue } from '../src/jobs/enqueue';
import { deleteObjects, originalKey, putObject, variantKey } from '../src/lib/storage';

const SEED_TAG = 'manual-flow-fixtures-v1';
const WIDTH = 1200;
const HEIGHT = 900;

type Category = 'trading_card' | 'comic' | 'collectible';

interface Fixture {
  category: Category;
  title: string;
  description: string;
  attributes: Record<string, unknown>;
  saleType: 'straight_sale' | 'auction';
  priceCents?: number;
  startBidCents?: number;
  durationHours?: number;
  imageCount?: number;
  palette: readonly [string, string, string];
}

const FIXTURES: readonly Fixture[] = [
  {
    category: 'trading_card',
    title: 'Charizard VMAX Rainbow Rare',
    description: 'Near-mint collector card stored in a sleeve and top loader. Clean corners and surface.',
    attributes: { game: 'pokemon', condition: 'NM' },
    saleType: 'auction',
    startBidCents: 8_500,
    durationHours: 48,
    imageCount: 2,
    palette: ['#7C2D12', '#EA580C', '#FDBA74'],
  },
  {
    category: 'trading_card',
    title: 'MTG Commander Deck Collection',
    description: 'A ready-to-play Commander deck with tokens and a matching deck box. Lightly played.',
    attributes: { game: 'magic', condition: 'LP' },
    saleType: 'straight_sale',
    priceCents: 12_500,
    palette: ['#312E81', '#6366F1', '#C7D2FE'],
  },
  {
    category: 'trading_card',
    title: 'Blue-Eyes White Dragon SDK',
    description: 'Classic Yu-Gi-Oh card in near-mint condition. Kept sleeved since opening.',
    attributes: { game: 'yugioh', condition: 'NM' },
    saleType: 'auction',
    startBidCents: 5_000,
    durationHours: 72,
    palette: ['#164E63', '#0891B2', '#A5F3FC'],
  },
  {
    category: 'trading_card',
    title: 'Basketball Rookie Card Lot',
    description: 'Twelve modern rookie cards sold as one lot. All cards are sleeved and near mint.',
    attributes: { game: 'sports', condition: 'NM' },
    saleType: 'straight_sale',
    priceCents: 7_500,
    palette: ['#7F1D1D', '#DC2626', '#FECACA'],
  },
  {
    category: 'comic',
    title: 'Amazing Spider-Man #300',
    description: 'Key Marvel issue with a clean cover and complete interior. A strong display copy.',
    attributes: { publisher: 'marvel', condition: 'very_fine' },
    saleType: 'auction',
    startBidCents: 18_000,
    durationHours: 168,
    imageCount: 2,
    palette: ['#1E3A8A', '#2563EB', '#BFDBFE'],
  },
  {
    category: 'comic',
    title: 'Batman: The Killing Joke First Print',
    description: 'First-print copy with vivid colours and tight staples. Minor shelf wear only.',
    attributes: { publisher: 'dc', condition: 'very_fine' },
    saleType: 'straight_sale',
    priceCents: 6_500,
    palette: ['#111827', '#4B5563', '#FDE047'],
  },
  {
    category: 'comic',
    title: 'Saga Deluxe Edition Volume One',
    description: 'Oversized hardcover in near-mint condition. Dust jacket and binding are excellent.',
    attributes: { publisher: 'image', condition: 'near_mint' },
    saleType: 'straight_sale',
    priceCents: 4_800,
    palette: ['#581C87', '#A855F7', '#E9D5FF'],
  },
  {
    category: 'comic',
    title: 'Hellboy: Seed of Destruction Set',
    description: 'Complete four-issue Dark Horse mini-series. All issues bagged and boarded.',
    attributes: { publisher: 'dark_horse', condition: 'fine' },
    saleType: 'auction',
    startBidCents: 9_000,
    durationHours: 48,
    palette: ['#450A0A', '#B91C1C', '#FCA5A5'],
  },
  {
    category: 'collectible',
    title: 'LEGO Star Wars Millennium Falcon',
    description: 'Complete display set with minifigures and instruction book. Carefully disassembled.',
    attributes: { brand: 'LEGO', condition: 'Complete, excellent condition' },
    saleType: 'straight_sale',
    priceCents: 28_000,
    imageCount: 2,
    palette: ['#713F12', '#EAB308', '#FEF08A'],
  },
  {
    category: 'collectible',
    title: 'One Piece Luffy Collectible Figure',
    description: 'Boxed display figure with stand and accessories. Opened once for inspection.',
    attributes: { brand: 'Banpresto', condition: 'Like new in box' },
    saleType: 'straight_sale',
    priceCents: 5_500,
    palette: ['#7C2D12', '#F97316', '#FFEDD5'],
  },
  {
    category: 'collectible',
    title: 'Vintage Hot Wheels Redline Bundle',
    description: 'Five vintage die-cast cars with honest play wear. Sold together as one lot.',
    attributes: { brand: 'Hot Wheels', condition: 'Good vintage condition' },
    saleType: 'auction',
    startBidCents: 7_000,
    durationHours: 72,
    palette: ['#7F1D1D', '#EF4444', '#FDE68A'],
  },
  {
    category: 'collectible',
    title: 'Pokémon Elite Trainer Box Sealed',
    description: 'Factory-sealed Elite Trainer Box with intact wrap and crisp corners.',
    attributes: { brand: 'The Pokémon Company', condition: 'Factory sealed' },
    saleType: 'straight_sale',
    priceCents: 11_000,
    palette: ['#064E3B', '#10B981', '#A7F3D0'],
  },
];

function assertTarget(): 'local' | 'staging' {
  const target = process.env.SEED_TARGET ?? 'local';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const storageEndpoint = process.env.STORAGE_ENDPOINT ?? '';
  const isLocal = (value: string) => value.includes('localhost') || value.includes('127.0.0.1');

  if (target === 'local') {
    if (!isLocal(databaseUrl) || !isLocal(storageEndpoint)) {
      throw new Error('SEED_TARGET=local requires local database and storage endpoints.');
    }
    return target;
  }

  if (target === 'staging') {
    if (process.env.CONFIRM_STAGING_SEED !== 'seed-staging-listings') {
      throw new Error('Set CONFIRM_STAGING_SEED=seed-staging-listings to continue.');
    }
    if (isLocal(databaseUrl) || !databaseUrl.includes('supabase.com')) {
      throw new Error('SEED_TARGET=staging requires the configured Supabase database.');
    }
    if (isLocal(storageEndpoint) || !storageEndpoint.includes('r2.cloudflarestorage.com')) {
      throw new Error('SEED_TARGET=staging requires the configured Cloudflare R2 endpoint.');
    }
    return target;
  }

  throw new Error('SEED_TARGET must be local or staging.');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function titleLines(title: string): [string, string] {
  const words = title.split(' ');
  const lines: [string, string] = ['', ''];
  for (const word of words) {
    const line = lines[0].length <= lines[1].length ? 0 : 1;
    lines[line] = `${lines[line]} ${word}`.trim();
  }
  return [escapeXml(lines[0]), escapeXml(lines[1])];
}

function categoryArtwork(category: Category, accent: string): string {
  if (category === 'trading_card') {
    return `<g transform="translate(760 165) rotate(8 150 220)">
      <rect width="300" height="440" rx="28" fill="white" fill-opacity="0.92"/>
      <rect x="28" y="32" width="244" height="250" rx="18" fill="${accent}" fill-opacity="0.72"/>
      <circle cx="150" cy="157" r="74" fill="white" fill-opacity="0.55"/>
      <rect x="42" y="315" width="216" height="18" rx="9" fill="${accent}" fill-opacity="0.7"/>
      <rect x="42" y="350" width="160" height="14" rx="7" fill="${accent}" fill-opacity="0.35"/>
    </g>`;
  }
  if (category === 'comic') {
    return `<g transform="translate(760 150) rotate(5 150 230)">
      <rect x="24" y="20" width="300" height="450" rx="16" fill="black" fill-opacity="0.25"/>
      <rect width="300" height="450" rx="16" fill="white" fill-opacity="0.94"/>
      <path d="M150 70 L176 132 L244 112 L204 168 L262 205 L190 210 L186 282 L145 224 L92 272 L108 203 L38 184 L102 153 L72 88 L133 126 Z" fill="${accent}" fill-opacity="0.82"/>
      <rect x="38" y="330" width="224" height="24" rx="12" fill="${accent}" fill-opacity="0.72"/>
      <rect x="58" y="378" width="184" height="15" rx="8" fill="${accent}" fill-opacity="0.32"/>
    </g>`;
  }
  return `<g transform="translate(742 150)">
    <ellipse cx="175" cy="420" rx="170" ry="42" fill="black" fill-opacity="0.22"/>
    <rect x="55" y="330" width="240" height="90" rx="24" fill="white" fill-opacity="0.9"/>
    <circle cx="175" cy="190" r="145" fill="white" fill-opacity="0.92"/>
    <circle cx="175" cy="190" r="92" fill="${accent}" fill-opacity="0.72"/>
    <circle cx="145" cy="155" r="30" fill="white" fill-opacity="0.55"/>
  </g>`;
}

async function renderSource(fixture: Fixture, sellerName: string, view: number): Promise<Buffer> {
  const [dark, accent, light] = fixture.palette;
  const [line1, line2] = titleLines(fixture.title);
  const category = fixture.category.replace('_', ' ').toUpperCase();
  const saleLabel = fixture.saleType === 'auction' ? 'AUCTION' : 'BUY NOW';
  const viewLabel = (fixture.imageCount ?? 1) > 1 ? `VIEW ${view + 1}` : 'PRODUCT PHOTO';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${dark}"/>
        <stop offset="0.58" stop-color="${accent}"/>
        <stop offset="1" stop-color="${light}"/>
      </linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-opacity="0.25"/></filter>
    </defs>
    <rect width="1200" height="900" fill="url(#bg)"/>
    <circle cx="1120" cy="90" r="260" fill="white" fill-opacity="0.08"/>
    <circle cx="1020" cy="820" r="360" fill="white" fill-opacity="0.07"/>
    <g filter="url(#shadow)">${categoryArtwork(fixture.category, accent)}</g>
    <rect x="70" y="70" width="215" height="48" rx="24" fill="white" fill-opacity="0.18" stroke="white" stroke-opacity="0.28"/>
    <text x="178" y="102" text-anchor="middle" font-family="Arial, sans-serif" font-size="21" font-weight="700" letter-spacing="2" fill="white">${category}</text>
    <text x="70" y="255" font-family="Arial, sans-serif" font-size="65" font-weight="800" fill="white">${line1}</text>
    <text x="70" y="330" font-family="Arial, sans-serif" font-size="65" font-weight="800" fill="white">${line2}</text>
    <rect x="70" y="390" width="170" height="52" rx="14" fill="white"/>
    <text x="155" y="424" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="${dark}">${saleLabel}</text>
    <text x="70" y="735" font-family="Arial, sans-serif" font-size="23" font-weight="700" fill="white" fill-opacity="0.78">${escapeXml(viewLabel)}</text>
    <text x="70" y="786" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="white">Listed by ${escapeXml(sellerName)}</text>
    <text x="70" y="830" font-family="Arial, sans-serif" font-size="19" fill="white" fill-opacity="0.72">CollectTT manual flow fixture</text>
  </svg>`;

  return sharp(Buffer.from(svg)).webp({ quality: 88 }).toBuffer();
}

async function uploadImage(fixture: Fixture, sellerName: string, view: number) {
  const id = randomUUID();
  const source = await renderSource(fixture, sellerName, view);
  const sourceKey = originalKey(id);
  const uploadedKeys: string[] = [];
  const variants: Record<string, { key: string; w: number; h: number }> = {};

  await putObject({ key: sourceKey, body: source, contentType: 'image/webp' });
  uploadedKeys.push(sourceKey);

  for (const [name, width] of [['thumb', 320], ['card', 800], ['full', 1200]] as const) {
    const output = await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
    const key = variantKey(id, name);
    await putObject({ key, body: output.data, contentType: 'image/webp' });
    uploadedKeys.push(key);
    variants[name] = { key, w: output.info.width, h: output.info.height };
  }

  return {
    row: {
      id,
      status: 'ready' as const,
      r2KeyOriginal: sourceKey,
      variants,
      contentType: 'image/webp',
      bytes: source.byteLength,
      width: WIDTH,
      height: HEIGHT,
      checksumSha256: createHash('sha256').update(source).digest('hex'),
      processedAt: new Date(),
    },
    uploadedKeys,
  };
}

async function main(): Promise<void> {
  const target = assertTarget();

  const existing = await db
    .select({ id: listingAuditEvents.id })
    .from(listingAuditEvents)
    .where(sql`${listingAuditEvents.metadata} ->> 'seedTag' = ${SEED_TAG}`)
    .limit(1);
  if (existing[0] !== undefined) {
    throw new Error('Manual flow fixtures already exist. Wipe their listings before seeding another batch.');
  }

  const sellers = await db
    .select({ userId: profiles.userId, displayName: profiles.displayName })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(
      eq(profiles.status, 'active'),
      ne(profiles.role, 'store_staff'),
      notLike(profiles.userId, 't_%'),
      notLike(profiles.userId, 'seed_%'),
      notLike(users.email, '%@test.local'),
      notLike(users.email, '%@seed.local'),
    ))
    .orderBy(profiles.createdAt)
    .limit(3);

  if (sellers.length < 2) {
    throw new Error('At least two active user-created profiles are required.');
  }

  const uploadedKeys: string[] = [];
  const prepared: Array<{
    fixture: Fixture;
    seller: (typeof sellers)[number];
    listingId: string;
    imageRows: Array<typeof images.$inferInsert>;
  }> = [];

  try {
    for (const [index, fixture] of FIXTURES.entries()) {
      const seller = sellers[index % sellers.length]!;
      const imageRows: Array<typeof images.$inferInsert> = [];

      for (let view = 0; view < (fixture.imageCount ?? 1); view += 1) {
        const uploaded = await uploadImage(fixture, seller.displayName, view);
        uploadedKeys.push(...uploaded.uploadedKeys);
        imageRows.push({ ...uploaded.row, ownerUserId: seller.userId });
      }

      prepared.push({ fixture, seller, listingId: randomUUID(), imageRows });
      console.log(`[seed:listings] prepared ${fixture.title}`);
    }

    await db.transaction(async (tx) => {
      for (const item of prepared) {
        const { attributes, version } = parseAttributes(item.fixture.category, item.fixture.attributes);
        const now = new Date();
        const endsAt = item.fixture.saleType === 'auction'
          ? new Date(now.getTime() + (item.fixture.durationHours ?? 48) * 3_600_000)
          : null;
        const expiresAt = item.fixture.saleType === 'straight_sale'
          ? new Date(now.getTime() + 30 * 24 * 3_600_000)
          : null;

        await tx.insert(images).values(item.imageRows);
        await tx.insert(listings).values({
          id: item.listingId,
          sellerId: item.seller.userId,
          category: item.fixture.category,
          attributes,
          attributesVersion: version,
          title: item.fixture.title,
          description: item.fixture.description,
          saleType: item.fixture.saleType,
          status: 'active',
          priceCents: item.fixture.saleType === 'straight_sale' ? item.fixture.priceCents : null,
          acceptsOffers: false,
          paymentWindowHours: 72,
          startBidCents: item.fixture.saleType === 'auction' ? item.fixture.startBidCents : null,
          reserveCents: null,
          buyoutCents: null,
          endsAt,
          fulfillmentPaths: ['cash_meetup'],
          settlementMethods: ['cash', 'bank_transfer'],
          autoRelistOnRenege: true,
          expiresAt,
          publishedAt: now,
        });
        await tx.insert(listingImages).values(item.imageRows.map((image, position) => ({
          listingId: item.listingId,
          imageId: image.id!,
          position,
        })));
        await tx.insert(listingFulfillmentTerms).values({
          listingId: item.listingId,
          fulfillmentPath: 'cash_meetup',
          expectedDeliveryDays: 1,
        });
        await tx.insert(listingAuditEvents).values({
          listingId: item.listingId,
          actorUserId: item.seller.userId,
          eventType: 'created',
          metadata: { status: 'active', seedTag: SEED_TAG },
        });

        if (item.fixture.saleType === 'auction' && endsAt !== null) {
          await enqueue(tx, 'auction:close', { listingId: item.listingId }, {
            jobKey: `auction_close:${item.listingId}`,
            runAt: endsAt,
          });
        }
        if (item.fixture.saleType === 'straight_sale' && expiresAt !== null) {
          await enqueue(tx, 'listing:expire', { listingId: item.listingId }, {
            jobKey: `listing_expire:${item.listingId}`,
            runAt: expiresAt,
          });
        }
      }
    });
  } catch (error) {
    await deleteObjects(uploadedKeys).catch(() => undefined);
    throw error;
  }

  console.log(
    `[seed:listings] created ${prepared.length} active listings with ${prepared.reduce((sum, item) => sum + item.imageRows.length, 0)} images across ${sellers.length} existing profiles on ${target}`,
  );
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('[seed:listings] failed', error);
  await pool.end();
  process.exit(1);
});
