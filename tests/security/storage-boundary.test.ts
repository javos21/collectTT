import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../src/lib/env';
import {
  bucket,
  deleteObject,
  evidenceBucket,
  presignDownload,
  putObject,
} from '../../src/lib/storage';

const createdKeys: string[] = [];

afterEach(async () => {
  for (const key of createdKeys.splice(0)) {
    await deleteObject(key, evidenceBucket());
  }
});

describe('storage bucket boundary', () => {
  it('keeps transaction evidence out of the public image bucket', () => {
    expect(evidenceBucket()).not.toBe(bucket());
  });
});

const isLocalMinio = /^http:\/\/(localhost|127\.0\.0\.1):9000\/?$/.test(env().STORAGE_ENDPOINT);

describe.skipIf(!isLocalMinio)('local storage privacy boundary', () => {
  it('denies anonymous evidence reads while allowing signed reads', async () => {
    const key = `transaction-evidence/security-test/${randomUUID()}`;
    const body = Buffer.from('synthetic evidence');

    await putObject({
      key,
      body,
      contentType: 'application/pdf',
      bucketName: evidenceBucket(),
    });
    createdKeys.push(key);

    const endpoint = env().STORAGE_ENDPOINT.replace(/\/$/, '');
    const anonymous = await fetch(`${endpoint}/${evidenceBucket()}/${key}`);
    expect([403, 404]).toContain(anonymous.status);

    const signedUrl = await presignDownload(key, 60, evidenceBucket());
    const signed = await fetch(signedUrl);
    expect(signed.status).toBe(200);
    expect(Buffer.from(await signed.arrayBuffer()).toString()).toBe(body.toString());
  });
});
