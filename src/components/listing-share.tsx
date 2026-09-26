'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Copy, Link2, MessageCircle, Share2, X } from 'lucide-react';

import { attributedShareUrl, listingShareText, type ShareSource } from '@/lib/listing-sharing';

type ShareMethod = 'clicked' | 'whatsapp' | 'native' | 'copy_link';

type ListingShareProps = {
  listingId: string;
  title: string;
  priceLabel: string;
  conditionLabel?: string | null;
  saleType: 'straight_sale' | 'auction';
  path: string;
  success?: boolean;
};

function eventId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ListingShare(props: ListingShareProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resetTimer = useRef<number | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const canonicalUrl = useMemo(() => {
    if (typeof window === 'undefined') return props.path;
    return new URL(props.path, window.location.origin).toString();
  }, [props.path]);

  useEffect(() => {
    setNativeShareAvailable(typeof navigator.share === 'function');
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled])',
      ) ?? []);
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

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [isOpen]);

  function record(method: ShareMethod) {
    void fetch('/api/analytics/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: props.listingId, method, eventId: eventId() }),
      keepalive: true,
    }).catch(() => undefined);
  }

  function open() {
    setIsOpen(true);
    record('clicked');
  }

  function resetStatusLater() {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setStatus('idle'), 3000);
  }

  async function copyUrl(source: ShareSource = 'copy_link') {
    const url = attributedShareUrl(canonicalUrl, source);
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy command was rejected');
      }
      setStatus('copied');
      record('copy_link');
    } catch {
      setStatus('error');
    }
    resetStatusLater();
  }

  function shareToWhatsApp() {
    const url = attributedShareUrl(canonicalUrl, 'whatsapp');
    const text = listingShareText({ ...props, url });
    record('whatsapp');
    const popup = window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    if (popup !== null) popup.opener = null;
  }

  async function shareNative() {
    if (typeof navigator.share !== 'function') {
      await copyUrl('native_share');
      return;
    }

    const url = attributedShareUrl(canonicalUrl, 'native_share');
    try {
      await navigator.share({
        title: `${props.title} | CollectTT`,
        text: listingShareText({ ...props, url }),
        url,
      });
      record('native');
      setIsOpen(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error');
    }
  }

  const statusMessage = status === 'copied'
    ? 'Link copied to your clipboard.'
    : status === 'error'
      ? 'Could not copy automatically. Select the link below.'
      : 'Choose where to share this listing.';

  if (props.success) {
    return (
      <section className="listing-publish-success" aria-labelledby={titleId}>
        <span className="listing-publish-success__icon" aria-hidden="true"><CheckCircle2 /></span>
        <div className="listing-publish-success__copy">
          <p className="listing-publish-success__eyebrow">Published</p>
          <h2 id={titleId}>Your listing is live!</h2>
          <p>Share it with buyers while it is fresh.</p>
        </div>
        <div className="listing-publish-success__actions">
          <button type="button" onClick={shareNative}><Share2 aria-hidden="true" />Share listing</button>
          <button className="secondary" type="button" onClick={shareToWhatsApp}><MessageCircle aria-hidden="true" />WhatsApp</button>
          <button className="secondary" type="button" onClick={() => void copyUrl()}><Copy aria-hidden="true" />{status === 'copied' ? 'Copied' : 'Copy link'}</button>
        </div>
        <p className="sr-only" aria-live="polite">{status === 'idle' ? '' : statusMessage}</p>
      </section>
    );
  }

  return (
    <>
      <button ref={triggerRef} className="secondary listing-share-trigger" type="button" onClick={open} aria-haspopup="dialog">
        <Share2 aria-hidden="true" />
        Share
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="listing-share-modal">
          <div className="listing-share-modal__backdrop" aria-hidden="true" onClick={() => setIsOpen(false)} />
          <section
            ref={dialogRef}
            className="listing-share-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <button ref={closeRef} className="listing-share-modal__close" type="button" onClick={() => setIsOpen(false)} aria-label="Close share options">
              <X aria-hidden="true" />
            </button>
            <header className="listing-share-modal__header">
              <span aria-hidden="true"><Share2 /></span>
              <div>
                <p>Share listing</p>
                <h2 id={titleId}>{props.title}</h2>
              </div>
            </header>
            <p id={descriptionId} className="listing-share-modal__status" aria-live="polite">{statusMessage}</p>
            <div className="listing-share-modal__options">
              <button type="button" onClick={shareToWhatsApp}><MessageCircle aria-hidden="true" /><span><strong>WhatsApp</strong><small>Send to a chat or group</small></span></button>
              <button type="button" onClick={() => void shareNative()}><Share2 aria-hidden="true" /><span><strong>Share…</strong><small>{nativeShareAvailable ? 'Open your device share sheet' : 'Copy the link on this browser'}</small></span></button>
              <button type="button" onClick={() => void copyUrl()}><Link2 aria-hidden="true" /><span><strong>Copy link</strong><small>Paste it anywhere</small></span></button>
            </div>
            <label className="listing-share-modal__link">
              <span>Listing link</span>
              <input readOnly value={attributedShareUrl(canonicalUrl, 'copy_link')} onFocus={(event) => event.currentTarget.select()} />
            </label>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
