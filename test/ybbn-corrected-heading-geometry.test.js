// Tripwire for the YBBN magnetic-vs-true heading fix in runway-logic-test.html.
//
// RUNWAYS.YBBN used to store magnetic-style headings (10 for 01L/01R, 190 for 19L/19R) while
// ADS-B track data is TRUE -- a ~17deg mismatch that rotated predictRunwayGeometry's cross-track
// projection away from where the runways actually are. deriveYbbnHeadingsFromThresholds() (see
// runway-logic-test.html, right after RUNWAYS is defined) now derives each family's heading from
// the runways' own threshold coordinates instead.
//
// This file pins two things so a future edit can't silently regress either:
//   1. The derived heading VALUES themselves (a future edit reverting to hardcoded magnetic
//      values, or breaking the family-averaging that keeps 01L/01R -- and 19L/19R -- numerically
//      identical for predictRunwayGeometry's strict-equality candidate grouping, would fail
//      here directly).
//   2. That predictRunwayGeometry() actually resolves each of the four runways correctly from
//      points sitting exactly on that runway's TRUE extended centerline, at 12/10/6/3/1NM out --
//      proving the corrected heading is actually load-bearing for the real prediction path, not
//      just numerically present.
//
// This is a synthetic-geometry tripwire only -- it proves the maths is internally self-
// consistent, nothing more. It does NOT prove the fix is correct against real ADS-B traffic
// (real tracks have wind correction angle, turn transients, ADS-B jitter, etc. that this
// synthetic data has no way to represent). See the task history / PR description for why this
// still needs live-traffic validation across multiple real approaches before being trusted.
//
// Same extraction approach as the other tests in this directory (see runway-prediction.test.js):
// runway-logic-test.html is one big inline IIFE with no module system, so we pull just the
// pieces under test out of the file text and evaluate them standalone. Deliberately reads
// runway-logic-test.html, NOT index.html -- this fix lives only in the isolated test copy.

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

// For statements whose body itself contains parens/braces (and so may contain semicolons of its
// own before the real terminator) -- balances depth first, then finds the terminating ";" after
// depth returns to 0. Used for the deriveYbbnHeadingsFromThresholds IIFE.
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
    extractFunction(html, 'archerfieldDividerLon'),
    extractStatement(html, 'const EARLY_CALL_MAX_ALT_FT_PER_NM ='),
    extractFunction(html, 'angleDiffDeg'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'projectPointNm'),
    extractFunction(html, 'predictRunwayGeometry'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    ${pieces}
    return {
      RUNWAYS,
      predictRunwayGeometry,
      projectPointNm,
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

test('pinned: YBBN 01-family and 19-family headings are derived true values, not the old magnetic 10/190', () => {
  const mod = loadPredictor();
  const rwy = (name) => mod.RUNWAYS.YBBN.find((r) => r.name === name);

  // Pinned to the actual derived values (averaged true bearing across the 01L<->19R and
  // 01R<->19L reciprocal pairs) so a future edit that changes the derivation is caught here,
  // not just via a downstream geometry symptom.
  const EXPECTED_HEADING_01 = 26.977101724022532;
  const EXPECTED_HEADING_19 = 206.97710172402253;
  const TOLERANCE_DEG = 0.05;

  for (const name of ['01L', '01R']) {
    assert.ok(
      Math.abs(rwy(name).heading - EXPECTED_HEADING_01) < TOLERANCE_DEG,
      `${name}.heading = ${rwy(name).heading}, expected ~${EXPECTED_HEADING_01}`
    );
  }
  for (const name of ['19L', '19R']) {
    assert.ok(
      Math.abs(rwy(name).heading - EXPECTED_HEADING_19) < TOLERANCE_DEG,
      `${name}.heading = ${rwy(name).heading}, expected ~${EXPECTED_HEADING_19}`
    );
  }

  // Family members must be numerically IDENTICAL (not just close) -- predictRunwayGeometry
  // groups a family via strict equality (`rwys.filter(r => r.heading === bestHeading)`), so a
  // regression back to independent per-strip derivation (which differ by ~0.06deg) would break
  // that grouping silently, even though each individual value would still look "about right".
  assert.equal(rwy('01L').heading, rwy('01R').heading, '01L and 01R must share an identical heading value');
  assert.equal(rwy('19L').heading, rwy('19R').heading, '19L and 19R must share an identical heading value');

  // Sanity: definitely not the old magnetic values anymore.
  assert.ok(Math.abs(rwy('01L').heading - 10) > 5, '01-family heading must not have reverted to the old magnetic 10');
  assert.ok(Math.abs(rwy('19L').heading - 190) > 5, '19-family heading must not have reverted to the old magnetic 190');
});

test('pinned: predictRunwayGeometry resolves all four YBBN runways from points on their TRUE extended centerline at 12/10/6/3/1NM', () => {
  const mod = loadPredictor();
  const DISTANCES_NM = [12, 10, 6, 3, 1];

  for (const name of ['01L', '01R', '19L', '19R']) {
    const rwy = mod.RUNWAYS.YBBN.find((r) => r.name === name);
    // The approach side is the reciprocal of the landing heading -- i.e. where an aircraft
    // inbound to this specific runway would actually be, out along its true extended centerline.
    const approachBearing = (rwy.heading + 180) % 360;

    for (const distNm of DISTANCES_NM) {
      const [lat, lon] = mod.projectPointNm(rwy.thrLat, rwy.thrLon, approachBearing, distNm);
      const dnm = haversineNm(lat, lon, YBBN.lat, YBBN.lon);
      const it = {
        lat,
        lon,
        track: rwy.heading,
        _dist_nm: dnm,
        // Comfortably under EARLY_CALL_MAX_ALT_FT_PER_NM (450ft/NM) at every distance tested.
        alt_baro: 300 * distNm,
      };

      const result = mod.predictRunwayGeometry(it);
      assert.ok(result, `predictRunwayGeometry returned null for ${name} at ${distNm}NM (dnm=${dnm.toFixed(2)})`);
      assert.equal(
        result.name,
        name,
        `expected ${name} at ${distNm}NM (dnm=${dnm.toFixed(2)}) but got ${JSON.stringify(result)}`
      );
    }
  }
});
