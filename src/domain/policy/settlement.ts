/**
 * Payment methods a seller may accept for a listing.
 *
 * Delivery and payment are separate choices at checkout. Keeping this list in the
 * domain layer lets the listing form, buyer forms, and server-side actions share the
 * same vocabulary without importing the database-backed listing service into a client
 * component.
 */
export const SETTLEMENT_METHODS = ['cash', 'bank_transfer', 'linx', 'other'] as const;

/** Stable admin-managed payment option key. */
export type SettlementMethod = string;

export const SETTLEMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  linx: 'LINX',
  other: 'Other',
};

export function isSettlementMethod(value: string): value is SettlementMethod {
  return value.trim().length > 0;
}
