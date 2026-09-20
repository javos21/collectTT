export interface MigrationConnectionRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number) => void;
}

function isTemporarySessionPoolExhaustion(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return code === 'EMAXCONNSESSION'
    || code === '53300'
    || error.message.includes('EMAXCONNSESSION')
    || error.message.includes('max clients reached in session mode');
}

/** Acquire the dedicated session connection used by the migration runner. */
export async function connectForMigration<T>(
  connect: () => Promise<T>,
  options: MigrationConnectionRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 6);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 10_000);
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      if (!isTemporarySessionPoolExhaustion(error) || attempt === attempts) throw error;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.(attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw new Error('Migration connection retry loop exhausted unexpectedly.');
}
