import { redirect } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';

import { currentUser } from '@/lib/session';
import { createListing, SETTLEMENT_METHODS } from '@/services/listings';
import { listRelayStores } from '@/services/relay-stores';
import { db } from '@/db/client';
import { CATEGORY_LIST, getCategory } from '@/domain/categories/definitions';
import { FULFILLMENT_PATHS } from '@/domain/states/transaction';
import { SIZE_CLASSES } from '@/domain/states/listing';
import { parseMoneyInput } from '@/domain/money';
import { AttributeFields } from './attribute-fields';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Cash on meetup',
  remote_ship: 'Remote payment, I ship it',
  relay: 'Relay store drop-off',
  full_service: 'Full-service pickup & delivery',
};

/**
 * Pull namespaced `attr__*` fields out of the flat FormData and coerce them using the
 * category's own declarations. The server never trusts the browser's idea of types.
 */
function collectAttributes(categoryKey: string, formData: FormData): Record<string, unknown> {
  const def = getCategory(categoryKey);
  const out: Record<string, unknown> = {};

  for (const attr of def.attributes) {
    const raw = formData.get(`attr__${attr.key}`);

    if (attr.type === 'boolean') {
      // An unchecked checkbox submits nothing. Only record `true`, so an unchecked
      // optional boolean stays absent rather than becoming a meaningless `false`.
      if (raw !== null) out[attr.key] = true;
      continue;
    }

    if (raw === null || String(raw).trim() === '') continue;

    if (attr.type === 'number' || attr.type === 'year') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[attr.key] = n;
      continue;
    }

    out[attr.key] = String(raw).trim();
  }

  return out;
}

async function create(formData: FormData): Promise<void> {
  'use server';

  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const category = String(formData.get('category') ?? '');
  const saleType = String(formData.get('saleType') ?? 'straight_sale');

  const money = (field: string): number | undefined => {
    const raw = String(formData.get(field) ?? '').trim();
    if (raw === '') return undefined;
    return parseMoneyInput(raw) ?? undefined;
  };

  const input = {
    category,
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? '') || undefined,
    saleType,
    priceCents: money('price'),
    startBidCents: money('startBid'),
    reserveCents: money('reserve'),
    buyoutCents: money('buyout'),
    durationHours:
      saleType === 'auction' ? Number(formData.get('durationHours') ?? 48) : undefined,
    fulfillmentPaths: formData.getAll('fulfillmentPaths').map(String),
    settlementMethods: formData.getAll('settlementMethods').map(String),
    relayStoreIds: formData.getAll('relayStoreIds').map(String),
    sizeClass: String(formData.get('sizeClass') ?? 'small'),
    autoRelistOnRenege: formData.get('autoRelistOnRenege') !== null,
    imageIds: [],
    attributes: collectAttributes(category, formData),
  };

  let id: string;
  try {
    const created = await createListing(user.userId, input, { publish: true });
    id = created.id;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ');
      redirect(`/listings/new?error=${encodeURIComponent(detail)}`);
    }
    throw error;
  }

  redirect(`/listings/${id}`);
}

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  const { error } = await searchParams;
  const relayStoreOptions = await listRelayStores(db);

  if (user === null) {
    return (
      <main>
        <h1>Sell an item</h1>
        <p>
          <Link href="/sign-in">Sign in</Link> to create a listing.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Sell an item</h1>
      <p className="muted">
        Settlement method and fulfillment path are declared up front, before anyone
        claims — nobody bids blind.
      </p>

      {error !== undefined && <p className="error">{error}</p>}

      <form action={create}>
        <AttributeFields categories={[...CATEGORY_LIST]} />

        <label htmlFor="title">Title</label>
        <input id="title" name="title" type="text" required minLength={3} maxLength={160} />

        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" maxLength={4000} />

        <fieldset>
          <legend>Sale type</legend>
          <div className="row">
            <div>
              <label htmlFor="saleType">Type</label>
              <select id="saleType" name="saleType" defaultValue="straight_sale">
                <option value="straight_sale">Straight sale (first to claim)</option>
                <option value="auction">Auction (highest bid wins)</option>
              </select>
            </div>
            <div>
              <label htmlFor="price">Price (straight sale)</label>
              <input id="price" name="price" type="text" placeholder="250.00" />
            </div>
          </div>
          <div className="row">
            <div>
              <label htmlFor="startBid">Starting bid (auction)</label>
              <input id="startBid" name="startBid" type="text" placeholder="50.00" />
            </div>
            <div>
              <label htmlFor="buyout">Buyout (optional)</label>
              <input id="buyout" name="buyout" type="text" placeholder="400.00" />
            </div>
            <div>
              <label htmlFor="durationHours">Duration (hours)</label>
              <input id="durationHours" name="durationHours" type="number" defaultValue={48} min={1} />
            </div>
          </div>
          <p className="muted">
            Auctions use a soft close: a bid in the last {2} minutes pushes the deadline
            out, so &ldquo;closes 8:00&rdquo; means &ldquo;closes 8:00 unless bids keep landing&rdquo;.
          </p>
        </fieldset>

        <fieldset>
          <legend>How this deal can settle</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            The platform never handles the money — you and the buyer settle directly.
          </p>
          {/*
            ★ full_service is NOT offerable yet. The enum, the state machine and the
              windows are all ready for it, but spec §9 defers the courier rail to a
              later phase and there is no operational surface behind it: a full_service
              holding opens with store_id = null, so it appears on NO store board, no
              staff member can act on it, and it sits in awaiting_dropoff until
              dropoffWindowExpired terminates the deal as seller_no_dropoff — a
              reputation-bearing renege against a seller who did nothing wrong. Filtered
              at the only place a seller can choose it; nothing below it changes.
          */}
          {FULFILLMENT_PATHS.filter((path) => path !== 'full_service').map((path) => (
            <label key={path} htmlFor={`path_${path}`} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <input
                id={`path_${path}`}
                type="checkbox"
                name="fulfillmentPaths"
                value={path}
                defaultChecked={path === 'cash_meetup'}
              />
              {PATH_LABELS[path]}
            </label>
          ))}

          <label style={{ marginTop: '1rem' }}>Where will you drop it off?</label>
          <p className="muted" style={{ marginTop: 0 }}>
            Pick every store you&apos;re willing to use — the buyer chooses one of these.
          </p>
          {relayStoreOptions.map((store) => (
            <label key={store.id} htmlFor={`store_${store.id}`} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <input
                id={`store_${store.id}`}
                type="checkbox"
                name="relayStoreIds"
                value={store.id}
              />
              {store.name} ({store.area})
            </label>
          ))}

          <label style={{ marginTop: '1rem' }}>Accepted payment methods</label>
          {SETTLEMENT_METHODS.map((method) => (
            <label key={method} htmlFor={`pay_${method}`} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <input
                id={`pay_${method}`}
                type="checkbox"
                name="settlementMethods"
                value={method}
                defaultChecked={method === 'cash'}
              />
              {method.replace('_', ' ')}
            </label>
          ))}

          <label htmlFor="sizeClass">Size</label>
          <select id="sizeClass" name="sizeClass" defaultValue="small">
            {SIZE_CLASSES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <p className="muted">
            Relay stores only accept the sizes they declare — the size gate is what lets a
            clerk refuse a bulk drop.
          </p>

          <label htmlFor="autoRelist" style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <input id="autoRelist" type="checkbox" name="autoRelistOnRenege" defaultChecked />
            Relist automatically if a buyer doesn&apos;t pay
          </label>
        </fieldset>

        <button type="submit">Publish listing</button>
      </form>
    </main>
  );
}
