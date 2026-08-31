import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Inbox,
  LogOut,
  Package,
  ScanLine,
  Store as StoreIcon,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { auth } from '@/lib/auth';
import { requireStoreStaff, NotStoreStaffError } from '@/lib/store-session';
import { storeBoard, type StoreBoardRow } from '@/services/custody';
import {
  receiveByCodeAction,
  authorizeReleaseAction,
  markPickedUpAction,
  returnToSellerAction,
} from './actions';

export const dynamic = 'force-dynamic';

const SIZE_LABELS: Record<string, string> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
  oversized: 'oversized',
};

const SETTLED_LABELS: Record<string, string> = {
  picked_up: 'Collected by buyer',
  returned_to_seller: 'Returned to seller',
  voided: 'Never arrived — voided',
};

const SETTLED_WINDOW = 25;

async function signOut(): Promise<void> {
  'use server';
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}

function when(value: Date | null): string {
  return value === null ? '—' : value.toLocaleString('en-TT');
}

function settledAt(row: StoreBoardRow): Date {
  return row.pickedUpAt ?? row.returnedAt ?? row.updatedAt;
}

function heldFor(row: StoreBoardRow): string {
  if (row.daysHeld === null) return 'Not yet dropped off';
  if (row.daysHeld === 0) return 'Dropped off today';
  return row.daysHeld === 1 ? '1 day on the shelf' : `${row.daysHeld} days on the shelf`;
}

function Refusal({ children }: { children: React.ReactNode }) {
  return <p className="store-dashboard-alert store-dashboard-alert--error" role="alert"><AlertTriangle size={18} aria-hidden="true" />{children}</p>;
}

const DASHBOARD_VIEWS = ['overview', 'shelf', 'ready', 'expected', 'settled'] as const;
type DashboardView = (typeof DASHBOARD_VIEWS)[number];

function isDashboardView(value: string | undefined): value is DashboardView {
  return value !== undefined && DASHBOARD_VIEWS.includes(value as DashboardView);
}

