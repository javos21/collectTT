import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Values that are shared by listing attribute definitions and the admin catalog. */
export const catalogValueKindEnum = pgEnum('catalog_value_kind', ['game', 'condition']);

export const catalogValues = pgTable(
  'catalog_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: catalogValueKindEnum('kind').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('catalog_values_kind_key_unique').on(t.kind, t.key),
    index('catalog_values_kind_active_order').on(t.kind, t.active, t.sortOrder),
  ],
);
