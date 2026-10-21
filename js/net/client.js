/* ============================================================
 * NetClient: runs on a joining player's browser.
 *
 * Builds a replica Game from the host's welcome (same seed => same
 * terrain; edits arrive separately), moves its own player locally and
 * sends its inputs + position 30 times a second. Everything else is a
 * proxy entity updated from snapshots and drawn INTERP seconds in the
 * past so movement is smooth between snapshots. Host events are
 * re-emitted locally so effects, sounds, the HUD and the kill feed
 * work unchanged. Gunshots of the local player are predicted (flash,
 * sound, tracer, recoil right away); the host decides hits.
 * ============================================================ */
class MatchMirror {
  constructor(game) { this.game = game; this.state = 'starting'; this.participants = []; this.winner = null; this.storm = null; this.lobby = null; this.opts = {}; }
  apply(m) {
    const g = this.game;
    if (!m) return;
    this.state = m.st;
    this.lobby = m.st === 'lobby' ? (m.names || []) : null;
    if (m.pids) this.participants = m.pids.map((id) => g.entities.get(id)).filter(Boolean);
    this.winner = m.w ? g.entities.get(m.w) || null : null;
    if (m.storm) {
      if (!this.storm) this.storm = new StormMirror();
      this.storm.apply(m.storm);
    } else this.storm = null;
  }
  results() { return this.lastResults || null; }
}

class StormMirror {
  apply(s) {
    this.state = s.s; this.timer = s.tm; this.phase = s.ph;
    this.cur = { x: s.c[0], z: s.c[1], r: s.c[2] };
    this.to = { x: s.to[0], z: s.to[1], r: s.to[2] };
  }
  get dps() { return CONFIG.STORM.PHASES[Math.min(this.phase, CONFIG.STORM.PHASES.length - 1)].dps; }
  inside(x, z) { return Math.hypot(x - this.cur.x, z - this.cur.z) <= this.cur.r; }
  outside(x, z) { return Math.hypot(x - this.cur.x, z - this.cur.z) - this.cur.r; }
}

class NetClient {
  /**
   * hooks: welcome(msg) -> { game, me } builds the replica; restart(); results(r, winner);
   *        screen(snapOrNull); closed(reason); status(text)
   */
  constructor(transport, name, hooks) {
    this.t = transport;
    this.name = name;
    this.hooks = hooks;
    this.game = null;
    this.me = null;
    this.pending = [];
    this.sendAcc = 0;
    this.lastPing = 0;
    this.heardAt = 0;                  // last message from the host (0: not connected yet)
    this.rtt = 0.1;
    this.offset = 0;
    this.tpAck = 0;
    this.nextShot = 0;
    transport.onOpen(() => {
      this.heardAt = performance.now();
      this.hooks.status('Connected - joining...');
      this.t.send('host', { k: 'hello', name, v: NET.VERSION, look: NetProto.look(this.hooks.look ? this.hooks.look() : null) });
    });
    transport.onMessage((id, m) => this._onMessage(m));
    transport.onClose(() => this._closed('The host left the game.'));
    transport.onError((e) => this._closed(String(e)));
  }

  /** Call often, also while loading or in a background tab: pings the host and notices when it goes silent. */
  keepAlive() {
    if (this.done || !this.heardAt) return;
    const now = performance.now();
    if (now - this.lastPing >= NET.PING_EVERY * 1000) { this.lastPing = now; this.t.send('host', { k: 'ping', t: now / 1000 }); }
    if (now - this.heardAt > NET.TIMEOUT * 1000) this._closed('Lost the connection to the host.');
  }

  _onMessage(m) {
    if (!m || typeof m !== 'object') return;
    this.heardAt = performance.now();
    switch (m.k) {
      case 'welcome': this._welcome(m); break;
      case 'restart': this.game = null; this.me = null; this.hooks.restart(); break;
      case 'snap': if (this.game) this._snap(m); break;
      case 'results': if (this.game && this.game.match) this.game.match.lastResults = m.r; this.hooks.results(m.r, m.winner); break;
      case 'pong': this.rtt = this.rtt * 0.7 + Math.max(0.001, performance.now() / 1000 - m.t) * 0.3; break;
      case 'deny': this._closed(m.reason || 'The host refused the connection.'); break;
    }
  }

