# Node.js (Express) — GP API Hosted Payment Page

Express implementation of the GP API Hosted Payment Page (HPP) sample. Exposes the
same four endpoints as the other frameworks and serves the shared HPP `index.html`.

Calls the GP REST API directly with the built-in `fetch` (no SDK): it mints a token,
creates a `HOSTED_PAYMENT_PAGE` link via the Links API, and reads the result back. The
App Key never reaches the browser.

## Requirements

- Node.js 18 or later (uses the built-in `fetch`)
- A GP API sandbox account with an HPP/links-enabled app — [developer.globalpayments.com](https://developer.globalpayments.com)

## Project Structure

- `server.js` — Express server: the four HPP endpoints (raw REST to the GP API)
- `index.html` — shared Hosted Payment Page frontend
- `package.json` — dependencies (`express`, `dotenv`)
- `.env.sample` — template for environment variables
- `run.sh` — installs dependencies and starts the server

## Setup

1. Copy `.env.sample` to `.env` (ships with working HPP sandbox credentials):
   ```
   GP_APP_ID=your_app_id
   GP_APP_KEY=your_app_key
   GP_MERCHANT_ID=your_merchant_id
   GP_ACCOUNT_NAME=transaction_processing_hpp
   ```
2. Run the application:
   ```bash
   ./run.sh        # runs: npm install && npm start
   ```
   Open http://localhost:8000.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/create-hpp-link` | Creates a `HOSTED_PAYMENT_PAGE` link; returns its hosted `url` + `reference` |
| `GET` | `/payment-status` | Returns the outcome (`success` / `declined` / `pending`) for a `reference` |
| `POST` | `/webhook` | Receives GP API notifications (the link's `status_url`) |
| `GET` | `/webhook-events` | Returns the last 20 webhook events for the live UI log |

## Test card (sandbox)

```
Card number : 4263970000005262
Expiry      : any future date
CVV         : any 3 digits
```

3-D Secure 2 runs automatically on the hosted page; a successful sale settles `PREAUTHORIZED`.

## Production considerations

- Verify the `X-GP-Signature` HMAC on incoming webhooks (see the commented block in `server.js`).
- Set `BASE_URL` to your public origin so the link's `status_url` reaches `/webhook`.
- Serve over HTTPS and add input validation, rate limiting, and structured logging.
