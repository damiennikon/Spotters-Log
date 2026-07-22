// Reproduces the LR552/VH-VEK misclassification: RWY chip showed 01R for an aircraft transiting
// north up the coast toward BNE at 16.6NM, 10,850ft, 287kt, -1344fpm -- clearly still descending
// from cruise on a STAR, not established on any final. Every OTHER aircraft tracked in the same
// session was landing/predicted 19-family -- 19 was the actual active runway direction that day,
// and LR552 was expected to land 19-family too once it curved around.
//
// The altitude-plausibility guard in predictRunwayGeometry() (see EARLY_CALL_MAX_ALT_FT_PER_NM,
// covered by archerfield-01-early-call.test.js) closes the "cold start" version of this gap --
// but it can't help when an aircraft is at a low, perfectly plausible altitude for its distance
// while still just transiting toward the field before curving around for the opposite runway
// direction: track+position alone can't distinguish that from genuinely being established,
// since flying a direct line toward the airport necessarily produces a track that matches
// whichever runway direction that line of travel happens to correspond to.
//
// This is what getRecentConfirmedFamily() / predictRunwayForAircraft()'s consensus check
// covers instead: runwayLockCache only ever holds 'high'-confidence, cross-track-verified,
// close-in (<=3NM) results -- real, trustworthy evidence of what's actually in use. A non-'high'
// early-call guess (from either predictRunwayGeometry's heuristics or estimateBayEntryEarly)
// that contradicts the most recently confirmed family is suppressed rather than shown wrong.
//
// Same extraction approach as the other tests in this directory: index.html is one big inline
// IIFE with no module system, so we pull just the functions/consts under test out of the file
// text and evaluate them standalone, wiring up a settable APT in place of the real
// loadAirport() flow.

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

function extractConstObject(html, name) {
  const marker = `const ${name} = {`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `const ${name} not found in index.html`);
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
  assert.notEqual(start, -1, `"${marker}" not found in index.html`);
  const end = html.indexOf(';', start);
  assert.notEqual(end, -1, `could not find end of statement starting "${marker}"`);
  return html.slice(start, end + 1);
}

function extractBalancedConst(html, name) {
  const marker = `const ${name} = `;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `const ${name} not found in index.html`);
  let depth = 0;
  let end = -1;
  for (let i = html.indexOf('(', start); i < html.length; i++) {
    const ch = html[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `could not find end of const ${name}`);
  const semi = html.indexOf(';', end);
  assert.notEqual(semi, -1, `could not find terminating ";" for const ${name}`);
  return html.slice(start, semi + 1);
}

