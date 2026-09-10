'use client';

import { useState } from 'react';

type RelayStore = { id: string; name: string; area: string };
type DeliveryOption = { id: string; label: string; description: string; requiresStore: boolean; defaultDays: number };

export function DeliveryFields({
  deliveryOptions,
  relayStoreOptions,
}: {
  deliveryOptions: readonly DeliveryOption[];
  relayStoreOptions: RelayStore[];
}) {
  const defaultOption = deliveryOptions[0];
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(defaultOption === undefined ? [] : [defaultOption.id]);
  const storeOptionSelected = deliveryOptions.some((option) => option.requiresStore && selectedOptionIds.includes(option.id));

  return (
    <>
      <div className="choice-grid">
        {deliveryOptions.map((option) => (
          <label className="choice-card" key={option.id} htmlFor={`delivery_${option.id}`}>
            <input
              id={`delivery_${option.id}`}
              type="checkbox"
              name="deliveryOptionIds"
              value={option.id}
              defaultChecked={option.id === defaultOption?.id}
              onChange={(event) => {
                setSelectedOptionIds((current) => event.target.checked
                  ? [...current, option.id]
                  : current.filter((item) => item !== option.id));
              }}
            />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>
        ))}
      </div>

      <div className="delivery-estimates">
        <h3>Expected delivery</h3>
        <p className="form-note">Tell buyers how long each selected option normally takes.</p>
        {deliveryOptions.filter((option) => selectedOptionIds.includes(option.id)).map((option) => (
          <div className="form-field form-field--compact" key={option.id}>
            <label htmlFor={`deliveryEstimate__${option.id}`}>{option.label}</label>
            <select id={`deliveryEstimate__${option.id}`} name={`deliveryEstimate__${option.id}`} defaultValue={String(option.defaultDays)} required>
              {[1, 2, 3, 5, 7, 10, 14, 21, 30].map((days) => <option key={days} value={days}>Within {days} day{days === 1 ? '' : 's'}</option>)}
            </select>
          </div>
        ))}
      </div>

      {storeOptionSelected && relayStoreOptions.length > 0 && (
        <div className="conditional-field">
          <h3>Choose stores</h3>
          <div className="choice-grid choice-grid--stores">
            {relayStoreOptions.map((store) => (
              <label className="choice-card" key={store.id} htmlFor={`store_${store.id}`}>
                <input id={`store_${store.id}`} type="checkbox" name="relayStoreIds" value={store.id} />
                <span><strong>{store.name}</strong><small>{store.area}</small></span>
              </label>
            ))}
          </div>
        </div>
      )}

      {storeOptionSelected && relayStoreOptions.length === 0 && (
        <p className="form-note">Store pickup is unavailable until a store is added.</p>
      )}
    </>
  );
}
