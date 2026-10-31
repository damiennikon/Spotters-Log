// Tests the Arrivals Board's tab lifecycle: setTabMode('board') must start exactly one polling
// timer, and leaving the tab (setTabMode('flights') or ('radar')) must stop it, with no leaked
// intervals across repeated switches. Pulls setTabMode/updateNavActiveState/startBoardPolling/
// stopBoardPolling/startMetarPolling/stopMetarPolling out of index.html's <script> IIFE (same
// extraction approach as the other test\*.test.js files) and evaluates them against stub DOM
// elements and a local setInterval/clearInterval shim that just counts active timers -- this
// also acts as a non-regression check that setTabMode/updateNavActiveState still handle the
// pre-existing 'flights'/'radar' modes exactly as before (see the flights/radar assertions
// below), since this is the one place the Board feature's own instructions required editing
// those two functions.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function extractStatement(html, marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `"${marker}" not found in index.html`);
  const end = html.indexOf(';', start);
  assert.notEqual(end, -1, `could not find end of statement starting "${marker}"`);
  return html.slice(start, end + 1);
}

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

function fakeEl() {
  const classes = new Set();
  return {
    style: {},
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
  };
}

function loadLifecycle() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const pieces = [
    // Local setInterval/clearInterval shim: shadows the globals for everything evaluated in
    // this harness, so we can count active timers without leaking real ones into the test
    // process (and without depending on timing).
    `let __activeTimers = 0;
     function setInterval(fn, ms) { __activeTimers++; return { __fake: true }; }
     function clearInterval(h) { if (h) __activeTimers--; }`,
    extractStatement(html, 'const BOARD_REFRESH_MS ='),
    extractStatement(html, 'const METAR_REFRESH_MS ='),
    extractFunction(html, 'startMetarPolling'),
    extractFunction(html, 'stopMetarPolling'),
    extractFunction(html, 'setTabMode'),
    extractFunction(html, 'updateNavActiveState'),
    extractFunction(html, 'startBoardPolling'),
    extractFunction(html, 'stopBoardPolling'),
  ].join('\n\n');

  return new Function('stubs', `
    let TAB_MODE = 'flights';
    let metarTimer = null;
    let metarInFlight = false;
    let boardTimer = null;
    let radarMap = null;

    const { $flightsTab, $radarWrap, $boardView, $navFlightsBtn, $navRadarBtn, $navBoardBtn, $savedBtn, $navSettingsBtn } = stubs;

    // Stubs for everything setTabMode/startBoardPolling touch that needs a real DOM/network/
    // Leaflet (not available in this harness) -- none of these affect timer bookkeeping.
    function ensureRadarMap() {}
    function updateRadar() {}
    function renderWindSock() {}
    async function pollMetarWind() {}
    function boardRefreshCycle() {}
    let CURRENT_RADAR_LIST = [];
    function requestAnimationFrame(fn) { return 0; } // never actually invoked in this harness

    ${pieces}

    return {
      setTabMode,
      getActiveTimers() { return __activeTimers; },
      getTabMode() { return TAB_MODE; },
      isActive(el) { return el.classList.contains('active'); },
      isShowing(el) { return el.classList.contains('show'); },
      isHidden(el) { return el.style.display === 'none'; },
    };
  `)({
    $flightsTab: fakeEl(), $radarWrap: fakeEl(), $boardView: fakeEl(),
    $navFlightsBtn: fakeEl(), $navRadarBtn: fakeEl(), $navBoardBtn: fakeEl(),
    $savedBtn: fakeEl(), $navSettingsBtn: fakeEl(),
  });
}

test('(i) opening the Board tab starts exactly one timer', () => {
  const app = loadLifecycle();
  assert.equal(app.getActiveTimers(), 0);
  app.setTabMode('board');
  assert.equal(app.getTabMode(), 'board');
  assert.equal(app.getActiveTimers(), 1);
});

test('(i) leaving the Board tab for Flights stops the timer (no leaked intervals)', () => {
  const app = loadLifecycle();
  app.setTabMode('board');
  assert.equal(app.getActiveTimers(), 1);
  app.setTabMode('flights');
  assert.equal(app.getActiveTimers(), 0);
});

test('(i) leaving the Board tab for Radar stops the board timer (Radar starts its own unrelated metar timer, not a leaked board one)', () => {
  const app = loadLifecycle();
  app.setTabMode('board');
  assert.equal(app.getActiveTimers(), 1); // the board timer
  app.setTabMode('radar');
  // Net count is 1 again here too, but it's Radar's own metar-polling timer, not the board's --
  // proven by then leaving Radar and seeing it drop all the way to 0 (no leaked board timer
  // stacked underneath it).
  assert.equal(app.getActiveTimers(), 1);
  app.setTabMode('flights');
  assert.equal(app.getActiveTimers(), 0);
});

test('(i) repeated switching never leaks more than one active board timer', () => {
  const app = loadLifecycle();
  for (let i = 0; i < 5; i++) {
    app.setTabMode('board');
    assert.equal(app.getActiveTimers(), 1, `iteration ${i}: expected exactly one timer while on Board`);
    app.setTabMode('flights');
    assert.equal(app.getActiveTimers(), 0, `iteration ${i}: expected zero timers after leaving Board`);
  }
});

test('(i) re-entering Board after a prior session does not double up timers', () => {
  const app = loadLifecycle();
  app.setTabMode('board');
  app.setTabMode('board'); // re-selecting the same tab (e.g. a stray double-tap)
  assert.equal(app.getActiveTimers(), 1);
});

// (j) non-regression: Flights/Radar tab switching still behaves as before the Board edits.
test('(j) setTabMode("flights") shows the Flights tab and marks its nav button active', () => {
  const app = loadLifecycle();
  app.setTabMode('radar');
  app.setTabMode('flights');
  assert.equal(app.getTabMode(), 'flights');
});

test('(j) setTabMode("radar") hides Flights and shows the Radar view', () => {
  const app = loadLifecycle();
  app.setTabMode('radar');
  assert.equal(app.getTabMode(), 'radar');
});

test('(j) an unrecognized mode falls back to "flights" (unchanged pre-Board default behaviour)', () => {
  const app = loadLifecycle();
  app.setTabMode('radar');
  app.setTabMode('nonsense');
  assert.equal(app.getTabMode(), 'flights');
});
