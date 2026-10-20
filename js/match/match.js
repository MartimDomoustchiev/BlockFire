/* ============================================================
 * Match flow for island modes (solo vs bots, local duel).
 *
 *  start(): everyone drops in from the sky above spread-out land
 *           points and glides down; bots get a BotController; a few
 *           vehicles, boats and fuel barrels are scattered around.
 *  tick():  runs the storm, tracks eliminations (placement = how many
 *           were alive when you fell) and ends the match when one
 *           player is left (or with respawn on, when someone reaches
 *           the kill target / time runs out).
 * Everything uses the match RNG, so a seed replays identically.
 * ============================================================ */
class Match {
  constructor(game, opts) {
    this.game = game;
    this.opts = Object.assign({ bots: 3, difficulty: 'normal', respawn: false }, opts);
    this.rng = new Rng(game.seed ^ 0x4d415443);
    this.state = 'starting';                       // starting | playing | ended
    this.winner = null;
    this.startTime = 0;
    this.endTime = 0;
    this.participants = [];
    // respawn matches have no storm (it would close on the respawn points) and a time limit instead
    this.storm = this.opts.storm === false || this.opts.respawn ? null : new Storm(CONFIG.ISLAND.RADIUS, new Rng(game.seed ^ 0x53544f52));
    game.events.on('kill', (e) => this._onKill(e));
    game.events.on('respawn', (e) => this._onRespawn(e));
  }

  /** Surface y at a column, or null for water / unloaded / trees. */
  groundY(x, z) {
    const w = this.game.world;
    for (let y = CONFIG.CHUNK_HEIGHT - 2; y > 0; y--) {
      const b = w.getBlock(x, y, z);
      if (b < 0) return null;
      if (b === BLOCK.WATER || b === BLOCK.LEAVES || b === BLOCK.WOOD) return null;
      if (BlockTables.solid[b]) return y + 1;
    }
    return null;
  }

