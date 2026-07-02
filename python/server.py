"""
Global Payments – Hosted Payment Page (HPP) Sample (Python / Flask)

The merchant server creates a HOSTED_PAYMENT_PAGE link via the GP API Links API and
hands the browser a GP-hosted URL. Card entry, 3-D Secure and the result are handled
on the GP-hosted page — the raw card number never touches this server.

Endpoints:
  POST /create-hpp-link  — create a HOSTED_PAYMENT_PAGE link; returns { id, url, reference }
  GET  /payment-status   — read the link/transaction outcome for the UI to poll
  POST /webhook          — receive GP API notifications (status_url)
  GET  /webhook-events   — tail recent webhook events (for the live UI log)

This calls the GP API REST endpoints directly via `requests` (no SDK) — the
HOSTED_PAYMENT_PAGE link type is not uniformly exposed by the language SDKs, so all
five framework samples standardise on raw REST for an identical contract.
"""

import hashlib
import hmac  # noqa: F401  (kept for the production webhook signature snippet)
import json
import os
import time
from collections import deque
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__, static_folder='.')

# In-memory ring-buffer for the live webhook event log (last 20 notifications)
webhook_events = deque(maxlen=20)

GP_BASE    = 'https://apis.sandbox.globalpay.com/ucp'
GP_VERSION = '2021-03-22'

# Country to send for each supported currency (drives APM availability on the
# hosted page); the processing account resolves the merchant.
COUNTRY_FOR = {'USD': 'US', 'EUR': 'IE', 'GBP': 'GB', 'CAD': 'CA'}


def redact_secret(value):
    """Redact a bearer token / secret to a recognisable prefix for the API Explorer."""
    s = str(value or '')
    return (s[:12] + '…(redacted)') if len(s) > 12 else s


def get_token(trace=None):
    """Mint a GP API Bearer token carrying the app's full scope (incl. LNK_POST_Create).
    secret = sha512(nonce + appKey); the App Key never reaches the browser. If `trace`
    is given, record the (redacted) request/response for the API Explorer."""
    nonce  = datetime.now(timezone.utc).isoformat()
    secret = hashlib.sha512((nonce + os.getenv('GP_APP_KEY', '')).encode()).hexdigest()
    req_body = {
        'app_id':     os.getenv('GP_APP_ID'),
        'nonce':      nonce,
        'secret':     secret,
        'grant_type': 'client_credentials',
    }
    resp = requests.post(
        f'{GP_BASE}/accesstoken',
        json=req_body,
        headers={'X-GP-Version': GP_VERSION},
        timeout=10,
    )
    data = resp.json()
    if trace is not None:
        trace.append({'step': 'token', 'dir': 'request', 'label': 'Create Access Token',
                      'method': 'POST', 'endpoint': '/ucp/accesstoken',
                      'body': {**req_body, 'secret': redact_secret(secret)}})
        trace.append({'step': 'token', 'dir': 'response', 'label': 'Create Access Token',
                      'status': resp.status_code,
                      'body': {**data, 'token': redact_secret(data['token'])} if data.get('token') else data})
    if not resp.ok:
        raise RuntimeError(data.get('detailed_error_description') or data.get('error_code') or 'Access token request failed')
    return data['token']


def base_url():
    """Public origin used to build the link's return_url / status_url. Honours
    BASE_URL (set it to a tunnel so the GP sandbox can reach /webhook), else the
    request origin."""
    if os.getenv('BASE_URL'):
        return os.getenv('BASE_URL').rstrip('/')
    return request.host_url.rstrip('/')


def build_link_body(amount, currency, config, reference, payer):
    """Build the GP API HOSTED_PAYMENT_PAGE link request. Required fields learned
    from the live API: top-level `reference`, `order.amount`, and `payer.email`.
    Amounts are sent in minor units (cents)."""
    minor = str(round(float(amount) * 100))
    cfg   = config or {}
    cur     = currency or 'USD'
    country = COUNTRY_FOR.get(cur, 'US')

    # order.transaction_configuration — APMs are enabled by adding their method
    # strings to allowed_payment_methods (alongside the mandatory "CARD").
    apms = [a for a in (cfg.get('apms') or []) if a]
    transaction_configuration = {
        'channel':                  'CNP',
        'country':                  country,
        'capture_mode':             'AUTO',
        'currency_conversion_mode': 'YES' if cfg.get('dcc') else 'NO',
        'allowed_payment_methods':  ['CARD'] + apms,
    }
    if cfg.get('cardStorage'):
        transaction_configuration['enable_card_storage'] = True

    # order.payment_method_configuration — 3DS preference + digital wallets provider list.
    payment_method_configuration = {
        'authentication': {'preference': 'CHALLENGE_PREFERRED' if cfg.get('threeds') else 'NO_CHALLENGE_REQUESTED'}
    }
    if cfg.get('digitalWallets'):
        payment_method_configuration['digital_wallets'] = {'provider': ['googlepay', 'applepay']}

    return {
        'account_name':    os.getenv('GP_ACCOUNT_NAME'),   # transaction_processing_hpp
        'type':            'HOSTED_PAYMENT_PAGE',
        'usage_mode':      'SINGLE',
        'usage_limit':     '1',
        'reference':       reference,
        'name':            'HPP Demo Transaction',
        'description':     'Hosted Payment Page transaction from the GP API sample',
        'expiration_date': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        'order': {
            'amount':   minor,
            'currency': cur,
            'reference': reference,
            'transaction_configuration':    transaction_configuration,
            'payment_method_configuration': payment_method_configuration,
        },
        'transactions': {
            'amount':   minor,
            'channel':  'CNP',
            'country':  country,
            'currency': cur,
        },
        'payer': {
            'email': (payer or {}).get('email') or 'sandbox.payer@example.com',
            'name':  (payer or {}).get('name')  or 'Sandbox Payer',
        },
        'notifications': {
            'return_url': f'{base_url()}/?reference={reference}',
            'status_url': f'{base_url()}/webhook',
        },
    }


