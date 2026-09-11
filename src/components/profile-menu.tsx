'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut } from 'lucide-react';

import { profileTabs } from '@/lib/profile-tabs';

type ProfileMenuProps = {
  displayName: string;
  image: string | null;
  signOutAction: () => Promise<void>;
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

export function ProfileMenu({ displayName, image, signOutAction }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`profile-menu${open ? ' is-open' : ''}`} ref={menuRef}>
      <button
        ref={triggerRef}
        className="profile-menu__trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="profile-menu-dropdown"
        onClick={() => setOpen((current) => !current)}
      >
        {image === null ? (
          <span className="user-nav__avatar" aria-hidden="true">{initials(displayName)}</span>
        ) : (
          <img className="user-nav__avatar" src={image} alt="" />
        )}
        <span>{displayName}</span>
        <ChevronDown className="profile-menu__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id="profile-menu-dropdown" className="profile-menu__dropdown" role="menu" aria-label="Profile sections">
          <div className="profile-menu__heading">Profile</div>
          {profileTabs.map((tab) => (
            <Link
              key={tab.id}
              role="menuitem"
              href={`/me?tab=${tab.id}`}
              onClick={() => setOpen(false)}
            >
              {tab.label}
            </Link>
          ))}
          <form className="profile-menu__signout" action={signOutAction}>
            <button type="submit" role="menuitem">
              <LogOut size={16} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
