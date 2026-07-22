// Reproduces the QLK319D/VH-QOT misclassification: RWY chip showed 19L for a flight that
// actually landed 19R, entering Moreton Bay via the west/Caboolture corridor (confirmed by the
// user from their own FlightRadar24 tracking, including a screenshot with the two corridors
// hand-annotated "19R" (west) and "19L" (east/Moreton Island)).
//
// Unlike QLK379D (qlk379d-bay-entry-lon-offset.test.js), this was not a longitude-marginal case:
// the reported track's longitude was several NM east of the *old* fixed BAY_DIVIDER_LON at every
// distance checked, comfortably clearing BAY_ENTRY_MIN_LON_OFFSET_NM -- so the app confidently
// (and wrongly) called 19L. Root cause: BAY_DIVIDER_LON sits at the runway thresholds, but
// Moreton Bay lies entirely east of the airport, so ANY 19-family arrival -- west-corridor bound
// or not -- reads east of that fixed line while still transiting the bay. See index.html's
// BAY_DIVIDER_SLOPE_NM_PER_NM comment for the fix: a divider that shifts east with distance-out,
// calibrated from 12 FR24-traced reference points (6 per corridor) the user supplied separately.
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
    extractFunction(html, 'angleDiffDeg'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'recordBayEntryPosition'),
    extractFunction(html, 'estimateBayEntryEarly'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    const bayEntryCache = new Map();
    ${pieces}
    return {
      recordBayEntryPosition,
      estimateBayEntryEarly,
      bayEntryCache,
      bayDividerLon,
      BAY_DIVIDER_LON,
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

// The three coordinates the user supplied from their own FR24 tracking of QLK319D's actual
// (confirmed 19R) approach, in order of decreasing distance-out.
const points = [
  { reg: 'VH-QOT', lat: -27.197768, lon: 153.227203, track: 195, _dist_nm: 12.68 },
  { reg: 'VH-QOT', lat: -27.263937, lon: 153.182265, track: 195, _dist_nm: 8.02 },
  { reg: 'VH-QOT', lat: -27.334487, lon: 153.144157, track: 195, _dist_nm: 3.31 },
];

test('QLK319D repro: none of the three confirmed 19R points ever reads confidently 19L, at their own distance as an independent first-tracked entry', () => {
  const mod = loadPredictor();
  points.forEach((p, i) => {
    const key = `VH-QOT-${i}`;
    mod.recordBayEntryPosition(p, key);
    const result = mod.estimateBayEntryEarly(p, key);
    assert.notEqual(result && result.name, '19L',
      `${p._dist_nm}NM point must never read 19L -- got ${JSON.stringify(result)}`);
  });
});

test('QLK319D repro: once the 12.68NM entry point is captured, the cached entry never reads 19L for the rest of the approach', () => {
  const mod = loadPredictor();
  const key = 'VH-QOT';
  mod.recordBayEntryPosition(points[0], key);
  for (const p of points) {
    const result = mod.estimateBayEntryEarly(p, key);
    assert.notEqual(result && result.name, '19L',
      `${p._dist_nm}NM point must never read 19L off the cached 12.68NM entry -- got ${JSON.stringify(result)}`);
  }
});

test('bayDividerLon: matches the fitted calibration at two of the CSV reference distances', () => {
  const mod = loadPredictor();
  // pair d (19R d / 19L d), avg dnm 8.40 -> midpoint offset ~+3.23NM east of BAY_DIVIDER_LON
  const atD = mod.bayDividerLon(8.40, YBBN.lat);
  const offsetD = (atD - mod.BAY_DIVIDER_LON) * Math.cos(YBBN.lat * Math.PI / 180) * 60;
  assert.ok(Math.abs(offsetD - 3.23) < 0.05, `expected ~+3.23NM offset at 8.40NM, got ${offsetD.toFixed(3)}NM`);

  // pair e (19R e / 19L e), avg dnm 11.74 -> midpoint offset ~+4.75NM east
  const atE = mod.bayDividerLon(11.74, YBBN.lat);
  const offsetE = (atE - mod.BAY_DIVIDER_LON) * Math.cos(YBBN.lat * Math.PI / 180) * 60;
  assert.ok(Math.abs(offsetE - 4.75) < 0.05, `expected ~+4.75NM offset at 11.74NM, got ${offsetE.toFixed(3)}NM`);
});

test('bayDividerLon: falls back to the plain BAY_DIVIDER_LON for invalid distance/latitude input', () => {
  const mod = loadPredictor();
  assert.equal(mod.bayDividerLon(null, YBBN.lat), mod.BAY_DIVIDER_LON);
  assert.equal(mod.bayDividerLon(-1, YBBN.lat), mod.BAY_DIVIDER_LON);
  assert.equal(mod.bayDividerLon(5, null), mod.BAY_DIVIDER_LON);
});