def classify(status):
    """Map a GP transaction status to success / declined / pending. A successful
    3-D Secure hosted sale settles as PREAUTHORIZED (not CAPTURED)."""
    s = (status or '').upper()
    if s in ('PREAUTHORIZED', 'CAPTURED', 'SUCCESS'):
        return 'success'
    if s in ('DECLINED', 'REJECTED', 'CANCELLED'):
        return 'declined'
    return 'pending'


# ─── GET / ───────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return app.send_static_file('index.html')


# ─── POST /create-hpp-link ───────────────────────────────────────────────────
@app.route('/create-hpp-link', methods=['POST'])
def create_hpp_link():
    body = request.get_json(silent=True) or {}
    try:
        amount = float(body.get('amount', 0))
    except (TypeError, ValueError):
        amount = 0.0
    if amount <= 0:
        return jsonify({'success': False, 'error': 'A positive amount is required'}), 400

    # Record each GP API call (request + response) for the UI's API Explorer.
    api_calls = []
    try:
        token     = get_token(api_calls)
        reference = f'order-{int(time.time() * 1000)}'
        link_body = build_link_body(amount, body.get('currency'), body.get('config'), reference, body.get('payer'))

        api_calls.append({'step': 'link', 'dir': 'request', 'label': 'Create a link',
                          'method': 'POST', 'endpoint': '/ucp/links', 'body': link_body})

        resp = requests.post(
            f'{GP_BASE}/links',
            json=link_body,
            headers={'Authorization': f'Bearer {token}', 'X-GP-Version': GP_VERSION},
            timeout=30,
        )
        data = resp.json()
        api_calls.append({'step': 'link', 'dir': 'response', 'label': 'Create a link',
                          'status': resp.status_code, 'body': data})
        if not resp.ok:
            msg = data.get('detailed_error_description') or data.get('error_code') or 'Link creation failed'
            return jsonify({'success': False, 'error': msg, 'apiCalls': api_calls}), 400

        return jsonify({'success': True, 'id': data.get('id'), 'url': data.get('url'),
                        'reference': reference, 'apiCalls': api_calls})
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc), 'apiCalls': api_calls}), 500


# ─── GET /payment-status ─────────────────────────────────────────────────────
@app.route('/payment-status')
def payment_status():
    reference = request.args.get('reference')
    if not reference:
        return jsonify({'success': False, 'error': 'reference is required'}), 400

    try:
        token = get_token()
        resp = requests.get(
            f'{GP_BASE}/transactions',
            params={'reference': reference},
            headers={'Authorization': f'Bearer {token}', 'X-GP-Version': GP_VERSION},
            timeout=15,
        )
        data = resp.json()
        txns = data.get('transactions') or []
        if not txns:
            # No transaction recorded yet — the customer hasn't finished paying.
            return jsonify({'success': True, 'outcome': 'pending', 'status': 'PENDING'})

        txn  = txns[0]
        card = (txn.get('payment_method') or {}).get('card') or {}
        amount_minor = txn.get('amount')
        return jsonify({
            'success':       True,
            'outcome':       classify(txn.get('status')),
            'status':        txn.get('status'),
            'transactionId': txn.get('id'),
            'amount':        (int(amount_minor) / 100) if amount_minor else None,
            'currency':      txn.get('currency'),
            'cardDetails': {
                'brand':        card.get('brand'),
                'maskedNumber': card.get('masked_number_last4'),
            },
        })
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


# ─── POST /webhook ───────────────────────────────────────────────────────────
# Receives GP API notifications. In production: uncomment the HMAC-SHA256 check.
@app.route('/webhook', methods=['POST'])
def webhook():
    payload = request.get_data(as_text=True)

    # sig      = request.headers.get('X-GP-Signature', '')
    # expected = hmac.new(os.getenv('GP_WEBHOOK_SECRET', '').encode(), payload.encode(), 'sha256').hexdigest()
    # if sig != expected:
    #     return 'Unauthorized', 401

    try:
        event = json.loads(payload)
        webhook_events.appendleft({
            'receivedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            **event,
        })
        print(f"[Webhook] type={event.get('type')} id={event.get('id')}")
        return 'OK', 200
    except Exception:
        return 'Invalid JSON payload', 400


# ─── GET /webhook-events ─────────────────────────────────────────────────────
@app.route('/webhook-events')
def get_webhook_events():
    return jsonify(list(webhook_events))


# ─── Start ───────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.getenv('PORT', 8000))
    print(f'GP API Hosted Payment Page (Python) running → http://localhost:{port}')
    app.run(host='0.0.0.0', port=port)
