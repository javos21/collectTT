/**
 * Phase 0 end-to-end verification.
 *
 * Exercises the two things unit tests cannot: the image pipeline crossing a process
 * boundary (web -> storage -> worker), and the transactional enqueue guarantee.
 *
 * Requires all three processes running:
 *   docker compose up -d
 *   npm run dev          (or npm run start)
 *   npm run dev:worker   (or npm run start:worker)
 *
 * Run with: npm run verify
 */

import '../src/lib/load-env';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';

import { db, pool } from '../src/db/client';
import { images } from '../src/db/schema/images';
import { profiles } from '../src/db/schema/profiles';
import { createUploadTicket, confirmUpload } from '../src/services/images';
import { getObject } from '../src/lib/storage';

async function main(): Promise<void> {
  // Any existing member will do as the image owner.
  const owners = await db.select({ id: profiles.userId }).from(profiles).limit(1);
  const owner = owners[0]?.id;
  if (owner === undefined) {
    throw new Error('No profiles found. Run `npm run seed:dev` first.');
  }

  console.log('1. requesting a presigned upload…');
  const ticket = await createUploadTicket(owner, 'image/png');
  console.log(`   image ${ticket.imageId}`);

  console.log('2. uploading straight to storage (the web process never sees the bytes)…');
  const png = await sharp({
    create: { width: 1200, height: 1600, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();

  const res = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(png),
    headers: { 'content-type': 'image/png' },
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  console.log(`   ${png.byteLength} bytes -> HTTP ${res.status}`);

  console.log('3. confirming — enqueues image:process in the SAME transaction…');
  await confirmUpload(ticket.imageId, owner);

  console.log('4. waiting for the worker…');
  let row: typeof images.$inferSelect | undefined;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const rows = await db.select().from(images).where(eq(images.id, ticket.imageId)).limit(1);
    row = rows[0];
    if (row?.status === 'ready' || row?.status === 'failed') break;
  }

  if (row === undefined) throw new Error('image row vanished');
  if (row.status !== 'ready') {
    throw new Error(`expected status "ready", got "${row.status}" — is the worker running?`);
  }
  console.log(`   status ${row.status}, source ${row.width}x${row.height}`);

  console.log('5. verifying every variant exists in storage…');
  const variants = row.variants as Record<string, { key: string; w: number; h: number }>;
  const names = Object.keys(variants);
  if (names.length !== 3) throw new Error(`expected 3 variants, got ${names.length}`);

  for (const [name, v] of Object.entries(variants)) {
    const bytes = await getObject(v.key);
    if (bytes.byteLength === 0) throw new Error(`variant ${name} is empty`);
    console.log(
      `   ${name.padEnd(6)} ${String(v.w).padStart(4)}x${String(v.h).padStart(4)}  ` +
        `${String(bytes.byteLength).padStart(7)} bytes`,
    );
  }

  console.log('6. idempotency — confirming again must not re-queue…');
  await confirmUpload(ticket.imageId, owner);
  // Jobs are keyed `image:<id>`, so a duplicate enqueue would either collapse onto the
  // same key or show up here. Neither should happen: the image is no longer 'pending'.
  const requeued = await pool.query<{ n: number }>(
    `select count(*)::int as n from graphile_worker.jobs where key = $1`,
    [`image:${ticket.imageId}`],
  );
  const n = requeued.rows[0]?.n ?? 0;
  if (n !== 0) throw new Error(`expected 0 queued jobs after re-confirm, got ${n}`);
  console.log('   0 jobs re-queued');

  console.log('\nPASS — Phase 0 pipeline verified end to end.');
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('\nFAIL', error);
  await pool.end();
  process.exit(1);
});
