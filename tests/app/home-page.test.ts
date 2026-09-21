import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('home page', () => {
  it('shows the Store application CTA in the v1 marketplace', async () => {
    const source = await readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("isLegacyFeatureAllowed('store_custody')");
    expect(source).toContain('href="/store/apply"');
    expect(source).toContain('Create Store Application');
  });
});
