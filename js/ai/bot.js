/* ============================================================
 * Bot AI. A BotController produces an Intent every tick, exactly
 * like a human controller, so bots follow the same rules as players.
 *
 * Every THINK_INTERVAL it re-evaluates a small state machine:
 *   engage     an enemy is visible and we have a usable gun
 *   heal       hurt and holding healing items, no enemy close
 *   storm      outside (or about to be outside) the safe circle
 *   loot       no gun / no ammo, or something good is lying nearby
 *   roam       wander to random points inside the safe zone
 *   flee       badly hurt and unarmed with an enemy in sight
 *   drive      long trips use a nearby vehicle
 * and every tick it steers (detours around walls, jumps, avoids cliff
 * drops, gets unstuck, ramp-rushes up when blocked), aims (turn-rate
 * limited, with a re-rolled aim error, lead for moving targets and
 * bullet drop) and fires after a reaction delay.
 *
 * The fighting brain: it picks the enemy that matters (who is hurting
 * it, who is close, who is weak; it sticks with a target rather than
 * flicking between them), hears gunfire it cannot see and closes in on
 * it from the side, fires in bursts at range, swaps to a loaded gun
 * rather than reloading under fire, falls back to cover (a spot nearby
 * the enemy has no line to) to reload or heal and peeks out again,
 * presses when the enemy is weak or reloading, and its aim settles the
 * longer it tracks someone. Difficulty settings
 * (CONFIG.BOTS.DIFFICULTY) scale reaction time, aim error, turn rate,
 * view distance, how often they build cover and when they heal.
 * All randomness comes from the bot's own seeded Rng.
 * ============================================================ */
const BOT_PREF_RANGE = { shotgun: 5, smg: 12, pistol: 15, ar: 24, sniper: 55, rocket: 28 };

function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

class BotController {
  constructor(difficulty, seed) {
    this.difficulty = CONFIG.BOTS.DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.D = CONFIG.BOTS.DIFFICULTY[this.difficulty];
    this.rng = new Rng(seed >>> 0 || 1);
    this.state = 'roam';
    this.thinkT = this.rng.float(0, CONFIG.BOTS.THINK_INTERVAL);
    this.goal = null;
    this.goalKind = null;
    this.goalItem = null;
    this.goalSetAt = 0;
    this.target = null;
    this.vis = new Map();                 // enemy id -> { visible, at }
    this.lastSeen = null;                 // { pos, at }
    this.reactAt = Infinity;
    this.err = { yaw: 0, pitch: 0, until: 0, head: false };
    this.strafeDir = 1; this.strafeUntil = 0;
    this.nextShot = 0;
    this.interactCd = 0;
    this.buildCd = 0;
    this.queue = [];
    this.stuck = { x: 0, z: 0, at: 0, count: 0, detourUntil: 0, detourYaw: 0, rushUntil: 0 };
    this.chestScanAt = -10;
    this.chests = [];
    this.driveStuckAt = 0;
    this.reverseUntil = 0;
    this.goalKey = null;
    this.blacklist = new Map();           // unreachable loot goal key -> time it may be tried again
    this.dig = null;                      // { x, y, z, until } block being dug out of the way
    this.cover = null;                    // { pos, until, why } a spot out of the target's sight
    this.coverScanAt = -10;
    this.burstUntil = 0; this.pauseUntil = 0;
    this.trackSince = 0;                  // when we started tracking the current target (the aim settles)
    this.flank = 0;                       // which side we close in from while hunting (+1 / -1)
  }

  gauss() { return (this.rng.next() + this.rng.next() + this.rng.next() - 1.5) / 0.5; }

  // ------------------------------------------------------------------ main
  getIntent(game, ch) {
    const it = makeIntent();
    if (!ch.alive) return it;
    const dt = 1 / CONFIG.SIM_HZ;
    this.interactCd -= dt;
    this.buildCd -= dt;

    if (this.queue.length) {                                  // scripted multi-tick actions (building)
      Object.assign(it, this.queue.shift());
      return it;
    }
    if (ch.vehicle) { this.drive(game, ch, it, dt); return it; }
    if (this.dig && this.digStep(game, ch, it, dt)) return it;

    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = CONFIG.BOTS.THINK_INTERVAL; this.think(game, ch); }

    if (ch.gliding) {                                         // steer the glider towards the goal
      if (!this.goal) this.goal = new THREE.Vector3(0, 0, 0);
      this.moveTo(game, ch, it, this.goal, dt, 0);
      return it;
    }

