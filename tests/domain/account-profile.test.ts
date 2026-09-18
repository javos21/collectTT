import { describe, expect, it } from 'vitest';

import { normalizePhoneE164 } from '../../src/services/account-profile';

describe('onboarding phone normalization', () => {
  it.each([
    ['555-0123', '+18685550123'],
    ['868-555-0123', '+18685550123'],
    ['1 (868) 555-0123', '+18685550123'],
    ['+44 7700 900123', '+447700900123'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhoneE164(input)).toBe(expected);
  });

  it('rejects ambiguous or invalid numbers', () => {
    expect(() => normalizePhoneE164('12345')).toThrow(/valid phone number/i);
  });
});
