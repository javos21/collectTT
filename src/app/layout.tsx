import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { storesForStaff } from '@/services/custody';

export const metadata: Metadata = {
  title: 'CollectTT — Collect with confidence',
  description: 'A trusted, peer-to-peer home for trading cards, comics and collectibles in Trinidad & Tobago.',
};

function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return letters || 'C';
}

async function SiteNavigation() {
  const viewer = await currentUser();
  const stores = viewer === null ? [] : await storesForStaff(db, viewer.userId);

  return (
    <nav aria-label="Primary navigation">
      <Link href="/listings">Browse</Link>
      <Link href="/listings/new">Sell</Link>
      <Link href="/deals">My deals</Link>
      {stores.length > 0 && <Link href="/store">Store</Link>}
      {viewer === null ? (
        <Link href="/sign-in">Sign in</Link>
      ) : (
        <Link className="user-nav" href="/me" aria-label={`Open ${viewer.displayName} profile`}>
          {viewer.image === null ? (
            <span className="user-nav__avatar" aria-hidden="true">{initials(viewer.displayName)}</span>
          ) : (
            <img className="user-nav__avatar" src={viewer.image} alt="" />
          )}
          <span>{viewer.displayName}</span>
        </Link>
      )}
    </nav>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <Link className="brand" href="/" aria-label="CollectTT home">
            <span className="brand-mark">C</span>CollectTT
          </Link>
          <span className="phase">Collect with confidence</span>
          <SiteNavigation />
        </header>
        <div className="wrap">{children}</div>
        <nav className="mobile-tabs" aria-label="Mobile navigation">
          <Link href="/listings"><span>⌕</span><span>Browse</span></Link>
          <Link href="/listings/new"><span>＋</span><span>Sell</span></Link>
          <Link href="/deals"><span>◷</span><span>Deals</span></Link>
          <Link href="/me"><span>●</span><span>Profile</span></Link>
        </nav>
      </body>
    </html>
  );
}
