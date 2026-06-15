// Backend endpoint parity tests.
//
// These run against each framework (see playwright.config.js projects) and
// assert that all five expose an identical contract for the four endpoints:
//   GET  /access-token     GET  /webhook-events
//   POST /process-payment  POST /webhook
//
// `/access-token` is a genuine integration check — it round-trips to the live
// GP sandbox, so a pass proves credentials and connectivity are wired up.

const { test, expect } = require('@playwright/test');

test.describe('GP API Drop-In backend endpoints', () => {
  test('GET /access-token returns a sandbox-scoped token', async ({ request }) => {
    const res = await request.get('/access-token');
    expect(res.ok(), `expected 2xx, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.env).toBe('sandbox');
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
      type: 'TRANSACTION_CAPTURED',
      content: [{ id: 'TRN-TEST', status: 'CAPTURED' }],
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
    expect(stored.type).toBe('TRANSACTION_CAPTURED');
    expect(stored.receivedAt, 'events are timestamped on receipt').toBeTruthy();
  });

  test('POST /process-payment rejects an invalid body with 400', async ({ request }) => {
    // amount sent as a string to mirror the frontend (a number <input> .value);
    // a zero amount and a missing payment_reference are both invalid.
    const res = await request.post('/process-payment', {
      headers: { 'Content-Type': 'application/json' },
      data: { amount: '0' },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
