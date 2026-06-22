<?php
/**
 * POST /create-hpp-link
 *
 * Creates a HOSTED_PAYMENT_PAGE link via the GP API Links API and returns the
 * GP-hosted URL for the page to render (iframe) or redirect to. Required fields
 * learned from the live API: top-level `reference`, `order.amount`, `payer.email`.
 */

declare(strict_types=1);

require_once __DIR__ . '/gp.php';

header('Content-Type: application/json');

$body   = json_decode((string)file_get_contents('php://input'), true) ?: [];
$amount = (float)($body['amount'] ?? 0);

if ($amount <= 0) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'A positive amount is required']);
    exit;
}

$config   = $body['config']   ?? [];
$currency = $body['currency'] ?? 'USD';
$payer    = $body['payer']    ?? [];
$minor    = (string)(int)round($amount * 100);
$reference = 'order-' . (int)(microtime(true) * 1000);

// Value-add toggles → transaction_configuration. 3-D Secure runs automatically on
// the hosted page; wallet/APM availability is account-provisioned, so these are
// best-effort hints (unknown fields are ignored by the API, not rejected).
$transactionConfiguration = ['country' => 'US', 'channel' => 'CNP'];
if (!empty($config['dcc']))         $transactionConfiguration['allow_dynamic_currency_conversion'] = true;
if (!empty($config['cardStorage'])) $transactionConfiguration['enable_card_storage']              = true;

$allowedPaymentMethods = ['CARD'];
if (!empty($config['digitalWallets'])) $allowedPaymentMethods[] = 'DIGITAL_WALLET';
if (!empty($config['apm']))            $allowedPaymentMethods[] = 'PAYPAL';

try {
    $token = gp_token();

    $linkBody = [
        'account_name'    => $_ENV['GP_ACCOUNT_NAME'] ?? '',   // transaction_processing_hpp
        'type'            => 'HOSTED_PAYMENT_PAGE',
        'usage_mode'      => 'SINGLE',
        'usage_limit'     => '1',
        'reference'       => $reference,
        'name'            => 'HPP Demo Transaction',
        'description'     => 'Hosted Payment Page transaction from the GP API sample',
        'expiration_date' => (new DateTime('+1 hour', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'),
        'order' => [
            'amount'    => $minor,
            'currency'  => $currency,
            'reference' => $reference,
            'transaction_configuration' => $transactionConfiguration,
        ],
        'transactions' => [
            'amount'                  => $minor,
            'channel'                 => 'CNP',
            'country'                 => 'US',
            'currency'                => $currency,
            'allowed_payment_methods' => $allowedPaymentMethods,
        ],
        'payer' => [
            'email' => $payer['email'] ?? 'sandbox.payer@example.com',
            'name'  => $payer['name']  ?? 'Sandbox Payer',
        ],
        'notifications' => [
            'return_url' => gp_base_url() . '/?reference=' . $reference,
            'status_url' => gp_base_url() . '/webhook',
        ],
    ];

    [$status, $data] = gp_request('POST', GP_BASE . '/links', [
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json',
        'X-GP-Version: ' . GP_VERSION,
    ], json_encode($linkBody));

    if ($status !== 200 || empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $data['detailed_error_description'] ?? $data['error_code'] ?? 'Link creation failed']);
        exit;
    }

    echo json_encode(['success' => true, 'id' => $data['id'], 'url' => $data['url'], 'reference' => $reference]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
