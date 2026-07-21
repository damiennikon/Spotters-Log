// Tests the RWY chip's style/label selection logic (runwayChipHtml in index.html).
//
// index.html is a single self-contained <script> IIFE with no module system and no build
// step, so rather than executing the whole app (which needs a DOM, fetch, geolocation, etc.)
// we pull just the `runwayChipHtml` function's source text (plus the RUNWAY_GUESS_NM const it
// closes over) out of the file and evaluate them standalone. It's otherwise a pure function of
// its arguments (rwy/rwyLevel are the gated, <=2NM values; rawRwy/rawRwyLevel are the ungated
// values already used by the spotting popup; dnm is the aircraft's current distance in NM), so
// this exercises the exact same logic render() calls.

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

function loadRunwayChipHtml() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const pieces = [
    extractStatement(html, 'const RUNWAY_GUESS_NM ='),
    extractFunction(html, 'runwayChipHtml'),
  ].join('\n\n');

  return new Function(`${pieces}\nreturn runwayChipHtml;`)();
}

const runwayChipHtml = loadRunwayChipHtml();
const ICON = '<svg-icon>';

test('beyond RUNWAY_GUESS_NM with a raw parallel-runway guess hedges instead of naming a side', () => {
  const html = runwayChipHtml(null, null, '19L', 'likely', ICON, 12.7);
  assert.match(html, /tag-runway-estimate/);
  assert.doesNotMatch(html, /tag-runway-high/);
  assert.doesNotMatch(html, /tag-runway-likely"/); // not the confirmed "likely" class
  // Parallel thresholds (19L/19R) sit under 1NM apart -- this far out an L/R guess is close to
  // a coin flip, and in-memory lock/family state resets on reload, so don't name a specific side.
  assert.doesNotMatch(html, /19L/);
  assert.match(html, /Runway confirmation incoming/);
});

test('with no distance available, a parallel-runway guess hedges (fail safe)', () => {
  const html = runwayChipHtml(null, null, '19L', 'likely', ICON, null);
  assert.match(html, /Runway confirmation incoming/);
  assert.doesNotMatch(html, /19L/);
});

test('inside RUNWAY_GUESS_NM but beyond 2NM, a raw parallel-runway guess names the side (muted)', () => {
  const html = runwayChipHtml(null, null, '19R', 'likely', ICON, 4.2);
  assert.match(html, /tag-runway-estimate/);
  assert.doesNotMatch(html, /tag-runway-high/);
  assert.doesNotMatch(html, /tag-runway-likely"/); // not the confirmed "likely" class
  assert.doesNotMatch(html, /Runway confirmation incoming/);
  assert.match(html, /RWY 19R</);
});

test('beyond RUNWAY_GUESS_NM with a raw non-parallel runway guess still shows the muted estimate chip', () => {
  const html = runwayChipHtml(null, null, '01', 'likely', ICON, 12.7);
  assert.match(html, /tag-runway-estimate/);
  assert.doesNotMatch(html, /tag-runway-high/);
  assert.doesNotMatch(html, /Runway confirmation incoming/);
  assert.match(html, /RWY 01</); // no L/R ambiguity to hedge on, so the guess is still named
});

test('<=2NM confirmed high-confidence runway keeps the existing locked style regardless of dnm passed', () => {
  const html = runwayChipHtml('19L', 'high', '19L', 'high', ICON, 1.4);
  assert.match(html, /tag-runway-high/);
  assert.doesNotMatch(html, /tag-runway-estimate/);
  assert.match(html, /RWY 19L</);
});

test('<=2NM likely-confidence runway keeps the existing likely style', () => {
  const html = runwayChipHtml('01R', 'likely', '01R', 'likely', ICON, 1.9);
  assert.match(html, /tag-runway-likely/);
  assert.doesNotMatch(html, /tag-runway-estimate/);
  assert.match(html, /RWY 01R</);
});

test('no runway signal at all shows no chip', () => {
  const html = runwayChipHtml(null, null, null, null, ICON, null);
  assert.equal(html, '');
});
