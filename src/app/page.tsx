import Link from 'next/link';
import { ArrowRight, Gavel, Plus, Search, Tag } from 'lucide-react';

import { browseListings, recentlyClaimedListings } from '@/services/listings';
import { HomeListingCarousel, HomeListingGrid, type HomeListingRow } from './home-listing-carousel';
import { areAuctionsVisible, isLegacyFeatureAllowed } from '@/lib/launch-scope';

export const dynamic = 'force-dynamic';

type BrowseRow = Awaited<ReturnType<typeof browseListings>>['rows'][number];

function toHomeListingRow(row: BrowseRow): HomeListingRow {
  return {
    id: row.id,
    title: row.title,
    primaryImageId: row.primaryImageId,
    saleType: row.saleType,
    currentBidCents: row.currentBidCents,
    startBidCents: row.startBidCents,
    priceCents: row.priceCents,
    endsAt: row.endsAt?.toISOString() ?? null,
    acceptsOffers: row.acceptsOffers,
    liveClaimCount: row.liveClaimCount,
    claimedAt: null,
  };
}

const RECENT_CATEGORY_SECTIONS = [
  {
    category: 'trading_card',
    title: 'Recent Card Listings',
    description: 'The newest trading cards from local collectors.',
    pageParam: 'cardPage',
    id: 'recent-cards',
  },
  {
    category: 'comic',
    title: 'Recent Comic Listings',
    description: 'Fresh issues, variants, and graded comics.',
    pageParam: 'comicPage',
    id: 'recent-comics',
  },
  {
    category: 'collectible',
    title: 'Recent Collectible Listings',
    description: 'Recently added figures, memorabilia, and more.',
    pageParam: 'collectiblePage',
    id: 'recent-collectibles',
  },
] as const;

type RecentPageParam = (typeof RECENT_CATEGORY_SECTIONS)[number]['pageParam'];

function pageNumber(value: string | string[] | undefined): number {
  return Math.max(1, Number.parseInt(typeof value === 'string' ? value : '1', 10) || 1);
}

function recentPageHref(
  pageParam: RecentPageParam,
  page: number,
  pages: Record<RecentPageParam, number>,
  anchor: string,
): string {
  const query = new URLSearchParams();

  for (const section of RECENT_CATEGORY_SECTIONS) {
    const nextPage = section.pageParam === pageParam ? page : pages[section.pageParam];
    if (nextPage > 1) query.set(section.pageParam, String(nextPage));
  }

  const search = query.toString();
  return `${search === '' ? '/' : `/?${search}`}#${anchor}`;
}

type RecentlyClaimedRow = Awaited<ReturnType<typeof recentlyClaimedListings>>[number];

