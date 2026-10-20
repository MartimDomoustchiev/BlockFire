/* ============================================================
 * Story-mode people. Like bots, NPCs are Characters whose
 * controller produces Intents, so they obey the same physics and
 * combat rules as players (they even climb). Steering comes from
 * BotController (detours, unsticking, aiming helpers).
 *
 *   GuardController     idle at a post / patrol a route ->
 *                       suspicious -> combat -> search -> return;
 *                       investigates noises and bodies, calls for help
 *   VillagerController  wanders between the square's spots, chats,
 *                       runs and screams when violence breaks out
 *   AllyController      mission people: stand, follow a player, or
 *                       walk a route (and glance back now and then)
 * ============================================================ */
class NpcController extends BotController {
  constructor(seed, opts = {}) {
    super('normal', seed);
    this.post = opts.post || null;              // { x, y, z, yaw }
    this.route = opts.route || null;            // [{ x, y, z }] patrol loop
    this.routeI = 0;
    this.waitUntil = 0;
    this.phase = (seed % 97) / 15;
  }

  /** BotController's "go somewhere else" when stuck: somewhere near home instead of the battle island. */
  randomGoal(game) {
    const h = this.post || (this.route && this.route[0]) || { x: 0, z: 0 };
    const a = this.rng.next() * Math.PI * 2, d = 2 + this.rng.next() * 5;
    return new THREE.Vector3(h.x + Math.cos(a) * d, 0, h.z + Math.sin(a) * d);
  }

