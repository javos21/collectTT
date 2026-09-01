import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRound } from 'lucide-react';
import { Building05, CoinsSwap01, Plus, SearchLg, UserCircle } from '@untitledui/icons';
import '@fontsource-variable/inter';
import '@fontsource/space-mono/400.css';
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
      <Link href="/listings"><SearchLg className="nav-icon" aria-hidden="true" />Browse</Link>
      <Link href="/listings/new"><Plus className="nav-icon" aria-hidden="true" />Sell</Link>
      <Link href="/deals"><CoinsSwap01 className="nav-icon" aria-hidden="true" />My deals</Link>
      {stores.length > 0 && <Link href="/store"><Building05 className="nav-icon" aria-hidden="true" />Store</Link>}
      {viewer === null ? (
        <Link href="/sign-in"><UserRound className="nav-icon" aria-hidden="true" />Sign in</Link>
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
            <img className="brand-logo" src="/assets/collecttt_logo.png" alt="CollectTT" />
          </Link>
          <span className="phase">Collect with confidence</span>
          <SiteNavigation />
        </header>
        <div className="wrap">{children}</div>
        <footer className="site-footer">
          <div className="site-footer__inner">
            <div className="site-footer__top">
              <div className="site-footer__brand">
                <Link className="site-footer__brand-link" href="/" aria-label="CollectTT home">
                  <img className="site-footer__logo" src="/assets/collecttt_logo.png" alt="CollectTT" />
                </Link>
                <p>Collect with confidence across Trinidad &amp; Tobago.</p>
              </div>
              <nav className="site-footer__nav" aria-labelledby="footer-explore-title">
                <h2 id="footer-explore-title">Explore</h2>
                <Link href="/listings">Browse</Link>
                <Link href="/listings?category=trading_card">Trading Cards</Link>
                <Link href="/listings?category=comic">Comics</Link>
                <Link href="/listings?category=collectible">Collectibles</Link>
              </nav>
              <nav className="site-footer__nav" aria-labelledby="footer-account-title">
                <h2 id="footer-account-title">Account</h2>
                <Link href="/listings/new">Sell</Link>
                <Link href="/deals">My Deals</Link>
                <Link href="/sign-in">Sign In</Link>
              </nav>
              <nav className="site-footer__nav" aria-labelledby="footer-legal-title">
                <h2 id="footer-legal-title">Legal</h2>
                <Link href="/privacy-policy">Privacy Policy</Link>
                <Link href="/terms-of-service">Terms of Service</Link>
              </nav>
            </div>
            <div className="site-footer__bottom">
              <span>© {new Date().getFullYear()} CollectTT</span>
              <span className="site-footer__powered-by">
                <span>Powered by</span>
                <a href="https://www.chaconialabs.com" target="_blank" rel="noreferrer" aria-label="Chaconia Labs website">
                  <img src="/assets/chaconia-labs-lockup.png" alt="Chaconia Labs" />
                </a>
              </span>
            </div>
          </div>
        </footer>
        <nav className="mobile-tabs" aria-label="Mobile navigation">
          <Link href="/listings"><SearchLg aria-hidden="true" /><span>Browse</span></Link>
          <Link href="/listings/new"><Plus aria-hidden="true" /><span>Sell</span></Link>
          <Link href="/deals"><CoinsSwap01 aria-hidden="true" /><span>Deals</span></Link>
          <Link href="/me"><UserCircle aria-hidden="true" /><span>Profile</span></Link>
        </nav>
      </body>
    </html>
  );
}
