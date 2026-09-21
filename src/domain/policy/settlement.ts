/**
 * Payment methods a seller may accept for a listing.
 *
 * Delivery and payment are separate choices at checkout. Keeping this list in the
 * domain layer lets the listing form, buyer forms, and server-side actions share the
 * same vocabulary without importing the database-backed listing service into a client
 * component.
 */
/** Stable admin-managed payment option key. */
export type SettlementMethod = string;

export function isSettlementMethod(value: string): value is SettlementMethod {
  return value.trim().length > 0;
}
