/**
 * Per-category attribute DECLARATIONS.
 *
 * One config object per category feeds four consumers:
 *   1. a Zod validator          (./build-schema.ts)
 *   2. the listing form renderer (src/app/…)
 *   3. the browse/search filters (./filters.ts)
 *   4. the `categories` seed rows (scripts/seed-categories.ts)
 *
 * Adding a category is a new object here plus `npm run seed:categories`.
 * No migration, no new table, no form code, no schema change.
 */

interface AttributeBase {
  key: string;
  label: string;
  /** Shown under the field in the listing form. */
  help?: string;
  required?: boolean;
  /** Exposed as a browse/search filter. Drives index recommendations. */
  filterable?: boolean;
}

export interface TextAttribute extends AttributeBase {
  type: 'text';
  maxLength?: number;
}

export interface EnumAttribute extends AttributeBase {
  type: 'enum';
  options: readonly string[];
  /** Human labels for the options, keyed by option value. */
  optionLabels?: Readonly<Record<string, string>>;
}

export interface NumberAttribute extends AttributeBase {
  type: 'number';
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface BooleanAttribute extends AttributeBase {
  type: 'boolean';
}

export interface YearAttribute extends AttributeBase {
  type: 'year';
}

export type AttributeDef =
  | TextAttribute
  | EnumAttribute
  | NumberAttribute
  | BooleanAttribute
  | YearAttribute;

export type AttributeType = AttributeDef['type'];

export interface CategoryDefinition {
  /** Stable key. Becomes the `categories.key` primary key and `listings.category`. */
  key: string;
  label: string;
  /**
   * Bump when the attribute set changes. Listings record the version that validated
   * them (`listings.attributes_version`), so old listings stay valid forever.
   */
  version: number;
  sortOrder: number;
  attributes: readonly AttributeDef[];
}
