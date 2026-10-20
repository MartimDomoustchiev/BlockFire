/* ============================================================
 * Main menu / pause menu, settings and the debug panel.
 *
 * The same overlay serves as the main menu (pick a mode, its options
 * and a seed, then START) and as the pause menu (RESUME / QUIT TO
 * MENU). Settings persist in localStorage.
 * ============================================================ */
const SETTINGS_KEY = 'blockfire.settings.v2';

function loadSettings() {
  const s = {
    seed: '', renderDistance: CONFIG.RENDER_DISTANCE.DEFAULT, dynamicRd: true,
    fov: CONFIG.FOV, sensitivity: CONFIG.SENSITIVITY, padSensitivity: 1, volume: 0.7,
    mode: 'battle', bots: 5, duelBots: 2, difficulty: 'normal', duelRespawn: 0, playerName: '', lastRoom: '', startFullscreen: false,
    thirdPersonStory: true, thirdPerson: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(s)) if (saved[k] !== undefined && typeof saved[k] === typeof s[k]) s[k] = saved[k];
  } catch (e) { /* storage unavailable: defaults */ }
  return s;
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

class Menu {
  constructor(settings, onChange) {
    const $ = (id) => document.getElementById(id);
    this.el = {
      overlay: $('overlay'), loading: $('loading'), loadingText: $('loadingText'), debug: $('debug'),
      seed: $('seed'), play: $('btnPlay'), resume: $('btnResume'), quit: $('btnQuit'), err: $('err'), sub: $('menuSub'),
    };
    this.settings = settings;
    this.onChange = onChange;
    this.debugVisible = false;
    this.el.debug.style.display = 'none';
    this.el.seed.value = settings.seed;
    this.paused = false;

    // tabs
    for (const t of document.querySelectorAll('.tabs .tab')) {
      t.addEventListener('click', () => {
        for (const o of document.querySelectorAll('.tabs .tab')) o.classList.toggle('sel', o === t);
        for (const sec of document.querySelectorAll('#overlay section')) sec.hidden = sec.dataset.tab !== t.dataset.tab;
      });
    }
    // modes
    this.modeEls = Array.from(document.querySelectorAll('.mode'));
    for (const m of this.modeEls) m.addEventListener('click', () => { settings.mode = m.dataset.mode; saveSettings(settings); this._syncMode(); });
    this._syncMode();

    const bind = (id, key, fmt, parse = parseFloat) => {
      const input = $(id), out = $(id + 'Val');
      input.value = settings[key];
      if (out) out.textContent = fmt(settings[key]);
      input.addEventListener('input', () => {
        settings[key] = parse(input.value);
        if (out) out.textContent = fmt(settings[key]);
        saveSettings(settings);
        onChange(key);
      });
    };
    bind('rd', 'renderDistance', (v) => v + ' ch');
    bind('fov', 'fov', (v) => v + '°');
    bind('sens', 'sensitivity', (v) => v.toFixed(1) + 'x');
    bind('padSens', 'padSensitivity', (v) => v.toFixed(1) + 'x');
    bind('volume', 'volume', (v) => Math.round(v * 100) + '%');
    bind('bots', 'bots', (v) => v, (v) => parseInt(v, 10));
    bind('duelBots', 'duelBots', (v) => v, (v) => parseInt(v, 10));
    bind('difficulty', 'difficulty', (v) => v, (v) => v);
    bind('duelRespawn', 'duelRespawn', (v) => v, (v) => parseInt(v, 10));
    const dyn = $('dynamicRd');
    dyn.checked = settings.dynamicRd;
    dyn.addEventListener('change', () => { settings.dynamicRd = dyn.checked; saveSettings(settings); onChange('dynamicRd'); });
    const fsc = $('startFullscreen');
    fsc.checked = settings.startFullscreen;
    fsc.addEventListener('change', () => { settings.startFullscreen = fsc.checked; saveSettings(settings); });
    const tps = $('thirdPersonStory');
    tps.checked = settings.thirdPersonStory;
    tps.addEventListener('change', () => { settings.thirdPersonStory = tps.checked; saveSettings(settings); });
    this.el.thirdPersonStory = tps;
    this.el.seed.addEventListener('change', () => { settings.seed = this.el.seed.value; saveSettings(settings); });
    // online tab
    this.el.name = $('playerName'); this.el.room = $('roomCode'); this.el.netStatus = $('netStatus');
    this.el.name.value = settings.playerName;
    this.el.room.value = settings.lastRoom;
    this.el.name.addEventListener('change', () => { settings.playerName = this.el.name.value.trim().slice(0, 16); saveSettings(settings); });
    this.el.room.addEventListener('input', () => { this.el.room.value = normalizeRoomCode(this.el.room.value); });
    $('btnHost').addEventListener('click', () => { settings.playerName = this.el.name.value.trim(); saveSettings(settings); if (this.onHost) this.onHost(); });
    $('btnJoin').addEventListener('click', () => {
      settings.playerName = this.el.name.value.trim(); settings.lastRoom = normalizeRoomCode(this.el.room.value); saveSettings(settings);
      if (this.onJoin) this.onJoin(settings.lastRoom);
    });
  }

  /** Story option: continue the saved story (shows its chapter) or start over. */
  syncStorySave() {
    const sel = document.getElementById('storyNew');
    if (!sel) return;
    let txt = 'No saved story yet';
    try {
      const d = JSON.parse(localStorage.getItem('blockfire.story.v1') || 'null');
      if (d) txt = d.finished ? 'Continue (story complete, free roam)' : 'Continue (Chapter ' + ['I', 'II', 'III', 'IV', 'V', 'V'][d.chapter | 0] + ')';
    } catch (e) { /* */ }
    sel.options[0].textContent = txt;
  }

  _syncMode() {
    this.syncStorySave();
    const mode = this.settings.mode;
    for (const m of this.modeEls) m.classList.toggle('sel', m.dataset.mode === mode);
    for (const o of document.querySelectorAll('#overlay .opt')) {
      o.style.display = o.classList.contains('opt-' + mode) ? '' : 'none';
    }
  }

  /** main: no game running; pause: a game is running underneath. */
  showOverlay(visible, paused) {
    this.el.overlay.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.paused = paused;
    this.el.play.textContent = paused ? 'NEW GAME' : 'START';
    this.el.resume.hidden = !paused;
    this.el.quit.hidden = !paused;
    this.el.sub.textContent = paused ? 'PAUSED' : 'an offline voxel battle sandbox';
  }

  showLoading(visible, text, progress) {
    this.el.loading.style.display = visible ? 'flex' : 'none';
    if (text) this.el.loadingText.textContent = text;
    const bar = document.getElementById('loadingBar');
    if (bar) bar.style.width = Math.round(100 * Math.max(0, Math.min(1, progress ?? 0))) + '%';
  }

  toggleDebug() { this.debugVisible = !this.debugVisible; this.el.debug.style.display = this.debugVisible ? '' : 'none'; }
  setDebugText(t) { if (this.debugVisible) this.el.debug.textContent = t; }

  netStatus(text) { this.el.netStatus.textContent = text || ''; }

  showError(msg) {
    this.el.err.style.display = msg ? 'block' : 'none';
    this.el.err.textContent = msg || '';
  }
}
