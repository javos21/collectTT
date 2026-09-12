'use client';

import { useFormStatus } from 'react-dom';

import {
  addMemberRestrictionAction,
  liftMemberRestrictionAction,
  reactivateMemberAction,
  suspendMemberAction,
} from '@/app/admin/actions';

const RESTRICTIONS = [
  ['prepay_required', 'Prepay required'],
  ['meetup_only', 'Meetup only'],
  ['claim_blocked', 'Claim blocked'],
  ['bid_blocked', 'Bid blocked'],
  ['listing_cap', 'Listing cap'],
] as const;

function SubmitButton({ label, pendingLabel, danger = false }: { label: string; pendingLabel: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={`admin-button${danger ? ' admin-button--danger' : ''}`} type="submit" disabled={pending}>{pending ? pendingLabel : label}</button>;
}

export function MemberAdminActions({ memberId, status, role }: { memberId: string; status: string; role: string }) {
  const canSuspend = role !== 'admin' && (status === 'active' || status === 'restricted');
  const canReactivate = status === 'suspended';

  return (
    <div className="admin-action-grid">
      <article className="admin-action-card">
        <div className="admin-action-card__heading"><div><h3>Account status</h3><p>Record a guided suspension or reactivation decision for support and policy review.</p></div><span className="admin-status admin-status--pending">{status.replaceAll('_', ' ')}</span></div>
        {canSuspend && (
          <form action={suspendMemberAction} onSubmit={(event) => { if (!window.confirm('Suspend this member? This will block their account activity.')) event.preventDefault(); }}>
            <input type="hidden" name="memberId" value={memberId} />
            <label htmlFor="suspend-reason">Suspension reason</label>
            <textarea id="suspend-reason" name="reason" required minLength={10} maxLength={500} rows={3} aria-describedby="suspend-reason-help" />
            <p id="suspend-reason-help" className="admin-form-help">Required for the audit log. State the policy or support reason clearly.</p>
            <SubmitButton label="Suspend member" pendingLabel="Suspending…" danger />
          </form>
        )}
        {canReactivate && (
          <form action={reactivateMemberAction} onSubmit={(event) => { if (!window.confirm('Reactivate this member?')) event.preventDefault(); }}>
            <input type="hidden" name="memberId" value={memberId} />
            <label htmlFor="reactivate-reason">Reactivation reason</label>
            <textarea id="reactivate-reason" name="reason" required minLength={10} maxLength={500} rows={3} aria-describedby="reactivate-reason-help" />
            <p id="reactivate-reason-help" className="admin-form-help">Required for the audit log. Explain why the suspension is being removed.</p>
            <SubmitButton label="Reactivate member" pendingLabel="Reactivating…" />
          </form>
        )}
        {!canSuspend && !canReactivate && <p className="admin-action-note">This account status is not eligible for a guided status change here. Administrator and banned accounts require a separate access-review process.</p>}
      </article>

      <article className="admin-action-card">
        <div className="admin-action-card__heading"><div><h3>Add restriction</h3><p>Create one admin-sourced restriction. Automatic reputation restrictions remain system-controlled.</p></div></div>
        <form action={addMemberRestrictionAction}>
          <input type="hidden" name="memberId" value={memberId} />
          <label htmlFor="restriction-type">Restriction type</label>
          <select id="restriction-type" name="type" defaultValue="" required>
            <option value="" disabled>Select a restriction</option>
            {RESTRICTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label htmlFor="restriction-reason">Reason</label>
          <textarea id="restriction-reason" name="reason" required minLength={10} maxLength={500} rows={3} aria-describedby="restriction-reason-help" />
          <p id="restriction-reason-help" className="admin-form-help">Required for the audit log. A duplicate active admin restriction will be rejected safely.</p>
          <label htmlFor="restriction-expires">Expires after</label>
          <input id="restriction-expires" name="expiresAt" type="date" />
          <SubmitButton label="Add restriction" pendingLabel="Adding restriction…" />
        </form>
      </article>
    </div>
  );
}

export function LiftRestrictionForm({ memberId, restrictionId }: { memberId: string; restrictionId: string }) {
  const reasonId = `lift-reason-${restrictionId}`;
  return (
    <form className="admin-inline-action" action={liftMemberRestrictionAction} onSubmit={(event) => { if (!window.confirm('Lift this admin restriction?')) event.preventDefault(); }}>
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="restrictionId" value={restrictionId} />
      <label htmlFor={reasonId}>Lift reason</label>
      <input id={reasonId} name="reason" type="text" required minLength={10} maxLength={500} />
      <SubmitButton label="Lift" pendingLabel="Lifting…" />
    </form>
  );
}
