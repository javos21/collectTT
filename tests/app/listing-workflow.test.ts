import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('listing workflow', () => {
  it('offers an inline meetup location form during listing creation and editing', async () => {
    const [newListingSource, editListingSource, inlineFormSource] = await Promise.all([
      readFile(new URL('../../src/app/listings/new/listing-form.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/listings/[id]/edit/edit-listing-form.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/listings/meetup-location-form.tsx', import.meta.url), 'utf8'),
    ]);

    expect(newListingSource).toContain('<InlineMeetupLocationForm onCreated={handleMeetupLocationCreated} />');
    expect(editListingSource).toContain('<InlineMeetupLocationForm onCreated={handleMeetupLocationCreated} />');
    expect(inlineFormSource).toContain('createMeetupLocationAction(formData)');
    expect(inlineFormSource).toContain('This will be saved for future listings too.');
  });

  it('keeps drafts in a dedicated grid instead of inactive listing tables', async () => {
    const source = await readFile(new URL('../../src/app/me/profile-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("listing.status !== 'draft'");
    expect(source).toContain('function DraftsGrid');
    expect(source).toContain('<DraftsGrid listings={listings} deleteListingAction={deleteListingAction} />');
    expect(source).toContain('Continue editing');
  });

  it('uses active admin-managed payment options throughout seller settings', async () => {
    const [newListingSource, profileSource, listingServiceSource, launchScopeSource] = await Promise.all([
      readFile(new URL('../../src/app/listings/new/page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/me/profile-page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/listings.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/lib/launch-scope.ts', import.meta.url), 'utf8'),
    ]);

    expect(newListingSource).toContain('paymentOptions.map((option) => ({ key: option.key, label: option.label }))');
    expect(profileSource).toContain('props.paymentOptions.map((option) =>');
    expect(listingServiceSource).toContain("eq(marketplaceOptions.kind, 'payment')");
    expect(listingServiceSource).toContain('Choose only active payment methods.');
    expect(launchScopeSource).not.toContain('V1_ALLOWED_SETTLEMENT_METHODS');
  });
});
