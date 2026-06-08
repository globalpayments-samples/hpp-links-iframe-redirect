package com.globalpayments.example;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.global.api.ServicesContainer;
import com.global.api.entities.AccessTokenInfo;
import com.global.api.entities.Transaction;
import com.global.api.entities.exceptions.ApiException;
import com.global.api.entities.exceptions.ConfigurationException;
import com.global.api.entities.enums.Channel;
import com.global.api.entities.enums.Environment;
import com.global.api.paymentMethods.CreditCardData;
import com.global.api.serviceConfigs.GpApiConfig;
import io.github.cdimascio.dotenv.Dotenv;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Global Payments – Drop-In UI Sample (Java / Jakarta Servlet)
 *
 * Routes (all handled in one servlet via URL pattern "/*"):
 *   GET  /access-token     — limited-scope frontend token for Drop-In UI
 *   POST /process-payment  — charge a single-use token from Drop-In UI
 *   POST /webhook          — receive GP API transaction notifications
 *   GET  /webhook-events   — tail recent webhook events for the live UI log
 */
@WebServlet(urlPatterns = { "/access-token", "/process-payment", "/webhook", "/webhook-events" })
public class ProcessPaymentServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;
    private static final int  MAX_EVENTS       = 20;

    // In-memory ring-buffer for the live webhook event log
    private static final Deque<String> webhookEvents = new ArrayDeque<>();

    private final Dotenv       dotenv = Dotenv.configure().ignoreIfMissing().load();
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient   http   = HttpClient.newHttpClient();

    // ─── Servlet init — configure GP API SDK ─────────────────────────────────
    @Override
    public void init() throws ServletException {
        try {
            GpApiConfig config = new GpApiConfig();
            config.setAppId(dotenv.get("GP_APP_ID"));
            config.setAppKey(dotenv.get("GP_APP_KEY"));
            config.setChannel(Channel.CardNotPresent);
            config.setEnvironment(Environment.TEST);
            config.setMerchantId(dotenv.get("GP_MERCHANT_ID"));

            AccessTokenInfo tokenInfo = new AccessTokenInfo();
            tokenInfo.setTransactionProcessingAccountName(dotenv.get("GP_ACCOUNT_NAME"));
            config.setAccessTokenInfo(tokenInfo);

            ServicesContainer.configureService(config);
        } catch (ConfigurationException e) {
            throw new ServletException("GP API SDK configuration failed", e);
        }
    }

    // ─── GET dispatcher ──────────────────────────────────────────────────────
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {
        switch (req.getServletPath()) {
            case "/access-token"    -> handleAccessToken(res);
            case "/webhook-events"  -> handleWebhookEvents(res);
            default                 -> res.sendError(HttpServletResponse.SC_NOT_FOUND);
        }
    }

    // ─── POST dispatcher ─────────────────────────────────────────────────────
    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {
        switch (req.getServletPath()) {
            case "/process-payment" -> handleProcessPayment(req, res);
            case "/webhook"         -> handleWebhook(req, res);
            default                 -> res.sendError(HttpServletResponse.SC_NOT_FOUND);
        }
    }

    // ─── GET /access-token ───────────────────────────────────────────────────
    private void handleAccessToken(HttpServletResponse res) throws IOException {
        res.setContentType("application/json");
        try {
            String appId  = dotenv.get("GP_APP_ID");
            String appKey = dotenv.get("GP_APP_KEY");
            String nonce  = String.valueOf(System.currentTimeMillis());
            String secret = sha512Hex(nonce + appKey);

            String body = mapper.writeValueAsString(mapper.createObjectNode()
                    .put("app_id",     appId)
                    .put("nonce",      nonce)
                    .put("secret",     secret)
                    .put("grant_type", "client_credentials")
                    .set("permissions", mapper.createArrayNode().add("PMT_POST_Create_Single")));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://apis.sandbox.globalpay.com/ucp/accesstoken"))
                    .header("Content-Type", "application/json")
                    .header("X-GP-Version",  "2021-03-22")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            HttpResponse<String> gpRes = http.send(request, HttpResponse.BodyHandlers.ofString());

            if (gpRes.statusCode() != 200) {
                res.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
                res.getWriter().write("{\"success\":false,\"error\":\"Failed to obtain access token\"}");
                return;
            }

            JsonNode data  = mapper.readTree(gpRes.body());
            String   token = data.path("token").asText();

            ObjectNode out = mapper.createObjectNode();
            out.put("token", token);
            out.put("env",   "sandbox");
            res.getWriter().write(mapper.writeValueAsString(out));

        } catch (Exception e) {
            res.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            res.getWriter().write("{\"success\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        }
    }

    // ─── POST /process-payment ───────────────────────────────────────────────
    private void handleProcessPayment(HttpServletRequest req, HttpServletResponse res)
            throws IOException {
        res.setContentType("application/json");

        try {
            String rawBody = req.getReader().lines().collect(Collectors.joining());
            JsonNode input = mapper.readTree(rawBody);

            String     paymentRef = input.path("payment_reference").asText(null);
            BigDecimal amount     = new BigDecimal(input.path("amount").asText("0"));

            if (paymentRef == null || paymentRef.isBlank() || amount.compareTo(BigDecimal.ZERO) <= 0) {
                res.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                res.getWriter().write("{\"success\":false,\"error\":\"payment_reference and a positive amount are required\"}");
                return;
            }

            CreditCardData card = new CreditCardData();
            card.setToken(paymentRef);

            Transaction result = card.charge(amount)
                    .withCurrency("USD")
                    .withOrderId("ORD-" + System.currentTimeMillis())
                    .execute();

            ObjectNode out = mapper.createObjectNode();
            out.put("success",       true);
            out.put("transactionId", result.getTransactionId());
            out.put("amount",        amount.toPlainString());
            out.put("status",        result.getResponseMessage());
            ObjectNode card2 = out.putObject("cardDetails");
            card2.put("brand",        result.getCardType());
            card2.put("maskedNumber", result.getCardLast4());
            res.getWriter().write(mapper.writeValueAsString(out));

        } catch (ApiException e) {
            res.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            res.getWriter().write("{\"success\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        } catch (Exception e) {
            res.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            res.getWriter().write("{\"success\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        }
    }

    // ─── POST /webhook ───────────────────────────────────────────────────────
    private void handleWebhook(HttpServletRequest req, HttpServletResponse res)
            throws IOException {
        String payload   = req.getReader().lines().collect(Collectors.joining());
        String signature = req.getHeader("X-GP-Signature");

        /*
        // Production: verify HMAC-SHA256 signature
        String secret   = dotenv.get("GP_WEBHOOK_SECRET");
        String expected = hmacSha256Hex(payload, secret);
        if (!expected.equals(signature)) {
            res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            res.getWriter().write("Unauthorized");
            return;
        }
        */

        try {
            JsonNode event = mapper.readTree(payload);
            String   type  = event.path("type").asText("EVENT");
            String   id    = event.path("id").asText("");

            ObjectNode enriched = mapper.createObjectNode();
            enriched.put("receivedAt", Instant.now().toString());
            enriched.put("type",       type);
            enriched.put("id",         id);
            enriched.set("payload",    event);

            synchronized (webhookEvents) {
                webhookEvents.addFirst(mapper.writeValueAsString(enriched));
                while (webhookEvents.size() > MAX_EVENTS) webhookEvents.removeLast();
            }

            System.out.printf("[Webhook] type=%s id=%s%n", type, id);
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
            for (String raw : webhookEvents) {
                list.add(mapper.readTree(raw));
            }
        }
        res.getWriter().write(mapper.writeValueAsString(list));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────
    private static String sha512Hex(String input) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-512");
        byte[] bytes = digest.digest(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String escapeJson(String s) {
        return s == null ? "" : s.replace("\"", "\\\"");
    }
}
