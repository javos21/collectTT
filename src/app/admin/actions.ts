'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { currentUser } from '@/lib/session';
import {
  removeMarketplaceOption,
  saveMarketplaceOption,
  setFullServiceDeliveryDays,
  type MarketplaceOptionKind,
} from '@/services/platform-settings';

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

function safeKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

async function requireAdmin(callbackURL = '/admin/settings') {
  const viewer = await currentUser();
  if (viewer === null) redirect(`/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`);
  const profile = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, viewer.userId)).limit(1);
  if (profile[0]?.role !== 'admin') redirect('/admin');
  return viewer;
}

export async function updateDeliveryDefaultsAction(formData: FormData): Promise<void> {
  const viewer = await requireAdmin();

  const days = Number(formData.get('fullServiceDeliveryDays') ?? NaN);
  if (!Number.isInteger(days) || days < 1 || days > 60) redirect('/admin/settings?settingsError=days');

  await setFullServiceDeliveryDays(days, viewer.userId);
  redirect('/admin/settings?settings=Delivery+setting+saved.');
}

export async function saveMarketplaceOptionAction(formData: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const id = text(formData, 'id');
  const kind = text(formData, 'kind') as MarketplaceOptionKind;
  const label = text(formData, 'label');
  const description = text(formData, 'description');
  const key = safeKey(text(formData, 'key') || label);
  const sortOrder = Number(text(formData, 'sortOrder') || 0);
  const requiresStore = formData.get('requiresStore') !== null;

  if ((kind !== 'delivery' && kind !== 'payment') || label === '' || key === '' || !Number.isInteger(sortOrder)) {
    redirect('/admin/settings?settingsError=Add+a+name+and+a+valid+display+order.');
  }

  try {
    await saveMarketplaceOption({
      ...(id !== '' ? { id } : {}),
      kind,
      key,
      label,
      description: description || null,
      requiresStore,
      sortOrder,
    }, viewer.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save this option.';
    redirect(`/admin/settings?settingsError=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/settings?settings=${encodeURIComponent(`${label} saved.`)}`);
}

export async function removeMarketplaceOptionAction(formData: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const id = text(formData, 'id');
  const label = text(formData, 'label') || 'Option';
  if (id === '') redirect('/admin/settings?settingsError=Option+not+found.');
  try {
    await removeMarketplaceOption(id, viewer.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not remove this option.';
    redirect(`/admin/settings?settingsError=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/settings?settings=${encodeURIComponent(`${label} removed.`)}`);
}