  _welcome(m) {
    const { game, me } = this.hooks.welcome(m);
    this.game = game;
    this.me = me;
    game.net = this;
    game.match = game.rules.island ? new MatchMirror(game) : null;
    this.offset = m.time - performance.now() / 1000;
    this.tpAck = 0;
    this.pending = [];
    for (const [x, y, z, id] of m.edits) game.world.applyNetEdit(x, y, z, id);
    for (const p of m.pieces) this._piece(p);
  }

  /** Called by RecordingController for every tick of the local player's input. */
  queueIntent(it) {
    this.pending.push(NetProto.packIntent(it));
    this._predictShot(it);
  }

  sendUi(op) { this.t.send('host', Object.assign({ k: 'ui' }, op)); }

  /** Per rendered frame: send inputs, interpolate everyone else. */
  update(frameDt) {
    if (!this.game || !this.me) return;
    this.sendAcc += frameDt;
    if (this.sendAcc >= 1 / NET.INPUT_HZ && this.pending.length) {
      this.sendAcc = 0;
      this.t.send('host', { k: 'in', it: this.pending, s: NetProto.packState(this.me, this.tpAck), lag: r3(this.rtt / 2 + NET.INTERP) });
      this.pending = [];
    }
    this._interpolate();
  }

  // ------------------------------------------------------------------ snapshots
  _snap(m) {
    const g = this.game;
    // smoothed estimate of the host clock
    const off = m.t - performance.now() / 1000;
    this.offset = Math.abs(off - this.offset) > 1 ? off : this.offset * 0.9 + off * 0.1;
    if (Math.abs(g.timeOfDay - m.tod) > 0.01) g.timeOfDay = m.tod;
    for (const rec of m.e) {
      let e = g.entities.get(rec.id);
      if (!e) e = this._spawnProxy(rec);
      if (e && e !== this.me) this._applyRecord(e, rec, m.t);
    }
    for (const id of m.x) { const e = g.entities.get(id); if (e && e !== this.me) g.removeEntity(e); }
    for (const [x, y, z, id] of m.ed) g.world.applyNetEdit(x, y, z, id);
    for (const p of m.pc) this._piece(p);
    for (const id of m.pcx) this._removePiece(id);
    if (m.m && g.match) g.match.apply(m.m);
    if (m.sty) { this.pendingSty = m.sty; if (g.story) g.story.apply(m.sty); }
    this._me(m.me);
    for (const packed of m.ev) this._event(packed);
  }

  _spawnProxy(rec) {
    const g = this.game;
    let e = null;
    const p = rec.p;
    switch (rec.t) {
      case 'c': e = new Character({ name: rec.n, team: rec.tm, look: rec.lk || null, lookSpec: rec.ls ? NetProto.unlook(rec.ls) : null }); e.isBot = !!rec.bot; e.teleport(p[0], p[1], p[2]); break;
      case 'v': e = new Vehicle(rec.k); e.pos.set(p[0], p[1], p[2]); break;
      case 'd': e = new ItemDrop(NetProto.unstack(rec.s), p[0], p[1], p[2]); e.pickupDelay = Infinity; break;
      case 'p': {
        const st = Weapons.stats(rec.c, rec.r);
        e = new Projectile(g.entities.get(rec.o) || null, st, new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(0, 0, 1));
        break;
      }
      case 'b': e = new FuelBarrel(); e.pos.set(p[0], p[1], p[2]); break;
      case 'w': e = new Poster(p[0], p[1], p[2], rec.n[0], rec.n[1]); break;
      case 's': e = new SmokeCloud(p[0], p[1], p[2], rec.r, null); break;
    }
    if (!e) return null;
    e.id = rec.id;
    e.netProxy = true;
    e.netBuf = [];
    g.addEntity(e);
    return e;
  }

