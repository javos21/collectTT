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
import { run, type Runner, type RunnerOptions } from 'graphile-worker';

import { pool } from '../db/client';
import { env } from '../lib/env';
import { registerAdapters } from '../notifications/adapters/index';
import { taskList, IMPLEMENTED_TASKS } from './tasks/index';

/**
 * `tsx watch` gives a child process five seconds to stop before sending SIGKILL.
 * Keep the development default below that deadline, while allowing a production
 * supervisor to opt into a longer graceful window.
 */
const defaultShutdownTimeoutMs = process.env.NODE_ENV === 'production' ? 30_000 : 4_000;
const configuredShutdownTimeoutMs = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS);
const shutdownTimeoutMs =
  Number.isFinite(configuredShutdownTimeoutMs) && configuredShutdownTimeoutMs > 0
    ? configuredShutdownTimeoutMs
    : defaultShutdownTimeoutMs;

let runner: Runner | null = null;
let shuttingDown = false;
let appPoolClosed = false;

async function closeAppPool(): Promise<void> {
  if (appPoolClosed) return;
  appPoolClosed = true;
  await pool.end();
}

/**
 * Graphile Worker has its own signal handling, but its graceful shutdown waits for
 * every active task. That is a poor fit for `tsx watch`: a task blocked on a network
 * request can outlive tsx's five-second restart window and leave the watcher printing
 * "Process didn't exit" forever. Stop the runner ourselves and retain a hard upper
 * bound so both Ctrl-C and hot reload always make progress.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  const forceExit = setTimeout(() => {
    console.error(`[worker] shutdown exceeded ${shutdownTimeoutMs}ms; forcing exit`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }, shutdownTimeoutMs);

  try {
    if (runner !== null) {
      await runner.stop();
    }
  } catch (error) {
    console.error('[worker] shutdown error while stopping runner', error);
  }

  try {
    await closeAppPool();
  } catch (error) {
    console.error('[worker] shutdown error while closing app DB pool', error);
  } finally {
    clearTimeout(forceExit);
  }

  process.exit(signal === 'SIGINT' ? 130 : 143);
}

function handleSignal(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    // A second signal is the user's request to stop waiting. This also handles the
    // terminal sending SIGINT to both tsx and its child at the same time.
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }

  shuttingDown = true;
  void shutdown(signal);
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

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
  try {
    env();
    registerAdapters();

    const options: RunnerOptions = {
      // Reuse the application's pool so there is one database pool to close on exit.
      // Passing `pgPool` also prevents Graphile Worker from creating a second pool
      // whose sockets can otherwise outlive a hot-reloaded child process.
      pgPool: pool,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
      // The web process shares the same hosted Postgres session pool. A bounded worker
      // pool prevents a local worker from consuming all connections needed by the UI.
      // Signal handling is owned above so tsx watch and production supervisors get the
      // same bounded shutdown behavior.
      noHandleSignals: true,
      // Give handlers that honor helpers.abortSignal a chance to cancel before the
      // outer timeout has to terminate the process.
      gracefulShutdownAbortTimeout: Math.max(100, shutdownTimeoutMs - 500),
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

    runner = await run(options);

    console.log('[worker] ready');
    await runner.promise;
  } finally {
    // Covers startup failures and non-signal runner failures. Signal shutdown owns
    // this cleanup once `shuttingDown` is set.
    if (!shuttingDown) await closeAppPool();
  }
}

main().catch((error: unknown) => {
  console.error('[worker] fatal', error);
  process.exitCode = 1;
});
