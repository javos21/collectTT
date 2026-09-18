import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const adminActionFiles = [
  'src/app/admin/actions.ts',
  'src/app/admin/catalog/actions.ts',
  'src/app/admin/stores/actions.ts',
];

function actionBodies(source: string): Array<{ name: string; body: string }> {
  const matches = [...source.matchAll(/export async function (\w+Action)\([^]*?(?=\nexport async function|\s*$)/g)];
  return matches.map((match) => ({ name: match[1]!, body: match[0]! }));
}

describe('admin server-action authorization coverage', () => {
  it('keeps every admin mutation behind the shared admin-action guard', () => {
    for (const relativePath of adminActionFiles) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(source, relativePath).toContain('requireAdminAction');
      expect(source, relativePath).not.toMatch(/requireAdmin\(/);

      for (const action of actionBodies(source)) {
        expect(action.body, `${relativePath}:${action.name}`).toContain('requireAdminAction');
      }
    }
  });

  it('does not expose a mutation module without a matching authorization test target', () => {
    expect(adminActionFiles).toEqual([
      'src/app/admin/actions.ts',
      'src/app/admin/catalog/actions.ts',
      'src/app/admin/stores/actions.ts',
    ]);
  });
});
