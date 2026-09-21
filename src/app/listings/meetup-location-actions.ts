'use server';

import { revalidatePath } from 'next/cache';

import { currentUser } from '@/lib/session';
import { saveSellerMeetupLocation } from '@/services/listings';

export type InlineMeetupLocation = {
  id: string;
  label: string;
  area: string;
};

export type CreateMeetupLocationResult =
  | { location: InlineMeetupLocation }
  | { error: string };

export async function createMeetupLocationAction(formData: FormData): Promise<CreateMeetupLocationResult> {
  const user = await currentUser();
  if (user === null) return { error: 'Sign in again before adding a meetup location.' };

  const label = String(formData.get('label') ?? '').trim();
  const area = String(formData.get('area') ?? '').trim();
  const instructions = String(formData.get('instructions') ?? '').trim();

  try {
    const id = await saveSellerMeetupLocation(user.userId, {
      label,
      area,
      instructions: instructions === '' ? null : instructions,
    });
    revalidatePath('/me');
    return { location: { id, label, area } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not add this meetup location.' };
  }
}
