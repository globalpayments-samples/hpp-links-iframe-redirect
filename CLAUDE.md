# CLAUDE.md

Guidance for working in this repository.

## What this is

A reference sample demonstrating the **Global Payments Drop-In UI** on the **GP API**
(Unified Payments / UCP), implemented identically across **five backend frameworks**.
The headline feature is **iframe succession**: card entry, the 3-D Secure challenge,
and the result are all handled inside a single hosted iframe with **no parent-page
redirect**. Its purpose is to help merchants migrate off the legacy
Portico/Heartland HP Interceptor by proving the GP API Drop-In UI handles iframe
succession as well as the legacy systems.

The raw card number never touches the merchant server: the Drop-In UI tokenizes the
card in a secure iframe (served from `js.globalpay.com`), fires `token-success` with a
single-use `paymentReference`, and the backend charges that reference.

## Repository layout

```
nodejs/   Express, ESM, globalpayments-api SDK        → server.js
python/   Flask, calls GP REST directly (no SDK)      → server.py
php/      built-in server + router.php, php-sdk        → *.php
java/     Jakarta servlet, globalpayments-sdk          → ProcessPaymentServlet.java
dotnet/   ASP.NET Core minimal API, GlobalPayments.Api → Program.cs
tests/    Playwright specs (api.spec.js, ui.spec.js)   run against all five
```

Plus root infra: `docker-compose.yml`, `docker-run.sh`, `Dockerfile.tests`,
`playwright.config.js`, `run.sh` (single-framework launcher), `README.md`.

### The frontend is shared and duplicated

Every framework serves a **byte-identical** `index.html` (verify with `md5sum`).
The canonical copies live at:
`nodejs/index.html`, `python/index.html`, `php/index.html`,
`java/src/main/webapp/index.html`, `dotnet/wwwroot/index.html`.

> **CRITICAL:** Any change to the page MUST be applied to all five copies, or the
> frameworks diverge. There is no build step that syncs them. After editing, run
> `md5sum */index.html java/src/main/webapp/index.html dotnet/wwwroot/index.html`
> (adjust paths) and confirm all hashes match.

## The four-endpoint contract (identical across all five)

| Method | Path               | Purpose |
|--------|--------------------|---------|
| GET    | `/access-token`    | Mint a limited-scope (`PMT_POST_Create_Single`) token for the frontend; returns `{ token, env:"sandbox" }`. Round-trips to the live GP sandbox. |
| POST   | `/process-payment` | Charge the single-use `paymentReference`. Body `{ payment_reference, amount }`. Returns `{ success, transactionId, amount, status, cardDetails:{ brand, maskedNumber } }`. |
| POST   | `/webhook`         | Receive GP API notifications. Stores the last 20, flattened to `{ receivedAt, type, id, payload }`. |
| GET    | `/webhook-events`  | Return the stored events for the live UI feed. |

- The access token is obtained by POSTing `{app_id, nonce, secret, grant_type:client_credentials, permissions}` to `https://apis.sandbox.globalpay.com/ucp/accesstoken`, where `secret = sha512(nonce + appKey)`. The App Key never reaches the browser.
- GP API version header is `2021-03-22` everywhere; the frontend passes the same `apiVersion` to `GlobalPayments.configure()`.
- **Python is the deliberate exception**: there is no official Global Payments Python *server* SDK, so `python/server.py` calls the GP REST API directly via `requests` (note: amounts go to GP in **minor units / cents**). The HTTP contract it exposes to the frontend is identical to the other four.
- Webhook event storage is in-memory for Node/Python/Java/.NET (process-local ring buffer, lost on restart); **PHP persists to `webhook-log.json`** on disk because each request is a fresh process.

## How to run

### One framework locally
```bash
./run.sh                # nodejs on :8000 (default)
./run.sh python         # or python / php / java / dotnet
./run.sh php 8080       # custom port
```
`run.sh` auto-copies the root `.env` into the framework dir if needed, then execs the
framework's own `run.sh`. Each framework also has its own `run.sh` that installs deps
and starts the server (npm / venv+pip / composer / mvn / dotnet).

> Server static-file serving is **cwd-relative** (e.g. Express `express.static('.')`).
> Always start a server from inside its own framework directory, or `/` will 404.
> (Use `run.sh`, which `cd`s for you.)

### All five via Docker
```bash
cp nodejs/.env.sample .env   # fill credentials (sandbox creds are pre-populated)
./docker-run.sh start        # nodejs:8001 python:8002 php:8003 java:8004 dotnet:8006
./docker-run.sh stop
```
Note the host port map skips 8005: **.NET is on 8006**.

