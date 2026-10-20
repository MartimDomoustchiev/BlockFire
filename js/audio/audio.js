/* ============================================================
 * Synthesised audio (Web Audio API) - no sound files at all.
 *
 * Every sound is built from oscillators and a shared white-noise
 * buffer shaped by filters and gain envelopes:
 *   gunshots per weapon class, explosions, bullet impacts, hit /
 *   headshot / kill confirms, footsteps by block material, block
 *   break / place, reload, pickups, chest, dry fire, landing,
 *   vehicle engines (one looping voice per nearby vehicle, pitch
 *   follows speed), storm ambience (filtered noise that swells as you
 *   approach or leave the safe zone) and glider wind.
 * Sounds are positioned relative to the listener (camera): distance
 * attenuation + stereo panning. Purely presentation: listens to game
 * events, never changes the simulation.
 * ============================================================ */
const MATERIAL_OF = {
  1: 'grass', 2: 'dirt', 3: 'stone', 4: 'sand', 5: 'wood', 6: 'leaves', 7: 'glass', 8: 'stone', 9: 'stone', 10: 'stone',
  12: 'wood', 13: 'stone', 14: 'metal', 15: 'snow', 16: 'stone', 17: 'wood', 18: 'leaves', 19: 'wood', 20: 'stone', 21: 'wood',
};

