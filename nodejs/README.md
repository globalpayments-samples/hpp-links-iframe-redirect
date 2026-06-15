# Node.js (Express) — GP API Drop-In UI

Express implementation of the GP API Drop-In UI iframe-succession sample. Exposes
the same four endpoints as the other frameworks and serves the shared Drop-In UI
`index.html`.

Charges go through the official **`globalpayments-api`** SDK; the access token is
minted with a direct call to the GP API `accesstoken` endpoint so the App Key
never reaches the browser.

## Requirements

- Node.js 18 or later (uses the built-in `fetch`)
- A GP API sandbox account — [developer.globalpayments.com](https://developer.globalpayments.com)

## Project Structure

- `server.js` — Express server: endpoints + GP API SDK configuration
- `index.html` — shared Drop-In UI frontend
- `package.json` — dependencies (`express`, `dotenv`, `globalpayments-api`)
- `.env.sample` — template for environment variables
- `run.sh` — installs dependencies and starts the server

## Setup

1. Copy `.env.sample` to `.env` and fill in your GP API sandbox credentials:
   ```
   GP_APP_ID=your_app_id
   GP_APP_KEY=your_app_key
   GP_MERCHANT_ID=your_merchant_id
   GP_ACCOUNT_NAME=transaction_processing
   ```
2. Run the application:
   ```bash
   ./run.sh        # runs: npm install && npm start
   ```
   Open http://localhost:8000.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/access-token` | Issues a `PMT_POST_Create_Single`-scoped token for the Drop-In UI |
| `POST` | `/process-payment` | Charges the single-use `payment_reference` from the Drop-In UI |
| `POST` | `/webhook` | Receives GP API transaction notifications |
| `GET` | `/webhook-events` | Returns the last 20 webhook events for the live UI log |

## Test card (sandbox)

```
Card number : 4263970000005262
Expiry      : any future date
CVV         : any 3 digits
```

## Production considerations

- Verify the `X-GP-Signature` HMAC on incoming webhooks (see the commented block in `server.js`).
- Serve over HTTPS and add input validation, rate limiting, and structured logging.
