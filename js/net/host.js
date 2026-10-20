/* ============================================================
 * NetHost: runs on the hosting player's browser next to the real
 * Game. Each connected friend becomes a Character driven by a
 * RemoteController (their inputs) whose position they report
 * themselves. 20 times a second every client gets a snapshot with
 * just what changed near them, the events and block edits since the
 * last one, and their own player's private state (inventory, open
 * screen, reload...). Survives "play again": attach() rebinds it to
 * the new Game and re-welcomes everyone.
 * ============================================================ */
class NetHost {
  constructor(transport, code, hooks) {
    this.t = transport;
    this.code = code;
    this.hooks = hooks || {};
    this.peers = new Map();            // peer id -> peer state
    this.game = null;
    this.snapAcc = 0;
    transport.onPeer((id) => this.peers.set(id, this._newPeer(id)));
    transport.onMessage((id, m) => this._onMessage(id, m));
    transport.onClose((id) => this._dropPeer(id));
  }

  _newPeer(id) { return { id, name: null, ch: null, sent: new Map(), invVer: -1, tpSent: -1, session: null, scVer: -2, resultsSent: false, heardAt: performance.now(), styVer: -1, spSent: null }; }

  /** Call often (also from a background tab): drops players whose browser went silent without closing the link. */
  keepAlive() {
    const now = performance.now();
    for (const p of Array.from(this.peers.values())) {
      if (now - p.heardAt > NET.TIMEOUT * 1000) { this.t.disconnect(p.id); this._dropPeer(p.id); }
    }
  }

  playerCount() { let n = 1; for (const p of this.peers.values()) if (p.ch) n++; return n; }
  names() { const out = []; for (const p of this.peers.values()) if (p.name) out.push(p.name); return out; }
  remoteCharacters() { const out = []; for (const p of this.peers.values()) if (p.ch && !p.ch.removed) out.push(p.ch); return out; }

  /** Binds to a (new) Game and welcomes every connected player into it. */
  attach(game) {
    if (this.unsub) this.unsub();
    this.game = game;
    game.net = this;
    this.evBuf = [];
    this.edits = [];
    this.editLog = new Map();            // "x,y,z" -> block id, for late joiners
    this.pieceDirty = new Set();
    this.pieceGone = [];
    const offs = NET.EVENTS.map((n) => game.events.on(n, (e) => this.evBuf.push(NetProto.packEvent(n, e))));
    offs.push(game.events.on('blockChanged', (e) => {
      this.edits.push([e.x, e.y, e.z, e.id]);
      this.editLog.set(e.x + ',' + e.y + ',' + e.z, e.id);
    }));
    for (const n of ['piecePlaced', 'pieceDamaged', 'pieceEdited']) offs.push(game.events.on(n, (e) => this.pieceDirty.add(e.piece.id)));
    offs.push(game.events.on('pieceDestroyed', (e) => { this.pieceDirty.delete(e.piece.id); this.pieceGone.push(e.piece.id); }));
    offs.push(game.events.on('openBlockUI', (e) => {
      const peer = this._peerOf(e.character);
      if (peer) { peer.session = new ScreenSession(game, e.character, e.kind, { x: e.x, y: e.y, z: e.z }); peer.scVer = -2; }
    }));
    this.unsub = () => offs.forEach((f) => f());
    for (const p of this.peers.values()) {
      if (!p.name) continue;
      this.t.send(p.id, { k: 'restart' });
      this._spawn(p);
    }
  }

  _peerOf(ch) { for (const p of this.peers.values()) if (p.ch === ch) return p; return null; }

  _onMessage(id, m) {
    const peer = this.peers.get(id) || this._newPeer(id);
    this.peers.set(id, peer);
    peer.heardAt = performance.now();
    if (!m || typeof m !== 'object') return;
    switch (m.k) {
      case 'hello':
        if (peer.ch) return;
        if (m.v !== NET.VERSION) { this.t.send(id, { k: 'deny', reason: 'Your copy of the game is a different version from the host\'s. Get the same game files as the host.' }); return; }
        if (this.playerCount() >= NET.MAX_PLAYERS) { this.t.send(id, { k: 'deny', reason: 'The room is full.' }); return; }
        peer.name = String(m.name || 'Player').replace(/[^\w .-]/g, '').slice(0, 16) || 'Player';
        if (this.game) this._spawn(peer);
        if (this.hooks.peersChanged) this.hooks.peersChanged();
        break;
      case 'in':
        if (!peer.ch || peer.ch.removed) return;
        peer.ch.controller.push(Array.isArray(m.it) ? m.it : [], m.s || null);
        peer.ch.netLag = Math.max(0, Math.min(NET.MAX_LAG, +m.lag || 0));
        break;
      case 'ui':
        if (m.op === 'story') { if (this.game && this.game.story && peer.ch && !peer.ch.removed) this.game.story.act(peer.ch, m); }
        else this._ui(peer, m);
        break;
      case 'ping': this.t.send(id, { k: 'pong', t: m.t }); break;
    }
  }

