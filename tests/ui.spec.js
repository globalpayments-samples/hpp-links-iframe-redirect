// Drop-In UI smoke + iframe-succession tests.
//
// Every framework serves the same index.html. These verify the page loads and
// that the Drop-In UI iframe actually mounts — which only happens after the
// page fetches a real /access-token and calls GlobalPayments.configure(). So a
// mounted iframe is end-to-end proof of the token -> configure -> mount chain
// for that backend, not just static HTML.

const { test, expect } = require('@playwright/test');

test.describe('Drop-In UI page', () => {
  test('serves the page with the Drop-In script and all four tabs', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('script[src*="globalpayments.js"]')).toHaveCount(1);

    for (const tab of ['payment-form', 'tokenization', 'webhooks', 'recurring']) {
      await expect(page.locator(`.gp-tab-button[data-tab="${tab}"]`)).toHaveCount(1);
    }

    // The Payment Form tab is active by default; its mount target must exist.
    await expect(page.locator('#credit-card')).toBeVisible();
  });

  test('mounts the secure card-entry iframe (token -> configure -> form)', async ({ page }) => {
    await page.goto('/');

    // The Drop-In UI injects its hosted-fields iframe into #credit-card once the
    // SDK is configured with a freshly issued access token.
    await expect(page.locator('#credit-card iframe').first()).toBeAttached({ timeout: 30_000 });
  });

  // Full end-to-end charge against the live GP sandbox. This is the real proof
  // that the backend can actually charge a tokenized card — not just issue a
  // token. It exercises tokenize (Drop-In UI) -> POST /process-payment ->
  // GP SDK/REST charge -> CAPTURED, through each framework's real integration.
  test('completes a real sandbox charge end-to-end (CAPTURED)', async ({ page }) => {
    test.slow(); // hosted-fields load + live sandbox round-trip
    await page.goto('/');
    await expect(page.locator('#credit-card iframe').first()).toBeAttached({ timeout: 30_000 });
    await page.waitForTimeout(2_500); // let the hosted-field iframes finish wiring up

    const fill = async (name, value) => {
      const frame = page.frame({ name });
      expect(frame, `hosted-field iframe "${name}" should exist`).toBeTruthy();
      await frame.waitForSelector('#secure-payment-field', { timeout: 15_000 });
      await frame.fill('#secure-payment-field', value);
    };
    await fill('card-number', '4263970000005262');
    await fill('card-expiration', '1230');
    await fill('card-cvv', '123');
    await fill('card-holder-name', 'Test User');

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/process-payment'), { timeout: 30_000 }),
      page.frame({ name: 'submit' }).click('#secure-payment-field, button, [role=button]'),
    ]);

    const body = await resp.json();
    expect(body.success, `process-payment failed: ${JSON.stringify(body)}`).toBe(true);
    expect(body.status).toBe('CAPTURED');
    expect(body.transactionId).toBeTruthy();

    // The success state and a human-readable receipt must render.
    await expect(page.locator('#state-success')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#success-receipt')).toContainText('••••');
  });
});
