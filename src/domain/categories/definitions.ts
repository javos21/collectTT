/**
 * THE category registry. This file is the authority; the `categories` table is a
 * seeded mirror that exists only so `listings.category` can carry a real foreign key.
 *
 * To add a category:
 *   1. add an object below
 *   2. run `npm run seed:categories`
 * That is the whole procedure. No migration.
 */

import type { CategoryDefinition } from './types';

export const CATEGORIES = {
  trading_card: {
    key: 'trading_card',
    label: 'Trading Card',
    version: 2,
    sortOrder: 10,
    attributes: [
      {
        key: 'game', label: 'Game', type: 'enum', required: true, filterable: true,
        options: ['pokemon', 'magic', 'yugioh', 'sports', 'other'],
        optionLabels: { pokemon: 'Pokémon', magic: 'Magic: The Gathering', yugioh: 'Yu-Gi-Oh!', sports: 'Sports', other: 'Other' },
      },
      {
        key: 'condition', label: 'Condition', type: 'enum', required: true, filterable: true,
        options: ['NM', 'LP', 'MP', 'HP', 'DMG'],
        optionLabels: { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' },
      },
    ],
  },

  comic: {
    key: 'comic',
    label: 'Comic',
    version: 2,
    sortOrder: 20,
    attributes: [
      {
        key: 'publisher',
        label: 'Publisher',
        type: 'enum',
        required: true,
        filterable: true,
        options: ['marvel', 'dc', 'image', 'dark_horse', 'idw', 'other'],
        optionLabels: {
          marvel: 'Marvel',
          dc: 'DC',
          image: 'Image',
          dark_horse: 'Dark Horse',
          idw: 'IDW',
          other: 'Other',
        },
      },
      {
        key: 'condition',
        label: 'Condition',
        type: 'enum',
        required: true,
        filterable: true,
        options: ['mint', 'near_mint', 'very_fine', 'fine', 'good', 'fair', 'poor'],
      },
    ],
  },

  collectible: {
    key: 'collectible',
    label: 'Collectible',
    version: 2,
    sortOrder: 30,
    attributes: [
      {
        key: 'brand',
        label: 'Brand',
        type: 'text',
        required: true,
        filterable: true,
        maxLength: 120,
      },
      { key: 'condition', label: 'Condition', type: 'text', required: true, maxLength: 200 },
    ],
  },
} as const satisfies Record<string, CategoryDefinition>;

export type CategoryKey = keyof typeof CATEGORIES;

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

export const CATEGORY_LIST: readonly CategoryDefinition[] = Object.values(CATEGORIES).sort(
  (a, b) => a.sortOrder - b.sortOrder,
);

export function isCategoryKey(value: string): value is CategoryKey {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

export function getCategory(key: string): CategoryDefinition {
  if (!isCategoryKey(key)) {
    throw new UnknownCategoryError(key);
  }
  return CATEGORIES[key];
}

export class UnknownCategoryError extends Error {
  constructor(readonly key: string) {
    super(
      `Unknown category "${key}". Categories are declared in src/domain/categories/definitions.ts; ` +
        `after adding one, run \`npm run seed:categories\`.`,
    );
    this.name = 'UnknownCategoryError';
  }
}