  _applyRecord(e, rec, t) {
    const g = this.game;
    const buf = e.netBuf || (e.netBuf = []);
    if (rec.p) {
      buf.push({ t, p: rec.p, y: rec.y || 0, pi: rec.pi || 0, v: rec.v || null });
      if (buf.length > 10) buf.shift();
    }
    if (rec.v) e.vel.set(rec.v[0], rec.v[1], rec.v[2]);
    switch (rec.t) {
      case 'c':
        e.alive = !!rec.a; e.health = rec.hp; e.shield = rec.sh;
        e.inventory.slots[0] = NetProto.unstack(rec.h); e.selectedSlot = 0; e.inventory.version++;
        e.gliding = !!rec.g; e.onGround = !!rec.gr; e.inWater = !!rec.w;
        e.mining = rec.m ? { progress: rec.m } : null;
        e.sneaking = !!rec.cr; e.climbing = !!rec.cl; e.leap = rec.lp ? true : null; e.corpse = !!rec.cp;
        e.npcRole = rec.nr || null; e.isHuman = !!rec.hu; e.awMe = rec.aw || 0; e.huntMe = !!rec.hm; e.suspicion = rec.su || 0;
        e.vehicle = rec.vs ? g.entities.get(rec.vs) || null : null;
        e.seatIndex = rec.vs ? rec.si : -1;
        e.vehicleSeat = rec.vs ? (rec.si === 0 ? 'driver' : 'passenger') : null;
        break;
      case 'v':
        e.hp = rec.hp; e.fuel = rec.fu; e.seats = rec.s; e.onGround = !!rec.gr; e.onWater = !!rec.wa; e.vy = rec.vy; e.alive = !!rec.a;
        break;
      case 'd':
        e.stack = NetProto.unstack(rec.s);
        e.pos.set(rec.p[0], rec.p[1], rec.p[2]);
        break;
      case 'b': e.alive = !!rec.a; e.pos.set(rec.p[0], rec.p[1], rec.p[2]); break;
    }
  }