  /**
   * Walk to p at `pace` (fraction of walking speed; >= 1 runs) along an A* path (nav.js): around walls,
   * wells and tents, through doors. Re-plans when the goal moves or we get stuck. With no walkable route
   * (a player up on a roof...) it heads straight there, climbing whatever is in the way.
   * True once within `arrive` of p - or once p has proven unreachable (this.unreachable is then set).
   */
  walk(game, ch, it, p, dt, pace, arrive = 1.2) {
    const N = this.nav || (this.nav = { goal: null, path: null, i: 0, next: 0, fails: 0, chk: 0, cx: 0, cz: 0, stuck: 0, direct: 0 });
    const dx = p.x - ch.pos.x, dz = p.z - ch.pos.z, dist = Math.hypot(dx, dz);
    this.unreachable = false;
    if (dist < arrive && (p.y === undefined || Math.abs(p.y - ch.pos.y) < 2.5)) { N.path = null; N.goal = null; return true; }
    const now = game.time;
    // (re)plan: new goal, goal moved, path used up, or stuck
    const moved = !N.goal || Math.hypot(N.goal.x - p.x, N.goal.z - p.z) > Math.max(1.5, dist * 0.25);
    if ((moved || !N.path || N.stuck >= 1) && now >= N.next && now >= N.direct && ch.onGround && Nav.allowed(game)) {
      N.goal = { x: p.x, y: p.y !== undefined ? p.y : ch.pos.y, z: p.z };
      N.path = Nav.find(game, ch.pos, N.goal, { near: Math.max(0.7, arrive - 0.3), partial: dist > 30 });
      N.i = 0;
      if (N.path) { N.fails = 0; N.next = now + 0.4; }
      else {
        N.fails++;
        N.next = now + Math.min(4, 0.6 * N.fails);
        if (N.fails >= 2) { N.direct = now + 2.5; N.directs = (N.directs || 0) + 1; N.noPath = (N.noPath || 0) + 1; }   // try the straight line (and climbing) for a while
      }
    }
    if (N.fails >= 4 && !N.path) { this.unreachable = true; N.fails = 0; return true; }
    // steer: along the path, or straight at the goal when there is none
    let tx = p.x, tz = p.z, ty = p.y;
    if (N.path && now >= N.direct) {
      while (N.i < N.path.length - 1 && Math.hypot(N.path[N.i].x - ch.pos.x, N.path[N.i].z - ch.pos.z) < 0.55) N.i++;
      const w = N.path[N.i];
      tx = w.x; tz = w.z; ty = w.y;
      if (N.i === N.path.length - 1 && Math.hypot(tx - ch.pos.x, tz - ch.pos.z) < 0.55) N.path = null;      // end of a partial path
    } else if (!N.path || now < N.direct) {
      const there = this.moveTo(game, ch, it, p, dt, arrive);
      if (!there) { it.sprint = pace >= 1; if (pace < 1) { it.moveX *= pace; it.moveZ *= pace; } }
      return there;
    }
    // snagged on a corner (pushing but not moving): step back to the middle of our cell first
    if (now < (N.recentre || 0)) { tx = Math.floor(ch.pos.x) + 0.5; tz = Math.floor(ch.pos.z) + 0.5; }
    else if (ch.onGround && Math.hypot(ch.vel.x, ch.vel.z) < 0.25 && (this.lastWish || 0) > 0.3) {
      N.slow = (N.slow || 0) + dt;
      if (N.slow > 0.35) { N.recentre = now + 0.3; N.slow = 0; }
    } else N.slow = 0;
    let sx = tx - ch.pos.x, sz = tz - ch.pos.z;
    this.lastWish = Math.hypot(sx, sz) > 0.1 ? 1 : 0;
    if (sx * sx + sz * sz > 1e-4) {
      this.look(ch, it, Math.atan2(-sx, -sz), 0, dt);
      // keep a little room from other people instead of walking into them - a nudge, never a stop
      const L = Math.hypot(sx, sz), fx = sx / L, fz = sz / L;
      let px = 0, pz = 0;
      for (const o of game.characters()) {
        if (o === ch || !o.alive || !o.npc) continue;
        const ox = ch.pos.x - o.pos.x, oz = ch.pos.z - o.pos.z, d2 = ox * ox + oz * oz;
        if (d2 > 0.81 || d2 < 1e-6 || Math.abs(o.pos.y - ch.pos.y) > 1.5) continue;
        const d = Math.sqrt(d2), k = (0.9 - d) / 0.9 * 0.8;
        px += ox / d * k; pz += oz / d * k;
      }
      const pl = Math.hypot(px, pz);
      if (pl > 0.6) { px *= 0.6 / pl; pz *= 0.6 / pl; }
      sx = fx + px; sz = fz + pz;
      const ahead = sx * fx + sz * fz;
      if (ahead < 0.5) { sx += fx * (0.5 - ahead); sz += fz * (0.5 - ahead); }
      this.moveDir(ch, it, sx, sz);
      const k = Math.min(1, pace);
      it.moveX *= k; it.moveZ *= k;
      it.sprint = pace >= 1;
    }
    if (ch.inWater) it.jump = true;
    else if (ty !== undefined && ty > ch.pos.y + 0.5 && ch.onGround && Math.hypot(sx, sz) < 1.3 && Math.hypot(ch.vel.x, ch.vel.z) < 0.8) it.jump = true;
    // stuck: barely moved for a second while trying to
    if (now >= N.chk) {
      if (Math.hypot(ch.pos.x - N.cx, ch.pos.z - N.cz) < 0.3) N.stuck++;
      else N.stuck = 0;
      N.cx = ch.pos.x; N.cz = ch.pos.z; N.chk = now + 1;
      if (N.stuck >= 3) { N.direct = now + 2; N.stuck = 0; N.path = null; N.directs = (N.directs || 0) + 1; N.stucks = (N.stucks || 0) + 1; }
    }
    return false;
  }

  faceTo(ch, it, p, dt) {
    const dx = p.x - ch.pos.x, dz = p.z - ch.pos.z;
    if (dx * dx + dz * dz > 1e-4) this.look(ch, it, Math.atan2(-dx, -dz), 0, dt);
  }

