# CollectTT v1 operations runbook

This runbook is the operational companion to Milestone 7. It describes the signals
that should be checked before and during the staged beta. It is intentionally short;
provider credentials and production values belong in the deployment environment, not
in the repository.

## Readiness and monitoring

- `GET /api/ready` is the lightweight readiness check. It verifies Postgres and reports
  the current count of failed notification deliveries without exposing member data.
- Render should use `/api/ready` for the web health check. A `503` means the database is
  unavailable and the instance should not receive traffic.
- Watch the worker logs for repeated Graphile Worker task failures, especially
  `notifications:dispatch`, `auction:close`, `listing:expire`, and transaction-window
  tasks. A failed notification delivery is visible in the admin Notifications page and
  can be retried only through the audited admin action.
- Alert when failed notification deliveries remain non-zero across two checks, when
  the worker stops reporting ready, or when the database connection pool is exhausted.

## Analytics contract

The `analytics_events` table is first-party and event-based. Every row has a stable
idempotency key, an event name, an optional account, a subject, and small structured
metadata. Do not add message bodies, phone numbers, payment instructions, or private
support evidence to metadata.

The admin Analytics page reports rolling 30-day counts for:

- listing created and listing published;
- reservation created and bid placed;
- transaction completed and transaction terminated; and
- support case created.

These counts are operational funnel signals. They are not a composite trust score and
should not be used to expose member-level rankings.

## Data retention baseline

The following is the v1 implementation baseline pending final legal approval:

| Data | Operational purpose | Baseline handling |
| --- | --- | --- |
| Phone disclosure access | Coordinate a committed transaction and investigate access | Retain the append-only admin access audit with the transaction/support context; do not copy phone numbers into analytics. |
| Transaction evidence | Review payment and hand-off disputes | Private storage only; retain while the transaction/report may be contested, then delete the object and keep only the audit outcome. |
| Support cases and reports | Safety, moderation, and dispute handling | Retain through resolution and the approved post-resolution period; reporter identity stays private from the reported member. |
| Notification deliveries | Delivery retry, incident response, and member history | Keep status, attempts, provider message ID, and error metadata; never use delivery payloads as an analytics source. |
| Admin audit events | Accountability for high-impact operations | Append-only; retain for the approved compliance and incident-review period. |

Before public launch, the product owner and legal reviewer must replace these baseline
descriptions with approved durations and confirm the deletion/backup treatment for each
class of data.

## Backup and restore drill

Before the invite-only beta:

1. Take a managed Postgres backup and record its timestamp and migration version.
2. Restore it into an isolated database with production credentials removed.
3. Run `npm run db:migrate` against the restored copy and verify the readiness endpoint.
4. Verify one representative listing, transaction, support case, notification retry,
   and analytics count without exposing the restored data publicly.
5. Record the restore duration, missing provider objects, and the owner for any follow-up.

Object storage must have a separate restore check for public listing images and private
transaction evidence. A public image URL must never be accepted as proof that private
evidence access is working.
