/* ============================================================
 * App shell: full screen, and everything that makes BLOCKFIRE
 * feel like an app rather than a web page.
 *
 *  - Full screen: the menu button / Alt (Option) + Enter. In the
 *    Mac app (mac/BlockfireApp.swift) it asks the app for native
 *    full screen; in a browser it uses the Fullscreen API.
 *  - In the Mac app: a QUIT button, no key beeps, no page context
 *    menu, no text selection.
 *  - Served over http(s) (e.g. GitHub Pages): an installable web
 *    app - manifest, offline cache (sw.js), and an INSTALL button
 *    where the browser supports it. Not on file://, where browsers
 *    don't allow any of that.
 * ============================================================ */
const AppShell = {
  native: !!(window.__nativeApp),
  installPrompt: null,
  listeners: [],

  init() {
    const $ = (id) => document.getElementById(id);
    document.body.classList.toggle('app', this.native);
    const fsBtn = $('btnFullscreen'), quitBtn = $('btnQuitApp'), instBtn = $('btnInstall');
    if (fsBtn) fsBtn.addEventListener('click', () => this.toggleFullscreen());
    if (quitBtn) { quitBtn.hidden = !this.native; quitBtn.addEventListener('click', () => this.quit()); }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && e.altKey) { e.preventDefault(); this.toggleFullscreen(); }
    });
    for (const n of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(n, () => this._changed());
    // the Mac app reports native full screen changes here
    window.__appFullscreen = (on) => { this.nativeFs = !!on; this._changed(); };

    if (this.native) {
      // every key belongs to the game: an unhandled key makes macOS beep
      window.addEventListener('keydown', (e) => {
        const t = e.target && e.target.tagName;
        if (e.metaKey || t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
        e.preventDefault();
      });
      document.addEventListener('contextmenu', (e) => {
        const t = e.target && e.target.tagName;
        if (t !== 'INPUT' && t !== 'TEXTAREA') e.preventDefault();
      });
    } else if (/^https?:$/.test(location.protocol)) {
      this._webApp(instBtn);
    }
    this._changed();
  },

  isFullscreen() {
    if (this.native) return !!this.nativeFs;
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  toggleFullscreen(want) {
    const on = want === undefined ? !this.isFullscreen() : want;
    if (on === this.isFullscreen()) return;
    if (this.native) { this._post({ type: 'fullscreen' }); return; }
    const el = document.documentElement;
    try {
      if (on) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        const p = req && req.call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => {});
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const p = exit && exit.call(document);
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* not allowed here (no user gesture / unsupported) */ }
  },

  quit() { if (this.native) this._post({ type: 'quit' }); },

  onChange(fn) { this.listeners.push(fn); },

  _changed() {
    const on = this.isFullscreen(), b = document.getElementById('btnFullscreen');
    if (b) b.textContent = on ? 'EXIT FULL SCREEN' : 'FULL SCREEN';
    for (const fn of this.listeners) fn(on);
  },

  _post(msg) {
    try { window.webkit.messageHandlers.native.postMessage(msg); } catch (e) { /* not in the app */ }
  },

  /** Installable web app: manifest + offline cache + install button (Chrome / Edge). */
  _webApp(instBtn) {
    const link = document.createElement('link');
    link.rel = 'manifest'; link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
      if (instBtn) instBtn.hidden = false;
    });
    if (instBtn) instBtn.addEventListener('click', async () => {
      if (!this.installPrompt) return;
      this.installPrompt.prompt();
      try { await this.installPrompt.userChoice; } catch (e) { /* */ }
      this.installPrompt = null;
      instBtn.hidden = true;
    });
    window.addEventListener('appinstalled', () => { if (instBtn) instBtn.hidden = true; });
  },
};