export default async function StoreBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ refuse?: string; error?: string; ok?: string; view?: string }>;
}) {
  const { storeId } = await params;
  const flash = await searchParams;
  const activeView: DashboardView = isDashboardView(flash.view) ? flash.view : 'overview';

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
  const onShelf = rows.filter((row) => row.state === 'at_relay');
  const ready = rows.filter((row) => row.state === 'release_authorized');
  const settledAll = rows.filter((row) => ['picked_up', 'returned_to_seller', 'voided'].includes(row.state));
  const settled = [...settledAll].sort((a, b) => settledAt(b).getTime() - settledAt(a).getTime()).slice(0, SETTLED_WINDOW);
  const shelf = [...onShelf].sort((a, b) => {
    const aFlag = a.overstayFlaggedAt === null ? 1 : 0;
    const bFlag = b.overstayFlaggedAt === null ? 1 : 0;
    return aFlag - bFlag;
  });
  return (
    <main className="store-dashboard" data-dashboard-view={activeView}>
      <Link className="store-dashboard__back" href="/store"><ArrowLeft size={15} aria-hidden="true" /> All stores</Link>
      <header className="store-dashboard__header">
        <div className="store-dashboard__header-copy">
          <h1>{session.store.name}</h1>
          <p className="lede">Your custody dashboard for receiving, securing, and releasing collector items.</p>
        </div>
      </header>

      {flash.refuse !== undefined && <Refusal>{flash.refuse}</Refusal>}
      {flash.error !== undefined && <Refusal>{flash.error}</Refusal>}
      {flash.ok !== undefined && <p className="store-dashboard-alert store-dashboard-alert--success" role="status"><CheckCircle2 size={18} aria-hidden="true" />{flash.ok}</p>}

      <div className="store-dashboard__workspace">
      <nav className="store-dashboard-menu" aria-label="Store workspace sections">
        <p className="store-dashboard-menu__label">Workspace</p>
        <Link className={activeView === 'overview' ? 'is-active' : ''} href={`/store/${storeId}?view=overview`} aria-current={activeView === 'overview' ? 'page' : undefined}><StoreIcon size={17} aria-hidden="true" /><span>Overview<small>Dashboard</small></span></Link>
        <Link className={activeView === 'shelf' ? 'is-active' : ''} href={`/store/${storeId}?view=shelf`} aria-current={activeView === 'shelf' ? 'page' : undefined}><Package size={17} aria-hidden="true" /><span>On the shelf<small>{shelf.length} item{shelf.length === 1 ? '' : 's'}</small></span></Link>
        <Link className={activeView === 'ready' ? 'is-active' : ''} href={`/store/${storeId}?view=ready`} aria-current={activeView === 'ready' ? 'page' : undefined}><CheckCircle2 size={17} aria-hidden="true" /><span>Ready for collection<small>{ready.length} item{ready.length === 1 ? '' : 's'}</small></span></Link>
        <Link className={activeView === 'expected' ? 'is-active' : ''} href={`/store/${storeId}?view=expected`} aria-current={activeView === 'expected' ? 'page' : undefined}><Inbox size={17} aria-hidden="true" /><span>Expected arrivals<small>{expected.length} item{expected.length === 1 ? '' : 's'}</small></span></Link>
        <Link className={activeView === 'settled' ? 'is-active' : ''} href={`/store/${storeId}?view=settled`} aria-current={activeView === 'settled' ? 'page' : undefined}><Clock3 size={17} aria-hidden="true" /><span>Settled items<small>{settledAll.length} total</small></span></Link>
        <form className="store-dashboard-menu__signout" action={signOut}>
          <button type="submit"><LogOut size={17} aria-hidden="true" /> <span>Log out</span></button>
        </form>
      </nav>

      <div className="store-dashboard__content">
      <section className="store-dashboard__stats" aria-label="Store activity summary">
        <article className="store-dashboard-stat store-dashboard-stat--shelf"><div className="store-dashboard-stat__top"><div className="store-dashboard-stat__icon"><Package size={20} aria-hidden="true" /></div><h2 className="store-dashboard-stat__label">On the shelf</h2></div><strong>{onShelf.length}</strong></article>
        <article className="store-dashboard-stat store-dashboard-stat--ready"><div className="store-dashboard-stat__top"><div className="store-dashboard-stat__icon"><CheckCircle2 size={20} aria-hidden="true" /></div><h2 className="store-dashboard-stat__label">Ready for collection</h2></div><strong>{ready.length}</strong></article>
        <article className="store-dashboard-stat store-dashboard-stat--expected"><div className="store-dashboard-stat__top"><div className="store-dashboard-stat__icon"><Inbox size={20} aria-hidden="true" /></div><h2 className="store-dashboard-stat__label">Expected arrivals</h2></div><strong>{expected.length}</strong></article>
        <article className="store-dashboard-stat store-dashboard-stat--settled"><div className="store-dashboard-stat__top"><div className="store-dashboard-stat__icon"><Clock3 size={20} aria-hidden="true" /></div><h2 className="store-dashboard-stat__label">Settled items</h2></div><strong>{settledAll.length}</strong></article>
      </section>

      <div className="store-dashboard__top-grid">
        <section className="store-dashboard-panel store-dashboard-counter" aria-labelledby="counter-title">
          <div className="store-dashboard-panel__heading"><div><p className="section-label">Quick action</p><h2 id="counter-title"><ScanLine size={20} aria-hidden="true" /> At the counter</h2></div></div>
          <p>Enter the drop-off code shown by the seller. The system will only accept an item expected at this Store.</p>
          <form className="store-dashboard-counter__form" action={receiveByCodeAction}>
            <input type="hidden" name="storeId" value={storeId} />
            <input type="hidden" name="view" value={activeView} />
            <label htmlFor="code">Drop-off code</label>
            <div><input id="code" name="code" type="text" autoComplete="off" autoFocus={activeView === 'overview'} placeholder="e.g. CT-K4M9" required /><button type="submit">Receive item</button></div>
          </form>
          <p className="store-dashboard-panel__note">If it&apos;s not in the log, it doesn&apos;t belong here. Only accept a code the system recognises.</p>
        </section>
      </div>

      <div className="store-dashboard__views">
      <section id="shelf" className="store-dashboard-section" aria-labelledby="shelf-title">
        <div className="store-dashboard-section__heading"><div><p className="section-label">Active custody</p><h2 id="shelf-title">On the shelf <span>{shelf.length}</span></h2><p>Authorize release only after payment shows confirmed. The system will refuse otherwise.</p></div></div>
        {shelf.length === 0 ? <div className="store-dashboard-empty"><Package size={22} aria-hidden="true" /><strong>Nothing on the shelf</strong><span>Received items will appear here until they are collected or returned.</span></div> : <div className="store-dashboard-items">{shelf.map((row) => <article key={row.holdingId} className={`store-dashboard-item${row.overstayFlaggedAt !== null ? ' store-dashboard-item--warning' : ''}`}>
          <div className="store-dashboard-item__header"><div><h3>{row.listingTitle}</h3><div className="store-dashboard-item__tags"><span className="pill">{SIZE_LABELS[row.sizeClass] ?? row.sizeClass}</span><span className="pill">Code {row.dropoffCode}</span><span className={`pill ${row.paid ? 'store-dashboard-pill--paid' : 'store-dashboard-pill--unpaid'}`}>{row.paid ? 'Payment confirmed' : 'Payment pending'}</span></div></div>{row.overstayFlaggedAt !== null ? <span className="store-dashboard-item__warning"><AlertTriangle size={14} aria-hidden="true" /> Overstay</span> : null}</div>
          <p className="store-dashboard-item__meta">{heldFor(row)} · seller {row.sellerName} · buyer {row.buyerName ?? 'none right now'} · due out {when(row.custodyExpiresAt)}</p>
          {row.overstayFlaggedAt !== null ? <p className="store-dashboard-item__notice" role="alert">Past its collection window since {when(row.overstayFlaggedAt)}. Call the owner on <strong>{row.ownerContact}</strong>, then return it to the seller.</p> : null}
          <div className="store-dashboard-item__actions">{row.paid ? <form action={authorizeReleaseAction}><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="holdingId" value={row.holdingId} /><input type="hidden" name="view" value={activeView} /><button type="submit">Authorize release</button></form> : <p>Payment not confirmed — do not hand this over.</p>}<form action={returnToSellerAction}><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="holdingId" value={row.holdingId} /><input type="hidden" name="view" value={activeView} /><input type="text" name="reason" placeholder="Reason (optional)" maxLength={200} aria-label={`Reason for returning ${row.listingTitle} to the seller`} /><button className="secondary" type="submit">Return to seller</button></form></div>
        </article>)}</div>}
      </section>

      <div className="store-dashboard__lower-grid">
        <section id="ready" className="store-dashboard-section" aria-labelledby="ready-title"><div className="store-dashboard-section__heading"><div><p className="section-label">Payment cleared</p><h2 id="ready-title">Ready for collection <span>{ready.length}</span></h2><p>Check the buyer&apos;s code, hand over the item, and mark it picked up.</p></div></div>{ready.length === 0 ? <div className="store-dashboard-empty"><CheckCircle2 size={22} aria-hidden="true" /><strong>Nothing waiting to be collected</strong><span>Cleared items will appear here.</span></div> : <div className="store-dashboard-items">{ready.map((row) => <article key={row.holdingId} className="store-dashboard-item"><div className="store-dashboard-item__header"><div><h3>{row.listingTitle}</h3><div className="store-dashboard-item__tags"><span className="pill">Buyer code {row.dropoffCode}</span><span className="pill store-dashboard-pill--paid">Payment confirmed</span></div></div></div><p className="store-dashboard-item__meta">buyer {row.buyerName ?? 'unknown'} · seller {row.sellerName} · {heldFor(row)} · due out {when(row.custodyExpiresAt)}</p><div className="store-dashboard-item__actions"><form action={markPickedUpAction}><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="holdingId" value={row.holdingId} /><input type="hidden" name="view" value={activeView} /><button type="submit">Mark picked up</button></form><form action={returnToSellerAction}><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="holdingId" value={row.holdingId} /><input type="hidden" name="view" value={activeView} /><input type="text" name="reason" placeholder="Reason (optional)" maxLength={200} aria-label={`Reason for returning ${row.listingTitle} to the seller`} /><button className="secondary" type="submit">Return to seller</button></form></div></article>)}</div>}</section>
        <section id="expected" className="store-dashboard-section" aria-labelledby="expected-title"><div className="store-dashboard-section__heading"><div><p className="section-label">Incoming</p><h2 id="expected-title">Expected arrivals <span>{expected.length}</span></h2><p>Use the code to verify the item at the counter.</p></div></div>{expected.length === 0 ? <div className="store-dashboard-empty"><Inbox size={22} aria-hidden="true" /><strong>Nothing expected</strong><span>New Store drop-offs will appear here.</span></div> : <div className="store-dashboard-table-wrap"><table className="store-dashboard-table"><thead><tr><th>Code</th><th>Item</th><th>Seller</th><th>Size</th></tr></thead><tbody>{expected.map((row) => <tr key={row.holdingId}><td><strong>{row.dropoffCode}</strong></td><td>{row.listingTitle}</td><td>{row.sellerName}</td><td>{SIZE_LABELS[row.sizeClass] ?? row.sizeClass}</td></tr>)}</tbody></table></div>}</section>
      </div>

      <section id="settled" className="store-dashboard-section" aria-labelledby="settled-title"><div className="store-dashboard-section__heading"><div><p className="section-label">Audit trail</p><h2 id="settled-title">Recently settled</h2><p>{settledAll.length > settled.length ? `Showing the last ${SETTLED_WINDOW} of ${settledAll.length} settled items — newest first.` : 'Everything this Store has settled — newest first.'}</p></div></div>{settled.length === 0 ? <div className="store-dashboard-empty"><Clock3 size={22} aria-hidden="true" /><strong>Nothing settled yet</strong><span>Completed pickups and returns will appear here.</span></div> : <div className="store-dashboard-table-wrap"><table className="store-dashboard-table"><thead><tr><th>Settled</th><th>Item</th><th>Outcome</th><th>Code</th><th>Seller</th><th>Buyer</th></tr></thead><tbody>{settled.map((row) => <tr key={row.holdingId}><td className="muted">{when(settledAt(row))}</td><td>{row.listingTitle}</td><td>{SETTLED_LABELS[row.state] ?? row.state.replace(/_/g, ' ')}</td><td className="muted">{row.dropoffCode}</td><td className="muted">{row.sellerName}</td><td className="muted">{row.buyerName ?? '—'}</td></tr>)}</tbody></table></div>}</section>
      </div>
      </div>
      </div>
    </main>
  );
}