  /** Stand where we belong, looking about. */
  hold(game, ch, it, dt) {
    const p = this.post;
    if (!p) return;
    if (Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) > 1.5) { this.walk(game, ch, it, p, dt, CONFIG.STORY.GUARD.WALK); return; }
    this.look(ch, it, (p.yaw || 0) + Math.sin(game.time * 0.35 + this.phase) * 0.7, 0, dt);
  }

  /** Walk the patrol loop, pausing at each point. */
  patrol(game, ch, it, dt) {
    const r = this.route;
    if (!r || !r.length) { this.hold(game, ch, it, dt); return; }
    if (game.time < this.waitUntil) { this.look(ch, it, ch.yaw + Math.sin(game.time * 0.8 + this.phase) * 0.02, 0, dt); return; }
    if (this.walk(game, ch, it, r[this.routeI], dt, CONFIG.STORY.GUARD.WALK)) {
      this.routeI = (this.routeI + 1) % r.length;
      this.waitUntil = game.time + this.rng.float(1.2, 3);
    }
  }
}

class GuardController extends NpcController {
  constructor(seed, opts = {}) {
    super(seed, opts);
    this.marksman = !!opts.marksman;
    this.aware = new Map();                     // player id -> 0..1
    this.lastSeenAt = new Map();                // player id -> { pos, at }
    this.losCache = new Map();
    this.target = null;
    this.state = this.route ? 'patrol' : 'idle';
    this.homeState = this.state;
    this.focus = null;                          // where we look / walk (suspicious, search, investigate)
    this.body = null;
    this.searchUntil = 0;
    this.searchGoal = null;
    this.calmSince = 0;
    this._eye = new THREE.Vector3(); this._t = new THREE.Vector3();
  }

  awareOf(ch) { return this.aware.get(ch.id) || 0; }

  getIntent(game, ch) {
    const it = makeIntent();
    if (!ch.alive) return it;
    const dt = 1 / CONFIG.SIM_HZ;
    if ((ch.stunnedUntil || 0) > game.time) {                       // blinded by smoke: stagger about
      it.moveX = Math.sin(game.time * 5 + this.phase) * 0.25;
      this.look(ch, it, ch.yaw + 0.4, -0.3, dt);
      return it;
    }
    if (this.queue.length) return Object.assign(it, this.queue.shift());
    this.perceive(game, ch, dt);
    this.decide(game, ch);
    const G = CONFIG.STORY.GUARD;
    switch (this.state) {
      case 'idle': this.hold(game, ch, it, dt); break;
      case 'patrol': this.patrol(game, ch, it, dt); break;
      case 'suspicious':
        if (this.focus) {
          this.faceTo(ch, it, this.focus, dt);
          if (Math.hypot(this.focus.x - ch.pos.x, this.focus.z - ch.pos.z) > 4) { this.walk(game, ch, it, this.focus, dt, 0.35, 4); this.faceTo(ch, it, this.focus, dt); }
        }
        break;
      case 'combat': this.fight(game, ch, it, dt); break;
      case 'investigate':
        if (this.walk(game, ch, it, this.focus, dt, 0.8, 2)) {
          if (this.body) {
            this.body.bodyFound = true;
            Stealth.bark(game, ch, 'body');
            if (game.story) game.story.raiseAlarm(ch.site, this.body.pos.clone(), ch);
            this.startSearch(game, ch, this.body.pos.clone(), CONFIG.STORY.AWARE.SEARCH_TIME);
          } else this.startSearch(game, ch, this.focus, 8);
        }
        break;
      case 'search': this.search(game, ch, it, dt); break;
      case 'return': {
        const home = this.post || (this.route && this.route[this.routeI]) || ch.home;
        if (!home || this.walk(game, ch, it, home, dt, G.WALK)) this.state = this.homeState;
        break;
      }
    }
    return it;
  }

