/* Dev-only test helpers: headless Chromium (SwiftShader WebGL) via Playwright. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const GAME_URL = 'file://' + encodeURI(path.join(ROOT, 'index.html'));

function loadPlaywright() {
  const home = process.env.HOME || '';
  const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright'];
  try {
    const npx = path.join(home, '.npm/_npx');
    for (const d of fs.readdirSync(npx)) candidates.push(path.join(npx, d, 'node_modules/playwright'));
  } catch (e) { /* no npx cache */ }
  for (const c of candidates) {
    if (!c) continue;
    try { return require(c); } catch (e) { /* try next */ }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_PATH or run `npx playwright install chromium` once.');
}

async function launch() {
  const { chromium } = loadPlaywright();
  return chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required'],
  });
}

/**
 * Opens the game. `query` is appended to the URL (e.g. 'autostart=1&seed=hello&rd=5').
 * Waits until loading finished and at least `minMeshed` chunks are meshed.
 * Returns { page, errors } - errors collects page errors + console.error output.
 */
async function openGame(browser, query = 'autostart=1&seed=hello&rd=5', opts = {}) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1000, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  if (opts.beforeGoto) await opts.beforeGoto(page);
  await page.goto(GAME_URL + (query ? '?' + query : ''));
  if (opts.waitReady !== false) {
    const minMeshed = opts.minMeshed ?? 20;
    await page.waitForFunction((n) => {
      const g = window.__game;
      if (!g || !g.world) return false;
      const loading = document.getElementById('loading');
      const doneLoading = !loading || loading.style.display === 'none';
      return doneLoading && g.world.stats().meshed >= n;
    }, minMeshed, { timeout: opts.timeout || 90000 });
  }
  return { page, errors };
}

async function screenshot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const base = name.endsWith('.png') ? name : name + '.png';
  const file = path.isAbsolute(base) ? base : path.join(OUT, base);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  return file;
}

/** Loads the worker bundle in a Node VM so terrain/mesher can be tested without a browser. */
function loadWorkerInNode(scriptFiles) {
  const main = vm.createContext({ console, URL: {}, Blob: function () {} });
  for (const f of scriptFiles) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), main, { filename: f });
  const src = vm.runInContext('WorkerBundle.source()', main);
  const out = [];
  const wctx = vm.createContext({
    console, Math, Uint8Array, Int16Array, Float32Array, Uint32Array, Int32Array, Uint16Array,
    self: { postMessage: (m) => out.push(m) },
  });
  vm.runInContext(src, wctx, { filename: 'worker-bundle' });
  return {
    main, wctx,
    send(m) { out.length = 0; wctx.self.onmessage({ data: m }); return out[0]; },
  };
}

function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + msg); }
function near(a, b, eps, msg) { if (!(Math.abs(a - b) <= eps)) throw new Error(`Assertion failed: ${msg} (got ${a}, expected ${b} ±${eps})`); }

module.exports = { ROOT, OUT, GAME_URL, launch, openGame, screenshot, loadWorkerInNode, assert, near };
