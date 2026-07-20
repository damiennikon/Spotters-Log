// Reproduces the VOZ943 misclassification: the Archerfield 01L/01R early-call rule in
// predictRunwayGeometry() used a *relative* heading check --
// `angleDiffDeg(track, 10) < angleDiffDeg(track, 190)` -- meaning "closer to 010 than to 190".
// That's satisfied by almost the entire northern half-circle (~280 through 010 through ~100),
// not just tracks actually consistent with a 01 final. An aircraft south-east of BNE (near
// Cleveland/Point Lookout) that's still on a STAR/vector leg -- e.g. heading roughly WNW,
// nowhere near an actual 010 approach heading, before it ever curves out over Moreton Bay and
// comes back to land 19L/19R -- could trip the rule and get a confident-looking but wrong
// "01R" call.
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

function loadPredictRunwayGeometry() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const pieces = [
    extractConstObject(html, 'RUNWAYS'),
    extractConstObject(html, 'ARCHERFIELD'),
    extractStatement(html, 'const EARLY_CALL_MAX_ALT_FT_PER_NM ='),
    extractFunction(html, 'angleDiffDeg'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'predictRunwayGeometry'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    ${pieces}
    return { predictRunwayGeometry, setAPT: (apt) => { APT = apt; } };
  })`;

  // Note: `wrapper` must sit directly after `return` with no line break -- ASI would otherwise
  // turn `return\n(function...)` into a bare `return;` followed by a dead expression.
  return new Function(`return ${wrapper.trim()};`)()();
}

const YBBN = { icao: 'YBBN', lat: -27.3842, lon: 153.1175 };

function loadPredictor() {
  const mod = loadPredictRunwayGeometry();
  mod.setAPT(YBBN);
  return mod;
}

test('VOZ943 repro: a STAR leg well off a 01 final heading, south-east of BNE near Cleveland/Point Lookout, is not called as 01', () => {
  const mod = loadPredictor();

  // Multi-poll synthetic trajectory: the aircraft is transiting broadly north-ish/toward the
  // field in the "closer to 010 than 190" sense at every one of these polls, but its actual
  // track is nowhere near an actual 01 final -- it's headed out over Moreton Bay before looping
  // back for a 19 approach from the north. None of these should produce a confident 01 call.
  const polls = [
    { lat: -27.4811, lon: 153.4000, track: 300, _dist_nm: 16.1 }, // ~WNW, ~17NM SE of BNE
    { lat: -27.4700, lon: 153.4200, track: 283, _dist_nm: 16.9 }, // continuing to curve
  ];

  for (const it of polls) {
    const result = mod.predictRunwayGeometry(it);
    const isConfident01 = !!(result && result.name && result.name.startsWith('01'));
    assert.equal(
      isConfident01,
      false,
      `expected no confident 01 call for track ${it.track}, got ${JSON.stringify(result)}`
    );
  }
});

test('a genuine 01 approach (south of the field, tracking close to 010) still gets the early call', () => {
  const mod = loadPredictor();

  const it = { lat: -27.65, lon: 153.05, track: 15, _dist_nm: 16.4 };
  const result = mod.predictRunwayGeometry(it);
  assert.deepEqual(result, { name: '01R', level: 'likely+' });
});

test('reasonable vectoring slop around 010 is still accepted (within the absolute tolerance)', () => {
  const mod = loadPredictor();

  // 40 degrees off 010 -- inside the new +/-45 absolute tolerance.
  const it = { lat: -27.65, lon: 153.05, track: 50, _dist_nm: 16.4 };
  const result = mod.predictRunwayGeometry(it);
  assert.deepEqual(result, { name: '01R', level: 'likely+' });
});

test('a genuine southbound 19 final south of the field is never mislabelled as 01', () => {
  const mod = loadPredictor();

  const it = { lat: -27.65, lon: 153.05, track: 190, _dist_nm: 16.4 };
  const result = mod.predictRunwayGeometry(it);
  const isConfident01 = !!(result && result.name && result.name.startsWith('01'));
  assert.equal(
    isConfident01,
    false,
    `expected no 01 call for a southbound 19 final, got ${JSON.stringify(result)}`
  );
});

test('LR552 repro: a still-high, fast-descending-from-cruise aircraft south of the field on a 010-ish track is not called as 01 just because its track matches', () => {
  const mod = loadPredictor();

  // Same track/position shape as the "genuine 01 approach" case above (which correctly still
  // gets the early call, see test below) -- the only difference is altitude. 10,850ft at
  // 16.4NM (~660ft/NM) is not remotely close to an established approach profile; this is a
  // STAR-leg aircraft still transiting toward the field, whose track happens to point at BNE
  // simply because that's the direct routing from the south -- not evidence it's on a 01 final.
  const it = { lat: -27.65, lon: 153.05, track: 15, _dist_nm: 16.4, alt_baro: 10850 };
  const result = mod.predictRunwayGeometry(it);
  const isConfident01 = !!(result && result.name && result.name.startsWith('01'));
  assert.equal(
    isConfident01,
    false,
    `expected no 01 call for a still-high STAR-leg aircraft, got ${JSON.stringify(result)}`
  );
});

test('a genuine 01 approach at a plausible altitude for its distance still gets the early call', () => {
  const mod = loadPredictor();

  // Same position/track as the LR552 repro above, but at an altitude consistent with an
  // aircraft actually established on approach at 16.4NM (below the ~450ft/NM ceiling).
  const it = { lat: -27.65, lon: 153.05, track: 15, _dist_nm: 16.4, alt_baro: 4500 };
  const result = mod.predictRunwayGeometry(it);
  assert.deepEqual(result, { name: '01R', level: 'likely+' });
});