  // ---------------------------------------------------------------- senses
  perceive(game, ch, dt) {
    const S = CONFIG.STORY, V = S.VISION, A = S.AWARE, story = game.story;
    const alarm = story && ch.site && story.alarmUntil(ch.site) > game.time;
    const range = V.RANGE * (Stealth.isNight(game) ? V.NIGHT : 1) * (alarm ? 1.25 : 1);
    const blind = !!Stealth.smokeAt(game, ch.pos);
    const eye = ch.eyePos(this._eye);
    for (const p of Stealth.humans(game)) {
      let lv = this.aware.get(p.id) || 0;
      const d = ch.pos.distanceTo(p.pos);
      let seen = false;
      if (!blind && d <= range) {
        const hidOk = !p.hidden || d <= (this.state === 'search' ? 2.5 : V.HIDDEN);
        if (hidOk && Stealth.inCone(ch, p.pos, d, p.sneaking)) seen = this.los(game, p, eye);
      }
      const engaged = this.state === 'combat' && this.target === p;
      if (seen) {
        this.lastSeenAt.set(p.id, { pos: p.pos.clone(), at: game.time });
        const rate = engaged ? 10 : A.RATE * Math.max(0.15, 1 - d / range) * Stealth.suspicion(game, ch, p) * (alarm ? 1.5 : 1);
        const cap = engaged ? 1 : Stealth.awarenessCap(game, p);
        lv = rate > 0 ? Math.min(cap, lv + rate * dt) : Math.max(0, lv - A.DECAY * dt);
        if (cap < 1 && lv >= A.SUSPICIOUS && p.climbing && this.state !== 'combat') Stealth.bark(game, ch, 'climb');
      } else if (!engaged) lv = Math.max(0, lv - A.DECAY * dt);
      this.aware.set(p.id, lv);
    }
  }

  los(game, p, eye) {
    const c = this.losCache.get(p.id);
    if (c && game.time - c.at < CONFIG.STORY.VISION.LOS_EVERY) return c.ok;
    const ok = Stealth.lineOfSight(game, eye, this._t.set(p.pos.x, p.pos.y + 1.45, p.pos.z)) ||
      Stealth.lineOfSight(game, eye, this._t.set(p.pos.x, p.pos.y + 0.5, p.pos.z));
    this.losCache.set(p.id, { at: game.time, ok });
    return ok;
  }

  /** Can we see this character right now (cone + line of sight, ignoring awareness)? */
  seesNow(game, ch, p) {
    const d = ch.pos.distanceTo(p.pos);
    if (d > CONFIG.STORY.VISION.RANGE || (p.hidden && d > CONFIG.STORY.VISION.HIDDEN) || !Stealth.inCone(ch, p.pos, d, p.sneaking)) return false;
    this.losCache.delete(p.id);
    return this.los(game, p, ch.eyePos(this._eye));
  }

  // ---------------------------------------------------------------- decisions
  decide(game, ch) {
    const A = CONFIG.STORY.AWARE;
    let best = null, bl = 0;
    for (const p of Stealth.humans(game)) { const lv = this.awareOf(p); if (lv > bl) { bl = lv; best = p; } }
    if (this.state === 'combat') {
      const t = this.target, seen = t && this.lastSeenAt.get(t.id);
      if (!t || !t.alive || t.removed) { this.startSearch(game, ch, seen ? seen.pos : ch.pos.clone(), 8); return; }
      if (!seen || game.time - seen.at > A.LOSE_SIGHT) this.startSearch(game, ch, seen ? seen.pos : t.pos.clone(), A.SEARCH_TIME);
      return;
    }
    if (best && bl >= 1) { this.engage(game, ch, best, true); return; }
    if (this.state === 'investigate' || this.state === 'search') {
      if (best && bl >= A.SUSPICIOUS) { const s = this.lastSeenAt.get(best.id); if (s) { this.focus = s.pos; this.searchGoal = s.pos; } }
      return;
    }
    if (best && bl >= A.SUSPICIOUS) {
      if (this.state !== 'suspicious') { this.state = 'suspicious'; Stealth.bark(game, ch, 'suspicious'); }
      const s = this.lastSeenAt.get(best.id);
      if (s) this.focus = s.pos;
      this.calmSince = game.time;
      return;
    }
    if (this.state === 'suspicious' && bl < 0.1 && game.time - this.calmSince > 2.5) { Stealth.bark(game, ch, 'calm'); this.state = 'return'; }
    if ((this.state === 'idle' || this.state === 'patrol' || this.state === 'return') && game.tickCount % 15 === ch.id % 15) this.lookForBodies(game, ch);
  }

