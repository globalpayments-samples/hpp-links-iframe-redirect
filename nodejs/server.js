/**
 * Global Payments – Hosted Payment Page (HPP) Sample (Node.js / Express)
 *
 * The merchant server creates a HOSTED_PAYMENT_PAGE link via the GP API Links API
 * and hands the browser a GP-hosted URL. The customer enters card details, completes
 * 3-D Secure, and pays entirely on the GP-hosted page — the raw card number never
 * touches this server.
 *
 * Endpoints:
 *   POST /create-hpp-link  — create a HOSTED_PAYMENT_PAGE link; returns { id, url, reference }
 *   GET  /payment-status   — read the link/transaction outcome for the UI to poll
 *   POST /webhook          — receive GP API notifications (status_url)
 *   GET  /webhook-events   — tail recent webhook events (for the live UI log)
 *
 * This calls the GP API REST endpoints directly via fetch (no SDK). The
 * HOSTED_PAYMENT_PAGE link type is not uniformly exposed by the language SDKs, so
 * all five framework samples standardise on raw REST for an identical contract.
 */

import express     from 'express';
import * as dotenv from 'dotenv';
import crypto      from 'crypto';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 8000;

const GP_BASE    = 'https://apis.sandbox.globalpay.com/ucp';
const GP_VERSION = '2021-03-22';

// Country to send for each supported currency (drives APM availability on the
// hosted page). The processing account resolves the merchant; this only scopes
// the order's transaction_configuration.
const COUNTRY_FOR = { USD: 'US', EUR: 'IE', GBP: 'GB', CAD: 'CA' };

// Redact a bearer token / secret to a recognisable prefix so the API Explorer can
// show the real call shape without leaking the credential.
function redactSecret(value) {
    const s = String(value || '');
    return s.length > 12 ? s.slice(0, 12) + '…(redacted)' : s;
}

// In-memory event ring for the UI webhook log (last 20 notifications)
const webhookEvents = [];

app.use(express.static('.'));
// Preserve the raw body for /webhook (needed for HMAC signature verification);
// express.json() is mounted AFTER so it doesn't consume the stream first.
app.use('/webhook', express.raw({ type: '*/*' }));
app.use(express.json());

// ─── GP API access token ─────────────────────────────────────────────────────
// Mint a Bearer token carrying the app's full scope (no `permissions` filter) so
// it includes LNK_POST_Create. secret = sha512(nonce + appKey); the App Key never
// reaches the browser.
async function getToken(trace) {
    const nonce  = new Date().toISOString();
    const secret = crypto.createHash('sha512')
        .update(nonce + process.env.GP_APP_KEY)
        .digest('hex');

    const reqBody = { app_id: process.env.GP_APP_ID, nonce, secret, grant_type: 'client_credentials' };
    const res  = await fetch(`${GP_BASE}/accesstoken`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-GP-Version': GP_VERSION },
        body: JSON.stringify(reqBody)
    });
    const data = await res.json();

    // Record the call for the API Explorer (the App Key is never sent in the clear;
    // the bearer token in the response is redacted).
    if (trace) {
        trace.push({ step: 'token', dir: 'request', label: 'Create Access Token', method: 'POST',
                     endpoint: '/ucp/accesstoken', body: { ...reqBody, secret: redactSecret(secret) } });
        trace.push({ step: 'token', dir: 'response', label: 'Create Access Token', status: res.status,
                     body: { ...data, token: data.token ? redactSecret(data.token) : data.token } });
    }
    if (!res.ok) {
        throw new Error(data.detailed_error_description || data.error_code || 'Access token request failed');
    }
    return data.token;
}

// Public origin used to build the link's return_url / status_url. Honours BASE_URL
// (set it to a tunnel so the GP sandbox can reach /webhook), else the request origin.
function baseUrl(req) {
    if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host  = req.headers['x-forwarded-host']  || req.headers.host;
    return `${proto}://${host}`;
}

