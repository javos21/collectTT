import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { currentUser } from '@/lib/session';
import { getFullServiceDeliveryDays } from '@/services/platform-settings';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';
import { updateDeliveryDefaultsAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ settings?: string; settingsError?: string }> }) {
  const viewer = await currentUser();
  if (viewer === null) return <AdminDenied signedIn={false} />;

  const viewerProfile = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, viewer.userId))
    .limit(1);
  if (viewerProfile[0]?.role !== 'admin') return <AdminDenied signedIn />;

  const [fullServiceDeliveryDays, params] = await Promise.all([getFullServiceDeliveryDays(), searchParams]);

  return (
    <AdminFrame activeNav="settings">
      <main className="admin-main">
        <div className="admin-heading">
          <div><h1>Settings</h1><p>Manage the defaults that guide marketplace operations.</p></div>
        </div>

        <section className="admin-panel admin-settings-panel">
          <div className="admin-panel__heading"><div><h2>Delivery settings</h2></div></div>
          <p className="admin-panel__note">Set the standard delivery estimate shown when sellers select full-service delivery. Sellers can still set the estimate for each listing.</p>
          {params.settings === 'saved' && <p className="admin-settings-success" role="status">Delivery default saved.</p>}
          {params.settingsError !== undefined && <p className="admin-settings-error" role="alert">Enter a whole number from 1 to 60 days.</p>}
          <form className="admin-settings-form" action={updateDeliveryDefaultsAction}>
            <label htmlFor="fullServiceDeliveryDays">Full-service delivery estimate</label>
            <div><input id="fullServiceDeliveryDays" name="fullServiceDeliveryDays" type="number" min="1" max="60" defaultValue={fullServiceDeliveryDays} required /><span>days</span><button className="admin-button" type="submit">Save setting</button></div>
          </form>
        </section>
      </main>
    </AdminFrame>
  );
}