  /** Attack `p`. relay: also call the guards around us. */
  engage(game, ch, p, relay) {
    const first = this.state !== 'combat' || this.target !== p;
    this.state = 'combat';
    this.target = p;
    this.aware.set(p.id, 1);
    if (!this.lastSeenAt.get(p.id)) this.lastSeenAt.set(p.id, { pos: p.pos.clone(), at: game.time });
    if (!first) return;
    this.reactAt = game.time + CONFIG.STORY.GUARD.REACTION * this.rng.float(0.8, 1.3);
    Stealth.bark(game, ch, 'combat');
    game.events.emit('guardAlert', { character: ch, target: p });
    if (relay) Stealth.alert(game, ch, p, p.pos.clone());
  }

  /** Another guard (or a witness) points us at `target`, last seen at `pos`. */
  callTo(game, ch, target, pos, sawIt) {
    if (this.state === 'combat') return;
    this.lastSeenAt.set(target.id, { pos: pos.clone(), at: game.time });
    this.engage(game, ch, target, !!sawIt);
  }

  /** A gunshot or a scream at `pos`. */
  hear(game, ch, pos, culprit) {
    if (this.state === 'combat') return;
    if (culprit && culprit.isHuman && this.seesNow(game, ch, culprit)) { this.engage(game, ch, culprit, true); return; }
    this.investigate(game, ch, pos, null);
  }

  investigate(game, ch, pos, body) {
    if (this.state === 'combat') return;
    this.state = 'investigate';
    this.focus = pos.clone();
    this.body = body;
    Stealth.bark(game, ch, 'suspicious');
  }

  startSearch(game, ch, pos, time) {
    this.state = 'search';
    this.target = null;
    this.focus = pos.clone();
    this.searchGoal = pos.clone();
    this.searchUntil = game.time + time;
    Stealth.bark(game, ch, 'search');
  }

  lookForBodies(game, ch) {
    const R = CONFIG.STORY.AWARE.BODY_RANGE;
    const eye = ch.eyePos(this._eye);
    for (const c of game.characters()) {
      if (c.alive || !c.corpse || c.bodyFound || c.npcRole === 'villager' && c.pos.distanceTo(ch.pos) > 10) continue;
      const d = c.pos.distanceTo(ch.pos);
      if (d > R || !Stealth.inCone(ch, c.pos, d)) continue;
      if (!Stealth.lineOfSight(game, eye, this._t.set(c.pos.x, c.pos.y + 0.4, c.pos.z))) continue;
      this.investigate(game, ch, c.pos, c);
      return;
    }
  }

  search(game, ch, it, dt) {
    if (game.time > this.searchUntil) {
      Stealth.bark(game, ch, 'calm');
      this.state = 'return';
      for (const k of this.aware.keys()) this.aware.set(k, 0);
      return;
    }
    if (this.marksman) { this.look(ch, it, Math.atan2(-(this.focus.x - ch.pos.x), -(this.focus.z - ch.pos.z)) + Math.sin(game.time * 0.6) * 0.8, 0, dt); return; }
    if (!this.searchGoal || this.walk(game, ch, it, this.searchGoal, dt, 0.7, 1.5)) {
      // next: a hiding spot nearby if there is one (guards poke the hay), else a random point
      const story = game.story, f = this.focus;
      let next = null;
      if (story && this.rng.chance(0.55)) {
        const spots = story.hideSpotsNear(f, 10);
        if (spots.length) { const s = spots[Math.floor(this.rng.next() * spots.length)]; next = new THREE.Vector3(s.x, s.y, s.z); }
      }
      if (!next) { const a = this.rng.next() * Math.PI * 2, r = 2 + this.rng.next() * 6; next = new THREE.Vector3(f.x + Math.cos(a) * r, f.y, f.z + Math.sin(a) * r); }
      this.searchGoal = next;
      this.waitUntil = game.time + 1;
    }
  }