  /** n land points spread over the island, at least `spacing` apart (relaxed if impossible). */
  landPoints(n, spacing, maxFrac = 0.8) {
    const R = CONFIG.ISLAND.RADIUS * maxFrac, pts = [];
    for (let tries = 0; pts.length < n && tries < 4000; tries++) {
      const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * R;
      const x = Math.floor(Math.cos(a) * d), z = Math.floor(Math.sin(a) * d);
      const y = this.groundY(x, z);
      if (y === null) continue;
      const sp = tries > 2500 ? spacing * 0.4 : spacing;
      if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < sp)) continue;
      pts.push({ x: x + 0.5, y, z: z + 0.5 });
    }
    return pts;
  }

  /** humans: Characters already in the game (local players). Adds bots, spreads everyone, starts the clock. */
  start(humans) {
    const g = this.game, I = CONFIG.ISLAND;
    const names = new Set();
    for (let i = 0; i < this.opts.bots; i++) {
      let name;
      do { name = this.rng.pick(CONFIG.BOTS.NAMES_A) + ' ' + this.rng.pick(CONFIG.BOTS.NAMES_B); } while (names.has(name));
      names.add(name);
      const b = new Character({ name, controller: new BotController(this.opts.difficulty, g.seed + i * 7919) });
      b.isBot = true;
      g.addEntity(b);
    }
    const all = humans.concat(g.characters().filter((c) => c.isBot));
    const pts = this.landPoints(all.length, I.MIN_SPAWN_SPACING);
    all.forEach((c, i) => {
      const p = pts[i % Math.max(1, pts.length)] || { x: 0.5, y: 40, z: 0.5 };
      c.revive();
      c.inventory.clear();
      for (const [id, n] of CONFIG.MATCH.START_KIT) c.inventory.add(makeStack(id, n));
      c.teleport(p.x, Math.max(p.y + 4, I.DROP_HEIGHT), p.z);
      c.yaw = Math.atan2(p.x, p.z);                    // face the island centre
      c.gliding = true;
      c.home = new THREE.Vector3(p.x, p.y, p.z);
      c.stats = { kills: 0, damageDealt: 0, spawnTime: g.time, deathTime: -1, placement: 0 };
      c.respawnDelay = this.opts.respawn ? CONFIG.HEALTH.RESPAWN_TIME : null;
    });
    this.participants = all;
    this._spawnVehicles();
    this.state = 'playing';
    this.startTime = g.time;
    g.events.emit('matchStart', { players: all.length });
  }

  _spawnVehicles() {
    const g = this.game, I = CONFIG.ISLAND;
    for (const [kind, n] of Object.entries(I.VEHICLES)) {
      if (kind === 'boat') continue;
      for (const p of this.landPoints(n, 20, 0.7)) {
        let flat = true;
        for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
          const yy = this.groundY(Math.floor(p.x) + ox, Math.floor(p.z) + oz);
          if (yy === null || Math.abs(yy - p.y) > 1) flat = false;
        }
        if (!flat) continue;
        const v = g.addEntity(new Vehicle(kind));
        v.pos.set(p.x, p.y, p.z); v.yaw = this.rng.next() * Math.PI * 2;
      }
    }
    // boats along the shore (water with land nearby)
    let boats = I.VEHICLES.boat || 0;
    for (let tries = 0; boats > 0 && tries < 400; tries++) {
      const a = this.rng.next() * Math.PI * 2, d = I.RADIUS * (0.75 + this.rng.next() * 0.3);
      const x = Math.floor(Math.cos(a) * d), z = Math.floor(Math.sin(a) * d), w = g.world;
      if (w.getBlock(x, CONFIG.SEA_LEVEL, z) !== BLOCK.WATER || w.getBlock(x, CONFIG.SEA_LEVEL - 1, z) !== BLOCK.WATER) continue;
      if (w.getBlock(x + 2, CONFIG.SEA_LEVEL, z) !== BLOCK.WATER || w.getBlock(x, CONFIG.SEA_LEVEL, z + 2) !== BLOCK.WATER) continue;
      const b = g.addEntity(new Vehicle('boat'));
      b.pos.set(x + 0.5, CONFIG.SEA_LEVEL + 1 - 0.15, z + 0.5); b.yaw = a;
      boats--;
    }
    for (const p of this.landPoints(I.BARRELS, 25, 0.75)) {
      const b = g.addEntity(new FuelBarrel());
      b.pos.set(p.x, p.y, p.z);
    }
  }

  alive() { return this.participants.filter((c) => c.alive || (this.opts.respawn && c.respawnAt !== null)); }

  _onKill(e) {
    if (this.state !== 'playing' || !this.participants.includes(e.victim)) return;
    if (!this.opts.respawn) {
      e.victim.stats.placement = this.participants.filter((c) => c.alive).length + 1;
      e.victim.respawnAt = null;
    } else {
      // come back somewhere new on the island, away from the fight
      const p = this.landPoints(1, 0, 0.7)[0];
      if (p) e.victim.home = new THREE.Vector3(p.x, p.y, p.z);
    }
  }

  _onRespawn(e) {
    if (this.state !== 'playing' || !this.participants.includes(e.character)) return;
    const c = e.character;
    c.inventory.clear();
    for (const [id, n] of CONFIG.MATCH.START_KIT) c.inventory.add(makeStack(id, n));
  }

  tick(dt) {
    const g = this.game;
    if (this.state !== 'playing') return;                 // (the storm stops once the match is decided)
    if (this.storm) this.storm.tick(dt, g);
    const living = this.participants.filter((c) => c.alive);
    const timeUp = this.opts.respawn && g.time - this.startTime >= CONFIG.MATCH.RESPAWN_TIME_LIMIT;
    const done = this.opts.respawn
      ? timeUp || (this.opts.killTarget && this.participants.some((c) => c.stats.kills >= this.opts.killTarget))
      : living.length <= 1;
    if (!done) return;
    this.state = 'ended';
    this.endTime = g.time;
    if (this.opts.respawn) {
      // most kills wins; a tie is a draw
      const byKills = this.participants.slice().sort((a, b) => b.stats.kills - a.stats.kills);
      const tie = byKills.length > 1 && byKills[0].stats.kills === byKills[1].stats.kills;
      this.winner = tie ? null : byKills[0];
      byKills.forEach((c, i) => { c.stats.placement = tie && c.stats.kills === byKills[0].stats.kills ? 1 : i + 1; });
    } else {
      this.winner = living[0] || null;
      if (this.winner) this.winner.stats.placement = 1;
      else {
        // everyone fell on the same tick: a draw, shared first place
        const last = Math.max(...this.participants.map((c) => c.stats.deathTime));
        for (const c of this.participants) if (c.stats.deathTime === last) c.stats.placement = 1;
      }
    }
    for (const c of this.participants) if (!c.stats.placement) c.stats.placement = c === this.winner ? 1 : 2;
    g.events.emit('matchEnd', { winner: this.winner });
  }

  /** Numbers for the results screen. */
  results(ch) {
    const end = ch.alive ? (this.state === 'ended' ? this.endTime : this.game.time) : ch.stats.deathTime;
    return {
      placement: ch.stats.placement || this.participants.filter((c) => c.alive).length,
      players: this.participants.length,
      kills: ch.stats.kills,
      damage: Math.round(ch.stats.damageDealt),
      survival: Math.max(0, end - ch.stats.spawnTime),
      won: this.winner === ch,
    };
  }
}
