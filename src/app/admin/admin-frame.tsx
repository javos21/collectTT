import Link from 'next/link';
import { Activity, ClipboardList, LayoutDashboard, LibraryBig, ShieldCheck, Store, Users } from 'lucide-react';

type ActiveNav = 'overview' | 'catalog' | 'stores' | 'settings';

export function AdminFrame({ activeNav, children }: { activeNav: ActiveNav; children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <nav aria-label="Admin navigation">
            <Link className={activeNav === 'overview' ? 'is-active' : ''} href="/admin"><LayoutDashboard size={17} aria-hidden="true" />Overview</Link>
            <a href="/admin#listings"><ClipboardList size={17} aria-hidden="true" />Listings</a>
            <a href="/admin#members"><Users size={17} aria-hidden="true" />Members</a>
            <a href="/admin#deals"><Activity size={17} aria-hidden="true" />Deals</a>
            <Link className={activeNav === 'stores' ? 'is-active' : ''} href="/admin/stores"><Store size={17} aria-hidden="true" />Stores</Link>
            <Link className={activeNav === 'catalog' ? 'is-active' : ''} href="/admin/catalog"><LibraryBig size={17} aria-hidden="true" />Catalog</Link>
            <Link className={activeNav === 'settings' ? 'is-active' : ''} href="/admin/settings"><ShieldCheck size={17} aria-hidden="true" />Settings</Link>
          </nav>
          <div className="admin-sidebar__note"><ShieldCheck size={17} aria-hidden="true" /><span>Admin actions should always leave an audit trail.</span></div>
        </aside>
        {children}
      </div>
    </div>
  );
}