  /** Draws proxies INTERP seconds in the past, between the two snapshots around that moment. */
  _interpolate() {
    const rt = performance.now() / 1000 + this.offset - NET.INTERP;
    for (const e of this.game.entities.values()) {
      const b = e.netBuf;
      if (!b || !b.length || e === this.me || e.type === 'drop' || e.type === 'barrel') continue;
      if (e.type === 'projectile') {
        const s = b[b.length - 1], dt = Math.max(0, rt + NET.INTERP - s.t);
        e.pos.set(s.p[0] + (s.v ? s.v[0] : 0) * dt, s.p[1] + (s.v ? s.v[1] : 0) * dt, s.p[2] + (s.v ? s.v[2] : 0) * dt);
        continue;
      }
      let a = b[0], c = b[b.length - 1];
      for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= rt) { a = b[i - 1]; c = b[i]; break; }
      const k = c.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (c.t - a.t))) : 1;
      e.pos.set(a.p[0] + (c.p[0] - a.p[0]) * k, a.p[1] + (c.p[1] - a.p[1]) * k, a.p[2] + (c.p[2] - a.p[2]) * k);
      e.yaw = a.y + wrapAngle(c.y - a.y) * k;
      if (e.type === 'character') e.pitch = a.pi + (c.pi - a.pi) * k;
    }
    // riding: our own body sits in the (interpolated) vehicle seat
    const me = this.me;
    if (me.vehicle && me.vehicle.alive) {
      const s = me.vehicle.spec.seats[me.seatIndex];
      if (s) me.vehicle.local(s[0], s[1], s[2], me.pos);
      me.vel.copy(me.vehicle.vel);
    }
  }

  _me(d) {
    const ch = this.me, g = this.game;
    if (!d) return;
    ch.health = d.hp; ch.shield = d.sh;
    ch.alive = !!d.a;
    if (d.inv) { for (let i = 0; i < d.inv.length; i++) ch.inventory.slots[i] = NetProto.unstack(d.inv[i]); ch.inventory.version++; }
    ch.reload = d.rl ? { slot: ch.selectedSlot, t: d.rl[0], total: d.rl[1] } : null;
    ch.using = d.us ? { id: d.us[0], slot: ch.selectedSlot, t: d.us[1], total: d.us[2] } : null;
    ch.bloom = d.bl;
    ch.mining = d.mi ? { progress: d.mi } : null;
    ch.build.edit = d.ed ? { pieceId: d.ed.p, selected: d.ed.s, hover: d.ed.h } : null;
    ch.stats.kills = d.st[0]; ch.stats.damageDealt = d.st[1]; ch.stats.placement = d.st[2];
    ch.respawnAt = d.ra >= 0 ? g.time + d.ra : null;
    if (d.ld) ch.lastDamagedBy = g.entities.get(d.ld) || ch.lastDamagedBy;
    if (d.tp && d.tp[0] > this.tpAck) {
      this.tpAck = d.tp[0];
      ch.teleport(d.tp[1], d.tp[2], d.tp[3]);
      ch.gliding = !!d.tp[4];
      ch.yaw = d.tp[5];
    }
    if (d.imp) { ch.vel.x += d.imp[0]; ch.vel.y += d.imp[1]; ch.vel.z += d.imp[2]; if (d.imp[1] > 0) ch.onGround = false; }
    if (d.vh) {
      const v = g.entities.get(d.vh[0]) || null;
      ch.vehicle = v; ch.seatIndex = d.vh[1]; ch.vehicleSeat = d.vh[1] === 0 ? 'driver' : 'passenger';
      if (!v) ch.pos.set(d.vh[2][0], d.vh[2][1], d.vh[2][2]);
    } else if (ch.vehicle) { ch.vehicle = null; ch.vehicleSeat = null; ch.seatIndex = -1; }
    if ('sc' in d) this.hooks.screen(d.sc);
    if (g.story && g.story.applyMine) { g.story.applyMine(d); ch.blending = !!d.bl; }
  }

  _event(packed) {
    const g = this.game, [name, e] = NetProto.unpackEvent(packed, g);
    if (!e) return;
    if (name === 'shot' && e.character === this.me) return;            // already predicted locally
    if (name === 'damage' && e.target) { e.target.lastDamageTime = g.time; e.target.lastDamagedBy = e.attacker; }
    if (name === 'kill' && e.victim) { e.victim.lastDamagedBy = e.killer || e.victim.lastDamagedBy; e.victim.stats.deathTime = g.time; }
    if (name === 'piecePlaced' || name === 'pieceDestroyed') e.piece = e.piece || null;
    if ((name === 'reloadStart' || name === 'pickup' || name === 'used' || name === 'dryFire') && !e.character) return;
    g.events.emit(name, e);
  }

  // ------------------------------------------------------------------ build pieces (for the HUD and ghost)
  _piece(p) {
    const g = this.game;
    const old = g.pieces.get(p.id);
    if (old) for (const c of old.cells) g.pieceAt.delete(Building.key(c[0], c[1], c[2]));
    g.pieces.set(p.id, p);
    for (const c of p.cells) g.pieceAt.set(Building.key(c[0], c[1], c[2]), p.id);
  }

  _removePiece(id) {
    const g = this.game, p = g.pieces.get(id);
    if (!p) return;
    for (const c of p.cells) if (g.pieceAt.get(Building.key(c[0], c[1], c[2])) === id) g.pieceAt.delete(Building.key(c[0], c[1], c[2]));
    g.pieces.delete(id);
  }

  // ------------------------------------------------------------------ predicted gunshots (cosmetic)
  _predictShot(it) {
    const ch = this.me, g = this.game;
    if (!ch.alive || ch.vehicleSeat === 'driver' || ch.build.active || ch.build.edit || ch.reload) return;
    const held = ch.heldStack(), st = Weapons.of(held);
    if (!st) { this.bowHeld = 0; return; }
    if (st.bow) {
      // a bow looses on release after a long enough draw (the host decides; this is just the sound and the kick)
      const pulled = this.bowHeld || 0;
      if (it.fire && held.data.mag > 0) { this.bowHeld = pulled + 1 / CONFIG.SIM_HZ; return; }
      this.bowHeld = 0;
      if (pulled / st.bow.draw < st.bow.min) return;
    } else {
      const wants = st.auto ? it.fire : it.firePressed;
      if (!wants) return;
    }
    if (held.data.mag <= 0 || g.time < this.nextShot) return;
    this.nextShot = g.time + st.interval;
    const o = ch.eyePos(new THREE.Vector3()), aim = ch.aimDir(new THREE.Vector3());
    const ends = [];
    if (!st.projectile) {
      for (let i = 0; i < st.pellets; i++) {
        const cone = st.pellets > 1 ? st.pelletSpread : Weapons.spread(ch, st);
        const r = cone * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
        const d = aim.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.cos(a + 1.3) * r)).normalize();
        const hit = raycastBlocks(g.world, o, d, st.range, { filter: BULLET_STOPS });
        ends.push(o.clone().addScaledVector(d, hit ? hit.dist : st.range));
      }
    }
    ch.recoil += st.recoil * (1 - 0.4 * ch.adsT);
    g.events.emit('shot', { character: ch, cls: st.cls, rarity: st.rarity, origin: o, ends, predicted: true });
  }

  /** The connection ended (reported once, even though closing it fires more events). */
  _closed(reason) {
    if (this.done) return;
    this.done = true;
    this.hooks.closed(reason);
  }

  close() { this.done = true; this.t.close(); if (this.game) this.game.net = null; }
}
