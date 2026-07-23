// Regression test for a background/foreground bug: an aircraft already showing a correct
// "guess"-tier runway (e.g. 19R, around 8NM) flips to the WRONG side (19L) the instant the app
// is backgrounded and then foregrounded again, then self-corrects a couple of NM later.
//
// Root cause: getSustainedGeometrySide()'s "sustained override" (see
// geometry-agreement-override.test.js) requires GEOMETRY_AGREEMENT_MIN_STREAK (3) consecutive
// same-side 'high' geometry reads spanning at least GEOMETRY_AGREEMENT_MIN_SPAN_NM (1.0NM) of
// real closing distance -- but recordGeometryAgreement() only ever checked poll COUNT and
// DISTANCE span, never how much real (wall-clock) time separated those polls.
//
// Mobile browsers throttle/pause setTimeout in backgrounded tabs (scheduleNextAutoRefresh's
// chain effectively stalls), and the visibilitychange handler only fires ONE immediate refresh()
// on return. That single post-gap poll can land several NM away from the last-recorded one --
// not because 3 consecutive polls genuinely converged over that distance, but because the polls
// in between were simply never taken while backgrounded. Two real pre-gap "transient wrong-side"
// blips (same side, too close together to qualify on their own -- see the "bunched" negative
// test in geometry-agreement-override.test.js) plus one real post-gap blip could then misread as
// a genuinely sustained, widely-spread streak, wrongly overriding an already-correct bay-side
// answer via predictRunwayForAircraft()'s `return precise` at the sustained-override sites.
//
// Fix: GEOMETRY_AGREEMENT_MAX_GAP_MS -- any inter-poll gap larger than this resets the streak to
// a fresh count of 1, exactly like a non-matching read does, so a background gap can never
// substitute for genuinely dense, sustained agreement.
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
    extractBalancedConst(html, 'BAY_DIVIDER_LON'),
    extractStatement(html, 'const BAY_DIVIDER_SLOPE_NM_PER_NM ='),
    extractStatement(html, 'const BAY_DIVIDER_INTERCEPT_NM ='),
    extractFunction(html, 'bayDividerLon'),
    extractStatement(html, 'const BAY_ENTRY_MIN_DIST_NM ='),
    extractStatement(html, 'const BAY_ENTRY_MIN_LON_OFFSET_NM ='),
    extractStatement(html, 'const BAY_SIDE_HISTORY_MAX_POLLS ='),
    extractConstObject(html, 'ARCHERFIELD'),
    extractFunction(html, 'archerfieldDividerLon'),
    extractStatement(html, 'const EARLY_CALL_MAX_ALT_FT_PER_NM ='),
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
    extractStatement(html, 'const GEOMETRY_AGREEMENT_MIN_STREAK ='),
    extractStatement(html, 'const GEOMETRY_AGREEMENT_MIN_SPAN_NM ='),
    extractStatement(html, 'const GEOMETRY_AGREEMENT_MAX_GAP_MS ='),
    extractFunction(html, 'recordGeometryAgreement'),
    extractFunction(html, 'getSustainedGeometrySide'),
    extractFunction(html, 'predictRunwayForAircraft'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    const bayEntryCache = new Map();
    const runwayLockCache = new Map();
    const baySideHistoryCache = new Map();
    const geometryAgreementCache = new Map();
    ${pieces}
    return {
      RUNWAYS,
      predictRunwayGeometry,
      predictRunwayForAircraft,
      recordGeometryAgreement,
      getSustainedGeometrySide,
      geometryAgreementCache,
      baySideHistoryCache,
      GEOMETRY_AGREEMENT_MAX_GAP_MS,
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

// ===== Cache-level repro: recordGeometryAgreement / getSustainedGeometrySide directly =====
//
// This isolates the exact defect with no geometry/position math involved at all, mirroring the
// "streak mechanics" unit tests in geometry-agreement-override.test.js. A real background gap is
// simulated the same way the app's own ts-based pruning treats staleness: by rewinding a cache
// entry's recorded `ts`, rather than actually sleeping the test.

test('background gap: 2 close pre-gap reads + 1 post-gap read do NOT combine into a sustained streak', () => {
  const mod = loadPredictor();
  const key = 'GAP1';

  // Two real, closely-spaced pre-gap polls (normal ~10s cadence) -- same side, but too close
  // together to qualify on their own (count=2, span well under GEOMETRY_AGREEMENT_MIN_SPAN_NM).
  mod.recordGeometryAgreement(key, { name: '19L', level: 'high' }, 8.4);
  mod.recordGeometryAgreement(key, { name: '19L', level: 'high' }, 8.3);
  assert.equal(mod.getSustainedGeometrySide(key), null, 'sanity: not sustained before the gap');

  // App is backgrounded for several minutes -- simulate the elapsed real time the same way the
  // app's own caches treat staleness (rewinding ts), without actually sleeping the test.
  const entry = mod.geometryAgreementCache.get(key);
  entry.ts -= (mod.GEOMETRY_AGREEMENT_MAX_GAP_MS + 60 * 1000);

  // On foreground, exactly ONE fresh poll arrives, several NM closer -- same side as before the
  // gap. Distance-wise this satisfies GEOMETRY_AGREEMENT_MIN_SPAN_NM, but no real dense evidence
  // was ever gathered across that distance.
  mod.recordGeometryAgreement(key, { name: '19L', level: 'high' }, 4.0);

  const streak = mod.geometryAgreementCache.get(key);
  assert.equal(streak.count, 1,
    'the gap must reset the streak to a fresh count of 1, not extend the pre-gap one');
  assert.equal(mod.getSustainedGeometrySide(key), null,
    'a background gap must never let a single fresh poll manufacture a "sustained" streak');
});

test('sanity: the SAME 3 reads without a gap (all within normal cadence) DO qualify as sustained', () => {
  const mod = loadPredictor();
  const key = 'GAP1-CONTROL';
  mod.recordGeometryAgreement(key, { name: '19L', level: 'high' }, 8.4);
  mod.recordGeometryAgreement(key, { name: '19L', level: 'high' }, 8.3);
  // No gap this time -- ts stays real/current, same as consecutive ~10s polls.
  mod.recordGeometryAgreement(key, { name: '19L', level: 'high' }, 4.0);
  assert.equal(mod.getSustainedGeometrySide(key), '19L',
    'without a gap, genuinely dense evidence must still qualify as sustained -- the fix must not break the legitimate case');
});

test('a gap shorter than GEOMETRY_AGREEMENT_MAX_GAP_MS still extends the streak normally', () => {
  const mod = loadPredictor();
  const key = 'GAP1-SHORT';
  mod.recordGeometryAgreement(key, { name: '19R', level: 'high' }, 9);
  mod.recordGeometryAgreement(key, { name: '19R', level: 'high' }, 8.5);
  const entry = mod.geometryAgreementCache.get(key);
  entry.ts -= (mod.GEOMETRY_AGREEMENT_MAX_GAP_MS - 5000); // just under the threshold
  mod.recordGeometryAgreement(key, { name: '19R', level: 'high' }, 8);
  assert.equal(mod.geometryAgreementCache.get(key).count, 3,
    'an ordinary retry/backoff-sized gap must not be treated as a background gap');
  assert.equal(mod.getSustainedGeometrySide(key), '19R');
});

// ===== Full predictRunwayForAircraft repro: real east-entry / transient-19R-blip positions =====
//
// Uses an entry poll >=BAY_ENTRY_MIN_DIST_NM (12NM) so estimateBayEntryEarly() (bayEstimate)
// fires deterministically for every later poll -- this is checked and returned BEFORE
// estimateBaySideCurrent() ever runs (see predictRunwayForAircraft), so baySideHistoryCache's own
// majority vote never enters into it. That isolates the ONE thing under test here: whether the
// sustained-geometry override wrongly fires because of a background gap, with no interference
// from the other (already well-covered, see runway-prediction.test.js) majority-vote logic.
//
// The east entry poll locks bayEstimate to 19L (the "usual" pattern -- matches this aircraft's
// real eventual landing side, confirmed by predictRunwayGeometry converging on 19L close-in for
// this same track/longitude, same technique as the other tests in this directory). The
// mid-approach positions genuinely read a transient wrong-side (19R) 'high' geometry blip in the
// 5-7NM band, the same documented failure mode as QLK453D/b8736b4's transient blips.

const entryPoll = { reg: 'GAP-REPRO', lat: -27.15, lon: 153.30, track: 210, _dist_nm: 17 };
// Two real pre-background polls, close together (normal ~10s cadence): count=2, span=0.17NM --
// correctly not yet sustained on their own (same shape as the "bunched" negative test above).
const preGapPolls = [
  { reg: 'GAP-REPRO', lat: -27.2708, lon: 153.1390, track: 190, _dist_nm: 6.90 },
  { reg: 'GAP-REPRO', lat: -27.2738, lon: 153.1390, track: 190, _dist_nm: 6.73 },
];
// The single poll that arrives on foreground after the background gap -- same transient wrong
// (19R) blip, now 1.59NM further along the same real excursion.
const postGapBlip = { reg: 'GAP-REPRO', lat: -27.2978, lon: 153.1390, track: 190, _dist_nm: 5.31 };

test('background-gap repro: a background gap must not flip an already-correct guess-tier answer to the wrong side', () => {
  const mod = loadPredictor();

  const seed = mod.predictRunwayForAircraft(entryPoll);
  assert.deepEqual(seed, { name: '19L', level: 'estimate' }, 'sanity: entry establishes the correct 19L bay-side answer');

  for (const p of preGapPolls) {
    const geom = mod.predictRunwayGeometry(p);
    assert.deepEqual(geom, { name: '19R', level: 'high' }, `sanity: ${p._dist_nm}NM really is a transient wrong-side high blip`);
    const r = mod.predictRunwayForAircraft(p);
    assert.deepEqual(r, { name: '19L', level: 'estimate' },
      `pre-gap poll at ${p._dist_nm}NM must still read correctly -- the transient blip alone isn't sustained yet`);
  }
  const preGapStreak = mod.geometryAgreementCache.get('GAP-REPRO');
  assert.equal(preGapStreak.count, 2);
  assert.equal(mod.getSustainedGeometrySide('GAP-REPRO'), null, 'sanity: not sustained before the gap');

  // App is backgrounded for several minutes -- rewind the streak's recorded ts to simulate the
  // elapsed real time, the same way loadGeometryAgreementCache()'s restored `ts` would look after
  // a real background gap (or a full reload mid-gap).
  preGapStreak.ts -= (mod.GEOMETRY_AGREEMENT_MAX_GAP_MS + 60 * 1000);

  // On foreground, exactly ONE fresh poll arrives (visibilitychange's immediate refresh()),
  // landing further along the same transient wrong-side excursion -- satisfying
  // GEOMETRY_AGREEMENT_MIN_SPAN_NM only because the intervening polls were never taken, not
  // because of any genuinely dense confirming evidence.
  const geomPost = mod.predictRunwayGeometry(postGapBlip);
  assert.deepEqual(geomPost, { name: '19R', level: 'high' });
  const result = mod.predictRunwayForAircraft(postGapBlip);
  assert.deepEqual(result, { name: '19L', level: 'estimate' },
    'the background gap must not let 2 pre-gap blips + 1 post-gap blip pass as a genuinely sustained streak');
  assert.equal(mod.geometryAgreementCache.get('GAP-REPRO').count, 1, 'the gap must reset the streak, not extend it to 3');
});

test('background-gap control: the identical polls WITHOUT any gap DO legitimately self-correct (fix does not neuter the real feature)', () => {
  const mod = loadPredictor();

  mod.predictRunwayForAircraft(entryPoll);
  for (const p of preGapPolls) mod.predictRunwayForAircraft(p);
  // No gap this time -- ts stays real/current, so this is 3 genuinely consecutive, closely-spaced
  // (dense-cadence) high reads spanning >=1.0NM: exactly the QFA500/QLK329D-shaped legitimate
  // sustained-override case from geometry-agreement-override.test.js, just replayed here to prove
  // the gap guard didn't accidentally disable the real feature.
  const result = mod.predictRunwayForAircraft(postGapBlip);
  assert.deepEqual(result, { name: '19R', level: 'high' });
});
