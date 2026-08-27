import Link from 'next/link';

import { browseListings } from '@/services/listings';
import { CATEGORY_LIST, isCategoryKey } from '@/domain/categories/definitions';
import { filtersFor, coerceFilters } from '@/domain/categories/filters';
import { formatMoney } from '@/domain/money';
import { publicUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Cash meetup',
  remote_ship: 'Ship to you',
  relay: 'Relay store',
  full_service: 'Full-service delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  linx: 'LINX',
  other: 'Other',
};

function readableValues(values: readonly string[], labels: Record<string, string>): string {
  return values.map((value) => labels[value] ?? value.replaceAll('_', ' ')).join(' · ');
}

function attributeSummary(attributes: unknown): Array<[string, string]> {
  if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
  return Object.entries(attributes as Record<string, unknown>)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => [key.replaceAll('_', ' '), String(value)]);
}

/**
 * Browse, filterable by category AND by category-specific attributes.
 *
 * The UI here is deliberately plain — the point being demonstrated is that the DATA
 * MODEL supports attribute filtering from day one, served by the GIN index. Polishing
 * this into a real faceted browse is the fast-follow.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const category = typeof params.category === 'string' ? params.category : undefined;
  const saleType =
    params.saleType === 'straight_sale' || params.saleType === 'auction'
      ? params.saleType
      : undefined;
  const page = Math.max(1, Number.parseInt(String(params.page ?? '1'), 10) || 1);

  // Only attributes the category declares as filterable are honoured (a query string
  // cannot smuggle arbitrary JSONB predicates in), and each value is coerced to the
  // JSON type it is actually stored as — containment is type-strict.
  const raw: Record<string, string | undefined> = {};
  if (category !== undefined && isCategoryKey(category)) {
    for (const filter of filtersFor(category)) {
      const value = params[`attr_${filter.key}`];
      if (typeof value === 'string' && value !== '') raw[filter.key] = value;
    }
  }
  const attributes =
    category !== undefined && isCategoryKey(category) ? coerceFilters(category, raw) : {};

  const { rows, total, pageSize } = await browseListings({
    ...(category !== undefined ? { category } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(saleType !== undefined ? { saleType } : {}),
    page,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A page link that carries every active filter forward — only the page number moves.
  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    if (category !== undefined) qs.set('category', category);
    if (saleType !== undefined) qs.set('saleType', saleType);
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined) qs.set(`attr_${key}`, value);
    }
    if (n > 1) qs.set('page', String(n));
    const s = qs.toString();
    return s === '' ? '/listings' : `/listings?${s}`;
  };

  const activeFilters = category !== undefined && isCategoryKey(category) ? filtersFor(category) : [];

  const hasActiveFilters =
    category !== undefined || saleType !== undefined || Object.keys(attributes).length > 0;

  return (
    <main>
      <div className="page-heading">
        <h1>Browse listings</h1>
        <p className="lede">Find something with a story. Filter by category, sale type, or the details that matter to you.</p>
      </div>

      <div className="browse-layout">
        {/* -------------------------------------------------- filter rail */}
        <details className="filter-panel" open>
          <summary>
            <svg className="filter-ic" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Filters
            <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <form method="get" className="filter-form" aria-label="Listing filters">
            <label htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue={category ?? ''}>
              <option value="">All categories</option>
              {CATEGORY_LIST.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>

            <label htmlFor="saleType">Sale type</label>
            <select id="saleType" name="saleType" defaultValue={saleType ?? ''}>
              <option value="">Everything</option>
              <option value="straight_sale">Straight sale</option>
              <option value="auction">Auctions</option>
            </select>

            {activeFilters.filter((f) => f.type === 'enum').map((filter) => (
              <div key={filter.key}>
                <label htmlFor={`attr_${filter.key}`}>{filter.label}</label>
                <select id={`attr_${filter.key}`} name={`attr_${filter.key}`} defaultValue={raw[filter.key] ?? ''}>
                  <option value="">Any</option>
                  {filter.options?.map((option) => <option key={option} value={option}>{filter.optionLabels?.[option] ?? option}</option>)}
                </select>
              </div>
            ))}
            <button type="submit">Apply filters</button>
            {hasActiveFilters && (
              <Link className="filter-reset" href="/listings">Clear all filters</Link>
            )}
          </form>
        </details>

        {/* -------------------------------------------------- results */}
        <div>
          <div className="results-head">
            <strong className="num">{total}</strong>
            <span className="muted">
              listing{total === 1 ? '' : 's'}
              {category !== undefined && ` in ${category}`}
              {saleType !== undefined && ` · ${saleType === 'auction' ? 'auctions' : 'straight sales'}`}
              {Object.keys(attributes).length > 0 && ` · ${Object.entries(attributes).map(([k, v]) => `${k}: ${v}`).join(', ')}`}
            </span>
          </div>

          {total === 0 ? (
            <div className="empty-state">
              <h2>Nothing matches that</h2>
              <p>Try a different filter, or be the first to list something here.</p>
              <Link className="button" href="/listings/new">Create a listing</Link>
            </div>
          ) : (
            <>
              <div className="listing-results">
                {rows.map((row) => (
                  <article className="listing-card listing-card--horizontal" key={row.id}>
                    <div className="listing-card__image">
                      {row.primaryImageKey ? <img src={publicUrl(row.primaryImageKey)} alt="" /> : <span aria-hidden="true">Collectible preview</span>}
                    </div>
                    <div className="listing-card__body">
                      <h3>{row.title}</h3>
                      <div className="listing-card__tags"><span className={`pill tag tag--${row.category}`}>{row.category.replace('_', ' ')}</span><span className={`pill tag ${row.saleType === 'auction' ? 'tag--auction' : 'tag--sale'}`}>{row.saleType === 'auction' ? 'Auction' : 'For sale'}</span></div>
                      <div className="listing-card__seller">
                        <span className="seller-avatar" aria-hidden="true">{row.sellerName.slice(0, 1).toUpperCase()}</span>
                        <span><strong>{row.sellerName}</strong><small>{row.sellerRatingAvg === null ? 'New seller' : `★ ${Number(row.sellerRatingAvg).toFixed(1)} · ${row.sellerRatingCount} rating${row.sellerRatingCount === 1 ? '' : 's'}`}</small></span>
                      </div>
                      <dl className="listing-card__facts">
                        <div><dt>Pickup</dt><dd>{readableValues(row.fulfillmentPaths, PATH_LABELS)}</dd></div>
                        <div><dt>Payment</dt><dd>{readableValues(row.settlementMethods, PAYMENT_LABELS)}</dd></div>
                        {attributeSummary(row.attributes).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                      </dl>
                    </div>
                    <div className="listing-card__actions">
                      <div className="listing-card__price-block">
                        <span>{row.saleType === 'auction' ? 'Current bid' : 'Price'}</span>
                        <strong className="num">{row.saleType === 'auction' ? formatMoney(row.currentBidCents ?? row.startBidCents ?? 0) : formatMoney(row.priceCents ?? 0)}</strong>
                        {row.saleType === 'auction' && <small>{row.bidCount} bid{row.bidCount === 1 ? '' : 's'}</small>}
                      </div>
                      <div className="listing-card__action-buttons"><Link className="button secondary" href={`/listings/${row.id}`}>View</Link><Link className="button" href={`/listings/${row.id}#buy-panel`}>{row.saleType === 'auction' ? 'Bid now' : 'Buy now'}</Link></div>
                    </div>
                  </article>
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="pager" aria-label="Pagination">
                  {page > 1 ? (
                    <Link className="pager__link" href={pageHref(page - 1)} rel="prev">← Previous</Link>
                  ) : (
                    <span className="pager__link is-disabled" aria-disabled="true">← Previous</span>
                  )}
                  <span className="pager__status num">Page {page} of {totalPages}</span>
                  {page < totalPages ? (
                    <Link className="pager__link" href={pageHref(page + 1)} rel="next">Next →</Link>
                  ) : (
                    <span className="pager__link is-disabled" aria-disabled="true">Next →</span>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
