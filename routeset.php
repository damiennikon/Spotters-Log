<?php
// Standalone endpoint — does NOT bootstrap WordPress (no wp-load.php), so WP_DEBUG_LOG's
// error_log redirection never applies here. Failures are logged explicitly below via
// error_log() so they land in PHP's own error log instead of vanishing.

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

header("Content-Type: application/json; charset=utf-8");

// Belt-and-braces: guarantee this script can't run past typical reverse-proxy/gateway
// read timeouts (many hosts use 10-30s). Keeps us well under that even in worst case.
set_time_limit(12);

function routeset_fail($status, $error, array $extra = []) {
  http_response_code($status);
  echo json_encode(array_merge(["error" => $error], $extra));
  exit;
}

// Catches fatal errors / uncaught throwables that would otherwise crash the process
// with no JSON output (the "502 with nothing in the log" failure mode).
register_shutdown_function(function () {
  $err = error_get_last();
  if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    error_log("[routeset.php] fatal: {$err['message']} in {$err['file']}:{$err['line']}");
    if (!headers_sent()) {
      http_response_code(500);
      header("Content-Type: application/json; charset=utf-8");
    }
    echo json_encode(["error" => "internal_error"]);
  }
});

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  routeset_fail(405, "method_not_allowed");
}

$body = file_get_contents('php://input');
if (!$body) {
  routeset_fail(400, "empty_body");
}

// Sanity cap on payload size / batch size before doing any work or forwarding upstream.
const ROUTESET_MAX_BODY_BYTES = 200000; // ~200KB
const ROUTESET_MAX_PLANES = 200;

if (strlen($body) > ROUTESET_MAX_BODY_BYTES) {
  routeset_fail(413, "body_too_large");
}

$decoded = json_decode($body, true);
if (!is_array($decoded) || !isset($decoded['planes']) || !is_array($decoded['planes'])) {
  routeset_fail(400, "invalid_json");
}
if (count($decoded['planes']) > ROUTESET_MAX_PLANES) {
  routeset_fail(413, "too_many_planes", ["max" => ROUTESET_MAX_PLANES]);
}
if (!count($decoded['planes'])) {
  echo json_encode([]);
  exit;
}

$url = "https://api.adsb.lol/api/0/routeset";

try {
  $resp = null;
  $code = 0;

  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, "ShotLog-v0.2.0");
    $resp = curl_exec($ch);
    if ($resp === false) {
      error_log("[routeset.php] curl_exec failed: " . curl_error($ch));
    }
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
  } elseif (ini_get('allow_url_fopen')) {
    $ctx = stream_context_create([
      'http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $body,
        'timeout' => 10,
      ],
    ]);
    $resp = @file_get_contents($url, false, $ctx);
    $code = $resp ? 200 : 0;
  } else {
    error_log("[routeset.php] no HTTP client available: curl extension missing and allow_url_fopen disabled");
    routeset_fail(500, "no_http_client");
  }
} catch (\Throwable $e) {
  error_log("[routeset.php] exception during upstream request: " . $e->getMessage());
  routeset_fail(502, "proxy_exception");
}

if (!$resp || ($code && $code >= 400)) {
  error_log("[routeset.php] upstream failed, http_code={$code}");
  routeset_fail(502, "proxy_failed", ["upstream_http" => $code, "url" => $url]);
}
echo $resp;