## Testing

Playwright drives both backend-contract checks (`tests/api.spec.js`) and Drop-In UI
smoke + iframe-succession checks (`tests/ui.spec.js`) against every framework.

```bash
./docker-run.sh test                 # builds images, runs all 30 tests in-network
./docker-run.sh test:single nodejs   # one framework
```

Run against host-published ports (against `docker-run.sh start`, or a local `run.sh`
server on the matching port) with the `local` target:
```bash
TEST_TARGET=local npx playwright test --project=nodejs
```
`/access-token` is a genuine integration test — it hits the live GP sandbox, so a pass
proves credentials and connectivity are wired. Tests are serial in CI (`workers:1`,
`retries:2`) to keep sandbox load low.

### Driving the live UI / payment flow with a real browser

Playwright + Chromium are installed. The Drop-In UI renders **named iframes**:
`card-number`, `card-expiration`, `card-cvv`, `card-holder-name`, `submit`. Inside
each field iframe the real input is `#secure-payment-field` (there are also
`aria-hidden` autocomplete-helper inputs — don't target a bare `input`). Fill the
fields, click the button in the `submit` iframe, then assert on `#state-success` /
`#state-decline`. Sandbox test card: `4263970000005262`, any future expiry, any CVV.

## Environment / credentials

Each framework reads `.env` (gitignored) with:
`GP_APP_ID`, `GP_APP_KEY`, `GP_MERCHANT_ID`, `GP_ACCOUNT_NAME` (`transaction_processing`),
optional `PORT` and `GP_WEBHOOK_SECRET`. The `.env.sample` files ship working **sandbox**
credentials. Charges resolve to the right account via the app credentials +
`accessTokenInfo.transactionProcessingAccountName` (`GP_ACCOUNT_NAME`). **`GP_MERCHANT_ID`
stays in `.env` as a documented credential but is intentionally NOT wired into the SDK
configs** — see the gotchas section below for why setting it breaks the charge.

## GP API integration gotchas (learned the hard way — keep these)

These are non-obvious and previously caused 4 of the 5 backends to fail the actual
charge while still passing the old test suite (which never charged a card):

- **Do NOT set `merchantId` on the SDK config.** This is a direct-merchant
  integration. With `merchantId` set, the PHP/Java/.NET SDKs route charges to the
  partner-scoped `POST /ucp/merchants/{id}/transactions` endpoint, which the app's
  token isn't permitted for → `403 ACTION_NOT_AUTHORIZED (40212)` "Permission not
  enabled to execute action". Omitting it posts to plain `/ucp/transactions`, which
  works. (Node's JS SDK happened to ignore `merchantId` for routing, so only Node
  ever worked.) The account is resolved from app credentials +
  `accessTokenInfo.transactionProcessingAccountName`. `GP_MERCHANT_ID` remains in
  `.env` as a documented credential but is intentionally not wired into the configs.
- **Python REST `/transactions` requires `country` and `payment_method.entry_mode`.**
  A token charge needs top-level `"country": "US"` and `"payment_method": {"entry_mode":
  "ECOM", "id": <ref>}`. Missing either returns `MANDATORY_DATA_MISSING (40005)`. The
  SDKs add these automatically; the raw-REST Python path must send them explicitly.
- **GP error fields are `error_code` / `detailed_error_description`, not `detail`.**
  Map those when surfacing errors (Python did this wrong and reported a generic
  "Payment failed").
- **Charging always works without `merchantId`**; verified live on the sandbox with
  test card `4263970000005262` returning `CAPTURED`.

The `tests/ui.spec.js` "completes a real sandbox charge end-to-end (CAPTURED)" test is
the regression guard for all of the above — it drives a real tokenize → charge →
CAPTURED through every framework. Keep it; the old suite's gap (token issuance + input
rejection only, no successful charge) is exactly what let these bugs hide.

## Conventions

- All endpoints return JSON `{ success: false, error }` on failure with a sensible HTTP status (400 for bad input / declines, 500 for server errors).
- Webhook signature verification (HMAC-SHA256 over the raw body, `X-GP-Signature`) is **stubbed/commented out** in every framework with a "verify in production" note — preserving raw-body access is why Node mounts `express.raw` on `/webhook` before `express.json()`.
- Commit messages in this repo: **no Claude/Anthropic attribution, no `Co-Authored-By`** (see project memory).
- The default working branch is `redesign-drop-in-ui`; PRs target `main`. Remote is the private `globalpayments-samples/drop-in-ui-iframe` (use the `RadoslavSheytanovGP` gh account, which has access).
