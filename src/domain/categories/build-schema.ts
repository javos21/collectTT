/**
 * CategoryDefinition -> Zod schema.
 *
 * The generated object is `.strict()` on purpose: unknown attribute keys are rejected,
 * so the JSONB column cannot silently accumulate junk. Schemaless flexibility is for
 * things we deliberately declared, not for anything a caller feels like sending.
 */

import { z } from 'zod';
import type { AttributeDef, CategoryDefinition } from './types';
import { getCategory } from './definitions';

const CURRENT_YEAR = new Date().getUTCFullYear();

function schemaForAttribute(attr: AttributeDef): z.ZodTypeAny {
  switch (attr.type) {
    case 'text': {
      let s = z.string().trim().min(1, `${attr.label} cannot be empty`);
      if (attr.maxLength !== undefined) {
        s = s.max(attr.maxLength, `${attr.label} must be ${attr.maxLength} characters or fewer`);
      }
      return s;
    }
    case 'enum': {
      // z.enum needs a non-empty tuple; every declared enum has options by construction.
      const [first, ...rest] = attr.options;
      if (first === undefined) {
        throw new Error(`Enum attribute "${attr.key}" declares no options`);
      }
      return z.enum([first, ...rest], {
        errorMap: () => ({ message: `${attr.label} must be one of: ${attr.options.join(', ')}` }),
      });
    }
    case 'number': {
      let s = attr.integer ? z.number().int(`${attr.label} must be a whole number`) : z.number();
      if (attr.min !== undefined) s = s.min(attr.min, `${attr.label} must be at least ${attr.min}`);
      if (attr.max !== undefined) s = s.max(attr.max, `${attr.label} must be at most ${attr.max}`);
      return s;
    }
    case 'boolean':
      return z.boolean();
    case 'year':
      return z
        .number()
        .int()
        .min(1800, `${attr.label} must be 1800 or later`)
        .max(CURRENT_YEAR + 1, `${attr.label} cannot be in the future`);
  }
}

/**
 * Build the Zod object for one category's `attributes` JSONB payload.
 * Optional attributes accept `undefined` but never `null`, so absent means absent.
 */
export function buildAttributeSchema(def: CategoryDefinition): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const attr of def.attributes) {
    const base = schemaForAttribute(attr);
    shape[attr.key] = attr.required === true ? base : base.optional();
  }

  return z.object(shape).strict();
}

/** Memoized per category key — these are built once and reused on every request. */
const schemaCache = new Map<string, z.ZodTypeAny>();

export function attributeSchemaFor(categoryKey: string): z.ZodTypeAny {
  const cached = schemaCache.get(categoryKey);
  if (cached !== undefined) return cached;

  const built = buildAttributeSchema(getCategory(categoryKey));
  schemaCache.set(categoryKey, built);
  return built;
}

export interface ParsedAttributes {
  attributes: Record<string, unknown>;
  /** The category version that validated this payload — stored on the listing row. */
  version: number;
}

/**
 * Validate a raw attributes payload against its category.
 * Throws ZodError on invalid input; callers surface `.issues` as form errors.
 */
export function parseAttributes(categoryKey: string, raw: unknown): ParsedAttributes {
  const def = getCategory(categoryKey);
  const parsed = attributeSchemaFor(categoryKey).parse(raw) as Record<string, unknown>;
  return { attributes: parsed, version: def.version };
}

/** Non-throwing variant, for form handlers that want to render field errors. */
export function safeParseAttributes(categoryKey: string, raw: unknown) {
  return attributeSchemaFor(categoryKey).safeParse(raw);
}
