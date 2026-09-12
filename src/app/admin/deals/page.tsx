import Link from 'next/link';
import { and, count, desc, eq, ilike, isNotNull, lt, or, sql } from 'drizzle-orm';
import { Activity, Search } from 'lucide-react';

import { db } from '@/db/client';
import { listings } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { formatMoney } from '@/domain/money';
import { TRANSACTION_STATES, type TransactionState } from '@/domain/states/transaction';
import { adminAccess } from '@/lib/admin';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';

const PAGE_SIZE = 20;

function pageNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function date(value: Date | null): string {
  return value === null ? '—' : value.toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): string {
  if (status === 'open' || status === 'completed') return status === 'open' ? 'active' : 'confirmed';
  if (status === 'reneged_buyer' || status === 'reneged_seller' || status === 'cancelled' || status === 'expired') return 'declined';
  return 'ended';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function amount(cents: number, currency: string): string {
  return formatMoney(cents, currency === 'USD' ? 'USD' : 'TTD');
}

export default async function AdminDealsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; state?: string; deadline?: string }> }) {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 80);
  const requestedPage = pageNumber(params.page);
  const selectedState = TRANSACTION_STATES.includes(params.state as TransactionState) ? params.state as TransactionState : 'all';
  const selectedDeadline = params.deadline === 'overdue' ? 'overdue' : 'all';
  const search = `%${query}%`;
  const now = new Date();
  const searchParts = [
    ilike(listings.title, search),
    sql`exists (select 1 from profiles seller_search where seller_search.user_id = ${transactions.sellerId} and (seller_search.display_name ilike ${search} or seller_search.handle ilike ${search}))`,
    sql`exists (select 1 from profiles buyer_search where buyer_search.user_id = ${transactions.buyerId} and (buyer_search.display_name ilike ${search} or buyer_search.handle ilike ${search}))`,
    ...(isUuid(query) ? [eq(transactions.id, query)] : []),
  ];
  const overdueFilter = and(
    eq(transactions.state, 'open'),
    or(
      lt(transactions.paymentDeadlineAt, now),
      and(isNotNull(transactions.sellerDropoffDeadlineAt), lt(transactions.sellerDropoffDeadlineAt, now)),
    ),
  );
  const filter = and(
    selectedState === 'all' ? undefined : eq(transactions.state, selectedState),
    selectedDeadline === 'overdue' ? overdueFilter : undefined,
    query === '' ? undefined : or(...searchParts),
  );

  const totalRows = await db
    .select({ value: count() })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .where(filter);
  const total = Number(totalRows[0]?.value ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const dealRows = await db
    .select({
      id: transactions.id,
      listingId: transactions.listingId,
      listingTitle: listings.title,
      sellerId: transactions.sellerId,
      sellerName: sql<string>`(select p.display_name from profiles p where p.user_id = ${transactions.sellerId})`,
      buyerId: transactions.buyerId,
      buyerName: sql<string>`(select p.display_name from profiles p where p.user_id = ${transactions.buyerId})`,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      source: transactions.source,
      attemptNumber: transactions.attemptNumber,
      state: transactions.state,
      paymentState: transactions.paymentState,
      custodyState: transactions.custodyState,
      paymentDeadlineAt: transactions.paymentDeadlineAt,
      sellerDropoffDeadlineAt: transactions.sellerDropoffDeadlineAt,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .where(filter)
    .orderBy(desc(transactions.updatedAt), desc(transactions.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query !== '') next.set('q', query);
    if (selectedState !== 'all') next.set('state', selectedState);
    if (selectedDeadline !== 'all') next.set('deadline', selectedDeadline);
    if (nextPage > 1) next.set('page', String(nextPage));
    const encoded = next.toString();
    return encoded === '' ? '/admin/deals' : `/admin/deals?${encoded}`;
  };

  return (
    <AdminFrame activeNav="deals">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div>
            <p className="admin-kicker">Admin workspace</p>
            <h1>Deals</h1>
            <p>Review payment, custody, deadlines, and support context before any intervention.</p>
          </div>
          <span className="admin-environment">Read-only</span>
        </div>

        <section className="admin-panel admin-directory-panel" aria-labelledby="deals-directory-title">
          <div className="admin-panel__heading">
            <div>
              <h2 id="deals-directory-title">Deal directory</h2>
              <p className="admin-panel__subcopy">{total.toLocaleString()} deal attempt{total === 1 ? '' : 's'}{query === '' ? '' : ` matching “${query}”`}</p>
            </div>
            <Activity size={19} aria-hidden="true" />
          </div>

          <form className="admin-directory-search admin-deal-search" method="get" role="search">
            <label htmlFor="deal-search">Search deals</label>
            <div>
              <Search size={16} aria-hidden="true" />
              <input id="deal-search" name="q" type="search" defaultValue={query} placeholder="Transaction ID, listing, buyer, or seller" autoComplete="off" />
              <label className="sr-only" htmlFor="deal-state">Filter by deal state</label>
              <select id="deal-state" name="state" defaultValue={selectedState}>
                <option value="all">All states</option>
                {TRANSACTION_STATES.map((state) => <option key={state} value={state}>{label(state)}</option>)}
              </select>
              <label className="sr-only" htmlFor="deal-deadline">Filter by deadline</label>
              <select id="deal-deadline" name="deadline" defaultValue={selectedDeadline}>
                <option value="all">Any deadline</option>
                <option value="overdue">Overdue open deals</option>
              </select>
              <button className="admin-button" type="submit">Search</button>
            </div>
          </form>

          {dealRows.length === 0 ? (
            <div className="admin-directory-empty" role="status">
              <Activity size={22} aria-hidden="true" />
              <strong>{query === '' && selectedState === 'all' && selectedDeadline === 'all' ? 'No deals yet' : 'No deals found'}</strong>
              <p>{query === '' && selectedState === 'all' && selectedDeadline === 'all' ? 'Transaction attempts will appear here as members complete marketplace actions.' : 'Try a different search term or support filter.'}</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-directory-table admin-deal-table">
                <caption className="sr-only">Deal directory</caption>
                <thead>
                  <tr><th scope="col">Deal</th><th scope="col">Buyer</th><th scope="col">Seller</th><th scope="col">Amount</th><th scope="col">State tracks</th><th scope="col">Deadlines</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {dealRows.map((deal) => (
                    <tr key={deal.id}>
                      <th scope="row"><Link className="admin-row-link" href={`/admin/deals/${encodeURIComponent(deal.id)}`}>{deal.listingTitle}</Link><small>{deal.id} · Attempt {deal.attemptNumber} · {label(deal.source)}</small></th>
                      <td><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(deal.buyerId)}`}>{deal.buyerName}</Link><small>{deal.buyerId}</small></td>
                      <td><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(deal.sellerId)}`}>{deal.sellerName}</Link><small>{deal.sellerId}</small></td>
                      <td>{amount(deal.amountCents, deal.currency)}</td>
                      <td><span className={`admin-status admin-status--${statusTone(deal.state)}`}>{label(deal.state)}</span><small>Payment: {label(deal.paymentState)}<br />Custody: {label(deal.custodyState)}</small></td>
                      <td><span className={deal.state === 'open' && deal.paymentDeadlineAt < now ? 'admin-deadline admin-deadline--overdue' : 'admin-deadline'}>Payment {date(deal.paymentDeadlineAt)}</span><small>{deal.sellerDropoffDeadlineAt === null ? 'No drop-off deadline' : `Drop-off ${date(deal.sellerDropoffDeadlineAt)}`}</small></td>
                      <td><Link className="admin-row-link" href={`/admin/deals/${encodeURIComponent(deal.id)}`}>View deal</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <nav className="admin-pagination" aria-label="Deal directory pages">
            <span>Page {page} of {pageCount}</span>
            <div>
              {page <= 1 ? <span className="admin-button admin-button--secondary is-disabled" aria-disabled="true">Previous</span> : <Link className="admin-button admin-button--secondary" href={buildHref(page - 1)}>Previous</Link>}
              {page >= pageCount ? <span className="admin-button admin-button--secondary is-disabled" aria-disabled="true">Next</span> : <Link className="admin-button admin-button--secondary" href={buildHref(page + 1)}>Next</Link>}
            </div>
          </nav>
        </section>
      </main>
    </AdminFrame>
  );
}
