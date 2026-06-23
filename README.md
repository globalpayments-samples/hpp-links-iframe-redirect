# Global Payments Hosted Payment Page (HPP) – GP API Sample

Demonstrates the full GP API **Hosted Payment Page** flow across five backend frameworks.
The merchant server creates a `HOSTED_PAYMENT_PAGE` link via the **Links API**; the
customer then enters their card, completes 3-D Secure, and pays on a
**Global-Payments-hosted page** — shown either in an **iframe** or via a full-page
**redirect**. Card data, 3DS, saved cards, digital wallets, DCC and APMs are all handled
on the hosted page, so **no card fields ever touch the merchant server or page**.

Replicates the demo at
[demo.globalpay.com/merchants/hosted-payment-page](https://demo.globalpay.com/merchants/hosted-payment-page).

## Available Implementations

- [.NET Core](./dotnet/) - ASP.NET Core minimal API
- [Java](./java/) - Jakarta EE / Tomcat
- [Node.js](./nodejs/) - Express.js
- [PHP](./php/) - PHP built-in server
- [Python](./python/) - Flask

All five call the GP REST API directly (no SDK) for an identical contract.

## How It Works

```
Browser                              Backend                        GP API
  |                                     |                              |
  |-- POST /create-hpp-link ----------->|                              |
  |   { amount, displayMethod, config } |-- POST /ucp/accesstoken ---->|
  |                                     |-- POST /ucp/links ---------->|  (type: HOSTED_PAYMENT_PAGE)
  |<-- { id:"LNK_…", url, reference } --|<-- { id, url } --------------|
  |                                     |                              |
  | load `url` in iframe (or redirect)  |                              |
  |  → GP-hosted page: card + 3-D Secure (raw card never hits backend) |
  |                                     |                              |
  |-- GET /payment-status?reference= -->|                              |
  |   (polled until terminal)           |-- GET /ucp/transactions ---->|
  |<-- { outcome, status, txnId, … } ---|<-- { status: PREAUTHORIZED }-|
```

## Endpoints (identical across all frameworks)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/create-hpp-link` | Creates a `HOSTED_PAYMENT_PAGE` link and returns its hosted `url` + `reference` |
| `GET` | `/payment-status` | Returns the outcome (`success` / `declined` / `pending`) for a `reference` |
| `POST` | `/webhook` | Receives GP API notifications (the link's `status_url`) |
| `GET` | `/webhook-events` | Returns last 20 webhook events for the live UI log |

## Quick Start

### 1. Set up credentials

Copy the `.env.sample` in your chosen framework directory to `.env`. It ships with working
HPP-enabled sandbox credentials:

```
GP_APP_ID=your_app_id
GP_APP_KEY=your_app_key
GP_MERCHANT_ID=your_merchant_id
GP_ACCOUNT_NAME=transaction_processing_hpp
# BASE_URL=https://your-tunnel.ngrok-free.app   # so the sandbox can reach /webhook
```

> The sample's app account (`transaction_processing_hpp`) is provisioned with
> `LNK_POST_Create`, which is required to create hosted payment links.

### 2. Run a framework

```bash
./run.sh            # nodejs on :8000 (default)
./run.sh python     # or python / php / java / dotnet
```

Open `http://localhost:8000` in your browser, configure the transaction, and click
**Proceed to Payment**.

### 3. Test a payment

On the GP-hosted page, use the sandbox test card:

```
Card number : 4263970000005262
Expiry      : any future date
CVV         : any 3 digits
```

3-D Secure 2 runs automatically and a successful sale settles as `PREAUTHORIZED`.

The sample is verified against the **full official Global Payments test-card suite** with an
automated harness — run `npm run verify:cards:repr` (smoke) or `npm run verify:cards` (full
matrix) against a running framework. See [`docs/TEST_CARDS.md`](docs/TEST_CARDS.md) for the
catalog, the expectation model, and the (important) note on why sandbox approvals are
non-deterministic.

## Docker

Run all five frameworks simultaneously:

```bash
cp nodejs/.env.sample .env   # HPP sandbox credentials are pre-populated
./docker-run.sh start
```

| Framework | URL |
|-----------|-----|
| Node.js   | http://localhost:8001 |
| Python    | http://localhost:8002 |
| PHP       | http://localhost:8003 |
| Java      | http://localhost:8004 |
| .NET      | http://localhost:8006 |

## Prerequisites

- A GP API sandbox account with an HPP/links-enabled app — [developer.globalpayments.com](https://developer.globalpayments.com)
- The runtime for your chosen language (Node 18+, Python 3.9+, PHP 8+, Java 17+, .NET 8+)
