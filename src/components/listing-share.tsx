'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle2, Copy, Link2, MessageCircle, Share2, UsersRound, X } from 'lucide-react';

import { attributedShareUrl, listingShareText, type ShareSource } from '@/lib/listing-sharing';

type ShareMethod = 'clicked' | 'whatsapp' | 'facebook' | 'instagram_post' | 'instagram_story' | 'native' | 'copy_link';
type InstagramFormat = 'post' | 'story';

type ListingShareProps = {
  listingId: string;
  title: string;
  priceLabel: string;
  conditionLabel?: string | null;
  saleType: 'straight_sale' | 'auction';
  path: string;
  imagePath: string;
  success?: boolean;
};

const INSTAGRAM_SIZE: Record<InstagramFormat, { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawWrappedTitle(context: CanvasRenderingContext2D, title: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (context.measureText(candidate).width <= maxWidth || line === '') {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === 2) break;
    }
  }
  if (line !== '' && lines.length < 2) lines.push(line);
  if (lines.join(' ').length < title.trim().length) {
    const last = lines.length - 1;
    let lastLine = lines[last] ?? '';
    while (lastLine.length > 0 && context.measureText(`${lastLine}...`).width > maxWidth) lastLine = lastLine.slice(0, -1);
    lines[last] = `${lastLine.trimEnd()}...`;
  }
  lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
}

function loadShareImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function createInstagramFile(
  props: Pick<ListingShareProps, 'listingId' | 'title' | 'priceLabel' | 'conditionLabel' | 'saleType'>,
  format: InstagramFormat,
  image: HTMLImageElement | null,
): Promise<File> {
  const { width, height } = INSTAGRAM_SIZE[format];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas is unavailable');

  context.fillStyle = '#122c35';
  context.fillRect(0, 0, width, height);
  const margin = format === 'story' ? 64 : 54;
  const brandY = format === 'story' ? 118 : 82;
  const imageY = format === 'story' ? 220 : 150;
  const imageHeight = format === 'story' ? 1030 : 700;
  const contentY = imageY + imageHeight + (format === 'story' ? 86 : 62);

  context.fillStyle = '#ffffff';
  context.font = '800 48px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText('CollectTT', margin, brandY);
  context.fillStyle = '#84e1bc';
  context.font = '700 25px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'right';
  context.fillText('collecttt.com', width - margin, brandY - 6);
  context.textAlign = 'left';

  roundedRect(context, margin, imageY, width - margin * 2, imageHeight, 34);
  context.save();
  context.clip();
  if (image === null) {
    const fallback = context.createLinearGradient(margin, imageY, width - margin, imageY + imageHeight);
    fallback.addColorStop(0, '#087a58');
    fallback.addColorStop(1, '#1d4f5c');
    context.fillStyle = fallback;
    context.fillRect(margin, imageY, width - margin * 2, imageHeight);
  } else {
    drawImageCover(context, image, margin, imageY, width - margin * 2, imageHeight);
  }
  context.restore();

  context.fillStyle = '#84e1bc';
  context.font = '800 27px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(props.saleType === 'auction' ? 'LIVE AUCTION' : 'FOR SALE', margin, contentY);
  context.fillStyle = '#ffffff';
  context.font = `800 ${format === 'story' ? 58 : 50}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  drawWrappedTitle(context, props.title, margin, contentY + 68, width - margin * 2, format === 'story' ? 68 : 59);
  context.fillStyle = '#84e1bc';
  context.font = `800 ${format === 'story' ? 52 : 45}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.fillText(props.priceLabel, margin, contentY + (format === 'story' ? 235 : 200));
  if (props.conditionLabel !== null && props.conditionLabel !== undefined) {
    context.fillStyle = '#dff4eb';
    context.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText(props.conditionLabel, margin, contentY + (format === 'story' ? 292 : 248));
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value === null ? reject(new Error('Could not create share image')) : resolve(value), 'image/jpeg', 0.92);
  });
  return new File([blob], `collecttt-${props.listingId}-${format}.jpg`, { type: 'image/jpeg' });
}

