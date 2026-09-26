# Wam payment provider integration research

**Status:** Research only — non-normative and not approved v1.5 scope

Reviewed 2026-09-22 against Wam's first-party documentation. This is an
implementation brief, not an assertion that Wam's commercial agreement permits
CollectTT's marketplace use case.

## Recommendation

Wam is technically a good fit for this Next.js/Node application: the supported
Node SDK creates a hosted checkout, Wam handles the payment UI, and a signed
webhook confirms the result. Install `@wamnow/payment-sdk`, create intents only
on the server, redirect the buyer to `checkoutUrl`, and make the webhook—not the
browser return URL—the authority for payment state. Wam's hosted checkout can
offer Wam wallet, card, or QR payment. [Payment integration overview](https://docs.wam.money/docs/payment-sdk)

Do **not** yet use CollectTT's own Wam Business credentials to collect the price
of marketplace items. The public documentation describes payments landing in
the credential-owning business's Wam balance and later being paid out to that
business's bank account. It does not document connected seller accounts,
per-seller destination routing, split payments, marketplace onboarding, or
automatic seller payouts. [Accepting payments](https://docs.wam.money/docs/business/payments)
[Fees and payouts](https://docs.wam.money/docs/business/fees)

That matters because CollectTT currently says the platform does not process or
hold ordinary transaction funds (`COLLECTTT_PRODUCT_SCOPE.md`, `PRODUCT.md`, and
the Terms of Service), while its payment state is only a record of money moving
directly between buyer and seller. A CollectTT-owned Wam checkout appears, from
the published docs, to make CollectTT the receiving merchant. Confirm the
merchant-of-record, custody, settlement, seller-payout, refund, chargeback, KYC,
and regulatory model with Wam before building this path.

The safe rollout choices are therefore:

1. **CollectTT-owned charges only.** Use Wam for fees or services sold by
   CollectTT itself. This matches the documented single-business model.
2. **Marketplace purchase payments only after Wam approval.** Proceed when Wam
   confirms in writing how each seller is onboarded and receives their funds
   without an undocumented manual settlement layer.
3. **Direct seller Wam payments without SDK checkout.** Keep Wam as a
   seller-selected, external payment option (for example, a seller-provided
   payment request) and retain the present buyer/seller milestone flow. This is
   not the SDK integration documented on the Payment Integration pages.

For Featured Listings, Wam may be evaluated only for charges sold by CollectTT and only
after the v1.5 purchase, refund, failure, disclosure, and administration rules are
approved in `COLLECTTT_PRODUCT_SCOPE.md`.

## Documented payment flow

1. The server creates a payment intent with a positive integer `amountCents`,
   an ISO 4217 `currency`, and a unique `orderReference`. Optional fields include
   `description`, `returnUrl`, `metadata`, `idempotencyKey`, `taxAmountCents`,
   and up to 100 `lineItems`. The response includes `paymentId`, `invoiceId`,
   `status`, `checkoutUrl`, amount/currency, selected payment method, and
   timestamps. [Payment intents](https://docs.wam.money/docs/payment-sdk/payment-intents)
2. The client navigates to Wam's hosted `checkoutUrl`; no Wam API credential is
   exposed to the browser. [Node/Next.js quickstart](https://docs.wam.money/docs/payment-sdk/quickstart)
3. Wam redirects the customer to `returnUrl` with `result`, `amount`,
   `identifier`, `reference`, and `signature`. This redirect is UX-only: it can
   be revisited or tampered with and must not fulfill the order. The return page
   may ask the CollectTT backend for current status. [Payment-intent return behavior](https://docs.wam.money/docs/payment-sdk/payment-intents#return-url-behavior)
4. Wam sends signed webhook events as the intent moves through `created`,
   `requires_payment_method`, `processing`, and a terminal `succeeded`, `failed`,
   `canceled`, or `expired` state. Wam recommends webhooks over polling;
   `getPaymentIntentStatus(paymentId)` is suitable as a fallback or for refreshing
   the return page. [Payment-intent lifecycle](https://docs.wam.money/docs/payment-sdk/payment-intents#status-lifecycle)

Intent creation is idempotent by default using a key derived from
`SHA256(orderReference|amountCents|currency)`. Repeating the same tuple returns
the existing intent; reusing the order reference with a different amount or
currency returns `409 DUPLICATE_ORDER_REFERENCE`. A caller can supply its own
`idempotencyKey`. [Payment-intent idempotency](https://docs.wam.money/docs/payment-sdk/payment-intents#idempotency)

For CollectTT, use a stable reference such as `collecttt:<transaction UUID>`,
not a timestamp or browser-generated value. Derive amount and currency from the
locked transaction row on the server; never accept either as authoritative
client input.

## Credentials and SDK setup

Create a Wam Business account and obtain the following from **Developers →
Merchant Keys** in the correct Business Portal:

| Secret/configuration | Use |
| --- | --- |
| Business ID | UUID identifying the Wam business; staging and production IDs differ. |
| API key | Authorizes intent/status/refund API calls and is also the HMAC key for raw REST requests. |
| Webhook secret | Separate `whsec_...` secret used only to verify webhook deliveries. |
| Environment | `staging` or `production`; it must match the portal that issued the credentials. |

Wam documents `https://staging.app.wam.money` and
`https://app.wam.money` as the staging and production portals. Staging and
production have separate businesses, credentials, data, webhook endpoints, and
checkout hosts. Keys are shown once, should stay in a secrets manager, and must
never enter client-side bundles or version control. Create a replacement key,
deploy it, then revoke the old key when rotating. [API keys and setup](https://docs.wam.money/docs/payment-sdk/api-keys)
[Sandbox keys](https://docs.wam.money/docs/payment-sdk/testing/sandbox-keys)

Suggested server-only configuration:

```ts
import { WamPaymentSDK } from '@wamnow/payment-sdk';

export const wam = new WamPaymentSDK({
  businessId: process.env.WAM_BUSINESS_ID!,
  apiKey: process.env.WAM_API_KEY!,
  webhookSecret: [
    process.env.WAM_WEBHOOK_SECRET,
    process.env.WAM_WEBHOOK_SECRET_PREVIOUS,
  ].filter(Boolean) as string[],
  environment: process.env.WAM_ENVIRONMENT === 'production'
    ? 'production'
    : 'staging',
});
```

The SDK defaults to production, a 20-second request timeout, and two retries for
network/5xx failures. Set the environment explicitly so a missing variable
cannot accidentally select production. The SDK also exposes request/response/
error hooks suitable for structured logs, but credentials and raw sensitive
payloads should not be logged. [SDK configuration](https://docs.wam.money/docs/payment-sdk/api-keys#step-5-initialize-the-sdk)
[Error and retry reference](https://docs.wam.money/docs/payment-sdk/error-reference)

If the SDK cannot be used, the REST base URLs are
`https://staging.billing.wam.money` and `https://billing.wam.money`.
Requests carry `X-WAM-Api-Key`, `X-WAM-Timestamp`, and `X-WAM-Signature`; the
signature is lowercase hex HMAC-SHA256, keyed by the API key, over
`{timestamp}.{exact_json_body}` (or `{timestamp}.` for GET). Wam allows ±300
seconds of clock skew. [REST authentication](https://docs.wam.money/docs/payment-sdk/rest-api#authentication)

## Proposed CollectTT shape

Keep Wam's lifecycle separate from `transactions.payment_state`. Wam has more
states and supports retries/possibly multiple attempts, while CollectTT's
payment track has only `pending`, historical `buyer_marked_paid`, `confirmed`,
and `failed` terminal states.

### Persistence

Add a provider-payment attempt record rather than putting every provider field
on `transactions`. At minimum retain:

- internal ID and `transaction_id`;
- provider (`wam`) and environment;
- stable `order_reference` (unique per environment/business);
- `payment_id` and `invoice_id` (provider-unique);
- locked `amount_cents` and `currency`;
- provider status, checkout URL, expiry, completion, and update timestamps;
- selected payment method/provider transaction ID when returned; and
- failure code/message and Wam `requestId` for support correlation.

Add a webhook-delivery table keyed uniquely by Wam event `id`, with received and
processed timestamps, event type, linked payment/transaction, and processing
outcome. Do not place credentials, full webhook bodies, or unnecessary personal
data in transaction metadata or logs.

### Server endpoints

- `POST /api/transactions/[id]/payments/wam`: authenticate the buyer, lock/load
  the open transaction, verify Wam is allowed, create or reuse the local attempt,
  call `createPaymentIntent`, persist provider identifiers, and return only the
  checkout URL.
- `POST /api/webhooks/wam`: read `request.text()` exactly once, verify signature
  and timestamp, deduplicate the event ID, persist/queue it, and respond quickly.
- `GET /api/transactions/[id]/payments/wam/status`: authorize a transaction
  participant, return local provider/payment state, and optionally reconcile
  nonterminal state from Wam server-to-server.
- A return page under the transaction/deal UI: display a waiting/success/failure
  state by calling the status endpoint. It must not mutate the transaction based
  on query parameters.

### State mapping

| Wam state/event | Provider-attempt action | CollectTT action |
| --- | --- | --- |
| `created`, `requires_payment_method`, `processing` | Persist current status | Leave payment `pending` |
| `payment_intent.succeeded` | Mark attempt succeeded | In one DB transaction, move payment `pending → confirmed` as `system`, write `transaction_events`, and invoke the existing post-payment completion/custody logic |
| `failed`, `canceled`, `expired` | Mark that attempt terminal | Mark the CollectTT payment failed only when policy says no retry is allowed and no other attempt has succeeded; otherwise allow a new intent |
| `refund.succeeded` / `refund.failed` | Record a separate refund lifecycle | Do not force it into the current irreversible `confirmed` payment state; define refund/cancellation policy first |

This will require a new system-authorized `pending → confirmed` transition. The
existing `markPaid` path lets the buyer self-confirm payment, which is not an
authoritative Wam integration and should not be used by the webhook.

## Webhook requirements

Register a public HTTPS endpoint in **Developers → Merchant Keys → Webhooks** in
both Test and Live modes. Subscribe at least to `payment_intent.succeeded`,
`payment_intent.failed`, `payment_intent.canceled`, and
`payment_intent.expired`; refund events are also documented. [Webhook setup and event types](https://docs.wam.money/docs/payment-sdk/webhooks)

Verify before parsing or acting:

```ts
const rawBody = await request.text();
const event = WamPaymentSDK.verifyWebhookSignature({
  payload: rawBody,
  signature: request.headers.get('x-wam-signature') ?? '',
  timestamp: request.headers.get('x-wam-timestamp') ?? '',
  secret: process.env.WAM_WEBHOOK_SECRET!,
});
```

The signature is HMAC-SHA256 over `{timestamp}.{rawBody}` with a default
five-minute freshness tolerance. Parsing and re-stringifying before validation
can change the bytes and invalidate the signature. Use the SDK helper or a
timing-safe comparison. [Webhook signature verification](https://docs.wam.money/docs/payment-sdk/webhooks#signature-verification)

Wam may deliver an event more than once, so deduplicate by envelope `id` and
make the transaction update idempotent. Acknowledge unknown event types with
`200`; respond within 10 seconds and do heavier work asynchronously. Wam retries
unreachable, timed-out, or 5xx deliveries immediately, then after 1 minute, 5
minutes, 30 minutes, and 2 hours. It does not retry 4xx responses; after five
failed attempts a delivery must be retried manually in the portal. [Webhook handling and retry policy](https://docs.wam.money/docs/payment-sdk/webhooks#retry-policy)

Webhook secret rotation has a documented 48-hour overlap. Wam signs with the
new secret immediately, while the SDK can accept both old and new secrets during
the deployment window. [Webhook secret rotation](https://docs.wam.money/docs/payment-sdk/webhooks#rotating-the-signing-secret)

## Testing and release gates

Test mode is the entirely separate staging environment, not a flag on a payment
record. Pair a staging Business ID and staging key with `environment: "staging"`;
no real funds settle, and staged card payments use Cybersource sandbox.
[Test mode overview](https://docs.wam.money/docs/payment-sdk/testing/overview)

The package exports `MockWamPaymentSDK` from `@wamnow/payment-sdk/testing` for
in-memory unit tests. It covers intent creation/status and can build
`payment_intent.*` webhook payloads, but it does not implement webhook
verification, so signature checks need their own test fixtures.
[Mock SDK](https://docs.wam.money/docs/payment-sdk/testing/mock-sdk)

Before production, verify:

- successful checkout → verified webhook → one atomic payment confirmation;
- same transaction/amount/currency returns the same intent;
- duplicate and out-of-order webhook delivery is harmless;
- tampered body, bad signature, and stale timestamp return 401 without mutation;
- failed/canceled/expired attempts do not overwrite a later success;
- return-page query tampering cannot confirm payment;
- the handler responds within 10 seconds and queued processing is retried;
- Wam/network 5xx errors reuse the same idempotency identity;
- secret rotation accepts old and new secrets for the overlap; and
- staging data/credentials cannot be used in production.

Wam documents a Visa approval test PAN (`4111 1111 1111 1111`) and a Mastercard
approval test PAN (`5555 5555 5555 4444`), but says its decline/AVS/CVV/3DS card
deck is not yet verified; simulate those outcomes with the mock SDK or webhook
test sends until Wam supplies confirmed scenarios. [Test cards](https://docs.wam.money/docs/payment-sdk/testing/test-cards)

## Supported surface and operations

- The currently available official SDK is JavaScript/Node.js. Python and PHP SDK
  pages are marked coming soon; any server language can use the REST API.
  [Integration choices](https://docs.wam.money/docs/payment-sdk#choose-your-integration)
- The API accepts a three-letter ISO 4217 code and explicitly illustrates TTD and
  USD, but the docs do not publish a definitive merchant-enabled currency list.
  Confirm enabled currencies with Wam before promising anything beyond TTD.
  [REST create-intent fields](https://docs.wam.money/docs/payment-sdk/rest-api#create-payment-intent)
- The REST index lists intent creation/status, refunds, transaction reporting,
  and webhook test send. It does not establish recurring billing as a supported
  public integration, so do not promise subscriptions or saved cards from these
  docs. [REST endpoint index](https://docs.wam.money/docs/payment-sdk/rest-api#endpoint-index)
- Wam publishes wallet pricing and says card pricing is shown in the merchant
  dashboard; the merchant can absorb, pass on, or split fees by rail. Confirm
  the actual commercial rate and how that choice affects the locked CollectTT
  transaction amount. [Fees and pricing](https://docs.wam.money/docs/business/fees)
- Wam also publishes a `/wam-pay` scaffolding skill, but it is explicitly a
  **Claude Code-only** slash command and is not available in Codex, Cursor, VS
  Code, or other editors. It is optional developer tooling, not part of the
  runtime payment integration; this research should be used directly in Codex.
  [Wam Pay Skill](https://docs.wam.money/docs/payment-sdk/wam-pay-skill)

## Questions to resolve with Wam before implementation

1. Does Wam support a marketplace/connected-account model where each CollectTT
   seller is the payee, and what seller onboarding/KYC is required?
2. Who is merchant of record, owns the customer/payment relationship, and bears
   fraud, chargeback, refund, tax, and dispute liability?
3. Can one intent route or split funds to a seller and CollectTT, or would funds
   first enter CollectTT's balance? If the latter, what licensed settlement flow
   is expected?
4. What are payout timing, reserves/holds, limits, settlement reports, and
   reconciliation guarantees? Is there an API for seller payouts?
5. Which currencies and card brands are enabled for this specific Trinidad and
   Tobago business account?
6. How do card refunds work through the public API? The REST index describes
   optional partial refund amounts, while the Business guide says portal refunds
   are full-only and card reversals currently require support. Confirm the current
   production behavior. [REST endpoint index](https://docs.wam.money/docs/payment-sdk/rest-api#endpoint-index)
   [Business refund guide](https://docs.wam.money/docs/business/payments#refunds)
7. What webhook ordering guarantees, event-retention/replay period, API uptime
   commitment, and production rate limits apply contractually?
8. Wam's current key pages are internally inconsistent about whether staging keys
   are `sk_test_...` or plain 64-character hex. Copy credentials from the matching
   portal and do not infer the environment from key shape; ask Wam to confirm the
   canonical format. [API key formats](https://docs.wam.money/docs/payment-sdk/api-keys#identifying-your-credentials-by-format)
   [Sandbox key generation](https://docs.wam.money/docs/payment-sdk/testing/sandbox-keys#generating-a-sandbox-key)

## Primary sources

- [Payment Integration](https://docs.wam.money/docs/payment-sdk)
- [JavaScript / Node.js quickstart](https://docs.wam.money/docs/payment-sdk/quickstart)
- [API Keys & Setup](https://docs.wam.money/docs/payment-sdk/api-keys)
- [Payment Intents](https://docs.wam.money/docs/payment-sdk/payment-intents)
- [Webhooks](https://docs.wam.money/docs/payment-sdk/webhooks)
- [REST API Reference](https://docs.wam.money/docs/payment-sdk/rest-api)
- [Error Reference](https://docs.wam.money/docs/payment-sdk/error-reference)
- [Testing](https://docs.wam.money/docs/payment-sdk/testing)
- [Test mode overview](https://docs.wam.money/docs/payment-sdk/testing/overview)
- [Sandbox API keys](https://docs.wam.money/docs/payment-sdk/testing/sandbox-keys)
- [Mock SDK](https://docs.wam.money/docs/payment-sdk/testing/mock-sdk)
- [Test cards](https://docs.wam.money/docs/payment-sdk/testing/test-cards)
- [Accepting Payments](https://docs.wam.money/docs/business/payments)
- [Fees & Pricing](https://docs.wam.money/docs/business/fees)
- [Wam Pay Skill](https://docs.wam.money/docs/payment-sdk/wam-pay-skill)
