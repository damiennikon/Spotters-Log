// Fixes the "app never (or too late) self-corrects when a 19-family aircraft breaks the usual
// bay-entry-side pattern" bug, reported for two real flights:
//
// - QFA500: entered from the east (Moreton Island side -- "usually" 19L). RWY chip showed 19L at
//   7.8NM/1800ft. It landed 19R, and the chip DID self-correct -- but only by 2.3NM/50ft, seconds
//   before touchdown.
// - QLK329D: entered from the west (usually 19R). At 3.6NM/650ft ("Landing" status) the chip
//   still showed 19R -- it did NOT self-correct in time; it actually landed 19L.
//
// Root cause: estimateBayEntryEarly() computes its answer once from the aircraft's first-ever
// tracked position and returns that same answer unconditionally for the whole dnm∈(2,18]
// window, checked and returned BEFORE estimateBaySideCurrent() even runs -- so outside dnm<=3
// (where predictRunwayGeometry's 'high' result already wins unconditionally), nothing could
// ever revisit a wrong "usual pattern" guess. contradictsActiveFamily() can't help either --
// extractRunwayFamily() collapses 19L/19R to the same family, so it only ever catches a 19-vs-01
// mixup, never an L-vs-R one.
//
// Fix: geometryAgreementCache tracks a streak of consecutive 'high'-level predictRunwayGeometry()
// reads for the same L/R side, recorded on EVERY poll (unconditionally, unlike the bay-side
// estimates). Once the streak reaches GEOMETRY_AGREEMENT_MIN_STREAK consecutive matching reads,
// spanning at least GEOMETRY_AGREEMENT_MIN_SPAN_NM of real closing distance, predictRunwayForAircraft()
// lets it override a contradicting bay-side "usual pattern" answer, even outside dnm<=3. A single
// contradicting read is NOT enough -- that's the exact shape of bug commit b8736b4 fixed (a lone
// misleading 'high' geometry read, while the aircraft was still transiting the bay, flipped
// QLK365D wrong) -- so this must never fire on one poll alone. See the negative regression tests
// below for proof it doesn't.
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

// ===== Streak mechanics (recordGeometryAgreement / getSustainedGeometrySide directly) =====

test('geometry agreement: a single high read never qualifies as sustained', () => {
  const mod = loadPredictor();
  mod.recordGeometryAgreement('K1', { name: '19R', level: 'high' }, 9);
  assert.equal(mod.getSustainedGeometrySide('K1'), null);
});

test('geometry agreement: 3 consecutive same-side high reads spanning >=1.0NM qualifies', () => {
  const mod = loadPredictor();
  mod.recordGeometryAgreement('K2', { name: '19R', level: 'high' }, 9);
  mod.recordGeometryAgreement('K2', { name: '19R', level: 'high' }, 8.5);
  mod.recordGeometryAgreement('K2', { name: '19R', level: 'high' }, 8);
  assert.equal(mod.getSustainedGeometrySide('K2'), '19R');
});

test('geometry agreement: 3 consecutive same-side high reads bunched within <1.0NM does NOT qualify', () => {
  const mod = loadPredictor();
  mod.recordGeometryAgreement('K3', { name: '19R', level: 'high' }, 5.0);
  mod.recordGeometryAgreement('K3', { name: '19R', level: 'high' }, 4.95);
  mod.recordGeometryAgreement('K3', { name: '19R', level: 'high' }, 4.9);
  assert.equal(mod.getSustainedGeometrySide('K3'), null,
    'the span guard, not just the count, must be load-bearing -- 3 reads bunched in seconds is not "sustained"');
});

