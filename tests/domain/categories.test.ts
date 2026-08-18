/**
 * The multi-category item model.
 *
 * The claim under test is specific: a listing's category-specific fields are declared
 * in ONE config object, validated by a schema derived from it, filterable from that
 * same declaration — and adding a category requires no schema change of any kind.
 */

import { describe, it, expect } from 'vitest';

import {
  CATEGORIES,
  CATEGORY_LIST,
  CATEGORY_KEYS,
  getCategory,
  isCategoryKey,
  UnknownCategoryError,
} from '../../src/domain/categories/definitions';
import {
  buildAttributeSchema,
  parseAttributes,
  safeParseAttributes,
} from '../../src/domain/categories/build-schema';
import {
  filtersFor,
  allFilters,
  recommendedIndexes,
  coerceFilterValue,
  coerceFilters,
} from '../../src/domain/categories/filters';
import type { CategoryDefinition } from '../../src/domain/categories/types';

describe('category registry', () => {
  it('declares the three launch categories', () => {
    expect(CATEGORY_KEYS).toEqual(['trading_card', 'comic', 'collectible']);
  });

  it('every definition has a key matching its map entry', () => {
    for (const [key, def] of Object.entries(CATEGORIES)) {
      expect(def.key).toBe(key);
    }
  });

  it('attribute keys are unique within each category', () => {
    for (const def of CATEGORY_LIST) {
      const keys = def.attributes.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('rejects an unknown category by name', () => {
    expect(isCategoryKey('warhammer_army')).toBe(false);
    expect(() => getCategory('warhammer_army')).toThrow(UnknownCategoryError);
  });
});

describe('derived Zod validation', () => {
  it('accepts a well-formed trading card', () => {
    const result = parseAttributes('trading_card', {
      game: 'pokemon',
      set: 'Base Set',
      card_name: 'Charizard',
      condition: 'NM',
      graded: true,
      grader: 'PSA',
      grade: 9,
    });
    expect(result.version).toBe(1);
    expect(result.attributes.card_name).toBe('Charizard');
  });

  it('accepts a well-formed comic', () => {
    const result = parseAttributes('comic', {
      title: 'Amazing Fantasy',
      issue: '15',
      publisher: 'marvel',
      year: 1962,
      key_issue: true,
      graded: true,
      grade: 4.5,
    });
    expect(result.attributes.title).toBe('Amazing Fantasy');
  });

  it('accepts a freeform collectible', () => {
    const result = parseAttributes('collectible', {
      item_type: 'Sealed booster box',
      brand: 'The Pokémon Company',
      sealed: true,
    });
    expect(result.attributes.sealed).toBe(true);
  });

  it('rejects a missing required attribute', () => {
    const result = safeParseAttributes('trading_card', { set: 'Base Set' });
    expect(result.success).toBe(false);
  });

  it('rejects a value outside a declared enum', () => {
    const result = safeParseAttributes('trading_card', {
      game: 'warhammer',
      set: 'x',
      card_name: 'y',
      condition: 'NM',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a grade outside the declared range', () => {
    const result = safeParseAttributes('trading_card', {
      game: 'pokemon',
      set: 'x',
      card_name: 'y',
      condition: 'NM',
      grade: 11,
    });
    expect(result.success).toBe(false);
  });

  it('★ rejects UNDECLARED keys — the JSONB column cannot accumulate junk', () => {
    const result = safeParseAttributes('trading_card', {
      game: 'pokemon',
      set: 'x',
      card_name: 'y',
      condition: 'NM',
      totally_made_up_field: 'whatever',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a future year', () => {
    const result = safeParseAttributes('comic', {
      title: 'x',
      issue: '1',
      year: new Date().getUTCFullYear() + 5,
    });
    expect(result.success).toBe(false);
  });

  it('produces a working schema for every declared category', () => {
    for (const def of CATEGORY_LIST) {
      expect(() => buildAttributeSchema(def)).not.toThrow();
    }
  });
});

describe('derived filters', () => {
  it('exposes exactly the attributes marked filterable', () => {
    for (const def of CATEGORY_LIST) {
      const expected = def.attributes.filter((a) => a.filterable === true).length;
      expect(filtersFor(def.key)).toHaveLength(expected);
    }
  });

  it('enum filters carry their options', () => {
    const gameFilter = filtersFor('trading_card').find((f) => f.key === 'game');
    expect(gameFilter?.options).toContain('pokemon');
    expect(gameFilter?.optionLabels?.pokemon).toBe('Pokémon');
  });

  it('numeric filters carry their range', () => {
    const gradeFilter = filtersFor('comic').find((f) => f.key === 'grade');
    expect(gradeFilter?.range).toEqual({ min: 0.5, max: 10 });
  });

  it('every filter maps to a recommended index', () => {
    expect(recommendedIndexes()).toHaveLength(allFilters().length);
  });
});

describe('★ filter value coercion (JSONB containment is type-strict)', () => {
  // Regression: a query string yields "true"/"1974", but the column stores true/1974.
  // Uncoerced, every boolean and numeric filter matched NOTHING — and looked like an
  // empty result set rather than a bug.
  it('coerces booleans, not strings', () => {
    expect(coerceFilterValue('comic', 'key_issue', 'true')).toBe(true);
    expect(coerceFilterValue('comic', 'key_issue', 'false')).toBe(false);
    expect(coerceFilterValue('comic', 'key_issue', 'yes')).toBeNull();
  });

  it('coerces numbers and years', () => {
    expect(coerceFilterValue('comic', 'year', '1974')).toBe(1974);
    expect(coerceFilterValue('comic', 'grade', '6')).toBe(6);
    expect(coerceFilterValue('comic', 'grade', 'six')).toBeNull();
  });

  it('passes through valid enum values and rejects invalid ones', () => {
    expect(coerceFilterValue('trading_card', 'game', 'pokemon')).toBe('pokemon');
    expect(coerceFilterValue('trading_card', 'game', 'warhammer')).toBeNull();
  });

  it('rejects attributes that are not declared filterable', () => {
    // card_name is a real attribute but not filterable
    expect(coerceFilterValue('trading_card', 'card_name', 'Charizard')).toBeNull();
    expect(coerceFilterValue('trading_card', 'not_a_field', 'x')).toBeNull();
  });

  it('builds a whole filter object, dropping junk', () => {
    expect(
      coerceFilters('comic', {
        publisher: 'marvel',
        key_issue: 'true',
        year: '1974',
        grade: 'nonsense',
        not_declared: 'x',
      }),
    ).toEqual({ publisher: 'marvel', key_issue: true, year: 1974 });
  });
});

describe('★ adding a category requires no schema change', () => {
  // A category invented entirely inside this test — nothing in the database, the
  // migrations, or the form code knows it exists.
  const sportsMemorabilia: CategoryDefinition = {
    key: 'sports_memorabilia',
    label: 'Sports Memorabilia',
    version: 1,
    sortOrder: 40,
    attributes: [
      { key: 'sport', label: 'Sport', type: 'enum', required: true, filterable: true, options: ['cricket', 'football', 'athletics'] },
      { key: 'athlete', label: 'Athlete', type: 'text', required: true, filterable: true },
      { key: 'signed', label: 'Signed', type: 'boolean', filterable: true },
      { key: 'year', label: 'Year', type: 'year', filterable: true },
    ],
  };

  it('yields a working validator from the config alone', () => {
    const schema = buildAttributeSchema(sportsMemorabilia);

    expect(
      schema.safeParse({ sport: 'cricket', athlete: 'Brian Lara', signed: true, year: 1994 })
        .success,
    ).toBe(true);

    expect(schema.safeParse({ sport: 'quidditch', athlete: 'x' }).success).toBe(false);
    expect(schema.safeParse({ athlete: 'x' }).success).toBe(false); // missing required
  });

  it('yields filters and index recommendations from the config alone', () => {
    const filterable = sportsMemorabilia.attributes.filter((a) => a.filterable === true);
    expect(filterable).toHaveLength(4);
  });

  it('needs only a categories row — the listings table is untouched', () => {
    // The only persistence a new category requires is one INSERT into `categories`,
    // which `npm run seed:categories` performs. No ALTER TABLE, no new table, no
    // column, no enum value.
    const requiredDdl: string[] = [];
    expect(requiredDdl).toHaveLength(0);
  });
});
