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
    <>
      <label htmlFor="category">Category</label>
      <select
        id="category"
        name="category"
        value={categoryKey}
        onChange={(e) => setCategoryKey(e.target.value)}
      >
        {categories.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>

      {selected !== undefined && (
        <fieldset>
          <legend>{selected.label} details</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            These fields come from the category config, not from hardcoded form code.
          </p>
          {selected.attributes.map((attr) => (
            <Field key={attr.key} attr={attr} />
          ))}
        </fieldset>
      )}
    </>
  );
}

function Field({ attr }: { attr: AttributeDef }) {
  const id = `attr_${attr.key}`;
  // Namespaced so the server action can pick attributes out of the flat FormData
  // without knowing which category is in play.
  const name = `attr__${attr.key}`;
  const required = attr.required === true;

  const label = (
    <label htmlFor={id}>
      {attr.label}
      {required && ' *'}
      {attr.filterable === true && <span className="pill" style={{ marginLeft: '.4rem' }}>filterable</span>}
    </label>
  );

  switch (attr.type) {
    case 'enum':
      return (
        <>
          {label}
          <select id={id} name={name} defaultValue="">
            <option value="">{required ? 'Select…' : '(none)'}</option>
            {attr.options.map((option) => (
              <option key={option} value={option}>
                {attr.optionLabels?.[option] ?? option}
              </option>
            ))}
          </select>
          {attr.help !== undefined && <p className="muted">{attr.help}</p>}
        </>
      );

    case 'boolean':
      return (
        <>
          <label htmlFor={id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <input id={id} name={name} type="checkbox" value="true" />
            {attr.label}
          </label>
          {attr.help !== undefined && <p className="muted">{attr.help}</p>}
        </>
      );

    case 'number':
      return (
        <>
          {label}
          <input
            id={id}
            name={name}
            type="number"
            step={attr.integer === true ? 1 : 'any'}
            min={attr.min}
            max={attr.max}
          />
          {attr.help !== undefined && <p className="muted">{attr.help}</p>}
        </>
      );

    case 'year':
      return (
        <>
          {label}
          <input id={id} name={name} type="number" step={1} min={1800} max={new Date().getFullYear() + 1} />
          {attr.help !== undefined && <p className="muted">{attr.help}</p>}
        </>
      );

    case 'text':
      return (
        <>
          {label}
          <input id={id} name={name} type="text" maxLength={attr.maxLength} />
          {attr.help !== undefined && <p className="muted">{attr.help}</p>}
        </>
      );
  }
}
