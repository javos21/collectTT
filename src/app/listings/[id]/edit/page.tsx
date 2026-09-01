import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentUser } from '@/lib/session';
import { getListing } from '@/services/listings';
import { imageVariants } from '@/services/images';
import { EditListingForm } from './edit-listing-form';
import { updateListingAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await currentUser();
  if (user === null) redirect(`/sign-in?returnTo=${encodeURIComponent(`/listings/${id}/edit`)}`);

  const result = await getListing(id);
  if (result === null) notFound();
  const { listing, images } = result;
  if (listing.sellerId !== user.userId) redirect(`/listings/${id}`);
  if (listing.status !== 'active' && listing.status !== 'draft') redirect(`/listings/${id}`);

  return (
    <main className="create-page">
      <Link className="create-back" href={`/listings/${id}`}>← Back to listing</Link>
      <header className="create-header">
        <div>
          <h1>Edit listing</h1>
          <p>Keep your listing accurate for buyers.</p>
        </div>
        <img src="/assets/collecttt_logo.png" alt="" aria-hidden="true" />
      </header>

      {images.length > 0 && (
        <section className="edit-current-photos" aria-labelledby="current-photos-title">
          <h2 id="current-photos-title">Current photos</h2>
          <div className="edit-current-photos__grid">
            {images.map((image, index) => {
              const variants = imageVariants(image.variants);
              return (
                <img
                  key={image.id}
                  src={`/api/images/${image.id}?variant=${variants.card !== undefined ? 'card' : 'full'}`}
                  alt={`${listing.title} — current photo ${index + 1}`}
                />
              );
            })}
          </div>
        </section>
      )}

      <EditListingForm
        action={updateListingAction}
        listingId={listing.id}
        title={listing.title}
        description={listing.description ?? ''}
        price={listing.saleType === 'straight_sale' && listing.priceCents !== null ? (listing.priceCents / 100).toFixed(2) : null}
        error={error}
      />
    </main>
  );
}
