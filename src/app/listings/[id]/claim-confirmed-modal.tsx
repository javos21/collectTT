'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

export function ClaimConfirmedModal({
  transactionId,
  listingId,
}: {
  transactionId: string;
  listingId: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="claim-confirmed-modal" role="presentation">
      <div
        className="claim-confirmed-modal__dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-confirmed-title"
        aria-describedby="claim-confirmed-description"
        tabIndex={-1}
      >
        <p className="claim-confirmed-modal__eyebrow">Claim confirmed</p>
        <h2 id="claim-confirmed-title">Congratulations — you got it!</h2>
        <p id="claim-confirmed-description">Your deal is ready. Open it to review the payment deadline and next steps.</p>
        <div className="claim-confirmed-modal__actions">
          <Link className="button" href={`/deals/${transactionId}`}>
            Go to deal
          </Link>
          <Link className="button secondary" href={`/listings/${listingId}`}>
            Keep browsing
          </Link>
        </div>
      </div>
    </div>
  );
}
