import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  History,
  Inbox,
  List,
  LogOut,
  MapPin,
  Package,
  ScanLine,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { auth } from '@/lib/auth';
import { requireStoreStaff, NotStoreStaffError } from '@/lib/store-session';
import { storeBoard, type StoreBoardRow } from '@/services/custody';
import {
  lookupByCodeAction,
  receiveByCodeAction,
  releaseItemAction,
  returnToSellerAction,
} from './actions';

export const dynamic = 'force-dynamic';

const SETTLED_LABELS: Record<string, string> = {
  picked_up: 'Released to buyer',
  returned_to_seller: 'Returned to seller',
  voided: 'Never arrived — closed',
};

const COUNTER_MODES = ['receive', 'release'] as const;
type CounterMode = (typeof COUNTER_MODES)[number];

function isCounterMode(value: string | undefined): value is CounterMode {
  return value !== undefined && COUNTER_MODES.includes(value as CounterMode);
}

function when(value: Date | null): string {
  return value === null ? '—' : value.toLocaleString('en-TT', { dateStyle: 'medium', timeStyle: 'short' });
}

function heldFor(row: StoreBoardRow): string {
  if (row.daysHeld === null) return 'Expected arrival';
  if (row.daysHeld === 0) return 'Today';
  return row.daysHeld === 1 ? '1 day held' : `${row.daysHeld} days held`;
}