// Build the GP API HOSTED_PAYMENT_PAGE link request body. Required fields learned
// from the live API: top-level `reference`, `order.amount`, and `payer.email`
// (the hosted layer rejects a missing HPP_CUSTOMER_EMAIL). Amounts are minor units.
function buildLinkBody({ amount, currency, config, reference, payer, base }) {
    const minor = String(Math.round(parseFloat(amount) * 100));
    const cfg   = config || {};
    const cur   = currency || 'USD';
    const country = COUNTRY_FOR[cur] || 'US';

    // ── order.transaction_configuration ──────────────────────────────────────
    // APMs are enabled by adding their method strings to allowed_payment_methods
    // (alongside the mandatory "CARD"). currency_conversion_mode toggles DCC.
    const apms = Array.isArray(cfg.apms) ? cfg.apms.filter(Boolean) : [];
    const transactionConfiguration = {
        channel:                  'CNP',
        country,
        capture_mode:             'AUTO',
        currency_conversion_mode: cfg.dcc ? 'YES' : 'NO',
        allowed_payment_methods:  ['CARD', ...apms]
    };
    // Card storage is best-effort (account-provisioned); unknown fields are ignored.
    if (cfg.cardStorage) transactionConfiguration.enable_card_storage = true;

    // ── order.payment_method_configuration ───────────────────────────────────
    // 3-D Secure preference, plus digital wallets via an explicit provider list.
    const paymentMethodConfiguration = {
        authentication: { preference: cfg.threeds ? 'CHALLENGE_PREFERRED' : 'NO_CHALLENGE_REQUESTED' }
    };
    if (cfg.digitalWallets) {
        paymentMethodConfiguration.digital_wallets = { provider: ['googlepay', 'applepay'] };
    }

    return {
        account_name:    process.env.GP_ACCOUNT_NAME,   // transaction_processing_hpp
        type:            'HOSTED_PAYMENT_PAGE',
        usage_mode:      'SINGLE',
        usage_limit:     '1',
        reference,
        name:            'HPP Demo Transaction',
        description:     'Hosted Payment Page transaction from the GP API sample',
        expiration_date: new Date(Date.now() + 3600 * 1000).toISOString(),
        order: {
            amount:    minor,
            currency:  cur,
            reference,
            transaction_configuration:    transactionConfiguration,
            payment_method_configuration: paymentMethodConfiguration
        },
        transactions: {
            amount:   minor,
            channel:  'CNP',
            country,
            currency: cur
        },
        payer: {
            email: payer?.email || 'sandbox.payer@example.com',
            name:  payer?.name  || 'Sandbox Payer'
        },
        notifications: {
            return_url: `${base}/?reference=${encodeURIComponent(reference)}`,
            status_url: `${base}/webhook`
        }
    };
}

// Map a GP transaction status to the UI's success / declined / pending buckets.
// A successful 3-D Secure hosted sale settles as PREAUTHORIZED (not CAPTURED).
function classify(status) {
    const s = (status || '').toUpperCase();
    if (['PREAUTHORIZED', 'CAPTURED', 'SUCCESS'].includes(s)) return 'success';
    if (['DECLINED', 'REJECTED', 'CANCELLED'].includes(s))    return 'declined';
    return 'pending';
}

// ─── POST /create-hpp-link ───────────────────────────────────────────────────
// Creates a HOSTED_PAYMENT_PAGE link and returns the GP-hosted URL for the page
// to render (iframe) or redirect to.
app.post('/create-hpp-link', async (req, res) => {
    const { amount, currency, config, payer } = req.body || {};

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, error: 'A positive amount is required' });
    }

    // Records each GP API call (request + response) so the UI's API Explorer can
    // replay the exact sequence — Create Access Token → Create a link.
    const apiCalls = [];

    try {
        const token     = await getToken(apiCalls);
        const reference = `order-${Date.now()}`;
        const body      = buildLinkBody({ amount, currency, config, reference, payer, base: baseUrl(req) });

        apiCalls.push({ step: 'link', dir: 'request', label: 'Create a link', method: 'POST',
                        endpoint: '/ucp/links', body });

        const gpRes = await fetch(`${GP_BASE}/links`, {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json',
                'X-GP-Version':  GP_VERSION
            },
            body: JSON.stringify(body)
        });
        const data = await gpRes.json();
        apiCalls.push({ step: 'link', dir: 'response', label: 'Create a link', status: gpRes.status, body: data });

        if (!gpRes.ok) {
            const msg = data.detailed_error_description || data.error_code || 'Link creation failed';
            return res.status(400).json({ success: false, error: msg, apiCalls });
        }

        res.json({ success: true, id: data.id, url: data.url, reference, apiCalls });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, apiCalls });
    }
});

// ─── GET /payment-status ─────────────────────────────────────────────────────
// Reads the outcome of a hosted payment. Polled by the UI (iframe mode) and read
// once on redirect-return. Looks the transaction up by the order reference.
app.get('/payment-status', async (req, res) => {
    const reference = req.query.reference;
    if (!reference) {
        return res.status(400).json({ success: false, error: 'reference is required' });
    }

    try {
        const token = await getToken();
        const gpRes = await fetch(`${GP_BASE}/transactions?reference=${encodeURIComponent(reference)}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'X-GP-Version': GP_VERSION }
        });
        const data = await gpRes.json();

        const txn = (data.transactions || [])[0];
        if (!txn) {
            // No transaction recorded yet — the customer hasn't finished paying.
            return res.json({ success: true, outcome: 'pending', status: 'PENDING' });
        }

        const card = txn.payment_method?.card || {};
        res.json({
            success:       true,
            outcome:       classify(txn.status),
            status:        txn.status,
            transactionId: txn.id,
            amount:        txn.amount ? parseInt(txn.amount, 10) / 100 : undefined,
            currency:      txn.currency,
            cardDetails: {
                brand:        card.brand,
                maskedNumber: card.masked_number_last4
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── POST /webhook ───────────────────────────────────────────────────────────
// Receives GP API notifications. In production: uncomment the HMAC-SHA256 check.
app.post('/webhook', (req, res) => {
    /*
    const sig      = req.headers['x-gp-signature'];
    const expected = crypto.createHmac('sha256', process.env.GP_WEBHOOK_SECRET)
        .update(req.body).digest('hex');
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
app.get('/webhook-events', (_req, res) => {
    res.json(webhookEvents);
});

// ─── JSON parse error handler ────────────────────────────────────────────────
app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`GP API Hosted Payment Page (Node.js) running → http://localhost:${PORT}`);
});
