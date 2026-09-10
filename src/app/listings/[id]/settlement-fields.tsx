'use client';

import { useState } from 'react';

type RelayStore = { id: string; name: string; area: string };

export function SettlementFields({
  idPrefix,
  fieldPrefix = '',
  deliveryOptions,
  paymentOptions,
  relayCandidates,
}: {
  idPrefix: string;
  fieldPrefix?: string;
  deliveryOptions: readonly { id: string; label: string; requiresStore: boolean }[];
  paymentOptions: readonly { key: string; label: string }[];
  relayCandidates: readonly RelayStore[];
}) {
  const [selectedDeliveryOptionId, setSelectedDeliveryOptionId] = useState('');

  if (deliveryOptions.length === 0) {
    return (
      <p className="buybox__note">
        No delivery option is available right now — the seller&apos;s store pickup
        locations cannot take this item.
      </p>
    );
  }

  const helpId = `${idPrefix}settlement-help`;
  const deliveryId = `${idPrefix}deliveryOptionId`;
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
        name={`${fieldPrefix}deliveryOptionId`}
        value={selectedDeliveryOptionId}
        onChange={(event) => setSelectedDeliveryOptionId(event.target.value)}
        aria-describedby={helpId}
        required
      >
        <option value="" disabled>Select a delivery option</option>
        {deliveryOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      {deliveryOptions.find((option) => option.id === selectedDeliveryOptionId)?.requiresStore === true && (
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
        {paymentOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
