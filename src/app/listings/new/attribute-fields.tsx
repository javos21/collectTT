'use client';

import { useState } from 'react';

import type { AttributeDef, CategoryDefinition } from '@/domain/categories/types';

/**
 * ★ THE generic attribute form.
 *
 * There is no per-category form component anywhere in this codebase. This one renderer
 * walks whatever the category config declares. Adding a category adds fields here for
 * free — which is the user-facing half of "no migration, no form code".
 */
export function AttributeFields({ categories }: { categories: CategoryDefinition[] }) {
  const [categoryKey, setCategoryKey] = useState(categories[0]?.key ?? '');
  const selected = categories.find((c) => c.key === categoryKey);

  return (
    <div className="attribute-fields">
      <div className="form-field">
        <label htmlFor="category">Category</label>
        <select
          id="category"
          name="category"
          value={categoryKey}
          onChange={(e) => setCategoryKey(e.target.value)}
          required
        >
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {selected !== undefined && (
        <div className="category-details">
          <div className="category-details__heading">
            <h3>{selected.label} details</h3>
            <p>Add the details collectors use to identify and filter this item.</p>
          </div>
          <div className="form-grid">
            {selected.attributes.map((attr) => <Field key={attr.key} attr={attr} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ attr }: { attr: AttributeDef }) {
  const id = `attr_${attr.key}`;
  // Namespaced so the server action can pick attributes out of the flat FormData
  // without knowing which category is in play.
  const name = `attr__${attr.key}`;
  const required = attr.required === true;

  const label = <label htmlFor={id}>{attr.label}{required && ' *'}</label>;

  switch (attr.type) {
    case 'enum':
      return (
        <div className="form-field">
          {label}
          <select id={id} name={name} defaultValue="" required={required}>
            <option value="">{required ? 'Select…' : '(none)'}</option>
            {attr.options.map((option) => (
              <option key={option} value={option}>
                {attr.optionLabels?.[option] ?? option}
              </option>
            ))}
          </select>
          {attr.help !== undefined && <small className="field-help">{attr.help}</small>}
        </div>
      );

    case 'boolean':
      return (
        <div className="form-field form-field--checkbox">
          <label htmlFor={id}>
            <input id={id} name={name} type="checkbox" value="true" />
            {attr.label}
          </label>
          {attr.help !== undefined && <small className="field-help">{attr.help}</small>}
        </div>
      );

    case 'number':
      return (
        <div className="form-field">
          {label}
          <input
            id={id}
            name={name}
            type="number"
            step={attr.integer === true ? 1 : 'any'}
            min={attr.min}
            max={attr.max}
            required={required}
          />
          {attr.help !== undefined && <small className="field-help">{attr.help}</small>}
        </div>
      );

    case 'year':
      return (
        <div className="form-field">
          {label}
          <input id={id} name={name} type="number" step={1} min={1800} max={new Date().getFullYear() + 1} required={required} />
          {attr.help !== undefined && <small className="field-help">{attr.help}</small>}
        </div>
      );

    case 'text':
      return (
        <div className="form-field">
          {label}
          <input id={id} name={name} type="text" maxLength={attr.maxLength} required={required} />
          {attr.help !== undefined && <small className="field-help">{attr.help}</small>}
        </div>
      );
  }
}
