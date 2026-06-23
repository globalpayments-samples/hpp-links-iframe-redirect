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
  | iframe.src = url  (or window.open(url) in a new tab for redirect) |
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
- **Display method:** `iframe` embeds `url` in an `<iframe>`; `redirect` opens `url` in a
  **separate browser tab** (`window.open`). Both 302 to the same Realex "blue" hosted page,
  and in **both** modes the merchant page stays alive and polls `/payment-status`. A
  HOSTED_PAYMENT_PAGE link does **not** redirect the browser back to `return_url` (verified
  live — see §5), so a full same-tab `window.location` navigation would strand the customer
  on GP's blank result page; the new-tab approach keeps a context that can poll the outcome.
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

### Value-add toggles (best-effort)
The frontend `config` flags map into the link request, but **GP does not echo them back**
and their visible effect depends on **account provisioning**. Unknown fields are accepted
(ignored), not rejected. 3-D Secure runs automatically regardless of the toggle.
- `dcc` → `order.transaction_configuration.allow_dynamic_currency_conversion`
- `cardStorage` → `order.transaction_configuration.enable_card_storage`
- `digitalWallets` → adds `DIGITAL_WALLET` to `transactions.allowed_payment_methods`
- `apm` → adds `PAYPAL` to `transactions.allowed_payment_methods`

---

## 5. Step 3 — Render the hosted page

Load `url` in an iframe (`displayMethod=iframe`) or open it in a new tab with
`window.open(url)` (`redirect`). It 302s to the Realex "blue" hosted page:
`https://pay.sandbox.realexpayments.com/hosted-payments/blue/card.html?guid=<guid>`.

⚠️ **A HOSTED_PAYMENT_PAGE link does not redirect the browser back to `return_url`.**
Verified live by driving the full card + 3-D Secure flow: after payment the hosted page
lands on `…/blue/result.html?guid=…` and **stops there** — the result page renders with an
empty `data-auth-result` and performs no navigation (identical behaviour whether
`return_url` is `http://localhost` or a valid public `https://` origin, so it is not a
URL-validity issue). The redirect-back appears to depend on account-level merchant-response
provisioning that this shared sandbox app does not carry. Consequently **`redirect` mode
must not do a full same-tab `window.location` navigation** (it would strand the customer on
that blank result page). The sample opens the hosted page in a separate tab and keeps the
merchant page polling `/payment-status` — the same outcome source the iframe flow uses.
`return_url` / `status_url` are still sent (harmless; `status_url` still drives webhooks).

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
| Value adds: 3DS, card storage (+ user type), DCC, digital wallets, APMs | ✅ toggles → link request |
| Region / currency selection | ✅ currency select (USD/EUR/GBP/CAD) |
| Order summary + amount | ✅ order total + amount input |
| GP-hosted card entry + 3DS in iframe | ✅ Realex blue page in `#hosted-frame` |
| Result panel (success/decline) | ✅ polled via `/payment-status` |
| Test-card helper | ✅ sandbox test-card hint |

Deliberately **not** replicated (demo-site chrome, not part of the payment flow): the
multi-merchant catalog, the API Explorer side panel, the guided walkthrough, and the
analytics. The payment flow, functionality, and architecture match.
