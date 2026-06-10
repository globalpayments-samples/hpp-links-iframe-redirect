# Global Payments Drop-In UI – Iframe Succession Sample

Demonstrates the full GP API Drop-In UI payment lifecycle across five backend frameworks. Each implementation shows **iframe succession** — card entry, 3DS challenge, and the result all handled inside a single iframe with no parent-page redirect.

## Available Implementations

- [.NET Core](./dotnet/) - ASP.NET Core minimal API
- [Java](./java/) - Jakarta EE / Tomcat
- [Node.js](./nodejs/) - Express.js
- [PHP](./php/) - PHP built-in server
- [Python](./python/) - Flask

## How It Works

```
Browser                          Backend                       GP API
  |                                 |                             |
  |-- GET /access-token ----------->|                             |
  |                                 |-- POST /ucp/accesstoken --->|
  |<-- { token } -------------------|<-- { token } ---------------|
  |                                 |                             |
  | GlobalPayments.configure(token) |                             |
  | creditCard.form() mounts iframe |                             |
  | User enters card in iframe      |                             |
  | (3DS challenge in same iframe)  |                             |
  |<-- token-success { paymentReference }                         |
  |                                 |                             |
  |-- POST /process-payment ------->|                             |
  |   { paymentReference, amount }  |-- POST /ucp/transactions -->|
  |                                 |<-- { id, status, ... } -----|
  |<-- { transactionId, status } ---|                             |
```

## Endpoints (identical across all frameworks)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/access-token` | Issues a `PMT_POST_Create_Single`-scoped token for the Drop-In UI |
| `POST` | `/process-payment` | Charges the single-use `paymentReference` returned by the Drop-In UI |
| `POST` | `/webhook` | Receives GP API transaction notifications |
| `GET` | `/webhook-events` | Returns last 20 webhook events for the live UI log |

## Quick Start

### 1. Set up credentials

Copy the `.env.sample` in your chosen framework directory to `.env` and fill in your GP API sandbox credentials:

```
GP_APP_ID=your_app_id
GP_APP_KEY=your_app_key
GP_MERCHANT_ID=your_merchant_id
GP_ACCOUNT_NAME=transaction_processing
```

### 2. Run a framework

```bash
cd nodejs    # or python / php / java / dotnet
./run.sh
```

Open `http://localhost:8000` in your browser.

### 3. Test a payment

Use the sandbox test card on the Payment Form tab:

```
Card number : 4263970000005262
Expiry      : any future date
CVV         : any 3 digits
```

## Docker

Run all five frameworks simultaneously:

```bash
cp nodejs/.env.sample .env   # fill in your credentials
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

- A GP API sandbox account — [developer.globalpayments.com](https://developer.globalpayments.com)
- The runtime for your chosen language (Node 18+, Python 3.9+, PHP 8+, Java 17+, .NET 8+)
