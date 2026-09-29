# Global Payments Hosted Payment Page (HPP) Links

> Create a GP-API `HOSTED_PAYMENT_PAGE` link on the server and show the Global Payments hosted card page in an iframe or a full-page overlay, then poll for the outcome, demonstrated in Node.js, Python, PHP, Java, and .NET.

## Critical Patterns

1. **"Redirect" mode never leaves the merchant page.** A `HOSTED_PAYMENT_PAGE` link does not send the browser back to `return_url`, and the sandbox result page is blank (documented in `docs/HPP_REFERENCE.md` section 5). So `displayMethod: "redirect"` loads the hosted URL in a full-bleed iframe overlay (`openFullbleed()` in `index.html`), and both modes get the result by polling. Switching to a real `window.location` redirect strands the customer on the blank result page. The backends ignore `displayMethod`; the choice is purely client-side.

2. **The outcome comes from polling `/payment-status`, and success means `PREAUTHORIZED`.** The page polls `GET /payment-status?reference=...` (2s ramping to 5s, capped at about 5 minutes in `pollStatus()`). Each backend looks up `GET /ucp/transactions?reference=` and maps the status through `classify()`: `PREAUTHORIZED`/`CAPTURED`/`SUCCESS` are success, `DECLINED`/`REJECTED`/`CANCELLED` are declined, anything else or no transaction yet is pending. A successful 3-D Secure hosted sale settles as `PREAUTHORIZED`, not `CAPTURED`, so checking only for `CAPTURED` reports good payments as pending forever. Keep the mapping identical in all five backends.

3. **The link body has non-obvious required fields.** Top-level `reference`, `order.amount`, and `payer.email` must all be present (the backends default `payer.email` to `sandbox.payer@example.com`). Amounts are sent as strings in minor units (`round(amount * 100)`), in both `order.amount` and `transactions.amount`. `account_name` comes from `GP_ACCOUNT_NAME` and must be an account with `LNK_POST_Create`; a plain `transaction_processing` account returns `403 ACTION_NOT_AUTHORIZED (40212)`. The access token is requested with no `permissions` filter so it carries the app's full scope.

4. **No SDK, by design.** All five call the REST API directly (`fetch`, `requests`, cURL, `java.net.http.HttpClient`, `HttpClient`) because the SDKs do not uniformly expose the `HOSTED_PAYMENT_PAGE` link type. The base URL `https://apis.sandbox.globalpay.com/ucp` and `X-GP-Version: 2021-03-22` are hardcoded constants in every backend; there is no environment switch for production.

## Repository Structure

### Node.js (Express, direct GP API)
- [`nodejs/server.js`](nodejs/server.js): `getToken()`, `baseUrl()`, `buildLinkBody()`, `classify()`, `redactSecret()`; inline route handlers for all four endpoints; `/webhook` is mounted with `express.raw()` before `express.json()` so the raw body stays available for signature checks
- [`nodejs/package.json`](nodejs/package.json): `express` ^4.18.2, `dotenv` ^16.3.1; no GP SDK

### Python (Flask, direct GP API)
- [`python/server.py`](python/server.py): `get_token()`, `base_url()`, `build_link_body()`, `classify()`, `create_hpp_link()`, `payment_status()`, `webhook()`, `get_webhook_events()`
- [`python/requirements.txt`](python/requirements.txt): Flask 3.0.0, requests 2.31.0, python-dotenv 1.0.0, gunicorn 21.2.0

### PHP (built-in server + router, direct GP API)
- [`php/router.php`](php/router.php): maps the four routes to their handler files; everything else falls through to static files
- [`php/gp.php`](php/gp.php): shared helpers `gp_token()`, `gp_request()`, `gp_base_url()`, `gp_classify()`, `gp_redact()`
- [`php/create-hpp-link.php`](php/create-hpp-link.php): builds the link body inline and posts to `/ucp/links`
- [`php/payment-status.php`](php/payment-status.php), [`php/webhook.php`](php/webhook.php), [`php/webhook-events.php`](php/webhook-events.php): status lookup and webhook log; PHP persists events to `php/webhook-log.json` (not git-ignored) because the built-in server keeps no memory between requests
- [`php/composer.json`](php/composer.json): only `vlucas/phpdotenv` ^5.5

### Java (Jakarta Servlet, direct GP API)
- [`java/src/main/java/com/globalpayments/example/HostedPaymentServlet.java`](java/src/main/java/com/globalpayments/example/HostedPaymentServlet.java): one servlet on all four paths; `doGet()`/`doPost()` dispatch to `handleCreateHppLink()`, `handlePaymentStatus()`, `handleWebhook()`, `handleWebhookEvents()`; helpers `getToken()`, `baseUrl()`, `countryFor()`, `classify()`
- [`java/pom.xml`](java/pom.xml): Jackson 2.17.1, `dotenv-java` 3.0.0, Jakarta Servlet 5.0.0, Java 21, Cargo on port 8000

