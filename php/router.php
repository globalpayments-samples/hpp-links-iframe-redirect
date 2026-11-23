<?php
/**
 * PHP built-in server router.
 * Routes API paths to their handler files; all other requests
 * fall through to static file serving (index.html, assets, etc.).
 *
 * Usage:  ./run.sh
 */

declare(strict_types=1);

$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$base   = __DIR__;

$routes = [
    ['POST', '/create-hpp-link', 'create-hpp-link.php'],
    ['GET',  '/payment-status',  'payment-status.php'],
    ['POST', '/webhook',         'webhook.php'],
    ['GET',  '/webhook-events',  'webhook-events.php'],
];

foreach ($routes as [$routeMethod, $routePath, $file]) {
    if ($method === $routeMethod && $uri === $routePath) {
        require $base . '/' . $file;
        return true;
    }
}

// Anything else: serve the page, its assets and the endpoint scripts only,
// never .env, composer files, vendor/ or the server's own files
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
$isAsset = preg_match('#^/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.(?:html|css|js|png|jpe?g|gif|svg|ico|webp|woff2?)$#', $path);
$isEndpoint = preg_match('#^/[A-Za-z0-9_-]+\.php$#', $path) && $path !== '/router.php';
$isHidden = preg_match('#(^|/)(\.|vendor/|node_modules/)#', $path);

if ($path === '/' || (($isAsset || $isEndpoint) && !$isHidden)) {
    return false;
}

http_response_code(404);
echo 'Not Found';
return true;
