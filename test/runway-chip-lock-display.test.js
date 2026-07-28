// Regression test for the render()-loop display-gate change in runway-logic-test.html: the RWY
// chip used to be hidden unconditionally beyond <=2.0NM, regardless of how confident or locked
// the underlying prediction already was. Confirmed via live testing (a real approach) that this
// meant nothing showed until 2NM even though isGeometryTrustworthyForLock's margin-based lock
// (see runway-prediction geometry work) could -- and, per this test, does -- resolve and lock
// much earlier.
//
// The fix: once runwayLockCache actually has a locked entry for this aircraft (vetted by
// isGeometryTrustworthyForLock -- margin-decisive, sustained over multiple polls, under an outer
// distance ceiling), show it immediately regardless of current distance, since it can never
// downgrade once set. Anything NOT yet locked keeps the original <=2.0NM fallback unchanged.
//
// This test reproduces the exact decision logic from the render() loop (displayDecisionForPoll
// below mirrors it line-for-line) using the REAL extracted functions -- predictRunwayForAircraft,
// isGeometryTrustworthyForLock, runwayLockCache, getRunwayCacheKey -- so it exercises the actual
// production code paths, not a reimplementation of them.
//
// Same extraction approach as the other tests in this directory (see runway-prediction.test.js).
// Deliberately reads runway-logic-test.html, NOT index.html -- this fix lives only in the
// isolated test copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function extractFunction(html, name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name}() not found in runway-logic-test.html`);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `could not find end of ${name}() body`);
  return html.slice(start, end + 1);
}

function extractConstObject(html, name) {
  const marker = `const ${name} = {`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `const ${name} not found in runway-logic-test.html`);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `could not find end of const ${name}`);
  const semi = html.indexOf(';', end);
  return html.slice(start, semi + 1);
}

function extractStatement(html, marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `"${marker}" not found in runway-logic-test.html`);
  const end = html.indexOf(';', start);
  assert.notEqual(end, -1, `could not find end of statement starting "${marker}"`);
  return html.slice(start, end + 1);
}

// For statements whose body contains its own parens/braces (and so may contain semicolons
// before the real terminator) -- balances depth first, then finds the terminating ";".
function extractBalancedFrom(html, marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `"${marker}" not found in runway-logic-test.html`);
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `could not find end of statement starting "${marker}"`);
  const semi = html.indexOf(';', end);
  assert.notEqual(semi, -1, `could not find terminating ";" for statement starting "${marker}"`);
  return html.slice(start, semi + 1);
}

