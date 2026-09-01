import Link from 'next/link';
import { Banknote, BadgeCheck, Check, Clock3, Truck, UserRound } from 'lucide-react';

import { browseListings, BROWSE_SORTS, SETTLEMENT_METHODS, type BrowseSort } from '@/services/listings';
import { CATEGORY_LIST, isCategoryKey } from '@/domain/categories/definitions';
import { filtersFor, coerceFilters } from '@/domain/categories/filters';
import { formatMoney } from '@/domain/money';
import { FULFILLMENT_PATHS, type FulfillmentPath } from '@/domain/states/transaction';
import { FilterPanel } from './filter-panel';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Cash meetup',
  remote_ship: 'Ship to you',
  relay: 'Store',
  full_service: 'Full-service delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  linx: 'LINX',
  other: 'Other',
};

type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

function stringValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

function isFulfillmentPath(value: string): value is FulfillmentPath {
  return FULFILLMENT_PATHS.includes(value as FulfillmentPath);
}

function isSettlementMethod(value: string): value is SettlementMethod {
  return SETTLEMENT_METHODS.includes(value as SettlementMethod);
}

function timeLeft(endsAt: Date | null): string {
  if (endsAt === null) return 'Ends soon';
  const minutes = Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 60_000));
  if (minutes < 1) return 'Ending now';
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

