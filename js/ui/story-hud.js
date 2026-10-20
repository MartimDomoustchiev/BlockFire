/* ============================================================
 * Story HUD (one per PlayerView): objective panel, world markers,
 * guard awareness meters, takedown reticle, the E prompt and action
 * progress, dialogue subtitles, guard barks, title cards, notoriety
 * and silver, and the hidden / blending indicator.
 *
 * Reads game.story through a small interface that both the host's
 * Story and an online client's StoryMirror provide:
 *   objective(), notoriety, silver, promptFor(ch), actionFor(ch),
 *   awarenessOf(guard, ch), hunting(guard, ch)
 * ============================================================ */
class StoryHud {
  constructor(hudRoot) {
    const div = (cls, parent) => { const d = document.createElement('div'); d.className = cls; (parent || hudRoot).appendChild(d); return d; };
    this.root = div('storyHud');
    this.obj = div('storyObj', this.root);
    this.markers = div('storyMarkers', this.root);
    this.meters = div('storyMeters', this.root);
    this.barks = div('storyBarks', this.root);
    this.sub = div('storySub', this.root);
    this.title = div('storyTitle', this.root);
    this.prompt = div('storyPrompt', this.root);
    this.progress = div('storyProgress', this.root);
    this.progress.innerHTML = '<span></span><div class="bar"><i></i></div>';
    this.stealth = div('storyStealth', this.root);
    this.toast = div('storyToast', this.root);
    this.vignette = div('storyVignette', this.root);
    this.reticle = div('storyReticle', this.root);
    this.marker = div('storyMarker', this.markers);
    this.marker.innerHTML = '<i></i><span></span>';
    this.supply = div('storyMarker supply', this.markers);
    this.supply.innerHTML = '<i></i><span></span>';
    this.meterEls = [];
    this.barkList = [];
    this.subUntil = 0; this.titleUntil = 0; this.toastUntil = 0;
    this._v = new THREE.Vector3();
    this.root.style.display = 'none';
  }

  attach(game, ch) {
    if (this.unsub) this.unsub();
    this.game = game; this.ch = ch;
    this.barks.innerHTML = ''; this.barkList = [];
    this.subUntil = this.titleUntil = this.toastUntil = 0;
    this.sub.style.display = this.title.style.display = this.toast.style.display = 'none';
    const on = (n, f) => game.events.on(n, f);
    const offs = [
      on('storyLine', (e) => {
        this.sub.innerHTML = '<b>' + esc(e.who) + '</b> ' + esc(e.text);
        this.sub.style.display = 'block';
        this.subUntil = performance.now() / 1000 + (e.dur || 4);
      }),
      on('storyTitle', (e) => this.showTitle(e.title, e.sub, e.long ? 8 : 3.5, '')),
      on('desync', (e) => this.showTitle('DESYNCHRONIZED', e.reason, 2.8, 'desync')),
      on('storyMessage', (e) => { if (!e.character || e.character === this.ch) this.showToast(e.text, e.kind); }),
      on('bark', (e) => { if (e.character) this.addBark(e.character, e.text); }),
      on('synced', (e) => { if (e.character === this.ch) this.flash(); }),
    ];
    this.unsub = () => offs.forEach((f) => f());
  }

  showTitle(title, sub, dur, cls) {
    this.title.className = 'storyTitle ' + (cls || '');
    this.title.innerHTML = '<h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '');
    this.title.style.display = 'block';
    this.titleUntil = performance.now() / 1000 + dur;
  }

  showToast(text, kind) {
    this.toast.textContent = text;
    this.toast.className = 'storyToast ' + (kind || '');
    this.toast.style.display = 'block';
    this.toastUntil = performance.now() / 1000 + 3.5;
  }

  flash() {
    this.vignette.classList.remove('sync'); void this.vignette.offsetWidth; this.vignette.classList.add('sync');
  }

  addBark(ch, text) {
    const el = document.createElement('div');
    el.className = 'bark';
    el.textContent = text;
    this.barks.appendChild(el);
    this.barkList.push({ ch, el, until: performance.now() / 1000 + 2.6 });
    while (this.barkList.length > 6) this.barkList.shift().el.remove();
  }

  setVisible(v) { this.root.style.display = v ? 'block' : 'none'; }