### .NET (ASP.NET Core minimal API, direct GP API)
- [`dotnet/Program.cs`](dotnet/Program.cs): `MapEndpoints()` registers the four routes; `GetTokenAsync()`, `BaseUrl()`, `CountryFor()`, `Apms()`, `Classify()`
- [`dotnet/dotnet.csproj`](dotnet/dotnet.csproj): `DotEnv.Net` 3.2.1, net9.0; no GP SDK

### Frontend (one file, five copies)
- `nodejs/index.html`, `python/index.html`, `php/index.html`, `java/src/main/webapp/index.html`, `dotnet/wwwroot/index.html` are byte-identical. Key functions: `readConfig()`, `proceed()`, `pollStatus()`, `openFullbleed()`, `handleReturn()`, `renderApiExplorer()`

### Shared
- [`run.sh`](run.sh): `./run.sh [framework] [port]` launcher; copies a root `.env` into the framework folder if it has none
- [`docker-compose.yml`](docker-compose.yml) and [`docker-run.sh`](docker-run.sh): five services plus a Playwright `tests` service (profile `testing`)
- [`tests/`](tests/api.spec.js) and [`playwright.config.js`](playwright.config.js): endpoint parity specs (`api.spec.js`, `ui.spec.js`) and the test-card harness (`verify-test-cards.mjs`, catalog in `test-cards.mjs`)
- [`docs/HPP_REFERENCE.md`](docs/HPP_REFERENCE.md): wire-level reference, error fingerprints, value-add toggles; [`docs/TEST_CARDS.md`](docs/TEST_CARDS.md): card expectations
- [`package.json`](package.json): root test scripts only (`@playwright/test` 1.53.1)

## API Surface

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/create-hpp-link` | Mints a token, creates the `HOSTED_PAYMENT_PAGE` link; returns `id`, `url`, `reference`, and the redacted `apiCalls` trace |
| GET | `/payment-status?reference=` | Looks up the transaction by order reference; returns `outcome`, `status`, `transactionId`, `amount`, `currency`, `cardDetails` |
| POST | `/webhook` | Receives GP notifications sent to the link's `status_url`; keeps the last 20 |
| GET | `/webhook-events` | Returns the stored webhook events for the UI log |

Paths are identical in all five, including PHP (via `router.php`). One known divergence: .NET stores events in a `ConcurrentQueue`, so `/webhook-events` returns them oldest first, while the other four return newest first.

## Environment Variables

```bash
GP_APP_ID=your_app_id                # GP-API app ID; sent as app_id in the token request
GP_APP_KEY=your_app_key              # Used only to compute secret = SHA512(nonce + key)
GP_ACCOUNT_NAME=your_account_name    # Sent as account_name; needs LNK_POST_Create (sample uses transaction_processing_hpp)
GP_MERCHANT_ID=your_merchant_id      # In .env.sample and docker-compose, not read by any backend
PORT=8000                            # Optional; Java ignores it (Cargo fixes 8000)
# BASE_URL=https://your-tunnel.example   # Public origin for return_url/status_url; defaults to the request origin
# GP_WEBHOOK_SECRET=...              # Only referenced in the commented-out signature check
```

Each framework folder has an identical `.env.sample`; copy it to `.env`. The samples ship populated with shared sandbox credentials that the comments say not to use for config changes; replace them with your own for anything beyond a local demo. `docker-compose.yml` forwards the four `GP_*` values but not `BASE_URL`, so webhooks cannot reach the containers without editing it.

## Test Cards

| Brand | Number | CVV | Expiry |
|-------|--------|-----|--------|
| Visa | 4263970000005262 | 123 | Any future date |
| Mastercard | 5425230000004415 | 123 | Any future date |

Approvals on the shared `transaction_processing_hpp` sandbox are non-deterministic: the same approved card can return `PREAUTHORIZED` or `DECLINED` on repeated runs (see `docs/TEST_CARDS.md`). Decline-code cards are deterministic. Get your own credentials at [developer.globalpayments.com](https://developer.globalpayments.com).

## API Request Shape

**Token:** `POST https://apis.sandbox.globalpay.com/ucp/accesstoken` with `Content-Type: application/json` and `X-GP-Version: 2021-03-22`. Body: `app_id`, `nonce` (an ISO 8601 UTC timestamp), `secret` = lowercase hex SHA-512 of `nonce + GP_APP_KEY`, `grant_type: "client_credentials"`. No `permissions` field.

