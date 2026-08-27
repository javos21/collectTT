const DEFAULT_AUTH_DESTINATION = '/';

/** Keep post-auth navigation on this site, even when the query string is user-controlled. */
export function safeAuthReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== 'string') return DEFAULT_AUTH_DESTINATION;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }

  // Backslashes are treated as path separators by some URL parsers. Reject them
  // before a client-side navigation can normalize a seemingly-local value into an
  // external URL.
  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || decoded.startsWith('//')
    || decoded.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(decoded)
  ) {
    return DEFAULT_AUTH_DESTINATION;
  }

  return value;
}
