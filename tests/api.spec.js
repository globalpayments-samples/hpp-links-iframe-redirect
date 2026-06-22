// Backend endpoint parity tests.
//
// These run against each framework (see playwright.config.js projects) and
// assert that all five expose an identical contract for the four endpoints:
//   POST /create-hpp-link  GET  /payment-status
//   POST /webhook          GET  /webhook-events
//
// `/create-hpp-link` is a genuine integration check — it mints a GP API token and
// creates a real HOSTED_PAYMENT_PAGE link on the live sandbox, so a pass proves
// credentials, the LNK_POST_Create permission, and connectivity are all wired up.

const { test, expect } = require('@playwright/test');

test.describe('GP API Hosted Payment Page backend endpoints', () => {
  test('POST /create-hpp-link creates a real hosted link', async ({ request }) => {
    const res = await request.post('/create-hpp-link', {
      headers: { 'Content-Type': 'application/json' },
      data: { amount: '200.00', currency: 'USD', displayMethod: 'iframe', config: { threeds: true } },
    });
    expect(res.ok(), `expected 2xx, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    expect(body.success).toBe(true);
    // GP returns a link id (LNK_…) and a hosted redirect URL to render/redirect to.
    expect(body.id).toMatch(/^LNK_/);
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('globalpay');
    expect(body.reference).toMatch(/^order-/);
  });

  test('POST /create-hpp-link rejects a non-positive amount with 400', async ({ request }) => {
    const res = await request.post('/create-hpp-link', {
      headers: { 'Content-Type': 'application/json' },
      data: { amount: '0' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  test('GET /payment-status returns a pending outcome for an unknown reference', async ({ request }) => {
    const res = await request.get('/payment-status?reference=order-does-not-exist-' + Date.now());
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // No transaction recorded for this reference yet → pending.
    expect(body.outcome).toBe('pending');
  });

  test('GET /payment-status requires a reference (400)', async ({ request }) => {
    const res = await request.get('/payment-status');
    expect(res.status()).toBe(400);
  });

  test('GET /webhook-events returns an array', async ({ request }) => {
    const res = await request.get('/webhook-events');
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test('POST /webhook stores an event that /webhook-events echoes back', async ({ request }) => {
    const id = `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const event = {
      id,
      type: 'TRANSACTION_PREAUTHORIZED',
      content: [{ id: 'TRN-TEST', status: 'PREAUTHORIZED' }],
    };

    const post = await request.post('/webhook', {
      headers: { 'Content-Type': 'application/json' },
      data: event,
    });
    expect(post.ok(), `webhook POST should be accepted, got ${post.status()}`).toBeTruthy();

    const res = await request.get('/webhook-events');
    const events = await res.json();
    const stored = events.find((e) => e.id === id);

    expect(stored, 'posted webhook event should appear in /webhook-events').toBeTruthy();
    // Parity: every framework flattens the event at the top level so the live
    // UI log can read e.type / e.id directly.
    expect(stored.type).toBe('TRANSACTION_PREAUTHORIZED');
    expect(stored.receivedAt, 'events are timestamped on receipt').toBeTruthy();
  });
});
