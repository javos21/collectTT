'use client';

import type { ReactNode, SyntheticEvent } from 'react';
import { useLayoutEffect, useState } from 'react';

type FilterPanelProps = {
  children: ReactNode;
};

export function FilterPanel({ children }: FilterPanelProps) {
  const [open, setOpen] = useState(true);

  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 820px)');
    let wasMobile = media.matches;

    const syncToViewport = () => {
      const isMobile = media.matches;
      if (isMobile !== wasMobile) {
        setOpen(!isMobile);
        wasMobile = isMobile;
      }
    };

    if (media.matches) setOpen(false);
    media.addEventListener('change', syncToViewport);
    return () => media.removeEventListener('change', syncToViewport);
  }, []);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const isMobile = window.matchMedia('(max-width: 820px)').matches;
    setOpen(isMobile ? event.currentTarget.open : true);
  };

  return (
    <details className="filter-panel" open={open} onToggle={handleToggle}>
      {children}
    </details>
  );
}
