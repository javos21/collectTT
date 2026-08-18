/**
 * Money is ALWAYS integer cents, never a float, never a Number holding dollars.
 *
 * We never touch anyone's money — these amounts are records of what buyer and seller
 * agreed between themselves, plus (later) our own service fees for logistics we
 * actually performed. Both still deserve exact arithmetic.
 */

export const DEFAULT_CURRENCY = 'TTD' as const;

export type Currency = 'TTD' | 'USD';

/** Cents, as a bigint-safe JS number. Postgres column is bigint. */
export type Cents = number;

export function toCents(amount: number): Cents {
  if (!Number.isFinite(amount)) throw new RangeError(`Not a finite amount: ${amount}`);
  return Math.round(amount * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

const SYMBOLS: Record<Currency, string> = {
  TTD: 'TT$',
  USD: 'US$',
};

export function formatMoney(cents: Cents, currency: Currency = DEFAULT_CURRENCY): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-TT');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${SYMBOLS[currency]}${whole}.${frac}`;
}

/** Parse user input ("1,250.50", "$1250.5", "1250") into cents. Returns null if unparseable. */
export function parseMoneyInput(input: string): Cents | null {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return toCents(value);
}

/**
 * The minimum a new bid must reach. Kept here rather than in the bid SQL so the UI can
 * show the same number the database will enforce.
 */
export function minimumNextBid(currentBidCents: Cents | null, startBidCents: Cents): Cents {
  if (currentBidCents === null) return startBidCents;
  return currentBidCents + bidIncrement(currentBidCents);
}

/** Increment ladder, in cents. Deliberately coarse — this is a community, not an exchange. */
export function bidIncrement(currentBidCents: Cents): Cents {
  if (currentBidCents < 5_00) return 50; // under TT$5      -> 50c
  if (currentBidCents < 50_00) return 1_00; // under TT$50     -> TT$1
  if (currentBidCents < 500_00) return 5_00; // under TT$500    -> TT$5
  if (currentBidCents < 5_000_00) return 25_00; // under TT$5,000 -> TT$25
  return 100_00; // above           -> TT$100
}
