'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Live auction feed via 2–3s polling, as the plan specifies. SSE is the upgrade path —
 * the server work (LISTEN/NOTIFY fan-out) is the same either way, so starting with
 * polling costs nothing and removes a moving part until it is actually needed.
 *
 * The countdown is rendered from a SERVER-supplied deadline. The client clock is used
 * only to animate between refreshes; it never decides anything.
 */
export function AuctionLive({
  endsAt,
  currentBid,
  bidCount,
  extensionCount,
  antisnipeWindowS,
  closed,
}: {
  endsAt: string;
  currentBid: string;
  bidCount: number;
  extensionCount: number;
  antisnipeWindowS: number;
  closed: boolean;
}) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(() => msUntil(endsAt));

  // Poll the server for new bids / extensions.
  useEffect(() => {
    if (closed) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router, closed]);

  // Tick the display between polls.
  useEffect(() => {
    if (closed) return;
    const id = setInterval(() => setRemaining(msUntil(endsAt)), 1000);
    return () => clearInterval(id);
  }, [endsAt, closed]);

  useEffect(() => setRemaining(msUntil(endsAt)), [endsAt]);

  const inSoftCloseWindow = remaining > 0 && remaining < antisnipeWindowS * 1000;

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{currentBid}</p>
      <p className="muted" style={{ margin: '.25rem 0' }}>
        {bidCount} bid{bidCount === 1 ? '' : 's'}
        {extensionCount > 0 && ` · extended ${extensionCount}×`}
      </p>

      {closed ? (
        <p className="muted" style={{ margin: 0 }}>Closed.</p>
      ) : (
        <>
          <p style={{ margin: '.25rem 0', fontWeight: 600 }}>
            {remaining <= 0 ? 'Closing…' : `${formatRemaining(remaining)} left`}
          </p>
          {inSoftCloseWindow && (
            <p className="muted" style={{ margin: 0 }}>
              Soft close: a bid now pushes the deadline out. It ends when bidding goes quiet.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function msUntil(iso: string): number {
  return new Date(iso).getTime() - Date.now();
}

function formatRemaining(ms: number): string {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
