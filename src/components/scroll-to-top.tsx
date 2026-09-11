'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Keep new route views anchored at the top while allowing intentional hash targets. */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.location.hash !== '') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return null;
}
