/**
 * TLS decision for Postgres connections, shared by the application pool and the
 * migration entry points.
 *
 * SSL is decided by the HOST, not by NODE_ENV.
 *
 * `next start` and `npm run build` both set NODE_ENV=production, so keying off the
 * environment makes a local production build try to negotiate TLS against the docker
 * container — which has none — and every query fails with "server does not support SSL".
 * Render Postgres is remote and wants TLS; a local container never does.
 */
export function sslConfig(
  url: string,
): { ssl: { rejectUnauthorized: boolean } } | Record<string, never> {
  if (/sslmode=disable/.test(url)) return {};
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  return isLocal ? {} : { ssl: { rejectUnauthorized: false } };
}
