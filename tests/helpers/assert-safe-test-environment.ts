const LOCAL_DATABASE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'db',
  'postgres',
]);

export function assertSafeTestEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run tests with NODE_ENV=production. Configure a local or dedicated test environment first.',
    );
  }

  const rawDatabaseUrl = env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error('Refusing to run tests without DATABASE_URL.');
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error('Refusing to run tests with an invalid DATABASE_URL.');
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  const isLocal = LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname);
  const isExplicitTestDatabase = /(^|[-_])test($|[-_])/i.test(databaseName);
  const isConfirmedStagingDatabase =
    env.CONFIRM_STAGING_TESTS === 'test-staging'
    && typeof env.STAGING_DATABASE_URL === 'string'
    && env.STAGING_DATABASE_URL !== ''
    && rawDatabaseUrl === env.STAGING_DATABASE_URL;

  if (!isLocal && !isExplicitTestDatabase && !isConfirmedStagingDatabase) {
    throw new Error(
      `Refusing to run tests against non-local database "${databaseUrl.hostname}/${databaseName}". ` +
        'Use a local database, a dedicated database whose name includes "test", or explicitly confirm the configured staging database.',
    );
  }
}
