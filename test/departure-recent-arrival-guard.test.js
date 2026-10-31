// Tests the two guards added to classifyDepartures (index.html) that stop a landing aircraft
// from being shown as a departure:
//   FIX 1 - an already-classified "departure" that reports taxi-ground state again (back on the
//           ground at taxi speed) is dropped rather than tracked out to the cutoff.
//   FIX 2 - a brand-new classification is refused for an airframe that was in the arrivals list
//           within the last RECENT_ARRIVAL_BLOCK_MS (a landing's flare/rollout can otherwise pass
//           the ground->rotation transition test).
//
// Same extraction approach as test/runway-chip.test.js: index.html is a single IIFE with no
// module system, so we pull just the functions/consts classifyDepartures closes over out of the
// file and evaluate them standalone, with a test-supplied APT and fresh Maps per load so each
// test gets independent cache state.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function extractFunction(html, name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name}() not found in index.html`);

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

function extractStatement(html, marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `"${marker}" not found in index.html`);
  const end = html.indexOf(';', start);
  assert.notEqual(end, -1, `could not find end of statement starting "${marker}"`);
  return html.slice(start, end + 1);
}

function loadClassifyDepartures() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const pieces = [
    'const APT = { lat: -27.3842, lon: 153.1175 };', // stand-in airport reference point (YBBN-ish)
    extractFunction(html, 'nmFromMeters'),
    extractFunction(html, 'ft'),
    extractFunction(html, 'kt'),
    extractFunction(html, 'distNM'),
    extractFunction(html, 'isGroundish'),
    extractFunction(html, 'getRunwayCacheKey'),
    extractStatement(html, 'const DEP_RULES ='),
    extractStatement(html, 'const departureTrackCache ='),
    extractStatement(html, 'const recentArrivalsCache ='),
    extractStatement(html, 'const RECENT_ARRIVAL_BLOCK_MS ='),
    extractFunction(html, 'rawAltFtForDeparture'),
    extractFunction(html, 'isTaxiGroundState'),
    extractFunction(html, 'isRotationTransition'),
    extractFunction(html, 'classifyDepartures'),
  ].join('\n\n');

  return new Function(`${pieces}\nreturn { classifyDepartures, departureTrackCache, recentArrivalsCache, getRunwayCacheKey };`)();
}

// Aircraft sitting right on the airport reference point so distance-out is always well inside
// detectMaxNM/cutoffNM regardless of the scenario.
const BASE_LAT = -27.3842;
const BASE_LON = 153.1175;

function mkAircraft(overrides) {
  return Object.assign({
    flight: 'JST388',
    type: 'adsb_icao',
    lat: BASE_LAT,
    lon: BASE_LON,
  }, overrides);
}

test('(a) a real takeoff (ground then rotation, no prior arrival record) is classified as a departure', () => {
  const { classifyDepartures, departureTrackCache, getRunwayCacheKey } = loadClassifyDepartures();

  // Poll 1: taxiing out.
  const taxiOut = mkAircraft({ alt_baro: 'ground', gs: 20 });
  let out = classifyDepartures([taxiOut]);
  assert.equal(out.length, 0);
  assert.ok(departureTrackCache.has(getRunwayCacheKey(taxiOut)));

  // Poll 2: rotation transition.
  const rotating = mkAircraft({ alt_baro: 200, gs: 95, baro_rate: 500 });
  out = classifyDepartures([rotating]);
  assert.equal(out.length, 1);
  assert.equal(out[0]._kind, 'departure');
  assert.equal(out[0]._depSinceMs, 0);
});

test('(b) an airframe seen as an arrival 2 minutes ago is NOT classified even if it passes the rotation test', () => {
  const { classifyDepartures, departureTrackCache, recentArrivalsCache, getRunwayCacheKey } = loadClassifyDepartures();

  const p = mkAircraft({ alt_baro: 300, gs: 120, baro_rate: 400 });
  recentArrivalsCache.set(getRunwayCacheKey(p), Date.now() - 2 * 60 * 1000);

  const out = classifyDepartures([p]);
  assert.equal(out.length, 0);
  assert.equal(p._kind, undefined);
  assert.ok(!(departureTrackCache.get(getRunwayCacheKey(p)) || {}).classifiedAt);
});

test('(c) an already-classified departure that reports taxi-ground state is dropped from the list', () => {
  const { classifyDepartures, departureTrackCache, getRunwayCacheKey } = loadClassifyDepartures();

  const p = mkAircraft({ alt_baro: 'ground', gs: 18 });
  const key = getRunwayCacheKey(p);
  departureTrackCache.set(key, { ts: Date.now() - 60 * 1000, classifiedAt: Date.now() - 60 * 1000 });

  const out = classifyDepartures([p]);
  assert.equal(out.length, 0);
  assert.equal(departureTrackCache.has(key), false);
});

test('(d) the same airframe seen as an arrival 12 minutes ago genuinely takes off and IS classified', () => {
  const { classifyDepartures, departureTrackCache, recentArrivalsCache, getRunwayCacheKey } = loadClassifyDepartures();

  const key = getRunwayCacheKey(mkAircraft({}));
  recentArrivalsCache.set(key, Date.now() - 12 * 60 * 1000);

  // Poll 1: taxiing out.
  const taxiOut = mkAircraft({ alt_baro: 'ground', gs: 20 });
  classifyDepartures([taxiOut]);
  assert.ok(departureTrackCache.has(key));

  // Poll 2: rotation transition, well past the 10-minute block window.
  const rotating = mkAircraft({ alt_baro: 200, gs: 95, baro_rate: 500 });
  const out = classifyDepartures([rotating]);
  assert.equal(out.length, 1);
  assert.equal(out[0]._kind, 'departure');
});