  /** Screen position of a world point: { x, y, on } (on = in front of the camera and inside the view). */
  project(p, camera, rect) {
    const v = this._v.set(p.x, p.y, p.z).project(camera);
    const behind = v.z > 1;
    let x = v.x, y = v.y;
    if (behind) { x = -x; y = -y; }
    const on = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    return { x: (x * 0.5 + 0.5) * rect.w, y: (-y * 0.5 + 0.5) * rect.h, on, nx: x, ny: y };
  }

  /** Clamp an off-screen point to the screen edge; returns the angle it points at. */
  /** Where to restock: { site, d, low } - the nearest stocked crate when low on arrows or smoke, else any crate within 25m. */
  supplyTarget(game, st, me) {
    if (!me.alive || !st.plan) return null;
    const A = CONFIG.STORY.ARMORY, inv = me.inventory;
    const low = (inv.count('w_bow') > 0 && inv.count('arrow') <= A.LOW_ARROWS) || (inv.count('w_smoke') > 0 && inv.count('smoke_bomb') === 0);
    let best = null;
    for (const site of st.plan.sites) {
      const a = site.poi.armory;
      if (!a) continue;
      const d = Math.hypot(a.x - me.pos.x, a.z - me.pos.z);
      if (!low && d > 25) continue;
      if (low && st.crateWait && st.crateWait(site, me) > 0) continue;
      if (!best || d < best.d) best = { site, d, low };
    }
    return best;
  }

  edge(s, rect, pad) {
    let x = s.nx, y = s.ny;
    const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
    if (!s.on) { x /= m; y /= m; }
    const px = Math.max(pad, Math.min(rect.w - pad, (x * 0.5 + 0.5) * rect.w));
    const py = Math.max(pad, Math.min(rect.h - pad, (-y * 0.5 + 0.5) * rect.h));
    return { x: px, y: py, ang: Math.atan2(-y, x) };
  }