  /** Creates the joiner's character and sends them everything they need to build the world. */
  _spawn(peer) {
    const g = this.game;
    const ch = new Character({ name: peer.name, controller: new RemoteController(), isLocal: false });
    ch.netRemote = true;
    ch.isRemotePlayer = true;
    g.addEntity(ch);
    peer.ch = ch;
    peer.sent = new Map(); peer.invVer = -1; peer.tpSent = -1; peer.session = null; peer.scVer = -2; peer.resultsSent = false; peer.styVer = -1; peer.spSent = null;
    const spot = this.hooks.spawnSpot ? this.hooks.spawnSpot(ch) : g.spawnPoint;
    ch.teleport(spot.x, spot.y, spot.z);
    ch.home = new THREE.Vector3(spot.x, spot.y, spot.z);
    if (g.story) g.story.addPlayer(ch);
    if (g.match && g.match.state !== 'starting') {
      // a match is already running: watch until the next one
      ch.alive = false; ch.health = 0; ch.respawnAt = null;
    } else if (g.mode === 'build') {
      if (this.hooks.giveBuildKit) this.hooks.giveBuildKit(ch);
    }
    const pieces = Array.from(g.pieces.values()).map(NetProto.piece);
    this.t.send(peer.id, {
      k: 'welcome', id: ch.id, code: this.code, seed: g.seed, mode: g.mode, respawn: !!g.rules.respawn,
      time: g.time, tod: g.timeOfDay, edits: Array.from(this.editLog.entries()).map(([k, v]) => k.split(',').map(Number).concat(v)), pieces,
      names: this.names(),
    });
    if (this.hooks.peersChanged) this.hooks.peersChanged();
  }

  _dropPeer(id) {
    const peer = this.peers.get(id);
    this.peers.delete(id);
    if (peer && peer.ch && this.game) {
      const ch = peer.ch;
      if (peer.session) peer.session.close();
      if (ch.alive) Combat.kill(this.game, ch, null, { kind: 'disconnect' });
      ch.removed = true;
    }
    if (this.hooks.peersChanged) this.hooks.peersChanged();
  }

  _ui(peer, m) {
    const ch = peer.ch;
    if (!ch || !ch.alive || !this.game) return;
    if (m.op === 'open') {
      if (m.kind === 'inventory' && !ch.vehicle) { peer.session = new ScreenSession(this.game, ch, 'inventory'); peer.scVer = -2; }
    } else if (!peer.session) {
      return;
    } else if (m.op === 'click' && m.ref) {
      peer.session.click({ c: String(m.ref.c), i: m.ref.i | 0 }, m.button === 2 ? 2 : 0, !!m.shift);
    } else if (m.op === 'drop' && m.ref) {
      peer.session.drop({ c: String(m.ref.c), i: m.ref.i | 0 }, !!m.whole);
    } else if (m.op === 'close') {
      peer.session.close();
      peer.session = null;
      peer.scVer = -3;
    }
  }

  /** Call once per rendered frame. */
  update(frameDt) {
    const g = this.game;
    if (!g) return;
    for (const p of this.peers.values()) {
      if (p.session && !p.session.valid()) { p.session.close(); p.session = null; p.scVer = -3; }
    }
    this.snapAcc += frameDt;
    if (this.snapAcc < 1 / NET.SNAP_HZ) return;
    this.snapAcc = 0;
    // pieces still building send their HP twice a second
    if (g.tickCount % 30 < 3) for (const p of g.pieces.values()) if (p.building) this.pieceDirty.add(p.id);
    const shared = {
      ev: this.evBuf, ed: this.edits,
      pc: Array.from(this.pieceDirty).map((id) => g.pieces.get(id)).filter(Boolean).map(NetProto.piece), pcx: this.pieceGone,
      m: this._match(),
    };
    for (const p of this.peers.values()) if (p.ch && !p.ch.removed) this._send(p, shared);
    this.evBuf = []; this.edits = []; this.pieceDirty.clear(); this.pieceGone = [];
    this._results();
  }

  _match() {
    const g = this.game, m = g.match;
    if (!m) return g.rules.island ? { st: 'lobby', names: ['Host'].concat(this.names()) } : null;
    const s = m.storm;
    return {
      st: m.state, n: m.participants.length, pids: m.participants.map((c) => c.id), w: m.winner ? m.winner.id : 0,
      storm: s ? { s: s.state, tm: r2(s.timer), ph: s.phase, c: [r2(s.cur.x), r2(s.cur.z), r2(s.cur.r)], to: [r2(s.to.x), r2(s.to.z), r2(s.to.r)] } : null,
    };
  }

