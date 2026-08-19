import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentUser } from '@/lib/session';
import { staffStores } from '@/lib/store-session';

export const dynamic = 'force-dynamic';

export default async function StoreEntryPage() {
  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in');

  const { stores } = await staffStores();

  // Nothing further: someone who is not staff learns nothing about which stores exist.
  if (stores.length === 0) {
    return (
      <main>
        <h1>Store</h1>
        <p>You&apos;re not registered as store staff.</p>
      </main>
    );
  }

  const only = stores[0];
  if (stores.length === 1 && only !== undefined) redirect(`/store/${only.id}`);

  return (
    <main>
      <h1>Your stores</h1>
      <ul>
        {stores.map((store) => (
          <li key={store.id}>
            <Link href={`/store/${store.id}`}>{store.name}</Link>{' '}
            <span className="pill">{store.role}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
