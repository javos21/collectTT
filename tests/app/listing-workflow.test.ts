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
    expect(newListingSource).toContain('<fieldset className="meetup-location-fieldset">');
    expect(editListingSource).toContain('<fieldset className="meetup-location-fieldset">');
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

  it('gates auction discovery, creation, and bidding through the centralized switch', async () => {
    const [homeSource, browseSource, listingServiceSource, bidSource, createFormSource] = await Promise.all([
      readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/listings/page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/services/listings.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/db/atomic/place-bid.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/app/listings/new/sale-type-fields.tsx', import.meta.url), 'utf8'),
    ]);

    expect(homeSource).toContain('const auctionsVisible = areAuctionsVisible()');
    expect(homeSource).toContain('{auctionsVisible && <Link className="home-browse-action home-browse-action--auction"');
    expect(browseSource).toContain('{auctionsVisible && <Link');
    expect(listingServiceSource).toContain("if (input.saleType === 'auction') assertAuctionCreationEnabled()");
    expect(listingServiceSource).toContain('surface === \'recent\' || !auctionsVisible');
    expect(bidSource).toContain('assertAuctionBiddingEnabled();');
    expect(createFormSource).toContain('{auctionsEnabled && <label');
  });
});
