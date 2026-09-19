/**
 * Versioned legal copy used by the sign-up record and the public legal pages.
 * Bump TERMS_VERSION whenever the Terms of Service change materially. A legal
 * review should confirm the operator details and publication date before launch.
 */
export const TERMS_VERSION = '2026-09-19-working-draft-1';
export const PRIVACY_VERSION = '2026-09-19-working-draft-1';

export function hasAcceptedTerms(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const record = body as Record<string, unknown>;
  return record.acceptTerms === true && record.termsVersion === TERMS_VERSION;
}
