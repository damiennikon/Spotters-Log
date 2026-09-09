<?php
// Shared, best-effort protection for the standalone proxy endpoints
// (proxy.php, metar.php, routeset.php). None of these have a user account
// to check a token against -- Spotters Log has no login -- so this can't be
// real authentication. What it does do:
//
//  1. shotlog_origin_ok(): reject requests whose Origin or Referer header
//     isn't this site. A browser tab running this app's own JS always sends
//     one of these; a stray scanner, another site's script, or a bare curl
//     script generally doesn't bother faking either header.
//  2. shotlog_rate_limit_ok(): a per-IP request cap using a small file-based
//     counter, so a single script or misbehaving tab can't hammer the
//     upstream API (and burn everyone else's shared adsb.lol/CARTO/NOAA
//     rate limit) even if it does fake the headers above.
//
// A determined attacker who fakes Origin/Referer AND spreads requests
// across many IPs gets past both. That's an accepted trade-off at this
// project's actual scale (a personal tool shared with friends, not a
// public service with a security budget) -- the goal here is closing the
// "anyone who finds the URL" hole, not building real API auth.
//
// Fails OPEN on any internal error (can't write the rate-limit file, etc.)
// -- a broken rate limiter shouldn't take the whole Radar view down with
// it. Fails CLOSED (rejects) only on an actual origin/referer or rate-limit
// mismatch.

const SHOTLOG_ALLOWED_HOSTS = ['airscapephotos.com', 'www.airscapephotos.com'];

function shotlog_client_ip() {
  // Prefer a CDN-supplied real-client-IP header over REMOTE_ADDR, in case
  // this ever sits behind Cloudflare or similar (REMOTE_ADDR would then be
  // the CDN's edge IP, making every visitor look identical to the rate
  // limiter). Falls back through to REMOTE_ADDR when neither is present,
  // which is the common case on plain shared hosting.
  if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
    return trim($_SERVER['HTTP_CF_CONNECTING_IP']);
  }
  if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
    $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
    return trim($parts[0]);
  }
  return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function shotlog_origin_ok() {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  $referer = $_SERVER['HTTP_REFERER'] ?? '';
  $originHost = $origin !== '' ? parse_url($origin, PHP_URL_HOST) : null;
  $refererHost = $referer !== '' ? parse_url($referer, PHP_URL_HOST) : null;
  return in_array($originHost, SHOTLOG_ALLOWED_HOSTS, true)
      || in_array($refererHost, SHOTLOG_ALLOWED_HOSTS, true);
}

// Simple fixed-window counter per (bucket, IP), stored as one small JSON
// file per client under the system temp dir. flock() keeps concurrent
// requests from the same IP from racing each other's read-modify-write.
function shotlog_rate_limit_ok($bucket, $maxRequests, $windowSeconds) {
  try {
    $dir = sys_get_temp_dir() . '/shotlog_ratelimit';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
      return true; // can't set up storage -- fail open
    }
    $file = $dir . '/' . preg_replace('/[^a-z0-9]/i', '_', $bucket) . '_' . md5(shotlog_client_ip()) . '.json';
    $fh = @fopen($file, 'c+');
    if (!$fh) return true;

    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $data = $raw !== false ? json_decode($raw, true) : null;
    $now = microtime(true);

    if (!is_array($data) || !isset($data['start']) || ($now - $data['start']) > $windowSeconds) {
      $data = ['start' => $now, 'count' => 0];
    }
    $data['count'] = ($data['count'] ?? 0) + 1;
    $allowed = $data['count'] <= $maxRequests;

    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    return $allowed;
  } catch (\Throwable $e) {
    return true; // never let the rate limiter itself take the feature down
  }
}

function shotlog_reject($status, $error) {
  http_response_code($status);
  header("Content-Type: application/json; charset=utf-8");
  if ($status === 429) header("Retry-After: 30");
  echo json_encode(["error" => $error]);
  exit;
}

// Call once, near the top of each endpoint, after the OPTIONS/CORS-headers
// block and before doing any real work.
function shotlog_guard($bucket, $maxRequests, $windowSeconds) {
  if (!shotlog_origin_ok()) {
    shotlog_reject(403, "forbidden");
  }
  if (!shotlog_rate_limit_ok($bucket, $maxRequests, $windowSeconds)) {
    shotlog_reject(429, "rate_limited");
  }
}
