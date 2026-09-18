import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { adminAccess } from '@/lib/admin';
import { getFullServiceDeliveryDays, getListingExpiryDays, getRestrictionPolicy, listMarketplaceOptions } from '@/services/platform-settings';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';
import { updateDeliveryDefaultsAction, updateListingExpiryAction, updateRestrictionPolicyAction } from '../actions';
import { MarketplaceOptionManager } from './marketplace-option-manager';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ settings?: string; settingsError?: string }> }) {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const [fullServiceDeliveryDays, listingExpiryDays, restrictionPolicy, deliveryOptions, paymentOptions, params] = await Promise.all([
    getFullServiceDeliveryDays(),
    getListingExpiryDays(),
    getRestrictionPolicy(),
    listMarketplaceOptions('delivery'),
    listMarketplaceOptions('payment'),
    searchParams,
  ]);

  return (
    <AdminFrame activeNav="settings">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div><h1>Settings</h1><p>Manage the defaults that guide marketplace operations.</p></div>
        </div>

        <section className="admin-panel admin-settings-panel">
          <div className="admin-panel__heading"><div><h2>Delivery settings</h2></div></div>
          <p className="admin-panel__note">Set the standard delivery estimate shown when sellers select full-service delivery. Sellers can still set the estimate for each listing.</p>
          <form className="admin-settings-form" action={updateDeliveryDefaultsAction}>
            <label htmlFor="fullServiceDeliveryDays">Full-service delivery estimate</label>
            <div><input id="fullServiceDeliveryDays" name="fullServiceDeliveryDays" type="number" min="1" max="60" defaultValue={fullServiceDeliveryDays} required /><span>days</span><button className="admin-button" type="submit">Save setting</button></div>
          </form>
        </section>

        <section className="admin-panel admin-settings-panel">
          <div className="admin-panel__heading"><div><h2>Progressive restrictions</h2></div></div>
          <p className="admin-panel__note">Tune the trailing lookback, temporary restriction duration, and independent reserve/bid/publish thresholds. Changes are audited and apply to the next reputation evaluation.</p>
          <form className="admin-settings-form" action={updateRestrictionPolicyAction}>
            <label htmlFor="lookbackDays">Lookback window</label>
            <div><input id="lookbackDays" name="lookbackDays" type="number" min="7" max="365" defaultValue={restrictionPolicy.lookbackDays} required /><span>days</span></div>
            <label htmlFor="durationHours">Automatic restriction duration</label>
            <div><input id="durationHours" name="durationHours" type="number" min="24" max="8760" defaultValue={restrictionPolicy.durationHours} required /><span>hours</span></div>
            <label htmlFor="buyerPrepayAt">Buyer prepay warning threshold</label>
            <div><input id="buyerPrepayAt" name="buyerPrepayAt" type="number" min="1" max="20" defaultValue={restrictionPolicy.buyer.prepayRequiredAt} required /><span>incomplete purchases</span></div>
            <label htmlFor="buyerBidAt">Buyer bidding block threshold</label>
            <div><input id="buyerBidAt" name="buyerBidAt" type="number" min="1" max="20" defaultValue={restrictionPolicy.buyer.bidBlockedAt} required /><span>incomplete purchases</span></div>
            <label htmlFor="buyerReserveAt">Buyer reserve block threshold</label>
            <div><input id="buyerReserveAt" name="buyerReserveAt" type="number" min="1" max="50" defaultValue={restrictionPolicy.buyer.reserveBlockedAt} required /><span>incomplete purchases</span></div>
            <label htmlFor="sellerPublishAt">Seller publish block threshold</label>
            <div><input id="sellerPublishAt" name="sellerPublishAt" type="number" min="1" max="50" defaultValue={restrictionPolicy.seller.publishBlockedAt} required /><span>incomplete sales</span><button className="admin-button" type="submit">Save restriction policy</button></div>
          </form>
        </section>

        <section className="admin-panel admin-settings-panel">
          <div className="admin-panel__heading"><div><h2>Listing expiry</h2></div></div>
          <p className="admin-panel__note">Active fixed-price listings expire automatically after this many days. The v1 baseline is 30 days.</p>
          <form className="admin-settings-form" action={updateListingExpiryAction}>
            <label htmlFor="listingExpiryDays">Fixed-price listing lifetime</label>
            <div><input id="listingExpiryDays" name="listingExpiryDays" type="number" min="1" max="365" defaultValue={listingExpiryDays} required /><span>days</span><button className="admin-button" type="submit">Save setting</button></div>
          </form>
        </section>

        {params.settings !== undefined && <p className="admin-settings-success" role="status">{params.settings}</p>}
        {params.settingsError !== undefined && <p className="admin-settings-error" role="alert">{params.settingsError}</p>}
        <MarketplaceOptionManager deliveryOptions={deliveryOptions} paymentOptions={paymentOptions} />
      </main>
    </AdminFrame>
  );
}
