import Link from 'next/link';
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';
import { ClipboardList, Search } from 'lucide-react';

import { db } from '@/db/client';
import { categories, listings } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { formatMoney } from '@/domain/money';
import { LISTING_STATUSES, type ListingStatus } from '@/domain/states/listing';
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
  if (status === 'active') return 'active';
  if (status === 'cancelled' || status === 'expired' || status === 'ended_no_sale') return 'ended';
  return status === 'claimed' || status === 'ended_won' ? 'confirmed' : 'draft';
}

function amount(row: { saleType: string; currency: string; priceCents: number | null; currentBidCents: number | null; startBidCents: number | null }): string {
  const cents = row.saleType === 'auction' ? row.currentBidCents ?? row.startBidCents : row.priceCents;
  if (cents === null) return '—';
  return formatMoney(cents, row.currency === 'USD' ? 'USD' : 'TTD');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function AdminListingsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; status?: string }> }) {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 80);
  const requestedPage = pageNumber(params.page);
  const selectedStatus = LISTING_STATUSES.includes(params.status as ListingStatus) ? params.status as ListingStatus : 'all';
  const search = `%${query}%`;
  const searchParts = [
    ilike(listings.title, search),
    ilike(profiles.displayName, search),
    ilike(profiles.handle, search),
    ilike(categories.label, search),
    ...(isUuid(query) ? [eq(listings.id, query)] : []),
  ];
  const filter = and(
    selectedStatus === 'all' ? undefined : eq(listings.status, selectedStatus),
    query === '' ? undefined : or(...searchParts),
  );

  const totalRows = await db
    .select({ value: count() })
    .from(listings)
    .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
    .innerJoin(categories, eq(categories.key, listings.category))
    .where(filter);
  const total = Number(totalRows[0]?.value ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const listingRows = await db
    .select({
      id: listings.id,
      title: listings.title,
      sellerId: profiles.userId,
      sellerName: profiles.displayName,
      sellerHandle: profiles.handle,
      category: categories.label,
      saleType: listings.saleType,
      status: listings.status,
      currency: listings.currency,
      priceCents: listings.priceCents,
      currentBidCents: listings.currentBidCents,
      startBidCents: listings.startBidCents,
      publishedAt: listings.publishedAt,
      createdAt: listings.createdAt,
      endsAt: listings.endsAt,
    })
    .from(listings)
    .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
    .innerJoin(categories, eq(categories.key, listings.category))
    .where(filter)
    .orderBy(desc(listings.updatedAt), desc(listings.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query !== '') next.set('q', query);
    if (selectedStatus !== 'all') next.set('status', selectedStatus);
    if (nextPage > 1) next.set('page', String(nextPage));
    const encoded = next.toString();
    return encoded === '' ? '/admin/listings' : `/admin/listings?${encoded}`;
  };

  return (
    <AdminFrame activeNav="listings">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div>
            <p className="admin-kicker">Admin workspace</p>
            <h1>Listings</h1>
            <p>Review inventory, seller context, and deal activity before any intervention.</p>
          </div>
          <span className="admin-environment">Read-only</span>
        </div>

        <section className="admin-panel admin-directory-panel" aria-labelledby="listings-directory-title">
          <div className="admin-panel__heading">
            <div>
              <h2 id="listings-directory-title">Listing directory</h2>
              <p className="admin-panel__subcopy">{total.toLocaleString()} listing{total === 1 ? '' : 's'}{query === '' ? '' : ` matching “${query}”`}</p>
            </div>
            <ClipboardList size={19} aria-hidden="true" />
          </div>

          <form className="admin-directory-search admin-listing-search" method="get" role="search">
            <label htmlFor="listing-search">Search listings</label>
            <div>
              <Search size={16} aria-hidden="true" />
              <input id="listing-search" name="q" type="search" defaultValue={query} placeholder="Title, seller, category, or listing ID" autoComplete="off" />
              <label className="sr-only" htmlFor="listing-status">Filter by status</label>
              <select id="listing-status" name="status" defaultValue={selectedStatus}>
                <option value="all">All statuses</option>
                {LISTING_STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}
              </select>
              <button className="admin-button" type="submit">Search</button>
            </div>
          </form>

          {listingRows.length === 0 ? (
            <div className="admin-directory-empty" role="status">
              <ClipboardList size={22} aria-hidden="true" />
              <strong>{query === '' && selectedStatus === 'all' ? 'No listings yet' : 'No listings found'}</strong>
              <p>{query === '' && selectedStatus === 'all' ? 'Listings will appear here after inventory is created.' : 'Try a different search term or status filter.'}</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-directory-table">
                <caption className="sr-only">Listing directory</caption>
                <thead>
                  <tr><th scope="col">Listing</th><th scope="col">Seller</th><th scope="col">Category</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {listingRows.map((listing) => (
                    <tr key={listing.id}>
                      <th scope="row"><Link className="admin-row-link" href={`/admin/listings/${encodeURIComponent(listing.id)}`}>{listing.title}</Link><small>{listing.id}</small></th>
                      <td><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(listing.sellerId)}`}>{listing.sellerName}</Link><small>@{listing.sellerHandle}</small></td>
                      <td>{listing.category}</td>
                      <td>{label(listing.saleType)}</td>
                      <td>{amount(listing)}</td>
                      <td><span className={`admin-status admin-status--${statusTone(listing.status)}`}>{label(listing.status)}</span></td>
                      <td>{date(listing.endsAt ?? listing.publishedAt ?? listing.createdAt)}</td>
                      <td><Link className="admin-row-link" href={`/admin/listings/${encodeURIComponent(listing.id)}`}>View listing</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <nav className="admin-pagination" aria-label="Listing directory pages">
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
