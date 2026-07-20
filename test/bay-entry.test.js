// Reproduces the LR444/VH-VEK bay-entry misclassification bug.
//
// recordBayEntryPosition() stores the *first ever* position seen for an aircraft, with no
// regard for how far out that first poll was. estimateBayEntryEarly() then classifies
// east/west purely by comparing that stored longitude against BNE's own reference longitude
// (153.1175). Redcliffe sits almost exactly on that longitude, so an aircraft whose first
// tracked poll already happens to be down near Redcliffe -- e.g. because the app didn't pick
// it up until partway through its curve south -- can read as fractionally east of APT.lon
// even though its actual entry into the bay was from the west (Caboolture side), producing a
// confident-looking but wrong 19L call instead of 19R.
//
// index.html has no server-side logging and bayEntryCache is a purely in-memory runtime Map,
// so there is no persisted historical position for the real LR444 flight to read back -- this
// reconstructs the same shape of case (a close-in first poll right in the Redcliffe longitude
// ambiguity zone) from the reported track description instead.
//
// Extracted the same way as runway-chip.test.js: index.html is one big inline IIFE with no
// module system, so we pull just the functions/consts under test out of the file text and
// evaluate them standalone, wiring up a settable APT in place of the real loadAirport() flow.

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

function loadBayEntryModule() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const pieces = [
    extractStatement(html, 'const BAY_ENTRY_MIN_DIST_NM ='),
    extractStatement(html, 'const BAY_ENTRY_MIN_LON_OFFSET_NM ='),
    extractFunction(html, 'angleDiffDeg'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'recordBayEntryPosition'),
    extractFunction(html, 'estimateBayEntryEarly'),
  ].join('\n\n');

  const wrapper = `
    (function() {
      let APT = null;
      const bayEntryCache = new Map();
      ${pieces}
      return {
        recordBayEntryPosition,
        estimateBayEntryEarly,
        bayEntryCache,
        setAPT: (apt) => { APT = apt; },
      };
    })
  `;

  // Note: the leading newline inside `wrapper` must not survive next to `return` -- ASI would
  // otherwise silently turn `return\n(function...)` into `return;` followed by a dead expression.
  return new Function(`return ${wrapper.trim()};`)()();
}

const YBBN = { icao: 'YBBN', lat: -27.3842, lon: 153.1175 };

test('bay-entry estimate does not fire when the first-ever poll is too close-in to trust (LR444 repro)', () => {
  const mod = loadBayEntryModule();
  mod.setAPT(YBBN);

  const key = 'VH-VEK';
  // First poll ever seen for this aircraft: already curving south near Redcliffe (whose
  // longitude sits almost exactly on APT.lon), just barely east of it, well inside the 12NM
  // trust threshold -- even though the true Thangool->Brisbane routing entered from the west.
  const firstPoll = {
    lat: -27.25,
    lon: 153.14,
    track: 195,
    _dist_nm: 8.1,
  };

  mod.recordBayEntryPosition(firstPoll, key);
  assert.equal(mod.bayEntryCache.get(key).dnm, 8.1, 'entry position should still be recorded for reference');

  const result = mod.estimateBayEntryEarly(firstPoll, key);
  assert.equal(result, null, 'an untrustworthy close-in entry point must not produce a confident side guess');
});

test('bay-entry estimate still fires correctly for a genuinely far-out west (Caboolture-side) entry', () => {
  const mod = loadBayEntryModule();
  mod.setAPT(YBBN);

  const key = 'VH-WEST';
  const farPoll = {
    lat: -27.05,
    lon: 152.95, // well west of APT.lon -- Caboolture side
    track: 190,
    _dist_nm: 16,
  };

  mod.recordBayEntryPosition(farPoll, key);

  const laterPoll = { ...farPoll, lat: -27.2, lon: 153.05, track: 195, _dist_nm: 10 };
  const result = mod.estimateBayEntryEarly(laterPoll, key);
  assert.deepEqual(result, { name: '19R', level: 'estimate' });
});

test('bay-entry estimate still fires correctly for a genuinely far-out east (Moreton Island-side) entry', () => {
  const mod = loadBayEntryModule();
  mod.setAPT(YBBN);

  const key = 'VH-EAST';
  const farPoll = {
    lat: -27.15,
    lon: 153.38, // well east of APT.lon -- Moreton Island side
    track: 210,
    _dist_nm: 17,
  };

  mod.recordBayEntryPosition(farPoll, key);

  const laterPoll = { ...farPoll, lat: -27.25, lon: 153.2, track: 200, _dist_nm: 9 };
  const result = mod.estimateBayEntryEarly(laterPoll, key);
  assert.deepEqual(result, { name: '19L', level: 'estimate' });
});
