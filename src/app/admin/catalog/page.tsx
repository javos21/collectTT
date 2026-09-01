import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { catalogValues } from '@/db/schema/catalog';
import { categories } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { CATEGORIES, CATEGORY_LIST } from '@/domain/categories/definitions';
import { currentUser } from '@/lib/session';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';
import { CatalogManager } from './catalog-manager';

export const dynamic = 'force-dynamic';

function defaultValues() {
  const values: { kind: 'game' | 'condition'; key: string; label: string; sortOrder: number; active: boolean }[] = [];
  for (const category of Object.values(CATEGORIES)) {
    for (const attribute of category.attributes) {
      if (attribute.type !== 'enum' || (attribute.key !== 'game' && attribute.key !== 'condition')) continue;
      const optionLabels = 'optionLabels' in attribute ? attribute.optionLabels as Readonly<Record<string, string>> : undefined;
      attribute.options.forEach((key, index) => values.push({ kind: attribute.key, key, label: optionLabels?.[key] ?? key, sortOrder: index * 10, active: true }));
    }
  }
  return values.filter((value, index, all) => all.findIndex((item) => item.kind === value.kind && item.key === value.key) === index);
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const viewer = await currentUser();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  const viewerProfile = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, viewer.userId)).limit(1);
  if (viewerProfile[0]?.role !== 'admin') return <AdminDenied signedIn />;

  const [categoryRows, valueRows, params] = await Promise.all([
    db.select({ key: categories.key, label: categories.label, sortOrder: categories.sortOrder, active: categories.active }).from(categories).orderBy(asc(categories.sortOrder)),
    db.select({ id: catalogValues.id, kind: catalogValues.kind, key: catalogValues.key, label: catalogValues.label, sortOrder: catalogValues.sortOrder, active: catalogValues.active }).from(catalogValues).orderBy(asc(catalogValues.sortOrder)),
    searchParams,
  ]);

  const storedCategories = new Map(categoryRows.map((category) => [category.key, category]));
  const mergedCategories = CATEGORY_LIST.map((category) => storedCategories.get(category.key) ?? ({ key: category.key, label: category.label, sortOrder: category.sortOrder, active: true }));
  for (const category of categoryRows) if (!mergedCategories.some((item) => item.key === category.key)) mergedCategories.push(category);
  const storedByKey = new Map(valueRows.map((value) => [`${value.kind}:${value.key}`, value]));
  const mergedValues = defaultValues().map((value) => storedByKey.get(`${value.kind}:${value.key}`) ?? value);
  for (const value of valueRows) if (!mergedValues.some((item) => item.kind === value.kind && item.key === value.key)) mergedValues.push(value);

  return <AdminFrame viewer={viewer} activeNav="catalog"><main className="admin-main"><div className="admin-heading"><div><p className="admin-kicker">Marketplace structure</p><h1>Catalog</h1><p>Manage the vocabulary sellers use to describe what they collect.</p></div><span className="admin-environment">Admin only</span></div><CatalogManager categories={mergedCategories} values={mergedValues} notice={params.notice} /></main></AdminFrame>;
}

