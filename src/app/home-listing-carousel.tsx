'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BadgeCheck, Clock3, Eye } from 'lucide-react';

import { formatMoney } from '@/domain/money';

export interface HomeListingRow {
  id: string;
  title: string;
  primaryImageId: string | null;
  saleType: 'straight_sale' | 'auction';
  currentBidCents: number | null;
  startBidCents: number | null;
  priceCents: number | null;
  endsAt: string | null;
  acceptsOffers: boolean;
  liveClaimCount: number;
}

function priceFor(row: HomeListingRow): number {
  return row.saleType === 'auction'
    ? row.currentBidCents ?? row.startBidCents ?? 0
    : row.priceCents ?? 0;
}

function timeLeft(endsAt: string | null): string {
  if (endsAt === null) return 'Ends soon';
  const minutes = Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 60_000));
  if (minutes < 1) return 'Ending now';
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

function auctionUrgency(endsAt: string | null): 'urgent' | 'soon' | 'healthy' {
  if (endsAt === null) return 'soon';
  const hours = (new Date(endsAt).getTime() - Date.now()) / 3_600_000;
  if (hours < 12) return 'urgent';
  if (hours < 24) return 'soon';
  return 'healthy';
}

function ListingTile({ row }: { row: HomeListingRow }) {
  return (
    <Link className="home-listing-tile" href={`/listings/${row.id}`}>
      <div className="home-listing-tile__image">
        {row.primaryImageId ? (
          <img src={`/api/images/${row.primaryImageId}?variant=card`} alt="" />
        ) : (
          <span aria-hidden="true">Collectible preview</span>
        )}
      </div>
      <div className="home-listing-tile__body">
        <h3>{row.title}</h3>
        {row.saleType === 'auction' ? (
          <div className="home-listing-tile__auction-meta">
            <span className="home-listing-tile__price-label">Current bid</span>
            <strong className="num">{formatMoney(priceFor(row))}</strong>
            <span className={`home-listing-tile__time home-listing-tile__time--${auctionUrgency(row.endsAt)}`}>
              <Clock3 aria-hidden="true" />{timeLeft(row.endsAt)}
            </span>
          </div>
        ) : (
          <div className="home-listing-tile__sale-meta">
            <span className="home-listing-tile__price-label">Sale Price</span>
            <strong className="num">{formatMoney(priceFor(row))}</strong>
            {row.acceptsOffers && <span className="home-listing-tile__offers"><BadgeCheck aria-hidden="true" />Offers accepted</span>}
            {row.liveClaimCount > 0 && <span className="home-listing-tile__offers">First claim in progress · {row.liveClaimCount}/3 claimed</span>}
          </div>
        )}
        <span className="home-listing-tile__cta"><Eye aria-hidden="true" />{row.liveClaimCount > 0 ? 'Join queue' : 'View Listing'}</span>
      </div>
    </Link>
  );
}

interface HomeListingCarouselProps {
  label: string;
  rows: HomeListingRow[];
}

export function HomeListingCarousel({ label, rows }: HomeListingCarouselProps) {
  const [visibleCount, setVisibleCount] = useState(4);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 820px)');
    const syncVisibleCount = () => {
      setVisibleCount(media.matches ? 2 : 4);
      setPage(0);
    };
    syncVisibleCount();
    media.addEventListener('change', syncVisibleCount);
    return () => media.removeEventListener('change', syncVisibleCount);
  }, []);

  const pages = useMemo(() => {
    const pageRows: HomeListingRow[][] = [];
    for (let index = 0; index < rows.length; index += visibleCount) {
      pageRows.push(rows.slice(index, index + visibleCount));
    }
    return pageRows;
  }, [rows, visibleCount]);

  const pageCount = pages.length;
  const currentRows = pages[page] ?? pages[0] ?? [];

  return (
    <div className="home-carousel" aria-label={label} aria-roledescription="carousel">
      <div className="home-listing-grid home-carousel__grid" aria-live="polite">
        {currentRows.map((row) => <ListingTile key={row.id} row={row} />)}
      </div>
      <div className="home-carousel__controls">
        <button
          className="home-carousel__arrow"
          type="button"
          aria-label={`Previous ${label}`}
          disabled={page === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="home-carousel__progress" aria-live="polite">
          <span>{page + 1} / {pageCount}</span>
          <div className="home-carousel__dots" aria-hidden="true">
            {pages.map((_, index) => <span className={index === page ? 'is-active' : ''} key={index} />)}
          </div>
        </div>
        <button
          className="home-carousel__arrow"
          type="button"
          aria-label={`Next ${label}`}
          disabled={page >= pageCount - 1}
          onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
