/* The app shell: full screen, and the installable web app (manifest + offline cache over http). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness.js');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

/** A tiny static file server for the game folder (like hosting it on a website). */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

exports.tests = {
  'full screen: the menu button and Alt+Enter switch full screen on and off; the option starts games in full screen': async (ctx) => {
    const { page } = await ctx.open('', { waitReady: false });
    await page.waitForSelector('#btnFullscreen');
    await page.click('#btnFullscreen');
    await page.waitForFunction(() => !!document.fullscreenElement && document.getElementById('btnFullscreen').textContent === 'EXIT FULL SCREEN', null, { timeout: 5000 });
    await page.keyboard.press('Alt+Enter');
    await page.waitForFunction(() => !document.fullscreenElement && document.getElementById('btnFullscreen').textContent === 'FULL SCREEN', null, { timeout: 5000 });
    ctx.assert(await page.evaluate(() => document.getElementById('btnQuitApp').hidden && !document.body.classList.contains('app')), 'no app-only QUIT in a browser');
    // the option: starting a game goes full screen
    await page.click('.tab[data-tab="settings"]');
    await page.check('#startFullscreen');
    await page.click('.tab[data-tab="play"]');
    await page.click('.mode[data-mode="build"]');
    await page.click('#btnPlay');
    await page.waitForFunction(() => !!document.fullscreenElement && window.__game, null, { timeout: 15000 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('blockfire.settings.v2')).startFullscreen);
    ctx.assert(saved === true, 'option saved');
  },

  'installable web app: served over http the manifest and offline cache load, and the game still starts offline': async (ctx) => {
    const server = await serve();
    const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
    try {
      const { page } = await ctx.open('', { waitReady: false });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('link[rel=manifest]') && navigator.serviceWorker && navigator.serviceWorker.ready, null, { timeout: 15000 });
      const manifest = await page.evaluate(async () => {
        const m = await (await fetch('manifest.webmanifest')).json();
        const icons = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).status));
        return { name: m.name, display: m.display, icons };
      });
      ctx.assert(manifest.name === 'BLOCKFIRE' && manifest.display === 'fullscreen' && manifest.icons.every((s) => s === 200), 'manifest + icons: ' + JSON.stringify(manifest));
      await page.evaluate(() => navigator.serviceWorker.ready);
      // the second load runs under the service worker, which keeps every file it serves
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
      await page.waitForFunction(() => typeof Game === 'function', null, { timeout: 15000 });
      await page.waitForTimeout(500);
      // no network at all - the website is gone and the computer is offline: the game still starts, from the cache
      await new Promise((r) => server.close(r));
      await page.context().setOffline(true);
      await page.goto(url + '?autostart=1&mode=sandbox&rd=3');
      await page.waitForFunction(() => window.__game && document.getElementById('loading').style.display === 'none', null, { timeout: 60000 });
      const offline = await page.evaluate(() => ({ mode: __game.mode, chunks: __game.world.chunks.size }));
      ctx.assert(offline.mode === 'sandbox' && offline.chunks > 10, 'game started offline: ' + JSON.stringify(offline));
      await page.context().setOffline(false);
    } finally {
      if (server.listening) server.close();
    }
  },
};
