/** Hide the internal uniqueness suffix from handles shown on public surfaces. */
export function publicHandle(handle: string): string {
  return handle.replace(/_[A-Za-z0-9]{6}$/, '');
}
