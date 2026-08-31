import Link from 'next/link';
import { Activity, ArrowUpRight, ClipboardList, Gavel, LayoutDashboard, LibraryBig, ShieldCheck, Store, Users } from 'lucide-react';
import type { CurrentUser } from '../../../src/lib/session';

const marketplaceUrl = process.env.APP_URL ?? 'http://localhost:3000';

type ActiveNav = 'overview' | 'catalog' | 'stores';

export function AdminFrame({ viewer, activeNav, children }: { viewer: CurrentUser; activeNav: ActiveNav; children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Link className="admin-brand" href="/" aria-label="CollectTT Admin overview"><span className="admin-brand__dot" />CollectTT <em>Admin</em></Link>
        <div className="admin-topbar__actions">
          <span className="admin-topbar__user">{viewer.displayName}</span>
          <a className="admin-topbar__marketplace" href={marketplaceUrl}>Open marketplace <ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-sidebar__label">Workspace</p>
          <nav aria-label="Admin navigation">
            <Link className={activeNav === 'overview' ? 'is-active' : ''} href="/"><LayoutDashboard size={17} aria-hidden="true" />Overview</Link>
            <a href="/#listings"><ClipboardList size={17} aria-hidden="true" />Listings</a>
            <a href="/#members"><Users size={17} aria-hidden="true" />Members</a>
            <a href="/#deals"><Activity size={17} aria-hidden="true" />Deals</a>
            <Link className={activeNav === 'stores' ? 'is-active' : ''} href="/stores"><Store size={17} aria-hidden="true" />Stores</Link>
            <Link className={activeNav === 'catalog' ? 'is-active' : ''} href="/catalog"><LibraryBig size={17} aria-hidden="true" />Catalog</Link>
          </nav>
          <div className="admin-sidebar__note"><ShieldCheck size={17} aria-hidden="true" /><span>Admin actions should always leave an audit trail.</span></div>
        </aside>
        {children}
      </div>
    </div>
  );
}
