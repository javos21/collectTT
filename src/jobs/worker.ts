/**
 * THE WORKER PROCESS entry point. One of the two persistent processes.
 *
 * Deliberately a long-running server rather than cron or a serverless function:
 * auction soft-close needs second-level accuracy (below cron's one-minute floor), and
 * the pooled Postgres connection wants to stay open.
 *
 * Run locally with `npm run dev:worker`; on Render this is the `worker` service.
 */

import '../lib/load-env';
import { run, type RunnerOptions } from 'graphile-worker';

import { env } from '../lib/env';
import { registerAdapters } from '../notifications/adapters/index';
import { taskList, IMPLEMENTED_TASKS } from './tasks/index';

/** Cron lines whose task is actually implemented. Keeps the worker log clean. */
function scheduledCrontab(): string {
  const wanted: Array<[schedule: string, task: string]> = [
    ['0 3 * * *', 'reputation:recompute'],
    ['30 3 * * *', 'consistency:check'],
  ];
  return wanted
    .filter(([, task]) => IMPLEMENTED_TASKS.includes(task))
    .map(([schedule, task]) => `${schedule} ${task}`)
    .join('\n');
}

async function main(): Promise<void> {
  const e = env();
  registerAdapters();

  const options: RunnerOptions = {
    connectionString: e.DATABASE_URL,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    // Graphile Worker installs/updates its own schema in our Postgres. No Redis, no
    // separate queue service, no extra vendor.
    noHandleSignals: false,
    // LISTEN/NOTIFY wakes the worker immediately; this is just the safety net.
    pollInterval: 2000,
    taskList,
    // Cron entries are added only for tasks that actually exist — Graphile Worker
    // errors on an unknown task name, and these two land in Phase 1 / Phase 2.
    //   '0 3 * * * reputation:recompute'   rolling 90-day windows, cannot be incremental
    //   '30 3 * * * consistency:check'     asserts the custody mirror has not drifted
    ...(scheduledCrontab().length > 0 ? { crontab: scheduledCrontab() } : {}),
  };

  console.log(`[worker] starting with ${IMPLEMENTED_TASKS.length} task(s):`);
  for (const task of IMPLEMENTED_TASKS) console.log(`[worker]   - ${task}`);

  const runner = await run(options);

  console.log('[worker] ready');
  await runner.promise;
}

main().catch((error: unknown) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