test('geometry agreement: an opposite-side high read resets the streak to a new streak of 1, not additive', () => {
  const mod = loadPredictor();
  mod.recordGeometryAgreement('K4', { name: '19R', level: 'high' }, 9);
  mod.recordGeometryAgreement('K4', { name: '19R', level: 'high' }, 8.5);
  mod.recordGeometryAgreement('K4', { name: '19L', level: 'high' }, 8);
  const entry = mod.geometryAgreementCache.get('K4');
  assert.deepEqual({ name: entry.name, count: entry.count, firstDnm: entry.firstDnm, lastDnm: entry.lastDnm },
    { name: '19L', count: 1, firstDnm: 8, lastDnm: 8 });
});

test('geometry agreement: a non-high read clears the streak', () => {
  const mod = loadPredictor();
  mod.recordGeometryAgreement('K5', { name: '19R', level: 'high' }, 9);
  mod.recordGeometryAgreement('K5', { name: '19R', level: 'likely' }, 8.5);
  assert.equal(mod.geometryAgreementCache.get('K5'), undefined);
});

test('geometry agreement: a null geometry result clears the streak', () => {
  const mod = loadPredictor();
  mod.recordGeometryAgreement('K6', { name: '19R', level: 'high' }, 9);
  mod.recordGeometryAgreement('K6', null, 8.5);
  assert.equal(mod.geometryAgreementCache.get('K6'), undefined);
});

// ===== QFA500-shaped positive regression: east entry, wrong 19L guess, sustained override =====

// Entry poll far east (Moreton Island side) locks estimateBayEntryEarly's answer to 19L
// (the "usual" pattern) for the whole approach. The remaining polls are real points on 19R's
// own extended centerline (computed from RUNWAYS.YBBN's actual threshold, same technique as
// runway-prediction.test.js's convergedHighPoll/fix1PoisonPoll), descending from 9NM to
// touchdown -- i.e. this aircraft is genuinely, consistently landing 19R the whole time,
// breaking the "usual" east-entry-means-19L pattern, same shape as the real QFA500 case.
const qfa500EntryPoll = { reg: 'QFA500', lat: -27.15, lon: 153.30, track: 210, _dist_nm: 17 };
const qfa500Polls = [
  { reg: 'QFA500', lat: -27.236329, lon: 153.145858, track: 190, _dist_nm: 9 },
  { reg: 'QFA500', lat: -27.244535, lon: 153.144228, track: 190, _dist_nm: 8.5 },
  { reg: 'QFA500', lat: -27.252742, lon: 153.142599, track: 190, _dist_nm: 8 },
  { reg: 'QFA500', lat: -27.260949, lon: 153.140970, track: 190, _dist_nm: 7.5 },
  { reg: 'QFA500', lat: -27.269156, lon: 153.139340, track: 190, _dist_nm: 7 },
  { reg: 'QFA500', lat: -27.285571, lon: 153.136082, track: 190, _dist_nm: 6 },
  { reg: 'QFA500', lat: -27.301985, lon: 153.132823, track: 190, _dist_nm: 5 },
  { reg: 'QFA500', lat: -27.318400, lon: 153.129564, track: 190, _dist_nm: 4 },
  { reg: 'QFA500', lat: -27.334815, lon: 153.126305, track: 190, _dist_nm: 3 },
  { reg: 'QFA500', lat: -27.343023, lon: 153.124676, track: 190, _dist_nm: 2.5 },
];

test('QFA500 repro: sanity -- the east-entry poll locks the bay-entry estimate to the wrong (19L) side', () => {
  const mod = loadPredictor();
  const result = mod.predictRunwayForAircraft(qfa500EntryPoll);
  assert.deepEqual(result, { name: '19L', level: 'estimate' });
});