function loadModule() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const pieces = [
    extractConstObject(html, 'RUNWAYS'),
    extractConstObject(html, 'ARCHERFIELD'),
    extractStatement(html, 'const ARCHERFIELD_DIVIDER_LON ='),
    extractFunction(html, 'archerfieldDividerLon'),
    extractStatement(html, 'const EARLY_CALL_MAX_ALT_FT_PER_NM ='),
    extractBalancedConst(html, 'BAY_DIVIDER_LON'),
    extractStatement(html, 'const BAY_ENTRY_MIN_DIST_NM ='),
    extractStatement(html, 'const BAY_ENTRY_MIN_LON_OFFSET_NM ='),
    extractStatement(html, 'const BAY_SIDE_HISTORY_MAX_POLLS ='),
    extractStatement(html, 'const ACTIVE_FAMILY_FRESH_MS ='),
    extractFunction(html, 'angleDiffDeg'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'predictRunwayGeometry'),
    extractFunction(html, 'recordBayEntryPosition'),
    extractFunction(html, 'estimateBayEntryEarly'),
    extractFunction(html, 'estimateBaySideCurrent'),
    extractFunction(html, 'getRunwayCacheKey'),
    extractFunction(html, 'extractRunwayFamily'),
    extractFunction(html, 'getRecentConfirmedFamily'),
    extractFunction(html, 'predictRunwayForAircraft'),
    extractFunction(html, 'resetRunwayPredictionCaches'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    const bayEntryCache = new Map();
    const runwayLockCache = new Map();
    const baySideHistoryCache = new Map();
    ${pieces}
    return {
      predictRunwayGeometry,
      predictRunwayForAircraft,
      getRecentConfirmedFamily,
      resetRunwayPredictionCaches,
      bayEntryCache,
      runwayLockCache,
      baySideHistoryCache,
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

// LR552-shaped input: south of the field, track ~010, at a LOW/plausible altitude for its
// distance (so the altitude guard alone would not reject it -- this specifically isolates the
// consensus mechanism). On its own, predictRunwayGeometry() correctly still returns the early
// 01R call (see archerfield-01-early-call.test.js's "plausible altitude" case for the same
// position/track/altitude shape).
// lon 153.08 sits east of archerfieldDividerLon() at this latitude (~153.061), on the real 01R
// side of the corridor -- see the archerfieldDividerLon() comment in index.html.
const lr552LowAltPoll = { reg: 'VH-VEK', lat: -27.65, lon: 153.08, track: 15, _dist_nm: 16.4, alt_baro: 4500 };

test('bootstrap preserved: with no prior confirmed evidence, the wrapper still returns the early 01R call', () => {
  const mod = loadPredictor();
  const result = mod.predictRunwayForAircraft(lr552LowAltPoll);
  assert.deepEqual(result, { name: '01R', level: 'likely+' });
});

test('LR552 repro: a confirmed recent 19-family lock suppresses a contradicting 01-family early call', () => {
  const mod = loadPredictor();

  // Simulates other traffic this session (QLK329D, QFA132, etc.) having already locked in a
  // confirmed, cross-track-verified 19L close-in -- exactly what runwayLockCache is meant to
  // hold (see its write site in render()).
  mod.runwayLockCache.set('QLK329D', { name: '19L', ts: Date.now() });

  assert.equal(mod.getRecentConfirmedFamily(), '19');

  const result = mod.predictRunwayForAircraft(lr552LowAltPoll);
  assert.equal(result, null, 'a 01-family guess contradicting the confirmed active family must not be shown');
});

test('a non-contradicting early call still fires normally alongside a confirmed same-family lock', () => {
  const mod = loadPredictor();
  mod.runwayLockCache.set('SOME-01-FLIGHT', { name: '01L', ts: Date.now() });

  const result = mod.predictRunwayForAircraft(lr552LowAltPoll);
  assert.deepEqual(result, { name: '01R', level: 'likely+' });
});

test('a stale (expired) lock entry does not contribute to the active-family consensus', () => {
  const mod = loadPredictor();
  const staleTs = Date.now() - (25 * 60 * 1000); // older than ACTIVE_FAMILY_FRESH_MS (20 min)
  mod.runwayLockCache.set('OLD-FLIGHT', { name: '19R', ts: staleTs });

  assert.equal(mod.getRecentConfirmedFamily(), null);
  const result = mod.predictRunwayForAircraft(lr552LowAltPoll);
  assert.deepEqual(result, { name: '01R', level: 'likely+' });
});

test('a high-confidence geometry result is never suppressed, even when it contradicts the confirmed active family', () => {
  const mod = loadPredictor();

  // Exactly on the 19R extended centerline at 6.9NM, track matching the runway heading --
  // real cross-track-verified evidence for THIS aircraft (see qlk379d-bay-entry-lon-offset
  // test's equivalent construction).
  const highConfidencePoll = { reg: 'TEST-HIGH', lat: -27.2708, lon: 153.1390, track: 190, _dist_nm: 6.9 };
  const geometryAlone = mod.predictRunwayGeometry(highConfidencePoll);
  assert.deepEqual(geometryAlone, { name: '19R', level: 'high' });

  // Seed a contradicting confirmed family (01) -- must not matter.
  mod.runwayLockCache.set('SOME-01-FLIGHT', { name: '01R', ts: Date.now() });

  const result = mod.predictRunwayForAircraft(highConfidencePoll);
  assert.deepEqual(result, { name: '19R', level: 'high' });
});

test('resetRunwayPredictionCaches() empties runwayLockCache, bayEntryCache, and baySideHistoryCache', () => {
  const mod = loadPredictor();
  mod.runwayLockCache.set('SOME-FLIGHT', { name: '19L', ts: Date.now() });
  mod.bayEntryCache.set('SOME-FLIGHT', { lat: -27.2, lon: 153.1, dnm: 14, ts: Date.now() });
  mod.baySideHistoryCache.set('SOME-FLIGHT', { sides: ['19R'], ts: Date.now() });

  assert.equal(mod.runwayLockCache.size, 1);
  assert.equal(mod.bayEntryCache.size, 1);
  assert.equal(mod.baySideHistoryCache.size, 1);

  mod.resetRunwayPredictionCaches();

  assert.equal(mod.runwayLockCache.size, 0);
  assert.equal(mod.bayEntryCache.size, 0);
  assert.equal(mod.baySideHistoryCache.size, 0);
});
