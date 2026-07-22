// Two related fixes to predictRunwayForAircraft(), both confirmed against the actual pre-fix
// code (via `git stash`, not just reasoning about it) before being implemented here:
//
// Fix 1 (ordering): estimateBaySideCurrent() was checked and returned BEFORE the
// precise.level === 'high' geometry check, even though its own distance window (dnm > 2 to 18)
// overlaps the range geometry has already converged in -- the same <=3NM range at which
// runwayLockCache actually locks a 'high' result in. So a converged, cross-track-verified
// 'high' result could still be silently overridden by a bay-side estimate reading the "wrong"
// side, anywhere in that (2,3]NM sliver. Fixed by checking a genuinely 'high' geometry result
// FIRST, before either bay-side estimate runs, whenever dnm<=3.
//
// This is deliberately scoped to <=3NM, not unconditional: predictRunwayForAircraft() used to
// trust ANY 'high' geometry result unconditionally, and that was live-tested and reverted (see
// commit b8736b4) specifically because it flipped QLK365D wrong at 6.9NM -- correct 19R at
// 7.5NM via the bay-side check, wrong 19L once geometry's own 'high' tier kicked in and
// short-circuited past it. A 'high' result losing to a contradicting bay-side estimate outside
// <=3NM is that fix still working, not a gap in this one -- see the "Fix 1 regression" test
// below, which proves it holds even for a genuinely 'high' result at 5NM against a deliberately
// poisoned bay-side-current history.
//
// Fix 2 (snapshot vs. trend): estimateBaySideCurrent() decided purely from the aircraft's
// CURRENT longitude vs. BAY_DIVIDER_LON. Real Brisbane 19-family traffic gets vectored
// laterally during the approach -- entering from one side of the bay, drifting across while
// intercepting, then settling back onto its actual landing runway's centerline -- so an
// aircraft genuinely landing (say) 19R can transiently read east of the divider mid-vector,
// well before it has actually converged. A single snapshot can't tell "temporarily on this
// side mid-vector" from "actually landing on this side". Fixed by deciding from a short
// rolling history of recent qualifying polls (baySideHistoryCache, capped at
// BAY_SIDE_HISTORY_MAX_POLLS) by MAJORITY side, instead of trusting the latest point alone --
// while still re-evaluating on every poll, same as before.
//
// The QLK453D-shaped reconstruction below (west entry -> east drift through the turn -> settle
// back onto 19R) is SYNTHETIC, built to match the real-world pattern reported for that flight
// (and QFA707 / QLK365D, which showed the same shape): the wrong-side flip only ever showed up
// for a couple of polls mid-vector, then self-corrected once established. Two things are
// checked at each of the "mid-vector" distances (6.6NM and 5.2NM) to prove this isn't just
// asserting the fixed answer and hoping:
//   (a) estimateBaySideCurrent(), asked about that exact snapshot IN ISOLATION (a fresh
//       aircraft key with no prior history -- mathematically identical to the pre-Fix-2
//       single-snapshot behavior, since a 1-entry "majority" is just that one entry), really
//       does read the wrong side. This is the actual mechanism behind the reported flip, not a
//       hypothetical.
//   (b) predictRunwayForAircraft(), fed the FULL realistic poll sequence in order (so real
//       history has actually accumulated first, same as it would live), never returns the wrong
//       side at any point -- confirmed separately against the actual pre-fix code via
//       `git stash` while developing this fix, which DOES flip to 19L at both distances.
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
    extractStatement(html, 'const BAY_SIDE_HISTORY_MAX_POLLS ='),
    extractConstObject(html, 'ARCHERFIELD'),
    extractStatement(html, 'const ARCHERFIELD_DIVIDER_LON ='),
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
    extractFunction(html, 'predictRunwayForAircraft'),
  ].join('\n\n');

  const wrapper = `(function() {
    let APT = null;
    const bayEntryCache = new Map();
    const runwayLockCache = new Map();
    const baySideHistoryCache = new Map();
    ${pieces}
    return {
      predictRunwayGeometry,
      estimateBaySideCurrent,
      estimateBayEntryEarly,
      recordBayEntryPosition,
      predictRunwayForAircraft,
      bayEntryCache,
      runwayLockCache,
      baySideHistoryCache,
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

// ===== Fix 1: ordering (converged 'high' geometry vs. a contradicting bay-side estimate) =====

// Same position/track shape as the confirmed real 'high' case in
// lr552-active-family-consensus.test.js (lat -27.2708, lon 153.1390, track 190 -- squarely on
// the 19R extended centerline), but pulled in from 6.9NM to 2.5NM, i.e. inside the <=3NM range
// where runwayLockCache actually locks a 'high' result in. This position is real, confirmed
// east-of-BAY_DIVIDER_LON territory (~0.58NM), so the two signals genuinely disagree here.
const convergedHighPoll = { reg: 'QLK-FIX1', lat: -27.2708, lon: 153.1390, track: 190, _dist_nm: 2.5 };

test('Fix 1 setup: at 2.5NM the geometry and bay-side-current signals genuinely disagree', () => {
  const mod = loadPredictor();

  const geometry = mod.predictRunwayGeometry(convergedHighPoll);
  assert.deepEqual(geometry, { name: '19R', level: 'high' },
    'sanity: geometry must actually reach high confidence here for this to be a real ordering conflict');

  const baySide = mod.estimateBaySideCurrent(convergedHighPoll, 'QLK-FIX1');
  assert.equal(baySide && baySide.name, '19L',
    'sanity: the bay-side-current snapshot reads the opposite (wrong) side at this exact position');
});

test('Fix 1: a converged high-confidence geometry result wins over a contradicting bay-side estimate at <=3NM', () => {
  const mod = loadPredictor();
  const result = mod.predictRunwayForAircraft(convergedHighPoll);
  assert.deepEqual(result, { name: '19R', level: 'high' },
    'the converged, cross-track-verified geometry call must win, not the contradicting bay-side snapshot');
});

// Fix 1's <=3NM scope is deliberate, not an oversight: predictRunwayForAircraft() used to run
// `if (precise && precise.level === 'high') return precise;` unconditionally, before any
// bay-side check at all (see commit b8736b4, "Prefer bay-side evidence over geometry 'high' for
// 19L/19R mid-range"). That was live-tested and reverted specifically because it flipped
// QLK365D wrong at 6.9NM: correct 19R at 7.5NM via the bay-side check, then wrong 19L once
// geometry's own 'high' tier kicked in and short-circuited past the bay-side check entirely.
// So a genuinely 'high' geometry result losing to a contradicting bay-side estimate anywhere
// outside <=3NM is not a bug -- it's the fix for that exact flip, still doing its job. This
// test proves it's still doing its job even in the strongest form of that conflict: a real
// 'high' geometry result at 5NM, contradicted by a bay-side-CURRENT majority vote (not just the
// simpler bay-entry estimate) that's been deliberately built up ("poisoned") on the wrong side
// beforehand -- exactly the shape of case that motivated b8736b4 in the first place.
test('Fix 1 regression: outside <=3NM, a poisoned bay-side-current majority vote still wins over a genuinely high geometry result (b8736b4 behavior preserved)', () => {
  const mod = loadPredictor();
  const key = 'QLK-POISON';

  // First-ever poll for this aircraft is already inside 12NM (BAY_ENTRY_MIN_DIST_NM), so
  // estimateBayEntryEarly never gets a qualifying entry point -- this isolates the test to
  // estimateBaySideCurrent's majority-vote history specifically (Fix 2's mechanism), rather than
  // letting the separate bay-entry estimate reach the same conclusion for an unrelated reason.
  const poisonPolls = [
    { reg: key, lat: -27.22, lon: 153.148, track: 212, _dist_nm: 11.5 },
    { reg: key, lat: -27.24, lon: 153.146, track: 208, _dist_nm: 9.5 },
    { reg: key, lat: -27.26, lon: 153.147, track: 209, _dist_nm: 7.5 },
  ];
  for (const p of poisonPolls) {
    const r = mod.predictRunwayForAircraft(p);
    assert.equal(r && r.name, '19L', `sanity: poisoning poll at ${p._dist_nm}NM should read 19L`);
  }
  const hist = mod.baySideHistoryCache.get(key);
  assert.deepEqual(hist && hist.sides, ['19L', '19L', '19L'], 'sanity: three 19L votes recorded before the high-confidence poll');

  // Same lr552-shaped position used in the Fix 1 <=3NM test above (genuinely on the 19R
  // extended centerline), but at 5NM -- comfortably outside the <=3NM convergence gate.
  const poll5nm = { reg: key, lat: -27.2708, lon: 153.1390, track: 190, _dist_nm: 5.0 };
  const geometry = mod.predictRunwayGeometry(poll5nm);
  assert.deepEqual(geometry, { name: '19R', level: 'high' },
    'sanity: geometry really is high confidence 19R at 5NM for this position');

  const result = mod.predictRunwayForAircraft(poll5nm);
  assert.deepEqual(result, { name: '19L', level: 'estimate' },
    'the poisoned bay-side majority vote must still win over a contradicting high geometry result outside <=3NM');
});

// ===== Fix 2: snapshot vs. trend (QLK453D-shaped west-entry / east-drift / settle reconstruction) =====

// Reconstructed poll stream for a 19R arrival that enters west of BAY_DIVIDER_LON, drifts east
// across it while intercepting final (a normal lateral vector, not a side change), then settles
// back west onto the 19R centerline -- the real-world pattern reported for QLK453D (and QFA707 /
// QLK365D). The first-ever poll is already inside 12NM (BAY_ENTRY_MIN_DIST_NM), so
// estimateBayEntryEarly never has a qualifying entry point and stays out of the way: every poll
// below actually exercises estimateBaySideCurrent's majority-vote history, not the separate
// bay-entry heuristic.
const qlk453dPolls = [
  { reg: 'QLK453D', lat: -27.230, lon: 153.111274, track: 200, _dist_nm: 10.5 }, // west, established
  { reg: 'QLK453D', lat: -27.255, lon: 153.112212, track: 202, _dist_nm: 9.2 },  // west
  { reg: 'QLK453D', lat: -27.280, lon: 153.115028, track: 206, _dist_nm: 8.0 },  // west, starting to turn
  { reg: 'QLK453D', lat: -27.300, lon: 153.139429, track: 218, _dist_nm: 6.6 },  // MID-VECTOR: transient east crossing
  { reg: 'QLK453D', lat: -27.320, lon: 153.139053, track: 208, _dist_nm: 5.2 },  // still transient east
  { reg: 'QLK453D', lat: -27.340, lon: 153.115966, track: 194, _dist_nm: 3.6 },  // settling back west
  { reg: 'QLK453D', lat: -27.355, lon: 153.114089, track: 190, _dist_nm: 2.5 },  // converged on 19R
];

test('Fix 2 setup: the mid-vector polls really do read the wrong side in isolation (no prior history)', () => {
  const mod = loadPredictor();
  const midVectorPolls = qlk453dPolls.filter(p => p._dist_nm === 6.6 || p._dist_nm === 5.2);
  assert.equal(midVectorPolls.length, 2);

  for (const p of midVectorPolls) {
    // Fresh, never-seen-before key per poll -- no accumulated history, so this is mathematically
    // the same as the pre-Fix-2 single-snapshot check.
    const isolated = mod.estimateBaySideCurrent(p, `isolated-${p._dist_nm}`);
    assert.equal(isolated && isolated.name, '19L',
      `sanity: the ${p._dist_nm}NM snapshot in isolation misreads the side as 19L, confirming the real flip mechanism`);
  }
});

test('QLK453D repro: predictRunwayGeometry converges on 19R by 2.5NM (sanity for the reconstruction)', () => {
  const mod = loadPredictor();
  const last = qlk453dPolls[qlk453dPolls.length - 1];
  const geometry = mod.predictRunwayGeometry(last);
  assert.deepEqual(geometry, { name: '19R', level: 'high' });
});

test('Fix 2: with both fixes applied, the full realistic poll stream never flips to the wrong side, even mid-vector', () => {
  const mod = loadPredictor();

  const results = qlk453dPolls.map(p => ({ dnm: p._dist_nm, result: mod.predictRunwayForAircraft(p) }));

  for (const { dnm, result } of results) {
    assert.equal(result && result.name, '19R', `wrong-side flip at ${dnm}NM: ${JSON.stringify(result)}`);
  }

  // The two mid-vector polls did cast '19L' votes into the history -- majority-vote isn't
  // pretending they didn't happen, it's outvoting them with the surrounding west-side polls.
  const hist = mod.baySideHistoryCache.get('QLK453D');
  assert.deepEqual(hist && hist.sides, ['19R', '19R', '19R', '19L', '19L', '19R']);

  // By 2.5NM the geometry itself has converged to 'high', and Fix 1 lets that win outright.
  const finalResult = results[results.length - 1].result;
  assert.deepEqual(finalResult, { name: '19R', level: 'high' });
});

test('Fix 2 regression: a genuine, sustained side change still updates within the history window (not stuck forever)', () => {
  const mod = loadPredictor();
  const key = 'SIDE-CHANGE';

  // Five consecutive genuine 19R polls...
  for (let i = 0; i < 5; i++) {
    const p = { reg: key, lat: -27.25 - i * 0.01, lon: 153.111, track: 195, _dist_nm: 12 - i };
    const r = mod.estimateBaySideCurrent(p, key);
    assert.equal(r && r.name, '19R');
  }
  // ...then a real, sustained run of 19L polls (not a single transient blip) should eventually
  // become the majority within BAY_SIDE_HISTORY_MAX_POLLS polls, not be stuck on the old side.
  let last = null;
  for (let i = 0; i < 5; i++) {
    const p = { reg: key, lat: -27.30 - i * 0.01, lon: 153.140, track: 210, _dist_nm: 7 - i };
    last = mod.estimateBaySideCurrent(p, key);
  }
  assert.equal(last && last.name, '19L', 'a sustained side change must eventually win the majority vote');
});
