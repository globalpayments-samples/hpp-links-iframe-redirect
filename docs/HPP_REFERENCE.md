# GP API Hosted Payment Page — Implementation Reference

The authoritative, **live-verified** reference for the GP API Hosted Payment Page (HPP)
flow this repo implements. Everything below was captured by driving the official demo at
`https://demo.globalpay.com/merchants/hosted-payment-page` with Playwright and by probing
the live GP sandbox directly. When changing the integration, trust this over guesswork —
and re-probe the live API (its errors name missing fields precisely).

Constants: `GP_BASE = https://apis.sandbox.globalpay.com/ucp`, header
`X-GP-Version: 2021-03-22`.

---

## 1. Architecture (what the demo does, and what we replicate)

```
Browser                         Merchant server                     GP API
  | Proceed to Payment              |                                  |
  |-- POST /create-hpp-link ------->|                                  |
  |   {amount, displayMethod,       |-- POST /ucp/accesstoken -------->|  (full-scope token)
  |    config:{…}}                  |<-- {token} ----------------------|
  |                                 |-- POST /ucp/links -------------->|  type=HOSTED_PAYMENT_PAGE
  |<-- {id:LNK_…, url, reference} --|<-- {id, url:…/hpp/redirect/guid}-|
  |                                 |                                  |
  | iframe.src = url  (iframe mode, or a full-bleed in-page overlay for redirect) |
  |        └─ 302 → pay.sandbox.realexpayments.com/hosted-payments/blue/card.html?guid=…
  |           (GP-hosted: card entry + 3-D Secure 2 + wallets/DCC/APMs)
  |                                 |                                  |
  |-- GET /payment-status?reference= (polled) ---------------------->  |
  |                                 |-- GET /ucp/transactions?reference|
  |<-- {outcome, status, txnId} ----|<-- {transactions:[{status}]} ----|
```

- **Drop-In UI (old) vs HPP (now):** Drop-In embedded tokenizing card iframes on the
  merchant page and the backend charged a `paymentReference`. HPP puts the **entire**
  payment UI on a GP-hosted page; the merchant only creates a link and reads the result.
