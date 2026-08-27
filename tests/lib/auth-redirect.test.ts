import { describe, expect, it } from 'vitest';

import { safeAuthReturnTo } from '../../src/lib/auth-redirect';

describe('safeAuthReturnTo', () => {
  it('keeps local paths and their query strings', () => {
    expect(safeAuthReturnTo('/listings/abc?tab=offers')).toBe('/listings/abc?tab=offers');
  });

  it.each([
    undefined,
    ['/', '/admin'],
    'https://attacker.example',
    '//attacker.example',
    '/\\attacker.example',
    '/%5C%5Cattacker.example',
    '/%2F%2Fattacker.example',
    'javascript:alert(1)',
    '/member\nnext',
  ])('falls back to the account page for %j', (value) => {
    expect(safeAuthReturnTo(value)).toBe('/');
  });
});
