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
    expect(page).toContain('`/api/images/${listing.firstImage.id}/social`');
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
    expect(component).toContain('https://www.facebook.com/sharer/sharer.php');
    expect(component).toContain('navigator.share');
    expect(component).toContain('navigator.clipboard');
    expect(component).toContain('Instagram post');
    expect(component).toContain('Instagram story');
    expect(component).toContain('Choose Feed, Group, or Page');
    expect(component).toContain("post: { width: 1080, height: 1350 }");
    expect(component).toContain("story: { width: 1080, height: 1920 }");
    expect(analytics).toContain("'listing_share_whatsapp'");
    expect(analytics).toContain("'listing_share_facebook'");
    expect(analytics).toContain("'listing_share_instagram_post'");
    expect(analytics).toContain("'listing_share_instagram_story'");
    expect(analytics).toContain("'listing_share_native'");
    expect(analytics).toContain("'listing_share_copy_link'");
  });

  it('creates seller storefront post and story collages from active listing previews', async () => {
    const [component, profile, member, catalog, listings] = await Promise.all([
      readFile(new URL('../../src/components/share-listings-button.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/me/profile-page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/members/[id]/page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/listings/page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/listings.ts', import.meta.url), 'utf8'),
    ]);

    expect(component).toContain("post: { width: 1080, height: 1350 }");
    expect(component).toContain("story: { width: 1080, height: 1920 }");
    expect(component).toContain('4:5 storefront collage');
    expect(component).toContain('9:16 storefront collage');
    expect(component).toContain('https://www.facebook.com/sharer/sharer.php');
    expect(component).toContain('https://wa.me/?text=');
    expect(component).toContain('navigator.share');
    expect(component).toContain("previews.slice(0, 4)");
    expect(profile).toContain('imagePath: listing.primaryImageId === null ? null');
    expect(member).toContain('previews={theirListings.slice(0, 4)');
    expect(catalog).toContain('previews={rows.slice(0, 4)');
    expect(listings).toContain('primaryImageId: sql<string | null>');
  });
});
