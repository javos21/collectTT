'use client';

import { useState } from 'react';

import { FULFILLMENT_PATHS } from '@/domain/states/transaction';

const PATH_LABELS: Record<string, { title: string; detail: string }> = {
  cash_meetup: { title: 'Public meetup', detail: 'Meet in a safe public place.' },
  remote_ship: { title: 'Ship to buyer', detail: 'You arrange shipping.' },
  relay: { title: 'Store drop-off', detail: 'Buyer collects from a store.' },
  full_service: { title: 'Full-service delivery', detail: 'CollectTT handles delivery.' },
};

type RelayStore = { id: string; name: string; area: string };

export function DeliveryFields({
  relayStoreOptions,
  fullServiceDefaultDays,
}: {
  relayStoreOptions: RelayStore[];
  fullServiceDefaultDays: number;
}) {
  const [relaySelected, setRelaySelected] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>(['cash_meetup']);

  const defaultDays: Record<string, number> = {
    cash_meetup: 2,
    remote_ship: 5,
    relay: 5,
    full_service: fullServiceDefaultDays,
  };

  return (
    <>
      <div className="choice-grid">
        {FULFILLMENT_PATHS.map((path) => (
          <label className="choice-card" key={path} htmlFor={`path_${path}`}>
            <input
              id={`path_${path}`}
              type="checkbox"
              name="fulfillmentPaths"
              value={path}
              defaultChecked={path === 'cash_meetup'}
              onChange={(event) => {
                setSelectedPaths((current) => event.target.checked ? [...current, path] : current.filter((item) => item !== path));
                if (path === 'relay') setRelaySelected(event.target.checked);
              }}
            />
            <span><strong>{PATH_LABELS[path]?.title}</strong><small>{PATH_LABELS[path]?.detail}</small></span>
          </label>
        ))}
      </div>

      <div className="delivery-estimates">
        <h3>Expected delivery</h3>
        <p className="form-note">Tell buyers how long each selected option normally takes.</p>
        {FULFILLMENT_PATHS.filter((path) => selectedPaths.includes(path)).map((path) => (
          <div className="form-field form-field--compact" key={path}>
            <label htmlFor={`deliveryEstimate__${path}`}>{PATH_LABELS[path]?.title}</label>
            <select id={`deliveryEstimate__${path}`} name={`deliveryEstimate__${path}`} defaultValue={String(defaultDays[path] ?? 5)} required>
              {[1, 2, 3, 5, 7, 10, 14, 21, 30].map((days) => <option key={days} value={days}>Within {days} day{days === 1 ? '' : 's'}</option>)}
            </select>
          </div>
        ))}
      </div>

      {relaySelected && relayStoreOptions.length > 0 && (
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

      {relaySelected && relayStoreOptions.length === 0 && (
        <p className="form-note">Store drop-off is unavailable until a store is added.</p>
      )}
    </>
  );
}
