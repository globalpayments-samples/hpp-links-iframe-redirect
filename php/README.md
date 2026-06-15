# PHP — GP API Drop-In UI

PHP implementation of the GP API Drop-In UI iframe-succession sample, running on
PHP's built-in web server. Exposes the same four endpoints as the other
frameworks and serves the shared Drop-In UI `index.html`.

Charges go through the official **`globalpayments/php-sdk`**; the access token is
minted with a direct call to the GP API `accesstoken` endpoint so the App Key
never reaches the browser.

## Requirements

- PHP 8.0 or later (with cURL)
- [Composer](https://getcomposer.org/)
- A GP API sandbox account — [developer.globalpayments.com](https://developer.globalpayments.com)

## Project Structure

- `access-token.php` — `GET /access-token`
- `process-payment.php` — `POST /process-payment` (charges via the SDK)
- `webhook.php` — `POST /webhook` (appends to `webhook-log.json`)
- `webhook-events.php` — `GET /webhook-events`
- `router.php` — front controller that routes requests for the built-in server
- `index.html` — shared Drop-In UI frontend
- `composer.json` — dependencies (`globalpayments/php-sdk`, `vlucas/phpdotenv`)
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
   ./run.sh        # runs: composer install && php -S 0.0.0.0:8000 router.php
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

- Verify the `X-GP-Signature` HMAC on incoming webhooks (see the commented block in `webhook.php`).
- The built-in server is for local/sample use only — deploy behind a real web server (nginx/Apache + PHP-FPM).
- Serve over HTTPS and add input validation, rate limiting, and structured logging.
