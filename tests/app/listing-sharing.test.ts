import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('listing social sharing integration', () => {
  it('uses server-rendered listing metadata and the ordered first image', async () => {
    const [page, listings] = await Promise.all([
      readFile(new URL('../../src/app/listings/[id]/page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/listings.ts', import.meta.url), 'utf8'),
    ]);

    expect(page).toContain('export async function generateMetadata');
    expect(page).toContain('alternates: { canonical: canonicalUrl }');
    expect(page).toContain("card: 'summary_large_image'");
    expect(page).toContain('publicUrl(imageKey)');
    expect(listings).toContain('.orderBy(asc(listingImages.position))');
    expect(listings).toContain('.limit(1)');
    expect(listings).toContain("sql`${listings.status} <> 'draft'`");
  });

  it('shows post-publish actions and records each share method', async () => {
    const [action, page, component, analytics] = await Promise.all([
      readFile(new URL('../../src/app/listings/new/actions.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/listings/[id]/page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/components/listing-share.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/analytics.ts', import.meta.url), 'utf8'),
    ]);

    expect(action).toContain('?published=1');
    expect(page).toContain('<ListingShare {...shareProps} success />');
    expect(component).toContain('https://wa.me/?text=');
    expect(component).toContain('navigator.share');
    expect(component).toContain('navigator.clipboard');
    expect(analytics).toContain("'listing_share_whatsapp'");
    expect(analytics).toContain("'listing_share_native'");
    expect(analytics).toContain("'listing_share_copy_link'");
  });
});
