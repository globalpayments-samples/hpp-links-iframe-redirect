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
$country  = COUNTRY_FOR[$currency] ?? 'US';

// order.transaction_configuration — APMs are enabled by adding their method strings
// to allowed_payment_methods (alongside the mandatory "CARD").
$apms = array_values(array_filter($config['apms'] ?? []));
$transactionConfiguration = [
    'channel'                  => 'CNP',
    'country'                  => $country,
    'capture_mode'             => 'AUTO',
    'currency_conversion_mode' => !empty($config['dcc']) ? 'YES' : 'NO',
    'allowed_payment_methods'  => array_merge(['CARD'], $apms),
];
if (!empty($config['cardStorage'])) $transactionConfiguration['enable_card_storage'] = true;

// order.payment_method_configuration — 3DS preference + digital wallets provider list.
$paymentMethodConfiguration = [
    'authentication' => ['preference' => !empty($config['threeds']) ? 'CHALLENGE_PREFERRED' : 'NO_CHALLENGE_REQUESTED'],
];
if (!empty($config['digitalWallets'])) {
    $paymentMethodConfiguration['digital_wallets'] = ['provider' => ['googlepay', 'applepay']];
}

// Records each GP API call (request + response) for the UI's API Explorer.
$apiCalls = [];
try {
    $token = gp_token($apiCalls);

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
            'transaction_configuration'    => $transactionConfiguration,
            'payment_method_configuration' => $paymentMethodConfiguration,
        ],
        'transactions' => [
            'amount'   => $minor,
            'channel'  => 'CNP',
            'country'  => $country,
            'currency' => $currency,
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

    $apiCalls[] = ['step' => 'link', 'dir' => 'request', 'label' => 'Create a link',
                   'method' => 'POST', 'endpoint' => '/ucp/links', 'body' => $linkBody];

    [$status, $data] = gp_request('POST', GP_BASE . '/links', [
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json',
        'X-GP-Version: ' . GP_VERSION,
    ], json_encode($linkBody));

    $apiCalls[] = ['step' => 'link', 'dir' => 'response', 'label' => 'Create a link',
                   'status' => $status, 'body' => $data];

    if ($status !== 200 || empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $data['detailed_error_description'] ?? $data['error_code'] ?? 'Link creation failed', 'apiCalls' => $apiCalls]);
        exit;
    }

    echo json_encode(['success' => true, 'id' => $data['id'], 'url' => $data['url'], 'reference' => $reference, 'apiCalls' => $apiCalls]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'apiCalls' => $apiCalls]);
}
