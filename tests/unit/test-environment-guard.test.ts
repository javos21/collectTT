import { describe, expect, it } from 'vitest';
import { assertSafeTestEnvironment } from '../helpers/assert-safe-test-environment';

describe('test environment guard', () => {
  it('allows a local database', () => {
    expect(() =>
      assertSafeTestEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/collecttt',
      }),
    ).not.toThrow();
  });

  it('allows a dedicated remote test database', () => {
    expect(() =>
      assertSafeTestEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:password@example.com/collecttt_test',
      }),
    ).not.toThrow();
  });

  it('rejects production mode even when the database is local', () => {
    expect(() =>
      assertSafeTestEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/collecttt',
      }),
    ).toThrow(/NODE_ENV=production/);
  });

  it('rejects a remote database that is not explicitly test-only', () => {
    expect(() =>
      assertSafeTestEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:password@production.example.com/postgres',
      }),
    ).toThrow(/non-local database/);
  });
});
