# Test-Card Verification

This sample is verified against the **official Global Payments test-card suite**
([developer.globalpayments.com → Test Cards](https://developer.globalpayments.com/gh-assets/markdown%3Aresources%3Atest-cards.md)).
The catalog is encoded in [`tests/test-cards.mjs`](../tests/test-cards.mjs) and driven by an
automated harness, [`tests/verify-test-cards.mjs`](../tests/verify-test-cards.mjs), that runs
every exercisable card through the **real merchant page → GP-hosted card entry → 3-D Secure
→ poll `/payment-status`** chain and checks the outcome the sample reports.

## What the sample is (and isn't) responsible for

The HPP sample is a faithful **pass-through**: it creates a `HOSTED_PAYMENT_PAGE` link and
classifies whatever transaction status GP returns into `success` / `declined` / `pending`.
The only card-dependent logic in the entire sample is that one `classify()` mapping — and it
is **byte-identical across all five backends** (Node, Python, PHP, Java, .NET):

```
success  ← PREAUTHORIZED, CAPTURED, SUCCESS
declined ← DECLINED, REJECTED, CANCELLED
pending  ← anything else / no transaction yet
```

So "does the project work with the test cards" reduces to: *for every card, does the sample
reach a terminal state and classify it correctly?*

## ⚠️ Approvals are non-deterministic on the shared sandbox

Verified live (June 2026): the shared `transaction_processing_hpp` sandbox account
authorises 3-D Secure hosted card sales **non-deterministically**. The *same* "approved"
test card returns `PREAUTHORIZED` on one run and an outright `DECLINED` on the next. Example —
card `4222000006285344` (documented "Authentication Successful") over four identical runs:

```
DECLINED | DECLINED | PREAUTHORIZED | PREAUTHORIZED
```

This is an **upstream GP sandbox property**, not a bug in the sample — the sample reports
exactly what GP returns. Whether a given approvable card approves on a given run is outside
the sample's control. (This matches the long-standing note in
[`HPP_REFERENCE.md`](HPP_REFERENCE.md) §8 and in `tests/ui.spec.js`.)

Consequently the harness makes a **hard pass/fail assertion only where the sandbox is
deterministic**, and a softer (but still meaningful) assertion for approvable cards.

## The expectation model

Each card in the catalog carries an `expect` value:

| `expect` | Cards | Assertion (hard fail if violated) |
|---|---|---|
| `declined` | Decline codes **101 / 102 / 103 / 200**, SCA-required **111**, 3-D Secure **Auth-Failed / Issuer-Rejected** | Outcome **must** be `declined`. Deterministic. |
| `terminal` | "Approved" cards, 3-D Secure success/challenge cards, card-blocking, DCC | Flow **must** reach a terminal state (`success` **or** `declined`) backed by a real `TRN_…` transaction and a recognised GP status — i.e. the pass-through is faithful. Approval itself is not asserted (sandbox is non-deterministic). |
| `unsupported` | **JCB**, **UATP** | Hosted page rejects the brand ("Cannot process this card type") on this account; the sample must surface it gracefully and **never** report a false success. |
| _(none)_ | Network tokens, Click-to-Pay, Thank-You-Points, installments, Apple/Google Pay amount triggers, open banking | Catalogued only — these need wallet / network-token / bank-redirect flows or feature provisioning this hosted-card sample does not exercise. |

## Running it

Start any framework, then point the harness at it:

```bash
./run.sh nodejs                       # serves on :8000
npm run verify:cards:repr             # ~12-card smoke (~3 min)
npm run verify:cards                  # full exercisable matrix (~50 cards)

# target another framework / port, tune speed, repeat for determinism stats:
node tests/verify-test-cards.mjs --base=http://localhost:8002 --framework=python
node tests/verify-test-cards.mjs --category=decline-101
node tests/verify-test-cards.mjs --trials=4 --concurrency=3
```

Against the Docker stack (`./docker-run.sh start`): nodejs `:8001`, python `:8002`,
php `:8003`, java `:8004`, **dotnet `:8006`**.

### Output

The harness writes to `tests/card-verification-report/` (git-ignored):

- `report.md` — human-readable table (documented vs. expected vs. actual + screenshot links)
- `report.json` — machine-readable results, plus the catalogued-but-not-exercised list
- `shots/*.png` — a **full-page screenshot of the sample's own success/decline panel** for
  every card, so the outcome is visually confirmable, not just asserted.

The process exits non-zero if any **hard** assertion fails. Non-deterministic approvals
never fail the run; the summary reports the approve/decline split so you can see the
sandbox's behaviour for that run.

## Latest verified result

- **Node.js, full matrix** — 59 exercisable card runs: **59/59 passed**, 0 hard failures.
  Every deterministic decline (28 decline-code cards + 3 SCA + 4 3-D-Secure failures)
  declined and was classified correctly; JCB/UATP were gracefully rejected; approvable
  cards split between `PREAUTHORIZED` and `DECLINED` as expected for the sandbox, every
  one a faithful, correctly-classified pass-through.
- **All five frameworks, representative subset, via Docker** (`nodejs:8001 python:8002
  php:8003 java:8004 dotnet:8006`) — **60/60 passed** (12 cards × 5), 0 hard failures.
  This confirms project-wide parity directly, on top of the identical `classify()` mapping
  and the endpoint-parity checks in `tests/api.spec.js`.

> Under high concurrency the GP hosted page can occasionally exceed the terminal-wait
> window; the harness retries a card once on a transient `timeout`/`error` (a genuine
> misclassification surfaces as a clean wrong outcome, never a timeout, so retries cannot
> mask a real bug). Tune with `--retries` / `--concurrency`.
