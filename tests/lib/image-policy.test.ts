import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  SOURCE_WEBP_QUALITY,
  UPLOAD_CONTENT_TYPE,
} from '../../src/lib/image-policy';
import { originalKey, variantKey } from '../../src/lib/storage';

describe('image upload policy', () => {
  it('uses compressed WebP uploads within the configured source limits', () => {
    expect(UPLOAD_CONTENT_TYPE).toBe('image/webp');
    expect(MAX_IMAGE_DIMENSION).toBe(2400);
    expect(MAX_IMAGE_PIXELS).toBe(2400 * 2400);
    expect(SOURCE_WEBP_QUALITY).toBe(0.88);
  });

  it('keeps source and variants in deterministic image folders', () => {
    expect(originalKey('image-123')).toBe('images/image-123/source.webp');
    expect(variantKey('image-123', 'thumb')).toBe('images/image-123/variants/thumb.webp');
    expect(variantKey('image-123', 'card')).toBe('images/image-123/variants/card.webp');
    expect(variantKey('image-123', 'full')).toBe('images/image-123/variants/full.webp');
  });
});
