/* ============================================================
 * Character: every player and bot. Reads one Intent per tick from
 * its controller and nothing else.
 *
 * Collision is AABB-vs-voxel with axis-separated movement: move on
 * one axis, and if the box now overlaps a solid block snap it flush
 * against that block and cancel velocity on that axis. Big per-tick
 * movements are split into sub-steps so nothing tunnels through.
 *
 * Auto step-up: when a grounded character is blocked sideways, the
 * same move is retried from STEP_HEIGHT higher and then settled back
 * down; if that got further, the character is now standing on the
 * ledge. This makes 1-block terrain steps and voxel build-ramps
 * walkable. The eye height is eased so the camera doesn't jump.
 * ============================================================ */
class Character extends Entity {
  constructor(opts = {}) {
    super('character');
    this.name = opts.name || 'Player';
    this.team = opts.team || 0;
    this.controller = opts.controller || null;
    this.isLocal = !!opts.isLocal;      // drives a viewport + HUD on this machine
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.sprinting = false;
    this.eyeOffset = 0;                 // eased camera offset after step-ups (negative = below)
    this.health = CONFIG.HEALTH.MAX;
    this.shield = CONFIG.HEALTH.START_SHIELD;
    // combat state (see combat/weapons.js, combat/consumables.js)
    this.adsT = 0;                      // 0..1 aim-down-sights blend
    this.bloom = 0;                     // extra spread from sustained fire
    this.recoil = 0;                    // upward aim offset from recoil (recovers)
    this.fireCd = 0;
    this.shotQueuedAt = -Infinity;
    this.reload = null;                 // { slot, t, total }
    this.using = null;                  // consumable in use { id, slot, t, total }
    this.lastDamagedBy = null;
    this.lastDamageTime = -1;
    this.respawnAt = null;
    this.home = null;                   // respawn point (Vector3) for modes with respawn
    this.vehicle = null;                // Vehicle we sit in (entities/vehicle.js)
    this.vehicleSeat = null;            // 'driver' | 'passenger' | null
    this.seatIndex = -1;
    this.model = null;                  // third-person model (render only)
    this.build = Building.newState();   // fast-building mode (build/building.js)
    this.gliding = false;               // dropping in from the sky at match start (slow fall, steerable)
    // online play (js/net): netRemote = host-side copy of a remote player (it moves itself and reports
    // its position); netPredicted = a client's own player (moves locally, the host decides everything else)
    this.netRemote = false;
    this.netPredicted = false;
    this.netTpSeq = 0;                  // bumps on every host-side teleport so the client snaps to it
    this.netImpulse = new THREE.Vector3();   // knockback the remote player's own simulation must apply
    this.hist = null;                   // recent positions for lag-compensated hit checks (host)
    // story mode (js/story): climbing, sneaking, hiding, falls, how the model looks
    this.climbing = false;
    this.sneaking = false;
    this.hidden = false;                // inside hay or a bush
    this.blending = false;              // walking among villagers (worked out by Stealth on the host)
    this.leap = null;                   // leap of faith: the hay pile we steer into
    this.fallTop = null;                // highest point of the current fall (fall damage)
    this.look = opts.look || null;      // model style: null (ranger), 'order', 'villager', 'guard'...
    this.lookSpec = opts.lookSpec || null;   // a player's own look (js/render/looks.js), when look is 'player' or 'order'
    this.inventory = new Inventory(CONFIG.INVENTORY_SLOTS);
    this.selectedSlot = 0;
    this.target = null;                 // block raycast result this tick
    this.mining = null;                 // { x, y, z, block, progress }
    this.breakCooldown = 0;
    this.placeCooldown = 0;
    this.intent = NEUTRAL_INTENT;
    this.stats = { kills: 0, damageDealt: 0, spawnTime: 0, deathTime: -1, placement: 0 };
  }

  teleport(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.eyeOffset = 0;
    this.fallTop = null;                // a teleport is not a fall
    this.leap = null;
    if (this.netRemote) { this.netTpSeq++; this.netImpulse.set(0, 0, 0); }
  }

  /** Adds velocity (knockback). Remote players get it forwarded to their own simulation. */
  push(dx, dy, dz) {
    this.vel.x += dx; this.vel.y += dy; this.vel.z += dz;
    if (dy > 0) this.onGround = false;
    if (this.netRemote) { this.netImpulse.x += dx; this.netImpulse.y += dy; this.netImpulse.z += dz; }
  }

