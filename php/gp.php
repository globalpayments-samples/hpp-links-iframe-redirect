<?php
/**
 * Shared GP API helpers for the Hosted Payment Page sample.
 * Token minting, base-URL derivation, REST helpers and status classification.
 */

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;

Dotenv::createImmutable(__DIR__)->safeLoad();

const GP_BASE    = 'https://apis.sandbox.globalpay.com/ucp';
const GP_VERSION = '2021-03-22';

// Country to send for each supported currency (drives APM availability on the
// hosted page); the processing account resolves the merchant.
const COUNTRY_FOR = ['USD' => 'US', 'EUR' => 'IE', 'GBP' => 'GB', 'CAD' => 'CA'];

/** Redact a bearer token / secret to a recognisable prefix for the API Explorer. */
function gp_redact(string $value): string
{
    return strlen($value) > 12 ? substr($value, 0, 12) . '…(redacted)' : $value;
}

/** A small curl wrapper returning [httpStatus, decodedJson]. */
function gp_request(string $method, string $url, array $headers, ?string $body = null): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING       => '',   // auto-decode gzip/deflate
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 30,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $raw    = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    return [$status, is_array($data) ? $data : []];
}

/**
 * Mint a GP API Bearer token carrying the app's full scope (incl. LNK_POST_Create).
 * If $trace is provided, append the (redacted) request/response for the API Explorer.
 */
function gp_token(?array &$trace = null): string
{
    $nonce  = (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    $secret = hash('sha512', $nonce . ($_ENV['GP_APP_KEY'] ?? ''));

    $reqBody = [
        'app_id'     => $_ENV['GP_APP_ID'] ?? '',
        'nonce'      => $nonce,
        'secret'     => $secret,
        'grant_type' => 'client_credentials',
    ];
    [$status, $data] = gp_request('POST', GP_BASE . '/accesstoken', [
        'Content-Type: application/json',
        'X-GP-Version: ' . GP_VERSION,
    ], json_encode($reqBody));

    if ($trace !== null) {
        $trace[] = ['step' => 'token', 'dir' => 'request', 'label' => 'Create Access Token',
                    'method' => 'POST', 'endpoint' => '/ucp/accesstoken',
                    'body' => array_merge($reqBody, ['secret' => gp_redact($secret)])];
        $resBody = $data;
        if (!empty($resBody['token'])) $resBody['token'] = gp_redact($resBody['token']);
        $trace[] = ['step' => 'token', 'dir' => 'response', 'label' => 'Create Access Token',
                    'status' => $status, 'body' => $resBody];
    }

    if ($status !== 200 || empty($data['token'])) {
        throw new RuntimeException($data['detailed_error_description'] ?? $data['error_code'] ?? 'Access token request failed');
    }
    return $data['token'];
}

/** Public origin used to build the link's return_url / status_url. */
function gp_base_url(): string
{
    if (!empty($_ENV['BASE_URL'])) {
        return rtrim($_ENV['BASE_URL'], '/');
    }
    $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host  = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $proto . '://' . $host;
}

/** Map a GP transaction status to success / declined / pending. */
function gp_classify(?string $status): string
{
    $s = strtoupper($status ?? '');
    if (in_array($s, ['PREAUTHORIZED', 'CAPTURED', 'SUCCESS'], true)) {
        return 'success';
    }
    if (in_array($s, ['DECLINED', 'REJECTED', 'CANCELLED'], true)) {
        return 'declined';
    }
    return 'pending';
}
