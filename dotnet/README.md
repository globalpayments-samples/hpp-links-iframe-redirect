# .NET (ASP.NET Core) — GP API Drop-In UI

ASP.NET Core minimal-API implementation of the GP API Drop-In UI iframe-succession
sample. Exposes the same four endpoints as the other frameworks and serves the
shared Drop-In UI `index.html` from `wwwroot/`.

Charges go through the official **`GlobalPayments.Api`** SDK; the access token is
minted with a direct call to the GP API `accesstoken` endpoint so the App Key
never reaches the browser.

## Requirements

- .NET SDK 9.0 or later
- A GP API sandbox account — [developer.globalpayments.com](https://developer.globalpayments.com)

## Project Structure

- `Program.cs` — minimal-API server: endpoints + GP API SDK configuration
- `wwwroot/index.html` — shared Drop-In UI frontend
- `dotnet.csproj` — dependencies (`GlobalPayments.Api`, `DotEnv.Net`)
- `.env.sample` — template for environment variables
- `run.sh` — restores packages and runs the server

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
   ./run.sh        # runs: dotnet restore && dotnet run
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

- Verify the `X-GP-Signature` HMAC on incoming webhooks (the `HmacSha256Hex` helper and a commented block in `Program.cs` show how).
- Serve over HTTPS and add input validation, rate limiting, and structured logging.
