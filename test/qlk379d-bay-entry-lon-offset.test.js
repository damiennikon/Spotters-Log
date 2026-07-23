// Reproduces the QLK379D/VH-QOE misclassification: RWY chip showed 19L at 6.9NM, 1,400ft,
// 143kt, -704fpm -- should have been 19R.
//
// Unlike LR444 (bay-entry.test.js), this is not a close-in-first-poll case: the first-ever
// poll for this aircraft was 13.4NM out, comfortably past BAY_ENTRY_MIN_DIST_NM (12). The
// actual mechanism: an aircraft transiting down the coast from the north sits almost exactly
// on BNE's own reference longitude for a long stretch, so its first poll can clear the 12NM
// distance gate while still being only fractionally (here, ~0.56NM) east of APT.lon -- the same
// "which side?" ambiguity Redcliffe causes close-in, just reached via distance-out instead of
// closeness-in. estimateBayEntryEarly() read that marginal easting as "19L" and, because
// predictRunwayGeometry() only reached 'likely' (not 'high') confidence at 6.9NM -- it had the
// correct side, 19R, just with the reported track ~22 degrees off the runway heading, e.g.
// still settling out of a turn or holding a crosswind correction -- the wrapper let the wrong
// bay-entry estimate override a correct-but-non-high geometry call.
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

// Like extractStatement, but balances parens/braces first -- for statements (like the
// BAY_DIVIDER_LON IIFE) whose value contains semicolons of its own, so the first ';' isn't
// necessarily the end of the statement.
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
      predictRunwayGeometry,
      estimateBayEntryEarly,
      recordBayEntryPosition,
      predictRunwayForAircraft,
      bayEntryCache,
      runwayLockCache,
      baySideHistoryCache,
      geometryAgreementCache,
      recordGeometryAgreement,
      getSustainedGeometrySide,
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

// First-ever poll for this aircraft: transiting south along the coast, roughly on BNE's own
// longitude, only marginally (~0.56NM) east of it, at 13.4NM out -- past BAY_ENTRY_MIN_DIST_NM.
const firstPoll = { reg: 'VH-QOE', lat: -27.15, lon: 153.128, track: 185, _dist_nm: 13.4 };

// Later poll matching the reported telemetry: 6.9NM out, established on the 19R extended
// centerline, but track is 22 degrees off the runway heading (212 vs 190) -- e.g. still
// settling out of a turn or holding a crosswind correction -- so predictRunwayGeometry's own
// HIGH-confidence gate (<=18 degrees) isn't met even though it already picks the correct side.
const laterPoll = { reg: 'VH-QOE', lat: -27.2708, lon: 153.1390, track: 212, _dist_nm: 6.9 };

test('QLK379D repro: a first poll past the 12NM distance gate now resolves correctly against the distance-scaled divider', () => {
  const mod = loadPredictor();
  mod.recordBayEntryPosition(firstPoll, 'VH-QOE');

  const entry = mod.bayEntryCache.get('VH-QOE');
  assert.ok(entry.dnm >= 12, 'sanity: entry clears BAY_ENTRY_MIN_DIST_NM');

  // Against the old fixed BAY_DIVIDER_LON this point (~0.56NM east of it) was only marginally
  // east -- ambiguous, so estimateBayEntryEarly returned null rather than risk a wrong call.
  // Against the distance-scaled divider (bayDividerLon), the true corridor midline at 13.4NM
  // out is itself several NM further east (see index.html's BAY_DIVIDER_SLOPE_NM_PER_NM
  // comment), so this same point reads solidly west/19R -- no longer marginal at all.
  const result = mod.estimateBayEntryEarly(laterPoll, 'VH-QOE');
  assert.deepEqual(result, { name: '19R', level: 'estimate' },
    'the distance-scaled divider now confidently and correctly resolves this as 19R');
});

test('QLK379D repro: predictRunwayGeometry alone already gets the correct side (19R) at 6.9NM, just not at high confidence', () => {
  const mod = loadPredictor();
  const result = mod.predictRunwayGeometry(laterPoll);
  assert.equal(result && result.name, '19R', 'geometry should pick the correct centerline even when track is off enough to miss the high-confidence gate');
  assert.notEqual(result && result.level, 'high', 'sanity: this repro depends on geometry NOT reaching high confidence here');
});

