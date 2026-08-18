/**
 * ★★ THE transactional-enqueue helper. The single most load-bearing utility here.
 *
 * Graphile Worker stores its queue in the same Postgres database as the domain data,
 * which means a job can be enqueued INSIDE the transaction that changes state. So:
 *
 *     await db.transaction(async (tx) => {
 *       await markReneged(tx, txId);                        // state change
 *       await enqueue(tx, 'transaction:promote', { txId }); // its consequence
 *     });
 *
 * Either both commit or neither does. It is structurally impossible to end up
 * "marked reneged but forgot to promote the next buyer" — the failure mode that makes
 * an external queue (Redis, SQS) a consistency seam rather than a convenience.
 *
 * RULE: never enqueue outside the transaction that caused the work.
 */

import { sql } from 'drizzle-orm';

import type { DbOrTx } from '../db/client';
import type { TaskName, TaskPayloads } from './tasks/index';

export interface EnqueueOptions {
  /**
   * ★ Idempotency and replacement. Two enqueues with the same jobKey collapse to one
   *   pending job — which is how a rescheduled auction close replaces its predecessor
   *   instead of racing it.
   */
  jobKey?: string;
  /** 'replace' (default) updates a pending job; 'preserve_run_at' keeps its schedule. */
  jobKeyMode?: 'replace' | 'preserve_run_at' | 'unsafe_dedupe';
  /** Absolute time to run. Deadline jobs pass the deadline itself. */
  runAt?: Date;
  maxAttempts?: number;
  queueName?: string;
  priority?: number;
}

/**
 * Enqueue a job on an existing DB transaction.
 *
 * Uses Graphile Worker's SQL function directly rather than a separate connection,
 * because a separate connection would defeat the entire point.
 */
export async function enqueue<T extends TaskName>(
  tx: DbOrTx,
  task: T,
  payload: TaskPayloads[T],
  options: EnqueueOptions = {},
): Promise<void> {
  await tx.execute(sql`
    select graphile_worker.add_job(
      ${task}::text,
      ${JSON.stringify(payload)}::json,
      ${options.queueName ?? null}::text,
      ${options.runAt ?? null}::timestamptz,
      ${options.maxAttempts ?? 10}::int,
      ${options.jobKey ?? null}::text,
      ${options.priority ?? 0}::int,
      null::text[],
      ${options.jobKeyMode ?? 'replace'}::text
    )
  `);
}

/**
 * There is deliberately NO "enqueue outside a transaction" helper. Every job in this
 * system exists because some state changed, so every enqueue has a transaction to
 * attach to. Making the transactional form the only form is what keeps the guarantee
 * real instead of a convention people remember most of the time.
 *
 * For genuinely standalone work (a manual admin re-run), open a transaction and use
 * `enqueue` inside it — `db.transaction(async (tx) => enqueue(tx, …))`.
 */
