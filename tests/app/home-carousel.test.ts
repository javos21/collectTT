import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('home listing carousel', () => {
  it('keeps portrait listing photos fully visible in the thumbnail frame', async () => {
    const source = await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
    const blocks = [...source.matchAll(/\.home-listing-tile__image img\s*\{([^}]*)\}/g)].map((match) => match[1]);
    const finalImageRule = blocks.at(-1) ?? '';

    expect(finalImageRule).toContain('width: 100%');
    expect(finalImageRule).toContain('height: 100%');
    expect(finalImageRule).toContain('min-width: 0');
    expect(finalImageRule).toContain('min-height: 0');
    expect(finalImageRule).toContain('object-fit: contain');
    expect(finalImageRule).not.toContain('object-fit: cover');
  });
});
