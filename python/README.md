# Python (Flask) — GP API Drop-In UI

Flask implementation of the GP API Drop-In UI iframe-succession sample. Exposes
the same four endpoints as the other frameworks and serves the shared Drop-In UI
`index.html`.

## Why no SDK (unlike the other frameworks)

The Node, PHP, Java, and .NET samples charge through the official Global Payments
server SDK. **There is no official Global Payments server SDK for Python**, so
this implementation talks to the GP API REST endpoints directly with `requests`:

- `POST /ucp/accesstoken` — obtain an access token
- `POST /ucp/transactions` — charge the single-use payment reference

This is the correct approach for Python, not a workaround — the behaviour and the
HTTP contract exposed to the frontend are identical to the SDK-based frameworks.

## Requirements

- Python 3.9 or later
- A GP API sandbox account — [developer.globalpayments.com](https://developer.globalpayments.com)

## Project Structure

- `server.py` — Flask server: endpoints + GP API REST calls
- `index.html` — shared Drop-In UI frontend
- `requirements.txt` — dependencies (Flask, requests, gunicorn, python-dotenv)
- `.env.sample` — template for environment variables
- `run.sh` — convenience script to create a venv, install deps, and run

## Setup

1. Copy `.env.sample` to `.env` and fill in your GP API sandbox credentials:
   ```
   GP_APP_ID=your_app_id
   GP_APP_KEY=your_app_key
   GP_MERCHANT_ID=your_merchant_id
   GP_ACCOUNT_NAME=transaction_processing
   ```
2. Create and activate a virtual environment (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate   # Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the application:
   ```bash
   ./run.sh        # or: python server.py
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

- Verify the `X-GP-Signature` HMAC on incoming webhooks (see the commented block in `server.py`).
- Run behind the bundled `gunicorn` rather than Flask's dev server.
- Serve over HTTPS and add input validation, rate limiting, and structured logging.