test('QLK379D repro: the bay-entry estimate resolves correctly even from a single bare snapshot, no poll history needed', () => {
  const mod = loadPredictor();

  const result = mod.predictRunwayForAircraft(firstPoll);
  assert.notEqual(result && result.name, '19L', 'first poll itself should not be mislabelled either');

  const finalResult = mod.predictRunwayForAircraft(laterPoll);
  // Two bare snapshots with nothing in between, no poll history to smooth over a transient
  // crossing: under the old fixed divider this used to flip to the wrong side (19L) here,
  // because the longitude-marginal bay-ENTRY estimate stayed null and estimateBaySideCurrent's
  // single, unsmoothed 6.9NM reading (transiently ~0.58NM east of the old divider) won by
  // default. Under the distance-scaled divider, the bay-ENTRY estimate itself already resolves
  // confidently and correctly from the cached 13.4NM entry point (see the test above) -- so it
  // wins outright and this scenario no longer depends on majority-vote history at all.
  assert.deepEqual(finalResult, { name: '19R', level: 'estimate' });
});

// The two real reported snapshots above (13.4NM and 6.9NM) are ~6.5NM of real flight time apart
// -- in practice there are many polls in between, most of them west of BAY_DIVIDER_LON, matching
// the real-world Caboolture/Redcliffe-corridor-entry pattern this aircraft is actually flying
// (see estimateBayEntryEarly's comment above). This reconstructs that fuller poll stream.
//
// Under the old fixed divider, this scenario needed estimateBaySideCurrent's majority-vote
// history (see baySideHistoryCache / BAY_SIDE_HISTORY_MAX_POLLS) to outvote the transient
// eastward 6.9NM snapshot. Under the distance-scaled divider, the bay-ENTRY estimate itself
// already resolves confidently and correctly from the very first qualifying poll (13.4NM) --
// see the first test above -- so it wins outright on every subsequent poll for this aircraft,
// including the transient one, without ever needing estimateBaySideCurrent or its history to
// run at all. This confirms the fix holds throughout a realistic poll stream, via the simpler
// (and now more robust) mechanism.
test('QLK379D repro: with a realistic poll stream in between, the confident bay-entry estimate keeps the wrapper on 19R throughout, including the transient 6.9NM snapshot', () => {
  const mod = loadPredictor();

  const pollA = { reg: 'VH-QOE', lat: -27.19, lon: 153.117, track: 193, _dist_nm: 11.5 };
  const pollB = { reg: 'VH-QOE', lat: -27.22, lon: 153.115, track: 198, _dist_nm: 9.8 };
  const pollC = { reg: 'VH-QOE', lat: -27.245, lon: 153.118, track: 205, _dist_nm: 8.2 };

  mod.predictRunwayForAircraft(firstPoll);
  for (const p of [pollA, pollB, pollC]) {
    const r = mod.predictRunwayForAircraft(p);
    assert.equal(r && r.name, '19R', `sanity: poll at ${p._dist_nm}NM should already read 19R`);
  }

  // The confident bay-entry estimate short-circuits predictRunwayForAircraft before
  // estimateBaySideCurrent ever runs for this aircraft, so no majority-vote history builds up
  // -- that's expected now, not a regression (see comment above).
  const hist = mod.baySideHistoryCache.get('VH-QOE');
  assert.equal(hist, undefined, 'sanity: estimateBaySideCurrent never needs to run once the bay-entry estimate is confident');

  const finalResult = mod.predictRunwayForAircraft(laterPoll);
  assert.deepEqual(finalResult, { name: '19R', level: 'estimate' },
    'the confident bay-entry estimate keeps the call on 19R for the transient poll too, instead of flipping');
});

test('bay-entry estimate still fires correctly for a genuinely far-out west (Caboolture-side) entry (no regression)', () => {
  const mod = loadPredictor();

  const key = 'VH-WEST';
  const farPoll = { lat: -27.05, lon: 152.95, track: 190, _dist_nm: 16 };
  mod.recordBayEntryPosition(farPoll, key);

  const laterFarPoll = { ...farPoll, lat: -27.2, lon: 153.05, track: 195, _dist_nm: 10 };
  const result = mod.estimateBayEntryEarly(laterFarPoll, key);
  assert.deepEqual(result, { name: '19R', level: 'estimate' });
});

test('bay-entry estimate still fires correctly for a genuinely far-out east (Moreton Island-side) entry (no regression)', () => {
  const mod = loadPredictor();

  const key = 'VH-EAST';
  const farPoll = { lat: -27.15, lon: 153.38, track: 210, _dist_nm: 17 };
  mod.recordBayEntryPosition(farPoll, key);

  const laterFarPoll = { ...farPoll, lat: -27.25, lon: 153.2, track: 200, _dist_nm: 9 };
  const result = mod.estimateBayEntryEarly(laterFarPoll, key);
  assert.deepEqual(result, { name: '19L', level: 'estimate' });
});
