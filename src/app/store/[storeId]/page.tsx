import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { requireStoreStaff, NotStoreStaffError } from '@/lib/store-session';
import { storeBoard, type StoreBoardRow } from '@/services/custody';
import {
  receiveByCodeAction,
  authorizeReleaseAction,
  markPickedUpAction,
  returnToSellerAction,
} from './actions';

export const dynamic = 'force-dynamic';

const SIZE_LABELS: Record<string, string> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
  oversized: 'oversized',
};

const SETTLED_LABELS: Record<string, string> = {
  picked_up: 'Collected by buyer',
  returned_to_seller: 'Returned to seller',
  voided: 'Never arrived — voided',
};

/** Every clock on this page comes from the database. Nothing here computes a deadline. */
function when(value: Date | null): string {
  return value === null ? '—' : value.toLocaleString('en-TT');
}

function heldFor(row: StoreBoardRow): string {
  if (row.daysHeld === null) return 'not yet dropped off';
  if (row.daysHeld === 0) return 'dropped off today';
  return row.daysHeld === 1 ? '1 day on the shelf' : `${row.daysHeld} days on the shelf`;
}

export default async function StoreBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ refuse?: string; error?: string; ok?: string }>;
}) {
  const { storeId } = await params;
  const flash = await searchParams;

  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in');

  let session;
  try {
    session = await requireStoreStaff(storeId);
  } catch (error) {
    if (error instanceof NotStoreStaffError) redirect('/store');
    throw error;
  }

  const rows = await storeBoard(db, storeId);

  const expected = rows.filter((r) => r.state === 'awaiting_dropoff');
  const onShelf = rows.filter((r) => r.state === 'at_relay');
  const ready = rows.filter((r) => r.state === 'release_authorized');
  const settled = rows.filter((r) =>
    ['picked_up', 'returned_to_seller', 'voided'].includes(r.state),
  );

  // Overstayed items are the store's actual pain. They go to the top of the shelf list.
  const shelf = [...onShelf].sort((a, b) => {
    const aFlag = a.overstayFlaggedAt === null ? 1 : 0;
    const bFlag = b.overstayFlaggedAt === null ? 1 : 0;
    return aFlag - bFlag;
  });

  return (
    <main>
      <h1>{session.store.name}</h1>
      <p className="muted">
        Signed in as {viewer.displayName} · {session.role} · {shelf.length} on the shelf,{' '}
        {ready.length} waiting to be collected, {expected.length} expected
      </p>

      {/* ------------------------------------------------ the counter */}
      <h2>At the counter</h2>
      <form action={receiveByCodeAction}>
        <input type="hidden" name="storeId" value={storeId} />
        <label htmlFor="code">Drop-off code</label>
        <input
          id="code"
          name="code"
          type="text"
          autoComplete="off"
          autoFocus
          placeholder="e.g. K4M9"
          required
        />
        <button type="submit">Receive item</button>
      </form>

      {flash.refuse !== undefined && (
        <p
          className="error"
          role="alert"
          style={{
            border: '2px solid var(--danger)',
            borderRadius: '6px',
            padding: '.75rem',
            fontSize: '1rem',
            fontWeight: 700,
          }}
        >
          {flash.refuse}
        </p>
      )}
      {flash.error !== undefined && <p className="error">{flash.error}</p>}
      {flash.ok !== undefined && <p className="ok">{flash.ok}</p>}

      <p className="muted">
        If it&apos;s not in the log, it doesn&apos;t belong here. Only accept an item whose
        code the system recognises.
      </p>

      {/* ------------------------------------------------ on the shelf */}
      <h2>On the shelf ({shelf.length})</h2>
      <p className="muted">
        Authorize release only after payment shows confirmed — the system will refuse
        otherwise.
      </p>

      {shelf.length === 0 ? (
        <p className="muted">Nothing on the shelf.</p>
      ) : (
        shelf.map((row) => (
          <div
            key={row.holdingId}
            className="card"
            style={
              row.overstayFlaggedAt !== null
                ? { borderColor: 'var(--danger)', borderWidth: '2px' }
                : undefined
            }
          >
            <strong>{row.listingTitle}</strong>{' '}
            <span className="pill">{SIZE_LABELS[row.sizeClass] ?? row.sizeClass}</span>{' '}
            <span className="pill">code {row.dropoffCode}</span>{' '}
            {row.paid ? (
              <span className="pill" style={{ color: 'var(--ok)' }}>
                paid
              </span>
            ) : (
              <span className="pill" style={{ color: 'var(--danger)' }}>
                unpaid
              </span>
            )}
            {row.overstayFlaggedAt !== null && (
              <span className="pill" style={{ color: 'var(--danger)' }}>
                overstayed
              </span>
            )}
            <p className="muted" style={{ marginBottom: '.25rem' }}>
              {heldFor(row)} · seller {row.sellerName} · buyer {row.buyerName ?? 'none right now'}{' '}
              · due out {when(row.custodyExpiresAt)}
            </p>

            {row.overstayFlaggedAt !== null && (
              <p className="error" style={{ marginTop: 0 }}>
                Past its collection window since {when(row.overstayFlaggedAt)}. Call the owner
                on <strong>{row.ownerContact}</strong> and tell them to collect it, then return
                it to the seller.
              </p>
            )}

            <div className="row">
              {row.paid ? (
                <form action={authorizeReleaseAction}>
                  <input type="hidden" name="storeId" value={storeId} />
                  <input type="hidden" name="holdingId" value={row.holdingId} />
                  <button type="submit">Authorize release</button>
                </form>
              ) : (
                <p className="muted">
                  Payment not confirmed — do not hand this over.
                </p>
              )}

              <form action={returnToSellerAction}>
                <input type="hidden" name="storeId" value={storeId} />
                <input type="hidden" name="holdingId" value={row.holdingId} />
                <input
                  type="text"
                  name="reason"
                  placeholder="Reason (optional)"
                  maxLength={200}
                  aria-label={`Reason for returning ${row.listingTitle} to the seller`}
                />
                <button className="secondary" type="submit">
                  Return to seller
                </button>
              </form>
            </div>
          </div>
        ))
      )}

      {/* ------------------------------------------------ ready for collection */}
      <h2>Ready for collection ({ready.length})</h2>
      <p className="muted">
        Released and waiting for the buyer. Check the code they show you before handing it
        over, then mark it picked up.
      </p>

      {ready.length === 0 ? (
        <p className="muted">Nothing waiting to be collected.</p>
      ) : (
        ready.map((row) => (
          <div key={row.holdingId} className="card">
            <strong>{row.listingTitle}</strong>{' '}
            <span className="pill">buyer must show code {row.dropoffCode}</span>
            <p className="muted" style={{ marginBottom: '.25rem' }}>
              buyer {row.buyerName ?? 'unknown'} · seller {row.sellerName} · {heldFor(row)} · due
              out {when(row.custodyExpiresAt)}
            </p>
            <div className="row">
              <form action={markPickedUpAction}>
                <input type="hidden" name="storeId" value={storeId} />
                <input type="hidden" name="holdingId" value={row.holdingId} />
                <button type="submit">Mark picked up</button>
              </form>
              <form action={returnToSellerAction}>
                <input type="hidden" name="storeId" value={storeId} />
                <input type="hidden" name="holdingId" value={row.holdingId} />
                <input
                  type="text"
                  name="reason"
                  placeholder="Reason (optional)"
                  maxLength={200}
                  aria-label={`Reason for returning ${row.listingTitle} to the seller`}
                />
                <button className="secondary" type="submit">
                  Return to seller
                </button>
              </form>
            </div>
          </div>
        ))
      )}

      {/* ------------------------------------------------ expected arrivals */}
      <h2>Expected arrivals ({expected.length})</h2>
      {expected.length === 0 ? (
        <p className="muted">Nothing expected.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Item</th>
              <th>Seller</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {expected.map((row) => (
              <tr key={row.holdingId}>
                <td>
                  <strong>{row.dropoffCode}</strong>
                </td>
                <td>{row.listingTitle}</td>
                <td>{row.sellerName}</td>
                <td>{SIZE_LABELS[row.sizeClass] ?? row.sizeClass}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ------------------------------------------------ audit tail */}
      <h2>Recently settled</h2>
      {settled.length === 0 ? (
        <p className="muted">Nothing settled yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Outcome</th>
              <th>Code</th>
              <th>Seller</th>
              <th>Buyer</th>
            </tr>
          </thead>
          <tbody>
            {settled.map((row) => (
              <tr key={row.holdingId}>
                <td>{row.listingTitle}</td>
                <td>{SETTLED_LABELS[row.state] ?? row.state.replace(/_/g, ' ')}</td>
                <td className="muted">{row.dropoffCode}</td>
                <td className="muted">{row.sellerName}</td>
                <td className="muted">{row.buyerName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
