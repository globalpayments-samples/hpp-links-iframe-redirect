package com.globalpayments.example;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.github.cdimascio.dotenv.Dotenv;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Global Payments – Hosted Payment Page (HPP) Sample (Java / Jakarta Servlet)
 *
 * The merchant server creates a HOSTED_PAYMENT_PAGE link via the GP API Links API
 * and hands the browser a GP-hosted URL. Card entry, 3-D Secure and the result are
 * handled on the GP-hosted page — the raw card number never touches this server.
 *
 * Routes (all handled in one servlet):
 *   POST /create-hpp-link  — create a HOSTED_PAYMENT_PAGE link; returns { id, url, reference }
 *   GET  /payment-status   — read the link/transaction outcome for the UI to poll
 *   POST /webhook          — receive GP API notifications (status_url)
 *   GET  /webhook-events   — tail recent webhook events for the live UI log
 *
 * Calls the GP API REST endpoints directly via HttpClient (no SDK) — the
 * HOSTED_PAYMENT_PAGE link type is not uniformly exposed by the language SDKs, so
 * all five framework samples standardise on raw REST for an identical contract.
 */
@WebServlet(urlPatterns = { "/create-hpp-link", "/payment-status", "/webhook", "/webhook-events" })
public class HostedPaymentServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;
    private static final int  MAX_EVENTS       = 20;
    private static final String GP_BASE    = "https://apis.sandbox.globalpay.com/ucp";
    private static final String GP_VERSION = "2021-03-22";

    private static final Deque<String> webhookEvents = new ArrayDeque<>();

    private final Dotenv       dotenv = Dotenv.configure().ignoreIfMissing().load();
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient   http   = HttpClient.newHttpClient();

    // ─── Dispatchers ─────────────────────────────────────────────────────────
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
        switch (req.getServletPath()) {
            case "/payment-status" -> handlePaymentStatus(req, res);
            case "/webhook-events" -> handleWebhookEvents(res);
            default                -> res.sendError(HttpServletResponse.SC_NOT_FOUND);
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res) throws IOException {
        switch (req.getServletPath()) {
            case "/create-hpp-link" -> handleCreateHppLink(req, res);
            case "/webhook"         -> handleWebhook(req, res);
            default                 -> res.sendError(HttpServletResponse.SC_NOT_FOUND);
        }
    }

    // ─── Mint a GP API token carrying the app's full scope (incl. LNK_POST_Create) ──
    private String getToken() throws Exception {
        String nonce  = Instant.now().toString();
        String secret = sha512Hex(nonce + dotenv.get("GP_APP_KEY"));
        String body   = mapper.writeValueAsString(mapper.createObjectNode()
                .put("app_id",     dotenv.get("GP_APP_ID"))
                .put("nonce",      nonce)
                .put("secret",     secret)
                .put("grant_type", "client_credentials"));

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(GP_BASE + "/accesstoken"))
                .header("Content-Type",    "application/json")
                .header("X-GP-Version",    GP_VERSION)
                .header("Accept-Encoding", "identity")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> gpRes = http.send(request, HttpResponse.BodyHandlers.ofString());
        JsonNode data = mapper.readTree(gpRes.body());
        if (gpRes.statusCode() != 200 || data.path("token").asText("").isEmpty()) {
            throw new RuntimeException(errorMessage(data, "Access token request failed"));
        }
        return data.get("token").asText();
    }

    // ─── POST /create-hpp-link ───────────────────────────────────────────────
    private void handleCreateHppLink(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setContentType("application/json");
        try {
            JsonNode input;
            try {
                input = mapper.readTree(req.getReader().lines().collect(Collectors.joining()));
            } catch (Exception parse) {
                writeError(res, 400, "Invalid JSON body");
                return;
            }
            if (input == null) input = mapper.createObjectNode();

            BigDecimal amount;
            try {
                amount = new BigDecimal(input.path("amount").asText("0"));
            } catch (NumberFormatException nfe) {
                amount = BigDecimal.ZERO;
            }
            if (amount.compareTo(BigDecimal.ZERO) <= 0) {
                writeError(res, 400, "A positive amount is required");
                return;
            }

            String currency  = input.path("currency").asText("USD");
            JsonNode config   = input.path("config");
            JsonNode payer    = input.path("payer");
            String reference  = "order-" + System.currentTimeMillis();
            String minor      = amount.multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).toPlainString();

            // Value-add toggles → transaction_configuration. 3-D Secure runs
            // automatically; wallet/APM availability is account-provisioned, so these
            // are best-effort hints (unknown fields are ignored by the API).
            ObjectNode txnConfig = mapper.createObjectNode().put("country", "US").put("channel", "CNP");
            if (config.path("dcc").asBoolean(false))         txnConfig.put("allow_dynamic_currency_conversion", true);
            if (config.path("cardStorage").asBoolean(false)) txnConfig.put("enable_card_storage", true);

            ArrayNode methods = mapper.createArrayNode().add("CARD");
            if (config.path("digitalWallets").asBoolean(false)) methods.add("DIGITAL_WALLET");
            if (config.path("apm").asBoolean(false))            methods.add("PAYPAL");

            ObjectNode order = mapper.createObjectNode()
                    .put("amount", minor).put("currency", currency).put("reference", reference);
            order.set("transaction_configuration", txnConfig);

            ObjectNode transactions = mapper.createObjectNode()
                    .put("amount", minor).put("channel", "CNP").put("country", "US").put("currency", currency);
            transactions.set("allowed_payment_methods", methods);

            ObjectNode payerNode = mapper.createObjectNode()
                    .put("email", payer.path("email").asText("sandbox.payer@example.com"))
                    .put("name",  payer.path("name").asText("Sandbox Payer"));

            ObjectNode notifications = mapper.createObjectNode()
                    .put("return_url", baseUrl(req) + "/?reference=" + reference)
                    .put("status_url", baseUrl(req) + "/webhook");

            ObjectNode linkBody = mapper.createObjectNode()
                    .put("account_name",    dotenv.get("GP_ACCOUNT_NAME"))
                    .put("type",            "HOSTED_PAYMENT_PAGE")
                    .put("usage_mode",      "SINGLE")
                    .put("usage_limit",     "1")
                    .put("reference",       reference)
                    .put("name",            "HPP Demo Transaction")
                    .put("description",     "Hosted Payment Page transaction from the GP API sample")
                    .put("expiration_date", Instant.now().plus(1, ChronoUnit.HOURS).toString());
            linkBody.set("order", order);
            linkBody.set("transactions", transactions);
            linkBody.set("payer", payerNode);
            linkBody.set("notifications", notifications);

            String token = getToken();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(GP_BASE + "/links"))
                    .header("Authorization",   "Bearer " + token)
                    .header("Content-Type",    "application/json")
                    .header("X-GP-Version",    GP_VERSION)
                    .header("Accept-Encoding", "identity")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(linkBody)))
                    .build();

            HttpResponse<String> gpRes = http.send(request, HttpResponse.BodyHandlers.ofString());
            JsonNode data = mapper.readTree(gpRes.body());
            if (gpRes.statusCode() != 200 || data.path("id").asText("").isEmpty()) {
                writeError(res, 400, errorMessage(data, "Link creation failed"));
                return;
            }

            ObjectNode out = mapper.createObjectNode();
            out.put("success", true);
            out.put("id", data.get("id").asText());
            out.put("url", data.path("url").asText());
            out.put("reference", reference);
            res.getWriter().write(mapper.writeValueAsString(out));

        } catch (Exception e) {
            writeError(res, 500, e.getMessage());
        }
    }

    // ─── GET /payment-status ─────────────────────────────────────────────────
    private void handlePaymentStatus(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setContentType("application/json");
        String reference = req.getParameter("reference");
        if (reference == null || reference.isBlank()) {
            writeError(res, 400, "reference is required");
            return;
        }
        try {
            String token = getToken();
            String url = GP_BASE + "/transactions?reference=" + URLEncoder.encode(reference, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization",   "Bearer " + token)
                    .header("X-GP-Version",    GP_VERSION)
                    .header("Accept-Encoding", "identity")
                    .GET()
                    .build();

            HttpResponse<String> gpRes = http.send(request, HttpResponse.BodyHandlers.ofString());
            JsonNode data = mapper.readTree(gpRes.body());
            JsonNode txns = data.path("transactions");

            if (!txns.isArray() || txns.isEmpty()) {
                ObjectNode pending = mapper.createObjectNode();
                pending.put("success", true);
                pending.put("outcome", "pending");
                pending.put("status", "PENDING");
                res.getWriter().write(mapper.writeValueAsString(pending));
                return;
            }

            JsonNode txn  = txns.get(0);
            JsonNode card = txn.path("payment_method").path("card");
            String minor  = txn.path("amount").asText("");

            ObjectNode out = mapper.createObjectNode();
            out.put("success", true);
            out.put("outcome", classify(txn.path("status").asText("")));
            out.put("status",  txn.path("status").asText(null));
            out.put("transactionId", txn.path("id").asText(null));
            if (!minor.isEmpty()) out.put("amount", new BigDecimal(minor).divide(BigDecimal.valueOf(100)));
            out.put("currency", txn.path("currency").asText(null));
            ObjectNode cardOut = out.putObject("cardDetails");
            cardOut.put("brand",        card.path("brand").asText(null));
            cardOut.put("maskedNumber", card.path("masked_number_last4").asText(null));
            res.getWriter().write(mapper.writeValueAsString(out));

        } catch (Exception e) {
            writeError(res, 500, e.getMessage());
        }
    }

    // ─── POST /webhook ───────────────────────────────────────────────────────
    private void handleWebhook(HttpServletRequest req, HttpServletResponse res) throws IOException {
        String payload = req.getReader().lines().collect(Collectors.joining());

        /*
        // Production: verify HMAC-SHA256 signature
        String expected = hmacSha256Hex(payload, dotenv.get("GP_WEBHOOK_SECRET"));
        if (!expected.equals(req.getHeader("X-GP-Signature"))) {
            res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            res.getWriter().write("Unauthorized");
            return;
        }
        */

        try {
            JsonNode event = mapper.readTree(payload);
            ObjectNode enriched = mapper.createObjectNode();
            enriched.put("receivedAt", Instant.now().toString());
            if (event instanceof ObjectNode) {
                enriched.setAll((ObjectNode) event);
            } else {
                enriched.set("payload", event);
            }
            synchronized (webhookEvents) {
                webhookEvents.addFirst(mapper.writeValueAsString(enriched));
                while (webhookEvents.size() > MAX_EVENTS) webhookEvents.removeLast();
            }
            System.out.printf("[Webhook] type=%s id=%s%n", event.path("type").asText("EVENT"), event.path("id").asText(""));
            res.setStatus(HttpServletResponse.SC_OK);
            res.getWriter().write("OK");
        } catch (Exception e) {
            res.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            res.getWriter().write("Invalid JSON payload");
        }
    }

    // ─── GET /webhook-events ─────────────────────────────────────────────────
    private void handleWebhookEvents(HttpServletResponse res) throws IOException {
        res.setContentType("application/json");
        List<JsonNode> list = new ArrayList<>();
        synchronized (webhookEvents) {
            for (String raw : webhookEvents) list.add(mapper.readTree(raw));
        }
        res.getWriter().write(mapper.writeValueAsString(list));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────
    private String baseUrl(HttpServletRequest req) {
        String configured = dotenv.get("BASE_URL");
        if (configured != null && !configured.isBlank()) {
            return configured.replaceAll("/+$", "");
        }
        String proto = headerOr(req, "X-Forwarded-Proto", req.getScheme());
        String host  = headerOr(req, "X-Forwarded-Host", req.getHeader("Host"));
        if (host == null) host = req.getServerName() + ":" + req.getServerPort();
        return proto + "://" + host;
    }

    private static String headerOr(HttpServletRequest req, String name, String fallback) {
        String v = req.getHeader(name);
        return (v == null || v.isBlank()) ? fallback : v;
    }

    private static String classify(String status) {
        String s = status == null ? "" : status.toUpperCase();
        if (s.equals("PREAUTHORIZED") || s.equals("CAPTURED") || s.equals("SUCCESS")) return "success";
        if (s.equals("DECLINED") || s.equals("REJECTED") || s.equals("CANCELLED"))    return "declined";
        return "pending";
    }

    private static String errorMessage(JsonNode data, String fallback) {
        String msg = data.path("detailed_error_description").asText("");
        if (msg.isEmpty()) msg = data.path("error_code").asText("");
        return msg.isEmpty() ? fallback : msg;
    }

    private void writeError(HttpServletResponse res, int status, String message) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json");
        res.getWriter().write(mapper.writeValueAsString(
                mapper.createObjectNode().put("success", false).put("error", message == null ? "error" : message)));
    }

    private static String sha512Hex(String input) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-512");
        byte[] bytes = digest.digest(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
