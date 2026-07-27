<?php
// Fallback only -- the Radar view's wind indicator (index-layout-test.html) tries a direct
// browser fetch to aviationweather.gov first, and only ever calls this if that's blocked (e.g.
// no CORS headers on the upstream response). Same pattern as proxy.php.
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

$ids = strtoupper(trim($_GET['ids'] ?? ''));

header("Content-Type: application/json; charset=utf-8");
if (!preg_match('/^[A-Z0-9]{3,4}$/', $ids)) {
  http_response_code(400);
  echo json_encode(["error" => "invalid_ids"]);
  exit;
}

$url = "https://aviationweather.gov/api/data/metar?ids=" . urlencode($ids) . "&format=json";

$resp = null;
$code = 0;

if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
  curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
  curl_setopt($ch, CURLOPT_USERAGENT, "ShotLog-v0.2.0");
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
} else {
  $resp = @file_get_contents($url);
  $code = $resp ? 200 : 0;
}

if (!$resp || ($code && $code >= 400)) {
  http_response_code(502);
  echo json_encode(["error" => "proxy_failed", "upstream_http" => $code, "url" => $url]);
  exit;
}
echo $resp;
