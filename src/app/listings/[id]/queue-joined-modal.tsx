'use client';

import Link from 'next/link';

export function QueueJoinedModal({ position, listingId }: { position: string; listingId: string }) {
  return (
    <div className="queue-modal" role="dialog" aria-modal="true" aria-labelledby="queue-modal-title">
      <div className="queue-modal__card">
        <p className="queue-modal__eyebrow">Backup queue</p>
        <h2 id="queue-modal-title">You&apos;re in the queue</h2>
        <p>You&apos;re <strong>#{position}</strong> in line. We&apos;ll notify you if the claim ahead of you falls through.</p>
        <Link className="button" href={`/listings/${listingId}`}>Continue to listing</Link>
      </div>
    </div>
  );
}
