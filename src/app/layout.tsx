import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { storesForStaff } from '@/services/custody';

export const metadata: Metadata = {
  title: 'CollectTT',
  description:
    'Trust and coordination for trading cards, comics and collectibles in Trinidad & Tobago.',
};

/**
 * ★ The store board's ONLY entry point. Phase 2's deliverable is "stores get their
 *   control tool", and until this link existed a clerk had to be told the URL. Shown
 *   only to people who are actually staff somewhere: a member who is not learns
 *   nothing about which stores exist, which is the same rule /store itself follows.
 */
async function StoreLink() {
  const viewer = await currentUser();
  if (viewer === null) return null;
  const stores = await storesForStaff(db, viewer.userId);
  if (stores.length === 0) return null;
  return <Link href="/store">Store</Link>;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <Link className="brand" href="/">
            CollectTT
          </Link>
          <span className="muted">Phase 0</span>
          <nav>
            <Link href="/listings">Browse</Link>
            <Link href="/listings/new">Sell</Link>
            <Link href="/deals">My deals</Link>
            <StoreLink />
            <Link href="/me">Profile</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </header>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
