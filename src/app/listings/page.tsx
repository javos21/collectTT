import Link from 'next/link';
import { BadgeCheck, Clock3, UserRound } from 'lucide-react';

import { browseListings, BROWSE_SORTS, type BrowseSort } from '@/services/listings';
import { filtersForDefinition, coerceFiltersForDefinition } from '@/domain/categories/filters';
import { formatMoney } from '@/domain/money';
import { FilterPanel } from './filter-panel';
import { listMarketplaceOptions } from '@/services/platform-settings';
import { activeCategoryDefinitions } from '@/services/catalog';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Public Meetup',
  remote_ship: 'Ships from Seller',
  relay: 'Store Pickup',
  full_service: 'CollectTT Delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  wam: 'WAM',
};

function stringValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

function labelList(values: readonly string[], labels: Record<string, string>): string {
  return values.map((value) => labels[value] ?? value.replaceAll('_', ' ')).join(', ');
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
  const [availableDeliveryOptions, availablePaymentOptions, availableCategories] = await Promise.all([
    listMarketplaceOptions('delivery', { activeOnly: true }),
    listMarketplaceOptions('payment', { activeOnly: true }),
    activeCategoryDefinitions(),
  ]);
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const categoryKeys = new Set(availableCategories.map((category) => category.key));
  const categoryLabels = new Map(availableCategories.map((category) => [category.key, category.label]));
  const selectedCategories = stringValues(params.category).filter((value) => categoryKeys.has(value));
  const activeCategory = selectedCategories.length === 1 ? selectedCategories[0] : undefined;
  const activeCategoryDefinition = availableCategories.find((category) => category.key === activeCategory);
  const requestedSaleType =
    params.saleType === 'straight_sale' || params.saleType === 'auction'
      ? params.saleType
      : undefined;
  // A search launched from the homepage should search the complete catalog. Keep
  // straight sales as the default only for an unfiltered visit to /listings.
  const saleType = requestedSaleType ?? (query === '' ? 'straight_sale' : undefined);
  const deliveryIds = new Set(availableDeliveryOptions.map((option) => option.id));
  const paymentKeys = new Set(availablePaymentOptions.map((option) => option.key));
  const delivery = stringValues(params.delivery).filter((value) => deliveryIds.has(value));
  const payment = stringValues(params.payment).filter((value) => paymentKeys.has(value));
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
  if (activeCategoryDefinition !== undefined) {
    for (const filter of filtersForDefinition(activeCategoryDefinition)) {
      const value = params[`attr_${filter.key}`];
      if (typeof value === 'string' && value !== '') raw[filter.key] = value;
    }
  }
  const attributes =
    activeCategoryDefinition !== undefined ? coerceFiltersForDefinition(activeCategoryDefinition, raw) : {};

  const { rows, total, pageSize } = await browseListings({
    ...(query !== '' ? { query } : {}),
    ...(selectedCategories.length > 0 ? { categories: selectedCategories } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(saleType !== undefined ? { saleType } : {}),
    ...(delivery.length > 0 ? { deliveryOptionIds: delivery } : {}),
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
    delivery?: readonly string[] | null;
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

  const activeFilters = activeCategoryDefinition !== undefined ? filtersForDefinition(activeCategoryDefinition) : [];

  const hasActiveFilters =
    query !== '' || selectedCategories.length > 0 || delivery.length > 0 || payment.length > 0 ||
    minPriceCents !== undefined || maxPriceCents !== undefined || Object.keys(attributes).length > 0;

  return (
    <main className="catalog-page">
      <section className="catalog-header">
        <div>
          <h1>Browse listings</h1>
        </div>
        <form className="catalog-search" action="/listings" method="get" role="search">
          {saleType !== undefined && <input type="hidden" name="saleType" value={saleType} />}
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
            {saleType !== undefined && <input type="hidden" name="saleType" value={saleType} />}
            <fieldset className="filter-checklist">
              <legend>Category</legend>
              {availableCategories.map((c) => (
                <label key={c.key}>
                  <input type="checkbox" name="category" value={c.key} defaultChecked={selectedCategories.includes(c.key as (typeof selectedCategories)[number])} />
                  <span>{c.label}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="filter-checklist">
              <legend>Delivery</legend>
              {availableDeliveryOptions.map((option) => (
                <label key={option.id}>
                  <input type="checkbox" name="delivery" value={option.id} defaultChecked={delivery.includes(option.id)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="filter-checklist">
              <legend>Payment</legend>
              {availablePaymentOptions.map((option) => (
                <label key={option.key}>
                  <input type="checkbox" name="payment" value={option.key} defaultChecked={payment.includes(option.key)} />
                  <span>{option.label}</span>
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
            <Link className={saleType === 'straight_sale' ? 'is-active' : ''} href={browseHref({ saleType: 'straight_sale', page: 1 })}>Straight Sales</Link>
            <Link className={saleType === 'auction' ? 'is-active' : ''} href={browseHref({ saleType: 'auction', page: 1 })}>Auctions</Link>
          </nav>
          <div className="results-toolbar">
            <div className="results-head">
              <strong className="num">{total}</strong>{' '}
              <span className="muted">
                {total === 1 ? 'Listing' : 'Listings'}
                {query !== '' && ` matching “${query}”`}
                {selectedCategories.length > 0 && ` in ${selectedCategories.map((value) => value.replace('_', ' ')).join(', ')}`}
              </span>
            </div>
            <form method="get" className="sort-form" aria-label="Sort listings">
              {query !== '' && <input type="hidden" name="q" value={query} />}
              {selectedCategories.map((value) => <input key={value} type="hidden" name="category" value={value} />)}
              {saleType !== undefined && <input type="hidden" name="saleType" value={saleType} />}
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
                {rows.map((row) => {
                  const deliveryOptions = row.deliveryOptionLabels.length > 0
                    ? row.deliveryOptionLabels.join(', ')
                    : labelList(row.fulfillmentPaths, PATH_LABELS);
                  const storeOptions = row.fulfillmentPaths.includes('relay')
                    ? (row.relayStoreNames ?? []).join(', ') || 'None'
                    : 'None';
                  const paymentOptions = row.paymentOptionLabels.length > 0
                    ? row.paymentOptionLabels.join(', ')
                    : labelList(row.settlementMethods, PAYMENT_LABELS);
                  return (
                  <article className="catalog-card" key={row.id}>
                    <Link className="catalog-card__image" href={`/listings/${row.id}`} aria-label={`View ${row.title}`}>
                      {row.primaryImageId ? <img src={`/api/images/${row.primaryImageId}?variant=card`} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">Collectible preview</span>}
                    </Link>
                    <div className="catalog-card__body">
                      <div className="catalog-card__heading">
                        <h3><Link href={`/listings/${row.id}`}>{row.title}</Link></h3>
                        <span className={`pill tag tag--${row.category}`}>{categoryLabels.get(row.category) ?? row.category.replace('_', ' ')}</span>
                      </div>
                      <div className="catalog-card__seller">
                        <UserRound aria-hidden="true" />
                        <div>
                          <Link href={`/members/${row.sellerId}`}>{row.sellerName}</Link>
                          <span className={`catalog-card__seller-trust ${(row.sellerCompletedSales ?? 0) > 0 ? 'catalog-card__seller-trust--completed' : 'catalog-card__seller-trust--new'}`}>
                            {(row.sellerCompletedSales ?? 0) > 0
                              ? `${row.sellerCompletedSales} completed sale${row.sellerCompletedSales === 1 ? '' : 's'}`
                              : 'New seller'}
                          </span>
                        </div>
                      </div>
                      <div className="catalog-card__options" aria-label="Listing options">
                        <p><strong>Delivery</strong><span>{deliveryOptions}</span></p>
                        <p><strong>Stores</strong><span>{storeOptions}</span></p>
                        <p><strong>Payment options</strong><span>{paymentOptions}</span></p>
                      </div>
                      <div className="catalog-card__footer">
                        <div className="catalog-card__price">
                          <strong className="num">{row.saleType === 'auction' ? formatMoney(row.currentBidCents ?? row.startBidCents ?? 0) : formatMoney(row.priceCents ?? 0)}</strong>
                          {row.saleType === 'straight_sale' && row.acceptsOffers && (
                            <span className="catalog-card__offers"><BadgeCheck aria-hidden="true" />Offers accepted</span>
                          )}
                          {row.saleType === 'auction' && <small>{row.bidCount} bid{row.bidCount === 1 ? '' : 's'}</small>}
                          {row.saleType === 'auction' && (
                            <span className={`catalog-card__time catalog-card__time--${auctionUrgency(row.endsAt)}`}>
                              <Clock3 aria-hidden="true" />{timeLeft(row.endsAt)}
                            </span>
                          )}
                        </div>
                        <Link className="catalog-card__cta" href={`/listings/${row.id}#buy-panel`}>{row.saleType === 'auction' ? 'Bid' : 'Claim'}</Link>
                      </div>
                    </div>
                  </article>
                  );
                })}
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