function toRecentlyClaimedRow(row: RecentlyClaimedRow): HomeListingRow {
  return {
    id: row.id,
    title: row.title,
    primaryImageId: row.primaryImageId,
    saleType: 'straight_sale',
    currentBidCents: null,
    startBidCents: null,
    priceCents: row.priceCents,
    endsAt: null,
    acceptsOffers: false,
    liveClaimCount: 0,
    claimedAt: row.claimedAt.toISOString(),
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auctionsVisible = areAuctionsVisible();
  const params = await searchParams;
  const recentPages = Object.fromEntries(
    RECENT_CATEGORY_SECTIONS.map((section) => [section.pageParam, pageNumber(params[section.pageParam])]),
  ) as Record<RecentPageParam, number>;

  const [recentlyClaimed, auctions, categoryPages] = await Promise.all([
    recentlyClaimedListings(16),
    auctionsVisible
      ? browseListings({ saleType: 'auction', pageSize: 16, sort: 'ending_soon' })
      : Promise.resolve(null),
    Promise.all(RECENT_CATEGORY_SECTIONS.map((section) => browseListings({
        category: section.category,
        saleType: 'straight_sale',
        surface: 'recent',
        page: recentPages[section.pageParam],
        pageSize: 4,
        sort: 'newest',
      }))),
  ]);

  const total = categoryPages.reduce((sum, page) => sum + page.total, 0);

  return (
    <main className="home-page">
      {/* The landing surface is intentionally brighter and more catalog-like than the operational app shell. */}
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__orb home-hero__orb--one" aria-hidden="true" />
        <div className="home-hero__orb home-hero__orb--two" aria-hidden="true" />
        <div className="home-hero__main">
          <div className="home-hero__content">
            <h1 id="home-title">Find Your Next Great <span className="home-hero__accent">Collectible.</span></h1>
            <p className="home-hero__lede">Trade cards, comics, and collectibles with collectors across Trinidad &amp; Tobago.</p>
            <div className="home-search-row">
              <form className="home-search" action="/listings" method="get" role="search">
                <Search aria-hidden="true" />
                <label className="sr-only" htmlFor="home-search-input">Search listings</label>
                <input id="home-search-input" name="q" type="search" placeholder="Search listings" />
                <button type="submit">Search</button>
              </form>
              <Link className="home-browse-all" href="/listings?saleType=straight_sale"><Tag aria-hidden="true" />Browse all sale listings</Link>
            </div>
            {auctionsVisible && <div className="home-browse-actions" aria-label="Browse auction listings">
              <Link className="home-browse-action home-browse-action--auction" href="/listings?saleType=auction">
                <span className="home-browse-action__icon"><Gavel aria-hidden="true" /></span>
                <span>Browse All Auctions Listings</span>
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>}
          </div>
        </div>
      </section>

      {auctions !== null && <section className="home-section" aria-labelledby="auction-title">
        <div className="home-section__heading">
          <div><h2 id="auction-title">Live Auctions</h2></div>
          <Link href="/listings?saleType=auction">See All <ArrowRight aria-hidden="true" /></Link>
        </div>
        {auctions.rows.length > 0 ? (
          <HomeListingCarousel label="live auctions" rows={auctions.rows.map(toHomeListingRow)} />
        ) : (
          <div className="home-empty"><strong>No live auctions yet.</strong><span>Check back soon or list something for the community.</span></div>
        )}
      </section>}

      <div className="home-recent-groups" aria-label="Recent sale listings by category">
        {RECENT_CATEGORY_SECTIONS.map((section, index) => {
          const categoryPage = categoryPages[index]!;
          const currentPage = categoryPage.page;
          const totalPages = Math.max(1, Math.ceil(categoryPage.total / categoryPage.pageSize));

          return (
            <section className="home-section home-section--recent" id={section.id} key={section.category} aria-labelledby={`${section.id}-title`}>
              <div className="home-section__heading">
                <div><h2 id={`${section.id}-title`}>{section.title}</h2><p>{section.description}</p></div>
                <Link href={`/listings?category=${section.category}&saleType=straight_sale`}>See All <ArrowRight aria-hidden="true" /></Link>
              </div>
              {categoryPage.rows.length > 0 ? (
                <HomeListingGrid label={section.title.toLowerCase()} rows={categoryPage.rows.map(toHomeListingRow)} />
              ) : (
                <div className="home-empty"><strong>No {section.title.replace('Recent ', '').toLowerCase()} yet.</strong><span>Be the first to put one up for the community.</span><Link className="button" href="/listings/new">Create a listing</Link></div>
              )}
              {totalPages > 1 && (
                <nav className="home-category-pager" aria-label={`${section.title} pagination`}>
                  {currentPage > 1 ? (
                    <Link href={recentPageHref(section.pageParam, currentPage - 1, recentPages, section.id)} rel="prev">Previous</Link>
                  ) : (
                    <span aria-disabled="true">Previous</span>
                  )}
                  <strong className="num">Page {currentPage} of {totalPages}</strong>
                  {currentPage < totalPages ? (
                    <Link href={recentPageHref(section.pageParam, currentPage + 1, recentPages, section.id)} rel="next">Next</Link>
                  ) : (
                    <span aria-disabled="true">Next</span>
                  )}
                </nav>
              )}
            </section>
          );
        })}
      </div>
      <p className="home-catalog-note"><span className="home-catalog-note__dot" aria-hidden="true" /> {total} active sale listing{total === 1 ? '' : 's'} across the catalog · secure local handoff options available</p>

      <section className="home-sell-prompt" aria-labelledby="sell-prompt-title">
        <div>
          <h2 id="sell-prompt-title">Have something to sell?</h2>
          <p>Give your collectible a new home with collectors across Trinidad &amp; Tobago.</p>
        </div>
        <Link className="home-sell-prompt__cta" href="/listings/new">
          <Plus aria-hidden="true" />Create Listing
        </Link>
      </section>

      <section className="home-section home-section--recent" aria-labelledby="recently-claimed-title">
        <div className="home-section__heading">
          <div><h2 id="recently-claimed-title">Recently Claimed</h2><p>See what collectors are picking up right now.</p></div>
          <Link href="/listings?saleType=straight_sale">See All <ArrowRight aria-hidden="true" /></Link>
        </div>
        {recentlyClaimed.length > 0 ? (
          <HomeListingCarousel label="recently claimed listings" rows={recentlyClaimed.map(toRecentlyClaimedRow)} />
        ) : (
          <div className="home-empty"><strong>No recent claims yet.</strong><span>When collectors claim items, they will appear here.</span></div>
        )}
      </section>

      {isLegacyFeatureAllowed('store_custody') && <section className="home-sell-prompt home-store-prompt" aria-labelledby="store-prompt-title">
        <div>
          <h2 id="store-prompt-title">Have a storefront?</h2>
          <p>Want to join the community? Create a Store application here.</p>
        </div>
        <Link className="home-sell-prompt__cta" href="/store/apply">
          Create Store Application
        </Link>
      </section>}
    </main>
  );
}
