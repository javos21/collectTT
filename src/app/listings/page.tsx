import Link from 'next/link';

import { browseListings } from '@/services/listings';
import { CATEGORY_LIST, isCategoryKey } from '@/domain/categories/definitions';
import { filtersFor, coerceFilters } from '@/domain/categories/filters';
import { formatMoney } from '@/domain/money';

export const dynamic = 'force-dynamic';

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

  const rows = await browseListings({
    ...(category !== undefined ? { category } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  });

  const activeFilters = category !== undefined && isCategoryKey(category) ? filtersFor(category) : [];

  return (
    <main>
      <h1>Browse</h1>

      <form method="get">
        <div className="row">
          <div>
            <label htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue={category ?? ''}>
              <option value="">All categories</option>
              {CATEGORY_LIST.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {activeFilters
            .filter((f) => f.type === 'enum')
            .map((filter) => (
              <div key={filter.key}>
                <label htmlFor={`attr_${filter.key}`}>{filter.label}</label>
                <select
                  id={`attr_${filter.key}`}
                  name={`attr_${filter.key}`}
                  defaultValue={raw[filter.key] ?? ''}
                >
                  <option value="">Any</option>
                  {filter.options?.map((option) => (
                    <option key={option} value={option}>
                      {filter.optionLabels?.[option] ?? option}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </div>
        <button type="submit">Filter</button>
      </form>

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        {rows.length} listing{rows.length === 1 ? '' : 's'}
        {category !== undefined && ` in ${category}`}
        {Object.keys(attributes).length > 0 &&
          ` matching ${Object.entries(attributes)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}`}
      </p>

      {rows.length === 0 ? (
        <p className="muted">
          Nothing here yet. <Link href="/listings/new">Create a listing</Link> or run{' '}
          <code>npm run seed:dev</code> for sample data.
        </p>
      ) : (
        <div className="grid">
          {rows.map((row) => (
            <div className="card" key={row.id}>
              <Link href={`/listings/${row.id}`}>{row.title}</Link>
              <p className="muted" style={{ margin: '.25rem 0' }}>
                <span className="pill">{row.category}</span>{' '}
                <span className="pill">{row.saleType === 'auction' ? 'auction' : 'straight sale'}</span>
              </p>
              <p style={{ margin: '.25rem 0', fontWeight: 600 }}>
                {row.saleType === 'auction'
                  ? formatMoney(row.currentBidCents ?? row.startBidCents ?? 0)
                  : formatMoney(row.priceCents ?? 0)}
                {row.saleType === 'auction' && (
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {' '}
                    · {row.bidCount} bid{row.bidCount === 1 ? '' : 's'}
                  </span>
                )}
              </p>
              <p className="muted" style={{ margin: 0 }}>by {row.sellerName}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
