import Link from 'next/link';
import { Activity, Bell, ClipboardList, FileClock, LayoutDashboard, LibraryBig, ShieldCheck, Store, Users } from 'lucide-react';

export type AdminNav = 'overview' | 'listings' | 'members' | 'deals' | 'notifications' | 'audit' | 'stores' | 'catalog' | 'settings';

export function AdminFrame({ activeNav, children }: { activeNav: AdminNav; children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <a className="admin-skip-link" href="#admin-main">Skip to main content</a>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-sidebar__label">Platform operations</p>
          <nav aria-label="Admin navigation">
            <Link aria-current={activeNav === 'overview' ? 'page' : undefined} className={activeNav === 'overview' ? 'is-active' : ''} href="/admin"><LayoutDashboard size={17} aria-hidden="true" />Overview</Link>
            <Link aria-current={activeNav === 'listings' ? 'page' : undefined} className={activeNav === 'listings' ? 'is-active' : ''} href="/admin/listings"><ClipboardList size={17} aria-hidden="true" />Listings</Link>
            <Link aria-current={activeNav === 'members' ? 'page' : undefined} className={activeNav === 'members' ? 'is-active' : ''} href="/admin/members"><Users size={17} aria-hidden="true" />Members</Link>
            <Link aria-current={activeNav === 'deals' ? 'page' : undefined} className={activeNav === 'deals' ? 'is-active' : ''} href="/admin/deals"><Activity size={17} aria-hidden="true" />Deals</Link>
            <Link aria-current={activeNav === 'notifications' ? 'page' : undefined} className={activeNav === 'notifications' ? 'is-active' : ''} href="/admin/notifications"><Bell size={17} aria-hidden="true" />Notifications</Link>
            <Link aria-current={activeNav === 'audit' ? 'page' : undefined} className={activeNav === 'audit' ? 'is-active' : ''} href="/admin/audit"><FileClock size={17} aria-hidden="true" />Audit log</Link>
            <Link aria-current={activeNav === 'stores' ? 'page' : undefined} className={activeNav === 'stores' ? 'is-active' : ''} href="/admin/stores"><Store size={17} aria-hidden="true" />Stores</Link>
            <Link aria-current={activeNav === 'catalog' ? 'page' : undefined} className={activeNav === 'catalog' ? 'is-active' : ''} href="/admin/catalog"><LibraryBig size={17} aria-hidden="true" />Catalog</Link>
            <Link aria-current={activeNav === 'settings' ? 'page' : undefined} className={activeNav === 'settings' ? 'is-active' : ''} href="/admin/settings"><ShieldCheck size={17} aria-hidden="true" />Settings</Link>
          </nav>
          <div className="admin-sidebar__note"><ShieldCheck size={17} aria-hidden="true" /><span>Admin actions should always leave an audit trail.</span></div>
        </aside>
        {children}
      </div>
    </div>
  );
}
