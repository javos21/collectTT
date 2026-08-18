/**
 * The shared domain. Imported by BOTH the web process and the worker process.
 *
 * RULE: nothing under src/domain may import from src/db, src/app, or src/jobs.
 * It is pure types and functions. That constraint is what makes the state machine
 * "defined once" in fact and not just in intention.
 */

export * from './states/index';
export * from './categories/index';
export * from './policy/index';
export * from './money';
