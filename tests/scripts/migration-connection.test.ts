import { describe, expect, it, vi } from 'vitest';

import { connectForMigration } from '../../scripts/migration-connection';

describe('connectForMigration', () => {
  it('retries when the session pool temporarily has no client slots', async () => {
    const client = { release: vi.fn() };
    const connect = vi
      .fn<() => Promise<typeof client>>()
      .mockRejectedValueOnce(Object.assign(
        new Error('(EMAXCONNSESSION) max clients reached in session mode'),
        { code: 'XX000' },
      ))
      .mockResolvedValueOnce(client);
    const sleep = vi.fn<(_delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(connectForMigration(connect, { attempts: 3, sleep })).resolves.toBe(client);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry unrelated database failures', async () => {
    const failure = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const connect = vi.fn<() => Promise<never>>().mockRejectedValue(failure);
    const sleep = vi.fn<(_delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(connectForMigration(connect, { attempts: 6, sleep })).rejects.toBe(failure);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails after the configured number of session-pool retries', async () => {
    const failure = Object.assign(new Error('max clients reached'), { code: '53300' });
    const connect = vi.fn<() => Promise<never>>().mockRejectedValue(failure);
    const sleep = vi.fn<(_delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(connectForMigration(connect, { attempts: 3, sleep })).rejects.toBe(failure);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
