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
import { SaleTypeFields } from './sale-type-fields';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, { title: string; detail: string }> = {
  cash_meetup: { title: 'Public meetup', detail: 'Arrange a safe, public handoff with the buyer.' },
  remote_ship: { title: 'Ship to buyer', detail: 'Buyer pays directly and you arrange shipping.' },
  relay: { title: 'Store drop-off', detail: 'A participating store holds the item for collection.' },
  full_service: { title: 'Full-service delivery', detail: 'CollectTT coordinates pickup and delivery.' },
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  linx: 'LINX',
  other: 'Other',
};

function collectAttributes(categoryKey: string, formData: FormData): Record<string, unknown> {
  const definition = getCategory(categoryKey);
  const attributes: Record<string, unknown> = {};

  for (const attribute of definition.attributes) {
    const raw = formData.get(`attr__${attribute.key}`);

    if (attribute.type === 'boolean') {
      if (raw !== null) attributes[attribute.key] = true;
      continue;
    }
    if (raw === null || String(raw).trim() === '') continue;
    if (attribute.type === 'number' || attribute.type === 'year') {
      const number = Number(raw);
      if (Number.isFinite(number)) attributes[attribute.key] = number;
      continue;
    }
    attributes[attribute.key] = String(raw).trim();
  }

  return attributes;
}

async function create(formData: FormData): Promise<void> {
  'use server';

  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const category = String(formData.get('category') ?? '');
  const saleType = String(formData.get('saleType') ?? 'straight_sale');
  const money = (field: string): number | undefined => {
    const raw = String(formData.get(field) ?? '').trim();
    return raw === '' ? undefined : parseMoneyInput(raw) ?? undefined;
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
    durationHours: saleType === 'auction' ? Number(formData.get('durationHours') ?? 48) : undefined,
    fulfillmentPaths: formData.getAll('fulfillmentPaths').map(String),
    settlementMethods: formData.getAll('settlementMethods').map(String),
    relayStoreIds: formData.getAll('relayStoreIds').map(String),
    sizeClass: String(formData.get('sizeClass') ?? 'small'),
    autoRelistOnRenege: formData.get('autoRelistOnRenege') !== null,
    imageIds: [],
    attributes: collectAttributes(category, formData),
  };

  try {
    const listing = await createListing(user.userId, input, { publish: true });
    redirect(`/listings/${listing.id}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' | ');
      redirect(`/listings/new?error=${encodeURIComponent(detail)}`);
    }
    throw error;
  }
}

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  const { error } = await searchParams;

  if (user === null) {
    return (
      <main className="create-page">
        <div className="create-auth-gate">
          <img src="/assets/collecttt_logo.png" alt="CollectTT" />
          <h1>Sign in to create a listing</h1>
          <p>Your account connects the listing to your reputation and active deals.</p>
          <Link className="button" href="/sign-in?redirectTo=/listings/new">Sign in to continue</Link>
        </div>
      </main>
    );
  }

  const relayStoreOptions = await listRelayStores(db);

  return (
    <main className="create-page">
      <Link className="create-back" href="/listings">← Back to listings</Link>
      <header className="create-header">
        <div>
          <h1>Create a listing</h1>
          <p>Give collectors the essentials, choose how the sale works, and publish when everything looks right.</p>
        </div>
        <img src="/assets/collecttt_logo.png" alt="" aria-hidden="true" />
      </header>

      <ol className="create-progress" aria-label="Listing creation steps">
        <li><span>1</span><strong>Item details</strong></li>
        <li><span>2</span><strong>Sale format</strong></li>
        <li><span>3</span><strong>Handoff</strong></li>
        <li><span>4</span><strong>Publish</strong></li>
      </ol>

      {error !== undefined && <div className="create-error" role="alert"><strong>Check your listing</strong><span>{error}</span></div>}

      <form action={create} className="create-listing-form">
        <fieldset className="create-section">
          <legend>What are you listing?</legend>
          <p className="create-section__intro">Use a clear title and include condition, important flaws, and everything included in the description.</p>
          <div className="form-field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" type="text" required minLength={3} maxLength={160} placeholder="e.g. Pokémon Base Set Charizard" />
          </div>
          <div className="form-field">
            <label htmlFor="description">Description</label>
            <textarea id="description" name="description" required maxLength={4000} rows={6} placeholder="Describe the item, its condition, and anything the buyer should know." />
            <small className="field-help">Be specific—good descriptions reduce questions and build buyer confidence.</small>
          </div>
          <AttributeFields categories={[...CATEGORY_LIST]} />
        </fieldset>

        <SaleTypeFields />

        <fieldset className="create-section">
          <legend>Delivery and payment</legend>
          <p className="create-section__intro">Choose every option you can complete. The buyer selects one when claiming, bidding, or making an offer.</p>

          <div className="create-group">
            <h3>Delivery options</h3>
            <div className="choice-grid">
              {FULFILLMENT_PATHS.filter((path) => path !== 'full_service').map((path) => (
                <label className="choice-card" key={path} htmlFor={`path_${path}`}>
                  <input id={`path_${path}`} type="checkbox" name="fulfillmentPaths" value={path} defaultChecked={path === 'cash_meetup'} />
                  <span><strong>{PATH_LABELS[path]?.title}</strong><small>{PATH_LABELS[path]?.detail}</small></span>
                </label>
              ))}
            </div>
          </div>

          {relayStoreOptions.length > 0 && (
            <div className="create-group">
              <h3>Store drop-off locations</h3>
              <p>Select every store you are willing to use. This is required when Store drop-off is selected.</p>
              <div className="choice-grid choice-grid--stores">
                {relayStoreOptions.map((store) => (
                  <label className="choice-card" key={store.id} htmlFor={`store_${store.id}`}>
                    <input id={`store_${store.id}`} type="checkbox" name="relayStoreIds" value={store.id} />
                    <span><strong>{store.name}</strong><small>{store.area}</small></span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="create-group">
            <h3>Accepted payment methods</h3>
            <div className="choice-grid choice-grid--payments">
              {SETTLEMENT_METHODS.map((method) => (
                <label className="choice-card choice-card--compact" key={method} htmlFor={`pay_${method}`}>
                  <input id={`pay_${method}`} type="checkbox" name="settlementMethods" value={method} defaultChecked={method === 'cash'} />
                  <span><strong>{PAYMENT_LABELS[method] ?? method.replace('_', ' ')}</strong></span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-grid form-grid--two create-final-options">
            <div className="form-field">
              <label htmlFor="sizeClass">Item size</label>
              <select id="sizeClass" name="sizeClass" defaultValue="small">
                {SIZE_CLASSES.map((size) => <option key={size} value={size}>{size.charAt(0).toUpperCase() + size.slice(1)}</option>)}
              </select>
              <small className="field-help">Stores use this to confirm they can safely hold the item.</small>
            </div>
            <label className="auto-relist" htmlFor="autoRelist">
              <input id="autoRelist" type="checkbox" name="autoRelistOnRenege" defaultChecked />
              <span><strong>Automatically relist</strong><small>Return the listing to the marketplace if a buyer does not pay.</small></span>
            </label>
          </div>
        </fieldset>

        <div className="create-submit">
          <div><strong>Ready to publish?</strong><span>Your listing becomes visible to collectors immediately.</span></div>
          <button type="submit">Publish listing</button>
        </div>
      </form>
    </main>
  );
}