test('QFA500 repro: still wrong at 9NM/8.5NM (streak not yet sustained), flips to the correct side by 8NM -- materially earlier than the old dnm<=3 cutoff', () => {
  const mod = loadPredictor();
  mod.predictRunwayForAircraft(qfa500EntryPoll);

  const byDnm = new Map();
  for (const p of qfa500Polls) byDnm.set(p._dist_nm, mod.predictRunwayForAircraft(p));

  assert.deepEqual(byDnm.get(9), { name: '19L', level: 'estimate' }, 'streak only has 1 qualifying read so far');
  assert.deepEqual(byDnm.get(8.5), { name: '19L', level: 'estimate' }, 'streak has 2 reads but only 0.5NM span so far');
  assert.deepEqual(byDnm.get(8), { name: '19R', level: 'high' }, 'streak now has 3 reads spanning 1.0NM -- sustained override kicks in');
  for (const dnm of [7.5, 7, 6, 5, 4, 3, 2.5]) {
    assert.deepEqual(byDnm.get(dnm), { name: '19R', level: 'high' }, `must stay correct at ${dnm}NM`);
  }
});

// ===== QLK329D-shaped positive regression: west entry, wrong 19R guess, sustained override =====

// Mirror construction: west/Caboolture entry locks estimateBayEntryEarly to 19R (usual pattern),
// but the aircraft is genuinely, consistently on 19L's own extended centerline throughout --
// same shape as the real QLK329D case, which was STILL showing the wrong runway at 3.6NM.
const qlk329dEntryPoll = { reg: 'QLK329D', lat: -27.10, lon: 152.95, track: 190, _dist_nm: 16 };
const qlk329dPolls = [
  { reg: 'QLK329D', lat: -27.239308, lon: 153.161210, track: 190, _dist_nm: 9 },
  { reg: 'QLK329D', lat: -27.247548, lon: 153.159574, track: 190, _dist_nm: 8.5 },
  { reg: 'QLK329D', lat: -27.255792, lon: 153.157937, track: 190, _dist_nm: 8 },
  { reg: 'QLK329D', lat: -27.264041, lon: 153.156299, track: 190, _dist_nm: 7.5 },
  { reg: 'QLK329D', lat: -27.272297, lon: 153.154660, track: 190, _dist_nm: 7 },
  { reg: 'QLK329D', lat: -27.288832, lon: 153.151377, track: 190, _dist_nm: 6 },
  { reg: 'QLK329D', lat: -27.305416, lon: 153.148084, track: 190, _dist_nm: 5 },
  { reg: 'QLK329D', lat: -27.322087, lon: 153.144774, track: 190, _dist_nm: 4 },
  { reg: 'QLK329D', lat: -27.328798, lon: 153.143441, track: 190, _dist_nm: 3.6 },
  { reg: 'QLK329D', lat: -27.347504, lon: 153.139727, track: 190, _dist_nm: 2.5 },
];

test('QLK329D repro: sanity -- the west-entry poll locks the bay-entry estimate to the wrong (19R) side', () => {
  const mod = loadPredictor();
  const result = mod.predictRunwayForAircraft(qlk329dEntryPoll);
  assert.deepEqual(result, { name: '19R', level: 'estimate' });
});

test('QLK329D repro: still wrong at 9NM/8.5NM, flips to the correct side by 8NM, and is correct at 3.6NM -- directly refuting the real-world case where the app was still wrong there', () => {
  const mod = loadPredictor();
  mod.predictRunwayForAircraft(qlk329dEntryPoll);

  const byDnm = new Map();
  for (const p of qlk329dPolls) byDnm.set(p._dist_nm, mod.predictRunwayForAircraft(p));

  assert.deepEqual(byDnm.get(9), { name: '19R', level: 'estimate' });
  assert.deepEqual(byDnm.get(8.5), { name: '19R', level: 'estimate' });
  assert.deepEqual(byDnm.get(8), { name: '19L', level: 'high' }, 'sustained override kicks in by 8NM');
  for (const dnm of [7.5, 7, 6, 5, 4, 3.6, 2.5]) {
    assert.deepEqual(byDnm.get(dnm), { name: '19L', level: 'high' }, `must stay correct at ${dnm}NM`);
  }
});

// ===== b8736b4/QLK365D-shaped negative regression: a single blip must NOT trigger the override =====

