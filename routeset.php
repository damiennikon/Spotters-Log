<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

header("Content-Type: application/json; charset=utf-8");

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(["error"=>"method_not_allowed"]);
  exit;
}

$body = file_get_contents('php://input');
if (!$body) {
  http_response_code(400);
  echo json_encode(["error"=>"empty_body"]);
  exit;
}

$url = "https://api.adsb.lol/api/0/routeset";

$resp = null;
$code = 0;

if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
  curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
  curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
  curl_setopt($ch, CURLOPT_USERAGENT, "ShotLog-v0.2.0");
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
} else {
  $ctx = stream_context_create([
    'http' => [
      'method' => 'POST',
      'header' => "Content-Type: application/json\r\n",
      'content' => $body,
      'timeout' => 15,
    ],
  ]);
  $resp = @file_get_contents($url, false, $ctx);
  $code = $resp ? 200 : 0;
}

if (!$resp || ($code && $code >= 400)) {
  http_response_code(502);
  echo json_encode(["error"=>"proxy_failed","upstream_http"=>$code,"url"=>$url]);
  exit;
}
echo $resp;