function today(): string {
  return new Date().toLocaleDateString('en-TT', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function signOut(): Promise<void> {
  'use server';
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}

function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <p className="store-counter-alert store-counter-alert--error" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function ItemImage({ row }: { row: StoreBoardRow }) {
  return (
    <div className="store-counter-result__image">
      {row.primaryImageId ? (
        <img src={`/api/images/${row.primaryImageId}?variant=card`} alt="" />
      ) : (
        <Package size={30} aria-hidden="true" />
      )}
    </div>
  );
}

function PaymentBadge({ paid }: { paid: boolean }) {
  return (
    <span className={`store-counter-badge ${paid ? 'store-counter-badge--paid' : 'store-counter-badge--unpaid'}`}>
      {paid ? <CheckCircle2 size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
      {paid ? 'Payment confirmed' : 'Payment pending'}
    </span>
  );
}

function ResultAction({ row, mode, storeId }: { row: StoreBoardRow; mode: CounterMode; storeId: string }) {
  if (row.state === 'awaiting_dropoff') {
    return mode === 'receive' ? (
      <form action={receiveByCodeAction}>
        <input type="hidden" name="storeId" value={storeId} />
        <input type="hidden" name="code" value={row.dropoffCode} />
        <input type="hidden" name="mode" value="receive" />
        <button className="store-counter-primary-action" type="submit">Receive item</button>
      </form>
    ) : (
      <p className="store-counter-action-note store-counter-action-note--neutral">
        This item is waiting for the seller to drop it off. Switch to Receive to accept it.
      </p>
    );
  }

  if (row.state === 'at_relay' || row.state === 'release_authorized') {
    if (mode !== 'release') {
      return <p className="store-counter-action-note store-counter-action-note--neutral">Already received. Switch to Release when the buyer arrives.</p>;
    }

    if (!row.paid) {
      return (
        <div className="store-counter-release-block">
          <p className="store-counter-action-note store-counter-action-note--danger" role="alert">
            Payment not confirmed — do not release this item.
          </p>
          <button className="store-counter-primary-action" type="button" disabled>Release item</button>
        </div>
      );
    }

    return (
      <form action={releaseItemAction}>
        <input type="hidden" name="storeId" value={storeId} />
        <input type="hidden" name="holdingId" value={row.holdingId} />
        <button className="store-counter-primary-action" type="submit">Release item</button>
      </form>
    );
  }

  if (row.state === 'picked_up') {
    return <p className="store-counter-action-note store-counter-action-note--success">Already released to the buyer.</p>;
  }

  return <p className="store-counter-action-note store-counter-action-note--neutral">This item is no longer active at the Store.</p>;
}

export default async function StoreBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ refuse?: string; error?: string; ok?: string; mode?: string; lookup?: string }>;
}) {
  const { storeId } = await params;
  const flash = await searchParams;
  const mode: CounterMode = isCounterMode(flash.mode) ? flash.mode : 'release';

  if ((await currentUser()) === null) redirect('/sign-in');

  let session;
  try {
    session = await requireStoreStaff(storeId);
  } catch (error) {
    if (error instanceof NotStoreStaffError) redirect('/store');
    throw error;
  }

  const rows = await storeBoard(db, storeId);
  const expected = rows.filter((row) => row.state === 'awaiting_dropoff');
  const onShelf = rows.filter((row) => row.state === 'at_relay' || row.state === 'release_authorized');
  const settled = rows
    .filter((row) => ['picked_up', 'returned_to_seller', 'voided'].includes(row.state))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 25);
  const matched = flash.lookup === undefined ? null : rows.find((row) => row.holdingId === flash.lookup) ?? null;

  return (
    <main className="store-counter-page" id="top">
      <Link className="store-counter-back" href="/store"><ArrowLeft size={15} aria-hidden="true" /> All stores</Link>

      <header className="store-counter-header">
        <div>
          <p className="store-counter-eyebrow">Store counter</p>
          <h1>{session.store.name}</h1>
          <p className="store-counter-lede">Scan or enter a code to receive or release an item.</p>
        </div>
        <time dateTime={new Date().toISOString()}>{today()}</time>
      </header>

      {flash.refuse !== undefined && <Refusal>{flash.refuse}</Refusal>}
      {flash.error !== undefined && <Refusal>{flash.error}</Refusal>}
      {flash.ok !== undefined && (
        <p className="store-counter-alert store-counter-alert--success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" /><span>{flash.ok}</span>
        </p>
      )}

      <div className="store-counter-layout">
        <div className="store-counter-main">
          <section className="store-counter-panel store-counter-lookup" aria-label="Find an item to receive or release">
            <nav className="store-counter-mode" aria-label="Counter action">
              <Link className={mode === 'receive' ? 'is-active' : ''} href={`/store/${storeId}?mode=receive`} aria-current={mode === 'receive' ? 'page' : undefined}>
                <Package size={22} aria-hidden="true" /><span><strong>Receive item</strong><small>Item from seller to Store</small></span>
              </Link>
              <Link className={mode === 'release' ? 'is-active' : ''} href={`/store/${storeId}?mode=release`} aria-current={mode === 'release' ? 'page' : undefined}>
                <Inbox size={22} aria-hidden="true" /><span><strong>Release item</strong><small>Item from Store to buyer</small></span>
              </Link>
            </nav>

            <form className="store-counter-lookup__form" action={lookupByCodeAction}>
              <input type="hidden" name="storeId" value={storeId} />
              <input type="hidden" name="mode" value={mode} />
              <label htmlFor="counter-code">{mode === 'receive' ? 'Drop-off code' : 'Buyer collection code'}</label>
              <div className="store-counter-code-entry">
                <ScanLine size={24} aria-hidden="true" />
                <input id="counter-code" name="code" type="text" autoComplete="off" autoCapitalize="characters" placeholder="e.g. CT-K4M9" autoFocus required />
                <button type="submit">Find item</button>
              </div>
              <p>Scan the code or type it manually.</p>
            </form>
          </section>

          <section className="store-counter-result" aria-live="polite" aria-labelledby="matched-item-title">
            <div className="store-counter-section-kicker">Matched item</div>
            {matched === null ? (
              <div className="store-counter-result__empty">
                <ScanLine size={28} aria-hidden="true" />
                <div><strong>Enter a code to see the item</strong><p>We&apos;ll show the next safe action here.</p></div>
              </div>
            ) : (
              <>
                <div className="store-counter-result__body">
                  <ItemImage row={matched} />
                  <div className="store-counter-result__title">
                    <h2 id="matched-item-title">{matched.listingTitle}</h2>
                    <div className="store-counter-result__badges">
                      <span className="store-counter-code-pill">Code {matched.dropoffCode}</span>
                      <PaymentBadge paid={matched.paid} />
                    </div>
                  </div>
                </div>
                <div className="store-counter-facts">
                  <div><MapPin size={18} aria-hidden="true" /><span><small>Shelf location</small><strong>{matched.state === 'awaiting_dropoff' ? 'Incoming' : 'On shelf'}</strong></span></div>
                  <div><UserRound size={18} aria-hidden="true" /><span><small>{matched.state === 'awaiting_dropoff' ? 'Seller' : 'Buyer'}</small><strong>{matched.state === 'awaiting_dropoff' ? matched.sellerName : matched.buyerName ?? 'Not assigned'}</strong></span></div>
                  <div><ShieldCheck size={18} aria-hidden="true" /><span><small>{matched.state === 'awaiting_dropoff' ? 'Drop-off' : 'Held for'}</small><strong>{matched.state === 'awaiting_dropoff' ? 'Expected here' : heldFor(matched)}</strong></span></div>
                </div>
                <div className="store-counter-result__action">
                  <div>
                    {matched.state === 'at_relay' || matched.state === 'release_authorized' ? (
                      <p>Verify the buyer&apos;s name, then hand over the item.</p>
                    ) : matched.state === 'awaiting_dropoff' ? (
                      <p>Check the seller&apos;s item against this record before receiving it.</p>
                    ) : (
                      <p>{SETTLED_LABELS[matched.state] ?? 'No action needed.'}</p>
                    )}
                  </div>
                  <ResultAction row={matched} mode={mode} storeId={storeId} />
                </div>
              </>
            )}
          </section>
        </div>

        <aside className="store-counter-summary" aria-label="Store inventory summary">
          <p className="store-counter-section-kicker">Store inventory</p>
          <div className="store-counter-summary__stat"><span className="store-counter-summary__icon store-counter-summary__icon--shelf"><Package size={22} aria-hidden="true" /></span><span><strong>{onShelf.length}</strong><small>on shelf</small></span></div>
          <div className="store-counter-summary__stat"><span className="store-counter-summary__icon store-counter-summary__icon--expected"><Inbox size={22} aria-hidden="true" /></span><span><strong>{expected.length}</strong><small>expected</small></span></div>
          <div className="store-counter-summary__links">
            <a href="#inventory"><List size={19} aria-hidden="true" /> Inventory <ChevronRight size={16} aria-hidden="true" /></a>
            <a href="#history"><History size={19} aria-hidden="true" /> History <ChevronRight size={16} aria-hidden="true" /></a>
          </div>
        </aside>
      </div>

      <section id="inventory" className="store-counter-list-section" aria-labelledby="inventory-title">
        <div className="store-counter-list-heading"><div><p className="store-counter-section-kicker">Active custody</p><h2 id="inventory-title">Items on shelf <span>{onShelf.length}</span></h2></div><a href="#top">Back to counter</a></div>
        {onShelf.length === 0 ? (
          <div className="store-counter-list-empty"><Package size={22} aria-hidden="true" /><span><strong>Nothing on the shelf</strong><small>Received items will appear here.</small></span></div>
        ) : (
          <div className="store-counter-list">
            {onShelf.map((row) => (
              <article className="store-counter-list-row" key={row.holdingId}>
                <ItemImage row={row} />
                <div className="store-counter-list-row__copy"><h3>{row.listingTitle}</h3><p>{row.buyerName ?? 'Buyer not assigned'} · {heldFor(row)}</p></div>
                <PaymentBadge paid={row.paid} />
                <div className="store-counter-list-row__actions">
                  {row.paid ? <form action={releaseItemAction}><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="holdingId" value={row.holdingId} /><button type="submit">Release</button></form> : <span className="store-counter-list-row__hold">Keep on shelf</span>}
                  <form action={returnToSellerAction}><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="holdingId" value={row.holdingId} /><input type="hidden" name="view" value="overview" /><button className="store-counter-quiet-action" type="submit">Return</button></form>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="store-counter-incoming" aria-labelledby="incoming-title">
        <div className="store-counter-list-heading"><div><p className="store-counter-section-kicker">Incoming</p><h2 id="incoming-title">Expected arrivals <span>{expected.length}</span></h2></div></div>
        {expected.length === 0 ? <p className="store-counter-muted">No expected arrivals.</p> : <div className="store-counter-incoming__list">{expected.map((row) => <div key={row.holdingId}><strong>{row.dropoffCode}</strong><span>{row.listingTitle}</span><small>{row.sellerName}</small></div>)}</div>}
      </section>

      <section id="history" className="store-counter-history" aria-labelledby="history-title">
        <div className="store-counter-list-heading"><div><p className="store-counter-section-kicker">Audit trail</p><h2 id="history-title">History</h2></div><span className="store-counter-muted">Newest first</span></div>
        {settled.length === 0 ? <p className="store-counter-muted">Completed releases and returns will appear here.</p> : <div className="store-counter-history__table-wrap"><table><thead><tr><th>Item</th><th>Outcome</th><th>When</th></tr></thead><tbody>{settled.map((row) => <tr key={row.holdingId}><td>{row.listingTitle}</td><td>{SETTLED_LABELS[row.state] ?? row.state.replace(/_/g, ' ')}</td><td>{when(row.updatedAt)}</td></tr>)}</tbody></table></div>}
      </section>

      <form className="store-counter-signout" action={signOut}><button type="submit"><LogOut size={16} aria-hidden="true" /> Log out</button></form>
    </main>
  );
}