  update(game, me, camera, rect, playing) {
    const st = game.story, now = performance.now() / 1000;
    this.setVisible(!!st && playing);
    if (!st || !playing) return;
    // ---- objective panel
    const o = st.objective();
    let mk = o && o.marker;
    if (mk && mk.type === 'character' && !mk.alive && !mk.corpse) mk = null;
    if (o) {
      const pos = mk ? (mk.type === 'character' ? mk.pos : mk) : null;
      const dist = pos ? Math.round(Math.hypot(pos.x - me.pos.x, pos.z - me.pos.z)) : null;
      const timer = o.timer !== null && o.timer !== undefined ? ' <em class="timer">' + Math.ceil(o.timer) + 's</em>' : '';
      // notoriety + silver sit in the panel's last row, so a long hint never runs into them
      let pips = '';
      for (let i = 0; i < 3; i++) { const f = Math.max(0, Math.min(1, st.notoriety - i)); pips += '<i style="--f:' + Math.round(f * 100) + '%"></i>'; }
      this.obj.innerHTML = '<div class="t">' + esc(o.title) + '</div><div class="x' + (o.failing ? ' fail' : '') + '">' + esc(o.text) + timer +
        (dist !== null ? ' <span class="d">' + dist + 'm</span>' : '') + '</div>' + (o.hint ? '<div class="h">' + esc(o.hint) + '</div>' : '') +
        '<div class="storyStatus"><span class="noto" title="Notoriety">' + pips + '</span><span class="silver">' + st.silver + ' <b>silver</b></span></div>';
    }
    // ---- objective marker
    if (mk) {
      const p = mk.type === 'character' ? { x: mk.pos.x, y: mk.pos.y + 2.4, z: mk.pos.z } : { x: mk.x, y: mk.y + 1.2, z: mk.z };
      const s = this.project(p, camera, rect), e = this.edge(s, rect, 26);
      this.marker.style.display = 'block';
      this.marker.style.left = e.x + 'px'; this.marker.style.top = e.y + 'px';
      this.marker.classList.toggle('off', !s.on);
      this.marker.lastChild.textContent = Math.round(Math.hypot(p.x - me.pos.x, p.z - me.pos.z)) + 'm';
    } else this.marker.style.display = 'none';
    // ---- supplies: low on arrows / smoke -> the nearest crate that has some; otherwise crates close by
    const sup = this.supplyTarget(game, st, me);
    if (sup) {
      const a = sup.site.poi.armory, s = this.project({ x: a.x, y: a.y + 1.4, z: a.z }, camera, rect), e = this.edge(s, rect, 24);
      this.supply.style.display = 'block';
      this.supply.style.left = e.x + 'px'; this.supply.style.top = e.y + 'px';
      this.supply.classList.toggle('off', !s.on);
      this.supply.classList.toggle('low', sup.low);
      this.supply.lastChild.textContent = (sup.low ? (sup.site.kind === 'hideout' ? 'Supply chest ' : 'Arms crate ') : '') + Math.round(sup.d) + 'm';
    } else this.supply.style.display = 'none';
    // ---- guard awareness meters
    let n = 0;
    for (const c of game.characters()) {
      const guard = c.npcRole === 'guard';
      if (!c.alive || !(guard || c.suspicion > 0.02)) continue;               // guards, and anyone you're tailing
      const d = c.pos.distanceTo(me.pos);
      if (d > 45) continue;
      const aw = guard ? st.awarenessOf(c, me) : c.suspicion, hunt = guard && st.hunting(c, me);
      if (aw < 0.04 && !hunt) continue;
      const el = this.meterEls[n] || (this.meterEls[n] = (() => { const m = document.createElement('div'); m.className = 'meter'; m.innerHTML = '<i></i>'; this.meters.appendChild(m); return m; })());
      n++;
      const s = this.project({ x: c.pos.x, y: c.pos.y + 2.25, z: c.pos.z }, camera, rect), e = this.edge(s, rect, 22);
      el.style.display = 'block';
      el.style.left = e.x + 'px'; el.style.top = e.y + 'px';
      el.classList.toggle('hunt', hunt);
      el.classList.toggle('off', !s.on);
      el.style.setProperty('--f', Math.round(Math.min(1, hunt ? 1 : aw) * 100) + '%');
      el.style.setProperty('--a', (e.ang * 180 / Math.PI) + 'deg');
      if (n >= 14) break;
    }
    for (let i = n; i < this.meterEls.length; i++) this.meterEls[i].style.display = 'none';
    // ---- takedown reticle
    const td = me.alive ? Blade.takedownTarget(game, me) : null;
    if (td) {
      const s = this.project({ x: td.pos.x, y: td.pos.y + 1.0, z: td.pos.z }, camera, rect);
      this.reticle.style.display = s.on ? 'block' : 'none';
      this.reticle.style.left = s.x + 'px'; this.reticle.style.top = s.y + 'px';
    } else this.reticle.style.display = 'none';
    // ---- prompt + timed action
    const act = st.actionFor(me);
    const pr = st.promptFor(me);
    if (act) {
      const total = act.total || 1, left = Math.max(0, act.until - game.time);
      this.progress.style.display = 'block';
      this.progress.firstChild.textContent = act.kind === 'sync' ? 'Synchronizing...' : 'Picking the lock...';
      this.progress.querySelector('i').style.width = Math.round(100 * (1 - left / total)) + '%';
    } else this.progress.style.display = 'none';
    if (!act && (pr || td)) {
      this.prompt.style.display = 'block';
      const sw = Blade.spec(me);
      this.prompt.innerHTML = pr ? '<kbd>E</kbd>' + esc(pr.text) : '<kbd>CLICK</kbd>' + (sw && sw.combo ? 'Finishing blow' : 'Takedown');
    } else this.prompt.style.display = 'none';
    // ---- stealth status
    const state = me.hidden ? 'HIDDEN' : me.blending ? 'BLENDING IN' : me.sneaking ? 'SNEAKING' : '';
    this.stealth.textContent = state;
    this.stealth.style.display = state && me.alive ? 'block' : 'none';
    this.vignette.classList.toggle('hidden', !!me.hidden && me.alive);
    // ---- barks above heads
    this.barkList = this.barkList.filter((b) => {
      if (now > b.until || !b.ch.alive) { b.el.remove(); return false; }
      const s = this.project({ x: b.ch.pos.x, y: b.ch.pos.y + 2.6, z: b.ch.pos.z }, camera, rect);
      const far = b.ch.pos.distanceTo(me.pos) > 40;
      b.el.style.display = s.on && !far ? 'block' : 'none';
      b.el.style.left = s.x + 'px'; b.el.style.top = s.y + 'px';
      return true;
    });
    if (now > this.subUntil) this.sub.style.display = 'none';
    if (now > this.titleUntil) this.title.style.display = 'none';
    if (now > this.toastUntil) this.toast.style.display = 'none';
  }
}
