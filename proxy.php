<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

$lat = floatval($_GET['lat'] ?? 0);
$lon = floatval($_GET['lon'] ?? 0);
$radius = floatval($_GET['radius'] ?? 45);

if ($radius < 1) $radius = 1;
// Raised from 120 to 250 (Arrivals Board feature) -- adsb.lol's /v2/point/ endpoint accepts up
// to 250NM; every existing caller requests well under the old 120 cap, so this is additive and
// doesn't change any existing request's behaviour.
if ($radius > 250) $radius = 250;

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
