import Link from 'next/link';

import { browseListings, BROWSE_SORTS, SETTLEMENT_METHODS, type BrowseSort } from '@/services/listings';
import { CATEGORY_LIST, isCategoryKey } from '@/domain/categories/definitions';
import { filtersFor, coerceFilters } from '@/domain/categories/filters';
import { formatMoney } from '@/domain/money';
import { publicUrl } from '@/lib/storage';
import { FULFILLMENT_PATHS, type FulfillmentPath } from '@/domain/states/transaction';

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

/**
 * Browse the active catalog with sale-type tabs, practical listing facets, and stable
 * sorting that remains encoded in the URL for shareable results.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const category = typeof params.category === 'string' ? params.category : undefined;
  const saleType =
    params.saleType === 'straight_sale' || params.saleType === 'auction'
      ? params.saleType
      : undefined;
  const delivery = FULFILLMENT_PATHS.includes(params.delivery as FulfillmentPath)
    ? (params.delivery as FulfillmentPath)
    : undefined;
  const payment = SETTLEMENT_METHODS.includes(params.payment as (typeof SETTLEMENT_METHODS)[number])
    ? (params.payment as (typeof SETTLEMENT_METHODS)[number])
    : undefined;
  const sort = BROWSE_SORTS.includes(params.sort as BrowseSort)
    ? (params.sort as BrowseSort)
    : 'newest';
  const minPriceInput = typeof params.minPrice === 'string' ? params.minPrice : '';
  const maxPriceInput = typeof params.maxPrice === 'string' ? params.maxPrice : '';
  const minPriceCents = Number.isFinite(Number(minPriceInput)) && Number(minPriceInput) > 0
    ? Math.round(Number(minPriceInput) * 100)
    : undefined;
  const maxPriceCents = Number.isFinite(Number(maxPriceInput)) && Number(maxPriceInput) > 0
    ? Math.round(Number(maxPriceInput) * 100)
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
    ...(query !== '' ? { query } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(saleType !== undefined ? { saleType } : {}),
    ...(delivery !== undefined ? { fulfillmentPath: delivery } : {}),
    ...(payment !== undefined ? { settlementMethod: payment } : {}),
    ...(minPriceCents !== undefined ? { minPriceCents } : {}),
    ...(maxPriceCents !== undefined ? { maxPriceCents } : {}),
    sort,
    page,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A page link that carries every active filter forward — only the page number moves.
  const browseHref = (overrides: {
    saleType?: 'straight_sale' | 'auction' | null;
    sort?: BrowseSort | null;
    delivery?: FulfillmentPath | null;
    payment?: string | null;
    minPrice?: string | null;
    maxPrice?: string | null;
    page?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (query !== '') qs.set('q', query);
    if (category !== undefined) qs.set('category', category);
    const nextSaleType = 'saleType' in overrides ? overrides.saleType : saleType;
    if (nextSaleType) qs.set('saleType', nextSaleType);
    const nextSort = 'sort' in overrides ? overrides.sort : sort;
    if (nextSort && nextSort !== 'newest') qs.set('sort', nextSort);
    const nextDelivery = 'delivery' in overrides ? overrides.delivery : delivery;
    if (nextDelivery) qs.set('delivery', nextDelivery);
    const nextPayment = 'payment' in overrides ? overrides.payment : payment;
    if (nextPayment) qs.set('payment', nextPayment);
    const nextMinPrice = 'minPrice' in overrides ? overrides.minPrice : minPriceInput;
    if (nextMinPrice) qs.set('minPrice', nextMinPrice);
    const nextMaxPrice = 'maxPrice' in overrides ? overrides.maxPrice : maxPriceInput;
    if (nextMaxPrice) qs.set('maxPrice', nextMaxPrice);
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined) qs.set(`attr_${key}`, value);
    }
    if ((overrides.page ?? 1) > 1) qs.set('page', String(overrides.page));
    const s = qs.toString();
    return s === '' ? '/listings' : `/listings?${s}`;
  };
  const pageHref = (n: number) => browseHref({ page: n });

  const activeFilters = category !== undefined && isCategoryKey(category) ? filtersFor(category) : [];

  const hasActiveFilters =
    query !== '' || category !== undefined || saleType !== undefined || delivery !== undefined || payment !== undefined ||
    minPriceCents !== undefined || maxPriceCents !== undefined || Object.keys(attributes).length > 0;

  return (
    <main className="catalog-page">
      <section className="catalog-header">
        <div>
          <h1>Browse listings</h1>
          <p>Search the local collector marketplace, then narrow by sale type, category, delivery, and payment.</p>
        </div>
        <form className="catalog-search" action="/listings" method="get" role="search">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2" stroke="currentColor" strokeWidth="1.8" /><path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <label className="sr-only" htmlFor="catalog-query">Search listings</label>
          <input id="catalog-query" name="q" type="search" defaultValue={query} placeholder="Search cards, comics, collectibles" />
          <button type="submit">Search</button>
        </form>
      </section>

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
            {query !== '' && <input type="hidden" name="q" value={query} />}
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

            <label htmlFor="delivery">Delivery</label>
            <select id="delivery" name="delivery" defaultValue={delivery ?? ''}>
              <option value="">Any delivery option</option>
              {FULFILLMENT_PATHS.map((path) => <option key={path} value={path}>{PATH_LABELS[path]}</option>)}
            </select>

            <label htmlFor="payment">Payment</label>
            <select id="payment" name="payment" defaultValue={payment ?? ''}>
              <option value="">Any payment method</option>
              {SETTLEMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_LABELS[method] ?? method}</option>)}
            </select>

            <div className="filter-price-grid">
              <div>
                <label htmlFor="minPrice">Min price</label>
                <input id="minPrice" name="minPrice" type="number" min="0" step="0.01" inputMode="decimal" placeholder="TT$0" defaultValue={minPriceInput} />
              </div>
              <div>
                <label htmlFor="maxPrice">Max price</label>
                <input id="maxPrice" name="maxPrice" type="number" min="0" step="0.01" inputMode="decimal" placeholder="No limit" defaultValue={maxPriceInput} />
              </div>
            </div>

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
        <div className="catalog-results">
          <nav className="browse-type-tabs" aria-label="Browse by sale type">
            <Link className={saleType === undefined ? 'is-active' : ''} href={browseHref({ saleType: null, page: 1 })}>All listings</Link>
            <Link className={saleType === 'straight_sale' ? 'is-active' : ''} href={browseHref({ saleType: 'straight_sale', page: 1 })}>Fixed price</Link>
            <Link className={saleType === 'auction' ? 'is-active' : ''} href={browseHref({ saleType: 'auction', page: 1 })}>Auctions</Link>
          </nav>
          <div className="results-toolbar">
            <div className="results-head">
              <strong className="num">{total}</strong>
              <span className="muted">
                listing{total === 1 ? '' : 's'}
                {query !== '' && ` matching “${query}”`}
                {category !== undefined && ` in ${category.replace('_', ' ')}`}
                {saleType !== undefined && ` · ${saleType === 'auction' ? 'auctions' : 'fixed price'}`}
              </span>
            </div>
            <form method="get" className="sort-form" aria-label="Sort listings">
              {query !== '' && <input type="hidden" name="q" value={query} />}
              {category !== undefined && <input type="hidden" name="category" value={category} />}
              {saleType !== undefined && <input type="hidden" name="saleType" value={saleType} />}
              {delivery !== undefined && <input type="hidden" name="delivery" value={delivery} />}
              {payment !== undefined && <input type="hidden" name="payment" value={payment} />}
              {minPriceCents !== undefined && <input type="hidden" name="minPrice" value={minPriceInput} />}
              {maxPriceCents !== undefined && <input type="hidden" name="maxPrice" value={maxPriceInput} />}
              {Object.entries(raw).map(([key, value]) => value !== undefined && <input key={key} type="hidden" name={`attr_${key}`} value={value} />)}
              <label htmlFor="sort">Sort by</label>
              <select id="sort" name="sort" defaultValue={sort}>
                <option value="newest">Newest listed</option>
                <option value="price_low">Price: low to high</option>
                <option value="price_high">Price: high to low</option>
                <option value="ending_soon">Ending soon</option>
              </select>
              <button type="submit" className="button secondary">Apply</button>
            </form>
          </div>

          {total === 0 ? (
            <div className="empty-state">
              <h2>Nothing matches that</h2>
              <p>Try a different filter, or be the first to list something here.</p>
              <Link className="button" href="/listings/new">Create a listing</Link>
            </div>
          ) : (
            <>
              <div className="catalog-results-grid">
                {rows.map((row) => (
                  <article className="catalog-card" key={row.id}>
                    <Link className="catalog-card__image" href={`/listings/${row.id}`} aria-label={`View ${row.title}`}>
                      {row.primaryImageKey ? <img src={publicUrl(row.primaryImageKey)} alt="" /> : <span aria-hidden="true">Collectible preview</span>}
                    </Link>
                    <div className="catalog-card__body">
                      <div className="catalog-card__tags"><span className={`pill tag tag--${row.category}`}>{row.category.replace('_', ' ')}</span><span className={`pill tag ${row.saleType === 'auction' ? 'tag--auction' : 'tag--sale'}`}>{row.saleType === 'auction' ? 'Auction' : 'Fixed price'}</span></div>
                      <h3><Link href={`/listings/${row.id}`}>{row.title}</Link></h3>
                      {row.description !== null && row.description !== '' && <p className="catalog-card__description">{row.description}</p>}
                      <dl className="catalog-card__facts">
                        <div><dt>Delivery</dt><dd>{readableValues(row.fulfillmentPaths, PATH_LABELS)}</dd></div>
                        <div><dt>Payment</dt><dd>{readableValues(row.settlementMethods, PAYMENT_LABELS)}</dd></div>
                      </dl>
                      <div className="catalog-card__footer">
                        <div className="catalog-card__price">
                        <span>{row.saleType === 'auction' ? 'Current bid' : 'Price'}</span>
                        <strong className="num">{row.saleType === 'auction' ? formatMoney(row.currentBidCents ?? row.startBidCents ?? 0) : formatMoney(row.priceCents ?? 0)}</strong>
                        {row.saleType === 'auction' && <small>{row.bidCount} bid{row.bidCount === 1 ? '' : 's'}</small>}
                        </div>
                        <Link className="catalog-card__cta" href={`/listings/${row.id}#buy-panel`}>{row.saleType === 'auction' ? 'Bid now' : 'View listing'}</Link>
                      </div>
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
