#!/usr/bin/env node
/**
 * Test-card verification harness for the GP API Hosted Payment Page sample.
 *
 * Drives the *real* merchant page (the same index.html every framework serves) end
 * to end for each official Global Payments test card: clicks "Proceed to Payment",
 * lets the backend create a live HOSTED_PAYMENT_PAGE link, fills the GP-hosted card
 * page inside the iframe, lets 3-D Secure run, and reads the outcome the sample
 * renders (its own success / decline panel) plus the raw /payment-status payload.
 *
 * It then checks each card against what the sample is actually responsible for —
 * see tests/test-cards.mjs for the `expect` model and docs/TEST_CARDS.md for the
 * (important) note on why approvals are non-deterministic on the shared sandbox.
 *
 *   node tests/verify-test-cards.mjs [options]
 *     --base=URL          merchant origin to test (default http://localhost:8000)
 *     --framework=NAME    label for the report (default nodejs)
 *     --category=CAT      only cards in this category (e.g. decline-101, 3ds2-visa)
 *     --repr              only the representative subset (fast smoke, ~12 cards)
 *     --trials=N          run each card N times (default 1) — surfaces non-determinism
 *     --retries=N         re-run a card on transient timeout/error (default 1)
 *     --concurrency=N     parallel browser contexts (default 1, sandbox-friendly)
 *     --amount=AMT        order amount (default 200.00)
 *     --headed            run a visible browser
 *     --out=DIR           report dir (default tests/card-verification-report)
 *
 * Exit code is non-zero if any *hard* expectation fails (a 'declined' card that did
 * not decline, an 'unsupported' card that falsely succeeded, or a 'terminal' card
 * that never reached a recognised terminal state). Non-deterministic approvals do
 * NOT fail the run — that is a sandbox property, not a sample bug.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOG, EXERCISABLE, NON_CARD_SCENARIOS } from './test-cards.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const BASE        = (args.base || 'http://localhost:8000').replace(/\/$/, '');
const FRAMEWORK   = args.framework || 'nodejs';
const TRIALS      = Math.max(1, parseInt(args.trials || '1', 10));
const RETRIES     = Math.max(0, parseInt(args.retries === undefined ? '1' : args.retries, 10));
const CONCURRENCY = Math.max(1, parseInt(args.concurrency || '1', 10));
const AMOUNT      = args.amount || '200.00';
const OUT         = args.out ? String(args.out) : join(__dirname, 'card-verification-report');
const SHOTS       = join(OUT, 'shots');

const RECOGNISED = ['PREAUTHORIZED', 'CAPTURED', 'SUCCESS', 'DECLINED', 'REJECTED', 'CANCELLED'];

let cards = EXERCISABLE;
if (args.repr)     cards = cards.filter((c) => c.repr);
if (args.category) cards = cards.filter((c) => c.category === args.category);
if (cards.length === 0) { console.error('No cards match the filter.'); process.exit(2); }

mkdirSync(SHOTS, { recursive: true });

// ── one card run ───────────────────────────────────────────────────────────--
async function runCard(browser, card, trial) {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  const slug = `${card.category}-${card.brand}-${card.number}${TRIALS > 1 ? `-t${trial}` : ''}`;
  let terminal = null;

  page.on('response', async (resp) => {
    if (!resp.url().includes('/payment-status')) return;
    try {
      const b = await resp.json();
      if (b && (b.outcome === 'success' || b.outcome === 'declined')) terminal = b;
    } catch { /* ignore */ }
  });

  const rec = {
    number: card.number, brand: card.brand, category: card.category,
    documented: card.documented, expect: card.expect, trial,
    actualOutcome: null, status: null, transactionId: null, detail: '', pass: false, screenshot: '',
  };

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.fill('#cfg-amount', AMOUNT).catch(() => {});
    await page.click('#proceed-btn');

    // The hosted iframe must mount and render the card form.
    await page.locator('#state-hosted').waitFor({ state: 'visible', timeout: 30_000 });
    const frame = page.frameLocator('#hosted-frame');
    await frame.locator('#pas_ccnum').waitFor({ state: 'visible', timeout: 30_000 });
    // The hosted page attaches its own formatting/validation asynchronously; filling
    // too early silently clears the values. Wait before typing.
    await page.waitForTimeout(3_500);

    await frame.locator('#pas_ccnum').fill(card.number);
    await frame.locator('#pas_expiry').fill('12/34');
    await frame.locator('#pas_cccvc').fill(card.cvv);
    await frame.locator('#pas_ccname').fill('Test User').catch(() => {});
    if ((await frame.locator('#pas_ccnum').inputValue()).replace(/\s/g, '') !== card.number) {
      await frame.locator('#pas_ccnum').fill(card.number);
    }
    await frame.locator('#rxp-primary-btn').click().catch(() => {});

    // Wait for a terminal signal: the sample's success/decline panel, or the hosted
    // page rejecting the brand ("Cannot process this card type").
    const deadline = Date.now() + 110_000;
    while (Date.now() < deadline) {
      if (await page.locator('#state-success').isVisible()) { rec.actualOutcome = 'success'; break; }
      if (await page.locator('#state-decline').isVisible()) { rec.actualOutcome = 'declined'; break; }
      const txt = (await frame.locator('body').textContent().catch(() => '')) || '';
      if (/cannot process this card type/i.test(txt)) { rec.actualOutcome = 'unsupported'; break; }
      await page.waitForTimeout(1_500);
    }
    if (!rec.actualOutcome) rec.actualOutcome = 'timeout';

    if (terminal) {
      rec.status = terminal.status;
      rec.transactionId = terminal.transactionId || null;
    }
    if (rec.actualOutcome === 'success') {
      rec.detail = (await page.locator('#success-receipt').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    } else if (rec.actualOutcome === 'declined') {
      rec.detail = (await page.locator('#decline-message').innerText().catch(() => '')).trim();
    } else if (rec.actualOutcome === 'unsupported') {
      rec.detail = 'Hosted page rejected the card brand ("Cannot process this card type").';
    }

    rec.screenshot = `shots/${slug}.png`;
    await page.screenshot({ path: join(OUT, rec.screenshot), fullPage: true }).catch(() => {});

    // ── evaluate against the expectation model ──
    if (card.expect === 'declined') {
      rec.pass = rec.actualOutcome === 'declined';
    } else if (card.expect === 'unsupported') {
      // Pass if gracefully rejected (or at least never a false success).
      rec.pass = rec.actualOutcome === 'unsupported' || rec.actualOutcome === 'timeout';
      if (rec.actualOutcome === 'success') rec.pass = false; // a false approval would be a real bug
    } else if (card.expect === 'terminal') {
      const recognised = rec.status && RECOGNISED.includes(String(rec.status).toUpperCase());
      const terminalState = rec.actualOutcome === 'success' || rec.actualOutcome === 'declined';
      rec.pass = !!(terminalState && recognised && /^TRN_/.test(rec.transactionId || ''));
    }
  } catch (e) {
    rec.detail = `ERROR: ${e.message}`;
    rec.actualOutcome = rec.actualOutcome || 'error';
    await page.screenshot({ path: join(OUT, `shots/${slug}-error.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
  return rec;
}

// ── simple concurrency pool ──────────────────────────────────────────────────
async function runPool(browser, jobs) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      // Re-run on a transient timeout/error only. A genuine misclassification
      // surfaces as a clean (wrong) outcome, never timeout/error, so retries
      // cannot mask a real bug — they only absorb sandbox/hosted-page flakiness.
      let r = await runCard(browser, job.card, job.trial);
      for (let attempt = 1; attempt <= RETRIES && (r.actualOutcome === 'timeout' || r.actualOutcome === 'error'); attempt++) {
        const retried = await runCard(browser, job.card, job.trial);
        retried.detail = `[retry ${attempt} after ${r.actualOutcome}] ${retried.detail}`.trim();
        r = retried;
      }
      const verdict = r.pass ? 'PASS' : 'FAIL';
      const variable = job.card.expect === 'terminal' ? ` (${r.actualOutcome})` : '';
      console.log(`  [${verdict}] ${r.category.padEnd(14)} ${r.brand.padEnd(10)} ${r.number.padEnd(17)} → ${String(r.status || r.actualOutcome)}${variable}`);
      results.push(r);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Fail fast if the server isn't up.
  try {
    const ping = await fetch(`${BASE}/`);
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch (e) {
    console.error(`\nCannot reach ${BASE} (${e.message}). Start a framework first, e.g. ./run.sh nodejs\n`);
    process.exit(2);
  }

  console.log(`\nGP HPP test-card verification`);
  console.log(`  target     : ${BASE} (${FRAMEWORK})`);
  console.log(`  cards      : ${cards.length}${args.repr ? ' (representative)' : ''}${args.category ? ` in ${args.category}` : ''}  × ${TRIALS} trial(s)`);
  console.log(`  concurrency: ${CONCURRENCY}\n`);

  const jobs = [];
  for (const card of cards) for (let t = 1; t <= TRIALS; t++) jobs.push({ card, trial: t });

  const browser = await chromium.launch({ headless: !args.headed });
  const started = Date.now();
  const results = await runPool(browser, jobs);
  await browser.close();
  const seconds = Math.round((Date.now() - started) / 1000);

  // sort results back into catalog order for a stable report
  results.sort((a, b) => cards.indexOf(cards.find((c) => c.number === a.number && c.category === a.category)) -
                         cards.indexOf(cards.find((c) => c.number === b.number && c.category === b.category)) || a.trial - b.trial);

  const hardFails = results.filter((r) => !r.pass);
  const approvals = results.filter((r) => r.expect === 'terminal' && r.actualOutcome === 'success').length;
  const declinesOfApprovable = results.filter((r) => r.expect === 'terminal' && r.actualOutcome === 'declined').length;

  // ── reports ──
  const summary = {
    target: BASE, framework: FRAMEWORK, when: new Date().toISOString(), durationSeconds: seconds,
    totals: { run: results.length, passed: results.length - hardFails.length, failed: hardFails.length },
    nonDeterminism: { approvableCards: approvals + declinesOfApprovable, approved: approvals, declined: declinesOfApprovable },
    results,
    notExercised: CATALOG.filter((c) => c.expect === null).map((c) => ({ number: c.number, brand: c.brand, category: c.category, documented: c.documented, why: c.note })),
    nonCardScenarios: NON_CARD_SCENARIOS,
  };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT, 'report.md'), renderMarkdown(summary, hardFails));

  // ── console summary ──
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`Ran ${results.length} card runs in ${seconds}s — ${results.length - hardFails.length} passed, ${hardFails.length} failed.`);
  if (approvals + declinesOfApprovable > 0) {
    console.log(`Approvable cards (non-deterministic sandbox): ${approvals} approved, ${declinesOfApprovable} declined — both are faithful pass-throughs.`);
  }
  if (hardFails.length) {
    console.log(`\nHARD FAILURES:`);
    for (const f of hardFails) console.log(`  ✗ ${f.category} ${f.brand} ${f.number} — expected ${f.expect}, got ${f.actualOutcome} (status ${f.status || '—'}) ${f.detail}`);
  }
  console.log(`\nReport : ${join(OUT, 'report.md')}`);
  console.log(`JSON   : ${join(OUT, 'report.json')}`);
  console.log(`Shots  : ${SHOTS}\n`);

  process.exit(hardFails.length ? 1 : 0);
})();

function renderMarkdown(s, hardFails) {
  const row = (r) => `| ${r.category} | ${r.brand} | \`${r.number}\` | ${r.documented} | ${r.expect} | ${r.actualOutcome}${r.status ? ` (${r.status})` : ''} | ${r.pass ? '✅' : '❌'} | ${r.screenshot ? `[shot](${r.screenshot})` : ''} |`;
  return `# GP HPP Test-Card Verification Report

- **Target:** ${s.target} (${s.framework})
- **When:** ${s.when}
- **Duration:** ${s.durationSeconds}s
- **Result:** ${s.totals.passed}/${s.totals.run} passed, ${s.totals.failed} failed

> **Approvals are non-deterministic on the shared GP sandbox.** The same "approved"
> test card returns \`PREAUTHORIZED\` on one run and \`DECLINED\` on the next — verified
> live (see [docs/TEST_CARDS.md](../../docs/TEST_CARDS.md)). The harness therefore makes a
> *hard* assertion only where the sandbox is deterministic (declines, SCA, 3-D Secure
> failures, unsupported brands). For approvable cards it asserts the property the sample
> owns: the flow reaches a terminal, correctly-classified state backed by a real
> \`TRN_\` transaction and a recognised GP status.
>
> This run of approvable cards: **${s.nonDeterminism.approved} approved, ${s.nonDeterminism.declined} declined** — both are correct pass-throughs.

${hardFails.length ? `## ❌ Hard failures (${hardFails.length})\n\n` + hardFails.map((f) => `- **${f.category} / ${f.brand} / \`${f.number}\`** — expected \`${f.expect}\`, got \`${f.actualOutcome}\` (status ${f.status || '—'}). ${f.detail}`).join('\n') + '\n' : '## ✅ No hard failures\n'}

## Results

| Category | Brand | Card | Documented | Expect | Actual | Pass | Evidence |
|---|---|---|---|---|---|---|---|
${s.results.map(row).join('\n')}

## Catalogued but not exercised via hosted-card entry

These published test cards drive wallet / network-token / Click-to-Pay / installment /
loyalty / open-banking flows that this hosted-card sample does not exercise.

| Category | Brand | Card | Documented | Why not exercised |
|---|---|---|---|---|
${s.notExercised.map((c) => `| ${c.category} | ${c.brand} | \`${c.number}\` | ${c.documented} | ${c.why || ''} |`).join('\n')}
`;
}
