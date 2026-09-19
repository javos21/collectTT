'use client';

import { useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';

export function ShareListingsButton({
  path,
  sellerName,
  className = 'seller-share-button',
}: {
  path: string;
  sellerName: string;
  className?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const resetLater = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setStatus('idle'), 2500);
  };

  const share = async () => {
    const url = new URL(path, window.location.origin).toString();
    const title = `${sellerName}'s active listings on CollectTT`;

    if (navigator.share !== undefined) {
      try {
        await navigator.share({ title, text: `Browse ${sellerName}'s active listings on CollectTT.`, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
    resetLater();
  };

  return (
    <button className={className} type="button" onClick={share} aria-live="polite">
      <Share2 size={17} aria-hidden="true" />
      <span>{status === 'copied' ? 'Link copied' : status === 'error' ? 'Copy failed' : 'Share listings'}</span>
    </button>
  );
}
