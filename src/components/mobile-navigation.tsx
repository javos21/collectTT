'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Menu, UserRound, X } from 'lucide-react';
import { Building05, CoinsSwap01, Plus, SearchLg, UserCircle } from '@untitledui/icons';

type MobileNavigationProps = {
  hasStore: boolean;
  signedIn: boolean;
  dealsAttentionCount: number;
};

export function MobileNavigation({ hasStore, signedIn, dealsAttentionCount }: MobileNavigationProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  const dealsLabel = dealsAttentionCount > 0
    ? `My Deals, ${dealsAttentionCount} needing your attention`
    : 'My Deals';

  const drawer = (
    <div className={`mobile-drawer${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <button className="mobile-drawer__backdrop" type="button" aria-label="Close navigation menu" tabIndex={open ? 0 : -1} onClick={closeMenu} />
      <aside id="mobile-navigation-drawer" className="mobile-drawer__panel" role="dialog" aria-modal="true" aria-label="Mobile navigation">
        <div className="mobile-drawer__header">
          <strong>Menu</strong>
          <button ref={closeRef} className="mobile-drawer__close" type="button" aria-label="Close navigation menu" tabIndex={open ? 0 : -1} onClick={closeMenu}>
            <X aria-hidden="true" />
          </button>
        </div>
        <nav className="mobile-drawer__links">
          {signedIn ? (
            <Link href="/me" tabIndex={open ? 0 : -1} onClick={closeMenu}><UserCircle aria-hidden="true" /><span>Profile</span></Link>
          ) : (
            <Link href="/sign-in" tabIndex={open ? 0 : -1} onClick={closeMenu}><UserRound aria-hidden="true" /><span>Sign in</span></Link>
          )}
          {hasStore && <Link href="/store" tabIndex={open ? 0 : -1} onClick={closeMenu}><Building05 aria-hidden="true" /><span>Store</span></Link>}
          <Link href="/deals" aria-label={dealsLabel} tabIndex={open ? 0 : -1} onClick={closeMenu}>
            <CoinsSwap01 aria-hidden="true" />
            <span>My Deals</span>
            {dealsAttentionCount > 0 && (
              <span className="notification-badge" aria-hidden="true">
                {dealsAttentionCount > 99 ? '99+' : dealsAttentionCount}
              </span>
            )}
          </Link>
          <Link href="/listings/new" tabIndex={open ? 0 : -1} onClick={closeMenu}><Plus aria-hidden="true" /><span>Sell</span></Link>
          <Link href="/listings" tabIndex={open ? 0 : -1} onClick={closeMenu}><SearchLg aria-hidden="true" /><span>Browse</span></Link>
        </nav>
      </aside>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        className="mobile-menu-trigger"
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-navigation-drawer"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden="true" />
      </button>
      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
}