  _send(peer, shared) {
    const g = this.game, me = peer.ch;
    const e = [], x = [], seen = new Set();
    const st = g.story;
    for (const ent of g.entities.values()) {
      if (ent === me || ent.removed) continue;
      if ((ent.type !== 'character' || ent.npc) && ent.type !== 'vehicle') {
        const dx = ent.pos.x - me.pos.x, dz = ent.pos.z - me.pos.z;
        if (dx * dx + dz * dz > NET.VIEW_RANGE * NET.VIEW_RANGE) continue;
      }
      const rec = NetProto.record(ent);
      if (!rec) continue;
      if (st && ent.npcRole === 'guard') {
        // how aware this guard is of *this* player (their HUD meter)
        rec.aw = Math.round(st.awarenessOf(ent, me) * 10) / 10;
        rec.hm = st.hunting(ent, me) ? 1 : 0;
      }
      seen.add(ent.id);
      const key = JSON.stringify(rec);
      if (peer.sent.get(ent.id) !== key) { e.push(rec); peer.sent.set(ent.id, key); }
    }
    for (const id of peer.sent.keys()) if (!seen.has(id)) { x.push(id); peer.sent.delete(id); }

    const mine = {
      hp: Math.ceil(me.health), sh: Math.ceil(me.shield), a: me.alive ? 1 : 0, sel: me.selectedSlot,
      rl: me.reload ? [r2(me.reload.t), r2(me.reload.total)] : 0,
      us: me.using ? [me.using.id, r2(me.using.t), r2(me.using.total)] : 0,
      bl: r3(me.bloom), mi: me.mining ? r2(me.mining.progress) : 0,
      ed: me.build.edit ? { p: me.build.edit.pieceId, s: me.build.edit.selected, h: me.build.edit.hover } : 0,
      st: [me.stats.kills, Math.round(me.stats.damageDealt), me.stats.placement || 0],
      ra: me.respawnAt !== null && !me.alive ? r2(me.respawnAt - g.time) : -1,
      ld: me.lastDamagedBy ? me.lastDamagedBy.id : 0,
      vh: me.vehicle ? [me.vehicle.id, me.seatIndex, v3(me.pos)] : 0,
    };
    if (me.inventory.version !== peer.invVer) { peer.invVer = me.inventory.version; mine.inv = me.inventory.slots.map(NetProto.stack); }
    if (me.netTpSeq !== peer.tpSent) { peer.tpSent = me.netTpSeq; mine.tp = [me.netTpSeq, r3(me.pos.x), r3(me.pos.y), r3(me.pos.z), me.gliding ? 1 : 0, r3(me.yaw)]; }
    if (me.netImpulse.lengthSq() > 0) { mine.imp = v3(me.netImpulse); me.netImpulse.set(0, 0, 0); }
    if (peer.session) {
      if (peer.session.version !== peer.scVer || peer.session.be) { peer.scVer = peer.session.version; mine.sc = peer.session.snapshot(); }
    } else if (peer.scVer !== -2) { peer.scVer = -2; mine.sc = null; }
    let sty;
    if (st) {
      // story: the shared state when it changed, this player's prompt / timed action, blending
      if (peer.styVer !== st.version) { peer.styVer = st.version; sty = st.sharedState(); }
      const pr = st.promptFor(me), act = st.actionFor(me);
      mine.sp = pr ? pr.text : 0;
      mine.ac = act ? [act.kind, r2(act.until - g.time), act.total] : 0;
      mine.bl = me.blending ? 1 : 0;
    }

    this.t.send(peer.id, {
      k: 'snap', t: r3(g.time), tod: r3(g.timeOfDay), e, x, me: mine,
      ev: shared.ev, ed: shared.ed, pc: shared.pc, pcx: shared.pcx, m: shared.m, sty,
    });
  }

  /** Each remote player gets their results when the match ends (or when they're out). */
  _results() {
    const g = this.game, m = g.match;
    if (!m) return;
    for (const p of this.peers.values()) {
      const ch = p.ch;
      if (!ch || p.resultsSent || !m.participants.includes(ch)) continue;
      const out = !ch.alive && !g.rules.respawn && g.time - ch.stats.deathTime >= CONFIG.MATCH.END_DELAY;
      const ended = m.state === 'ended' && g.time - m.endTime >= CONFIG.MATCH.END_DELAY;
      if (out || ended) { p.resultsSent = true; this.t.send(p.id, { k: 'results', r: m.results(ch), winner: m.winner ? m.winner.name : null }); }
    }
  }

  close() {
    if (this.unsub) this.unsub();
    this.t.close();
    if (this.game) this.game.net = null;
  }
}