    switch (this.state) {
      case 'engage': this.engage(game, ch, it, dt); break;
      case 'heal': this.heal(game, ch, it, dt); break;
      case 'flee': this.flee(game, ch, it, dt); break;
      default: this.travel(game, ch, it, dt); break;
    }
    if (ch.inWater) {
      // swim up, unless the thing we want is below us (dive for sunken loot)
      const g = this.goal;
      const dive = g && (this.goalKind === 'drop' || this.goalKind === 'chest') && g.y < ch.pos.y - 0.8 &&
        Math.hypot(g.x - ch.pos.x, g.z - ch.pos.z) < 3;
      it.jump = !dive;
    }
    return it;
  }

  /** Digs the block blocking our path with the best non-combat item we have. Returns true while digging. */
  digStep(game, ch, it, dt) {
    const d = this.dig, w = game.world;
    const b = w.getBlock(d.x, d.y, d.z);
    if (game.time > d.until || b <= 0 || !BlockTables.solid[b] || (this.target && this.canSee(game, ch, this.target))) { this.dig = null; return false; }
    // pick a slot: matching tool > any tool > empty hand > anything that isn't a gun or healing item
    const want = BLOCK_DEFS[b].tool;
    let slot = -1, score = -1;
    for (let i = 0; i < CONFIG.HOTBAR_SLOTS; i++) {
      const s = ch.inventory.get(i), itm = s && ITEMS[s.id];
      const sc = !s ? 1 : itm.tool ? (itm.tool.type === want ? 3 : 2) : itm.kind === 'weapon' || itm.kind === 'consumable' ? -1 : 0.5;
      if (sc > score) { score = sc; slot = i; }
    }
    if (slot >= 0 && slot !== ch.selectedSlot) { it.slot = slot; return true; }
    const e = ch.eyePos(new THREE.Vector3());
    const dx = d.x + 0.5 - e.x, dy = d.y + 0.5 - e.y, dz = d.z + 0.5 - e.z;
    this.look(ch, it, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), dt);
    it.fire = true;
    return true;
  }

  /** Is this loot goal on the give-up list? */
  blocked(game, key) { const t = this.blacklist.get(key); return t !== undefined && game.time < t; }

  // ------------------------------------------------------------------ perception + decisions
  enemies(game, ch) {
    const out = [];
    for (const e of game.entities.values()) {
      if (e.type !== 'character' || e === ch || !e.alive) continue;
      if (ch.team && e.team === ch.team) continue;
      const d = e.pos.distanceTo(ch.pos);
      if (d <= this.D.view) out.push({ e, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  canSee(game, ch, e) {
    const now = game.time, rec = this.vis.get(e.id);
    if (rec && now - rec.at < CONFIG.BOTS.LOS_INTERVAL) return rec.visible;
    const o = ch.eyePos(new THREE.Vector3());
    const t = new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z);
    const d = t.clone().sub(o), dist = d.length();
    d.divideScalar(dist);
    const hit = raycastBlocks(game.world, o, d, dist, { filter: BULLET_STOPS });
    let visible = !hit || hit.dist >= dist - 0.4;
    if (visible && e.vehicle) visible = true;
    this.vis.set(e.id, { visible, at: now });
    return visible;
  }

  usableWeapons(game, ch) {
    const out = [];
    for (let i = 0; i < CONFIG.HOTBAR_SLOTS; i++) {
      const s = ch.inventory.get(i), st = Weapons.of(s);
      if (!st) continue;
      const total = s.data.mag + Weapons.reserve(game, ch, st);
      if (total > 0) out.push({ slot: i, st, stack: s });
    }
    return out;
  }

  healSlot(ch) {
    let best = -1, score = 0;
    for (let i = 0; i < CONFIG.HOTBAR_SLOTS; i++) {
      const s = ch.inventory.get(i), c = s && ITEMS[s.id] && ITEMS[s.id].consumable;
      if (!c || !Consumables.canUse(ch, c)) continue;
      let v = 0;
      if (c.shield) v = ch.health > 60 ? 3 : 1;
      if (c.health && c.maxHealth > 75) v = ch.health < 50 ? 4 : 2;
      else if (c.health) v = ch.health < 60 ? 3 : 1.5;
      if (v > score) { score = v; best = i; }
    }
    return best;
  }

  think(game, ch) {
    const storm = game.match && game.match.storm;
    const guns = this.usableWeapons(game, ch);
    const enemies = this.enemies(game, ch);
    // the enemy that matters most: hurting us, close, weak, aiming our way; the current one keeps a little priority
    let target = null, best = -Infinity;
    for (const { e, d } of enemies) {
      if (!this.canSee(game, ch, e)) continue;
      let sc = 30 / (d + 5);
      if (ch.lastDamagedBy === e && game.time - ch.lastDamageTime < 3) sc += 2.5;
      if (e === this.target) sc += 1.2;
      sc += (1 - Math.min(1, ((e.health || 100) + (e.shield || 0)) / 150)) * 1.5;
      const to = ch.pos.clone().sub(e.pos), facing = (-Math.sin(e.yaw) * to.x - Math.cos(e.yaw) * to.z) / Math.max(1e-3, Math.hypot(to.x, to.z));
      if (facing > 0.95) sc += 0.8;                         // looking straight at us
      if (sc > best) { best = sc; target = e; }
    }
    // someone shooting us we can't see: turn to them
    if (!target && ch.lastDamagedBy && ch.lastDamagedBy !== ch && ch.lastDamagedBy.alive && game.time - ch.lastDamageTime < 1.5) {
      if (ch.lastDamagedBy.pos.distanceTo(ch.pos) < this.D.view * 1.3) target = ch.lastDamagedBy;
    }
    if (target !== this.target) {
      this.target = target;
      this.reactAt = game.time + this.D.reaction * this.rng.float(0.8, 1.25);
      this.trackSince = game.time;
      this.flank = this.rng.chance(0.5) ? 1 : -1;
    }
    if (target) this.lastSeen = { pos: target.pos.clone(), at: game.time };
    // gunfire we cannot see: go and look (unless we're busy staying alive)
    if (!target && (!this.lastSeen || game.time - this.lastSeen.at > 4) && ch.health > 45) {
      const heard = this.hearShot(game, ch);
      if (heard) this.lastSeen = { pos: heard, at: game.time - 2 };
    }

    const healSlot = this.healSlot(ch);
    const outsideNow = storm && storm.outside(ch.pos.x, ch.pos.z) > -2;
    const outsideNext = storm && storm.state !== 'final' && Math.hypot(ch.pos.x - storm.to.x, ch.pos.z - storm.to.z) > storm.to.r - 4 &&
      (storm.state === 'shrinking' || storm.timer < 20);

    let next;
    const visibleTarget = target && this.canSee(game, ch, target);
    if (visibleTarget && guns.length) next = 'engage';
    else if (visibleTarget && !guns.length && ch.health < 50) next = 'flee';
    else if (healSlot >= 0 && ch.health < this.D.healAt + 20 && (!target || target.pos.distanceTo(ch.pos) > 25) && !outsideNow) next = 'heal';
    else if (healSlot >= 0 && ch.shield < 50 && !target && !outsideNow && ITEMS[ch.inventory.get(healSlot).id].consumable.shield) next = 'heal';
    else if (outsideNow || outsideNext) next = 'storm';
    else if (this.lastSeen && game.time - this.lastSeen.at < 9 && guns.length && ch.health > 50) next = 'hunt';     // a fight nearby: go and take it
    else if (!guns.length || this.wantsLoot(game, ch, guns)) next = 'loot';
    else next = 'roam';
    if (next !== this.state) { this.state = next; this.goal = null; }

    // pick / refresh a movement goal
    if (this.state === 'storm') {
      const c = storm.state === 'waiting' || storm.state === 'shrinking' ? storm.to : storm.cur;
      this.goal = new THREE.Vector3(c.x, 0, c.z); this.goalKind = 'storm';
    } else if (this.state === 'loot') {
      this.pickLoot(game, ch, guns);
      if (!this.goal) { this.state = 'roam'; }
    } else if (this.state === 'hunt') {
      // come in from the side, not straight down the line they last saw us on
      const lp = this.lastSeen.pos, dx = lp.x - ch.pos.x, dz = lp.z - ch.pos.z, L = Math.hypot(dx, dz) || 1;
      const off = L > 14 ? Math.min(10, L * 0.35) * this.flank : 0;
      this.goal = new THREE.Vector3(lp.x - dz / L * off, lp.y, lp.z + dx / L * off); this.goalKind = 'hunt';
    }
    if (this.state === 'roam' && (!this.goal || this.goalKind !== 'roam' || game.time - this.goalSetAt > 25 || this.near(ch, this.goal, 4))) {
      this.goal = this.randomGoal(game, storm); this.goalKind = 'roam'; this.goalSetAt = game.time;
    }
    // long trips: take a vehicle if one is close
    if ((this.state === 'roam' || this.state === 'storm') && this.goal && !ch.vehicle &&
        Math.hypot(this.goal.x - ch.pos.x, this.goal.z - ch.pos.z) > 70) {
      const v = Vehicles.nearest(game, ch, 18);
      if (v && v.seats[0] === null && v.fuel > 5) { this.carGoal = this.goal.clone(); this.goal = v.pos.clone(); this.goalKind = 'vehicle'; this.goalItem = v; }
    }
  }

  near(ch, p, r) { return Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) < r; }

  /** The nearest gunshot by someone else in the last few seconds within earshot (the game's 'shot' events), or null. */
  hearShot(game, ch) {
    if (!game._botEars) {
      const ears = game._botEars = [];
      game.events.on('shot', (e) => { if (e && e.origin) { ears.push({ pos: e.origin.clone(), at: game.time, by: e.character }); if (ears.length > 64) ears.shift(); } });
    }
    let best = null, bd = CONFIG.BOTS.HEARING || 70;
    for (const n of game._botEars) {
      if (game.time - n.at > 3 || n.by === ch || (ch.team && n.by && n.by.team === ch.team)) continue;
      const d = Math.hypot(n.pos.x - ch.pos.x, n.pos.z - ch.pos.z);
      if (d < bd) { bd = d; best = n.pos; }
    }
    return best ? best.clone() : null;
  }

  /**
   * A spot within ~9 blocks, as far from `threat` as we are or farther, where we can stand and `threat` has no line to
   * our head: somewhere to reload or heal. Scanned at most a few times a second.
   */
  findCover(game, ch, threat) {
    if (game.time - this.coverScanAt < 0.6) return this.cover ? this.cover.pos : null;
    this.coverScanAt = game.time;
    const w = game.world, y0 = Math.floor(ch.pos.y + 0.01), te = threat.eyePos ? threat.eyePos(new THREE.Vector3()) : threat.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
    const dNow = Math.hypot(threat.pos.x - ch.pos.x, threat.pos.z - ch.pos.z);
    let best = null, bestScore = -Infinity;
    const dir = new THREE.Vector3();
    for (const r of [2.5, 4.5, 6.5, 9]) {
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2 + r, x = ch.pos.x + Math.cos(a) * r, z = ch.pos.z + Math.sin(a) * r;
        const bx = Math.floor(x), bz = Math.floor(z);
        let y = -1;
        for (const yy of [y0, y0 + 1, y0 - 1]) if (w.isSolid(bx, yy - 1, bz) && !w.isSolid(bx, yy, bz) && !w.isSolid(bx, yy + 1, bz)) { y = yy; break; }
        if (y < 0) continue;
        if (w.getBlock(bx, y, bz) === BLOCK.WATER) continue;
        const dT = Math.hypot(threat.pos.x - x, threat.pos.z - z);
        if (dT < dNow - 2) continue;                                       // not towards them
        const head = new THREE.Vector3(bx + 0.5, y + 1.5, bz + 0.5);
        dir.copy(head).sub(te); const L = dir.length(); dir.divideScalar(L);
        const hit = raycastBlocks(w, te, dir, L, { filter: BULLET_STOPS });
        if (!hit || hit.dist >= L - 0.6) continue;                         // they would still see us there
        const sc = -r * 0.6 - Math.abs(dT - dNow) * 0.05;
        if (sc > bestScore) { bestScore = sc; best = new THREE.Vector3(bx + 0.5, y, bz + 0.5); }
      }
    }
    return best;
  }

  randomGoal(game, storm) {
    const c = storm ? (storm.state === 'final' ? storm.cur : storm.to) : { x: 0, z: 0, r: CONFIG.ISLAND.RADIUS * 0.7 };
    const r = Math.max(4, c.r * 0.85);
    for (let i = 0; i < 20; i++) {
      const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * r;
      const x = Math.floor(c.x + Math.cos(a) * d), z = Math.floor(c.z + Math.sin(a) * d);
      const b = game.world.getBlock(x, CONFIG.SEA_LEVEL, z);
      if (b !== BLOCK.WATER) return new THREE.Vector3(x + 0.5, 0, z + 0.5);
    }
    return new THREE.Vector3(c.x, 0, c.z);
  }

  /** Is anything worth walking to nearby? (fills this.goal in pickLoot) */
  wantsLoot(game, ch, guns) {
    if (guns.length < 2) return true;
    let reserve = 0;
    for (const g of guns) reserve += Weapons.reserve(game, ch, g.st);
    if (reserve < 30) return true;
    if (this.healSlot(ch) < 0) return this.rng.chance(0.5);
    return false;
  }

  pickLoot(game, ch, guns) {
    const R = CONFIG.BOTS.LOOT_RADIUS;
    const ammoWanted = new Set(guns.map((g) => g.st.ammo));
    let best = null, bestScore = 0;
    for (const e of game.entities.values()) {
      if (e.type !== 'drop' || e.removed || this.blocked(game, 'd' + e.id)) continue;
      const d = e.pos.distanceTo(ch.pos);
      if (d > R) continue;
      const it = ITEMS[e.stack.id];
      let v = 0;
      if (it.kind === 'weapon') {
        const worst = guns.reduce((m, g) => Math.min(m, g.st.rarity), 9);
        v = guns.length < 3 ? 10 + e.stack.data.rarity * 2 : (e.stack.data.rarity > worst ? 6 : 0);
        if (ch.inventory.weaponCount() >= CONFIG.MAX_WEAPONS && ch.heldKind() !== 'weapon') v = 0;
      } else if (it.kind === 'ammo') v = ammoWanted.has(e.stack.id) ? 6 : 1;
      else if (it.kind === 'consumable') v = 4;
      else v = 1.5;
      if (ch.inventory.spaceFor(e.stack) <= 0 && it.kind !== 'weapon') v = 0;
      const score = v / (1 + d * 0.08);
      if (score > bestScore) { bestScore = score; best = { pos: e.pos.clone(), item: e, kind: 'drop', key: 'd' + e.id }; }
    }
    // chests (scanned every 2 s)
    if (game.time - this.chestScanAt > 2) {
      this.chestScanAt = game.time;
      this.chests = [];
      const w = game.world, px = Math.floor(ch.pos.x), py = Math.floor(ch.pos.y), pz = Math.floor(ch.pos.z);
      for (let x = px - 14; x <= px + 14; x++) for (let z = pz - 14; z <= pz + 14; z++) for (let y = py - 5; y <= py + 5; y++) {
        if (w.getBlock(x, y, z) === BLOCK.CHEST) this.chests.push(new THREE.Vector3(x + 0.5, y, z + 0.5));
      }
    }
    for (const c of this.chests) {
      if (game.world.getBlock(Math.floor(c.x), c.y, Math.floor(c.z)) !== BLOCK.CHEST) continue;
      if (this.blocked(game, 'c' + c.x + ',' + c.y + ',' + c.z)) continue;
      const d = c.distanceTo(ch.pos);
      const score = (guns.length < 2 ? 12 : 7) / (1 + d * 0.08);
      if (score > bestScore) { bestScore = score; best = { pos: c, kind: 'chest', key: 'c' + c.x + ',' + c.y + ',' + c.z }; }
    }
    if (best) {
      if (best.key !== this.goalKey) { this.goalKey = best.key; this.goalSetAt = game.time; }   // a new goal restarts its timer
      this.goal = best.pos; this.goalKind = best.kind; this.goalItem = best.item || null;
    } else { this.goal = null; this.goalKey = null; }
  }

  // ------------------------------------------------------------------ steering
  /** Turns the view towards a world yaw/pitch at the bot's turn rate. */
  look(ch, it, yaw, pitch, dt) {
    const max = this.D.turnRate * dt;
    it.lookDX = Math.max(-max, Math.min(max, wrapAngle(yaw - ch.yaw)));
    it.lookDY = Math.max(-max, Math.min(max, pitch - ch.pitch));
  }

  /** Converts a world-space move direction into moveX/moveZ relative to the current yaw. */
  moveDir(ch, it, dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    dx /= len; dz /= len;
    const s = Math.sin(ch.yaw), c = Math.cos(ch.yaw);
    it.moveZ = dx * -s + dz * -c;          // dot with forward (-sin, -cos)
    it.moveX = dx * c + dz * -s;           // dot with right (cos, -sin)
  }

  /** Walks towards p, handling obstacles, cliffs, water and getting stuck. faceMove: turn to walk direction. */
  moveTo(game, ch, it, p, dt, arrive = 1.2, faceMove = true, vert) {
    const dx = p.x - ch.pos.x, dz = p.z - ch.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < arrive) {
      if (vert === undefined || Math.abs(p.y - (ch.pos.y + 0.5)) < vert) return true;
      this._stuckCheck(game, ch, it, Math.atan2(-dx, -dz));     // above / below it: keep stuck detection running
      return false;
    }
    let yaw = Math.atan2(-dx, -dz);
    const st = this.stuck, now = game.time;
    if (now < st.detourUntil) yaw += st.detourYaw;

    // obstacle / cliff probes along the intended direction
    const w = game.world, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ax = Math.floor(ch.pos.x + fx * 0.9), az = Math.floor(ch.pos.z + fz * 0.9), fy = Math.floor(ch.pos.y + 0.01);
    const wall2 = w.isSolid(ax, fy + 1, az) && w.isSolid(ax, fy + 2, az);
    const lowBlock = w.isSolid(ax, fy, az) || w.isSolid(ax, fy + 1, az);
    let drop = 0;
    if (ch.onGround && !ch.gliding) {
      const cx = Math.floor(ch.pos.x + fx * 2), cz = Math.floor(ch.pos.z + fz * 2);
      for (let y = fy - 1; y > fy - 12 && y >= 0; y--) { drop++; const b = w.getBlock(cx, y, cz); if (b !== BLOCK.AIR) break; }
    }
    if ((wall2 || (drop > 6 && this.state !== 'storm')) && now >= st.detourUntil) {
      st.detourYaw = (this.rng.chance(0.5) ? 1 : -1) * this.rng.float(0.9, 1.6);
      st.detourUntil = now + this.rng.float(0.6, 1.2);
    }
    if (faceMove) this.look(ch, it, yaw, 0, dt);
    this.moveDir(ch, it, fx, fz);
    if (dist > 6) it.sprint = true;
    if (lowBlock && ch.onGround && Math.hypot(ch.vel.x, ch.vel.z) < 1.5) it.jump = true;

    this._stuckCheck(game, ch, it, Math.atan2(-dx, -dz));
    return false;
  }

  /**
   * Stuck handling: detour first, then dig through the block in the way,
   * then ramp-rush over it, finally pick a different goal.
   */
  _stuckCheck(game, ch, it, yaw) {
    const st = this.stuck, now = game.time;
    if (now - st.at > CONFIG.BOTS.STUCK_TIME) {
      const moved = Math.hypot(ch.pos.x - st.x, ch.pos.z - st.z) + Math.abs(ch.pos.y - (st.y || 0));
      st.count = moved < 0.8 && !ch.using ? st.count + 1 : 0;
      st.x = ch.pos.x; st.z = ch.pos.z; st.y = ch.pos.y; st.at = now;
      if (st.count >= 1) { st.detourYaw = (this.rng.chance(0.5) ? 1 : -1) * this.rng.float(1.2, 2.4); st.detourUntil = now + 1.2; }
      if (st.count >= 2 && !this.dig) {
        // dig: the first breakable block around head/feet height in the way (or overhead)
        const w = game.world, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const bx = Math.floor(ch.pos.x + fx * 0.9), bz = Math.floor(ch.pos.z + fz * 0.9), fy = Math.floor(ch.pos.y + 0.01);
        for (const [x, y, z] of [[bx, fy + 1, bz], [bx, fy, bz], [Math.floor(ch.pos.x), fy + 2, Math.floor(ch.pos.z)]]) {
          const b = w.getBlock(x, y, z);
          if (b > 0 && BlockTables.solid[b] && BLOCK_DEFS[b].hardness >= 0) { this.dig = { x, y, z, until: now + 4 }; break; }
        }
      }
      if (st.count >= 4 && Building.canAfford(game, ch, ch.build.material)) st.rushUntil = now + 1.2;
      if (st.count >= 7) {
        if (this.goalKey) this.blacklist.set(this.goalKey, now + 60);
        this.goal = this.randomGoal(game, game.match && game.match.storm); this.goalKind = 'roam'; this.goalKey = null; st.count = 0;
      }
    }
    if (now < st.rushUntil) it.rampRush = true;
  }

  travel(game, ch, it, dt) {
    if (!this.goal) { this.goal = this.randomGoal(game, game.match && game.match.storm); this.goalKind = 'roam'; }
    // give up on loot we can't reach (sunk out of reach, walled in...) and try something else for a while
    if ((this.goalKind === 'drop' || this.goalKind === 'chest') && this.goalKey && game.time - this.goalSetAt > 15) {
      this.blacklist.set(this.goalKey, game.time + 60);
      this.goal = null; this.goalKey = null; this.thinkT = 0;
      return;
    }
    const arrive = this.goalKind === 'drop' ? 0.6 : this.goalKind === 'chest' || this.goalKind === 'vehicle' ? 1.8 : 2.5;
    const vert = this.goalKind === 'drop' ? 1.6 : this.goalKind === 'chest' ? 2.5 : undefined;
    const there = this.moveTo(game, ch, it, this.goal, dt, arrive, true, vert);
    // turn towards someone shooting at us even while travelling
    if (this.target && this.target.alive) {
      const d = this.target.pos.clone().sub(ch.pos);
      this.look(ch, it, Math.atan2(-d.x, -d.z), 0, dt);
      this.moveDir(ch, it, this.goal.x - ch.pos.x, this.goal.z - ch.pos.z);
    }
    if (!there) return;
    if (this.goalKind === 'chest' && this.interactCd <= 0) {
      this.look(ch, it, Math.atan2(-(this.goal.x - ch.pos.x), -(this.goal.z - ch.pos.z)), -0.4, dt);
      const t = ch.target;
      if (t && t.block === BLOCK.CHEST) { it.interact = true; this.interactCd = 0.5; this.goal = null; }
      else if (this.rng.chance(0.05)) this.goal = null;
    } else if (this.goalKind === 'drop') {
      if (this.goalItem && this.goalItem.manual && this.interactCd <= 0) { it.interact = true; this.interactCd = 0.5; }
      if (!this.goalItem || this.goalItem.removed) this.goal = null;
    } else if (this.goalKind === 'vehicle') {
      if (this.interactCd <= 0) { it.interact = true; this.interactCd = 0.6; }
    } else this.goal = null;
  }

  // ------------------------------------------------------------------ fighting
  engage(game, ch, it, dt) {
    const t = this.target;
    if (!t || !t.alive) { this.state = 'roam'; this.cover = null; return; }
    const guns = this.usableWeapons(game, ch);
    if (!guns.length) { this.state = 'loot'; return; }
    const dist = t.pos.distanceTo(ch.pos);
    const visible = this.canSee(game, ch, t);

    // weapon choice for this range; an empty gun loses to a loaded one (swapping is faster than reloading)
    let best = null, bestScore = -Infinity;
    for (const g of guns) {
      const c = g.st.cls;
      let s = { shotgun: dist < 9 ? 6 : dist < 15 ? 2 : 0.2, smg: dist < 20 ? 4.5 : dist < 35 ? 2 : 0.5, ar: dist < 120 ? 3.5 : 1,
        pistol: dist < 45 ? 2 : 0.6, sniper: dist > 35 ? 5.5 : 0.8, rocket: (t.vehicle || dist > 10) && dist < 70 ? 3 : 0.1 }[c];
      s += g.st.rarity * 0.3;
      if (g.stack.data.mag === 0) s -= 4;
      if (s > bestScore) { bestScore = s; best = g; }
    }
    if (best.slot !== ch.selectedSlot && !ch.reload) { it.slot = best.slot; return; }
    const st = Weapons.of(ch.heldStack()) || best.st;
    const held = ch.heldStack();
    const empty = held && held.data && held.data.mag === 0;

    // fall back to cover to reload or heal; come out again when ready
    const hurt = ch.health + (ch.shield || 0) * 0.5 < 45 + this.D.healAt * 0.2;
    const needCover = (empty || ch.reload || (hurt && this.healSlot(ch) >= 0)) && dist > 4;
    if (needCover) {
      if (!this.cover || game.time > this.cover.until) {
        const c = this.findCover(game, ch, t);
        this.cover = c ? { pos: c, until: game.time + 6, why: empty || ch.reload ? 'reload' : 'heal' } : null;
      }
    } else if (this.cover && !ch.reload && !ch.using) this.cover = null;
    if (empty && !ch.reload) it.reload = true;
    if (this.cover) {
      const there = this.moveTo(game, ch, it, this.cover.pos, dt, 0.7, false);
      const d = t.pos.clone().sub(ch.pos);
      this.look(ch, it, Math.atan2(-d.x, -d.z), 0, dt);              // keep watching where they are
      if (there && this.cover.why === 'heal' && !ch.reload) {
        const hs = this.healSlot(ch);
        if (hs >= 0) { if (ch.selectedSlot !== hs) it.slot = hs; else if (!ch.using) { it.fire = true; it.firePressed = true; } }
        else this.cover = null;
      }
      return;
    }

    // aim: chest (sometimes head), lead moving targets, compensate drop; the error shrinks the longer we track them
    if (game.time >= this.err.until) {
      const settle = Math.max(0.45, 1 - (game.time - this.trackSince) * 0.12);
      const k = this.D.aimError * settle * (1 + Math.hypot(t.vel.x, t.vel.z) * 0.12) * (ch.onGround ? 1 : 1.5);
      this.err.yaw = this.gauss() * k; this.err.pitch = this.gauss() * k * 0.6;
      this.err.until = game.time + this.rng.float(0.3, 0.6);
      this.err.head = this.rng.chance(this.D.headshot);
    }
    const eye = ch.eyePos(new THREE.Vector3());
    const aim = new THREE.Vector3(t.pos.x, t.pos.y + (this.err.head ? 1.62 : 1.1), t.pos.z);
    if (st.projectile) {
      const tt = dist / st.projectile.speed;
      aim.addScaledVector(t.vel, tt);
      aim.y += 0.5 * st.projectile.gravity * tt * tt;
    } else aim.addScaledVector(t.vel, 0.06);                           // a hair of lead for the shot's travel and our reaction
    const d = aim.sub(eye);
    const yaw = Math.atan2(-d.x, -d.z) + this.err.yaw;
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) + this.err.pitch;
    this.look(ch, it, yaw, pitch, dt);
    const off = Math.hypot(wrapAngle(yaw - ch.yaw - it.lookDX), pitch - ch.pitch - it.lookDY);

    // fire when on target after our reaction time; automatic weapons in bursts at range (they spray otherwise)
    const tol = Math.atan2(0.9, dist) + 0.02;
    if (visible && game.time >= this.reactAt && off < tol && !ch.reload) {
      if (st.auto) {
        if (dist < 18 || game.time < this.burstUntil) it.fire = true;
        else if (game.time >= this.pauseUntil) { this.burstUntil = game.time + this.rng.float(0.2, 0.4); this.pauseUntil = this.burstUntil + this.rng.float(0.15, 0.3); it.fire = true; }
      } else if (game.time >= this.nextShot) {
        it.fire = true; it.firePressed = true;
        this.nextShot = game.time + st.interval * this.rng.float(1.02, 1.3);
      }
    }
    it.aim = dist > 16 && st.cls !== 'shotgun';

    // movement: hold our range; push when they're weak or reloading, back off when we are; strafe with jitter
    const pref = BOT_PREF_RANGE[st.cls] || 20;
    const theyWeak = ((t.health || 100) + (t.shield || 0)) < 45 || !!t.reload;
    const weWeak = ch.health < 40;
    let mx = 0, mz = 0;
    const tx = (t.pos.x - ch.pos.x) / Math.max(dist, 1e-3), tz = (t.pos.z - ch.pos.z) / Math.max(dist, 1e-3);
    if ((dist > pref + 6 || !visible || theyWeak) && !weWeak) { mx += tx; mz += tz; if (theyWeak) it.sprint = true; }
    else if (dist < pref - 4 || weWeak) { mx -= tx; mz -= tz; }
    if (game.time >= this.strafeUntil) { this.strafeDir = this.rng.chance(0.5) ? 1 : -1; this.strafeUntil = game.time + this.rng.float(0.25, 0.9); }
    if (this.rng.next() < this.D.strafe + 0.25) { mx += -tz * this.strafeDir; mz += tx * this.strafeDir; }
    if (!visible && this.lastSeen) { mx = this.lastSeen.pos.x - ch.pos.x; mz = this.lastSeen.pos.z - ch.pos.z; }
    this.moveDir(ch, it, mx, mz);
    if (this.difficulty !== 'easy' && ch.onGround && visible && this.rng.chance(this.difficulty === 'hard' ? 0.03 : 0.01)) it.jump = true;

    // build a wall towards an attacker when hit in the open
    if (game.time - ch.lastDamageTime < 0.1 && ch.lastDamagedBy === t && this.buildCd <= 0 &&
        this.rng.chance(this.D.buildChance) && Building.canAfford(game, ch, 'wood')) {
      this.buildCd = 3;
      this.queue.push({ buildPiece: 'wall', lookDX: 0 }, { fire: true, firePressed: true }, { toggleBuild: true });
    }
  }

  heal(game, ch, it, dt) {
    const slot = this.healSlot(ch);
    if (slot < 0) { this.state = 'roam'; return; }
    if (ch.selectedSlot !== slot) { it.slot = slot; return; }
    if (!ch.using) { it.firePressed = true; it.fire = true; }
    // shuffle a little while healing
    if (this.target && this.target.alive) {
      const d = this.target.pos.clone().sub(ch.pos);
      this.moveDir(ch, it, -d.x, -d.z);
    }
  }

  flee(game, ch, it, dt) {
    const t = this.target;
    if (!t) { this.state = 'roam'; return; }
    const away = new THREE.Vector3(ch.pos.x * 2 - t.pos.x, 0, ch.pos.z * 2 - t.pos.z);
    this.moveTo(game, ch, it, away, dt, 0.5);
    it.sprint = true;
  }

  // ------------------------------------------------------------------ driving
  drive(game, ch, it, dt) {
    const v = ch.vehicle;
    if (ch.vehicleSeat !== 'driver') { it.interact = true; return; }       // bots don't ride along
    const goal = this.carGoal || this.goal;
    const enemyClose = this.enemies(game, ch).some(({ e, d }) => d < 30 && this.canSee(game, ch, e));
    if (!goal || this.near(ch, goal, 14) || v.fuel <= 0 || enemyClose) {
      if (this.interactCd <= 0) { it.interact = true; this.interactCd = 1; this.carGoal = null; this.goal = null; }
      return;
    }
    const bearing = Math.atan2(-(goal.x - v.pos.x), -(goal.z - v.pos.z));
    const diff = wrapAngle(bearing - v.yaw);
    if (game.time < this.reverseUntil) { it.moveZ = -1; it.moveX = Math.sign(diff); return; }
    it.moveZ = Math.abs(diff) > 2 ? 0.5 : 1;
    it.moveX = -Math.max(-1, Math.min(1, diff * 1.8));
    it.sprint = Math.abs(diff) < 0.3 && v.fuel > v.spec.fuel * 0.3;
    this.look(ch, it, bearing, 0, dt);
    if (v.speed < 1) {
      if (!this.driveStuckAt) this.driveStuckAt = game.time;
      if (game.time - this.driveStuckAt > 1.5) { this.reverseUntil = game.time + 1; this.driveStuckAt = 0; }
    } else this.driveStuckAt = 0;
  }
}
