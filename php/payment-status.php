<?php
/**
 * GET /payment-status?reference=…
 *
 * Reads the outcome of a hosted payment by its order reference. Polled by the UI
 * (iframe mode) and read once on redirect-return.
 */

declare(strict_types=1);

require_once __DIR__ . '/gp.php';

header('Content-Type: application/json');

$reference = $_GET['reference'] ?? '';
if ($reference === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'reference is required']);
    exit;
}

try {
    $token = gp_token();
    [$status, $data] = gp_request('GET', GP_BASE . '/transactions?reference=' . urlencode($reference), [
        'Authorization: Bearer ' . $token,
        'X-GP-Version: ' . GP_VERSION,
    ]);

    $txn = $data['transactions'][0] ?? null;
    if (!$txn) {
        // No transaction recorded yet — the customer hasn't finished paying.
        echo json_encode(['success' => true, 'outcome' => 'pending', 'status' => 'PENDING']);
        exit;
    }

    $card  = $txn['payment_method']['card'] ?? [];
    $minor = $txn['amount'] ?? null;
    echo json_encode([
        'success'       => true,
        'outcome'       => gp_classify($txn['status'] ?? null),
        'status'        => $txn['status'] ?? null,
        'transactionId' => $txn['id'] ?? null,
        'amount'        => $minor !== null ? ((int)$minor) / 100 : null,
        'currency'      => $txn['currency'] ?? null,
        'cardDetails'   => [
            'brand'        => $card['brand'] ?? null,
            'maskedNumber' => $card['masked_number_last4'] ?? null,
        ],
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
