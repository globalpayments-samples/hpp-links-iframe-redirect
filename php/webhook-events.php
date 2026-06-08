<?php
/**
 * GET /webhook-events
 *
 * Returns the last 20 webhook events stored by webhook.php.
 * Used by the frontend to populate the live event log.
 */

declare(strict_types=1);

header('Content-Type: application/json');

$logFile = __DIR__ . '/webhook-log.json';

if (!file_exists($logFile)) {
    echo '[]';
    exit;
}

$events = json_decode((string)file_get_contents($logFile), true);
echo json_encode(is_array($events) ? $events : []);
