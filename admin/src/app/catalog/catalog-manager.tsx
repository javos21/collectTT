'use client';

import { useState } from 'react';
import { Edit3, Plus, Search, Trash2 } from 'lucide-react';

import { removeCatalogValueAction, removeCategoryAction, saveCatalogValueAction, saveCategoryAction } from './actions';

type Tab = 'categories' | 'games' | 'conditions';
type CategoryItem = { key: string; label: string; sortOrder: number; active: boolean };
type ValueItem = { id?: string; kind: 'game' | 'condition'; key: string; label: string; sortOrder: number; active: boolean };

function valueId(item: CategoryItem | ValueItem): string {
  return 'id' in item && typeof item.id === 'string' ? item.id : '';
}

function valueKind(item: CategoryItem | ValueItem): '' | 'game' | 'condition' {
  return 'kind' in item && (item.kind === 'game' || item.kind === 'condition') ? item.kind : '';
}

export function CatalogManager({ categories, values, notice }: { categories: CategoryItem[]; values: ValueItem[]; notice?: string }) {
  const [tab, setTab] = useState<Tab>('categories');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CategoryItem | ValueItem | null>(null);
  const [showForm, setShowForm] = useState(false);

  const currentValues = tab === 'categories' ? categories : values.filter((item) => item.kind === (tab === 'games' ? 'game' : 'condition'));
  const filtered = currentValues.filter((item) => `${item.label} ${item.key}`.toLowerCase().includes(query.toLowerCase()));
  const countLabel = `${currentValues.length} ${currentValues.length === 1 ? 'item' : 'items'}`;

  function openAdd() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(item: CategoryItem | ValueItem) {
    setEditing(item);
    setShowForm(true);
  }

  const title = tab === 'categories' ? 'Categories' : tab === 'games' ? 'Games' : 'Conditions';
  const description = tab === 'categories' ? 'The item types sellers can list.' : tab === 'games' ? 'Game names used on trading card listings.' : 'Condition labels shown when sellers describe an item.';
  const tabLabels: Record<Tab, string> = { categories: 'Categories', games: 'Games', conditions: 'Conditions' };

  return (
    <div className="catalog-manager">
      {notice !== undefined && <div className="admin-toast" role="status">{notice}</div>}
      <div className="catalog-tabs" role="tablist" aria-label="Catalog sections">
        {(['categories', 'games', 'conditions'] as const).map((item) => (
          <button key={item} className={tab === item ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === item} onClick={() => { setTab(item); setQuery(''); setShowForm(false); }}>
            {tabLabels[item]}<span>{item === 'categories' ? categories.length : values.filter((value) => value.kind === (item === 'games' ? 'game' : 'condition')).length}</span>
          </button>
        ))}
      </div>

      <section className="admin-panel catalog-panel">
        <div className="catalog-panel__toolbar">
          <div><p className="admin-kicker">{title}</p><h2>{description}</h2></div>
          <button className="admin-button" type="button" onClick={openAdd}><Plus size={16} aria-hidden="true" />Add {tab === 'categories' ? 'category' : tab === 'games' ? 'game' : 'condition'}</button>
        </div>
        <div className="catalog-list-toolbar">
          <label className="catalog-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search {title.toLowerCase()}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} /></label>
          <span className="catalog-count">{countLabel}</span>
        </div>
        {filtered.length === 0 ? <div className="catalog-empty"><div className="catalog-empty__icon"><Search size={18} aria-hidden="true" /></div><strong>No matches</strong><p>Try another search or add a new {title.toLowerCase().replace(/s$/, '')}.</p></div> : (
          <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Name</th><th>Key</th><th>Order</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
            {filtered.map((item) => <tr key={`${valueId(item) || item.key}`}><td><strong>{item.label}</strong><small>{tab === 'categories' ? 'Listing type' : 'Shared catalog value'}</small></td><td><code>{item.key}</code></td><td>{item.sortOrder}</td><td><span className={`admin-status ${item.active ? 'admin-status--active' : 'admin-status--inactive'}`}>{item.active ? 'Active' : 'Removed'}</span></td><td><div className="catalog-row-actions"><button type="button" aria-label={`Edit ${item.label}`} onClick={() => openEdit(item)}><Edit3 size={15} aria-hidden="true" /></button><form action={tab === 'categories' ? removeCategoryAction : removeCatalogValueAction} onSubmit={(event) => { if (!window.confirm(`Remove ${item.label}? Existing listings will remain unchanged.`)) event.preventDefault(); }}><input type="hidden" name={tab === 'categories' ? 'key' : 'id'} value={tab === 'categories' ? item.key : valueId(item)} /><input type="hidden" name="kind" value={valueKind(item)} /><input type="hidden" name="label" value={item.label} /><input type="hidden" name="sortOrder" value={item.sortOrder} /><input type="hidden" name="key" value={item.key} /><button type="submit" aria-label={`Remove ${item.label}`}><Trash2 size={15} aria-hidden="true" /></button></form></div></td></tr>)}
          </tbody></table></div>
        )}
      </section>

      {showForm && <CatalogForm tab={tab} item={editing} onClose={() => setShowForm(false)} />}
    </div>
  );
}

function CatalogForm({ tab, item, onClose }: { tab: Tab; item: CategoryItem | ValueItem | null; onClose: () => void }) {
  const isCategory = tab === 'categories';
  const value = item as ValueItem | null;
  const category = item as CategoryItem | null;
  const label = isCategory ? 'category' : tab === 'games' ? 'game' : 'condition';
  return (
    <div className="catalog-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="catalog-form" role="dialog" aria-modal="true" aria-labelledby="catalog-form-title">
        <div className="catalog-form__header"><div><p className="admin-kicker">Catalog setup</p><h2 id="catalog-form-title">{item ? `Edit ${label}` : `Add ${label}`}</h2></div><button className="catalog-form__close" type="button" onClick={onClose} aria-label="Close form">×</button></div>
        <form action={isCategory ? saveCategoryAction : saveCatalogValueAction}>
          {!isCategory && <input type="hidden" name="kind" value={value?.kind ?? (tab === 'games' ? 'game' : 'condition')} />}
          {isCategory && <input type="hidden" name="originalKey" value={category?.key ?? ''} />}
          {!isCategory && <input type="hidden" name="id" value={value?.id ?? ''} />}
          <label>Name<input name="label" defaultValue={item?.label ?? ''} placeholder={isCategory ? 'e.g. Board game' : label === 'game' ? 'e.g. Pokémon' : 'e.g. Near Mint'} required autoFocus /></label>
          <label>Key <span>(optional)</span><input name="key" defaultValue={item?.key ?? ''} placeholder="Generated from name" readOnly={item !== null} /></label>
          <label>Display order<input name="sortOrder" type="number" min="0" step="1" defaultValue={item?.sortOrder ?? 10} required /></label>
          <p className="catalog-form__hint">Keys are stable identifiers used by listing data. Leave it blank to generate one from the name.</p>
          <div className="catalog-form__actions"><button className="admin-button admin-button--secondary" type="button" onClick={onClose}>Cancel</button><button className="admin-button" type="submit">{item ? 'Save changes' : `Add ${label}`}</button></div>
        </form>
      </section>
    </div>
  );
}
