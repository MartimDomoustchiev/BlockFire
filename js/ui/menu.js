/* ============================================================
 * The start screen (lobby) and the pause menu, settings and the
 * debug panel.
 *
 * The lobby is the first thing you see: your character on a stage
 * (ui/lobby-stage.js), your look (name, skin, hair, clothes, hood,
 * cloak), then a mode card to pick and START. The same overlay is the
 * pause menu while a game runs (RESUME / NEW GAME / QUIT TO LOBBY).
 * Settings, including your look, persist in localStorage.
 * ============================================================ */
const SETTINGS_KEY = 'blockfire.settings.v2';

/** Mode cards: title, one-line text, the START label, a tip line, and an icon (24x24 strokes). */
const MODE_CARDS = {
  battle: {
    title: 'SOLO VS BOTS', text: 'Drop onto the island with bots. Last one standing wins.', start: 'DROP IN',
    tip: 'The storm closes in every few minutes. Loot chests, build cover, keep moving.',
    icon: '<circle cx="12" cy="12" r="8"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  },
  duel: {
    title: 'SPLIT-SCREEN DUEL', text: 'Two players, one screen: keyboard and mouse, plus a gamepad.', start: 'START DUEL',
    tip: 'Player 2 connects a gamepad and presses any button.',
    icon: '<rect x="2.5" y="5" width="8.5" height="14" rx="1.5"/><rect x="13" y="5" width="8.5" height="14" rx="1.5"/>',
  },
  build: {
    title: 'FREE BUILD', text: 'No enemies, no storm. Endless blocks, and you can fly.', start: 'START BUILDING',
    tip: 'Q opens build mode: Z wall, X floor, C ramp, V roof.',
    icon: '<path d="M12 2.8l8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z"/><path d="M3.8 7.4L12 12l8.2-4.6M12 12v9.2"/>',
  },
  sandbox: {
    title: 'EXPLORE', text: 'An endless world to mine, craft, smelt, loot and drive.', start: 'EXPLORE',
    tip: 'Press F to fly and N to skip three hours.',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
  },
  story: {
    title: 'STORY', text: 'A stealth campaign on Kestrel Isle: climb, hide, and strike from the shadows.', start: 'BEGIN STORY',
    tip: 'Climb with W + SPACE, sneak with C, hide in hay. Press M for the map and E to synchronize.',
    icon: '<path d="M2 12s3.6-6.2 10-6.2S22 12 22 12s-3.6 6.2-10 6.2S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/>',
  },
};

/** The look editor: which field of PLAYER_LOOK each row changes, and how it is shown. */
const LOOK_ROWS = [
  { key: 'skin', label: 'Skin', kind: 'swatch', values: PLAYER_LOOK.SKINS, title: (v) => 'skin tone ' + (v + 1) },
  { key: 'style', label: 'Hair', kind: 'chip', values: PLAYER_LOOK.STYLES, text: (v) => v },
  { key: 'hair', label: 'Hair colour', kind: 'swatch', values: PLAYER_LOOK.HAIR.map((h) => h.color), title: (v) => PLAYER_LOOK.HAIR[v].name },
  { key: 'top', label: 'Top', kind: 'swatch', values: PLAYER_LOOK.TOPS, title: (v) => 'top colour ' + (v + 1) },
  { key: 'bottom', label: 'Trousers', kind: 'swatch', values: PLAYER_LOOK.BOTTOMS, title: (v) => 'trousers ' + (v + 1) },
  { key: 'accent', label: 'Trim', kind: 'swatch', values: PLAYER_LOOK.ACCENTS, title: (v) => 'trim colour ' + (v + 1) },
  { key: 'facial', label: 'Face', kind: 'chip', values: PLAYER_LOOK.FACIAL, text: (v) => v },
];

const hexOf = (c) => '#' + c.toString(16).padStart(6, '0');

function loadSettings() {
  const s = {
    seed: '', renderDistance: CONFIG.RENDER_DISTANCE.DEFAULT, dynamicRd: true,
    fov: CONFIG.FOV, sensitivity: CONFIG.SENSITIVITY, padSensitivity: 1, volume: 0.7,
    mode: 'battle', bots: 5, duelBots: 2, difficulty: 'normal', duelRespawn: 0, playerName: '', lastRoom: '', startFullscreen: false,
    thirdPersonStory: true, thirdPerson: false, look: PLAYER_LOOK.DEFAULT, touchLook: 1, quality: 'auto', qualityV: 2, autoResolution: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(s)) if (saved[k] !== undefined && typeof saved[k] === typeof s[k]) s[k] = saved[k];
    // settings saved before 'auto' and Ultra existed: start from 'auto' once, so a desktop graphics card gets Ultra
    if (saved.qualityV !== 2) s.quality = 'auto';
  } catch (e) { /* storage unavailable: defaults */ }
  s.look = PLAYER_LOOK.normalize(s.look);
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
      hint: $('modeHint'), lookGrid: $('lookGrid'), lookDesc: $('lookDesc'), stage: $('stageSlot'),
    };
    this.settings = settings;
    this.onChange = onChange;
    this.debugVisible = false;
    this.el.debug.style.display = 'none';
    this.el.seed.value = settings.seed;
    this.paused = false;
    this.lookChanged = null;          // main.js: the look changed (updates the stage)

    // tabs: only the sections that carry a data-tab switch (the character card stays)
    for (const t of document.querySelectorAll('.tabs .tab')) {
      t.addEventListener('click', () => {
        for (const o of document.querySelectorAll('.tabs .tab')) o.classList.toggle('sel', o === t);
        for (const sec of document.querySelectorAll('#overlay section[data-tab]')) sec.hidden = sec.dataset.tab !== t.dataset.tab;
      });
    }
    this._buildModes();
    this._buildLook();

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
    bind('touchLook', 'touchLook', (v) => v.toFixed(1) + 'x');
    bind('volume', 'volume', (v) => Math.round(v * 100) + '%');
    bind('bots', 'bots', (v) => v, (v) => parseInt(v, 10));
    bind('duelBots', 'duelBots', (v) => v, (v) => parseInt(v, 10));
    bind('difficulty', 'difficulty', (v) => v, (v) => v);
    bind('duelRespawn', 'duelRespawn', (v) => v, (v) => parseInt(v, 10));
    const q = $('quality');
    q.value = settings.quality;
    q.addEventListener('change', () => { settings.quality = q.value; saveSettings(settings); onChange('quality'); });
    const ar = $('autoResolution');
    ar.checked = settings.autoResolution;
    ar.addEventListener('change', () => { settings.autoResolution = ar.checked; saveSettings(settings); onChange('autoResolution'); });
    const dyn = $('dynamicRd');
    dyn.checked = settings.dynamicRd;
    dyn.addEventListener('change', () => { settings.dynamicRd = dyn.checked; saveSettings(settings); onChange('dynamicRd'); });
    const fsc = $('startFullscreen');
    fsc.checked = settings.startFullscreen;
    fsc.addEventListener('change', () => { settings.startFullscreen = fsc.checked; saveSettings(settings); });
    if (window.__phoneApp) fsc.closest('label').hidden = true;     // the phone apps are full screen already
    const tps = $('thirdPersonStory');
    tps.checked = settings.thirdPersonStory;
    tps.addEventListener('change', () => { settings.thirdPersonStory = tps.checked; saveSettings(settings); });
    this.el.thirdPersonStory = tps;
    this.el.seed.addEventListener('change', () => { settings.seed = this.el.seed.value; saveSettings(settings); });
    // character name (shared with the online tab)
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
    this._storyLabel();
    this._syncMode();
    this._syncLook();
  }

  // ------------------------------------------------------------ mode cards
  _buildModes() {
    const box = this.el.modeBox = document.getElementById('modeCards');
    box.innerHTML = '';
    this.modeEls = [];
    for (const id of Object.keys(MODE_CARDS)) {
      const c = MODE_CARDS[id];
      const b = document.createElement('button');
      b.className = 'mode' + (id === 'story' ? ' story' : '');
      b.dataset.mode = id;
      b.innerHTML = '<i class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + c.icon + '</svg></i>' +
        '<span class="mtxt"><b>' + c.title + '</b><span>' + c.text + '</span></span>';
      b.addEventListener('click', () => { this.settings.mode = id; saveSettings(this.settings); this._syncMode(); });
      box.appendChild(b);
      this.modeEls.push(b);
    }
  }

  /** The character card: name is above; swatches and chips for each look field, then hood and cloak. */
  _buildLook() {
    const grid = this.el.lookGrid;
    grid.innerHTML = '';
    this.lookEls = {};
    for (const row of LOOK_ROWS) {
      const r = document.createElement('div');
      r.className = 'lookRow';
      r.innerHTML = '<span>' + row.label + '</span>';
      const box = document.createElement('div');
      box.className = row.kind === 'swatch' ? 'swatches' : 'chips';
      row.values.forEach((v, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        if (row.kind === 'swatch') { b.className = 'swatch'; b.style.background = hexOf(v); b.title = row.title(i); }
        else { b.className = 'chip'; b.textContent = row.text(v); }
        b.addEventListener('click', () => this._setLook(row.key, i));
        box.appendChild(b);
        (this.lookEls[row.key] || (this.lookEls[row.key] = [])).push(b);
      });
      r.appendChild(box);
      grid.appendChild(r);
    }
    const tog = document.createElement('div');
    tog.className = 'lookToggles';
    tog.innerHTML = '<label><input type="checkbox" id="lookHood"> Hood</label><label><input type="checkbox" id="lookCloak"> Cloak</label>';
    grid.appendChild(tog);
    this.lookEls.hood = document.getElementById('lookHood');
    this.lookEls.cloak = document.getElementById('lookCloak');
    this.lookEls.hood.addEventListener('change', () => this._setLook('hood', this.lookEls.hood.checked));
    this.lookEls.cloak.addEventListener('change', () => this._setLook('cloak', this.lookEls.cloak.checked));
    document.getElementById('btnRandomLook').addEventListener('click', () => {
      this.settings.look = PLAYER_LOOK.random(); saveSettings(this.settings); this._syncLook(); this._lookChanged();
    });
  }

  _setLook(key, value) {
    this.settings.look = PLAYER_LOOK.normalize(Object.assign({}, this.settings.look, { [key]: value }));
    saveSettings(this.settings);
    this._syncLook();
    this._lookChanged();
  }

  _lookChanged() { if (this.lookChanged) this.lookChanged(this.settings.look); }

  _syncLook() {
    const L = this.settings.look;
    for (const row of LOOK_ROWS) this.lookEls[row.key].forEach((b, i) => b.classList.toggle('sel', i === L[row.key]));
    this.lookEls.hood.checked = L.hood;
    this.lookEls.cloak.checked = L.cloak;
    this.el.lookDesc.textContent = PLAYER_LOOK.describe(L);
  }

  // ------------------------------------------------------------ story save / modes
  /** Story option: continue the saved story (shows its chapter) or start over. */
  syncStorySave() {
    this._storyLabel();
    this._syncMode();
  }

  /** The story's labels follow the save: "Continue (Chapter II)" and "CONTINUE STORY" when there is one. */
  _storyLabel() {
    const sel = document.getElementById('storyNew');
    let txt = 'No saved story yet', saved = false;
    try {
      const d = JSON.parse(localStorage.getItem('blockfire.story.v1') || 'null');
      if (d) {
        saved = true;
        const ci = Story.chapterOfSave(d);
        txt = d.finished || ci >= STORY_CHAPTERS.length ? 'Continue (story complete, free roam)' : 'Continue (Chapter ' + ROMAN[ci] + ' of ' + ROMAN[STORY_CHAPTERS.length - 1] + ')';
      }
    } catch (e) { /* */ }
    if (sel) sel.options[0].textContent = txt;
    MODE_CARDS.story.start = saved ? 'CONTINUE STORY' : 'BEGIN STORY';
  }

  _syncMode() {
    const mode = this.settings.mode;
    if (mode === 'story') this._storyLabel();
    for (const m of this.modeEls) m.classList.toggle('sel', m.dataset.mode === mode);
    for (const o of document.querySelectorAll('#overlay .opt')) {
      o.style.display = o.classList.contains('opt-' + mode) ? '' : 'none';
    }
    if (this.el.hint) this.el.hint.textContent = (MODE_CARDS[mode] || {}).tip || '';
    if (!this.paused) this.el.play.textContent = (MODE_CARDS[mode] || {}).start || 'START';
  }

  /** Lobby (no game running) or pause (a game runs underneath). */
  showOverlay(visible, paused) {
    this.el.overlay.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (paused === this.paused && this._shownOnce) return;
    this._shownOnce = true;
    this.paused = paused;
    this.el.overlay.classList.toggle('paused', paused);
    this.el.play.textContent = paused ? 'NEW GAME' : (MODE_CARDS[this.settings.mode] || {}).start || 'START';
    this.el.resume.hidden = !paused;
    this.el.quit.hidden = !paused;
    this.el.sub.textContent = paused ? 'PAUSED' : 'build, climb, shoot. pick your look, then pick a mode.';
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
