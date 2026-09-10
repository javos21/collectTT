'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, MapPin, UserRound, X } from 'lucide-react';

export type BuyerSnapshotData = {
  userId: string;
  displayName: string;
  handle: string;
  area: string | null;
  memberSince: string;
  counters: {
    buyClaimsTotal: number;
    buyCompleted: number;
    buyReneged90d: number;
    buyPaidOnTime: number;
    sellCompleted: number;
    sellReneged90d: number;
  };
  events: Array<{
    id: string;
    type: string;
    title: string | null;
    occurredAt: string;
  }>;
};

const EVENT_LABELS: Record<string, string> = {
  purchase_completed: 'Purchase completed',
  sale_completed: 'Sale completed',
  buyer_paid_on_time: 'Payment made on time',
  buyer_paid_late: 'Payment made late',
  buyer_reneged_nonpayment: 'Buyer did not pay',
  buyer_no_show: 'Buyer no-show',
  seller_delivered_on_time: 'Delivery completed on time',
  seller_reneged_no_dropoff: 'Seller did not drop off',
  seller_no_show: 'Seller no-show',
  custody_overstay: 'Collection window overstay',
  admin_adjustment: 'Account adjustment',
};

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function date(value: string): string {
  return new Date(value).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'C';
}

export function BuyerSnapshotLink({
  snapshot,
  subjectLabel = 'Buyer',
  triggerClassName = 'deals-inbox-table__buyer-link',
  triggerLabel,
  triggerContent,
  showTriggerIcon = true,
}: {
  snapshot: BuyerSnapshotData;
  subjectLabel?: 'Buyer' | 'Seller';
  triggerClassName?: string;
  triggerLabel?: string;
  triggerContent?: ReactNode;
  showTriggerIcon?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const titleId = `buyer-snapshot-title-${snapshot.userId}`;
  const subject = subjectLabel.toLowerCase();
  const completedDeals = snapshot.counters.buyCompleted + snapshot.counters.sellCompleted;
  const paidOnTime = snapshot.counters.buyClaimsTotal > 0
    ? `${snapshot.counters.buyPaidOnTime} of ${snapshot.counters.buyClaimsTotal}`
    : 'No purchase history';

  useEffect(() => {
    if (!isOpen) return;

    const previousActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <a
        ref={triggerRef}
        className={triggerClassName}
        href={`/members/${snapshot.userId}`}
        aria-haspopup="dialog"
        aria-label={`View ${subject} trust snapshot for ${snapshot.displayName}`}
        onClick={(event) => {
          event.preventDefault();
          setIsOpen(true);
        }}
      >
        {showTriggerIcon && <UserRound aria-hidden="true" />}
        {triggerContent ?? triggerLabel ?? snapshot.displayName}
      </a>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="buyer-snapshot-modal">
          <div className="buyer-snapshot-modal__backdrop" aria-hidden="true" onClick={() => setIsOpen(false)} />
          <section
            ref={dialogRef}
            className="buyer-snapshot-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <button
              ref={closeRef}
              className="buyer-snapshot-modal__close"
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label={`Close ${subject} trust snapshot`}
            >
              <X size={18} aria-hidden="true" />
            </button>

            <header className="buyer-snapshot-modal__header">
              <div className="buyer-snapshot-modal__avatar" aria-hidden="true">{initials(snapshot.displayName)}</div>
              <div>
                <p className="buyer-snapshot-modal__eyebrow">{subjectLabel} trust snapshot</p>
                <h2 id={titleId}>{snapshot.displayName}</h2>
                <p className="buyer-snapshot-modal__meta">
                  @{snapshot.handle} · member since {date(snapshot.memberSince)}
                  {snapshot.area !== null && <><span aria-hidden="true"> · </span>{snapshot.area}</>}
                </p>
              </div>
            </header>

            <div className="buyer-snapshot-modal__metrics" aria-label="Trust summary">
              <div className="buyer-snapshot-modal__metric buyer-snapshot-modal__metric--primary">
                <strong>{completedDeals}</strong>
                <span>Completed deals</span>
              </div>
              <div className="buyer-snapshot-modal__metric">
                <strong>{snapshot.counters.buyCompleted}</strong>
                <span>Purchases</span>
              </div>
              <div className="buyer-snapshot-modal__metric">
                <strong>{snapshot.counters.sellCompleted}</strong>
                <span>Sales</span>
              </div>
              <div className="buyer-snapshot-modal__metric">
                <strong>{paidOnTime}</strong>
                <span>Paid on time</span>
              </div>
            </div>

            <section className="buyer-snapshot-modal__activity" aria-labelledby={`${titleId}-activity`}>
              <div className="buyer-snapshot-modal__section-heading">
                <div>
                  <h3 id={`${titleId}-activity`}>Recent verified activity</h3>
                  <p>Recorded outcomes that contribute to this snapshot.</p>
                </div>
                <span>{snapshot.events.length} shown</span>
              </div>

              {snapshot.events.length === 0 ? (
                <p className="buyer-snapshot-modal__empty">No verified activity yet.</p>
              ) : (
                <ol className="buyer-snapshot-modal__activity-list">
                  {snapshot.events.map((event) => (
                    <li key={event.id}>
                      <BadgeCheck size={17} aria-hidden="true" />
                      <div>
                        <strong>{eventLabel(event.type)}</strong>
                        <span>{event.title ?? 'CollectTT transaction'} · {date(event.occurredAt)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <p className="buyer-snapshot-modal__note">
              <MapPin size={15} aria-hidden="true" />
              Trust details are based on verified CollectTT transaction outcomes.
            </p>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