function eventId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ListingShare(props: ListingShareProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'copied' | 'error' | 'preparing' | 'downloaded'>('idle');
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const [instagramFiles, setInstagramFiles] = useState<Partial<Record<InstagramFormat, File>>>({});
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resetTimer = useRef<number | null>(null);
  const mediaPromise = useRef<Promise<Partial<Record<InstagramFormat, File>>> | null>(null);
  const successTitleId = useId();
  const dialogTitleId = useId();
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
    void prepareInstagramMedia();
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

  async function prepareInstagramMedia(): Promise<Partial<Record<InstagramFormat, File>>> {
    if (instagramFiles.post !== undefined && instagramFiles.story !== undefined) return instagramFiles;
    if (mediaPromise.current !== null) return mediaPromise.current;
    setStatus('preparing');
    const imageUrl = new URL(props.imagePath, window.location.origin).toString();
    mediaPromise.current = (async () => {
      const image = await loadShareImage(imageUrl);
      const [post, story] = await Promise.all([
        createInstagramFile(props, 'post', image),
        createInstagramFile(props, 'story', image),
      ]);
      return { post, story };
    })();
    try {
      const files = await mediaPromise.current;
      setInstagramFiles(files);
      setStatus('idle');
      return files;
    } catch {
      setStatus('error');
      mediaPromise.current = null;
      return {};
    }
  }

  function downloadInstagramFile(file: File, format: InstagramFormat) {
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    record(format === 'post' ? 'instagram_post' : 'instagram_story');
    setStatus('downloaded');
    resetStatusLater();
  }

  async function shareToInstagram(format: InstagramFormat) {
    const files = instagramFiles[format] === undefined ? await prepareInstagramMedia() : instagramFiles;
    const file = files[format];
    if (file === undefined) return;
    const shareData = {
      files: [file],
      title: `${props.title} | CollectTT`,
      text: listingShareText({
        ...props,
        url: attributedShareUrl(canonicalUrl, format === 'post' ? 'instagram_post' : 'instagram_story'),
      }),
    };
    const canShareFile = typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
    if (!canShareFile) {
      downloadInstagramFile(file, format);
      return;
    }
    try {
      await navigator.share(shareData);
      record(format === 'post' ? 'instagram_post' : 'instagram_story');
      setIsOpen(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) downloadInstagramFile(file, format);
    }
  }

  function shareToWhatsApp() {
    const url = attributedShareUrl(canonicalUrl, 'whatsapp');
    const text = listingShareText({ ...props, url });
    record('whatsapp');
    const popup = window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    if (popup !== null) popup.opener = null;
  }

  function shareToFacebook() {
    const url = attributedShareUrl(canonicalUrl, 'facebook');
    record('facebook');
    const popup = window.open(
      `https://www.facebook.com/sharer/sharer.php?display=popup&u=${encodeURIComponent(url)}`,
      '_blank',
      'popup,width=640,height=720,noopener,noreferrer',
    );
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
    : status === 'preparing'
      ? 'Preparing Instagram post and story images…'
      : status === 'downloaded'
        ? 'Image downloaded. Open Instagram and add it to your post or story.'
    : status === 'error'
      ? 'Could not prepare sharing automatically. You can still copy the link below.'
      : 'Choose where to share this listing.';

  const shareDialog = isOpen && typeof document !== 'undefined' && createPortal(
    <div className="listing-share-modal">
      <div className="listing-share-modal__backdrop" aria-hidden="true" onClick={() => setIsOpen(false)} />
      <section
        ref={dialogRef}
        className="listing-share-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={descriptionId}
      >
        <button ref={closeRef} className="listing-share-modal__close" type="button" onClick={() => setIsOpen(false)} aria-label="Close share options">
          <X aria-hidden="true" />
        </button>
        <header className="listing-share-modal__header">
          <span aria-hidden="true"><Share2 /></span>
          <div>
            <p>Share listing</p>
            <h2 id={dialogTitleId}>{props.title}</h2>
          </div>
        </header>
        <p id={descriptionId} className="listing-share-modal__status" aria-live="polite">{statusMessage}</p>
        <div className="listing-share-modal__options" aria-busy={status === 'preparing'}>
          <button type="button" onClick={() => void shareToInstagram('post')} disabled={status === 'preparing'}><Camera aria-hidden="true" /><span><strong>Instagram post</strong><small>Portrait image sized 4:5</small></span></button>
          <button type="button" onClick={() => void shareToInstagram('story')} disabled={status === 'preparing'}><Camera aria-hidden="true" /><span><strong>Instagram story</strong><small>Full-screen image sized 9:16</small></span></button>
          <button type="button" onClick={shareToFacebook}><UsersRound aria-hidden="true" /><span><strong>Facebook</strong><small>Choose Feed, Group, or Page</small></span></button>
          <button type="button" onClick={shareToWhatsApp}><MessageCircle aria-hidden="true" /><span><strong>WhatsApp</strong><small>Send to a chat or group</small></span></button>
          <button type="button" onClick={() => void shareNative()}><Share2 aria-hidden="true" /><span><strong>More options…</strong><small>{nativeShareAvailable ? 'Open your device share sheet' : 'Copy the link on this browser'}</small></span></button>
          <button type="button" onClick={() => void copyUrl()}><Link2 aria-hidden="true" /><span><strong>Copy link</strong><small>Paste it anywhere</small></span></button>
        </div>
        <label className="listing-share-modal__link">
          <span>Listing link</span>
          <input readOnly value={attributedShareUrl(canonicalUrl, 'copy_link')} onFocus={(event) => event.currentTarget.select()} />
        </label>
      </section>
    </div>,
    document.body,
  );

  if (props.success) {
    return (
      <>
        <section className="listing-publish-success" aria-labelledby={successTitleId}>
          <span className="listing-publish-success__icon" aria-hidden="true"><CheckCircle2 /></span>
          <div className="listing-publish-success__copy">
            <p className="listing-publish-success__eyebrow">Published</p>
            <h2 id={successTitleId}>Your listing is live!</h2>
            <p>Share it with buyers while it is fresh.</p>
          </div>
          <div className="listing-publish-success__actions">
            <button type="button" onClick={open}><Share2 aria-hidden="true" />Share listing</button>
            <button className="secondary" type="button" onClick={shareToWhatsApp}><MessageCircle aria-hidden="true" />WhatsApp</button>
            <button className="secondary" type="button" onClick={() => void copyUrl()}><Copy aria-hidden="true" />{status === 'copied' ? 'Copied' : 'Copy link'}</button>
          </div>
          <p className="sr-only" aria-live="polite">{status === 'idle' ? '' : statusMessage}</p>
        </section>
        {shareDialog}
      </>
    );
  }

  return (
    <>
      <button ref={triggerRef} className="secondary listing-share-trigger" type="button" onClick={open} aria-haspopup="dialog">
        <Share2 aria-hidden="true" />
        Share
      </button>

      {shareDialog}
    </>
  );
}
