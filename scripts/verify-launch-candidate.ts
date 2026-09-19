/**
 * Milestone 8 launch-candidate HTTP preflight.
 *
 * This is intentionally independent of browser automation and provider credentials. It
 * checks the public route contract, readiness response, redirects, and direct-object
 * authorization boundary against a running web process.
 *
 * Run with:
 *   COLLECTTT_BASE_URL=http://localhost:3000 npm run verify:launch
 */

type Check = { label: string; run: () => Promise<void> };

const baseUrl = (process.env.COLLECTTT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const parsedTimeoutMs = Number(process.env.COLLECTTT_VERIFY_TIMEOUT_MS ?? 10_000);
const requestTimeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0 ? parsedTimeoutMs : 10_000;

function url(path: string): string {
  return `${baseUrl}${path}`;
}

async function get(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url(path), { ...init, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    const detail = error instanceof Error && error.name === 'AbortError'
      ? `timed out after ${requestTimeoutMs}ms`
      : error instanceof Error ? error.message : String(error);
    throw new Error(`could not reach ${url(path)} (${detail}); start the web process and verify COLLECTTT_BASE_URL`);
  } finally {
    clearTimeout(timeout);
  }
}

async function expectStatus(path: string, status: number, init?: RequestInit): Promise<Response> {
  const response = await get(path, init);
  if (response.status !== status) {
    throw new Error(`${path} returned ${response.status}; expected ${status}`);
  }
  return response;
}

async function expectPage(path: string, heading: string): Promise<void> {
  const response = await expectStatus(path, 200);
  const body = await response.text();
  if (!body.includes(heading)) {
    throw new Error(`${path} did not contain the expected heading ${JSON.stringify(heading)}`);
  }
}

const checks: Check[] = [
  {
    label: 'readiness reports a healthy database and no failed notifications',
    async run() {
      const response = await expectStatus('/api/ready', 200);
      const body = (await response.json()) as {
        ok?: boolean;
        database?: string;
        failedNotificationDeliveries?: number;
      };
      if (body.ok !== true || body.database !== 'ready') {
        throw new Error(`unexpected readiness payload: ${JSON.stringify(body)}`);
      }
      if (body.failedNotificationDeliveries !== 0) {
        throw new Error(`readiness reports failed notifications: ${body.failedNotificationDeliveries}`);
      }
    },
  },
  {
    label: 'public browse and sale-type routes render',
    async run() {
      await expectPage('/listings', 'Browse listings');
      await expectPage('/listings?saleType=auction', 'Browse listings');
      await expectPage('/listings?category=trading_card', 'Browse listings');
    },
  },
  {
    label: 'legal and support surfaces render',
    async run() {
      await expectPage('/privacy-policy', 'Privacy Policy');
      await expectPage('/terms-of-service', 'Terms of Service');
      await expectPage('/support', 'CollectTT support');
      await expectPage('/prohibited-items', 'Prohibited items');
      await expectPage('/minors-policy', 'Minors policy');
    },
  },
  {
    label: 'unauthenticated account routes redirect to sign in',
    async run() {
      const response = await get('/deals');
      const location = response.headers.get('location') ?? '';
      if (![301, 302, 303, 307, 308].includes(response.status) || !location.includes('/sign-in')) {
        throw new Error(`/deals returned ${response.status} with location ${JSON.stringify(location)}`);
      }
    },
  },
  {
    label: 'missing public objects return not found',
    async run() {
      await expectStatus('/listings/00000000-0000-0000-0000-000000000000', 404);
      await expectStatus('/members/00000000-0000-0000-0000-000000000000', 404);
    },
  },
  {
    label: 'direct-object mutation probes require a session',
    async run() {
      const requests: Array<[string, Record<string, unknown>]> = [
        ['/api/profile/onboarding', { displayName: 'launch-probe', phone: '+18685550123' }],
        ['/api/deals/not-a-deal/evidence', { contentType: 'text/plain' }],
        ['/api/deals/not-a-deal/evidence/confirm', { evidenceId: 'not-evidence' }],
      ];
      for (const [path, body] of requests) {
        const response = await expectStatus(path, 401, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await response.text();
        if (!/sign in required/i.test(text)) {
          throw new Error(`${path} returned an unexpected authorization body: ${text}`);
        }
      }
    },
  },
  {
    label: 'application icon is available',
    async run() {
      await expectStatus('/icon.svg', 200);
    },
  },
];

let failures = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`PASS  ${check.label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${check.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} launch-candidate HTTP check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS — ${checks.length} launch-candidate HTTP checks passed against ${baseUrl}.`);
}
