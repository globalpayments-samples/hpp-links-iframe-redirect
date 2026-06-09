"""
Global Payments – Drop-In UI Sample (Python / Flask)

Endpoints:
  GET  /access-token     — generate a limited-scope frontend token for Drop-In UI
  POST /process-payment  — charge a single-use token returned by the Drop-In UI
  POST /webhook          — receive GP API transaction notifications
  GET  /webhook-events   — tail recent webhook events (for the live UI log)
"""

import hashlib
import hmac
import json
import os
import time
from collections import deque

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__, static_folder='.')

# In-memory ring-buffer for the live webhook event log (last 20 notifications)
webhook_events = deque(maxlen=20)

GP_BASE    = 'https://apis.sandbox.globalpay.com/ucp'
GP_VERSION = '2021-03-22'


def _fetch_token(permissions=None):
    """Request a GP API access token. Pass a permissions list for scoped tokens."""
    nonce  = str(int(time.time() * 1000))
    secret = hashlib.sha512((nonce + os.getenv('GP_APP_KEY', '')).encode()).hexdigest()

    payload = {
        'app_id':     os.getenv('GP_APP_ID'),
        'nonce':      nonce,
        'secret':     secret,
        'grant_type': 'client_credentials',
    }
    if permissions:
        payload['permissions'] = permissions

    resp = requests.post(
        f'{GP_BASE}/accesstoken',
        json=payload,
        headers={'X-GP-Version': GP_VERSION},
        timeout=10,
    )
    data = resp.json()
    if not resp.ok:
        raise RuntimeError(data.get('detail', 'Access token request failed'))
    return data['token']


# ─── GET / ───────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return app.send_static_file('index.html')


# ─── GET /access-token ───────────────────────────────────────────────────────
# Returns a short-lived, PMT_POST_Create_Single-scoped access token so the
# Drop-In UI can call GlobalPayments.configure() without exposing the App Key.
@app.route('/access-token')
def access_token():
    try:
        token = _fetch_token(permissions=['PMT_POST_Create_Single'])
        return jsonify({'token': token, 'env': 'sandbox'})
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


# ─── POST /process-payment ───────────────────────────────────────────────────
# Charges the single-use paymentReference returned by the Drop-In UI
# token-success event. Raw card data never reaches this server.
@app.route('/process-payment', methods=['POST'])
def process_payment():
    body              = request.get_json(silent=True) or {}
    payment_reference = str(body.get('payment_reference', '')).strip()
    try:
        amount = float(body.get('amount', 0))
    except (TypeError, ValueError):
        amount = 0.0

    if not payment_reference or amount <= 0:
        return jsonify({
            'success': False,
            'error':   'payment_reference and a positive amount are required',
        }), 400

    try:
        token = _fetch_token()

        # GP API REST endpoint expects amount in minor currency units (cents)
        amount_minor = str(round(amount * 100))

        resp = requests.post(
            f'{GP_BASE}/transactions',
            json={
                'account_name':   os.getenv('GP_ACCOUNT_NAME'),
                'channel':        'CNP',
                'type':           'SALE',
                'amount':         amount_minor,
                'currency':       'USD',
                'reference':      f'ORD-{int(time.time())}',
                'payment_method': {'id': payment_reference},
            },
            headers={
                'Authorization': f'Bearer {token}',
                'X-GP-Version':  GP_VERSION,
            },
            timeout=30,
        )

        result = resp.json()

        if not resp.ok:
            return jsonify({
                'success': False,
                'error':   result.get('detail', 'Payment failed'),
            }), 400

        status = result.get('status', '')
        card   = result.get('payment_method', {}).get('card', {})

        if status == 'DECLINED':
            return jsonify({
                'success': False,
                'error':   result.get('payment_method', {}).get('message', 'Payment declined by issuer.'),
            }), 400

        return jsonify({
            'success':       True,
            'transactionId': result.get('id'),
            'amount':        amount,
            'status':        status,
            'cardDetails': {
                'brand':        card.get('brand'),
                'maskedNumber': card.get('masked_number_last4'),
            },
        })

    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


# ─── POST /webhook ───────────────────────────────────────────────────────────
# Receives GP API transaction notifications.
# In production: uncomment the HMAC-SHA256 signature verification block.
@app.route('/webhook', methods=['POST'])
def webhook():
    payload = request.get_data(as_text=True)

    # Production: verify signature
    # sig      = request.headers.get('X-GP-Signature', '')
    # expected = hmac.new(
    #     os.getenv('GP_WEBHOOK_SECRET', '').encode(),
    #     payload.encode(), 'sha256'
    # ).hexdigest()
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
# Used by the UI to tail the in-memory webhook event ring.
@app.route('/webhook-events')
def get_webhook_events():
    return jsonify(list(webhook_events))


# ─── Start ───────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.getenv('PORT', 8000))
    print(f'GP API Drop-In UI (Python) running → http://localhost:{port}')
    app.run(host='0.0.0.0', port=port)