**Link:** `POST https://apis.sandbox.globalpay.com/ucp/links` with `Authorization: Bearer {token}` and `X-GP-Version: 2021-03-22`.
- `type: "HOSTED_PAYMENT_PAGE"`, `usage_mode: "SINGLE"`, `usage_limit: "1"`, `expiration_date` one hour out
- `order.transaction_configuration`: `channel: "CNP"`, `capture_mode: "AUTO"`, `country` derived from currency (USD→US, EUR→IE, GBP→GB, CAD→CA, else US), `currency_conversion_mode` from the DCC toggle, `allowed_payment_methods` = `["CARD", ...apms]`
- `order.payment_method_configuration.authentication.preference`: `CHALLENGE_PREFERRED` or `NO_CHALLENGE_REQUESTED`; `digital_wallets.provider: ["googlepay", "applepay"]` when wallets are on
- `notifications.return_url` = `{base}/?reference={reference}`, `notifications.status_url` = `{base}/webhook`

GP errors come back as `error_code` and `detailed_error_description`; the backends surface the latter.

## Architecture Summary

**Create:** browser `proceed()` → `POST /create-hpp-link` → `/ucp/accesstoken` → `/ucp/links` → `url` loaded in the inline iframe or the full-bleed overlay.

**Pay and resolve:** customer pays and completes 3-D Secure on the GP page → browser polls `GET /payment-status` → backend `GET /ucp/transactions?reference=` → `classify()` → receipt or decline panel. Webhooks to `/webhook` are informational only and never drive the UI outcome.

## Security Notes

Webhook HMAC-SHA256 verification (`X-GP-Signature`) is commented out in every backend, no endpoint has authentication, and webhook events live in memory (a JSON file in PHP). The `apiCalls` trace redacts the token and secret but returns the full link body to the browser. For production: enable signature checks, add auth, move to the production base URL, and keep credentials in a secrets manager.

## How to Run

```bash
./run.sh                 # Node.js :8000 (default)
./run.sh python          # Python :8000
./run.sh php             # PHP :8000 (php -S 0.0.0.0:$PORT router.php)
./run.sh java            # Java :8000 (mvn clean package cargo:run; port argument ignored)
./run.sh dotnet          # .NET :8000
./run.sh php 8080        # any framework on a custom port (not Java)
# All five: Node 8001, Python 8002, PHP 8003, Java 8004, .NET 8006
./docker-run.sh start
```

The full payment flow needs a real browser: card entry and 3-D Secure happen inside the GP-hosted iframe. Webhooks only arrive if `BASE_URL` points at a public tunnel.

## How to Verify

```bash
curl -X POST http://localhost:8000/create-hpp-link -H "Content-Type: application/json" \
  -d '{"amount":"10.00","currency":"USD","displayMethod":"iframe","config":{"threeds":true}}'
# Expected: {"success":true,"id":"LNK_...","url":"https://...","reference":"order-...","apiCalls":[...]}

curl "http://localhost:8000/payment-status?reference=order-123"
# Expected before payment: {"success":true,"outcome":"pending","status":"PENDING"}

curl -X POST http://localhost:8000/webhook -H "Content-Type: application/json" \
  -d '{"id":"TRN_test","type":"TRANSACTION_PREAUTHORIZED"}'
# Expected: OK   (.NET returns "OK" as a JSON string)
curl http://localhost:8000/webhook-events
# Expected: [{"receivedAt":"...","id":"TRN_test","type":"TRANSACTION_PREAUTHORIZED"}]

# Root devDependency is @playwright/test 1.53.1; the card harness imports playwright's chromium
./docker-run.sh test                    # Playwright parity suite against all five
npm run verify:cards:repr               # about 12 cards through the real hosted page
```

## Making Changes

All five implementations expose identical behavior and the Playwright suite checks parity. A change to one must be applied to all, each language in a separate commit. The five `index.html` copies are byte-identical; change them together. Do not modify shared files (`run.sh`, `docker-compose.yml`, `docker-run.sh`, `playwright.config.js`, `tests/`) without confirming the change applies to every implementation. There is no Go implementation (host port 8005 is intentionally unused); do not add one without explicit instruction.

## SDK Versions

No Global Payments SDK is declared in any dependency file (`package.json`, `requirements.txt`, `composer.json`, `pom.xml`, `dotnet.csproj`). All five call `https://apis.sandbox.globalpay.com/ucp` directly with API version `2021-03-22`.
