/* ============================================================
 * Story screens: the island map (M), a notice board's contracts and
 * Ida's shop. They free the mouse like the inventory does. Choices go
 * through `act(action)`, which runs them on the Story directly or
 * sends them to the host when playing online:
 *   { a: 'travel', vp }  { a: 'accept', site, i }  { a: 'abandon' }  { a: 'buy', id }
 * ============================================================ */
class StoryScreens {
  constructor({ input, getGame, getMap, act }) {
    this.input = input;
    this.getGame = getGame;
    this.getMap = getMap;                    // () => { img, R } the painted island
    this.act = act;
    this.root = document.createElement('div');
    this.root.id = 'storyScreen';
    this.root.className = 'hidden';
    document.body.appendChild(this.root);
    this.isOpen = false;
    this.kind = null;
    this.data = null;
    this.fog = null; this.fogN = -1;
    this.gear = null;                        // the Order's gear screen (ui/gear-screen.js), built when first used
    // every story screen has a CLOSE button (touch screens have no Escape key)
    this.openedAt = 0;
    this.root.addEventListener('click', (e) => {
      // a tap that opened a screen also makes a click where the finger lifts: that one must not close it again
      if (performance.now() - this.openedAt < 350) return;
      if (e.target && e.target.classList && e.target.classList.contains('sClose')) this.close(true);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Escape' || e.code === 'KeyE' || (e.code === 'KeyM' && this.kind === 'map') || (e.code === 'KeyJ' && this.kind === 'journal') || e.code === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();          // the key that closes a screen must not open one again
        this.close(e.code !== 'Escape');
      }
    });
  }

  open(kind, data) {
    const g = this.getGame();
    if (!g || !g.story) return;
    this.kind = kind; this.data = data || {};
    this.isOpen = true;
    this.openedAt = performance.now();
    if (g.player && g.player.controller) { g.player.controller.enabled = false; if (g.player.controller.flush) g.player.controller.flush(); }
    this.input.unlock();
    this.root.className = '';
    this.render();
  }

  close(relock) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.className = 'hidden';
    this.root.innerHTML = '';
    this.input.takeFrame();
    const g = this.getGame();
    if (g && g.player && g.player.controller) { g.player.controller.enabled = true; if (g.player.controller.flush) g.player.controller.flush(); }
    if (relock) this.input.lock();
  }

  /** Per frame while open: the map animates (players move), the shop follows the purse. */
  update() {
    if (!this.isOpen) return;
    const g = this.getGame();
    if (!g || !g.story || !g.player || !g.player.alive) { this.close(false); return; }
    if (this.kind === 'map') this.drawMap();
    else if (this.kind === 'shop' && this.shownSilver !== g.story.silver) this.render();
    else if (this.kind === 'gear') this.gear.refresh(g.player, g.story, false);
  }

  render() {
    const g = this.getGame(), st = g.story;
    const K = this.kind;
    if (K === 'map') {
      this.root.innerHTML = '<div class="panel storyMap"><button class="sClose alt">CLOSE</button><h2>KESTREL ISLE</h2><canvas width="640" height="640"></canvas>' +
        '<p class="hint">Gold eyes are synchronized viewpoints: click one to travel there. Brown boxes are supplies (arrows, smoke, rounds): the chest in the hideout and the enemy arms crates. <kbd>M</kbd> close</p></div>';
      this.canvas = this.root.querySelector('canvas');
      this.canvas.addEventListener('mousedown', (e) => this.mapClick(e));
      this.drawMap();
    } else if (K === 'board') {
      const offers = this.data.offers || [];
      const busy = this.data.busy;
      let html = '<div class="panel storyBoard"><button class="sClose alt">CLOSE</button><h2>NOTICE BOARD</h2>';
      if (busy) html += '<p class="hint">You are on a job: ' + esc(busy) + '</p>';
      offers.forEach((o, i) => {
        html += '<div class="offer"><div><b>' + esc(o.title) + '</b><span>' + esc(o.desc) + '</span></div>' +
          '<button data-i="' + i + '"' + (busy ? ' disabled' : '') + '>' + o.reward + ' silver</button></div>';
      });
      if (this.data.contract) html += '<button class="alt abandon">ABANDON CURRENT CONTRACT</button>';
      html += '<p class="hint"><kbd>E</kbd> close</p></div>';
      this.root.innerHTML = html;
      this.root.querySelectorAll('.offer button').forEach((b) => b.addEventListener('click', () => { this.act({ a: 'accept', site: this.data.site, i: +b.dataset.i }); this.close(true); }));
      const ab = this.root.querySelector('.abandon');
      if (ab) ab.addEventListener('click', () => { this.act({ a: 'abandon' }); this.close(true); });
    } else if (K === 'journal') {
      this.root.innerHTML = this.journalHTML(st);
    } else if (K === 'gear') {
      if (!this.gear) this.gear = new GearView(this.root, (op, i, j) => this.act({ a: 'gear', g: op, i, j }));
      this.gear.open(g.player, st);
    } else if (K === 'shop') {
      this.shownSilver = st.silver;
      let html = '<div class="panel storyShop"><button class="sClose alt">CLOSE</button><h2>IDA\'S FORGE</h2><p class="hint">The Order\'s purse: <b>' + st.silver + ' silver</b></p>';
      for (const it of CONFIG.STORY.SHOP) {
        html += '<div class="offer"><div><b>' + esc(it.name) + '</b></div><button data-id="' + it.id + '"' + (st.silver < it.price ? ' disabled' : '') + '>' + it.price + ' silver</button></div>';
      }
      html += '<p class="hint"><kbd>E</kbd> close</p></div>';
      this.root.innerHTML = html;
      this.root.querySelectorAll('.offer button').forEach((b) => b.addEventListener('click', () => { this.act({ a: 'buy', id: b.dataset.id }); setTimeout(() => this.isOpen && this.render(), 150); }));
    }
  }

  // ---------------------------------------------------------------- the journal
  /** Chapters, challenges, letters and the Order's tally: what the campaign has left to do. */
  journalHTML(st) {
    const done = (c) => c ? ' class="done"' : '';
    const chapters = STORY_CHAPTERS.map((c, i) => {
      const mark = i < st.chapter ? '&#10003;' : i === st.chapter && !st.finished ? '&#9654;' : '&middot;';
      return '<li' + done(i < st.chapter) + '><i>' + mark + '</i> <b>' + ROMAN[i] + '. ' + esc(c.title) + '</b></li>';
    }).join('');
    const challenges = STORY_CHALLENGES.map((c) => {
      const ok = st.challengesDone.has(c.id), r = c.reward;
      const pays = (r.silver ? r.silver + ' silver' : '') + (r.gear ? (r.silver ? ', ' : '') + r.gear.map((id) => CONFIG.STORY.GEAR.PIECES[id].name).join(', ') : '');
      return '<li' + done(ok) + '><i>' + (ok ? '&#10003;' : '&middot;') + '</i> <b>' + esc(c.title) + '</b><span>' + esc(c.text) + (pays ? ' <em>' + esc(pays) + '</em>' : '') + '</span></li>';
    }).join('');
    const letters = ORDER_LETTERS.map((L, i) => '<li' + done(st.letters.has(i)) + '>' + (st.letters.has(i) ? esc(L.text) : '<span class="unread">An unread letter. It lies somewhere on the island.</span>') + '</li>').join('');
    const tally = 'silver ' + st.silver + '  &middot;  kills ' + (st.stats.kills | 0) + '  &middot;  silent ' + (st.stats.silent | 0) + '  &middot;  letters ' + st.letters.size + '/' + ORDER_LETTERS.length +
      '  &middot;  challenges ' + st.challengesDone.size + '/' + STORY_CHALLENGES.length + '  &middot;  contracts ' + (st.stats.contracts | 0);
    return '<div class="panel journal"><button class="sClose alt">CLOSE</button><h2>THE ORDER\'S JOURNAL</h2><p class="hint tally">' + tally + '</p>' +
      '<div class="jCols"><div><h3>CHAPTERS</h3><ul class="jList">' + chapters + '</ul></div>' +
      '<div><h3>CHALLENGES</h3><ul class="jList">' + challenges + '</ul></div>' +
      '<div><h3>LETTERS</h3><ul class="jList">' + letters + '</ul></div></div>' +
      '<p class="hint"><kbd>J</kbd> close</p></div>';
  }

  // ---------------------------------------------------------------- the map
  toMap(x, z) {
    const m = this.getMap(), W = this.canvas.width;
    return [(x + m.R) / (2 * m.R) * W, (z + m.R) / (2 * m.R) * W];
  }

  fogCanvas(st) {
    const m = this.getMap();
    if (this.fog && this.fogN === st.explored.length) return this.fog;
    const c = this.fog || document.createElement('canvas');
    c.width = c.height = 320;
    const g = c.getContext('2d'), k = c.width / (2 * m.R);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(8,11,16,0.86)';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-out';
    for (const [x, z, r] of st.explored) {
      const grd = g.createRadialGradient((x + m.R) * k, (z + m.R) * k, r * k * 0.6, (x + m.R) * k, (z + m.R) * k, r * k);
      grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc((x + m.R) * k, (z + m.R) * k, r * k, 0, Math.PI * 2); g.fill();
    }
    this.fog = c; this.fogN = st.explored.length;
    return c;
  }

  drawMap() {
    const g = this.getGame(), st = g.story, m = this.getMap(), c = this.canvas;
    if (!c || !m || !m.img) return;
    const ctx = c.getContext('2d'), W = c.width;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#183457'; ctx.fillRect(0, 0, W, W);
    ctx.drawImage(m.img, 0, 0, W, W);
    ctx.drawImage(this.fogCanvas(st), 0, 0, W, W);
    ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
    for (const s of st.plan.sites) {
      const [x, y] = this.toMap(s.x, s.z);
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillText(s.name, x + 1, y + 23);
      ctx.fillStyle = s.kind === 'camp' || s.kind === 'keep' ? '#ff9a8a' : s.kind === 'hideout' ? '#9fe0ff' : '#fff2c8';
      ctx.fillText(s.name, x, y + 22);
    }
    for (const s of st.plan.sites) {
      const a = s.poi.armory;
      if (!a) continue;
      const [x, y] = this.toMap(a.x, a.z);
      ctx.fillStyle = '#6b4a2a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.fillRect(x - 6, y - 5, 12, 10); ctx.strokeRect(x - 6, y - 5, 12, 10);
      ctx.fillStyle = '#c8ccd4'; ctx.fillRect(x - 1, y - 4, 2, 8);
    }
    for (const vp of st.plan.viewpoints) {
      const [x, y] = this.toMap(vp.top.x, vp.top.z), on = st.isSyncedId(vp.id);
      ctx.fillStyle = on ? '#ffd34a' : '#6b7480'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, 9, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    const o = st.objective();
    const mk = o && o.marker;
    if (mk) {
      const p = mk.type === 'character' ? mk.pos : mk, [x, y] = this.toMap(p.x, p.z);
      ctx.fillStyle = '#ff7a2f'; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (const h of g.characters()) {
      if (!h.alive || !(h.isHuman || h === g.player)) continue;
      const [x, y] = this.toMap(h.pos.x, h.pos.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-h.yaw);
      ctx.fillStyle = h === g.player ? '#ffffff' : '#7fd0ff';
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
  }

  mapClick(e) {
    const g = this.getGame(), st = g.story, r = this.canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * this.canvas.width, my = (e.clientY - r.top) / r.height * this.canvas.height;
    for (const vp of st.plan.viewpoints) {
      if (!st.isSyncedId(vp.id)) continue;
      const [x, y] = this.toMap(vp.top.x, vp.top.z);
      if (Math.hypot(mx - x, my - y) < 14) { this.act({ a: 'travel', vp: vp.id }); this.close(true); return; }
    }
  }
}