// Identical construction to runway-prediction.test.js's "Fix 1 regression" test: a poisoned
// bay-side-current majority (genuinely on the real 19L corridor, per the divider-fix PR) followed
// by exactly ONE genuinely 'high' 19R geometry read at 5NM. This is the exact shape of the
// original b8736b4 bug (QLK365D) -- proving the new sustained-agreement mechanism does not
// resurrect it: one high read is structurally incapable of building a 3-read streak.
test('b8736b4/QLK365D repro: a single high-confidence geometry read does NOT override a poisoned bay-side majority', () => {
  const mod = loadPredictor();
  const key = 'QLK-POISON';
  const poisonPolls = [
    { reg: key, lat: -27.217584, lon: 153.241081, track: 205, _dist_nm: 11.5 },
    { reg: key, lat: -27.247360, lon: 153.224082, track: 205, _dist_nm: 9.5 },
    { reg: key, lat: -27.277148, lon: 153.207046, track: 205, _dist_nm: 7.5 },
  ];
  for (const p of poisonPolls) {
    const r = mod.predictRunwayForAircraft(p);
    assert.equal(r && r.name, '19L', `sanity: poisoning poll at ${p._dist_nm}NM should read 19L`);
  }

  const poll5nm = { reg: key, lat: -27.2708, lon: 153.1390, track: 190, _dist_nm: 5.0 };
  const geometry = mod.predictRunwayGeometry(poll5nm);
  assert.deepEqual(geometry, { name: '19R', level: 'high' },
    'sanity: geometry really is high confidence 19R at 5NM for this position');

  const result = mod.predictRunwayForAircraft(poll5nm);
  assert.deepEqual(result, { name: '19L', level: 'estimate' },
    'a single high geometry read must not override the poisoned majority -- this is the exact shape of the b8736b4 bug');

  const streak = mod.geometryAgreementCache.get(key);
  assert.equal(streak && streak.count, 1, 'the streak never grows past 1 for this scenario');
});

// Replays the identical QLK453D poll stream from runway-prediction.test.js's "Fix 2" test and
// asserts identical output at every distance -- belt-and-suspenders proof that the new mechanism
// doesn't change this already-validated reconstruction's behavior. Its one transient wrong-side
// 'high' read (5.2NM) is sandwiched between a non-high read (6.6NM) and the next 'high' read
// (3.6NM), so it never accumulates a qualifying streak either.
test('QLK453D repro: identical output to the existing Fix 2 reconstruction at every distance', () => {
  const mod = loadPredictor();
  const qlk453dPolls = [
    { reg: 'QLK453D', lat: -27.230, lon: 153.111274, track: 200, _dist_nm: 10.5 },
    { reg: 'QLK453D', lat: -27.255, lon: 153.112212, track: 202, _dist_nm: 9.2 },
    { reg: 'QLK453D', lat: -27.280, lon: 153.115028, track: 206, _dist_nm: 8.0 },
    { reg: 'QLK453D', lat: -27.300, lon: 153.188364, track: 218, _dist_nm: 6.6 },
    { reg: 'QLK453D', lat: -27.320, lon: 153.176403, track: 208, _dist_nm: 5.2 },
    { reg: 'QLK453D', lat: -27.340, lon: 153.115966, track: 194, _dist_nm: 3.6 },
    { reg: 'QLK453D', lat: -27.355, lon: 153.114089, track: 190, _dist_nm: 2.5 },
  ];
  const expected = [
    { name: '19R', level: 'estimate' },
    { name: '19R', level: 'estimate' },
    { name: '19R', level: 'estimate' },
    { name: '19R', level: 'estimate' },
    { name: '19R', level: 'estimate' },
    { name: '19R', level: 'estimate' },
    { name: '19R', level: 'high' },
  ];
  qlk453dPolls.forEach((p, i) => {
    const result = mod.predictRunwayForAircraft(p);
    assert.deepEqual(result, expected[i], `mismatch at ${p._dist_nm}NM`);
  });
});
