/**
 * Store staff are members who appear in `relay_store_staff` — no separate credential.
 *
 * ★ THIS IS NOT THE SECURITY BOUNDARY. `assertStoreAuthority` in services/custody.ts
 *   re-checks membership against each holding's OWN store on every write. This decides
 *   what a clerk can SEE; a bug in a page cannot release someone else's item.
 */

import { db } from '../db/client';
import { storesForStaff } from '../services/custody';
import { requireUser, type CurrentUser } from './session';

export class NotStoreStaffError extends Error {}

export interface StoreSession {
  user: CurrentUser;
  store: { id: string; name: string };
  role: string;
}

export async function staffStores(): Promise<{
  user: CurrentUser;
  stores: Array<{ id: string; name: string; role: string }>;
}> {
  const user = await requireUser();
  return { user, stores: await storesForStaff(db, user.userId) };
}

export async function requireStoreStaff(storeId: string): Promise<StoreSession> {
  const { user, stores } = await staffStores();
  const match = stores.find((s) => s.id === storeId);
  if (match === undefined) throw new NotStoreStaffError('You do not work at this store');
  return { user, store: { id: match.id, name: match.name }, role: match.role };
}
