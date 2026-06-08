<?php
/**
 * POST /webhook
 *
 * Receives GP API transaction notifications.
 * Events are appended to webhook-log.json for the live UI log.
 *
 * In production: uncomment the HMAC-SHA256 signature verification block.
 */

declare(strict_types=1);

$payload   = (string)file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_GP_SIGNATURE'] ?? '';

/*
// Production signature verification
$webhookSecret = getenv('GP_WEBHOOK_SECRET') ?: '';
$expected      = hash_hmac('sha256', $payload, $webhookSecret);
if (!hash_equals($expected, $signature)) {
    http_response_code(401);
    echo 'Unauthorized';
    exit;
}
*/

$event = json_decode($payload, true);

if (!is_array($event)) {
    http_response_code(400);
    echo 'Invalid JSON payload';
    exit;
}

// Append to ring-buffer JSON log (last 20 events)
$logFile = __DIR__ . '/webhook-log.json';
$events  = [];

if (file_exists($logFile)) {
    $existing = json_decode((string)file_get_contents($logFile), true);
    if (is_array($existing)) {
        $events = $existing;
    }
}

array_unshift($events, array_merge(['receivedAt' => date('c')], $event));
$events = array_slice($events, 0, 20);
file_put_contents($logFile, json_encode($events), LOCK_EX);

// Log to server output for debugging
error_log(sprintf('[Webhook] type=%s id=%s', $event['type'] ?? 'UNKNOWN', $event['id'] ?? ''));

http_response_code(200);
echo 'OK';
