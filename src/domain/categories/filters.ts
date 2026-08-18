/**
 * CategoryDefinition -> browse/search filter descriptors.
 *
 * The browse UI is a fast-follow, but the descriptors and the SQL fragments they
 * produce exist from day one so the data model is provably filterable. Every
 * `filterable: true` attribute becomes a filter here and a candidate for a targeted
 * expression index (the GIN index on `attributes` covers containment already).
 */

import type { AttributeDef, CategoryDefinition } from './types';
import { getCategory, CATEGORY_LIST } from './definitions';

export interface FilterDescriptor {
  categoryKey: string;
  key: string;
  label: string;
  type: AttributeDef['type'];
  /** Present for enum attributes — the selectable values. */
  options?: readonly string[];
  optionLabels?: Readonly<Record<string, string>>;
  /** Numeric/year attributes render as a range control. */
  range?: { min?: number; max?: number };
}

export function filtersFor(categoryKey: string): FilterDescriptor[] {
  return descriptorsFrom(getCategory(categoryKey));
}

export function allFilters(): FilterDescriptor[] {
  return CATEGORY_LIST.flatMap(descriptorsFrom);
}

function descriptorsFrom(def: CategoryDefinition): FilterDescriptor[] {
  return def.attributes
    .filter((a) => a.filterable === true)
    .map((a) => {
      const base: FilterDescriptor = {
        categoryKey: def.key,
        key: a.key,
        label: a.label,
        type: a.type,
      };
      if (a.type === 'enum') {
        base.options = a.options;
        if (a.optionLabels !== undefined) base.optionLabels = a.optionLabels;
      }
      if (a.type === 'number') {
        base.range = { min: a.min, max: a.max };
      }
      if (a.type === 'year') {
        base.range = { min: 1800, max: new Date().getUTCFullYear() + 1 };
      }
      return base;
    });
}

/**
 * Coerce a raw query-string filter value to the JSON type the attribute is actually
 * STORED as.
 *
 * Query strings are all strings, but JSONB containment is type-strict: the stored
 * `{"key_issue": true}` is not matched by `{"key_issue": "true"}`, and `{"year": 1974}`
 * is not matched by `{"year": "1974"}`. Without this, every boolean and numeric filter
 * silently returns zero results — which looks like "no listings" rather than a bug.
 *
 * Returns null when the attribute is not declared filterable, so a query string cannot
 * smuggle arbitrary predicates into the JSONB query.
 */
export function coerceFilterValue(
  categoryKey: string,
  attributeKey: string,
  raw: string,
): string | number | boolean | null {
  const def = getCategory(categoryKey);
  const attr = def.attributes.find((a) => a.key === attributeKey && a.filterable === true);
  if (attr === undefined || raw === '') return null;

  switch (attr.type) {
    case 'boolean':
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return null;
    case 'number':
    case 'year': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'enum':
      return attr.options.includes(raw) ? raw : null;
    case 'text':
      return raw;
  }
}

/**
 * Build the whole filter object for a category from raw query-string params, dropping
 * anything undeclared or uncoercible.
 */
export function coerceFilters(
  categoryKey: string,
  params: Record<string, string | undefined>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const filter of filtersFor(categoryKey)) {
    const raw = params[filter.key];
    if (raw === undefined) continue;
    const value = coerceFilterValue(categoryKey, filter.key, raw);
    if (value !== null) out[filter.key] = value;
  }
  return out;
}

/**
 * Which expression indexes are worth creating, derived from the declarations.
 * Printed by `npm run seed:categories` so index coverage tracks the config instead of
 * drifting from it. We add these deliberately rather than automatically — at 2,000
 * members the GIN index carries most of the load and every extra index costs writes.
 */
export function recommendedIndexes(): string[] {
  return CATEGORY_LIST.flatMap((def) =>
    def.attributes
      .filter((a) => a.filterable === true)
      .map(
        (a) =>
          `CREATE INDEX IF NOT EXISTS listings_${def.key}_${a.key}_idx ` +
          `ON listings ((attributes->>'${a.key}')) WHERE category = '${def.key}';`,
      ),
  );
}
