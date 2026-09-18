import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('identity privacy surfaces', () => {
  it('does not serialize internal handles into public trust snapshots', async () => {
    const [memberPage, snapshotData, snapshotLink] = await Promise.all([
      source('src/app/members/[id]/page.tsx'),
      source('src/app/deals/buyer-snapshot-data.ts'),
      source('src/app/deals/buyer-snapshot-link.tsx'),
    ]);
    expect(memberPage).not.toContain('publicHandle');
    expect(snapshotData).not.toMatch(/\bhandle:/);
    expect(snapshotLink).not.toContain('snapshot.handle');
  });

  it('routes admin phone reads through the audited disclosure module', async () => {
    const [adminPage, disclosure] = await Promise.all([
      source('src/app/admin/members/[id]/page.tsx'),
      source('src/services/private-disclosure.ts'),
    ]);
    expect(adminPage).toContain('auditedAdminPhoneAccess');
    expect(adminPage).not.toContain('phoneE164: profiles.phoneE164');
    expect(disclosure).toContain("action: 'view_private_phone'");
    expect(disclosure).toContain("targetType: 'member_phone'");
  });
});