- **Display method:** `iframe` embeds `url` in an inline `<iframe>`; `redirect` goes
  **full-bleed in the same tab** — a fixed overlay embeds the hosted page edge-to-edge and
  then renders the result on that same surface. Both 302 to the same Realex "blue" hosted
  page, and in **both** modes the merchant page stays alive and polls `/payment-status`. A
  HOSTED_PAYMENT_PAGE link does **not** redirect the browser back to `return_url` (verified
  live — see §5), so `redirect` must not do a real same-tab `window.location` navigation
  (it would strand the customer on GP's blank result page) nor a `window.open` popup; the
  full-bleed overlay keeps a context that can poll the outcome and show it without leaving.
- **No SDKs:** all five backends call the REST API directly. The `HOSTED_PAYMENT_PAGE`
  link type isn't uniformly exposed by the SDKs, and the SDKs caused routing gotchas.

---

## 2. Credentials

HPP-enabled sandbox app (the GP Postman-collection default; **do not modify its config**):

| Field | Value |
|-------|-------|
| `GP_APP_ID` | `T6og1tbECpHFeO104qUM383oq5bOJ12r` |
| `GP_APP_KEY` | `l9JAqlUf0MfxQHP8` |
| `GP_MERCHANT_ID` | `MER_c5d37eaf0e3841e083c232b2318af55c` (documented, **not** sent in requests) |
| `GP_ACCOUNT_NAME` | `transaction_processing_hpp` |

The app's `transaction_processing_hpp` account carries `LNK_POST_Create`, `LNK_PATCH_Edit`,
`LNK_POST_Expire`, `LNK_GET_List`, `LNK_GET_Single`. A plain `transaction_processing`
account (no `LNK_*`) returns **`403 ACTION_NOT_AUTHORIZED (40212)`** on `/ucp/links`.

---

## 3. Step 1 — Access token

`POST {GP_BASE}/accesstoken` with **no `permissions`** array, so the token carries the
app's full scope (including `LNK_POST_Create`).

```jsonc
// request body
{
  "app_id": "<GP_APP_ID>",
  "nonce": "<unique, e.g. ISO timestamp>",
  "secret": "<sha512(nonce + GP_APP_KEY)>",   // hex
  "grant_type": "client_credentials"
}
// → 200 { "token": "<bearer>", "scope": { "accounts": [...] }, ... }
```

---

## 4. Step 2 — Create the HOSTED_PAYMENT_PAGE link

`POST {GP_BASE}/links` with `Authorization: Bearer <token>`.

**Three required fields are non-obvious** (discovered by iterating the live errors):
`reference` (top level), `order.amount`, and `payer.email`. Amounts are **minor units**
(cents): `"20000"` = $200.00.

```jsonc
{
  "account_name": "transaction_processing_hpp",
  "type": "HOSTED_PAYMENT_PAGE",
  "usage_mode": "SINGLE",
  "usage_limit": "1",
  "reference": "order-1782140415777",          // REQUIRED (top level)
  "name": "HPP Demo Transaction",
  "description": "Hosted Payment Page transaction from the GP API sample",
  "expiration_date": "2026-06-23T15:00:16.309Z",
  "order": {
    "amount": "20000",                          // REQUIRED, minor units
    "currency": "USD",
    "reference": "order-1782140415777",
    "transaction_configuration": { "country": "US", "channel": "CNP" }
  },
  "transactions": {
    "amount": "20000",
    "channel": "CNP",
    "country": "US",
    "currency": "USD",
    "allowed_payment_methods": ["CARD"]
  },
  "payer": { "email": "sandbox.payer@example.com", "name": "Sandbox Payer" },  // email REQUIRED
  "notifications": {
    "return_url": "<BASE_URL>/?reference=order-1782140415777",   // redirect-mode return
    "status_url": "<BASE_URL>/webhook"                           // webhook delivery
  }
}
```

Success response (trimmed):

```jsonc
{
  "id": "LNK_xRdbZcQBQ96JL5UIoqmn2mYx3PHtUh",
  "account_name": "transaction_processing_hpp",
  "url": "https://apis.sandbox.globalpay.com/ucp/hpp/redirect/cb28ef61-…",  // load this
  "status": "ACTIVE",
  "type": "HOSTED_PAYMENT_PAGE",
  "order": { "amount": "20000", "currency": "USD", "transaction_configuration": { "country": "US", "channel": "CNP" } },
  "transactions": { "transaction_list": [ { "id": "TRN_…", "status": "INITIATED", "type": "" } ] },
  "action": { "type": "LINK_CREATE", "result_code": "SUCCESS" }
}
```

### Error fingerprints (use to debug 4xx/5xx)
| Code | Meaning | Fix |
|------|---------|-----|
| `40005 MANDATORY_DATA_MISSING … field reference` | missing top-level `reference` | add it |
| `40005 … field order.amount` | missing `order.amount` | add it |
| `50012 … HPP_CUSTOMER_EMAIL not present` | missing `payer.email` | add `payer.email` |
| `40212 ACTION_NOT_AUTHORIZED` | account lacks `LNK_POST_Create` | use `transaction_processing_hpp` |
| `50001 SYSTEM_ERROR` | malformed/incomplete body | add the missing required fields above |

GP error fields are `error_code` / `detailed_error_description` (not `detail`).

### Value-add toggles (map into `order`, verified live)
The frontend `config` flags map into the link request as below. **GP does not echo them
back**, and their **visible** effect (wallet/APM buttons, iframe auto-resize) depends on
**account provisioning** this shared sandbox lacks. Unknown fields are accepted (ignored),
not rejected. All combinations below return `200` live (USD/EUR/GBP/CAD).
- `apms: string[]` → appended to `order.transaction_configuration.allowed_payment_methods`
  after the mandatory `"CARD"`, e.g. `["CARD","testpay","paybybankapp","paysafecard","sepapm","bitpay"]`.
  ⚠️ **`allowed_payment_methods` must be present** (≥ `["CARD"]`) — omitting it returns
  `40041 INVALID_REQUEST_DATA "Merchant configuration does not exist … payment_method - NULL"`.
  APM strings are currency/region-specific (see GP's payment-methods list).
- `dcc` → `order.transaction_configuration.currency_conversion_mode` = `"YES"` / `"NO"`.
- `threeds` → `order.payment_method_configuration.authentication.preference` =
  `"CHALLENGE_PREFERRED"` / `"NO_CHALLENGE_REQUESTED"` (3-D Secure runs regardless).
- `digitalWallets` → `order.payment_method_configuration.digital_wallets.provider`
  = `["googlepay","applepay"]`.
- `cardStorage` → `order.transaction_configuration.enable_card_storage` (best-effort).

Always also send `order.transaction_configuration.capture_mode: "AUTO"` and a `country`
derived from the currency (USD→US, EUR→IE, GBP→GB, CAD→CA). `allowed_payment_methods`
lives under **`order.transaction_configuration`**, not under `transactions`.

The backend captures the token + link request/response (bearer token redacted) and returns
them as `apiCalls` for the **API Explorer** tab.

---

## 5. Step 3 — Render the hosted page

Load `url` in an inline iframe (`displayMethod=iframe`) or in a **full-bleed in-page
overlay** (`redirect`). It 302s to the Realex "blue" hosted page:
`https://pay.sandbox.realexpayments.com/hosted-payments/blue/card.html?guid=<guid>`.

⚠️ **A HOSTED_PAYMENT_PAGE link does not redirect the browser back to `return_url`, and
its result page is blank on this sandbox.** Verified live by driving the full card + 3-D
Secure flow: after payment the hosted page lands on `…/blue/result.html?guid=…` and **stops
there** — `result.html` renders with body height ~10px, empty text and an empty
`data-auth-result`, and performs no navigation (identical whether `return_url` is
`http://localhost` or a valid public `https://` origin, so it is not a URL-validity issue).
Consequently `redirect` must not do a real same-tab `window.location` navigation (it would
strand the customer on that blank page), nor a `window.open` popup. The sample loads the
hosted page **full-bleed in the same tab** and keeps polling `/payment-status`, then renders
the outcome on that same full-screen surface — so the result shows "on the page the HPP
loaded in" without a round trip to the orchestration view. `return_url` / `status_url` are
still sent (harmless; `status_url` still drives webhooks). `handleReturn()` also resolves
the outcome onto the in-page panel if a provisioned account *does* redirect back.

### Iframe auto-resize + result posting (the Realex `HPP_POST_*` protocol)
The hosted page can post to its embedding parent — **resize** messages (auto-grow the
iframe for wallets/APMs) and the **transaction response** — but only when the request
carries `HPP_POST_DIMENSIONS` / `HPP_POST_RESPONSE` set to the parent origin (see
`globalpayments/rxp-js` `dist/rxp-js.js`: `createForm`, `receiveMessage`). A resize message
is **base64-encoded JSON** of the form `{ iframe: { width:"…px", height:"…px" } }`. The
sample listens for it (`window` `message` handler, origin-checked, base64-decoded) and sets
the iframe height; a non-`iframe` payload is the response. **Verified live (2026-06-24):**
the GP API `/ucp/links` request does not expose `HPP_POST_DIMENSIONS`/`HPP_POST_RESPONSE`
on the shared sandbox, and URL params are ignored (the 302 strips them) — so this sandbox's
hosted page posts **nothing**, wallets/APMs don't render, and the iframe keeps its default
height. The listener is correct for a provisioned account but is not exercisable here.

**Hosted-page selectors** (for browser automation):

| Field | Selector |
|-------|----------|
| Card number | `#pas_ccnum` |
| Expiry (MM/YY) | `#pas_expiry` |
| Security code | `#pas_cccvc` |
| Cardholder name | `#pas_ccname` |
| Submit | `#rxp-primary-btn` |

⚠️ **Wait ~3 s after the fields appear before filling.** The hosted page attaches its own
formatting/validation asynchronously; filling too early silently clears the values and
submit reports "Card Number is required". 3-D Secure 2 then runs automatically (routes via
`test.portal.gpwebpay.com/pay-sim/sim/acs` + `…/3ds2/methodNotify`) and lands on
`result.html`.

---

## 6. Step 4 — Read the outcome

Poll `GET {GP_BASE}/transactions?reference=<reference>` (or `GET {GP_BASE}/links/{id}` →
`transactions.transaction_list[]`).

```jsonc
// GET /ucp/transactions?reference=order-… → 200
{ "transactions": [ {
    "id": "TRN_…",
    "status": "PREAUTHORIZED",                 // success state for a 3DS hosted sale
    "type": "SALE",
    "amount": "20000", "currency": "USD",
    "payment_method": { "card": { "brand": "VISA", "masked_number_last4": "5262" } }
} ] }
```

**Status → outcome mapping** (in `/payment-status`):
- success: `PREAUTHORIZED`, `CAPTURED`, `SUCCESS`  ← a successful 3DS hosted sale is **PREAUTHORIZED, not CAPTURED**
- declined: `DECLINED`, `REJECTED`, `CANCELLED`
- pending: anything else, or no transaction recorded yet (customer still paying)

Before the customer finishes, `GET /transactions?reference=…` returns
`total_record_count: 0` → treat as **pending** and keep polling.

---

## 7. Webhooks

The link's `status_url` receives notifications as the payment progresses (needs a public
URL — set `BASE_URL` to a tunnel). The sample stores the last 20, flattened to
`{ receivedAt, type, id, … }`, and exposes them at `GET /webhook-events`. Signature
verification (HMAC-SHA256 over the raw body, `X-GP-Signature`) is stubbed with a
"verify in production" note in every backend.

---

## 8. Test card

`4263970000005262` · any future expiry · any 3-digit CVV · 3-D Secure 2 frictionless →
settles `PREAUTHORIZED`.

---

## 9. Faithfulness to the demo

| Demo feature | This sample |
|--------------|-------------|
| Create HOSTED_PAYMENT_PAGE link server-side | ✅ `/create-hpp-link` → `POST /ucp/links` |
| Display method: iframe **and** redirect | ✅ segmented toggle |
| Value adds: 3DS, card storage (+ user type), DCC, digital wallets, APMs (multi-select) | ✅ toggles + APM checklist → link request |
| Region / currency selection | ✅ currency select (USD/EUR/GBP/CAD) |
| Order summary + amount | ✅ order total + amount input |
| GP-hosted card entry + 3DS in iframe | ✅ Realex blue page in `#hosted-frame` |
| Result panel (success/decline) | ✅ polled via `/payment-status` |
| Redirect shows the result on the hosted surface | ✅ full-bleed overlay renders the outcome in-page |
| API Explorer: live token/link request+response timeline | ✅ **API Explorer** tab (from `apiCalls`) + webhook feed |
| Test-card helper | ✅ sandbox test-card hint |

Deliberately **not** replicated (demo-site chrome, not part of the payment flow): the
multi-merchant catalog, the guided walkthrough, and the analytics. The payment flow,
functionality, and architecture match.