  get eyeY() { return this.pos.y + CONFIG.PLAYER.EYE + this.eyeOffset; }

  /** Eye position into `out` (Vector3). */
  eyePos(out) { return out.set(this.pos.x, this.eyeY, this.pos.z); }

  /** Unit look direction into `out` (Vector3). */
  lookDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Where shots go: the look direction plus the current recoil kick. */
  aimDir(out) {
    const p = Math.min(Math.PI / 2 - 0.01, this.pitch + this.recoil), cp = Math.cos(p);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(p), -Math.cos(this.yaw) * cp);
  }

  heldKind() {
    const s = this.heldStack();
    return s && ITEMS[s.id] ? ITEMS[s.id].kind : null;
  }

  /** Back to full health at `at` (respawn). */
  revive(at) {
    this.alive = true;
    this.health = CONFIG.HEALTH.MAX;
    this.shield = CONFIG.HEALTH.START_SHIELD;
    this.respawnAt = null;
    this.reload = this.using = this.mining = null;
    this.vehicle = null; this.vehicleSeat = null; this.seatIndex = -1;
    this.gliding = false;
    this.build.active = false; this.build.edit = null;
    this.recoil = this.bloom = this.adsT = 0;
    this.flying = false;
    this.climbing = this.sneaking = this.hidden = this.blocking = false;
    this.draw = 0;
    this.leap = this.fallTop = null;
    if (at) this.teleport(at.x, at.y, at.z);
  }

  /** Story mode has a five-slot loadout instead of the nine-slot hotbar. */
  hotbarSize() { return this.game && this.game.rules.story ? Gear.LOADOUT : CONFIG.HOTBAR_SLOTS; }

  selectSlot(i) {
    const n = this.hotbarSize();
    i = ((i % n) + n) % n;
    if (i !== this.selectedSlot) {
      this.selectedSlot = i;
      this.mining = null;
      if (this.game) this.game.events.emit('slotChanged', { character: this, slot: i });
    }
  }

  heldStack() { return this.inventory.get(this.selectedSlot); }

  /** Block under the crosshair within reach (or null). */
  raycastTarget(world) {
    const o = Character._tmpO, d = Character._tmpD;
    this.eyePos(o); this.lookDir(d);
    return raycastBlocks(world, o, d, CONFIG.REACH);
  }

  update(dt, game) {
    const it = this.controller ? this.controller.getIntent(game, this) : NEUTRAL_INTENT;
    this.intent = it;
    if (!this.alive) return;

    if (!this.netRemote) {                                   // remote players report their own view direction
      this.yaw += it.lookDX;
      const lim = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch + it.lookDY));
    }
    if (this.vehicle) { if (!this.netPredicted) this._seated(dt, it, game); return; }
    if (it.toggleFly && game.rules.allowFly && !this.netRemote) { this.flying = !this.flying; this.vel.y = 0; }
    if (it.slot >= 0 && it.slot < this.hotbarSize()) this.selectSlot(it.slot);
    else if (it.slotDelta && !this.build.active) this.selectSlot(this.selectedSlot + it.slotDelta);
    this.sneaking = !!(game.rules.sneak && it.crouch && !this.inWater && !this.climbing && !this.flying);

    if (!this.netRemote) this._move(dt, it, game.world);
    else {
      const p = this.pos, w = game.world;
      this.inWater = w.isWater(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z));
      this.headInWater = w.isWater(Math.floor(p.x), Math.floor(this.eyeY), Math.floor(p.z));
    }
    if (game.rules.story) {
      const p = this.pos, w = game.world, x = Math.floor(p.x), z = Math.floor(p.z);
      const a = w.getBlock(x, Math.floor(p.y + 0.3), z), b = w.getBlock(x, Math.floor(p.y + 1.2), z);
      this.hidden = a === BLOCK.HAY || a === BLOCK.BUSH || b === BLOCK.HAY;
    }
    if (game.rules.fallDamage && !game.replica) this._trackFall(game);
    if (game.rules.regen && !game.replica && this.isHuman) this._regen(dt, game);
    if (this.netPredicted) {
      // online client: show build ghost / ADS / target locally; the host does the real work
      const building = Building.update(this, it, dt, game, true);
      this.target = this.raycastTarget(game.world);
      const st = building ? null : Weapons.of(this.heldStack());
      const C = CONFIG.COMBAT;
      this.adsT += Math.max(-C.ADS_SPEED * dt, Math.min(C.ADS_SPEED * dt, (it.aim && st ? 1 : 0) - this.adsT));
      this.recoil *= Math.exp(-C.RECOIL_RECOVER * dt);
      const held = this.heldStack();
      this.draw = st && st.bow && it.fire && held.data.mag > 0 && !this.reload ? Math.min(1, (this.draw || 0) + dt / st.bow.draw) : 0;
      const bs = Blade.spec(this);
      this.blocking = !!(bs && bs.block && it.aim);
      return;
    }
    const building = game.rules.noBuilding ? false : Building.update(this, it, dt, game);   // true while in build / edit mode
    Interaction.update(this, it, dt, game, building);
    Weapons.update(this, it, dt, game, building);
    if (!building) { Consumables.update(this, it, dt, game); Blade.update(this, it, dt, game); }
  }

  /** In a vehicle: the vehicle moves us; we can look around, exit, switch seats, and shoot as a passenger. */
  _seated(dt, it, game) {
    const v = this.vehicle;
    if (!v.alive || v.removed) { Vehicles.exit(game, this, true); return; }
    if (it.slot >= 0) this.selectSlot(it.slot);
    else if (it.slotDelta) this.selectSlot(this.selectedSlot + it.slotDelta);
    this.target = null;
    this.mining = null;
    if (it.interact) { Vehicles.exit(game, this, false); return; }
    if (it.switchSeat) Vehicles.switchSeat(game, this);
    Weapons.update(this, it, dt, game, false);            // drivers are disarmed inside Weapons.update
    if (this.vehicleSeat === 'passenger') Consumables.update(this, it, dt, game);
  }

  render(frameDt, game) {
    if (!this.alive && !this.corpse) { if (this.model) this.model.root.visible = false; return; }
    // story mode: far-away people aren't drawn (dozens of villagers and guards)
    if (this.npc && game.player && this.pos.distanceToSquared(game.player.pos) > CONFIG.STORY.NPC_DRAW_DIST ** 2) {
      if (this.model) this.model.root.visible = false;
      return;
    }
    if (!this.model) {
      this.model = new CharacterModel(this, game.scene);
      // a local player's own body is on its own layer, hidden from their camera only (split-screen sees the other)
      if (this.isLocal) setLayer(this.model.root, LAYER_SELF + (this.localIndex || 0));
      game.scene.add(this.model.root);
    }
    this.model.root.visible = true;
    this.model.update(this, frameDt);
  }

  dispose() {
    if (this.model) { this.model.dispose(); this.model = null; }
  }

  _move(dt, it, w) {
    const P = CONFIG.PLAYER, v = this.vel, p = this.pos;
    const groundedAtStart = this.onGround;

    // wish direction (looking down -z at yaw 0)
    const f = it.moveZ, s = it.moveX;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }

    this.inWater = w.isWater(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z));
    this.headInWater = w.isWater(Math.floor(p.x), Math.floor(this.eyeY), Math.floor(p.z));

    let speed, accel;
    if (this.gliding) {
      // glider: slow steady fall, fast steerable horizontal flight, ends on touchdown
      const G = CONFIG.GLIDE;
      speed = G.SPEED; accel = G.ACCEL;
      v.y = Math.max(-G.FALL_SPEED, v.y - P.GRAVITY * dt);
      this.sprinting = false;
    } else if (this.flying) {
      speed = it.sprint ? P.FLY_FAST_SPEED : P.FLY_SPEED;
      accel = P.FLY_ACCEL;
      const up = (it.jump ? 1 : 0) - (it.crouch ? 1 : 0);
      v.y += Math.max(-accel * dt, Math.min(accel * dt, up * speed - v.y));
      this.sprinting = false;
    } else if (this._climbCheck(it, f, sin, cos, w)) {
      // story mode: climbing a wall - straight up, slow sideways, hugging the wall
      const S = CONFIG.STORY;
      v.y = S.CLIMB_SPEED;
      speed = S.CLIMB_SIDE;
      accel = P.GROUND_ACCEL;
      this.sprinting = false;
    } else {
      this.sprinting = it.sprint && f > 0 && !this.inWater && !this.sneaking && !this.blocking;
      speed = this.inWater ? P.SWIM_SPEED : this.sneaking ? CONFIG.STORY.SNEAK_SPEED : (this.sprinting ? P.SPRINT_SPEED : P.WALK_SPEED);
      if (this.blocking) speed *= CONFIG.STORY.SWORD.BLOCK_SPEED;
      accel = this.onGround ? P.GROUND_ACCEL : P.AIR_ACCEL;
      if (this.wasClimbing && f < -0.2 && it.jump) {
        // back + jump off the wall we were on
        const E = CONFIG.STORY.WALL_EJECT;
        v.x = sin * E[0]; v.z = cos * E[0]; v.y = E[1];
      }
      if (this.leap && p.y < (this.leapY || 0) - 1.5) {
        // leap of faith: once clear of the perch, steer so we come down in the hay
        const L = this.leap, t = Math.sqrt(Math.max(0.05, 2 * Math.max(0, p.y - L.y) / P.GRAVITY));
        wx = (L.x - p.x) / Math.max(0.25, t); wz = (L.z - p.z) / Math.max(0.25, t);
        const m = Math.hypot(wx, wz); if (m > 9) { wx *= 9 / m; wz *= 9 / m; }
        speed = 1; accel = 40;
      }
      if (this.inWater) {
        v.y -= P.WATER_GRAVITY * dt;
        if (it.jump) v.y = Math.min(P.WATER_SWIM_UP, v.y + 30 * dt);
        v.y = Math.max(-P.WATER_SINK_MAX, v.y);
        accel = P.WATER_ACCEL;
      } else {
        if (it.jump && this.onGround) { v.y = P.JUMP_VELOCITY; this.onGround = false; }
        v.y = Math.max(-P.TERMINAL_VELOCITY, v.y - P.GRAVITY * dt);
      }
    }
    v.x += Math.max(-accel * dt, Math.min(accel * dt, wx * speed - v.x));
    v.z += Math.max(-accel * dt, Math.min(accel * dt, wz * speed - v.z));

    // integrate with sub-steps
    const maxMove = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
    const steps = Math.max(1, Math.ceil(maxMove / 0.2));
    const h = dt / steps;
    const wasGrounded = this.onGround;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      const sx = v.x * h, sz = v.z * h;
      const ox = p.x, oy = p.y, oz = p.z;
      let bx = this._moveAxis('x', sx), bz = this._moveAxis('z', sz);
      if ((bx || bz) && (wasGrounded || this.onGround) && !this.flying && P.STEP_HEIGHT > 0) {
        const px = p.x, pz = p.z;                 // result of the plain move
        p.set(ox, oy, oz);
        this._moveAxis('y', P.STEP_HEIGHT);        // rise (a ceiling stops it early)
        const sbx = this._moveAxis('x', sx), sbz = this._moveAxis('z', sz);
        this._moveAxis('y', oy - p.y);             // settle back onto whatever is below
        const plain = (px - ox) ** 2 + (pz - oz) ** 2, stepped = (p.x - ox) ** 2 + (p.z - oz) ** 2;
        if (stepped > plain + 1e-9 && p.y > oy + 1e-6) {
          this.eyeOffset -= p.y - oy;              // camera eases up instead of snapping
          bx = sbx; bz = sbz;
          this.onGround = true;
        } else {
          p.set(px, oy, pz);
        }
      }
      if (bx) v.x = 0;
      if (bz) v.z = 0;
      const dy = v.y * h;
      if (this._moveAxis('y', dy)) {
        if (dy < 0 && !this.flying) this.onGround = true;
        v.y = 0;
      }
    }
    if (this.gliding && (this.onGround || this.inWater)) { this.gliding = false; if (this.game) this.game.events.emit('landed', { character: this }); }
    this.wasClimbing = this.climbing;
    if (this.game && this.game.rules.story) {
      // hay breaks a fall; stepping off a viewpoint perch is a leap of faith
      const feet = w.getBlock(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z));
      if (feet === BLOCK.HAY && v.y < -CONFIG.STORY.HAY_CUSHION) v.y = -CONFIG.STORY.HAY_CUSHION;
      if (this.leap && (this.onGround || this.inWater || feet === BLOCK.HAY)) this.leap = null;
      else if (!this.leap && groundedAtStart && !this.onGround && !this.climbing) {
        const st = this.game.story, vp = st && st.plan && st.plan.perchAt(p, CONFIG.STORY.LEAP_RANGE);
        if (vp) { this.leap = vp.hay; this.leapY = p.y; this.game.events.emit('leap', { character: this }); }
      }
    }
    this.eyeOffset *= Math.exp(-P.STEP_EASE * dt);
    if (Math.abs(this.eyeOffset) < 1e-4) this.eyeOffset = 0;
  }

  /** Story mode: is the character pressing into a wall it can climb? Sets this.climbing. */
  _climbCheck(it, f, sin, cos, w) {
    this.climbing = false;
    const g = this.game;
    if (!g || !g.rules.climb || this.inWater || this.leap || this.vehicle || f < 0.2 || !(it.jump || it.sprint)) return false;
    const p = this.pos, reach = CONFIG.PLAYER.WIDTH / 2 + 0.25;
    const x = Math.floor(p.x - sin * reach), z = Math.floor(p.z - cos * reach);
    for (const dy of [0.02, 0.9, 1.6]) {
      if (w.isSolid(x, Math.floor(p.y + dy), z)) { this.climbing = true; break; }
    }
    // a ceiling right above stops the climb
    if (this.climbing && w.isSolid(Math.floor(p.x), Math.floor(p.y + CONFIG.PLAYER.HEIGHT + 0.05), Math.floor(p.z))) this.climbing = false;
    return this.climbing;
  }

  /** Story mode: players' health comes back by itself after a while without taking any damage. */
  _regen(dt, game) {
    const R = CONFIG.STORY.REGEN, max = CONFIG.HEALTH.MAX;
    this.regenerating = this.health < max && game.time - this.lastDamageTime >= R.DELAY;
    if (this.regenerating) this.health = Math.min(max, this.health + R.RATE * dt);
  }

  /** Story mode: fall damage from the highest point of a fall (host / offline only). Hay and water are safe. */
  _trackFall(game) {
    const p = this.pos, S = CONFIG.STORY;
    if (!this.alive) { this.fallTop = null; return; }
    const supported = this.inWater || this.climbing || this.gliding || this.flying || !!this.vehicle;
    if (this.onGround && !supported) {
      if (this.fallTop !== null) {
        const h = this.fallTop - p.y;
        const x = Math.floor(p.x), z = Math.floor(p.z), w = game.world;
        const hay = w.getBlock(x, Math.floor(p.y + 0.1), z) === BLOCK.HAY || w.getBlock(x, Math.floor(p.y - 0.5), z) === BLOCK.HAY;
        if (hay && h > 3) game.events.emit('hayLanding', { character: this, height: h, x: p.x, y: p.y, z: p.z });
        else if (h > S.SAFE_FALL) Combat.applyDamage(game, this, (h - S.SAFE_FALL) * S.FALL_DAMAGE, { kind: 'fall', ignoreShield: true });
      }
      this.fallTop = null;
    } else if (supported) {
      this.fallTop = null;
    } else if (this.fallTop === null || p.y > this.fallTop) {
      this.fallTop = p.y;
    }
  }

  /**
   * Moves along one axis and resolves overlap with solid voxels.
   * Returns true if the move was blocked (position is then flush with the block).
   */
  _moveAxis(axis, delta) {
    if (delta === 0) return false;
    const P = CONFIG.PLAYER, p = this.pos, w = this.game.world, EPS = 1e-4;
    const hw = P.WIDTH / 2;
    p[axis] += delta;

    const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw - EPS);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + P.HEIGHT - EPS);
    const z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw - EPS);

    let target = null;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!w.isSolid(x, y, z)) continue;
          let t;
          if (axis === 'x') t = delta > 0 ? x - hw - EPS : x + 1 + hw + EPS;
          else if (axis === 'z') t = delta > 0 ? z - hw - EPS : z + 1 + hw + EPS;
          else t = delta > 0 ? y - P.HEIGHT - EPS : y + 1 + EPS;
          if (target === null) target = t;
          else target = delta > 0 ? Math.min(target, t) : Math.max(target, t);
        }
      }
    }
    if (target === null) return false;
    p[axis] = target;
    return true;
  }

  /** True if this character's box overlaps the unit cell (x,y,z). */
  overlapsCell(x, y, z) {
    const hw = CONFIG.PLAYER.WIDTH / 2, p = this.pos;
    return p.x + hw > x && p.x - hw < x + 1 && p.z + hw > z && p.z - hw < z + 1 &&
      p.y + CONFIG.PLAYER.HEIGHT > y && p.y < y + 1;
  }

  serialize() {
    return Object.assign(super.serialize(), {
      name: this.name, team: this.team, pitch: this.pitch, health: this.health, shield: this.shield, stats: Object.assign({}, this.stats),
      selectedSlot: this.selectedSlot, inventory: this.inventory.serialize(), flying: this.flying,
    });
  }
}
Character._tmpO = new THREE.Vector3();
Character._tmpD = new THREE.Vector3();
