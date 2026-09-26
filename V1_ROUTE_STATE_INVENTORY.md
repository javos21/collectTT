# CollectTT v1 route and state inventory

This is the v1 route-level quarantine map. `COLLECTTT_PRODUCT_SCOPE.md` is the product
authority. Legacy routes and data are retained for inspection or controlled rollback,
but they are not allowed to create new v1 activity. v1.5 work must not reactivate a
legacy route unless the product scope explicitly approves it.

## Public and member routes

| Route | v1 treatment | Required states | Owner / notes |
| --- | --- | --- | --- |
| `/` | Keep | loading, empty marketplace, active inventory, unavailable/error | Marketplace discovery and disclaimer surface. |
| `/listings` | Keep | query, filters, pagination, no results, stale result, error | Newest default; no recommendation feed. |
| `/listings/new` | Keep | signed out, phone-unverified, restricted, validation error, upload failure, draft/publish success | Only fixed-price/auction, cash meetup, cash/bank transfer. Server gate is authoritative. |
| `/listings/[id]` | Keep | active, reserved, sold, expired, sold outside, draft owner-only, unauthorized, bid/reservation unavailable | Public display name only; fixed-price offers are available when the seller opts in, while legacy custody controls remain hidden in v1. |
| `/listings/[id]/edit` | Keep | owner, locked after commitment/bid, invalid input, cancelled, legacy read-only refusal | v1 exposes the seller's offer opt-in and hides seller-authored payment-window controls. |
| `/deals` | Keep | no deals, action-needed, completed, expired/cancelled, disputed, authorization failure | Transaction inbox; direct-payment disclaimer. |
| `/deals/[id]` | Keep | buyer/seller party view, pre-commitment denial, open, milestone confirmation, disputed, completed, expired | Phone disclosure only after valid commitment and only to counterparties. |
| `/me` | Keep | signed out, account, listings, bids/offers, deals, restrictions, phone OTP states | Account name private; display name public. Fixed-price offer history remains visible alongside auction activity. |
| `/members/[id]` | Keep | public profile, no profile, private-field denial | Trust Snapshot has facts only; no handle/phone/ratings. |
| `/sign-in` | Keep | sign-in, sign-up, email verification pending/failed, validation, provider error | Collect private account name and separate public display name. |
| `/forgot-password` | Keep | request, unknown email, sent, rate limited, delivery failure | Email-only recovery. |
| `/reset-password` | Keep | valid token, expired token, used token, weak password, success | Token is single-use and server checked. |
| `/verify-email` | Keep | pending, verified, invalid/expired token, resend rate limit | Email is the sole contact-verification flow. |

## Legacy-quarantined routes

| Route | v1 treatment | Required states | Owner / notes |
| --- | --- | --- | --- |
| `/store` | Hide (`notFound`) in v1; preserve under `legacy` flag | legacy staff list, no staff, sign-in, authorization failure | Store application/custody is historical; old records remain admin-inspectable. |
| `/store/[storeId]` | Hide (`notFound`) in v1; preserve under `legacy` flag | receive, release, return, invalid code, expired session, unauthorized | Server actions also reject writes under the v1 flag. |
| `/store/apply` | Hide (`notFound`) in v1; preserve under `legacy` flag | form, pending, confirmed, declined, validation | No new store applications in v1. |

## Admin and API routes

| Route | v1 treatment | Required states | Owner / notes |
| --- | --- | --- | --- |
| `/admin` | Keep, admin-only | unauthorized, dashboard, empty queues, service failure | Admin is a launch dependency. |
| `/admin/members`, `/admin/members/[id]` | Keep, admin-only | search, no result, detail, suspend/restrict/reactivate, audit failure | Private phone access is audited; no impersonation. |
| `/admin/listings`, `/admin/listings/[id]` | Keep, admin-only | search, state history, remove/intervene, audit failure | Legacy listing fields may be inspected; new writes obey scope. |
| `/admin/deals`, `/admin/deals/[id]` | Keep, admin-only | timeline, evidence, dispute, deadline extension, cancel, audit failure | Counterparty disclosure and support actions are permission checked. |
| `/admin/audit/[id]` | Keep, admin-only | immutable timeline, missing target, authorization failure | Append-only audit history. |
| `/admin/notifications`, `/admin/notifications/[id]` | Keep, admin-only | queued, sent, failed, retry, dedupe | Transactional email is v1; retries must be idempotent. |
| `/admin/catalog` | Keep, admin-only | category/value CRUD, validation, audit failure | Category-specific fields remain data driven. |
| `/admin/settings` | Keep, admin-only | platform policy, marketplace options, invalid configuration | New listing service filters options to v1 terms. |
| `/admin/stores` | Keep only for historical inspection, admin-only | applications, legacy store records, delete refusal, audit failure | No public/store-staff entry point in v1. |
| `/api/auth/[...all]` | Keep | provider callback, invalid session, rate limit | Better Auth boundary. |
| `/api/auth/availability` | Keep | email available/taken, invalid input, rate limit | Do not expose private account-name enumeration. |
| `/api/auth/redirect-target` | Keep | safe local target, unsafe target rejected | Prevent open redirects. |
| `/api/images` and `/api/images/[id]` | Keep | signed upload, ownership denial, missing image, variant unavailable | Evidence/private images require authorization. |
| `/api/profile/display-name` | Keep | authenticated update, validation, conflict, unauthorized | Public identity update; private account name is not returned. |

## State-model checkpoints

- Listing lifecycle: `DRAFT → ACTIVE → RESERVED → SOLD`; timeout or external sale
  terminates the old record; relist/duplicate creates a new draft.
- Fixed-price reservation is an atomic, one-winner transition. A new buyer may
  have at most one active reservation.
- Auctions use server time, binding bids, repeated two-minute anti-sniping, and
  idempotent close/fallback jobs. Reserve prices, buyouts, proxy bids, and bid
  retraction are not v1 inputs.
- Transactions retain the current granular payment/custody implementation while
  exposing the v1-equivalent lifecycle, event timeline, deadlines, dispute pause,
  and direct-payment disclaimer.
- Phone numbers are private before commitment and disclosed only to the two
  transaction parties or an authorized, audited administrator afterward.
- `COLLECTTT_LAUNCH_SCOPE=v1` is the production default. `legacy` is a controlled
  rollback/test mode; it is not a second public product surface.
