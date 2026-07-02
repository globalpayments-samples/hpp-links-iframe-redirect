# Python (Flask) — GP API Hosted Payment Page

Flask implementation of the GP API Hosted Payment Page (HPP) sample. Exposes the same
four endpoints as the other frameworks and serves the shared HPP `index.html`.

Like all five frameworks, it talks to the GP API REST endpoints directly with
`requests` (no SDK): it mints a token, creates a `HOSTED_PAYMENT_PAGE` link via the
Links API, and reads the result back. The App Key never reaches the browser.

## Requirements

- Python 3.9 or later
- A GP API sandbox account with an HPP/links-enabled app — [developer.globalpayments.com](https://developer.globalpayments.com)

## Project Structure

- `server.py` — Flask server: the four HPP endpoints (raw REST to the GP API)
- `index.html` — shared Hosted Payment Page frontend
- `requirements.txt` — dependencies (Flask, requests, gunicorn, python-dotenv)
- `.env.sample` — template for environment variables
- `run.sh` — convenience script to create a venv, install deps, and run

## Setup

1. Copy `.env.sample` to `.env` (ships with working HPP sandbox credentials):
   ```
   GP_APP_ID=your_app_id
   GP_APP_KEY=your_app_key
   GP_MERCHANT_ID=your_merchant_id
   GP_ACCOUNT_NAME=transaction_processing_hpp
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

- Verify the `X-GP-Signature` HMAC on incoming webhooks (see the commented block in `server.py`).
- Set `BASE_URL` to your public origin so the link's `status_url` reaches `/webhook`.
- Run behind the bundled `gunicorn` rather than Flask's dev server.
- Serve over HTTPS and add input validation, rate limiting, and structured logging.
