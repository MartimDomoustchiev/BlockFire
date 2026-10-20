/* ============================================================
 * Damage model, hit detection and explosions.
 *
 *  - Shield absorbs damage first, then health. Shield only comes back
 *    through consumables. Health doesn't regenerate either, except for
 *    players in story mode (Character._regen).
 *  - Characters have two hitboxes: head and body. A ray is tested
 *    against both; the nearest hit wins and the head multiplies damage.
 *  - Bullets are stopped by solid blocks but pass through leaves;
 *    glass shatters. Building pieces (stage 4) take damage through
 *    Combat.hitBlock.
 *  - Rockets explode: splash damage with linear falloff (self damage
 *    included), knockback, and a sphere of destroyed blocks.
 * ============================================================ */
const BULLET_STOPS = (b) => BlockTables.solid[b] === 1 && b !== BLOCK.LEAVES;

const Combat = {
  /*
   * Lag compensation (online play): while a remote player's shot is being
   * resolved, rewindTo holds the game time that player was seeing, and
   * characters are tested where they were then (from Character.hist).
   */
  rewindTo: null,

  /** Position of a character at game time t (from its recent history), or its current one. */
  posAt(c, t, out) {
    const h = c.hist;
    if (t === null || !h || !h.length || t >= h[h.length - 1].t) return out.copy(c.pos);
    if (t <= h[0].t) return out.set(h[0].x, h[0].y, h[0].z);
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (a.t <= t) { const k = (t - a.t) / Math.max(1e-6, b.t - a.t); return out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
    }
    return out.copy(c.pos);
  },

  /** Slab test of a ray against an AABB. Returns entry distance or -1. */
  rayBox(o, d, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
    let t0 = 0, t1 = maxDist;
    const axes = [[o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ]];
    for (const [oo, dd, lo, hi] of axes) {
      if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) return -1; continue; }
      let a = (lo - oo) / dd, b = (hi - oo) / dd;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return -1;
    }
    return t0;
  },

  /** Nearest vehicle / barrel hit along a ray: { target, dist } or null. Skips the shooter's own vehicle. */
  rayProps(game, o, d, maxDist, shooter) {
    let best = null;
    const own = shooter && shooter.vehicle;
    for (const e of game.entities.values()) {
      if ((e.type !== 'vehicle' && e.type !== 'barrel') || !e.alive || e === own) continue;
      const t = e.rayHit(o, d, maxDist);
      if (t >= 0 && (!best || t < best.dist)) best = { target: e, dist: t };
    }
    return best;
  },

  /** Nearest character hit along a ray: { target, part: 'head'|'body', dist } or null. */
  rayCharacters(game, o, d, maxDist, ignore) {
    const H = CONFIG.HITBOX;
    let best = null;
    const ownVehicle = ignore && ignore.vehicle;
    for (const c of game.characters()) {
      if (!c.alive || c === ignore) continue;
      if (ownVehicle && c.vehicle === ownVehicle) continue;          // fellow passengers
      const p = this.rewindTo === null ? c.pos : this.posAt(c, this.rewindTo, Combat._rw);
      // cheap reject: distance from the ray to the character's centre
      const cx = p.x - o.x, cy = p.y + 0.9 - o.y, cz = p.z - o.z;
      const along = cx * d.x + cy * d.y + cz * d.z;
      if (along < -1.5 || along > maxDist + 1.5) continue;
      if (cx * cx + cy * cy + cz * cz - along * along > 4) continue;
      const head = this.rayBox(o, d, p.x - H.HEAD_HALF, p.y + H.HEAD_BOTTOM, p.z - H.HEAD_HALF,
        p.x + H.HEAD_HALF, p.y + H.HEAD_TOP, p.z + H.HEAD_HALF, maxDist);
      const body = this.rayBox(o, d, p.x - H.BODY_HALF, p.y, p.z - H.BODY_HALF,
        p.x + H.BODY_HALF, p.y + H.BODY_TOP, p.z + H.BODY_HALF, maxDist);
      let part = null, dist = Infinity;
      if (head >= 0) { part = 'head'; dist = head; }
      if (body >= 0 && body < dist) { part = 'body'; dist = body; }
      if (part && (!best || dist < best.dist)) best = { target: c, part, dist };
    }
    return best;
  },

  /** Damage multiplier for distance (hitscan falloff). */
  falloff(st, dist) {
    if (!st.falloff) return 1;
    const [a, b, min] = st.falloff;
    if (dist <= a) return 1;
    if (dist >= b) return min;
    return 1 - (1 - min) * (dist - a) / (b - a);
  },

  /** One hitscan ray. Returns the end point (for tracers). */
  hitscan(game, shooter, o, d, st) {
    const hb = raycastBlocks(game.world, o, d, st.range, { filter: BULLET_STOPS });
    let blockDist = hb ? hb.dist : st.range;
    const hp = this.rayProps(game, o, d, blockDist, shooter);
    if (hp) blockDist = hp.dist;
    const hc = this.rayCharacters(game, o, d, blockDist, shooter);
    if (!hc && hp) {
      const end = o.clone().addScaledVector(d, hp.dist);
      hp.target.damage(game, st.damage * this.falloff(st, hp.dist), shooter, 'bullet');
      game.events.emit('impact', { x: end.x, y: end.y, z: end.z, block: BLOCK.BUILD_METAL, nx: -d.x, ny: -d.y, nz: -d.z });
      return end;
    }
    if (hc) {
      const dmg = st.damage * this.falloff(st, hc.dist) * (hc.part === 'head' ? st.headMult : 1);
      this.applyDamage(game, hc.target, dmg, { attacker: shooter, headshot: hc.part === 'head', cls: st.cls });
      return o.clone().addScaledVector(d, hc.dist);
    }
    if (hb) {
      const end = o.clone().addScaledVector(d, hb.dist);
      this.hitBlock(game, hb, st.damage * this.falloff(st, hb.dist), shooter, end);
      return end;
    }
    return o.clone().addScaledVector(d, st.range);
  },

  /** A bullet hit a block. Glass shatters; build pieces take damage (stage 4 hook). */
  hitBlock(game, hit, damage, attacker, point) {
    game.events.emit('impact', { x: point.x, y: point.y, z: point.z, block: hit.block, nx: hit.nx, ny: hit.ny, nz: hit.nz });
    if (hit.block === BLOCK.GLASS) game.world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
    else if (typeof Building !== 'undefined') Building.damageBlock(game, hit.x, hit.y, hit.z, damage, attacker);
  },

  /**
   * Applies damage: shield first, then health. Returns the damage actually dealt.
   * opts: { attacker, headshot, cls, kind: 'bullet'|'explosion'|'storm'|'fall'|'vehicle' }
   */
  applyDamage(game, target, amount, opts = {}) {
    if (!target || !target.alive || !(amount > 0) || !Number.isFinite(amount)) return 0;
    const attacker = opts.attacker || null;
    if (attacker && attacker !== target && attacker.team && attacker.team === target.team && !game.rules.friendlyFire) return 0;
    const toShield = opts.ignoreShield ? 0 : Math.min(target.shield, amount);
    target.shield -= toShield;
    const toHealth = Math.min(target.health, amount - toShield);
    target.health -= toHealth;
    const dealt = toShield + toHealth;
    target.lastDamagedBy = attacker;
    target.lastDamageTime = game.time;
    if (attacker && attacker !== target) attacker.stats.damageDealt += dealt;
    game.events.emit('damage', {
      target, attacker, amount: dealt, shield: toShield, health: toHealth, headshot: !!opts.headshot,
      kind: opts.kind || 'bullet', x: target.pos.x, y: target.pos.y + (opts.headshot ? 1.7 : 1.1), z: target.pos.z,
    });
    if (target.health <= 1e-6) this.kill(game, target, attacker, opts);
    return dealt;
  },

  kill(game, victim, killer, opts = {}) {
    victim.health = 0;
    victim.alive = false;
    victim.reload = null;
    victim.using = null;
    victim.stats.deathTime = game.time;
    if (victim.vehicle) Vehicles.exit(game, victim, true);           // free the seat (and the car)
    const credit = killer && killer !== victim ? killer : (victim.lastDamagedBy !== victim ? victim.lastDamagedBy : null);
    if (credit) credit.stats.kills++;
    // spill the inventory (free build keeps it: materials there are endless anyway; story NPCs carry nothing worth taking)
    if (!game.rules.keepInventory && !victim.npc) {
      for (let i = 0; i < victim.inventory.size; i++) {
        const s = victim.inventory.get(i);
        if (s) ItemDrop.pop(game, s, victim.pos.x, victim.pos.y + 0.8, victim.pos.z);
      }
      victim.inventory.clear();
    }
    if (game.rules.respawn && !victim.npc) victim.respawnAt = game.time + (victim.respawnDelay || CONFIG.HEALTH.RESPAWN_TIME);
    if (victim.npc) { victim.corpse = true; victim.corpseAt = game.time; }             // story: the body stays where it fell
    game.events.emit('kill', { victim, killer: credit, cls: opts.cls || null, headshot: !!opts.headshot, kind: opts.kind || 'bullet' });
  },

  /** Rocket / barrel explosion at (x,y,z). st: { damage, splash, blockRadius }. */
  explode(game, x, y, z, st, owner) {
    const R = st.splash;
    for (const c of game.characters()) {
      if (!c.alive) continue;
      const dx = c.pos.x - x, dy = c.pos.y + 0.9 - y, dz = c.pos.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= R) continue;
      const k = 1 - d / R;
      const len = d > 1e-6 ? d : 1, K = CONFIG.COMBAT.EXPLOSION_KNOCKBACK * k;
      c.push(dx / len * K, K * 0.6, dz / len * K);
      this.applyDamage(game, c, st.damage * k, { attacker: owner, cls: st.cls, kind: 'explosion' });
    }
    // vehicles and barrels
    for (const e of game.entities.values()) {
      if ((e.type !== 'vehicle' && e.type !== 'barrel') || !e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.y + 0.6 - y, e.pos.z - z);
      if (d < R + 1) e.damage(game, st.damage * Math.min(1, 1 - (d - 1) / R) * 1.5, owner, 'explosion');
    }
    // blocks
    const br = st.blockRadius || 0, w = game.world, list = [];
    const r2 = br * br;
    for (let bx = Math.floor(x - br); bx <= Math.floor(x + br); bx++) {
      for (let by = Math.max(0, Math.floor(y - br)); by <= Math.min(CONFIG.CHUNK_HEIGHT - 1, Math.floor(y + br)); by++) {
        for (let bz = Math.floor(z - br); bz <= Math.floor(z + br); bz++) {
          const ddx = bx + 0.5 - x, ddy = by + 0.5 - y, ddz = bz + 0.5 - z;
          if (ddx * ddx + ddy * ddy + ddz * ddz > r2) continue;
          const b = w.getBlock(bx, by, bz);
          if (b <= 0 || BLOCK_DEFS[b].hardness < 0 || BlockTables.liquid[b]) continue;
          const be = w.getBlockEntity(bx, by, bz);
          if (be) {
            w.setBlockEntity(bx, by, bz, null);
            if (be.type === 'furnace') for (const s of Furnace.contents(be)) ItemDrop.pop(game, s, bx + 0.5, by + 0.5, bz + 0.5);
          }
          if (typeof Building !== 'undefined') Building.onBlockDestroyed(game, bx, by, bz);
          list.push([bx, by, bz, BLOCK.AIR]);
        }
      }
    }
    if (list.length) w.setBlocks(list);
    game.events.emit('explosion', { x, y, z, radius: R, owner });
  },
};

Combat._rw = new THREE.Vector3();
