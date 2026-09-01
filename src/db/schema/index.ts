/**
 * The complete schema. `drizzle.config.ts` points here.
 *
 * A handful of foreign keys are genuinely circular (listings ↔ transactions,
 * custody_holdings ↔ transactions, reputation_events → transactions) and are added by
 * `drizzle/9999_circular_fks.sql` after every table exists. Those columns are declared
 * as plain uuid here with a comment saying so.
 */

export * from './enums';
export * from './auth';
export * from './images';
export * from './profiles';
export * from './listings';
export * from './catalog';
export * from './offers';
export * from './custody';
export * from './store-applications';
export * from './transactions';
export * from './notifications';
export * from './settings';
