/**
 * Global Payments – Drop-In UI Sample (.NET / ASP.NET Core)
 *
 * Endpoints:
 *   GET  /access-token     — generate a limited-scope frontend token for Drop-In UI
 *   POST /process-payment  — charge a single-use token returned by the Drop-In UI
 *   POST /webhook          — receive GP API transaction notifications
 *   GET  /webhook-events   — tail recent webhook events (for the live UI log)
 */

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using dotenv.net;
using GlobalPayments.Api;
using GlobalPayments.Api.Entities;
using GlobalPayments.Api.PaymentMethods;
using GpEnvironment = GlobalPayments.Api.Entities.Environment;

namespace DropInUISample;

public class Program
{
    // In-memory ring-buffer for the live webhook event log (last 20 notifications)
    private static readonly ConcurrentQueue<object> WebhookEvents = new();

    public static void Main(string[] args)
    {
        DotEnv.Load();

        var builder = WebApplication.CreateBuilder(args);
        var app     = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();

        ConfigureGpApiSdk();
        MapEndpoints(app);

        var port = System.Environment.GetEnvironmentVariable("PORT") ?? "8000";
        app.Urls.Add($"http://0.0.0.0:{port}");
        app.Run();
    }

    // ─── GP API SDK configuration ─────────────────────────────────────────────
    private static void ConfigureGpApiSdk()
    {
        ServicesContainer.ConfigureService(new GpApiConfig
        {
            AppId       = Env("GP_APP_ID"),
            AppKey      = Env("GP_APP_KEY"),
            Channel     = Channel.CardNotPresent,
            Environment = GpEnvironment.TEST,
            MerchantId  = Env("GP_MERCHANT_ID"),
            AccessTokenInfo = new AccessTokenInfo
            {
                TransactionProcessingAccountName = Env("GP_ACCOUNT_NAME")
            }
        });
    }

    // ─── Endpoints ────────────────────────────────────────────────────────────
    private static void MapEndpoints(WebApplication app)
    {
        // GET /access-token
        // Returns a short-lived, PMT_POST_Create_Single-scoped token for the frontend.
        app.MapGet("/access-token", async () =>
        {
            var appId  = Env("GP_APP_ID");
            var appKey = Env("GP_APP_KEY");
            var nonce  = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
            var secret = Sha512Hex(nonce + appKey);

            var body = JsonSerializer.Serialize(new
            {
                app_id      = appId,
                nonce,
                secret,
                grant_type  = "client_credentials",
                permissions = new[] { "PMT_POST_Create_Single" }
            });

            using var handler = new HttpClientHandler
            {
                AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate
            };
            using var http = new HttpClient(handler);
            http.DefaultRequestHeaders.Add("X-GP-Version", "2021-03-22");

            var gpRes  = await http.PostAsync(
                "https://apis.sandbox.globalpay.com/ucp/accesstoken",
                new StringContent(body, Encoding.UTF8, "application/json"));

            var json = await gpRes.Content.ReadAsStringAsync();

            if (!gpRes.IsSuccessStatusCode)
                return Results.Problem("Failed to obtain access token from GP API");

            var data  = JsonSerializer.Deserialize<JsonElement>(json);
            var token = data.GetProperty("token").GetString();

            return Results.Ok(new { token, env = "sandbox" });
        });

        // POST /process-payment
        // Charges the single-use paymentReference returned by the Drop-In UI.
        app.MapPost("/process-payment", async (HttpContext ctx) =>
        {
            JsonElement body;
            try
            {
                body = await JsonSerializer.DeserializeAsync<JsonElement>(ctx.Request.Body);
            }
            catch
            {
                return Results.BadRequest(new { success = false, error = "Invalid JSON body" });
            }

            var paymentRef = body.TryGetProperty("payment_reference", out var pr)
                ? pr.GetString() : null;

            if (!body.TryGetProperty("amount", out var amtEl) ||
                !decimal.TryParse(amtEl.GetString(), out var amount) || amount <= 0)
                return Results.BadRequest(new { success = false, error = "A positive amount is required" });

            if (string.IsNullOrWhiteSpace(paymentRef))
                return Results.BadRequest(new { success = false, error = "payment_reference is required" });

            try
            {
                var card = new CreditCardData { Token = paymentRef };

                var result = card.Charge(amount)
                    .WithCurrency("USD")
                    .WithOrderId($"ORD-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}")
                    .Execute();

                return Results.Ok(new
                {
                    success       = true,
                    transactionId = result.TransactionId,
                    amount,
                    status        = result.ResponseMessage,
                    cardDetails   = new { brand = result.CardType, maskedNumber = result.CardLast4 }
                });
            }
            catch (ApiException ex)
            {
                return Results.BadRequest(new { success = false, error = ex.Message });
            }
        });

        // POST /webhook
        // Receives GP API notifications. Verify X-GP-Signature in production.
        app.MapPost("/webhook", async (HttpContext ctx) =>
        {
            using var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8);
            var payload      = await reader.ReadToEndAsync();

            /*
            // Production: verify signature
            var sig      = ctx.Request.Headers["X-GP-Signature"].ToString();
            var expected = HmacSha256Hex(payload, Env("GP_WEBHOOK_SECRET"));
            if (sig != expected) return Results.Unauthorized();
            */

            try
            {
                var evt = JsonSerializer.Deserialize<JsonElement>(payload);
                WebhookEvents.Enqueue(new { receivedAt = DateTime.UtcNow.ToString("o"), raw = evt });
                while (WebhookEvents.Count > 20) WebhookEvents.TryDequeue(out _);
                var evtType = evt.TryGetProperty("type", out var t) ? t.ToString() : "?";
                Console.WriteLine($"[Webhook] type={evtType}");
                return Results.Ok("OK");
            }
            catch
            {
                return Results.BadRequest("Invalid JSON payload");
            }
        });

        // GET /webhook-events
        // Returns the in-memory event ring for the live UI log.
        app.MapGet("/webhook-events", () =>
            Results.Ok(WebhookEvents.ToArray()));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    private static string Env(string key) =>
        System.Environment.GetEnvironmentVariable(key) ?? string.Empty;

    private static string Sha512Hex(string input)
    {
        var bytes = SHA512.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLower();
    }

    // Kept for production signature verification reference
    private static string HmacSha256Hex(string payload, string secret)
    {
        var key   = Encoding.UTF8.GetBytes(secret);
        var data  = Encoding.UTF8.GetBytes(payload);
        var bytes = HMACSHA256.HashData(key, data);
        return Convert.ToHexString(bytes).ToLower();
    }
}
