'use client';

import { useState } from 'react';

import type { AttributeDef, CategoryDefinition } from '@/domain/categories/types';

export function AttributeFields({
  categories,
  initialCategoryKey,
  initialAttributes = {},
}: {
  categories: CategoryDefinition[];
  initialCategoryKey?: string;
  initialAttributes?: Record<string, unknown>;
}) {
  const [categoryKey, setCategoryKey] = useState(initialCategoryKey ?? categories[0]?.key ?? '');
  const selected = categories.find((category) => category.key === categoryKey);

  return (
    <div className="attribute-fields">
      <div className="form-field">
        <label className="sr-only" htmlFor="category">Category</label>
        <select
          id="category"
          name="category"
          value={categoryKey}
          onChange={(event) => setCategoryKey(event.target.value)}
          aria-label="Category"
          required
        >
          {categories.map((category) => (
            <option key={category.key} value={category.key}>{category.label}</option>
          ))}
        </select>
      </div>

      {selected !== undefined && (
        <div className="category-details">
          <h3>{selected.label} details</h3>
          <div className="form-grid">
            {selected.attributes.map((attribute) => <Field key={attribute.key} attr={attribute} value={initialAttributes[attribute.key]} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ attr, value }: { attr: AttributeDef; value: unknown }) {
  const id = `attr_${attr.key}`;
  const name = `attr__${attr.key}`;
  const required = attr.required === true;
  const label = <label className="sr-only" htmlFor={id}>{attr.label}</label>;

  switch (attr.type) {
    case 'enum':
      return (
        <div className="form-field">
          {label}
          <select id={id} name={name} defaultValue={typeof value === 'string' ? value : ''} aria-label={attr.label} required={required}>
            <option value="">{attr.label}</option>
            {attr.options.map((option) => <option key={option} value={option}>{attr.optionLabels?.[option] ?? option}</option>)}
          </select>
        </div>
      );
    case 'text':
      return (
        <div className="form-field">
          {label}
          <input id={id} name={name} type="text" maxLength={attr.maxLength} defaultValue={typeof value === 'string' ? value : ''} placeholder={attr.label} aria-label={attr.label} required={required} />
        </div>
      );
    case 'number':
    case 'year':
      return (
        <div className="form-field">
          {label}
          <input id={id} name={name} type="number" step={attr.type === 'year' || attr.integer === true ? 1 : 'any'} defaultValue={typeof value === 'number' ? String(value) : ''} min={attr.type === 'year' ? 1800 : attr.min} max={attr.type === 'year' ? new Date().getFullYear() + 1 : attr.max} placeholder={attr.label} aria-label={attr.label} required={required} />
        </div>
      );
    case 'boolean':
      return (
        <label className="choice-card choice-card--compact" htmlFor={id}>
          <input id={id} name={name} type="checkbox" value="true" defaultChecked={value === true} />
          <span>{attr.label}</span>
        </label>
      );
  }
}
