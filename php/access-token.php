<?php
/**
 * GET /access-token
 *
 * Generates a short-lived, PMT_POST_Create_Single-scoped access token
 * for the Drop-In UI frontend. The App Key is never sent to the browser.
 */

declare(strict_types=1);

require_once 'vendor/autoload.php';

use Dotenv\Dotenv;

$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();

header('Content-Type: application/json');

$nonce  = (string)(time() . rand(1000, 9999));
$secret = hash('sha512', $nonce . $_ENV['GP_APP_KEY']);

$payload = json_encode([
    'app_id'      => $_ENV['GP_APP_ID'],
    'nonce'       => $nonce,
    'secret'      => $secret,
    'grant_type'  => 'client_credentials',
    'permissions' => ['PMT_POST_Create_Single'],
]);

$ch = curl_init('https://apis.sandbox.globalpay.com/ucp/accesstoken');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'X-GP-Version: 2021-03-22',
    ],
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_TIMEOUT        => 10,
]);

$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($status !== 200 || $body === false) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Failed to obtain access token']);
    exit;
}

$data = json_decode($body, true);

if (empty($data['token'])) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $data['detail'] ?? 'No token in response']);
    exit;
}

echo json_encode(['token' => $data['token'], 'env' => 'sandbox']);
