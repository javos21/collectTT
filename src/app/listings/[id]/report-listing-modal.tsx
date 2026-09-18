'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

type ReportListingAction = (formData: FormData) => void | Promise<void>;

export function ReportListingModal({
  listingId,
  categories,
  action,
}: {
  listingId: string;
  categories: readonly string[];
  action: ReportListingAction;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const categoryId = useId();
  const detailId = useId();

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
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ) ?? [],
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

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="listing-report-card__action">
        <div>
          <h3>Something wrong with this listing?</h3>
          <p>Send a private report to CollectTT support.</p>
        </div>
        <button
          ref={triggerRef}
          className="secondary listing-report-trigger"
          type="button"
          aria-haspopup="dialog"
          onClick={() => setIsOpen(true)}
        >
          Report a problem
        </button>
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="listing-report-modal">
          <div className="listing-report-modal__backdrop" aria-hidden="true" onClick={close} />
          <section
            ref={dialogRef}
            className="listing-report-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <button
              ref={closeRef}
              className="listing-report-modal__close"
              type="button"
              onClick={close}
              aria-label="Close report form"
            >
              <X size={19} aria-hidden="true" />
            </button>

            <header className="listing-report-modal__header">
              <span className="listing-report-modal__icon" aria-hidden="true">
                <AlertTriangle size={19} />
              </span>
              <div>
                <p className="listing-report-modal__eyebrow">Private support report</p>
                <h2 id={titleId}>Report a problem</h2>
              </div>
            </header>

            <p id={descriptionId} className="listing-report-modal__note">
              Reports are private and reviewed by CollectTT support. The seller will not see who submitted one.
            </p>

            <form className="buybox__form listing-report-modal__form" action={action}>
              <input type="hidden" name="listingId" value={listingId} />
              <label htmlFor={categoryId}>Category</label>
              <select id={categoryId} name="category" required defaultValue="">
                <option value="" disabled>Select a category</option>
                {categories.map((category) => (
                  <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>
                ))}
              </select>
              <label htmlFor={detailId}>What should support review?</label>
              <textarea id={detailId} name="detail" minLength={10} maxLength={4000} rows={5} required />
              <div className="listing-report-modal__actions">
                <button className="secondary" type="button" onClick={close}>Cancel</button>
                <button type="submit">Send private report</button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
