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

export function DeliveryFields({ relayStoreOptions }: { relayStoreOptions: RelayStore[] }) {
  const [relaySelected, setRelaySelected] = useState(false);

  return (
    <>
      <div className="choice-grid">
        {FULFILLMENT_PATHS.filter((path) => path !== 'full_service').map((path) => (
          <label className="choice-card" key={path} htmlFor={`path_${path}`}>
            <input
              id={`path_${path}`}
              type="checkbox"
              name="fulfillmentPaths"
              value={path}
              defaultChecked={path === 'cash_meetup'}
              onChange={path === 'relay' ? (event) => setRelaySelected(event.target.checked) : undefined}
            />
            <span><strong>{PATH_LABELS[path]?.title}</strong><small>{PATH_LABELS[path]?.detail}</small></span>
          </label>
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