function auctionUrgency(endsAt: Date | null): 'urgent' | 'soon' | 'healthy' {
  if (endsAt === null) return 'soon';
  const hours = (endsAt.getTime() - Date.now()) / 3_600_000;
  if (hours < 12) return 'urgent';
  if (hours < 24) return 'soon';
  return 'healthy';
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
  const selectedCategories = stringValues(params.category).filter(isCategoryKey);
  const activeCategory = selectedCategories.length === 1 ? selectedCategories[0] : undefined;
  const saleType =
    params.saleType === 'straight_sale' || params.saleType === 'auction'
      ? params.saleType
      : 'straight_sale';
  const delivery = stringValues(params.delivery).filter(isFulfillmentPath);
  const payment = stringValues(params.payment).filter(isSettlementMethod);
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
  if (activeCategory !== undefined) {
    for (const filter of filtersFor(activeCategory)) {
      const value = params[`attr_${filter.key}`];
      if (typeof value === 'string' && value !== '') raw[filter.key] = value;
    }
  }
  const attributes =
    activeCategory !== undefined ? coerceFilters(activeCategory, raw) : {};

  const { rows, total, pageSize } = await browseListings({
    ...(query !== '' ? { query } : {}),
    ...(selectedCategories.length > 0 ? { categories: selectedCategories } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(saleType !== undefined ? { saleType } : {}),
    ...(delivery.length > 0 ? { fulfillmentPaths: delivery } : {}),
    ...(payment.length > 0 ? { settlementMethods: payment } : {}),
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
    delivery?: readonly FulfillmentPath[] | null;
    payment?: readonly string[] | null;
    minPrice?: string | null;
    maxPrice?: string | null;
    page?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (query !== '') qs.set('q', query);
    for (const selectedCategory of selectedCategories) qs.append('category', selectedCategory);
    const nextSaleType = 'saleType' in overrides ? overrides.saleType : saleType;
    if (nextSaleType) qs.set('saleType', nextSaleType);
    const nextSort = 'sort' in overrides ? overrides.sort : sort;
    if (nextSort && nextSort !== 'newest') qs.set('sort', nextSort);
    const nextDelivery = 'delivery' in overrides ? overrides.delivery : delivery;
    nextDelivery?.forEach((path) => qs.append('delivery', path));
    const nextPayment = 'payment' in overrides ? overrides.payment : payment;
    nextPayment?.forEach((method) => qs.append('payment', method));
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

  const activeFilters = activeCategory !== undefined ? filtersFor(activeCategory) : [];

  const hasActiveFilters =
    query !== '' || selectedCategories.length > 0 || delivery.length > 0 || payment.length > 0 ||
    minPriceCents !== undefined || maxPriceCents !== undefined || Object.keys(attributes).length > 0;

  return (
    <main className="catalog-page">
      <section className="catalog-header">
        <div>
          <h1>Browse listings</h1>
          <p>Find cards, comics, and collectibles from local sellers.</p>
        </div>
        <form className="catalog-search" action="/listings" method="get" role="search">
          <input type="hidden" name="saleType" value={saleType} />
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2" stroke="currentColor" strokeWidth="1.8" /><path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <label className="sr-only" htmlFor="catalog-query">Search listings</label>
          <input id="catalog-query" name="q" type="search" defaultValue={query} placeholder="Search listings" />
          <button type="submit">Search</button>
        </form>
      </section>

      <div className="browse-layout">
        {/* -------------------------------------------------- filter rail */}
        <FilterPanel>
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
            <input type="hidden" name="saleType" value={saleType} />
            <fieldset className="filter-checklist">
              <legend>Category</legend>
              {CATEGORY_LIST.map((c) => (
                <label key={c.key}>
                  <input type="checkbox" name="category" value={c.key} defaultChecked={selectedCategories.includes(c.key as (typeof selectedCategories)[number])} />
                  <span>{c.label}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="filter-checklist">
              <legend>Delivery</legend>
              {FULFILLMENT_PATHS.map((path) => (
                <label key={path}>
                  <input type="checkbox" name="delivery" value={path} defaultChecked={delivery.includes(path)} />
                  <span>{PATH_LABELS[path]}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="filter-checklist">
              <legend>Payment</legend>
              {SETTLEMENT_METHODS.map((method) => (
                <label key={method}>
                  <input type="checkbox" name="payment" value={method} defaultChecked={payment.includes(method)} />
                  <span>{PAYMENT_LABELS[method] ?? method}</span>
                </label>
              ))}
            </fieldset>

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
              <Link className="filter-reset" href={saleType === 'auction' ? '/listings?saleType=auction' : '/listings'}>Clear all filters</Link>
            )}
          </form>
        </FilterPanel>

        {/* -------------------------------------------------- results */}
        <div className="catalog-results">
          <nav className="browse-type-tabs" aria-label="Browse by sale type">
            <Link className={saleType === 'straight_sale' ? 'is-active' : ''} href={browseHref({ saleType: 'straight_sale', page: 1 })}>Fixed price</Link>
            <Link className={saleType === 'auction' ? 'is-active' : ''} href={browseHref({ saleType: 'auction', page: 1 })}>Auctions</Link>
          </nav>
          <div className="results-toolbar">
            <div className="results-head">
              <strong className="num">{total}</strong>
              <span className="muted">
                listing{total === 1 ? '' : 's'}
                {query !== '' && ` matching “${query}”`}
                {selectedCategories.length > 0 && ` in ${selectedCategories.map((value) => value.replace('_', ' ')).join(', ')}`}
                {saleType !== undefined && ` · ${saleType === 'auction' ? 'auctions' : 'fixed price'}`}
              </span>
            </div>
            <form method="get" className="sort-form" aria-label="Sort listings">
              {query !== '' && <input type="hidden" name="q" value={query} />}
              {selectedCategories.map((value) => <input key={value} type="hidden" name="category" value={value} />)}
              <input type="hidden" name="saleType" value={saleType} />
              {delivery.map((value) => <input key={value} type="hidden" name="delivery" value={value} />)}
              {payment.map((value) => <input key={value} type="hidden" name="payment" value={value} />)}
              {minPriceCents !== undefined && <input type="hidden" name="minPrice" value={minPriceInput} />}
              {maxPriceCents !== undefined && <input type="hidden" name="maxPrice" value={maxPriceInput} />}
              {Object.entries(raw).map(([key, value]) => value !== undefined && <input key={key} type="hidden" name={`attr_${key}`} value={value} />)}
              <label className="sr-only" htmlFor="sort">Sort listings</label>
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
                      {row.primaryImageId ? <img src={`/api/images/${row.primaryImageId}?variant=card`} alt="" /> : <span aria-hidden="true">Collectible preview</span>}
                    </Link>
                    <div className="catalog-card__body">
                      <h3><Link href={`/listings/${row.id}`}>{row.title}</Link></h3>
                      <div className="catalog-card__tags">
                        <span className={`pill tag tag--${row.category}`}>{row.category.replace('_', ' ')}</span>
                      </div>
                      <div className="catalog-card__seller">
                        <UserRound aria-hidden="true" />
                        <div>
                          <Link href={`/members/${row.sellerId}`}>{row.sellerName}</Link>
                          <span className="catalog-card__seller-rating">
                            {row.sellerRatingAvg !== null ? `${Number(row.sellerRatingAvg).toFixed(1)} rating` : 'New seller'}
                            {(row.sellerRatingCount ?? 0) > 0 && ` · ${row.sellerRatingCount} rating${row.sellerRatingCount === 1 ? '' : 's'}`}
                            {(row.sellerCompletedSales ?? 0) > 0 && ` · ${row.sellerCompletedSales} sale${row.sellerCompletedSales === 1 ? '' : 's'}`}
                          </span>
                        </div>
                      </div>
                      <dl className="catalog-card__meta">
                        <div>
                          <dt><Truck aria-hidden="true" /><span className="sr-only">Delivery</span></dt>
                          <dd>{row.fulfillmentPaths.map((path) => <span key={path}><Check aria-hidden="true" />{PATH_LABELS[path]}</span>)}</dd>
                        </div>
                        <div>
                          <dt><Banknote aria-hidden="true" /><span className="sr-only">Payment</span></dt>
                          <dd>{row.settlementMethods.map((method) => <span key={method}><Check aria-hidden="true" />{PAYMENT_LABELS[method] ?? method}</span>)}</dd>
                        </div>
                      </dl>
                      <div className="catalog-card__footer">
                        <div className="catalog-card__price">
                          <span className="catalog-card__price-label">{row.saleType === 'auction' ? 'Current bid' : 'Sale price'}</span>
                          <strong className="num">{row.saleType === 'auction' ? formatMoney(row.currentBidCents ?? row.startBidCents ?? 0) : formatMoney(row.priceCents ?? 0)}</strong>
                          {row.saleType === 'straight_sale' && (
                            <span className="catalog-card__offers"><BadgeCheck aria-hidden="true" />Offers accepted</span>
                          )}
                          {row.saleType === 'auction' && <small>{row.bidCount} bid{row.bidCount === 1 ? '' : 's'}</small>}
                          {row.saleType === 'auction' && (
                            <span className={`catalog-card__time catalog-card__time--${auctionUrgency(row.endsAt)}`}>
                              <Clock3 aria-hidden="true" />{timeLeft(row.endsAt)}
                            </span>
                          )}
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
