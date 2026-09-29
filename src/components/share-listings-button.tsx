'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Link2, MessageCircle, Share2, UsersRound, X } from 'lucide-react';

import { drawSocialShareBackground, drawSocialShareLogo, SOCIAL_SHARE_BRAND } from '@/lib/social-share-brand';

type SocialFormat = 'post' | 'story';
type ShareStatus = 'idle' | 'copied' | 'error' | 'preparing' | 'downloaded';
type SellerShareSource = 'facebook' | 'instagram_post' | 'instagram_story' | 'native_share' | 'copy_link' | 'whatsapp';

type ListingPreview = {
  title: string;
  imagePath: string | null;
};

type ShareListingsButtonProps = {
  path: string;
  sellerName: string;
  previews?: ListingPreview[];
  className?: string;
};

const SOCIAL_SIZE: Record<SocialFormat, { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

function attributedUrl(url: string, source: SellerShareSource): string {
  const attributed = new URL(url);
  attributed.searchParams.set('ref', 'share');
  attributed.searchParams.set('utm_source', source);
  attributed.searchParams.set('utm_medium', 'social');
  return attributed.toString();
}

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

function drawImageCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  context.drawImage(
    image,
    (image.naturalWidth - sourceWidth) / 2,
    (image.naturalHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function wrappedLines(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines = 2): string[] {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (context.measureText(candidate).width <= maxWidth || line === '') {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line !== '' && lines.length < maxLines) lines.push(line);
  if (lines.join(' ').length < value.trim().length) {
    const last = lines.length - 1;
    let finalLine = lines[last] ?? '';
    while (finalLine.length > 0 && context.measureText(`${finalLine}...`).width > maxWidth) finalLine = finalLine.slice(0, -1);
    lines[last] = `${finalLine.trimEnd()}...`;
  }
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function createSellerShareFile(
  sellerName: string,
  previews: ListingPreview[],
  images: Array<HTMLImageElement | null>,
  format: SocialFormat,
  logo: HTMLImageElement | null,
): Promise<File> {
  const { width, height } = SOCIAL_SIZE[format];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas is unavailable');

  const margin = format === 'story' ? 64 : 54;
  const headerY = format === 'story' ? 118 : 82;
  const titleY = format === 'story' ? 285 : 220;
  const gridY = format === 'story' ? 590 : 430;
  const gridHeight = format === 'story' ? 940 : 690;
  const gap = 22;
  const items = previews.slice(0, 4);
  const columns = items.length <= 1 ? 1 : 2;
  const rows = items.length <= 2 ? 1 : 2;
  const tileWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const tileHeight = (gridHeight - gap * (rows - 1)) / rows;

  drawSocialShareBackground(context, width, height, format);

  drawSocialShareLogo(context, logo, margin, headerY, 190);
  context.fillStyle = SOCIAL_SHARE_BRAND.slate;
  context.font = '700 25px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'right';
  context.fillText('collecttt.com', width - margin, headerY - 6);
  context.textAlign = 'left';

  context.fillStyle = SOCIAL_SHARE_BRAND.blue;
  context.font = '800 27px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText('SHOP MY ACTIVE LISTINGS', margin, titleY - 62);
  context.fillStyle = SOCIAL_SHARE_BRAND.navy;
  context.font = `800 ${format === 'story' ? 66 : 56}px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  wrappedLines(context, sellerName, width - margin * 2, 2).forEach((line, index) => {
    context.fillText(line, margin, titleY + index * (format === 'story' ? 76 : 64));
  });

  if (items.length === 0) {
    roundedRect(context, margin, gridY, width - margin * 2, gridHeight, 34);
    context.fillStyle = 'rgba(218,220,252,.72)';
    context.fill();
    context.fillStyle = SOCIAL_SHARE_BRAND.navy;
    context.font = `800 ${format === 'story' ? 58 : 48}px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.fillText('Fresh collectibles', width / 2, gridY + gridHeight / 2 - 10);
    context.fillText('available now', width / 2, gridY + gridHeight / 2 + 62);
    context.textAlign = 'left';
  } else {
    items.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + column * (tileWidth + gap);
      const y = gridY + row * (tileHeight + gap);
      context.save();
      context.shadowColor = 'rgba(11,29,66,.14)';
      context.shadowBlur = 22;
      context.shadowOffsetY = 9;
      roundedRect(context, x, y, tileWidth, tileHeight, 28);
      context.fillStyle = SOCIAL_SHARE_BRAND.white;
      context.fill();
      context.restore();
      roundedRect(context, x, y, tileWidth, tileHeight, 28);
      context.save();
      context.clip();
      const image = images[index] ?? null;
      if (image === null) {
        context.fillStyle = index % 2 === 0 ? SOCIAL_SHARE_BRAND.lavender : SOCIAL_SHARE_BRAND.blue;
        context.fillRect(x, y, tileWidth, tileHeight);
      } else {
        drawImageCover(context, image, x, y, tileWidth, tileHeight);
      }
      const overlay = context.createLinearGradient(0, y + tileHeight * 0.45, 0, y + tileHeight);
      overlay.addColorStop(0, 'rgba(11,29,66,0)');
      overlay.addColorStop(1, 'rgba(11,29,66,.92)');
      context.fillStyle = overlay;
      context.fillRect(x, y, tileWidth, tileHeight);
      context.fillStyle = SOCIAL_SHARE_BRAND.white;
      context.font = `750 ${format === 'story' ? 30 : 27}px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const titleLines = wrappedLines(context, item.title, tileWidth - 44, 2);
      titleLines.forEach((line, lineIndex) => {
        context.fillText(line, x + 22, y + tileHeight - 30 - (titleLines.length - 1 - lineIndex) * 38);
      });
      context.restore();
    });
  }

  context.fillStyle = SOCIAL_SHARE_BRAND.navy;
  context.font = `800 ${format === 'story' ? 36 : 32}px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.fillText('Browse the full collection on CollectTT', margin, height - (format === 'story' ? 185 : 115));
  context.fillStyle = SOCIAL_SHARE_BRAND.slate;
  context.font = '600 25px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText('Tap the link to search, filter, and shop', margin, height - (format === 'story' ? 132 : 68));
  context.fillStyle = SOCIAL_SHARE_BRAND.blue;
  context.font = '700 24px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText('Buy. Sell. Connect.', margin, height - (format === 'story' ? 82 : 30));

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value === null ? reject(new Error('Could not create share image')) : resolve(value), 'image/jpeg', 0.92);
  });
  return new File([blob], `collecttt-${format}-seller-listings.jpg`, { type: 'image/jpeg' });
}

export function ShareListingsButton({
  path,
  sellerName,
  previews = [],
  className = 'seller-share-button',
}: ShareListingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<ShareStatus>('idle');
  const [files, setFiles] = useState<Partial<Record<SocialFormat, File>>>({});
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resetTimer = useRef<number | null>(null);
  const mediaPromise = useRef<Promise<Partial<Record<SocialFormat, File>>> | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const canonicalUrl = useMemo(() => {
    if (typeof window === 'undefined') return path;
    return new URL(path, window.location.origin).toString();
  }, [path]);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
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

  const resetLater = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setStatus('idle'), 3000);
  };

  async function prepareMedia(): Promise<Partial<Record<SocialFormat, File>>> {
    if (files.post !== undefined && files.story !== undefined) return files;
    if (mediaPromise.current !== null) return mediaPromise.current;
    setStatus('preparing');
    mediaPromise.current = (async () => {
      const selectedPreviews = previews.slice(0, 4);
      const [loadedImages, logo] = await Promise.all([
        Promise.all(selectedPreviews.map((preview) => (
          preview.imagePath === null
            ? Promise.resolve(null)
            : loadImage(new URL(preview.imagePath, window.location.origin).toString())
        ))),
        loadImage('/assets/collecttt_logo.png'),
      ]);
      const [post, story] = await Promise.all([
        createSellerShareFile(sellerName, selectedPreviews, loadedImages, 'post', logo),
        createSellerShareFile(sellerName, selectedPreviews, loadedImages, 'story', logo),
      ]);
      return { post, story };
    })();
    try {
      const prepared = await mediaPromise.current;
      setFiles(prepared);
      setStatus('idle');
      return prepared;
    } catch {
      mediaPromise.current = null;
      setStatus('error');
      return {};
    }
  }

  function open() {
    setIsOpen(true);
    void prepareMedia();
  }

  function shareToWhatsApp() {
    const url = attributedUrl(canonicalUrl, 'whatsapp');
    const popup = window.open(
      `https://wa.me/?text=${encodeURIComponent(`Browse ${sellerName}'s active listings on CollectTT.\n\n${url}`)}`,
      '_blank',
      'noopener,noreferrer',
    );
    if (popup !== null) popup.opener = null;
  }

  function shareToFacebook() {
    const url = attributedUrl(canonicalUrl, 'facebook');
    const popup = window.open(
      `https://www.facebook.com/sharer/sharer.php?display=popup&u=${encodeURIComponent(url)}`,
      '_blank',
      'popup,width=640,height=720,noopener,noreferrer',
    );
    if (popup !== null) popup.opener = null;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(attributedUrl(canonicalUrl, 'copy_link'));
      setStatus('copied');
    } catch {
      setStatus('error');
    }
    resetLater();
  }

  function download(file: File) {
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setStatus('downloaded');
    resetLater();
  }

  async function shareToInstagram(format: SocialFormat) {
    const prepared = files[format] === undefined ? await prepareMedia() : files;
    const file = prepared[format];
    if (file === undefined) return;
    const source = format === 'post' ? 'instagram_post' : 'instagram_story';
    const shareData = {
      files: [file],
      title: `${sellerName}'s listings | CollectTT`,
      text: `Browse ${sellerName}'s active listings on CollectTT.\n${attributedUrl(canonicalUrl, source)}`,
    };
    const canShareFile = typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
    if (!canShareFile) {
      download(file);
      return;
    }
    try {
      await navigator.share(shareData);
      setIsOpen(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) download(file);
    }
  }

  async function shareNative() {
    const url = attributedUrl(canonicalUrl, 'native_share');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${sellerName}'s active listings on CollectTT`,
          text: `Browse ${sellerName}'s active listings on CollectTT.`,
          url,
        });
        setIsOpen(false);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copyLink();
  }

  const statusMessage = status === 'copied'
    ? 'Seller listings link copied.'
    : status === 'preparing'
      ? 'Preparing Instagram post and story collages…'
      : status === 'downloaded'
        ? 'Image downloaded. Open Instagram and add it to your post or story.'
        : status === 'error'
          ? 'Could not prepare sharing automatically. You can still select and copy the link below.'
          : 'Choose where to promote these active listings.';

  return (
    <>
      <button ref={triggerRef} className={className} type="button" onClick={open} aria-haspopup="dialog" aria-expanded={isOpen}>
        <Share2 size={17} aria-hidden="true" />
        <span>Share listings</span>
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
                <p>Share seller listings</p>
                <h2 id={titleId}>{sellerName}</h2>
              </div>
            </header>
            <p id={descriptionId} className="listing-share-modal__status" aria-live="polite">{statusMessage}</p>
            <div className="listing-share-modal__options" aria-busy={status === 'preparing'}>
              <button type="button" onClick={() => void shareToInstagram('post')} disabled={status === 'preparing'}><Camera aria-hidden="true" /><span><strong>Instagram post</strong><small>4:5 storefront collage</small></span></button>
              <button type="button" onClick={() => void shareToInstagram('story')} disabled={status === 'preparing'}><Camera aria-hidden="true" /><span><strong>Instagram story</strong><small>9:16 storefront collage</small></span></button>
              <button type="button" onClick={shareToFacebook}><UsersRound aria-hidden="true" /><span><strong>Facebook</strong><small>Choose Feed, Group, or Page</small></span></button>
              <button type="button" onClick={shareToWhatsApp}><MessageCircle aria-hidden="true" /><span><strong>WhatsApp</strong><small>Send the storefront link</small></span></button>
              <button type="button" onClick={() => void shareNative()}><Share2 aria-hidden="true" /><span><strong>More options…</strong><small>Open your device share sheet</small></span></button>
              <button type="button" onClick={() => void copyLink()}><Link2 aria-hidden="true" /><span><strong>Copy link</strong><small>Paste it anywhere</small></span></button>
            </div>
            <label className="listing-share-modal__link">
              <span>Seller listings link</span>
              <input readOnly value={attributedUrl(canonicalUrl, 'copy_link')} onFocus={(event) => event.currentTarget.select()} />
            </label>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
