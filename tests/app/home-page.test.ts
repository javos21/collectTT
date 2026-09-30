import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('home page', () => {
  it('shows the Store application CTA in the v1 marketplace', async () => {
    const source = await readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("isLegacyFeatureAllowed('store_custody')");
    expect(source).toContain('href="/store/apply"');
    expect(source).toContain('Create Store Application');
  });

  it('puts the paged recent-sale grid before the seller, claimed, and store sections', async () => {
    const source = await readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("pageSize: 24");
    expect(source).toContain('<HomeListingGrid label="recent sale listings"');
    expect(source).toContain('<section className="home-sell-prompt" aria-labelledby="sell-prompt-title">');
    expect(source.indexOf('id="recent-title"')).toBeLessThan(source.indexOf('id="sell-prompt-title"'));
    expect(source.indexOf('id="sell-prompt-title"')).toBeLessThan(source.indexOf('id="recently-claimed-title"'));
    expect(source.indexOf('id="recently-claimed-title"')).toBeLessThan(source.indexOf('id="store-prompt-title"'));
  });
});
