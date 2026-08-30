import Link from 'next/link';
import { currentUser } from '@/lib/session';
import { listRelayStores } from '@/services/relay-stores';
import { db } from '@/db/client';
import { SignInRequiredModal } from '@/components/sign-in-required-modal';
import { createListingAction } from './actions';
import { ListingForm } from './listing-form';

export const dynamic = 'force-dynamic';

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  const { error } = await searchParams;

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

  const relayStoreOptions = await listRelayStores(db);

  return (
    <main className="create-page">
      <Link className="create-back" href="/listings">← Back to listings</Link>
      <header className="create-header">
        <div>
          <h1>Create a listing</h1>
          <p>Five quick steps, then you’re live.</p>
        </div>
        <img src="/assets/collecttt_logo.png" alt="" aria-hidden="true" />
      </header>

      <ListingForm
        action={createListingAction}
        relayStoreOptions={relayStoreOptions.map((store) => ({
          id: store.id,
          name: store.name,
          area: store.area,
        }))}
        error={error}
      />
    </main>
  );
}
