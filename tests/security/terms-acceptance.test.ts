import { describe, expect, it } from 'vitest';

import { TERMS_VERSION, hasAcceptedTerms } from '@/lib/legal';

describe('account terms acceptance', () => {
  it('requires an explicit checkbox value and the current terms version', () => {
    expect(hasAcceptedTerms({ acceptTerms: true, termsVersion: TERMS_VERSION })).toBe(true);
    expect(hasAcceptedTerms({ acceptTerms: false, termsVersion: TERMS_VERSION })).toBe(false);
    expect(hasAcceptedTerms({ termsVersion: TERMS_VERSION })).toBe(false);
    expect(hasAcceptedTerms({ acceptTerms: true, termsVersion: 'older-version' })).toBe(false);
    expect(hasAcceptedTerms(null)).toBe(false);
  });
});
