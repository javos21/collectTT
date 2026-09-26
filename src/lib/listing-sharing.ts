import { formatMoney } from '@/domain/money';
import { getCategory } from '@/domain/categories/definitions';

export type ShareSource = 'whatsapp' | 'native_share' | 'copy_link';

type ShareListing = {
  title: string;
  saleType: 'straight_sale' | 'auction';
  priceCents: number | null;
  startBidCents: number | null;
  currentBidCents: number | null;
  currency: string;
  category: string;
  attributes: unknown;
  status: string;
  sellerName: string;
};

function currencyFor(currency: string): 'TTD' | 'USD' {
  return currency === 'USD' ? 'USD' : 'TTD';
}

export function listingPriceLabel(listing: Pick<ShareListing, 'saleType' | 'priceCents' | 'startBidCents' | 'currentBidCents' | 'currency'>): string {
  const cents = listing.saleType === 'auction'
    ? listing.currentBidCents ?? listing.startBidCents
    : listing.priceCents;
  return cents === null ? 'Price on listing' : formatMoney(cents, currencyFor(listing.currency));
}

export function listingConditionLabel(listing: Pick<ShareListing, 'category' | 'attributes'>): string | null {
  if (typeof listing.attributes !== 'object' || listing.attributes === null) return null;
  const raw = (listing.attributes as Record<string, unknown>).condition;
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  try {
    const condition = getCategory(listing.category).attributes.find((attribute) => attribute.key === 'condition');
    return condition?.type === 'enum'
      ? condition.optionLabels?.[raw] ?? raw.replaceAll('_', ' ')
      : raw.replaceAll('_', ' ');
  } catch {
    return raw.replaceAll('_', ' ');
  }
}

function availabilityLabel(status: string): string | null {
  if (status === 'active') return null;
  if (status === 'claimed' || status === 'ended_won' || status === 'sold_outside') return 'This listing is no longer available.';
  if (status === 'expired') return 'This listing has expired.';
  if (status === 'ended_no_sale') return 'This auction has ended.';
  if (status === 'cancelled') return 'This listing was cancelled.';
  return 'View the listing for its current availability.';
}

export function listingSocialDescription(listing: ShareListing): string {
  const parts = [
    listing.saleType === 'auction'
      ? `Current bid ${listingPriceLabel(listing)}`
      : listingPriceLabel(listing),
    listingConditionLabel(listing) === null ? null : `Condition: ${listingConditionLabel(listing)}`,
    `Listed by ${listing.sellerName} on CollectTT.`,
    availabilityLabel(listing.status),
  ].filter((part): part is string => part !== null);
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 220);
}

export function listingShareText(input: {
  title: string;
  priceLabel: string;
  conditionLabel?: string | null;
  saleType: 'straight_sale' | 'auction';
  url: string;
}): string {
  return [
    input.saleType === 'auction' ? 'AUCTION' : 'FOR SALE',
    '',
    input.title,
    input.conditionLabel ?? null,
    input.priceLabel,
    '',
    'View on CollectTT:',
    input.url,
  ].filter((line): line is string => line !== null).join('\n');
}

export function attributedShareUrl(url: string, source: ShareSource): string {
  const attributed = new URL(url);
  attributed.searchParams.set('ref', 'share');
  attributed.searchParams.set('utm_source', source);
  attributed.searchParams.set('utm_medium', 'social');
  return attributed.toString();
}
