import Link from 'next/link';

import { CATEGORY_LIST } from '@/domain/categories/definitions';
import { browseListings } from '@/services/listings';
import { formatMoney } from '@/domain/money';

export const dynamic = 'force-dynamic';

/* Authored icons — one stroke language (1.7, round), never emoji. */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  trading_card: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="12" height="16" rx="2" transform="rotate(-6 9 12)" />
      <rect x="9" y="5" width="12" height="16" rx="2" transform="rotate(6 15 13)" />
      <path d="M15 9l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" />
    </svg>
  ),
  comic: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v15.5l-1.2-.8a3 3 0 00-3.4 0l-1.6 1.1a1 1 0 01-1.6-.8z" />
      <path d="M12 4h6.5c.8 0 1.5.7 1.5 1.5V19l-1.6-1.1a3 3 0 00-3.4 0l-1.2.8" />
      <path d="M7 8h2.5M7 11h2.5" />
    </svg>
  ),
  collectible: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M7 8h10l-1 4a4 4 0 01-8 0z" />
      <path d="M7 8V6h10v2M9.5 16h5M12 16v3M9 19h6" />
      <path d="M17 8h1.5a1.5 1.5 0 010 3H16M7 8H5.5a1.5 1.5 0 000 3H8" />
    </svg>
  ),
};

const EverythingIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
const AuctionIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M14 6l4 4M9.5 10.5l4 4M4 20h9" /><path d="M12 8l-6 6 2 2 6-6zM15 5l4 4" /></svg>
);
const TagIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg>
);
const PlusIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>
);
const ShieldIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
const CashIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>
);
const StarIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M12 4l2.2 4.5 5 .7-3.6 3.5.9 4.9L12 15.8 7.6 18l.9-4.9L5 9.6l5-.7z" /></svg>
);

function saleLabel(t: string) {
  return t === 'auction' ? 'Auction' : 'For sale';
}

export default async function HomePage() {
  const [recent, auctions, buynow, ...catPages] = await Promise.all([
    browseListings({ pageSize: 8 }),
    browseListings({ saleType: 'auction', pageSize: 1 }),
    browseListings({ saleType: 'straight_sale', pageSize: 1 }),
    ...CATEGORY_LIST.map((c) => browseListings({ category: c.key, pageSize: 1 })),
  ]);

  const total = recent.total;
  const catCounts = new Map(CATEGORY_LIST.map((c, i) => [c.key, catPages[i]?.total ?? 0]));

  const explore = [
    { href: '/listings', icon: EverythingIcon, tint: 'i-slate', title: 'Everything', note: `${total} listing${total === 1 ? '' : 's'}` },
    { href: '/listings?saleType=auction', icon: AuctionIcon, tint: 'i-amber', title: 'Live auctions', note: `${auctions.total} running` },
    { href: '/listings?saleType=straight_sale', icon: TagIcon, tint: 'i-green', title: 'Buy it now', note: `${buynow.total} at a fixed price` },
    { href: '/listings/new', icon: PlusIcon, tint: 'i-clay', title: 'Sell yours', note: 'List in minutes' },
  ];

  return (
    <main>
      {/* -------------------------------------------------- hero */}
      <section className="hero">
        <div className="hero__pattern" aria-hidden="true" />
        <h1>Deals you don&apos;t have to second-guess.</h1>
        <p className="hero__lede">
          Buy and sell trading cards, comics and collectibles with other Trinbagonians —
          paying each other directly, with a relay store holding the item until the money&apos;s in.
        </p>
        <div className="hero__actions">
          <Link className="btn-paper" href="/listings">
            Browse listings
          </Link>
          <Link className="btn-ghost" href="/listings/new">
            Sell an item
          </Link>
        </div>
        <div className="hero__trust">
          <span>{CashIcon} You pay each other — never the platform</span>
          <span>{ShieldIcon} Released only when payment clears</span>
          <span>{StarIcon} Reputation you can actually see</span>
        </div>
      </section>

      {/* -------------------------------------------------- explore */}
      <div className="section-head">
        <h2>Start exploring</h2>
        <Link href="/listings">All listings →</Link>
      </div>
      <div className="explore">
        {explore.map((e) => (
          <Link className="card explore-card" key={e.href} href={e.href}>
            <span className={`explore-card__icon ${e.tint}`}>{e.icon}</span>
            <span>
              <b>{e.title}</b>
              <small>{e.note}</small>
            </span>
          </Link>
        ))}
      </div>

      {/* -------------------------------------------------- categories */}
      <div className="section-head">
        <h2>Browse by category</h2>
      </div>
      <div className="cat-grid">
        {CATEGORY_LIST.map((category) => {
          const count = catCounts.get(category.key) ?? 0;
          return (
            <Link className="card category-card" key={category.key} href={`/listings?category=${category.key}`}>
              <span className="category-card__icon">
                {CATEGORY_ICON[category.key] ?? StarIcon}
              </span>
              <span>
                <strong>{category.label}s</strong>
                <span className="cat-count">
                  {count} listed · {category.attributes.filter((a) => a.filterable === true).length} ways to filter
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      {/* -------------------------------------------------- recently listed */}
      <div className="section-head">
        <h2>Recently listed</h2>
        <Link href="/listings">See all →</Link>
      </div>
      {recent.rows.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing listed yet</h2>
          <p>Be the first to put something up for the community.</p>
          <Link className="button" href="/listings/new">Create a listing</Link>
        </div>
      ) : (
        <div className="grid listing-grid">
          {recent.rows.map((row) => (
            <Link className="card listing-card" href={`/listings/${row.id}`} key={row.id}>
              <div className="listing-card__image" aria-hidden="true">Collectible preview</div>
              <div className="listing-card__body">
                <div>
                  <span className={`pill tag tag--${row.category}`}>{row.category.replace('_', ' ')}</span>{' '}
                  <span className={`pill tag ${row.saleType === 'auction' ? 'tag--auction' : 'tag--sale'}`}>{saleLabel(row.saleType)}</span>
                </div>
                <h3 style={{ marginTop: 12 }}>{row.title}</h3>
                <p className="listing-card__price num">
                  {row.saleType === 'auction'
                    ? formatMoney(row.currentBidCents ?? row.startBidCents ?? 0)
                    : formatMoney(row.priceCents ?? 0)}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  by {row.sellerName}
                  {row.saleType === 'auction' && ` · ${row.bidCount} bid${row.bidCount === 1 ? '' : 's'}`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
