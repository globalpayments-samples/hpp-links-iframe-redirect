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
});
