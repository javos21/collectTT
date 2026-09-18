import Link from 'next/link';
import { currentUser } from '@/lib/session';
import { listRelayStores } from '@/services/relay-stores';
import { db } from '@/db/client';
import { SignInRequiredModal } from '@/components/sign-in-required-modal';
import { createListingAction } from './actions';
import { ListingForm } from './listing-form';
import { getFullServiceDeliveryDays, listMarketplaceOptions } from '@/services/platform-settings';
import { activeCategoryDefinitions } from '@/services/catalog';
import { evaluateMarketplaceAction } from '@/services/marketplace-eligibility';
import { isV1Launch } from '@/lib/launch-scope';
import { getListing, sellerMarketplacePreferencesFor, sellerMeetupLocationsFor } from '@/services/listings';
import { getListingActivity } from '@/services/listings';
import { imageVariants } from '@/services/images';

export const dynamic = 'force-dynamic';

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; duplicateFrom?: string }>;
}) {
  const user = await currentUser();
  const { error, duplicateFrom } = await searchParams;

  if (user === null) {
    return (
      <main className="create-page create-page--locked">
        <div className="create-locked-stage" aria-hidden="true">
          <Link className="create-back" href="/listings" tabIndex={-1}>← Back to listings</Link>
          <header className="create-header">
            <div>
              <h1>Create a listing</h1>
              <p>Sign in to list your item.</p>
            </div>
            <img src="/assets/collecttt_logo.png" alt="" aria-hidden="true" />
          </header>
        </div>
        <SignInRequiredModal intent="sell" returnTo="/listings/new" />
      </main>
    );
  }

  const eligibility = await evaluateMarketplaceAction(db, user.userId, 'persist_listing');
  if (!eligibility.eligible) {
    const message = eligibility.message ?? 'Complete your account before creating a listing.';
    return (
      <main className="create-page create-page--locked">
        <div className="create-locked-stage create-locked-stage--actionable">
          <Link className="create-back" href="/listings">← Back to listings</Link>
          <header className="create-header"><div><h1>Create a listing</h1><p>{message}</p></div></header>
          <Link className="button" href={`/me?tab=account&error=${encodeURIComponent(message)}`}>Open account settings</Link>
        </div>
      </main>
    );
  }

  const duplicateSource = duplicateFrom === undefined ? null : await getListing(duplicateFrom, user.userId);
  if (duplicateFrom !== undefined) {
    const source = duplicateSource?.listing;
    const duplicableStatuses = new Set(['draft', 'active', 'sold_outside', 'expired', 'ended_no_sale', 'cancelled', 'ended_won']);
    if (source === undefined || source.sellerId !== user.userId) {
      return <main className="create-page"><Link className="create-back" href="/listings">← Back to listings</Link><div className="create-error" role="alert">This listing is not available to duplicate.</div></main>;
    }
    if (!duplicableStatuses.has(source.status)) {
      return <main className="create-page"><Link className="create-back" href={`/listings/${source.id}`}>← Back to listing</Link><div className="create-error" role="alert">This listing cannot be duplicated while buyer activity is active.</div></main>;
    }
    if (source.status === 'active' && (await getListingActivity(source.id)).locked) {
      return <main className="create-page"><Link className="create-back" href={`/listings/${source.id}`}>← Back to listing</Link><div className="create-error" role="alert">This listing is locked because buyers have already interacted with it.</div></main>;
    }
  }

  const [relayStoreOptions, fullServiceDefaultDays, deliveryOptions, paymentOptions, categories, meetupLocations, sellerPreferences] = await Promise.all([
    listRelayStores(db),
    getFullServiceDeliveryDays(),
    listMarketplaceOptions('delivery', { activeOnly: true }),
    listMarketplaceOptions('payment', { activeOnly: true }),
    activeCategoryDefinitions(),
    sellerMeetupLocationsFor(user.userId),
    sellerMarketplacePreferencesFor(user.userId),
  ]);
  const activeMeetupLocations = meetupLocations.filter((location) => location.active);
  const sourceListing = duplicateSource?.listing;
  const initialMeetupLocationId = sourceListing?.meetupLocationId ?? (activeMeetupLocations.length === 1 ? activeMeetupLocations[0]!.id : null);
  const sourceDeliveryOptions = new Map(duplicateSource?.deliveryOptions.map((option) => [option.id, option.expectedDeliveryDays]));
  const formDeliveryOptions = deliveryOptions.map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description ?? '',
    requiresStore: option.requiresStore,
    fulfillmentPath: option.fulfillmentPath ?? 'cash_meetup',
    defaultDays: sourceDeliveryOptions.get(option.id) ?? (option.fulfillmentPath === 'full_service'
      ? fullServiceDefaultDays
      : option.requiresStore || option.fulfillmentPath === 'remote_ship' ? 5 : 2),
  }));
  const duplicateImages = duplicateSource?.images.map((image) => {
    const variants = imageVariants(image.variants);
    return { id: image.id, previewUrl: `/api/images/${image.id}?variant=${variants.card !== undefined ? 'card' : 'full'}`, alt: `${sourceListing?.title ?? 'Listing'} photo` };
  }) ?? [];
  const asMoney = (value: number | null | undefined) => value === null || value === undefined ? undefined : (value / 100).toFixed(2);

  return (
    <main className="create-page">
      <Link className="create-back" href="/listings">← Back to listings</Link>
      <header className="create-header">
        <div>
          <h1>Create a listing</h1>
          <p>{duplicateSource === null ? 'Four quick steps, then you’re live.' : 'Review the copied details, then save or publish your new listing.'}</p>
        </div>
        <img src="/assets/collecttt_logo.png" alt="" aria-hidden="true" />
      </header>

      <ListingForm
        action={createListingAction}
        v1={isV1Launch()}
        relayStoreOptions={relayStoreOptions.map((store) => ({
          id: store.id,
          name: store.name,
          area: store.area,
        }))}
        deliveryOptions={formDeliveryOptions}
        paymentOptions={paymentOptions.filter((option) => !isV1Launch() || ['cash', 'bank_transfer'].includes(option.key)).map((option) => ({ key: option.key, label: option.label }))}
        categories={categories}
        meetupLocations={meetupLocations.map((location) => ({ id: location.id, label: location.label, area: location.area }))}
        defaultDeliveryOptionIds={duplicateSource?.deliveryOptions.map((option) => option.id) ?? sellerPreferences.defaultDeliveryOptionIds}
        defaultRelayStoreIds={duplicateSource?.relayStoreIds ?? sellerPreferences.defaultRelayStoreIds}
        initialMeetupLocationId={initialMeetupLocationId}
        defaultPaymentMethods={sourceListing?.settlementMethods ?? sellerPreferences.defaultPaymentMethods}
        initialTitle={sourceListing?.title}
        initialDescription={sourceListing?.description ?? undefined}
        initialCategoryKey={sourceListing?.category}
        initialAttributes={sourceListing?.attributes as Record<string, unknown> | undefined}
        initialSaleType={sourceListing?.saleType}
        initialPrice={asMoney(sourceListing?.priceCents)}
        initialStartBid={asMoney(sourceListing?.startBidCents)}
        initialBuyout={asMoney(sourceListing?.buyoutCents)}
        initialDurationHours={sourceListing?.saleType === 'auction' ? 48 : undefined}
        initialAcceptsOffers={sourceListing?.acceptsOffers ?? false}
        initialAutoRelistOnRenege={sourceListing?.autoRelistOnRenege ?? true}
        initialImages={duplicateImages}
        duplicateMode={duplicateSource !== null}
        error={error}
      />
    </main>
  );
}