const Sound = {
  ctx: null, master: null, noise: null, volume: 0.7,
  listeners: [], engines: new Map(), storm: null, wind: null,
  stepAcc: new Map(),

  /** Must be called from a user gesture (browsers block audio before one). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },

  /** listeners: [{ camera, character }] - sounds use the nearest one. */
  attach(game, listeners) {
    if (this.unsub) this.unsub();
    this.game = game;
    this.listeners = listeners;
    this.stopLoops();
    const on = (n, f) => game.events.on(n, f);
    const offs = [
      on('shot', (e) => this.gun(e.cls, e.origin)),
      on('impact', (e) => this.impact(e)),
      on('explosion', (e) => this.explosion(e)),
      on('damage', (e) => { if (this.isLocal(e.attacker) && e.target !== e.attacker) this.hit(e.headshot, e.shield > 0); if (this.isLocal(e.target)) this.hurt(); }),
      on('kill', (e) => { if (this.isLocal(e.killer) && e.victim !== e.killer) this.killConfirm(); }),
      on('blockBroken', (e) => this.blockSound(e.block, e, true)),
      on('blockPlaced', (e) => this.blockSound(e.block, e, false)),
      on('piecePlaced', (e) => this.blockSound(CONFIG.BUILD.MATERIALS[e.piece.material].block, e.piece.cells[0] ? { x: e.piece.cells[0][0], y: e.piece.cells[0][1], z: e.piece.cells[0][2] } : e.by.pos, false)),
      on('pieceDestroyed', (e) => { const c = e.piece.cells[0]; if (c) this.blockSound(CONFIG.BUILD.MATERIALS[e.piece.material].block, { x: c[0], y: c[1], z: c[2] }, true); }),
      on('reloadStart', (e) => { if (this.isLocal(e.character)) this.reload(); }),
      on('pickup', (e) => { if (this.isLocal(e.character)) this.blip(880, 0.06, 0.12); }),
      on('chestOpened', (e) => this.chest(e)),
      on('dryFire', (e) => { if (this.isLocal(e.character)) this.click(1400, 0.05); }),
      on('used', (e) => { if (this.isLocal(e.character)) this.blip(660, 0.12, 0.15, 990); }),
      on('crafted', () => this.blip(520, 0.08, 0.1, 780)),
      on('landed', (e) => this.thud(e.character.pos, 0.5)),
      on('vehicleLanded', (e) => this.thud(e.vehicle.pos, 0.9)),
      on('blockSmashed', (e) => this.blockSound(e.block, e, true)),
      on('stormShrink', () => this.blip(220, 0.5, 0.2, 160)),
      on('matchEnd', () => this.fanfare()),
      // story mode
      on('strike', (e) => this.swish(e.character.pos, !!e.windup)),
      on('assassination', (e) => this.stab(e.victim.pos)),
      on('guardAlert', (e) => { if (e.target && this.isLocal(e.target)) this.alertSting(); }),
      on('synced', () => this.chord([392, 494, 587, 784], 0.9)),
      on('storyTitle', (e) => { if (/COMPLETE|THE END/.test(e.title)) this.fanfare(); }),
      on('desync', () => this.glitch()),
      on('leap', (e) => { if (this.isLocal(e.character)) this.whoosh(); }),
      on('hayLanding', (e) => this.rustle(e)),
      on('silver', (e) => { if (e.delta > 0) this.coins(); }),
      on('notoriety', (e) => { if (e.delta > 0.5) this.alertSting(); }),
      on('cageOpened', (e) => { const out = this.ctx && this.spatial(e.character.pos, 30); if (out) this.click(500, 0.08, 0, out); }),
      on('storyLine', () => this.blip(740, 0.04, 0.05)),
      on('resupplied', (e) => { if (this.isLocal(e.character)) { this.reload(); this.coins(); } }),
      on('bowDraw', (e) => { if (this.isLocal(e.character)) this.creak(); }),
      on('blocked', (e) => this.clash(e.character.pos, false)),
      on('parry', (e) => this.clash(e.character.pos, true)),
      on('swordKill', (e) => this.stab(e.victim.pos)),
    ];
    this.unsub = () => offs.forEach((f) => f());
  },

  isLocal(ch) { return !!ch && this.listeners.some((l) => l.character === ch); },

  // ------------------------------------------------------------ building blocks
  /** Gain + stereo pan for a world position (or null = UI sound at full volume). */
  spatial(pos, range = 60) {
    const ctx = this.ctx;
    const g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let vol = 1, p = 0;
    if (pos && this.listeners.length) {
      let best = null, bd = Infinity;
      for (const l of this.listeners) { const d = l.camera.position.distanceTo(pos); if (d < bd) { bd = d; best = l; } }
      vol = Math.max(0, 1 - bd / range);
      vol *= vol;
      const cam = best.camera, rel = Sound._v.copy(pos).sub(cam.position);
      const right = Sound._r.set(1, 0, 0).applyQuaternion(cam.quaternion);
      p = rel.lengthSq() > 1e-6 ? Math.max(-1, Math.min(1, rel.normalize().dot(right))) : 0;
    }
    g.gain.value = vol;
    if (pan) { pan.pan.value = p * 0.8; g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    return vol > 0.001 ? g : null;
  },

  noiseBurst(out, { t = 0, dur = 0.2, gain = 0.5, type = 'lowpass', freq = 2000, q = 0.7, freqEnd = null, attack = 0.002 }) {
    const ctx = this.ctx, now = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, now); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(now, Math.random() * 1.5); src.stop(now + dur + 0.05);
  },

  tone(out, { t = 0, dur = 0.15, gain = 0.3, freq = 440, freqEnd = null, type = 'sine', attack = 0.003 }) {
    const ctx = this.ctx, now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(out);
    o.start(now); o.stop(now + dur + 0.05);
  },

  // ------------------------------------------------------------ sounds
  gun(cls, pos) {
    if (!this.ctx) return;
    const out = this.spatial(pos, 150);
    if (!out) return;
    switch (cls) {
      case 'ar':
        this.noiseBurst(out, { dur: 0.16, gain: 0.7, freq: 2600, freqEnd: 500 });
        this.tone(out, { dur: 0.1, gain: 0.5, freq: 160, freqEnd: 60, type: 'triangle' }); break;
      case 'smg':
        this.noiseBurst(out, { dur: 0.09, gain: 0.5, freq: 3600, freqEnd: 900, type: 'bandpass', q: 0.9 });
        this.tone(out, { dur: 0.06, gain: 0.3, freq: 220, freqEnd: 90, type: 'square' }); break;
      case 'pistol':
        this.noiseBurst(out, { dur: 0.12, gain: 0.55, freq: 3000, freqEnd: 700 });
        this.tone(out, { dur: 0.07, gain: 0.35, freq: 260, freqEnd: 110, type: 'triangle' }); break;
      case 'shotgun':
        this.noiseBurst(out, { dur: 0.42, gain: 0.95, freq: 1600, freqEnd: 180 });
        this.tone(out, { dur: 0.22, gain: 0.7, freq: 110, freqEnd: 40, type: 'sine' });
        this.click(900, 0.04, 0.32, out); this.click(700, 0.04, 0.42, out); break;     // pump
      case 'sniper':
        this.noiseBurst(out, { dur: 0.7, gain: 0.9, freq: 4200, freqEnd: 250 });
        this.tone(out, { dur: 0.35, gain: 0.6, freq: 140, freqEnd: 45, type: 'sawtooth' }); break;
      case 'rocket':
        this.noiseBurst(out, { dur: 0.6, gain: 0.6, freq: 900, freqEnd: 2400, type: 'bandpass', q: 1.2, attack: 0.03 });
        this.tone(out, { dur: 0.3, gain: 0.4, freq: 90, freqEnd: 50, type: 'sawtooth' }); break;
      case 'bow':                                                                        // the string's twang + the arrow's hiss
        this.tone(out, { dur: 0.18, gain: 0.3, freq: 190, freqEnd: 120, type: 'triangle' });
        this.noiseBurst(out, { dur: 0.16, gain: 0.2, freq: 3600, freqEnd: 1400, type: 'bandpass', q: 2 }); break;
      case 'smoke':
        this.noiseBurst(out, { dur: 0.2, gain: 0.2, freq: 800, freqEnd: 400, type: 'bandpass', q: 1 }); break;
      case 'musket':
        this.noiseBurst(out, { dur: 0.8, gain: 0.9, freq: 2600, freqEnd: 160 });
        this.tone(out, { dur: 0.4, gain: 0.6, freq: 120, freqEnd: 40, type: 'sawtooth' }); break;
    }
  },

  impact(e) {
    if (!this.ctx) return;
    const out = this.spatial(Sound._p.set(e.x, e.y, e.z), 40);
    if (!out) return;
    const m = MATERIAL_OF[e.block] || 'stone';
    if (m === 'metal') this.tone(out, { dur: 0.15, gain: 0.25, freq: 1800 + Math.random() * 400, type: 'triangle' });
    this.noiseBurst(out, { dur: 0.06, gain: 0.25, freq: m === 'wood' ? 900 : m === 'stone' ? 2400 : 1500, type: 'bandpass', q: 1.5 });
  },

  explosion(e) {
    if (!this.ctx) return;
    const out = this.spatial(Sound._p.set(e.x, e.y, e.z), 220);
    if (!out) return;
    this.noiseBurst(out, { dur: 1.6, gain: 1.0, freq: 1800, freqEnd: 60, attack: 0.005 });
    this.tone(out, { dur: 0.9, gain: 0.9, freq: 70, freqEnd: 25, type: 'sine' });
    this.noiseBurst(out, { t: 0.08, dur: 1.2, gain: 0.35, freq: 400, freqEnd: 80 });
  },

  hit(head, shield) {
    if (!this.ctx) return;
    const out = this.spatial(null);
    this.tone(out, { dur: 0.06, gain: 0.25, freq: shield ? 1500 : 1100, type: 'square' });
    if (head) this.tone(out, { t: 0.02, dur: 0.18, gain: 0.3, freq: 2400, type: 'sine' });
  },

  hurt() {
    if (!this.ctx) return;
    this.noiseBurst(this.spatial(null), { dur: 0.15, gain: 0.25, freq: 500, type: 'lowpass' });
  },

  killConfirm() {
    if (!this.ctx) return;
    const out = this.spatial(null);
    this.tone(out, { dur: 0.12, gain: 0.3, freq: 880, type: 'square' });
    this.tone(out, { t: 0.1, dur: 0.25, gain: 0.3, freq: 1320, type: 'square' });
  },

  footstep(block, pos, loud) {
    if (!this.ctx) return;
    const out = this.spatial(pos, 28);
    if (!out) return;
    const m = MATERIAL_OF[block] || 'stone', g = loud ? 0.22 : 0.14;
    const P = {
      grass: { freq: 900, dur: 0.09, type: 'lowpass' }, dirt: { freq: 700, dur: 0.08, type: 'lowpass' },
      sand: { freq: 3000, dur: 0.12, type: 'highpass' }, snow: { freq: 1600, dur: 0.14, type: 'bandpass' },
      stone: { freq: 2200, dur: 0.05, type: 'bandpass' }, wood: { freq: 500, dur: 0.07, type: 'bandpass' },
      leaves: { freq: 2500, dur: 0.1, type: 'highpass' }, glass: { freq: 4000, dur: 0.05, type: 'bandpass' },
      metal: { freq: 3000, dur: 0.06, type: 'bandpass' },
    }[m];
    this.noiseBurst(out, { dur: P.dur, gain: g, freq: P.freq * (0.9 + Math.random() * 0.2), type: P.type, q: 1.2 });
    if (m === 'wood') this.tone(out, { dur: 0.06, gain: g * 0.6, freq: 180, type: 'triangle' });
    if (m === 'metal') this.tone(out, { dur: 0.1, gain: g * 0.4, freq: 1200, type: 'triangle' });
  },

  blockSound(block, pos, broken) {
    if (!this.ctx || !pos) return;
    const out = this.spatial(Sound._p.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5), 40);
    if (!out) return;
    const m = MATERIAL_OF[block] || 'stone';
    if (m === 'glass' && broken) {
      for (let i = 0; i < 4; i++) this.tone(out, { t: i * 0.03, dur: 0.12, gain: 0.15, freq: 2500 + Math.random() * 2000, type: 'triangle' });
      return;
    }
    const f = { grass: 700, dirt: 600, sand: 2500, snow: 1400, stone: 1800, wood: 450, leaves: 2200, metal: 2600 }[m] || 1200;
    this.noiseBurst(out, { dur: broken ? 0.25 : 0.12, gain: broken ? 0.4 : 0.3, freq: f, type: 'bandpass', q: 0.8 });
    this.tone(out, { dur: 0.08, gain: 0.2, freq: m === 'wood' ? 160 : m === 'metal' ? 900 : 120, type: 'triangle' });
  },

  reload() {
    if (!this.ctx) return;
    const out = this.spatial(null);
    this.click(1200, 0.04, 0, out); this.click(800, 0.05, 0.35, out); this.click(1500, 0.04, 0.7, out);
  },

  click(freq, dur, t = 0, out = null) {
    if (!this.ctx) return;
    this.noiseBurst(out || this.spatial(null), { t, dur, gain: 0.3, freq, type: 'bandpass', q: 3 });
  },

  blip(freq, dur, gain, freqEnd) {
    if (!this.ctx) return;
    this.tone(this.spatial(null), { dur, gain, freq, freqEnd, type: 'square' });
  },

  chest(e) {
    if (!this.ctx) return;
    const out = this.spatial(Sound._p.set(e.x + 0.5, e.y + 0.5, e.z + 0.5), 40);
    if (!out) return;
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(out, { t: i * 0.06, dur: 0.25, gain: 0.18, freq: f, type: 'triangle' }));
  },

  thud(pos, k) {
    if (!this.ctx) return;
    const out = this.spatial(pos, 40);
    if (!out) return;
    this.tone(out, { dur: 0.2, gain: 0.4 * k, freq: 90, freqEnd: 40, type: 'sine' });
    this.noiseBurst(out, { dur: 0.15, gain: 0.25 * k, freq: 500 });
  },

  fanfare() {
    if (!this.ctx) return;
    const out = this.spatial(null);
    [523, 659, 784, 1046].forEach((f, i) => this.tone(out, { t: i * 0.14, dur: 0.4, gain: 0.25, freq: f, type: 'square' }));
  },

  // ------------------------------------------------------------ loops
  _loop(type, freq) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let src, f;
    if (type === 'noise') {
      src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.6;
      src.connect(f); f.connect(g);
    } else {
      src = ctx.createOscillator(); src.type = 'sawtooth'; src.frequency.value = freq;
      f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      src.connect(f); f.connect(g);
    }
    if (pan) { g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    src.start();
    return { src, f, g, pan };
  },

  // ------------------------------------------------------------ story mode
  swish(pos, heavy) {
    if (!this.ctx) return;
    const out = this.spatial(pos, 25);
    if (out) this.noiseBurst(out, { dur: heavy ? 0.3 : 0.14, gain: 0.3, freq: heavy ? 1400 : 2800, freqEnd: heavy ? 500 : 1600, type: 'bandpass', q: 1.6, attack: heavy ? 0.2 : 0.01 });
  },

  /** Steel on steel: a block (or a ringing parry). */
  clash(pos, ring) {
    if (!this.ctx) return;
    const out = this.spatial(pos, 30);
    if (!out) return;
    this.noiseBurst(out, { dur: 0.06, gain: 0.45, freq: 5200, freqEnd: 2600, type: 'bandpass', q: 3 });
    this.tone(out, { dur: ring ? 0.7 : 0.25, gain: 0.18, freq: 2350, freqEnd: 2200, type: 'triangle' });
    this.tone(out, { dur: ring ? 0.55 : 0.18, gain: 0.12, freq: 3520, type: 'sine' });
  },

  /** A bow being drawn: a low creak. */
  creak() {
    if (!this.ctx) return;
    const out = this.spatial(null);
    this.noiseBurst(out, { dur: 0.35, gain: 0.08, freq: 420, freqEnd: 300, type: 'bandpass', q: 6, attack: 0.15 });
  },

  stab(pos) {
    if (!this.ctx) return;
    const out = this.spatial(pos, 20);
    if (!out) return;
    this.noiseBurst(out, { dur: 0.08, gain: 0.4, freq: 600, type: 'lowpass' });
    this.tone(out, { dur: 0.12, gain: 0.2, freq: 1800, freqEnd: 900, type: 'triangle' });
  },

  alertSting() {
    if (!this.ctx) return;
    const out = this.spatial(null);
    this.tone(out, { dur: 0.25, gain: 0.25, freq: 880, type: 'square' });
    this.tone(out, { t: 0.12, dur: 0.35, gain: 0.25, freq: 1175, type: 'square' });
  },

  chord(freqs, dur) {
    if (!this.ctx) return;
    const out = this.spatial(null);
    freqs.forEach((f, i) => this.tone(out, { t: i * 0.08, dur, gain: 0.12, freq: f, type: 'sine', attack: 0.05 }));
  },

  glitch() {
    if (!this.ctx) return;
    const out = this.spatial(null);
    for (let i = 0; i < 5; i++) this.tone(out, { t: i * 0.07, dur: 0.06, gain: 0.15, freq: 200 + Math.random() * 1600, type: 'square' });
    this.noiseBurst(out, { dur: 0.5, gain: 0.2, freq: 3000, freqEnd: 300, type: 'bandpass', q: 3 });
  },

  whoosh() {
    if (!this.ctx) return;
    this.noiseBurst(this.spatial(null), { dur: 1.1, gain: 0.35, freq: 500, freqEnd: 2200, type: 'bandpass', q: 0.8, attack: 0.4 });
  },

  rustle(e) {
    if (!this.ctx) return;
    const out = this.spatial(Sound._p.set(e.x, e.y, e.z), 30);
    if (out) this.noiseBurst(out, { dur: 0.45, gain: 0.5, freq: 2400, freqEnd: 700, type: 'bandpass', q: 0.8 });
  },

  coins() {
    if (!this.ctx) return;
    const out = this.spatial(null);
    for (let i = 0; i < 4; i++) this.tone(out, { t: i * 0.06, dur: 0.12, gain: 0.1, freq: 2000 + i * 300, type: 'triangle' });
  },

  stopLoops() {
    for (const e of this.engines.values()) { try { e.src.stop(); } catch (x) { /* already stopped */ } }
    this.engines.clear();
    if (this.storm) { try { this.storm.src.stop(); } catch (x) { /* */ } this.storm = null; }
    if (this.wind) { try { this.wind.src.stop(); } catch (x) { /* */ } this.wind = null; }
  },

  /** Per frame: engines, storm ambience, glider wind, footsteps. */
  update(frameDt, game) {
    if (!this.ctx || !game || !this.listeners.length) return;
    const t = this.ctx.currentTime;
    const seen = new Set();
    for (const e of game.entities.values()) {
      if (e.type !== 'vehicle' || !e.alive) continue;
      const occupied = e.seats.some(Boolean);
      const d = Math.min(...this.listeners.map((l) => l.camera.position.distanceTo(e.pos)));
      if (!occupied || d > 70) continue;
      seen.add(e.id);
      let v = this.engines.get(e.id);
      if (!v) { v = this._loop('osc', 50); this.engines.set(e.id, v); }
      const sp = e.speed / e.spec.maxSpeed;
      v.src.frequency.setTargetAtTime(45 + sp * 110, t, 0.08);
      v.f.frequency.setTargetAtTime(300 + sp * 900, t, 0.1);
      const vol = Math.max(0, 1 - d / 70);
      v.g.gain.setTargetAtTime(0.12 * vol * vol, t, 0.1);
    }
    for (const [id, v] of this.engines) if (!seen.has(id)) { try { v.src.stop(); } catch (x) { /* */ } this.engines.delete(id); }

    // storm ambience: louder near the edge and outside it
    const storm = game.match && game.match.storm;
    const me = this.listeners[0].character;
    if (storm && me) {
      if (!this.storm) this.storm = this._loop('noise', 300);
      const out = storm.outside(me.pos.x, me.pos.z);
      const k = out > 0 ? 1 : Math.max(0, 1 + out / 25);
      this.storm.g.gain.setTargetAtTime(0.25 * k, t, 0.3);
      this.storm.f.frequency.setTargetAtTime(250 + 200 * Math.sin(t * 0.7), t, 0.5);
    } else if (this.storm) this.storm.g.gain.setTargetAtTime(0, t, 0.3);

    // glider wind
    const gliding = this.listeners.some((l) => l.character && l.character.gliding);
    if (gliding && !this.wind) this.wind = this._loop('noise', 900);
    if (this.wind) this.wind.g.gain.setTargetAtTime(gliding ? 0.15 : 0, t, 0.3);

    // footsteps of everyone near a listener
    for (const c of game.entities.values()) {
      if (c.type !== 'character' || !c.alive || !c.onGround || c.vehicle || c.flying) continue;
      const sp = Math.hypot(c.vel.x, c.vel.z);
      if (sp < 0.5) continue;
      const acc = (this.stepAcc.get(c.id) || 0) + sp * frameDt;
      if (acc > (c.sprinting ? 2.4 : 1.9)) {
        this.stepAcc.set(c.id, 0);
        const b = game.world.getBlock(Math.floor(c.pos.x), Math.floor(c.pos.y - 0.1), Math.floor(c.pos.z));
        this.footstep(b, c.pos, this.isLocal(c));
      } else this.stepAcc.set(c.id, acc);
    }
  },
};
Sound._v = new THREE.Vector3(); Sound._r = new THREE.Vector3(); Sound._p = new THREE.Vector3();
