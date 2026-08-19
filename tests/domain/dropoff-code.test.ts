import { describe, it, expect } from 'vitest';
import { generateDropoffCode, DROPOFF_CODE_ALPHABET } from '../../src/domain/dropoff-code';

describe('drop-off code', () => {
  it('has the CT- prefix and four body characters', () => {
    expect(generateDropoffCode()).toMatch(/^CT-[A-Z2-9]{4}$/);
  });

  it('excludes characters that can be misread', () => {
    for (const confusable of ['I', 'L', 'O', '0', '1']) {
      expect(DROPOFF_CODE_ALPHABET).not.toContain(confusable);
    }
    expect(DROPOFF_CODE_ALPHABET).toHaveLength(31);
  });

  it('does not repeat itself over a large sample', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateDropoffCode()));
    // 31^4 space, 2000 draws — a handful of collisions is expected, a flood is a bug.
    expect(seen.size).toBeGreaterThan(1950);
  });
});
