// Tests the RWY chip's style/label selection logic (runwayChipHtml in index.html).
//
// index.html is a single self-contained <script> IIFE with no module system and no build
// step, so rather than executing the whole app (which needs a DOM, fetch, geolocation, etc.)
// we pull just the `runwayChipHtml` function's source text out of the file and evaluate it
// standalone. It's a pure function of its arguments (rwy/rwyLevel are the gated, <=2NM
// values; rawRwy/rawRwyLevel are the ungated values already used by the spotting popup), so
// this exercises the exact same logic render() calls.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadRunwayChipHtml() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const marker = 'function runwayChipHtml(';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'runwayChipHtml() not found in index.html');

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
  assert.notEqual(end, -1, 'could not find end of runwayChipHtml() body');

  const source = html.slice(start, end + 1);
  return new Function(`return (${source});`)();
}

const runwayChipHtml = loadRunwayChipHtml();
const ICON = '<svg-icon>';

test('beyond 2NM with a raw runway guess shows the muted estimate chip', () => {
  const html = runwayChipHtml(null, null, '19L', 'likely', ICON);
  assert.match(html, /tag-runway-estimate/);
  assert.doesNotMatch(html, /tag-runway-high/);
  assert.doesNotMatch(html, /tag-runway-likely"/); // not the confirmed "likely" class
  assert.match(html, /RWY 19L\?/);
});

test('<=2NM confirmed high-confidence runway keeps the existing locked style', () => {
  const html = runwayChipHtml('19L', 'high', '19L', 'high', ICON);
  assert.match(html, /tag-runway-high/);
  assert.doesNotMatch(html, /tag-runway-estimate/);
  assert.match(html, /RWY 19L</); // no trailing "?" on a confirmed call
});

test('<=2NM likely-confidence runway keeps the existing likely style', () => {
  const html = runwayChipHtml('01R', 'likely', '01R', 'likely', ICON);
  assert.match(html, /tag-runway-likely/);
  assert.doesNotMatch(html, /tag-runway-estimate/);
  assert.match(html, /RWY 01R</);
});

test('no runway signal at all shows no chip', () => {
  const html = runwayChipHtml(null, null, null, null, ICON);
  assert.equal(html, '');
});
