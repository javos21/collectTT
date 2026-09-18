'use client';

import type { MouseEvent, ReactNode, SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';

type FilterPanelProps = {
  children: ReactNode;
};

export function FilterPanel({ children }: FilterPanelProps) {
  const [desktop, setDesktop] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!desktop) setMobileOpen(event.currentTarget.open);
  };

  const preventDesktopCollapse = (event: MouseEvent<HTMLDetailsElement>) => {
    const target = event.target;
    if (
      desktop
      && target instanceof Element
      && target.closest('summary')?.parentElement === event.currentTarget
    ) {
      event.preventDefault();
    }
  };

  return (
    <details
      className="filter-panel"
      open={desktop || mobileOpen}
      onClick={preventDesktopCollapse}
      onToggle={handleToggle}
    >
      {children}
    </details>
  );
}