  // ---------------------------------------------------------------- fighting
  slotOf(ch, test) {
    for (let i = 0; i < CONFIG.HOTBAR_SLOTS; i++) { const s = ch.inventory.get(i); if (s && test(ITEMS[s.id])) return i; }
    return -1;
  }

  fight(game, ch, it, dt) {
    const t = this.target;
    if (!t) return;
    const seen = this.lastSeenAt.get(t.id);
    const goal = seen ? seen.pos : t.pos;
    const d = ch.pos.distanceTo(t.pos);
    const visible = !!seen && game.time - seen.at < 0.35;
    const gun = this.slotOf(ch, (i) => i && i.kind === 'weapon');
    const sword = this.slotOf(ch, (i) => i && i.kind === 'blade');
    if (gun >= 0 && (this.marksman || sword < 0) && d > 5) {
      if (ch.selectedSlot !== gun) { it.slot = gun; return; }
      if (!visible) {
        // marksmen keep their perch and watch where the target vanished; others close in
        if (this.marksman) this.faceTo(ch, it, goal, dt); else this.walk(game, ch, it, goal, dt, 1, 3);
        return;
      }
      if (d < 9) { const away = ch.pos.clone().multiplyScalar(2).sub(t.pos); this.moveDir(ch, it, away.x - ch.pos.x, away.z - ch.pos.z); }
      this.shoot(game, ch, it, dt, t, d);
      return;
    }
    if (sword >= 0 && ch.selectedSlot !== sword) { it.slot = sword; return; }
    // take turns: only the two guards closest to the target press in, the rest circle at a distance
    const pressing = this.mayPress(game, ch, t);
    if (!pressing && visible && d < 5.5) {
      const side = Math.sin(game.time * 0.7 + this.phase) > 0 ? 1 : -1;
      const ax = ch.pos.x - t.pos.x, az = ch.pos.z - t.pos.z, L = Math.max(0.1, Math.hypot(ax, az));
      this.moveDir(ch, it, -az / L * side + (d < 3.5 ? ax / L : 0), ax / L * side + (d < 3.5 ? az / L : 0));
      it.moveX *= 0.5; it.moveZ *= 0.5;
    } else if (d > 1.9 || !visible) this.walk(game, ch, it, goal, dt, 1, pressing ? 1.5 : 4);
    if (visible) this.faceTo(ch, it, t.pos, dt);
    if (pressing && d <= 2.3 && visible && game.time >= this.reactAt && !ch.windup && (ch.bladeCd || 0) <= 0 && Math.abs(t.pos.y - ch.pos.y) < 1.6) {
      it.fire = true; it.firePressed = true;
    }
  }

  /** Is this guard one of the two sword-fighters nearest the target? (re-checked twice a second) */
  mayPress(game, ch, t) {
    if (game.time < (this.pressCheck || 0)) return this.pressing;
    this.pressCheck = game.time + 0.5;
    const d = ch.pos.distanceTo(t.pos);
    let closer = 0;
    for (const c of game.characters()) {
      if (c === ch || !c.alive || c.npcRole !== 'guard' || c.controller.state !== 'combat' || c.controller.target !== t || c.controller.marksman) continue;
      if (c.pos.distanceTo(t.pos) < d) closer++;
    }
    this.pressing = closer < 2;
    return this.pressing;
  }

