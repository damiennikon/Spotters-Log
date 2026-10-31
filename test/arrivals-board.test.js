// Tests the Arrivals Board's pure filtering/classification logic in index.html
// (boardPassesPreFilter, boardRouteState, boardIsPossibleInbound,
// boardPointsMoreAtOtherAirport, boardEta). Same approach as the other test\*.test.js files:
// pull the relevant function/const source text out of the self-contained <script> IIFE and
// evaluate it standalone via `new Function`, rather than running the whole app (no DOM/fetch
// available here). APT is set directly to AIRPORTS[0] (YBBN) rather than going through
// loadAirport()/localStorage, which don't exist in this environment.

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

function loadBoardLogic() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const pieces = [
    extractStatement(html, 'const AIRPORTS = ['),
    'let APT = AIRPORTS[0];', // YBBN -- stands in for loadAirport()/DEFAULT_APT in this harness
    extractFunction(html, 'ft'),
    extractFunction(html, 'kt'),
    extractFunction(html, 'nmFromMeters'),
    extractFunction(html, 'distNM'),
    extractFunction(html, 'bearingDeg'),
    extractFunction(html, 'angleDiff'),
    extractFunction(html, 'isValidCallsign'),
    extractFunction(html, 'cleanFlight'),
    extractFunction(html, 'isGroundish'),
    extractStatement(html, 'const BOARD_PREFILTER_MAX_TRACK_ERR_DEG ='),
    extractStatement(html, 'const BOARD_POSSIBLE_MAX_DIST_NM ='),
    extractStatement(html, 'const BOARD_POSSIBLE_MAX_TRACK_ERR_DEG ='),
    extractStatement(html, 'const BOARD_POSSIBLE_MIN_DESCENT_FPM ='),
    extractStatement(html, 'const BOARD_POSSIBLE_MIN_GS_KT ='),
    extractStatement(html, 'const BOARD_ETA_MIN_GS_KT ='),
    'const routeCache = new Map();',
    extractFunction(html, 'boardAltFt'),
    extractFunction(html, 'boardPassesPreFilter'),
    extractFunction(html, 'boardRouteState'),
    extractFunction(html, 'boardPointsMoreAtOtherAirport'),
    extractFunction(html, 'boardIsPossibleInbound'),
    extractFunction(html, 'boardEta'),
  ].join('\n\n');

  return new Function(`${pieces}
    return {
      boardPassesPreFilter, boardRouteState, boardIsPossibleInbound, boardEta,
      boardPointsMoreAtOtherAirport, routeCache, distNM, bearingDeg, angleDiff,
      setApt(icao) { APT = AIRPORTS.find(a => a.icao === icao) || APT; },
      getApt() { return APT; },
      AIRPORTS,
    };
  `)();
}

const board = loadBoardLogic();
const YBBN = board.AIRPORTS.find(a => a.icao === 'YBBN');
const YBCG = board.AIRPORTS.find(a => a.icao === 'YBCG'); // Gold Coast

// A point roughly south of Brisbane, well placed to also be plausibly Gold Coast-bound.
const SOUTH_OF_BNE = { lat: -27.9, lon: 153.3 };

