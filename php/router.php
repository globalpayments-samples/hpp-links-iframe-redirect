<?php
/**
 * PHP built-in server router.
 * Routes API paths to their handler files; all other requests
 * fall through to static file serving (index.html, assets, etc.).
 *
 * Usage:  php -S 0.0.0.0:8000 router.php
 */

declare(strict_types=1);

$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$base   = __DIR__;

$routes = [
    ['GET',  '/access-token',   'access-token.php'],
    ['POST', '/process-payment','process-payment.php'],
    ['POST', '/webhook',        'webhook.php'],
    ['GET',  '/webhook-events', 'webhook-events.php'],
];

foreach ($routes as [$routeMethod, $routePath, $file]) {
    if ($method === $routeMethod && $uri === $routePath) {
        require $base . '/' . $file;
        return true;
    }
}

// Let the built-in server handle static files
return false;
