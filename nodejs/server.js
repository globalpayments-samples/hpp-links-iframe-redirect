/**
 * Global Payments – Drop-In UI Sample (Node.js / Express)
 *
 * Endpoints:
 *   GET  /access-token     — generate a limited-scope frontend token for Drop-In UI
 *   POST /process-payment  — charge a single-use token returned by the Drop-In UI
 *   POST /webhook          — receive GP API transaction notifications
 *   GET  /webhook-events   — tail recent webhook events (for the live UI log)
 */

import express        from 'express';
import * as dotenv    from 'dotenv';
import crypto         from 'crypto';
import {
    ServicesContainer,
    GpApiConfig,
    CreditCardData,
    Channel,
    Environment
} from 'globalpayments-api';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 8000;

// In-memory event ring for the UI webhook log (last 20 notifications)
const webhookEvents = [];

app.use(express.static('.'));
app.use(express.urlencoded({ extended: true }));
// Preserve raw body for /webhook (needed for HMAC signature verification);
// express.json() must come AFTER so it doesn't consume the stream first.
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── GP API SDK configuration ────────────────────────────────────────────────
const gpConfig                  = new GpApiConfig();
gpConfig.appId                  = process.env.GP_APP_ID;
gpConfig.appKey                 = process.env.GP_APP_KEY;
gpConfig.channel                = Channel.CardNotPresent;
gpConfig.environment            = Environment.Test;
// NOTE: do not set merchantId. This is a direct-merchant integration, so the
// account is resolved from the app credentials + transactionProcessingAccountName.
// Setting merchantId makes the SDK route charges to the partner-scoped
// /ucp/merchants/{id}/transactions endpoint, which requires permissions a
// direct-merchant app doesn't have (GP returns ACTION_NOT_AUTHORIZED 40212).
gpConfig.accessTokenInfo        = {
    transactionProcessingAccountName: process.env.GP_ACCOUNT_NAME
};
ServicesContainer.configureService(gpConfig);

// ─── GET /access-token ───────────────────────────────────────────────────────
// Returns a short-lived, single-use-tokenization-scoped access token to the
// frontend so it can initialise GlobalPayments.configure() without exposing
// the full App Key in the browser.
app.get('/access-token', async (_req, res) => {
    try {
        const nonce  = Date.now().toString();
        const secret = crypto.createHash('sha512')
            .update(nonce + process.env.GP_APP_KEY)
            .digest('hex');

        const gpRes  = await fetch('https://apis.sandbox.globalpay.com/ucp/accesstoken', {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-GP-Version': '2021-03-22'
            },
            body: JSON.stringify({
                app_id:      process.env.GP_APP_ID,
                nonce,
                secret,
                grant_type:  'client_credentials',
                permissions: ['PMT_POST_Create_Single']
            })
        });

        const data = await gpRes.json();
        if (!gpRes.ok) throw new Error(data.detail || 'Access token request failed');

        res.json({ token: data.token, env: 'sandbox' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── POST /process-payment ───────────────────────────────────────────────────
// Charges the single-use paymentReference returned by the Drop-In UI token-success
// event. The raw card number never reaches this server.
app.post('/process-payment', async (req, res) => {
    const { payment_reference, amount } = req.body;

    if (!payment_reference || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
            success: false,
            error:   'payment_reference and a positive amount are required'
        });
    }

    try {
        const card   = new CreditCardData();
        card.token   = payment_reference;

        const result = await card.charge(parseFloat(amount))
            .withCurrency('USD')
            .withOrderId(`ORD-${Date.now()}`)
            .execute();

        res.json({
            success:       true,
            transactionId: result.transactionId,
            // Emit amount as a JSON number for parity with the other backends.
            amount:        parseFloat(result.balanceAmount || amount),
            status:        result.responseMessage,
            cardDetails: {
                brand:        result.cardType,
                maskedNumber: result.cardLast4
            }
        });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// ─── POST /webhook ───────────────────────────────────────────────────────────
// Receives GP API transaction notifications.
// In production: uncomment the HMAC-SHA256 signature verification block.
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    /*
    const sig      = req.headers['x-gp-signature'];
    const expected = crypto
        .createHmac('sha256', process.env.GP_WEBHOOK_SECRET)
        .update(req.body)
        .digest('hex');
    if (sig !== expected) return res.status(401).send('Unauthorized');
    */

    try {
        const event = JSON.parse(req.body.toString());
        webhookEvents.unshift({ receivedAt: new Date().toISOString(), ...event });
        if (webhookEvents.length > 20) webhookEvents.length = 20;
        console.log(`[Webhook] type=${event.type} id=${event.id}`);
        res.status(200).send('OK');
    } catch {
        res.status(400).send('Invalid JSON payload');
    }
});

// ─── GET /webhook-events ─────────────────────────────────────────────────────
// Used by the UI to tail the in-memory webhook event log.
app.get('/webhook-events', (_req, res) => {
    res.json(webhookEvents);
});

// ─── JSON parse error handler ────────────────────────────────────────────────
// Catches malformed request bodies and returns a clean JSON 400 instead of HTML.
app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`GP API Drop-In UI (Node.js) running → http://localhost:${PORT}`);
});
