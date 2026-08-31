import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/client';
import { relayStoreStaff, relayStores } from '../db/schema/custody';
import { users } from '../db/schema/auth';
import { profiles } from '../db/schema/profiles';
import { storeApplications } from '../db/schema/store-applications';
import type { SizeClass } from '../domain/states/listing';

export type StoreApplicationInput = {
  storeName: string;
  addressLine1: string;
  addressLine2?: string;
  area: string;
  city: string;
  country: string;
  phoneE164: string;
  websiteUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  acceptsSizeClasses: SizeClass[];
  termsVersion: string;
};

export async function latestStoreApplicationFor(applicantId: string) {
  const rows = await db
    .select()
    .from(storeApplications)
    .where(eq(storeApplications.applicantId, applicantId))
    .orderBy(desc(storeApplications.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function createStoreApplication(applicantId: string, input: StoreApplicationInput) {
  const existing = await db
    .select({ id: storeApplications.id, status: storeApplications.status })
    .from(storeApplications)
    .where(
      and(
        eq(storeApplications.applicantId, applicantId),
        // The partial unique index is the final guard; this makes the form response clearer.
        eq(storeApplications.status, 'pending'),
      ),
    )
    .limit(1);
  if (existing[0] !== undefined) throw new Error('A Store application is already under review.');

  const rows = await db
    .insert(storeApplications)
    .values({
      applicantId,
      storeName: input.storeName,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 || null,
      area: input.area,
      city: input.city,
      country: input.country,
      phoneE164: input.phoneE164,
      websiteUrl: input.websiteUrl || null,
      instagramUrl: input.instagramUrl || null,
      facebookUrl: input.facebookUrl || null,
      tiktokUrl: input.tiktokUrl || null,
      acceptsSizeClasses: input.acceptsSizeClasses,
      termsVersion: input.termsVersion,
      termsAcceptedAt: new Date(),
    })
    .returning();
  return rows[0];
}

export async function confirmStoreApplication(applicationId: string, adminUserId: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(storeApplications)
      .where(eq(storeApplications.id, applicationId))
      .limit(1);
    const application = rows[0];
    if (application === undefined) throw new Error('Store application not found.');
    if (application.status === 'confirmed' && application.storeId !== null) return application.storeId;
    if (application.status !== 'pending') throw new Error('Only pending Store applications can be confirmed.');

    const stores = await tx
      .insert(relayStores)
      .values({
        name: application.storeName,
        area: application.area,
        address: [application.addressLine1, application.addressLine2, application.city, application.country]
          .filter(Boolean)
          .join(', '),
        phoneE164: application.phoneE164,
        acceptsSizeClasses: application.acceptsSizeClasses,
        active: true,
      })
      .returning({ id: relayStores.id });
    const store = stores[0];
    if (store === undefined) throw new Error('Store could not be created.');

    await tx.insert(relayStoreStaff).values({
      storeId: store.id,
      userId: application.applicantId,
      role: 'manager',
    });

    await tx
      .update(storeApplications)
      .set({
        status: 'confirmed',
        storeId: store.id,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(storeApplications.id, applicationId));

    return store.id;
  });
}

export async function declineStoreApplication(applicationId: string, adminUserId: string, adminNote?: string) {
  const rows = await db
    .update(storeApplications)
    .set({
      status: 'declined',
      adminNote: adminNote?.trim() || null,
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(storeApplications.id, applicationId), eq(storeApplications.status, 'pending')))
    .returning({ id: storeApplications.id });
  if (rows[0] === undefined) throw new Error('Only pending Store applications can be declined.');
}

export async function listStoreApplications() {
  return db
    .select({
      id: storeApplications.id,
      storeName: storeApplications.storeName,
      addressLine1: storeApplications.addressLine1,
      addressLine2: storeApplications.addressLine2,
      area: storeApplications.area,
      city: storeApplications.city,
      country: storeApplications.country,
      phoneE164: storeApplications.phoneE164,
      websiteUrl: storeApplications.websiteUrl,
      instagramUrl: storeApplications.instagramUrl,
      facebookUrl: storeApplications.facebookUrl,
      tiktokUrl: storeApplications.tiktokUrl,
      acceptsSizeClasses: storeApplications.acceptsSizeClasses,
      termsVersion: storeApplications.termsVersion,
      termsAcceptedAt: storeApplications.termsAcceptedAt,
      status: storeApplications.status,
      adminNote: storeApplications.adminNote,
      reviewedAt: storeApplications.reviewedAt,
      storeId: storeApplications.storeId,
      createdAt: storeApplications.createdAt,
      applicantName: profiles.displayName,
      applicantEmail: users.email,
    })
    .from(storeApplications)
    .innerJoin(profiles, eq(profiles.userId, storeApplications.applicantId))
    .innerJoin(users, eq(users.id, storeApplications.applicantId))
    .orderBy(desc(storeApplications.createdAt));
}