function loadModule() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'runway-logic-test.html'), 'utf8');

  const pieces = [
    extractConstObject(html, 'RUNWAYS'),
    extractStatement(html, 'const YBBN_STRIP_PAIRS ='),
    extractBalancedFrom(html, '(function deriveYbbnHeadingsFromThresholds('),
    extractConstObject(html, 'ARCHERFIELD'),
    extractBalancedFrom(html, 'const BAY_DIVIDER_LON = '),
    extractStatement(html, 'const BAY_DIVIDER_SLOPE_NM_PER_NM ='),
    extractStatement(html, 'const BAY_DIVIDER_INTERCEPT_NM ='),
    extractFunction(html, 'bayDividerLon'),
    extractStatement(html, 'const BAY_ENTRY_MIN_DIST_NM ='),
    extractStatement(html, 'const BAY_ENTRY_MIN_LON_OFFSET_NM ='),
    extractStatement(html, 'const BAY_SIDE_HISTORY_MAX_POLLS ='),
    extractFunction(html, 'archerfieldDividerLon'),
    extractStatement(html, 'const EARLY_CALL_MAX_ALT_FT_PER_NM ='),
    extractFunction(html, 'angleDiffDeg'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'projectPointNm'),
    extractFunction(html, 'predictRunwayGeometry'),
    extractFunction(html, 'getRunwayCacheKey'),
    extractFunction(html, 'extractRunwayFamily'),
    extractFunction(html, 'getRecentConfirmedFamily'),
    extractFunction(html, 'recordBayEntryPosition'),
    extractFunction(html, 'estimateBayEntryEarly'),
    extractFunction(html, 'estimateBaySideCurrent'),
    extractStatement(html, 'const GEOMETRY_AGREEMENT_MIN_STREAK ='),
    extractStatement(html, 'const GEOMETRY_AGREEMENT_MIN_SPAN_NM ='),
    extractStatement(html, 'const GEOMETRY_AGREEMENT_MAX_GAP_MS ='),
    extractFunction(html, 'recordGeometryAgreement'),
    extractFunction(html, 'getSustainedGeometrySide'),
    // predictRunwayGeometry's Archerfield branch references this directly; the rest of the
    // archerfieldAgreementCache infrastructure is needed for isArcherfieldSustainedForLock below.
    extractStatement(html, 'const ARCHERFIELD_AGREEMENT_MIN_OFFSET_NM ='),
    extractStatement(html, 'const ARCHERFIELD_AGREEMENT_MIN_STREAK ='),
    extractStatement(html, 'const ARCHERFIELD_AGREEMENT_MIN_SPAN_NM ='),
    extractStatement(html, 'const ARCHERFIELD_AGREEMENT_MAX_GAP_MS ='),
    extractFunction(html, 'recordArcherfieldAgreement'),
    extractFunction(html, 'getSustainedArcherfieldSide'),
    extractStatement(html, 'const RUNWAY_LOCK_OUTER_CEILING_NM ='),
    extractStatement(html, 'const RUNWAY_LOCK_WINNER_CROSS_FRACTION ='),
    extractStatement(html, 'const RUNWAY_LOCK_MARGIN_FRACTION ='),
    extractFunction(html, 'isGeometryTrustworthyForLock'),
    extractFunction(html, 'isArcherfieldSustainedForLock'),
    extractFunction(html, 'predictRunwayForAircraft'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    const bayEntryCache = new Map();
    const runwayLockCache = new Map();
    const baySideHistoryCache = new Map();
    const geometryAgreementCache = new Map();
    const archerfieldAgreementCache = new Map();
    ${pieces}

    // Mirrors the render()-loop display decision in runway-logic-test.html line-for-line,
    // using the real functions above rather than reimplementing their logic.
    function displayDecisionForPoll(it) {
      const dnm = it._dist_nm;
      const _rk = getRunwayCacheKey(it);
      let rwyInfo = null;
      const cached = _rk ? runwayLockCache.get(_rk) : null;
      if (cached && typeof cached.name === 'string' && cached.name) {
        rwyInfo = { name: cached.name, level: 'high' };
      } else {
        rwyInfo = predictRunwayForAircraft(it);
        if (_rk && rwyInfo && isArcherfieldSustainedForLock(rwyInfo, dnm, _rk)) {
          runwayLockCache.set(_rk, { name: rwyInfo.name, ts: Date.now() });
          rwyInfo = { name: rwyInfo.name, level: 'high' };
        } else if (_rk && rwyInfo && isGeometryTrustworthyForLock(rwyInfo, dnm, _rk)) {
          runwayLockCache.set(_rk, { name: rwyInfo.name, ts: Date.now() });
        }
      }
      const lockedNow = _rk ? runwayLockCache.get(_rk) : null;
      const isLocked = !!(lockedNow && typeof lockedNow.name === 'string' && lockedNow.name);
      const _dnm1 = (typeof dnm === 'number' && isFinite(dnm)) ? (Math.round(dnm * 10) / 10) : null;
      if (!isLocked && !(_dnm1 != null && _dnm1 <= 2.0)) {
        rwyInfo = null;
      }
      return { dnm, isLocked, name: rwyInfo ? rwyInfo.name : null, level: rwyInfo ? rwyInfo.level : null };
    }

    return {
      RUNWAYS,
      projectPointNm,
      archerfieldDividerLon,
      displayDecisionForPoll,
      runwayLockCache,
      setAPT: (apt) => { APT = apt; },
    };
  })`;

  // Note: `wrapper` must sit directly after `return` with no line break -- ASI would otherwise
  // turn `return\n(function...)` into a bare `return;` followed by a dead expression.
  return new Function(`return ${wrapper.trim()};`)()();
}

const YBBN = { icao: 'YBBN', lat: -27.3842, lon: 153.1175 };

function loadPredictor() {
  const mod = loadModule();
  mod.setAPT(YBBN);
  return mod;
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R_NM = 3440.065;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

test('a genuinely converging approach reveals the RWY chip once locked, well before 2NM, and never hides it again', () => {
  const mod = loadPredictor();
  const rwy = mod.RUNWAYS.YBBN.find((r) => r.name === '19R');
  const approachBearing = (rwy.heading + 180) % 360;
  const distances = [9, 7, 5, 3.5, 2.5, 1.5, 0.8, 0.3];

  const trace = distances.map((d) => {
    const [lat, lon] = mod.projectPointNm(rwy.thrLat, rwy.thrLon, approachBearing, d);
    const dnm = haversineNm(lat, lon, YBBN.lat, YBBN.lon);
    const it = { lat, lon, track: rwy.heading, _dist_nm: dnm, alt_baro: Math.max(50, 300 * d), reg: 'TESTCONVERGE' };
    return mod.displayDecisionForPoll(it);
  });

  // Must reveal (isLocked, name === '19R') at SOME point beyond 2NM -- proving the fix actually
  // shows a result earlier than the old flat "<=2.0nm" cap would have allowed.
  const firstLockedIdx = trace.findIndex((t) => t.isLocked);
  assert.ok(firstLockedIdx !== -1, 'expected the approach to lock at some point');
  assert.ok(trace[firstLockedIdx].dnm > 2.0, `expected the first lock to happen beyond 2NM, but locked at ${trace[firstLockedIdx].dnm.toFixed(2)}NM`);
  assert.equal(trace[firstLockedIdx].name, '19R');

  // Once locked, every later poll (including all the way in to landing) must keep showing the
  // same side -- never re-hidden, never flipped.
  for (const t of trace.slice(firstLockedIdx)) {
    assert.equal(t.isLocked, true, `expected to stay locked at ${t.dnm.toFixed(2)}NM`);
    assert.equal(t.name, '19R', `expected to keep showing 19R at ${t.dnm.toFixed(2)}NM, got ${JSON.stringify(t)}`);
  }

  // And nothing should have been shown before the lock -- this isn't "always show early", it's
  // "show early only once genuinely trustworthy".
  for (const t of trace.slice(0, firstLockedIdx)) {
    assert.equal(t.name, null, `expected no display yet at ${t.dnm.toFixed(2)}NM (not yet locked)`);
  }
});

test('an isolated single poll with no history does not reveal early, even if geometry alone would be decisive', () => {
  const mod = loadPredictor();
  const rwy = mod.RUNWAYS.YBBN.find((r) => r.name === '19L');
  const approachBearing = (rwy.heading + 180) % 360;
  const [lat, lon] = mod.projectPointNm(rwy.thrLat, rwy.thrLon, approachBearing, 6);
  const dnm = haversineNm(lat, lon, YBBN.lat, YBBN.lon);
  const it = { lat, lon, track: rwy.heading, _dist_nm: dnm, alt_baro: 1800, reg: 'TESTISOLATED' };

  const result = mod.displayDecisionForPoll(it);
  assert.equal(result.isLocked, false);
  assert.equal(result.name, null, 'a single decisive-looking poll with no sustained streak must not display early');
});

test('a fresh, not-yet-locked result still displays once inside the original <=2.0NM fallback (unchanged behavior)', () => {
  const mod = loadPredictor();
  const rwy = mod.RUNWAYS.YBBN.find((r) => r.name === '01L');
  const approachBearing = (rwy.heading + 180) % 360;
  const [lat, lon] = mod.projectPointNm(rwy.thrLat, rwy.thrLon, approachBearing, 1.5);
  const dnm = haversineNm(lat, lon, YBBN.lat, YBBN.lon);
  const it = { lat, lon, track: rwy.heading, _dist_nm: dnm, alt_baro: 400, reg: 'TESTCLOSEIN' };

  const result = mod.displayDecisionForPoll(it);
  assert.equal(result.isLocked, false, 'sanity: a single fresh poll should not itself be locked yet');
  assert.equal(result.name, '01L', 'the original <=2.0NM fallback must still reveal a fresh, non-locked result close-in');
});

// ===== Archerfield-sustained lock (the 01-family equivalent of the cross-track lock above) =====
//
// The Archerfield 01L/01R early-call rule (see predictRunwayGeometry) short-circuits BEFORE the
// cross-track/highRaw logic ever runs, always returning level: 'likely+' -- so a 01-family
// approach could never reach isGeometryTrustworthyForLock's 'high'-only gate at all, no matter
// how converged it was, and stayed hidden until <=2.0NM regardless (confirmed live: two real
// approaches, both stuck on "Check map to confirm runway" from 12NM down to 2NM). This mirrors
// the cross-track lock tests above, but for isArcherfieldSustainedForLock's separate streak
// (archerfieldAgreementCache) instead.

test('a genuine, sustained 01-family approach reveals the RWY chip once locked, well before 2NM, and never hides it again', () => {
  const mod = loadPredictor();
  const rwy = mod.RUNWAYS.YBBN.find((r) => r.name === '01L');
  const approachBearing = (rwy.heading + 180) % 360; // south of the threshold
  const distances = [20, 17, 14, 11, 8, 5.5, 3.5, 2.2, 1.2, 0.4];

  const trace = distances.map((d) => {
    const [lat, lon] = mod.projectPointNm(rwy.thrLat, rwy.thrLon, approachBearing, d);
    const dnm = haversineNm(lat, lon, YBBN.lat, YBBN.lon);
    const it = { lat, lon, track: rwy.heading, _dist_nm: dnm, alt_baro: Math.max(50, 300 * d), reg: 'ARCHTESTCONVERGE' };
    return mod.displayDecisionForPoll(it);
  });

  const firstLockedIdx = trace.findIndex((t) => t.isLocked);
  assert.ok(firstLockedIdx !== -1, 'expected the approach to lock at some point');
  assert.ok(trace[firstLockedIdx].dnm > 2.0, `expected the first lock to happen beyond 2NM, but locked at ${trace[firstLockedIdx].dnm.toFixed(2)}NM`);
  assert.equal(trace[firstLockedIdx].name, '01L');
  // Locking should show 'high' styling immediately on the same poll it locks, not lag one poll
  // behind showing 'likely+' first (see the cosmetic fix in render()'s write branch).
  assert.equal(trace[firstLockedIdx].level, 'high');

  for (const t of trace.slice(firstLockedIdx)) {
    assert.equal(t.isLocked, true, `expected to stay locked at ${t.dnm.toFixed(2)}NM`);
    assert.equal(t.name, '01L', `expected to keep showing 01L at ${t.dnm.toFixed(2)}NM, got ${JSON.stringify(t)}`);
  }

  for (const t of trace.slice(0, firstLockedIdx)) {
    assert.equal(t.name, null, `expected no display yet at ${t.dnm.toFixed(2)}NM (not yet locked)`);
  }
});

test('an isolated single Archerfield poll with no history does not reveal early', () => {
  const mod = loadPredictor();
  const rwy = mod.RUNWAYS.YBBN.find((r) => r.name === '01L');
  const approachBearing = (rwy.heading + 180) % 360;
  const [lat, lon] = mod.projectPointNm(rwy.thrLat, rwy.thrLon, approachBearing, 12);
  const dnm = haversineNm(lat, lon, YBBN.lat, YBBN.lon);
  const it = { lat, lon, track: rwy.heading, _dist_nm: dnm, alt_baro: 1500, reg: 'ARCHISOLATED' };

  const result = mod.displayDecisionForPoll(it);
  assert.equal(result.isLocked, false);
  assert.equal(result.name, null, 'a single confident-looking Archerfield read with no sustained streak must not display early');
});

test('polls sitting right on the Archerfield divider (not confidently on either side) never build a lockable streak', () => {
  const mod = loadPredictor();
  const rwy01L = mod.RUNWAYS.YBBN.find((r) => r.name === '01L');
  // Sit exactly ON the TRUE divider (archerfieldDividerLon, which projects each runway's own
  // centerline to the aircraft's own latitude -- NOT the static raw threshold-longitude
  // midpoint, since 01L/01R have different threshold latitudes too) at each test latitude --
  // an ambiguous position, not a confident side call, even though the binary >/< comparison in
  // predictRunwayGeometry still has to name SOME side.
  const results = [];
  for (let i = 0; i < 6; i++) {
    const lat = -27.65 - i * 0.02;
    const lon = mod.archerfieldDividerLon(lat);
    const it = { lat, lon, track: rwy01L.heading, _dist_nm: 15 - i, alt_baro: 1200, reg: 'ARCHSTRADDLE' };
    results.push(mod.displayDecisionForPoll(it));
  }
  for (const r of results) {
    assert.equal(r.isLocked, false, `expected an ambiguous, on-the-divider read to never lock, got ${JSON.stringify(r)}`);
  }
});
