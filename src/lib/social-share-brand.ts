export const SOCIAL_SHARE_BRAND = {
  navy: '#0B1D42',
  blue: '#4A46FA',
  red: '#FD5C63',
  lavender: '#DADCFC',
  ice: '#F8FAFD',
  slate: '#4A5773',
  white: '#FFFFFF',
} as const;

type SocialShareFormat = 'post' | 'story';

/** Paint the pale canvas and soft circular bands defined by the CollectTT brand kit. */
export function drawSocialShareBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  format: SocialShareFormat,
) {
  context.fillStyle = SOCIAL_SHARE_BRAND.ice;
  context.fillRect(0, 0, width, height);

  context.save();
  context.strokeStyle = SOCIAL_SHARE_BRAND.lavender;
  context.globalAlpha = 0.92;
  context.lineWidth = format === 'story' ? 150 : 125;
  context.beginPath();
  context.arc(width * 0.05, height * 0.18, width * 0.34, -1.15, 1.25);
  context.stroke();

  context.globalAlpha = 0.48;
  context.lineWidth = format === 'story' ? 120 : 100;
  context.beginPath();
  context.arc(width * 0.98, height * 0.83, width * 0.3, 1.75, 4.75);
  context.stroke();
  context.restore();
}

/** Draw the supplied logo artwork at a predictable width while preserving its proportions. */
export function drawSocialShareLogo(
  context: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  x: number,
  centerY: number,
  width = 190,
) {
  if (logo !== null && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const height = width * (logo.naturalHeight / logo.naturalWidth);
    context.drawImage(logo, x, centerY - height / 2, width, height);
    return;
  }

  context.fillStyle = SOCIAL_SHARE_BRAND.navy;
  context.font = '800 48px "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText('CollectTT', x, centerY + 16);
}
