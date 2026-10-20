/* ============================================================
 * The storm: a shrinking circle. Each phase waits, then shrinks the
 * safe circle towards a smaller one placed randomly (seeded) inside
 * the current circle. Characters outside take the phase's damage
 * once per second, straight to health (shields don't absorb it).
 * ============================================================ */
class Storm {
  constructor(islandRadius, rng) {
    this.R = islandRadius;
    this.rng = rng;
    this.phase = 0;
    this.state = 'waiting';                       // waiting | shrinking | final
    const r0 = islandRadius * CONFIG.STORM.START_RADIUS_FRAC;
    this.cur = { x: 0, z: 0, r: r0 };
    this.from = { x: 0, z: 0, r: r0 };
    this.to = this._nextCircle(this.cur, 0);
    this.timer = CONFIG.STORM.PHASES[0].wait;
  }

  _nextCircle(c, phase) {
    const P = CONFIG.STORM.PHASES[phase];
    const r = this.R * P.radiusFrac;
    const slack = Math.max(0, c.r - r) * 0.85;
    const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * slack;
    let x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
    // keep the circle on the island
    const off = Math.hypot(x, z), lim = Math.max(0, this.R * 0.85 - r);
    if (off > lim && off > 0) { x *= lim / off; z *= lim / off; }
    return { x, z, r };
  }

  get dps() { return CONFIG.STORM.PHASES[Math.min(this.phase, CONFIG.STORM.PHASES.length - 1)].dps; }

  inside(x, z) { return Math.hypot(x - this.cur.x, z - this.cur.z) <= this.cur.r; }

  /** Distance outside the safe circle (negative = inside). */
  outside(x, z) { return Math.hypot(x - this.cur.x, z - this.cur.z) - this.cur.r; }

  tick(dt, game) {
    const phases = CONFIG.STORM.PHASES;
    if (this.state !== 'final') {
      this.timer -= dt;
      if (this.state === 'waiting' && this.timer <= 0) {
        this.state = 'shrinking';
        this.timer = phases[this.phase].shrink;
        game.events.emit('stormShrink', { phase: this.phase });
      } else if (this.state === 'shrinking') {
        const t = Math.min(1, 1 - this.timer / phases[this.phase].shrink);
        this.cur.x = this.from.x + (this.to.x - this.from.x) * t;
        this.cur.z = this.from.z + (this.to.z - this.from.z) * t;
        this.cur.r = this.from.r + (this.to.r - this.from.r) * t;
        if (this.timer <= 0) {
          this.cur = { x: this.to.x, z: this.to.z, r: this.to.r };
          this.from = { x: this.cur.x, z: this.cur.z, r: this.cur.r };
          this.phase++;
          if (this.phase < phases.length) {
            this.to = this._nextCircle(this.cur, this.phase);
            this.state = 'waiting';
            this.timer = phases[this.phase].wait;
          } else {
            this.state = 'final';
            this.phase = phases.length - 1;
          }
          game.events.emit('stormPhase', { phase: this.phase });
        }
      }
    }
    // damage, once per second outside the circle
    for (const c of game.entities.values()) {
      if (c.type !== 'character' || !c.alive) continue;
      if (this.inside(c.pos.x, c.pos.z)) { c.stormAcc = 0; continue; }
      c.stormAcc = (c.stormAcc || 0) + dt;
      if (c.stormAcc >= 1) {
        c.stormAcc -= 1;
        Combat.applyDamage(game, c, this.dps, { kind: 'storm', ignoreShield: true });
      }
    }
  }

  serialize() { return { phase: this.phase, state: this.state, timer: this.timer, cur: this.cur, to: this.to }; }
}
