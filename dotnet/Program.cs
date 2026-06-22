/**
 * Global Payments – Hosted Payment Page (HPP) Sample (.NET / ASP.NET Core)
 *
 * The merchant server creates a HOSTED_PAYMENT_PAGE link via the GP API Links API
 * and hands the browser a GP-hosted URL. Card entry, 3-D Secure and the result are
 * handled on the GP-hosted page — the raw card number never touches this server.
 *
 * Endpoints:
 *   POST /create-hpp-link  — create a HOSTED_PAYMENT_PAGE link; returns { id, url, reference }
 *   GET  /payment-status   — read the link/transaction outcome for the UI to poll
 *   POST /webhook          — receive GP API notifications (status_url)
 *   GET  /webhook-events   — tail recent webhook events (for the live UI log)
 *
 * Calls the GP API REST endpoints directly via HttpClient (no SDK) — the
 * HOSTED_PAYMENT_PAGE link type is not uniformly exposed by the language SDKs, so
 * all five framework samples standardise on raw REST for an identical contract.
 */

using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using dotenv.net;

namespace HostedPaymentSample;

public class Program
{
    private const string GpBase    = "https://apis.sandbox.globalpay.com/ucp";
    private const string GpVersion = "2021-03-22";

    // In-memory ring-buffer for the live webhook event log (last 20 notifications)
    private static readonly ConcurrentQueue<object> WebhookEvents = new();

    public static void Main(string[] args)
    {
        DotEnv.Load();

        var builder = WebApplication.CreateBuilder(args);
        var app     = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();

        MapEndpoints(app);

        var port = System.Environment.GetEnvironmentVariable("PORT") ?? "8000";
        app.Urls.Add($"http://0.0.0.0:{port}");
        app.Run();
    }