  shoot(game, ch, it, dt, t, d) {
    const st = Weapons.of(ch.heldStack());
    if (!st) return;
    const G = CONFIG.STORY.GUARD;
    if (game.time >= this.err.until) {
      const k = G.AIM_ERROR * (1 + Math.hypot(t.vel.x, t.vel.z) * 0.12);
      this.err.yaw = this.gauss() * k; this.err.pitch = this.gauss() * k * 0.6;
      this.err.until = game.time + this.rng.float(0.4, 0.8);
    }
    const eye = ch.eyePos(new THREE.Vector3());
    const aim = new THREE.Vector3(t.pos.x, t.pos.y + 1.1, t.pos.z);
    if (st.projectile) {
      const tt = d / st.projectile.speed;
      aim.addScaledVector(t.vel, tt);
      aim.y += 0.5 * st.projectile.gravity * tt * tt;
    }
    const dd = aim.sub(eye);
    const yaw = Math.atan2(-dd.x, -dd.z) + this.err.yaw, pitch = Math.atan2(dd.y, Math.hypot(dd.x, dd.z)) + this.err.pitch;
    this.look(ch, it, yaw, pitch, dt);
    const off = Math.hypot(wrapAngle(yaw - ch.yaw - it.lookDX), pitch - ch.pitch - it.lookDY);
    if (game.time >= this.reactAt && off < Math.atan2(0.9, d) + 0.02 && !ch.reload && game.time >= this.nextShot) {
      it.fire = true; it.firePressed = true;
      this.nextShot = game.time + st.interval * this.rng.float(1.1, 1.6);
    }
    const held = ch.heldStack();
    if (held && held.data && held.data.mag === 0 && !ch.reload) it.reload = true;
  }
}

class VillagerController extends NpcController {
  constructor(seed, opts = {}) {
    super(seed, opts);
    this.spots = opts.spots || [];
    this.vendor = !!opts.vendor;
    this.state = this.vendor ? 'vendor' : 'wander';
    this.goalSpot = null;
    this.fleeUntil = 0;
    this.threat = null;
    this.pace = 0.42 + this.rng.next() * 0.2;
  }

  getIntent(game, ch) {
    const it = makeIntent();
    if (!ch.alive) return it;
    const dt = 1 / CONFIG.SIM_HZ;
    if (this.state === 'flee') {
      if (game.time > this.fleeUntil) { this.state = this.vendor ? 'vendor' : 'wander'; this.goalSpot = null; }
      else {
        const away = new THREE.Vector3(ch.pos.x * 2 - this.threat.x, ch.pos.y, ch.pos.z * 2 - this.threat.z);
        this.walk(game, ch, it, away, dt, 1, 0.5);
        return it;
      }
    }
    if (this.state === 'vendor') { this.hold(game, ch, it, dt); return it; }
    if (!this.goalSpot || (this.arrived && game.time > this.waitUntil)) {
      const s = this.spots.length ? this.spots[Math.floor(this.rng.next() * this.spots.length)] : ch.home;
      this.goalSpot = new THREE.Vector3(s.x + this.rng.float(-1.2, 1.2), s.y, s.z + this.rng.float(-1.2, 1.2));
      this.arrived = false;
    }
    if (!this.arrived) {
      if (this.walk(game, ch, it, this.goalSpot, dt, this.pace, 1)) { this.arrived = true; this.waitUntil = game.time + this.rng.float(4, 14); }
    } else {
      // chat with whoever stands nearby
      let other = null, bd = 4;
      for (const c of game.characters()) {
        if (c === ch || !c.alive || c.npcRole !== 'villager') continue;
        const d = c.pos.distanceTo(ch.pos);
        if (d < bd) { bd = d; other = c; }
      }
      if (other) this.faceTo(ch, it, other.pos, dt);
    }
    return it;
  }

  /** Saw violence (or heard shots) at pos: run, scream for the guards. */
  scare(game, ch, pos) {
    if (this.state === 'flee' && game.time < this.fleeUntil - 3) return;
    this.state = 'flee';
    this.threat = pos.clone();
    this.fleeUntil = game.time + 6;
    Stealth.bark(game, ch, 'scream');
    Stealth.noise(game, pos, 16, null);
  }
}

class AllyController extends NpcController {
  /** opts.mode: 'stand' | 'follow' | 'route'; opts.points for routes; opts.pace. */
  constructor(seed, opts = {}) {
    super(seed, opts);
    this.mode = opts.mode || 'stand';
    this.leader = opts.leader || null;
    this.points = opts.points || [];
    this.pace = opts.pace || 0.5;
    this.i = 0;
    this.done = false;
    this.glanceAt = 0;
    this.glanceUntil = 0;
    this.glances = !!opts.glances;
  }

