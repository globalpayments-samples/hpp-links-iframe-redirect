# PHP — GP API Hosted Payment Page

PHP implementation of the GP API Hosted Payment Page (HPP) sample, running on PHP's
built-in web server. Exposes the same four endpoints as the other frameworks and serves
the shared HPP `index.html`.

Calls the GP REST API directly with cURL (no SDK): it mints a token, creates a
`HOSTED_PAYMENT_PAGE` link via the Links API, and reads the result back. The App Key
never reaches the browser.

## Requirements

- PHP 8.0 or later (with cURL)
- [Composer](https://getcomposer.org/)
- A GP API sandbox account with an HPP/links-enabled app — [developer.globalpayments.com](https://developer.globalpayments.com)

## Project Structure

- `create-hpp-link.php` — `POST /create-hpp-link` (creates a HOSTED_PAYMENT_PAGE link)
- `payment-status.php` — `GET /payment-status` (reads the transaction outcome)
- `gp.php` — shared helpers: token minting, REST wrapper, status classification
- `webhook.php` — `POST /webhook` (appends to `webhook-log.json`)
- `webhook-events.php` — `GET /webhook-events`
- `router.php` — front controller that routes requests for the built-in server
- `index.html` — shared Hosted Payment Page frontend
- `composer.json` — dependency (`vlucas/phpdotenv`)
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
   ./run.sh        # runs: composer install && php -S 0.0.0.0:8000 router.php
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

- Verify the `X-GP-Signature` HMAC on incoming webhooks (see the commented block in `webhook.php`).
- Set `BASE_URL` to your public origin so the link's `status_url` reaches `/webhook`.
- The built-in server is for local/sample use only — deploy behind a real web server (nginx/Apache + PHP-FPM).
- Serve over HTTPS and add input validation, rate limiting, and structured logging.
