import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'CollectTT',
  description:
    'Trust and coordination for trading cards, comics and collectibles in Trinidad & Tobago.',
};

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
            <Link href="/me">Profile</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </header>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
