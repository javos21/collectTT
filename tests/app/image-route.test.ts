import { beforeEach, describe, expect, it, vi } from 'vitest';

const getImage = vi.fn();
const imageVariants = vi.fn();
const presignDownload = vi.fn();

vi.mock('../../src/services/images', () => ({
  deleteImage: vi.fn(),
  getImage,
  imageVariants,
}));

vi.mock('../../src/lib/storage', () => ({
  presignDownload,
}));

describe('GET /api/images/[id]', () => {
  beforeEach(() => {
    getImage.mockReset();
    imageVariants.mockReset();
    presignDownload.mockReset();
  });

  it('does not publicly cache redirects containing expiring signed URLs', async () => {
    getImage.mockResolvedValue({
      id: 'image-1',
      variants: { card: { key: 'images/image-1/variants/card.webp' } },
      r2KeyOriginal: 'images/image-1/source.webp',
    });
    imageVariants.mockReturnValue({ card: 'images/image-1/variants/card.webp' });
    presignDownload.mockResolvedValue('https://storage.example/signed-image');

    const { GET } = await import('../../src/app/api/images/[id]/route');
    const response = await GET(
      new Request('https://collecttt.test/api/images/image-1?variant=card'),
      { params: Promise.resolve({ id: 'image-1' }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
