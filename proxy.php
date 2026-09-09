<?php
require_once __DIR__ . '/shotlog-guard.php';

// This endpoint is unauthenticated (Spotters Log has no user accounts to
// check a token against) and was previously reachable, unthrottled, by
// anyone who found the URL -- not just this app. shotlog_guard() below adds
// two lightweight, best-effort checks: the caller's Origin/Referer must be
// this site, and a per-IP rate limit. Neither stops a determined attacker
// who fakes headers directly against this URL with curl, but both block
// the common cases (stray scanners, other sites' scripts, a runaway loop)
// that were previously free to hammer this proxy -- and by extension
// adsb.lol, whose rate limits are shared across every caller of this file,
// not per-visitor.
header("Access-Control-Allow-Origin: https://airscapephotos.com");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

shotlog_guard('proxy', 60, 30); // up to 60 requests / 30s per IP -- generous for several tabs/users behind one IP, well above one client's ~10s polling cadence

$lat = floatval($_GET['lat'] ?? 0);
$lon = floatval($_GET['lon'] ?? 0);
$radius = floatval($_GET['radius'] ?? 45);

if ($radius < 1) $radius = 1;
if ($radius > 120) $radius = 120;

$url = "https://api.adsb.lol/v2/point/$lat/$lon/$radius";

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

header("Content-Type: application/json; charset=utf-8");
if (!$resp || ($code && $code >= 400)) {
  http_response_code(502);
  echo json_encode(["error"=>"proxy_failed","upstream_http"=>$code,"url"=>$url]);
  exit;
}
echo $resp;
