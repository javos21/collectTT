import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { catalogValues } from '@/db/schema/catalog';
import { categories } from '@/db/schema/listings';
import { buildAttributeSchema } from '@/domain/categories/build-schema';
import { CATEGORIES, CATEGORY_LIST, getCategory } from '@/domain/categories/definitions';
import type { AttributeDef, CategoryDefinition } from '@/domain/categories/types';

export type CatalogKind = 'game' | 'condition';
export type CatalogValue = {
  id?: string;
  kind: CatalogKind;
  key: string;
  label: string;
  sortOrder: number;
  active: boolean;
};

function defaultCatalogValues(kind: CatalogKind): CatalogValue[] {
  const values: CatalogValue[] = [];
  for (const category of CATEGORY_LIST) {
    for (const attribute of category.attributes) {
      if (attribute.type !== 'enum' || attribute.key !== kind) continue;
      attribute.options.forEach((key, index) => values.push({
        kind,
        key,
        label: attribute.optionLabels?.[key] ?? key,
        sortOrder: index * 10,
        active: true,
      }));
    }
  }
  return values.filter((value, index, all) => all.findIndex((item) => item.key === value.key) === index);
}

/**
 * Return the admin-managed values merged over the built-in catalog defaults.
 * A database override wins by key; an inactive override hides that value from new
 * forms while still allowing historical listings to display its label.
 */
export async function listCatalogValues(
  kind: CatalogKind,
  opts: { activeOnly?: boolean } = {},
): Promise<CatalogValue[]> {
  const rows = await db
    .select({ id: catalogValues.id, kind: catalogValues.kind, key: catalogValues.key, label: catalogValues.label, sortOrder: catalogValues.sortOrder, active: catalogValues.active })
    .from(catalogValues)
    .where(eq(catalogValues.kind, kind))
    .orderBy(asc(catalogValues.sortOrder), asc(catalogValues.label));
  const overrides = new Map(rows.map((row) => [row.key, row]));
  const merged = defaultCatalogValues(kind).map((value) => {
    const override = overrides.get(value.key);
    return override === undefined ? value : override;
  });
  for (const row of rows) {
    if (!merged.some((value) => value.key === row.key)) merged.push(row);
  }
  return opts.activeOnly === true ? merged.filter((value) => value.active) : merged;
}

function withCatalogValues(definition: CategoryDefinition, values: ReadonlyMap<CatalogKind, readonly CatalogValue[]>): CategoryDefinition {
  const attributes = definition.attributes.map((attribute): AttributeDef => {
    if (attribute.type !== 'enum' || (attribute.key !== 'game' && attribute.key !== 'condition')) return attribute;
    const managed = values.get(attribute.key);
    if (managed === undefined) return attribute;
    return {
      ...attribute,
      options: managed.map((value) => value.key),
      optionLabels: Object.fromEntries(managed.map((value) => [value.key, value.label])),
    };
  });
  return { ...definition, attributes };
}

export async function categoryDefinitionWithCatalogValues(
  categoryKey: string,
  opts: { activeOnly?: boolean } = {},
): Promise<CategoryDefinition> {
  const definition = getCategory(categoryKey);
  const [categoryRow, games, conditions] = await Promise.all([
    db.select({ label: categories.label, sortOrder: categories.sortOrder })
      .from(categories)
      .where(eq(categories.key, categoryKey))
      .limit(1),
    listCatalogValues('game', opts),
    listCatalogValues('condition', opts),
  ]);
  const stored = categoryRow[0];
  return withCatalogValues({
    ...definition,
    ...(stored === undefined ? {} : { label: stored.label, sortOrder: stored.sortOrder }),
  }, new Map([
    ['game', games],
    ['condition', conditions],
  ]));
}

/** Definitions available for new listings, including admin-renamed categories. */
export async function activeCategoryDefinitions(): Promise<CategoryDefinition[]> {
  const [categoryRows, games, conditions] = await Promise.all([
    db.select({ key: categories.key, label: categories.label, sortOrder: categories.sortOrder, active: categories.active })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.label)),
    listCatalogValues('game', { activeOnly: true }),
    listCatalogValues('condition', { activeOnly: true }),
  ]);
  const stored = new Map(categoryRows.map((row) => [row.key, row]));
  const values = new Map<CatalogKind, readonly CatalogValue[]>([['game', games], ['condition', conditions]]);
  const definitions = CATEGORY_LIST
    .map((definition) => {
      const row = stored.get(definition.key);
      if (row?.active === false) return null;
      return withCatalogValues({
        ...definition,
        ...(row === undefined ? {} : { label: row.label, sortOrder: row.sortOrder }),
      }, values);
    })
    .filter((definition): definition is CategoryDefinition => definition !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return definitions.length > 0 ? definitions : CATEGORY_LIST.map((definition) => withCatalogValues(definition, values));
}

export async function parseAttributesWithCatalogValues(categoryKey: string, raw: unknown) {
  const definition = await categoryDefinitionWithCatalogValues(categoryKey, { activeOnly: true });
  const attributes = buildAttributeSchema(definition).parse(raw) as Record<string, unknown>;
  return { attributes, version: definition.version };
}

export function categoryLabelFallback(categoryKey: string): string {
  return CATEGORIES[categoryKey as keyof typeof CATEGORIES]?.label ?? categoryKey.replace(/_/g, ' ');
}
