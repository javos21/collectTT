'use client';

import { useState } from 'react';

type RelayStore = { id: string; name: string; area: string };

export function SettlementFields({
  idPrefix,
  fieldPrefix = '',
  paths,
  pathLabels,
  paymentMethods,
  paymentLabels,
  relayCandidates,
}: {
  idPrefix: string;
  fieldPrefix?: string;
  paths: readonly string[];
  pathLabels: Record<string, string>;
  paymentMethods: readonly string[];
  paymentLabels: Record<string, string>;
  relayCandidates: readonly RelayStore[];
}) {
  const [selectedPath, setSelectedPath] = useState('');

  if (paths.length === 0) {
    return (
      <p className="buybox__note">
        No delivery option is available right now — the seller&apos;s store pickup
        locations cannot take this item.
      </p>
    );
  }

  const helpId = `${idPrefix}settlement-help`;
  const deliveryId = `${idPrefix}fulfillmentPath`;
  const paymentId = `${idPrefix}settlementMethod`;
  const storeId = `${idPrefix}relayStoreId`;

  return (
    <div className="buybox__settlement-fields">
      <div className="buybox__settlement-heading">
        <p className="buybox__settlement-question">
          How do you want to settle this? <span className="required-mark" aria-hidden="true">*</span>
        </p>
        <p id={helpId} className="buybox__settlement-help">
          Choose one delivery option and one payment method. Both are required to claim
          this item or make an offer.
        </p>
      </div>

      <label htmlFor={deliveryId}>
        Delivery option <span className="required-mark" aria-hidden="true">*</span>
      </label>
      <select
        id={deliveryId}
        name={`${fieldPrefix}fulfillmentPath`}
        value={selectedPath}
        onChange={(event) => setSelectedPath(event.target.value)}
        aria-describedby={helpId}
        required
      >
        <option value="" disabled>Select a delivery option</option>
        {paths.map((path) => (
          <option key={path} value={path}>
            {pathLabels[path] ?? path}
          </option>
        ))}
      </select>

      {selectedPath === 'relay' && (
        <>
          <label htmlFor={storeId}>
            Pickup store <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <select
            id={storeId}
            name={`${fieldPrefix}relayStoreId`}
            defaultValue=""
            required
          >
            <option value="" disabled>Select a pickup store</option>
            {relayCandidates.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name} — {store.area}
              </option>
            ))}
          </select>
        </>
      )}

      <label htmlFor={paymentId}>
        Payment method <span className="required-mark" aria-hidden="true">*</span>
      </label>
      <select
        id={paymentId}
        name={`${fieldPrefix}settlementMethod`}
        defaultValue=""
        aria-describedby={helpId}
        required
      >
        <option value="" disabled>Select a payment method</option>
        {paymentMethods.map((method) => (
          <option key={method} value={method}>
            {paymentLabels[method] ?? method}
          </option>
        ))}
      </select>
    </div>
  );
}