  getIntent(game, ch) {
    const it = makeIntent();
    if (!ch.alive) return it;
    const dt = 1 / CONFIG.SIM_HZ;
    if (this.mode === 'follow' && this.leader && this.leader.alive) {
      const d = ch.pos.distanceTo(this.leader.pos);
      if (d > 3) this.walk(game, ch, it, this.leader.pos, dt, d > 8 ? 1 : 0.7, 2.5);
      else this.faceTo(ch, it, this.leader.pos, dt);
      return it;
    }
    if (this.mode === 'route' && !this.done) {
      if (!this.glanceAt) this.glanceAt = game.time + this.rng.float(6, 10);   // set off first, glance back later
      if (game.time < this.glanceUntil) { this.look(ch, it, this.glanceYaw, 0, dt); return it; }
      if (this.glances && game.time > this.glanceAt) {
        // stop and look back over the shoulder
        this.glanceAt = game.time + this.rng.float(7, 13);
        this.glanceUntil = game.time + 1.8;
        this.glanceYaw = ch.yaw + Math.PI;
        return it;
      }
      if (this.walk(game, ch, it, this.points[this.i], dt, this.pace, 1.2)) {
        this.i++;
        if (this.i >= this.points.length) this.done = true;
      }
      return it;
    }
    this.hold(game, ch, it, dt);
    return it;
  }
}

/** Spawning helpers. */
const Npc = {
  FIRST: ['Tom', 'Ada', 'Bram', 'Nell', 'Wil', 'Edda', 'Jory', 'Mags', 'Piet', 'Rosa', 'Ansel', 'Gwen', 'Hob', 'Lise', 'Cato', 'Meg'],

  spawn(game, o) {
    const c = new Character({ name: o.name, look: o.look, controller: o.controller, team: o.team || 0 });
    c.npc = true;
    c.npcRole = o.role;
    c.site = o.site || null;
    c.tag = o.tag || null;
    game.addEntity(c);
    c.teleport(o.pos.x, o.pos.y + 0.01, o.pos.z);
    c.yaw = o.yaw || 0;
    c.health = o.health || CONFIG.STORY.GUARD.HEALTH;
    c.home = new THREE.Vector3(o.pos.x, o.pos.y + 0.01, o.pos.z);
    (o.items || []).forEach((s, i) => c.inventory.set(i, s));
    return c;
  },

  guard(game, site, o) {
    const seed = (game.seed ^ (game._nextId * 2654435761)) >>> 0;
    const items = [makeStack('sword')];
    if (o.marksman) items.unshift(makeWeapon('musket', 0), null);
    const c = this.spawn(game, {
      name: o.name || (o.marksman ? 'Tollman Marksman' : 'Tollman'), look: o.look || 'guard', role: 'guard', team: 2, site,
      pos: o.pos, yaw: o.pos.yaw || 0, health: o.health, tag: o.tag,
      controller: new GuardController(seed, { post: o.route ? null : o.pos, route: o.route || null, marksman: o.marksman }),
      items: items.filter((s) => s !== undefined),
    });
    if (o.marksman) c.inventory.add(makeStack('ammo_heavy', 40));
    return c;
  },

  villager(game, site, o) {
    const seed = (game.seed ^ (game._nextId * 2246822519)) >>> 0;
    return this.spawn(game, {
      name: o.name || this.FIRST[seed % this.FIRST.length], look: o.look || 'villager', role: 'villager', team: 3, site,
      pos: o.pos, yaw: o.pos.yaw || 0, health: 60, tag: o.tag,
      controller: new VillagerController(seed, { spots: o.spots, vendor: o.vendor, post: o.vendor ? o.pos : null }),
    });
  },

  ally(game, o) {
    const seed = (game.seed ^ (game._nextId * 3266489917)) >>> 0;
    return this.spawn(game, {
      name: o.name, look: o.look, role: o.role || 'ally', team: o.team || 1, site: o.site, pos: o.pos, yaw: o.pos.yaw || o.yaw || 0,
      health: o.health || 100, tag: o.tag, items: o.items,
      controller: o.controller || new AllyController(seed, Object.assign({ post: o.pos }, o.ai || {})),
    });
  },
};
