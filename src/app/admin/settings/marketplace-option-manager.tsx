'use client';

import { useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';

import type { MarketplaceOption, MarketplaceOptionKind } from '@/services/platform-settings';
import { removeMarketplaceOptionAction, saveMarketplaceOptionAction } from '../actions';

export function MarketplaceOptionManager({
  deliveryOptions,
  paymentOptions,
}: {
  deliveryOptions: MarketplaceOption[];
  paymentOptions: MarketplaceOption[];
}) {
  const [editing, setEditing] = useState<MarketplaceOption | null>(null);
  const [addingKind, setAddingKind] = useState<MarketplaceOptionKind | null>(null);

  function openAdd(kind: MarketplaceOptionKind) {
    setEditing(null);
    setAddingKind(kind);
  }

  function openEdit(option: MarketplaceOption) {
    setAddingKind(null);
    setEditing(option);
  }

  function close() {
    setAddingKind(null);
    setEditing(null);
  }

  return (
    <section className="admin-panel admin-settings-panel admin-option-manager">
      <div className="admin-panel__heading"><div><h2>Marketplace options</h2></div></div>
      <p className="admin-panel__note">
        Add, rename, reorder, or remove the choices buyers and sellers see. Store pickup
        options always require the buyer to choose a store.
      </p>
      <OptionSection kind="delivery" options={deliveryOptions} onAdd={openAdd} onEdit={openEdit} />
      <OptionSection kind="payment" options={paymentOptions} onAdd={openAdd} onEdit={openEdit} />
      {(addingKind !== null || editing !== null) && (
        <OptionForm kind={(addingKind ?? editing?.kind) as MarketplaceOptionKind} option={editing} onClose={close} />
      )}
    </section>
  );
}

function OptionSection({
  kind,
  options,
  onAdd,
  onEdit,
}: {
  kind: MarketplaceOptionKind;
  options: MarketplaceOption[];
  onAdd: (kind: MarketplaceOptionKind) => void;
  onEdit: (option: MarketplaceOption) => void;
}) {
  const label = kind === 'delivery' ? 'Delivery options' : 'Payment options';
  return (
    <div className="admin-option-section">
      <div className="admin-option-section__heading">
        <div><h3>{label}</h3><p>{options.filter((option) => option.active).length} available</p></div>
        <button className="admin-button admin-button--secondary" type="button" onClick={() => onAdd(kind)}>
          <Plus size={16} aria-hidden="true" /> Add {kind} option
        </button>
      </div>
      <div className="admin-option-list">
        {options.map((option) => (
          <article className={`admin-option-row${option.active ? '' : ' is-removed'}`} key={option.id}>
            <div className="admin-option-row__copy">
              <div><strong>{option.label}</strong>{option.requiresStore && <span>Store required</span>}</div>
              {option.description !== null && option.description !== '' && <p>{option.description}</p>}
            </div>
            <div className="admin-option-row__actions">
              <button type="button" aria-label={`Edit ${option.label}`} onClick={() => onEdit(option)}>
                <Edit3 size={16} aria-hidden="true" />
              </button>
              {option.active && (
                <form action={removeMarketplaceOptionAction} onSubmit={(event) => {
                  if (!window.confirm(`Remove ${option.label}? It will disappear from new listings.`)) event.preventDefault();
                }}>
                  <input type="hidden" name="id" value={option.id} />
                  <input type="hidden" name="label" value={option.label} />
                  <button type="submit" aria-label={`Remove ${option.label}`}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </form>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function OptionForm({
  kind,
  option,
  onClose,
}: {
  kind: MarketplaceOptionKind;
  option: MarketplaceOption | null;
  onClose: () => void;
}) {
  const noun = kind === 'delivery' ? 'delivery option' : 'payment option';
  return (
    <div className="catalog-form-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="catalog-form" role="dialog" aria-modal="true" aria-labelledby="marketplace-option-form-title">
        <div className="catalog-form__header">
          <h2 id="marketplace-option-form-title">{option === null ? `Add ${noun}` : `Edit ${noun}`}</h2>
          <button className="catalog-form__close" type="button" onClick={onClose} aria-label="Close form">×</button>
        </div>
        <form action={saveMarketplaceOptionAction}>
          <input type="hidden" name="id" value={option?.id ?? ''} />
          <input type="hidden" name="kind" value={kind} />
          <label>Name<input name="label" defaultValue={option?.label ?? ''} placeholder={kind === 'delivery' ? 'e.g. Courier delivery' : 'e.g. PayWise'} required autoFocus /></label>
          <label>Description <span>(optional)</span><input name="description" defaultValue={option?.description ?? ''} placeholder="Short explanation shown to members" /></label>
          <label>Key <span>(optional)</span><input name="key" defaultValue={option?.key ?? ''} placeholder="Generated from name" readOnly={option !== null} /></label>
          <label>Display order<input name="sortOrder" type="number" min="0" step="1" defaultValue={option?.sortOrder ?? 10} required /></label>
          {kind === 'delivery' && (
            <label className="admin-option-store-toggle">
              <input name="requiresStore" type="checkbox" defaultChecked={option?.requiresStore ?? false} />
              <span><strong>Requires a pickup store</strong><small>Buyers must choose one of the stores attached to the listing.</small></span>
            </label>
          )}
          <p className="catalog-form__hint">The key is a stable internal identifier. Existing listings keep working when an option is renamed or removed.</p>
          <div className="catalog-form__actions">
            <button className="admin-button admin-button--secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="admin-button" type="submit">{option === null ? `Add ${noun}` : 'Save changes'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