function bearingTo(from, to) {
  const toRad = x => x * Math.PI / 180;
  const toDeg = x => x * 180 / Math.PI;
  const phi1 = toRad(from.lat), phi2 = toRad(to.lat);
  const lambda1 = toRad(from.lon), lambda2 = toRad(to.lon);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

test.beforeEach(() => {
  board.setApt('YBBN');
  board.routeCache.clear();
});

// (a) a YBBN-bound far-out aircraft with a route hit -> tier 1 (boardRouteState)
test('(a) a confirmed route to YBBN resolves to tier1', () => {
  board.routeCache.set('QFA12', { origin: 'NZAA', destination: 'YBBN' });
  assert.equal(board.boardRouteState('QFA12'), 'tier1');
});

// (b) a SYD-bound aircraft with a route hit -> excluded from both tiers
test('(b) a confirmed route to a different airport is excluded', () => {
  board.routeCache.set('QFA34', { origin: 'NZAA', destination: 'YSSY' });
  assert.equal(board.boardRouteState('QFA34'), 'exclude');
});

// (c) a ground aircraft lists nowhere (isGroundish / airborne check in boardPassesPreFilter)
test('(c) a ground aircraft fails the pre-filter', () => {
  const p = { lat: -27.0, lon: 153.0, flight: 'QFA56', alt_baro: 'ground', gs: 12, track: bearingTo({ lat: -27.0, lon: 153.0 }, YBBN) };
  assert.equal(board.boardPassesPreFilter(p, 0), false);
});

test('(c) an airborne aircraft above 1000ft passes the altitude/ground part of the pre-filter', () => {
  const p = { lat: -27.0, lon: 153.0, flight: 'QFA56', alt_baro: 5000, gs: 250, track: 180 };
  assert.equal(board.boardPassesPreFilter(p, 0), true);
});

// (d) a route-MISS aircraft descending, tracking within 25deg of Brisbane, inside 150NM -> tier2
test('(d) a descending route-miss aircraft tracking toward YBBN within range qualifies for tier2', () => {
  const p = {
    lat: SOUTH_OF_BNE.lat, lon: SOUTH_OF_BNE.lon,
    track: bearingTo(SOUTH_OF_BNE, YBBN),
    gs: 280, baro_rate: -1200,
  };
  const dnm = 90; // inside BOARD_POSSIBLE_MAX_DIST_NM (150)
  const trackErr = 0;
  assert.equal(board.boardIsPossibleInbound(p, dnm, trackErr), true);
});

// (e) a route-MISS aircraft in level cruise -> excluded from tier2
test('(e) a level-cruise (non-descending) route-miss aircraft does not qualify for tier2', () => {
  const p = {
    lat: SOUTH_OF_BNE.lat, lon: SOUTH_OF_BNE.lon,
    track: bearingTo(SOUTH_OF_BNE, YBBN),
    gs: 280, baro_rate: 0,
  };
  assert.equal(board.boardIsPossibleInbound(p, 90, 0), false);
});

// (e) a route-MISS aircraft pointing at Gold Coast more precisely than at Brisbane -> excluded
test('(e) an aircraft tracking more precisely toward Gold Coast than Brisbane is excluded (false-positive guard)', () => {
  // Due south of Gold Coast (so YBCG is closer than YBBN) and tracking exactly at Gold Coast --
  // a smaller angular error toward YBCG than toward YBBN, with YBCG no farther away than YBBN.
  const pos = { lat: YBCG.lat - 0.5, lon: YBCG.lon };
  const p = {
    lat: pos.lat, lon: pos.lon,
    track: board.bearingDeg(pos.lat, pos.lon, YBCG.lat, YBCG.lon),
    gs: 280, baro_rate: -1200,
  };
  const dnmToApt = board.distNM(pos.lat, pos.lon, YBBN.lat, YBBN.lon);
  const dnmToOther = board.distNM(pos.lat, pos.lon, YBCG.lat, YBCG.lon);
  assert.ok(dnmToOther <= dnmToApt, 'test fixture: Gold Coast should be no farther than Brisbane');
  const bearingToApt = board.bearingDeg(pos.lat, pos.lon, YBBN.lat, YBBN.lon);
  const trackErrToApt = board.angleDiff(p.track, bearingToApt);
  assert.equal(board.boardPointsMoreAtOtherAirport(p, dnmToApt, trackErrToApt), true);
  assert.equal(board.boardIsPossibleInbound(p, dnmToApt, trackErrToApt), false);
});

// (f) a route lookup still pending is handled upstream (boardRouteState returns 'pending', and
// the board refresh loop treats 'pending' the same as 'exclude' -- never shown as tier2).
test('(f) an uncached callsign (lookup not yet done) is "pending", not "miss"', () => {
  assert.equal(board.boardRouteState('QLK999'), 'pending');
});

test('(f) a cached miss is reported as "miss" (tier2 candidate), distinct from "pending"', () => {
  board.routeCache.set('QLK999', { miss: true });
  assert.equal(board.boardRouteState('QLK999'), 'miss');
});

// (g) ETA arithmetic is right and hidden below 100kt
test('(g) ETA minutes/clock are computed from distance and ground speed', () => {
  const now = new Date('2026-01-01T10:00:00').getTime();
  const eta = board.boardEta(120, 240, now); // 120nm at 240kt = 30 min
  assert.ok(eta);
  assert.equal(eta.minutes, 30);
  assert.equal(eta.clock, '10:30');
});

test('(g) ETA is hidden (null) below BOARD_ETA_MIN_GS_KT (100kt)', () => {
  const now = Date.now();
  assert.equal(board.boardEta(50, 99, now), null);
  assert.notEqual(board.boardEta(50, 100, now), null);
});

test('(g) ETA is null for missing/invalid inputs', () => {
  assert.equal(board.boardEta(null, 200, Date.now()), null);
  assert.equal(board.boardEta(50, null, Date.now()), null);
});

// Pre-filter: track-error gate and missing-callsign gate
test('pre-filter rejects a track more than 60deg off the bearing to APT', () => {
  const bearingToApt = bearingTo(SOUTH_OF_BNE, YBBN);
  const wrongTrack = (bearingToApt + 150) % 360; // well outside the 60deg pre-filter window
  const p = { lat: SOUTH_OF_BNE.lat, lon: SOUTH_OF_BNE.lon, flight: 'QFA78', alt_baro: 15000, gs: 300, track: wrongTrack };
  const trackErr = Math.abs(((wrongTrack - bearingToApt + 540) % 360) - 180);
  assert.ok(trackErr > 60);
  assert.equal(board.boardPassesPreFilter(p, trackErr), false);
});

test('pre-filter rejects an aircraft with no usable callsign', () => {
  const p = { lat: SOUTH_OF_BNE.lat, lon: SOUTH_OF_BNE.lon, flight: '@@@@@@@', alt_baro: 15000, gs: 300, track: 180 };
  assert.equal(board.boardPassesPreFilter(p, 0), false);
});
