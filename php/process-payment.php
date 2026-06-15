<?php
/**
 * POST /process-payment
 *
 * Charges the single-use paymentReference returned by the Drop-In UI
 * token-success event. Raw card data never reaches this server.
 *
 * PHP >= 7.4
 */

declare(strict_types=1);

require_once 'vendor/autoload.php';

use Dotenv\Dotenv;
use GlobalPayments\Api\Entities\Exceptions\ApiException;
use GlobalPayments\Api\Entities\GpApi\AccessTokenInfo;
use GlobalPayments\Api\PaymentMethods\CreditCardData;
use GlobalPayments\Api\ServiceConfigs\Gateways\GpApiConfig;
use GlobalPayments\Api\ServicesContainer;

$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();

header('Content-Type: application/json');

// ─── Configure GP API SDK ────────────────────────────────────────────────────
$config              = new GpApiConfig();
$config->appId       = $_ENV['GP_APP_ID'];
$config->appKey      = $_ENV['GP_APP_KEY'];
$config->channel     = \GlobalPayments\Api\Entities\Enums\Channel::CardNotPresent;
$config->environment = \GlobalPayments\Api\Entities\Enums\Environment::TEST;
$config->merchantId  = $_ENV['GP_MERCHANT_ID'];

// Pin the transaction-processing account so charges resolve to the right
// account (parity with the Node/Java/.NET implementations).
$accessTokenInfo = new AccessTokenInfo();
$accessTokenInfo->transactionProcessingAccountName = $_ENV['GP_ACCOUNT_NAME'];
$config->accessTokenInfo = $accessTokenInfo;

ServicesContainer::configureService($config);

// ─── Validate input ──────────────────────────────────────────────────────────
$input            = json_decode(file_get_contents('php://input'), true) ?? [];
$paymentReference = trim((string)($input['payment_reference'] ?? ''));
$amount           = isset($input['amount']) ? floatval($input['amount']) : 0.0;

if ($paymentReference === '' || $amount <= 0.0) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error'   => 'payment_reference and a positive amount are required',
    ]);
    exit;
}

// ─── Charge the single-use token ─────────────────────────────────────────────
try {
    $card        = new CreditCardData();
    $card->token = $paymentReference;

    $response = $card->charge($amount)
        ->withCurrency('USD')
        ->withOrderId('ORD-' . time())
        ->execute();

    echo json_encode([
        'success'       => true,
        'transactionId' => $response->transactionId,
        'amount'        => $amount,
        'status'        => $response->responseMessage,
        'cardDetails'   => [
            'brand'        => $response->cardType,
            'maskedNumber' => $response->cardLast4,
        ],
    ]);
} catch (ApiException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
