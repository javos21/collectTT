import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, UserRound } from 'lucide-react';
import { Building05, CoinsSwap01, Plus, SearchLg } from '@untitledui/icons';
import '@fontsource-variable/inter';
import '@fontsource/space-mono/400.css';
import './globals.css';

import { MobileNavigation } from '@/components/mobile-navigation';
import { ProfileMenu } from '@/components/profile-menu';
import { ScrollToTop } from '@/components/scroll-to-top';
import { signOutAction } from '@/app/auth-actions';
import { db } from '@/db/client';
import { adminAccess } from '@/lib/admin';
import { storesForStaff } from '@/services/custody';
import { countDealsNeedingAttention } from '@/services/deals';
import { countPendingOffersReceivedBySeller } from '@/services/offers';
import { isV1Launch } from '@/lib/launch-scope';

export const metadata: Metadata = {
  title: 'CollectTT — Collect with confidence',
  description: 'A trusted, peer-to-peer home for trading cards, comics and collectibles in Trinidad & Tobago.',
};

// Navigation is session-sensitive. Keep the shared shell fresh after auth changes.
export const dynamic = 'force-dynamic';

async function SiteNavigation() {
  const { viewer, isAdmin } = await adminAccess();
  const legacyFeaturesEnabled = !isV1Launch();
  const [stores, dealActionCount, offerActionCount] = viewer === null
    ? [[], 0, 0] as const
    : await Promise.all([
      storesForStaff(db, viewer.userId),
      countDealsNeedingAttention(db, viewer.userId),
      legacyFeaturesEnabled ? countPendingOffersReceivedBySeller(viewer.userId) : Promise.resolve(0),
    ]);
  const dealsAttentionCount = dealActionCount + offerActionCount;

  const dealsLabel = dealsAttentionCount > 0
    ? `My Deals, ${dealsAttentionCount} needing your attention`
    : 'My Deals';

  return (
    <>
      <nav aria-label="Primary navigation">
        <Link href="/listings"><SearchLg className="nav-icon" aria-hidden="true" />Browse</Link>
        <Link href="/listings/new"><Plus className="nav-icon" aria-hidden="true" />Sell</Link>
        {viewer !== null && (
          <Link
            className="nav-with-badge"
            href="/deals"
            aria-label={dealsLabel}
          >
            <CoinsSwap01 className="nav-icon" aria-hidden="true" />
            <span>My Deals</span>
            {dealsAttentionCount > 0 && (
              <span className="notification-badge" aria-hidden="true">
                {dealsAttentionCount > 99 ? '99+' : dealsAttentionCount}
              </span>
            )}
          </Link>
        )}
        {stores.length > 0 && <Link href="/store"><Building05 className="nav-icon" aria-hidden="true" />Store</Link>}
        {isAdmin && <Link href="/admin"><ShieldCheck className="nav-icon" aria-hidden="true" />Admin</Link>}
        {viewer === null ? (
          <Link href="/sign-in"><UserRound className="nav-icon" aria-hidden="true" />Log in</Link>
        ) : (
          <ProfileMenu displayName={viewer.displayName} image={viewer.image} signOutAction={signOutAction} />
        )}
      </nav>
      <MobileNavigation
        hasStore={stores.length > 0}
        isAdmin={isAdmin}
        signedIn={viewer !== null}
        dealsAttentionCount={dealsAttentionCount}
        signOutAction={signOutAction}
      />
    </>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ScrollToTop />
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
              <nav className="site-footer__nav site-footer__nav--legal" aria-labelledby="footer-legal-title">
                <h2 id="footer-legal-title">Legal</h2>
                <Link href="/privacy-policy">Privacy Policy</Link>
                <Link href="/terms-of-service">Terms of Service</Link>
                <Link href="/support">Support</Link>
                <Link href="/prohibited-items">Prohibited items</Link>
                <Link href="/minors-policy">Minors policy</Link>
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
      </body>
    </html>
  );
}
