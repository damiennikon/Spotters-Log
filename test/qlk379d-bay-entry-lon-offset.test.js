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
    extractStatement(html, 'const BAY_ENTRY_MIN_DIST_NM ='),
    extractStatement(html, 'const BAY_ENTRY_MIN_LON_OFFSET_NM ='),
    extractConstObject(html, 'ARCHERFIELD'),
    extractFunction(html, 'angleDiffDeg'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'predictRunwayGeometry'),
    extractFunction(html, 'recordBayEntryPosition'),
    extractFunction(html, 'estimateBayEntryEarly'),
    extractFunction(html, 'getRunwayCacheKey'),
    extractFunction(html, 'predictRunwayForAircraft'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    const bayEntryCache = new Map();
    ${pieces}
    return {
      predictRunwayGeometry,
      estimateBayEntryEarly,
      recordBayEntryPosition,
      predictRunwayForAircraft,
      bayEntryCache,
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

test('QLK379D repro: a first poll past the 12NM distance gate but only marginally east of APT.lon must not produce a confident side guess', () => {
  const mod = loadPredictor();
  mod.recordBayEntryPosition(firstPoll, 'VH-QOE');

  const entry = mod.bayEntryCache.get('VH-QOE');
  assert.ok(entry.dnm >= 12, 'sanity: entry clears BAY_ENTRY_MIN_DIST_NM');

  const result = mod.estimateBayEntryEarly(laterPoll, 'VH-QOE');
  assert.equal(result, null, 'a longitude-marginal entry point must not produce a confident side guess even past the distance gate');
});

test('QLK379D repro: predictRunwayGeometry alone already gets the correct side (19R) at 6.9NM, just not at high confidence', () => {
  const mod = loadPredictor();
  const result = mod.predictRunwayGeometry(laterPoll);
  assert.equal(result && result.name, '19R', 'geometry should pick the correct centerline even when track is off enough to miss the high-confidence gate');
  assert.notEqual(result && result.level, 'high', 'sanity: this repro depends on geometry NOT reaching high confidence here');
});

test('QLK379D repro: the full wrapper must not let a longitude-marginal bay-entry estimate override a correct-but-non-high geometry call', () => {
  const mod = loadPredictor();

  const result = mod.predictRunwayForAircraft(firstPoll);
  assert.notEqual(result && result.name, '19L', 'first poll itself should not be mislabelled either');

  const finalResult = mod.predictRunwayForAircraft(laterPoll);
  assert.deepEqual(finalResult, { name: '19R', level: 'likely' });
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