    private static void MapEndpoints(WebApplication app)
    {
        // ─── POST /create-hpp-link ────────────────────────────────────────────
        app.MapPost("/create-hpp-link", async (HttpContext ctx) =>
        {
            JsonElement body;
            try { body = await JsonSerializer.DeserializeAsync<JsonElement>(ctx.Request.Body); }
            catch { return Results.BadRequest(new { success = false, error = "Invalid JSON body" }); }

            if (!body.TryGetProperty("amount", out var amtEl) ||
                !decimal.TryParse(AsString(amtEl), NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) ||
                amount <= 0)
                return Results.BadRequest(new { success = false, error = "A positive amount is required" });

            var currency  = body.TryGetProperty("currency", out var c) ? c.GetString() ?? "USD" : "USD";
            var config    = body.TryGetProperty("config", out var cfg) ? cfg : default;
            var payer     = body.TryGetProperty("payer", out var p) ? p : default;
            var reference = $"order-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var minor     = decimal.Round(amount * 100, 0).ToString("0", CultureInfo.InvariantCulture);

            // Value-add toggles → transaction_configuration. 3-D Secure runs
            // automatically; wallet/APM availability is account-provisioned, so these
            // are best-effort hints (unknown fields are ignored by the API).
            var txnConfig = new Dictionary<string, object> { ["country"] = "US", ["channel"] = "CNP" };
            if (Flag(config, "dcc"))         txnConfig["allow_dynamic_currency_conversion"] = true;
            if (Flag(config, "cardStorage")) txnConfig["enable_card_storage"]               = true;

            var methods = new List<string> { "CARD" };
            if (Flag(config, "digitalWallets")) methods.Add("DIGITAL_WALLET");
            if (Flag(config, "apm"))            methods.Add("PAYPAL");

            var linkBody = new Dictionary<string, object?>
            {
                ["account_name"]    = Env("GP_ACCOUNT_NAME"),
                ["type"]            = "HOSTED_PAYMENT_PAGE",
                ["usage_mode"]      = "SINGLE",
                ["usage_limit"]     = "1",
                ["reference"]       = reference,
                ["name"]            = "HPP Demo Transaction",
                ["description"]     = "Hosted Payment Page transaction from the GP API sample",
                ["expiration_date"] = DateTime.UtcNow.AddHours(1).ToString("o"),
                ["order"] = new Dictionary<string, object?>
                {
                    ["amount"]    = minor,
                    ["currency"]  = currency,
                    ["reference"] = reference,
                    ["transaction_configuration"] = txnConfig
                },
                ["transactions"] = new Dictionary<string, object?>
                {
                    ["amount"]                  = minor,
                    ["channel"]                 = "CNP",
                    ["country"]                 = "US",
                    ["currency"]                = currency,
                    ["allowed_payment_methods"] = methods
                },
                ["payer"] = new Dictionary<string, object?>
                {
                    ["email"] = StringProp(payer, "email") ?? "sandbox.payer@example.com",
                    ["name"]  = StringProp(payer, "name")  ?? "Sandbox Payer"
                },
                ["notifications"] = new Dictionary<string, object?>
                {
                    ["return_url"] = $"{BaseUrl(ctx)}/?reference={reference}",
                    ["status_url"] = $"{BaseUrl(ctx)}/webhook"
                }
            };

            try
            {
                var token = await GetTokenAsync();
                using var http = NewHttpClient();
                http.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");
                http.DefaultRequestHeaders.Add("X-GP-Version", GpVersion);

                var gpRes = await http.PostAsync($"{GpBase}/links",
                    new StringContent(JsonSerializer.Serialize(linkBody), Encoding.UTF8, "application/json"));
                var data = JsonSerializer.Deserialize<JsonElement>(await gpRes.Content.ReadAsStringAsync());

                if (!gpRes.IsSuccessStatusCode || !data.TryGetProperty("id", out var idEl))
                    return Results.BadRequest(new { success = false, error = ErrorMessage(data, "Link creation failed") });

                return Results.Ok(new
                {
                    success   = true,
                    id        = idEl.GetString(),
                    url       = data.TryGetProperty("url", out var u) ? u.GetString() : null,
                    reference
                });
            }
            catch (Exception ex)
            {
                return Results.Json(new { success = false, error = ex.Message }, statusCode: 500);
            }
        });

        // ─── GET /payment-status ──────────────────────────────────────────────
        app.MapGet("/payment-status", async (HttpContext ctx) =>
        {
            var reference = ctx.Request.Query["reference"].ToString();
            if (string.IsNullOrWhiteSpace(reference))
                return Results.BadRequest(new { success = false, error = "reference is required" });

            try
            {
                var token = await GetTokenAsync();
                using var http = NewHttpClient();
                http.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");
                http.DefaultRequestHeaders.Add("X-GP-Version", GpVersion);

                var gpRes = await http.GetAsync($"{GpBase}/transactions?reference={Uri.EscapeDataString(reference)}");
                var data  = JsonSerializer.Deserialize<JsonElement>(await gpRes.Content.ReadAsStringAsync());

                if (!data.TryGetProperty("transactions", out var txns) ||
                    txns.ValueKind != JsonValueKind.Array || txns.GetArrayLength() == 0)
                    return Results.Ok(new { success = true, outcome = "pending", status = "PENDING" });

                var txn    = txns[0];
                var status = txn.TryGetProperty("status", out var st) ? st.GetString() : null;
                var card   = txn.TryGetProperty("payment_method", out var pm) && pm.TryGetProperty("card", out var cd)
                             ? cd : default;
                decimal? amount = null;
                if (txn.TryGetProperty("amount", out var amt) &&
                    decimal.TryParse(amt.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var minorVal))
                    amount = minorVal / 100m;

                return Results.Ok(new
                {
                    success       = true,
                    outcome       = Classify(status),
                    status,
                    transactionId = txn.TryGetProperty("id", out var id) ? id.GetString() : null,
                    amount,
                    currency      = txn.TryGetProperty("currency", out var cur) ? cur.GetString() : null,
                    cardDetails = new
                    {
                        brand        = StringProp(card, "brand"),
                        maskedNumber = StringProp(card, "masked_number_last4")
                    }
                });
            }
            catch (Exception ex)
            {
                return Results.Json(new { success = false, error = ex.Message }, statusCode: 500);
            }
        });

        // ─── POST /webhook ────────────────────────────────────────────────────
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
                var evt     = JsonSerializer.Deserialize<JsonElement>(payload);
                var evtType = evt.TryGetProperty("type", out var t) ? t.ToString() : "?";

                var enriched = new Dictionary<string, object?> { ["receivedAt"] = DateTime.UtcNow.ToString("o") };
                if (evt.ValueKind == JsonValueKind.Object)
                    foreach (var prop in evt.EnumerateObject()) enriched[prop.Name] = prop.Value;
                else
                    enriched["payload"] = evt;

                WebhookEvents.Enqueue(enriched);
                while (WebhookEvents.Count > 20) WebhookEvents.TryDequeue(out _);
                Console.WriteLine($"[Webhook] type={evtType}");
                return Results.Ok("OK");
            }
            catch
            {
                return Results.BadRequest("Invalid JSON payload");
            }
        });

        // ─── GET /webhook-events ──────────────────────────────────────────────
        app.MapGet("/webhook-events", () => Results.Ok(WebhookEvents.ToArray()));
    }

    // ─── GP API token ─────────────────────────────────────────────────────────
    // Mint a Bearer token carrying the app's full scope (incl. LNK_POST_Create).
    private static async Task<string> GetTokenAsync()
    {
        var nonce  = DateTime.UtcNow.ToString("o");
        var secret = Sha512Hex(nonce + Env("GP_APP_KEY"));
        var body   = JsonSerializer.Serialize(new
        {
            app_id     = Env("GP_APP_ID"),
            nonce,
            secret,
            grant_type = "client_credentials"
        });

        using var http = NewHttpClient();
        http.DefaultRequestHeaders.Add("X-GP-Version", GpVersion);
        var gpRes = await http.PostAsync($"{GpBase}/accesstoken",
            new StringContent(body, Encoding.UTF8, "application/json"));
        var data = JsonSerializer.Deserialize<JsonElement>(await gpRes.Content.ReadAsStringAsync());

        if (!gpRes.IsSuccessStatusCode || !data.TryGetProperty("token", out var tok))
            throw new Exception(ErrorMessage(data, "Access token request failed"));
        return tok.GetString()!;
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────
    private static HttpClient NewHttpClient() =>
        new(new HttpClientHandler
        {
            AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate
        });

    private static string BaseUrl(HttpContext ctx)
    {
        var configured = Env("BASE_URL");
        if (!string.IsNullOrWhiteSpace(configured)) return configured.TrimEnd('/');
        var proto = ctx.Request.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? ctx.Request.Scheme;
        var host  = ctx.Request.Headers["X-Forwarded-Host"].FirstOrDefault() ?? ctx.Request.Host.Value;
        return $"{proto}://{host}";
    }

    private static string Classify(string? status)
    {
        var s = (status ?? "").ToUpperInvariant();
        if (s is "PREAUTHORIZED" or "CAPTURED" or "SUCCESS") return "success";
        if (s is "DECLINED" or "REJECTED" or "CANCELLED")    return "declined";
        return "pending";
    }

    private static bool Flag(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.True;

    private static string? StringProp(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;

    private static string AsString(JsonElement el) =>
        el.ValueKind == JsonValueKind.String ? el.GetString() ?? "" : el.ToString();

    private static string ErrorMessage(JsonElement data, string fallback)
    {
        if (data.TryGetProperty("detailed_error_description", out var d) && d.ValueKind == JsonValueKind.String)
            return d.GetString()!;
        if (data.TryGetProperty("error_code", out var e) && e.ValueKind == JsonValueKind.String)
            return e.GetString()!;
        return fallback;
    }

    private static string Env(string key) =>
        System.Environment.GetEnvironmentVariable(key) ?? string.Empty;

    private static string Sha512Hex(string input) =>
        Convert.ToHexString(SHA512.HashData(Encoding.UTF8.GetBytes(input))).ToLower();

    // Kept for production signature verification reference
    private static string HmacSha256Hex(string payload, string secret) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(payload))).ToLower();
}
