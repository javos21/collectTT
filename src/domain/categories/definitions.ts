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
    version: 1,
    sortOrder: 10,
    attributes: [
      {
        key: 'game',
        label: 'Game',
        type: 'enum',
        required: true,
        filterable: true,
        options: ['pokemon', 'magic', 'yugioh', 'sports', 'other'],
        optionLabels: {
          pokemon: 'Pokémon',
          magic: 'Magic: The Gathering',
          yugioh: 'Yu-Gi-Oh!',
          sports: 'Sports',
          other: 'Other',
        },
      },
      { key: 'set', label: 'Set', type: 'text', required: true, filterable: true, maxLength: 120 },
      { key: 'card_name', label: 'Card name', type: 'text', required: true, maxLength: 160 },
      { key: 'card_number', label: 'Card number', type: 'text', maxLength: 40 },
      { key: 'rarity', label: 'Rarity', type: 'text', filterable: true, maxLength: 60 },
      {
        key: 'condition',
        label: 'Condition',
        type: 'enum',
        required: true,
        filterable: true,
        options: ['NM', 'LP', 'MP', 'HP', 'DMG'],
        optionLabels: {
          NM: 'Near Mint',
          LP: 'Lightly Played',
          MP: 'Moderately Played',
          HP: 'Heavily Played',
          DMG: 'Damaged',
        },
        help: 'Ungraded condition. Leave as-is if the card is graded.',
      },
      { key: 'graded', label: 'Graded', type: 'boolean', filterable: false },
      {
        key: 'grader',
        label: 'Grading company',
        type: 'enum',
        filterable: true,
        options: ['PSA', 'BGS', 'CGC', 'SGC', 'other'],
      },
      {
        key: 'grade',
        label: 'Grade',
        type: 'number',
        filterable: true,
        min: 1,
        max: 10,
        help: '1–10. Only if the card is graded.',
      },
      { key: 'foil', label: 'Foil / holo', type: 'boolean', filterable: true },
      { key: 'language', label: 'Language', type: 'text', maxLength: 40 },
    ],
  },

  comic: {
    key: 'comic',
    label: 'Comic',
    version: 1,
    sortOrder: 20,
    attributes: [
      { key: 'title', label: 'Title', type: 'text', required: true, filterable: true, maxLength: 160 },
      { key: 'issue', label: 'Issue #', type: 'text', required: true, maxLength: 40 },
      {
        key: 'publisher',
        label: 'Publisher',
        type: 'enum',
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
      { key: 'year', label: 'Year', type: 'year', filterable: true },
      { key: 'variant', label: 'Variant / printing', type: 'text', maxLength: 120 },
      { key: 'key_issue', label: 'Key issue', type: 'boolean', filterable: true, help: 'First appearance, death, major event, etc.' },
      { key: 'graded', label: 'Slabbed / graded', type: 'boolean', filterable: false },
      {
        key: 'grader',
        label: 'Grading company',
        type: 'enum',
        filterable: true,
        options: ['CGC', 'CBCS', 'PGX', 'other'],
      },
      { key: 'grade', label: 'Grade', type: 'number', filterable: true, min: 0.5, max: 10 },
      {
        key: 'condition',
        label: 'Condition',
        type: 'enum',
        filterable: true,
        options: ['mint', 'near_mint', 'very_fine', 'fine', 'good', 'fair', 'poor'],
        help: 'Raw condition. Leave as-is if slabbed.',
      },
    ],
  },

  collectible: {
    key: 'collectible',
    label: 'Collectible',
    version: 1,
    sortOrder: 30,
    attributes: [
      {
        key: 'item_type',
        label: 'Type',
        type: 'text',
        required: true,
        filterable: true,
        maxLength: 120,
        help: 'Figure, statue, plush, sealed box, funko, etc.',
      },
      { key: 'brand', label: 'Brand / manufacturer', type: 'text', filterable: true, maxLength: 120 },
      { key: 'franchise', label: 'Franchise', type: 'text', filterable: true, maxLength: 120 },
      { key: 'year', label: 'Year', type: 'year', filterable: true },
      { key: 'sealed', label: 'Sealed / unopened', type: 'boolean', filterable: true },
      { key: 'condition', label: 'Condition', type: 'text', maxLength: 200 },
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
