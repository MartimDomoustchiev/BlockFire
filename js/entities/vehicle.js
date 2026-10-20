/* ============================================================
 * Vehicles (stage 5): car, sports car, off-road truck, boat.
 *
 * Arcade model, one tick:
 *   1. Engine: the driver's Intent (moveZ throttle, moveX steer,
 *      jump = handbrake, sprint = boost) changes the forward speed f.
 *   2. Velocity is split into forward and sideways parts relative to
 *      the heading; sideways velocity decays with "grip" - low grip
 *      (handbrake) = drifting. Steering turns the heading, scaled by
 *      speed so a parked car can't spin on the spot.
 *   3. Horizontal move with collision against a box sampled around
 *      the hull above wheel-step height: leaves/glass/cactus get
 *      smashed, build pieces take ram damage, anything else stops
 *      the car (sliding along walls) and hard hits damage it.
 *   4. Wheels follow the highest ground under the 4 wheel points,
 *      climbing ledges up to `step` smoothly; leaving a ledge or a
 *      ramp top keeps the vertical speed, so ramps launch the car.
 *   5. Boats float on the water surface and crawl on land; land
 *      vehicles crawl in deep water.
 * Fuel drains with throttle (faster when boosting); fuel barrels
 * refill nearby vehicles. At 0 HP a vehicle explodes and throws
 * everyone out. Drivers can't shoot; passengers can.
 * ============================================================ */
class Vehicle extends Entity {
  constructor(kind) {
    super('vehicle');
    this.kind = kind;
    this.spec = CONFIG.VEHICLES[kind];
    this.seats = new Array(this.spec.seats.length).fill(null);   // character ids
    this.hp = this.spec.hp;
    this.fuel = this.spec.fuel;
    this.vy = 0;
    this.onGround = true;
    this.onWater = false;
    this.submerged = false;
    this.lastAttacker = null;
    this.rammed = new Map();          // character id -> time of last ram damage
    this.model = null;
  }

  fwd(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  /** World position of a local point (x right, y up, z forward) into out. */
  local(x, y, z, out) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return out.set(this.pos.x + x * c - z * s, this.pos.y + y, this.pos.z - x * s - z * c);
  }

  driver(game) { return this.seats[0] ? game.entities.get(this.seats[0]) || null : null; }

  occupants(game) {
    const out = [];
    for (const id of this.seats) { const c = id && game.entities.get(id); if (c) out.push(c); }
    return out;
  }

  update(dt, game) {
    if (!this.alive) return;
    const S = this.spec, V = CONFIG.VEHICLE, w = game.world;
    const drv = this.driver(game);
    const it = drv && drv.alive ? drv.intent : NEUTRAL_INTENT;

    // --- environment ---
    this.submerged = !S.water && w.isWater(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.6), Math.floor(this.pos.z));
    let envMax = 1;
    if (S.water && !this.onWater) envMax = V.LAND_SPEED_BOAT / S.maxSpeed;
    if (this.submerged) envMax = V.WATER_SPEED;

    // --- engine ---
    const f0 = this.fwd(Vehicle._f), r0 = this.right(Vehicle._r);
    let f = this.vel.x * f0.x + this.vel.z * f0.z;
    let l = this.vel.x * r0.x + this.vel.z * r0.z;
    const hasFuel = this.fuel > 0;
    const throttle = hasFuel ? it.moveZ : 0;
    const boost = it.sprint && throttle > 0 && hasFuel;
    const handbrake = it.jump;
    const grounded = this.onGround || this.onWater;
    if (grounded) {
      const maxF = S.maxSpeed * (boost ? S.boost : 1) * envMax;
      if (throttle > 0) {
        f += (f < 0 ? S.brake : S.accel * (boost ? 1.35 : 1)) * dt;
        if (f > maxF) f = Math.max(maxF, f - S.brake * dt);
      } else if (throttle < 0) {
        f -= (f > 0 ? S.brake : S.accel * 0.6) * dt;
        f = Math.max(f, -S.reverse * envMax);
      } else {
        f -= Math.sign(f) * Math.min(Math.abs(f), S.coast * dt);
      }
      if (handbrake) f -= Math.sign(f) * Math.min(Math.abs(f), S.brake * 0.45 * dt);
      if (f > maxF + 0.5) f -= Math.min(f - maxF, S.brake * dt);       // e.g. drove into water
      l *= Math.exp(-(handbrake ? S.driftGrip : S.grip) * dt);
      const steer = -it.moveX;
      this.yaw += steer * S.steer * Math.min(1, Math.abs(f) / 5) * Math.sign(f) * (handbrake ? 1.35 : 1) * dt;
      if (drv) this.fuel = Math.max(0, this.fuel - Math.abs(throttle) * S.fuelRate * (boost ? 3 : 1) * dt);
    }
    const f1 = this.fwd(Vehicle._f), r1 = this.right(Vehicle._r);
    this.vel.x = f1.x * f + r1.x * l;
    this.vel.z = f1.z * f + r1.z * l;

    // --- horizontal move with collision (sub-stepped) ---
    const dist = this.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.35));
    for (let i = 0; i < steps; i++) this._moveHorizontal(game, this.vel.x * dt / steps, this.vel.z * dt / steps);

    // --- vertical: follow the ground / water, fly off ledges ---
    this._vertical(game, dt, Math.abs(f));

    // --- ram characters ---
    if (this.speed > V.RAM_MIN_SPEED) this._ram(game);

    // --- refuel near barrels ---
    for (const e of game.entities.values()) {
      if (e.type === 'barrel' && e.alive && e.pos.distanceTo(this.pos) < V.REFUEL_RANGE) {
        this.fuel = Math.min(S.fuel, this.fuel + V.REFUEL_RATE * dt);
        break;
      }
    }

    // --- occupants ride along ---
    const p = Vehicle._p;
    this.seats.forEach((id, i) => {
      const c = id && game.entities.get(id);
      if (!c) return;
      const s = S.seats[i];
      this.local(s[0], s[1], s[2], p);
      c.pos.copy(p);
      c.vel.copy(this.vel);
      c.onGround = true;
    });
  }

  /** Is the hull blocked at (x,z)? Smashes weak blocks / rams pieces as a side effect. */
  _blocked(game, x, z) {
    const S = this.spec, V = CONFIG.VEHICLE, w = game.world;
    const [L, W, H] = S.size;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // weak blocks are smashed over the whole hull height; anything else blocks above wheel-step height
    const yLow = Math.floor(this.pos.y + 0.05), y0 = Math.floor(this.pos.y + S.step + 0.05), y1 = Math.floor(this.pos.y + H - 0.05);
    const pts = Vehicle._pts(L, W);
    let blocked = false;
    for (const [lx, lz] of pts) {
      const bx = Math.floor(x + lx * c - lz * s), bz = Math.floor(z - lx * s - lz * c);
      for (let by = yLow; by <= y1; by++) {
        const b = w.getBlock(bx, by, bz);
        if (b === -1) { if (by >= y0) blocked = true; continue; }
        if (!BlockTables.solid[b]) continue;
        if (V.WEAK_BLOCKS.includes(b)) {
          w.setBlock(bx, by, bz, BLOCK.AIR);
          game.events.emit('blockSmashed', { x: bx, y: by, z: bz, block: b, vehicle: this });
          continue;
        }
        if (by < y0) continue;                               // a ledge the wheels can climb
        const piece = Building.pieceAtBlock(game, bx, by, bz);
        if (piece && !this._rammedPiece.has(piece.id)) {
          this._rammedPiece.add(piece.id);
          Building.damageBlock(game, bx, by, bz, this.speed * V.PIECE_RAM, this.driver(game));
          if (!game.pieces.has(piece.id)) continue;            // smashed through
        }
        blocked = true;
      }
    }
    return blocked;
  }

  _moveHorizontal(game, dx, dz) {
    this._rammedPiece = this._rammedPiece || new Set();
    this._rammedPiece.clear();
    const p = this.pos;
    if (!this._blocked(game, p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return; }
    const impact = this.speed;
    // slide along walls: try each axis alone
    if (dx && !this._blocked(game, p.x + dx, p.z)) { p.x += dx; this.vel.z *= 0.3; }
    else if (dz && !this._blocked(game, p.x, p.z + dz)) { p.z += dz; this.vel.x *= 0.3; }
    else { this.vel.x *= -0.2; this.vel.z *= -0.2; }
    if (impact > CONFIG.VEHICLE.CRASH_SPEED) {
      this.damage(game, (impact - CONFIG.VEHICLE.CRASH_SPEED) * CONFIG.VEHICLE.CRASH_DAMAGE, null, 'crash');
    }
  }

  /** Highest ground (or water surface for boats) under the wheels; -Infinity if none nearby. */
  _ground(game) {
    const S = this.spec, w = game.world, [L, W] = S.size;
    let best = -Infinity;
    this.onWater = false;
    const p = Vehicle._p;
    // probes at the nose and tail so the hull rises as soon as the bumper reaches a step
    for (const [lx, lz] of [[-W * 0.4, L * 0.5], [W * 0.4, L * 0.5], [-W * 0.4, -L * 0.45], [W * 0.4, -L * 0.45]]) {
      this.local(lx, 0, lz, p);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      for (let y = Math.floor(this.pos.y + S.step); y >= Math.floor(this.pos.y) - 8 && y >= 0; y--) {
        const b = w.getBlock(x, y, z);
        if (b === -1) { best = Math.max(best, this.pos.y); break; }
        if (S.water && b === BLOCK.WATER) {
          if (w.getBlock(x, y + 1, z) !== BLOCK.WATER) { best = Math.max(best, y + 1 - 0.15); this.onWater = true; break; }
          continue;
        }
        if (BlockTables.solid[b] && !CONFIG.VEHICLE.WEAK_BLOCKS.includes(b)) { best = Math.max(best, y + 1); break; }
      }
    }
    return best;
  }

  _vertical(game, dt, speedAbs) {
    const V = CONFIG.VEHICLE, S = this.spec;
    const gy = this._ground(game);
    let y = this.pos.y;
    if (this.onGround || this.onWater) {
      if (gy > y + S.step + 0.01) {
        // ground too high: horizontal collision handles it; stay put
      } else if (gy >= y) {
        // climb at the rate of a 45-degree slope (build ramps), never faster
        const ny = Math.min(gy, y + (speedAbs + 2) * dt);
        this.vy = (ny - y) / dt; y = ny; this.onGround = true;
      } else if (gy >= y - 1.1 && this.vy <= 1) {
        const ny = Math.max(gy, y - (speedAbs + 4) * dt);
        this.vy = (ny - y) / dt; y = ny; this.onGround = true;
      } else {
        this.onGround = false;                  // drove off a ledge / ramp top: launch with the climb speed
        this.vy = Math.min(this.vy, V.MAX_LAUNCH);
      }
    }
    if (!this.onGround && !this.onWater) {
      this.vy -= V.GRAVITY * dt;
      y += this.vy * dt;
      if (y <= gy) {
        if (-this.vy > V.LAND_SPEED) this.damage(game, (-this.vy - V.LAND_SPEED) * 6, null, 'crash');
        y = gy; this.vy = 0; this.onGround = true;
        game.events.emit('vehicleLanded', { vehicle: this });
      }
    }
    this.pos.y = y;
  }

  _ram(game) {
    const V = CONFIG.VEHICLE, [L, W, H] = this.spec.size;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    for (const ch of game.entities.values()) {
      if (ch.type !== 'character' || !ch.alive || ch.vehicle === this) continue;
      const dx = ch.pos.x - this.pos.x, dz = ch.pos.z - this.pos.z;
      const lx = dx * c - dz * s, lz = -dx * s - dz * c;         // into vehicle space
      if (Math.abs(lx) > W / 2 + 0.3 || Math.abs(lz) > L / 2 + 0.3) continue;
      if (ch.pos.y > this.pos.y + H || ch.pos.y + 1.8 < this.pos.y) continue;
      const last = this.rammed.get(ch.id) || -1;
      if (game.time - last < 0.5) continue;
      this.rammed.set(ch.id, game.time);
      const sp = this.speed;
      Combat.applyDamage(game, ch, sp * V.RAM_DAMAGE, { attacker: this.driver(game), kind: 'vehicle' });
      ch.push(this.vel.x * 0.8, 4, this.vel.z * 0.8);
    }
  }

  /** Bullets / explosions / crashes. */
  damage(game, amount, attacker, kind) {
    if (!this.alive || !(amount > 0)) return;
    this.hp -= amount;
    if (attacker) this.lastAttacker = attacker;
    game.events.emit('vehicleDamaged', { vehicle: this, amount, kind });
    if (this.hp <= 0) this.explode(game);
  }

  explode(game) {
    if (!this.alive) return;
    this.alive = false;
    for (const c of this.occupants(game)) Vehicles.exit(game, c, true);
    const E = CONFIG.VEHICLE.EXPLOSION;
    Combat.explode(game, this.pos.x, this.pos.y + 0.8, this.pos.z, { damage: E.damage, splash: E.splash, blockRadius: E.blockRadius, cls: null }, this.lastAttacker);
    game.events.emit('vehicleDestroyed', { vehicle: this });
    this.removed = true;
  }

  /** Ray vs the vehicle's oriented box. Returns distance or -1. */
  rayHit(o, d, maxDist) {
    const [L, W, H] = this.spec.size;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const ox = o.x - this.pos.x, oz = o.z - this.pos.z;
    const lo = { x: ox * c - oz * s, y: o.y - this.pos.y, z: -ox * s - oz * c };
    const ld = { x: d.x * c - d.z * s, y: d.y, z: -d.x * s - d.z * c };
    return Combat.rayBox(lo, ld, -W / 2, 0.15, -L / 2, W / 2, H, L / 2, maxDist);
  }

  render(frameDt, game) {
    if (!this.model) { this.model = new VehicleModel(this.kind); game.scene.add(this.model.root); }
    this.model.update(this, frameDt, game);
  }

  dispose() { if (this.model) { this.model.dispose(); this.model = null; } }

  serialize() {
    return Object.assign(super.serialize(), { kind: this.kind, hp: this.hp, fuel: this.fuel, seats: this.seats.slice() });
  }

  /** Perimeter sample points (local x right, z forward) of an L x W box. */
  static _pts(L, W) {
    const key = L + 'x' + W;
    let pts = Vehicle._ptsCache.get(key);
    if (pts) return pts;
    pts = [];
    const nL = Math.ceil(L / 0.6), nW = Math.ceil(W / 0.6);
    for (let i = 0; i <= nL; i++) { const z = -L / 2 + L * i / nL; pts.push([-W / 2, z], [W / 2, z]); }
    for (let i = 1; i < nW; i++) { const x = -W / 2 + W * i / nW; pts.push([x, -L / 2], [x, L / 2]); }
    Vehicle._ptsCache.set(key, pts);
    return pts;
  }
}
Vehicle._f = new THREE.Vector3(); Vehicle._r = new THREE.Vector3(); Vehicle._p = new THREE.Vector3();
Vehicle._ptsCache = new Map();

/** Explosive fuel barrel: refuels vehicles parked next to it. */
class FuelBarrel extends Entity {
  constructor() { super('barrel'); this.hp = CONFIG.VEHICLE.BARREL_HP; this.mesh = null; this.lastAttacker = null; }
  damage(game, amount, attacker) {
    if (!this.alive || !(amount > 0)) return;
    this.hp -= amount;
    if (attacker) this.lastAttacker = attacker;
    if (this.hp <= 0) {
      this.alive = false; this.removed = true;
      const E = CONFIG.VEHICLE.BARREL_EXPLOSION;
      Combat.explode(game, this.pos.x, this.pos.y + 0.6, this.pos.z, { damage: E.damage, splash: E.splash, blockRadius: E.blockRadius, cls: null }, this.lastAttacker);
    }
  }
  rayHit(o, d, maxDist) {
    const p = this.pos;
    return Combat.rayBox(o, d, p.x - 0.4, p.y, p.z - 0.4, p.x + 0.4, p.y + 1.2, p.z + 0.4, maxDist);
  }
  render(frameDt, game) {
    if (!this.mesh) { this.mesh = VehicleModel.barrel(); game.scene.add(this.mesh); }
    this.mesh.position.copy(this.pos);
  }
  dispose() { if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh); }
}

/** Getting in, out and between seats. */
const Vehicles = {
  nearest(game, ch, range) {
    let best = null, bestD = range;
    for (const e of game.entities.values()) {
      if (e.type !== 'vehicle' || !e.alive) continue;
      const d = Math.hypot(e.pos.x - ch.pos.x, e.pos.z - ch.pos.z) - e.spec.size[0] / 2 + 0.5;
      if (d < bestD && Math.abs(e.pos.y - ch.pos.y) < 3 && e.seats.includes(null)) { best = e; bestD = d; }
    }
    return best;
  },

  enter(game, ch, v) {
    const seat = v.seats.indexOf(null);
    if (seat < 0 || ch.vehicle) return false;
    v.seats[seat] = ch.id;
    ch.vehicle = v;
    ch.seatIndex = seat;
    ch.vehicleSeat = seat === 0 ? 'driver' : 'passenger';
    ch.flying = false;
    ch.build.active = false; ch.build.edit = null;
    ch.mining = null; ch.reload = null; ch.using = null;
    ch.yaw = v.yaw;
    game.events.emit('vehicleEnter', { character: ch, vehicle: v, seat });
    return true;
  },

  /** Puts the character next to the vehicle (first free spot). force: also when no spot is free. */
  exit(game, ch, force) {
    const v = ch.vehicle;
    if (!v) return false;
    const [L, W] = v.spec.size, p = new THREE.Vector3();
    const spots = [[-(W / 2 + 0.7), 0, 0], [W / 2 + 0.7, 0, 0], [0, 0, -(L / 2 + 0.8)], [0, 0, L / 2 + 0.8], [0, v.spec.size[2] + 0.2, 0]];
    let ok = false;
    for (const [x, y, z] of spots) {
      v.local(x, y + 0.05, z, p);
      if (Vehicles.fits(game, p)) { ok = true; break; }
    }
    if (!ok && !force) return false;
    if (!ok) v.local(0, v.spec.size[2] + 0.2, 0, p);
    v.seats[ch.seatIndex] = null;
    ch.vehicle = null; ch.vehicleSeat = null; ch.seatIndex = -1;
    ch.teleport(p.x, p.y, p.z);
    ch.vel.copy(v.vel).multiplyScalar(0.5);
    game.events.emit('vehicleExit', { character: ch, vehicle: v });
    return true;
  },

  switchSeat(game, ch) {
    const v = ch.vehicle;
    if (!v) return false;
    const n = v.seats.length;
    for (let k = 1; k < n; k++) {
      const s = (ch.seatIndex + k) % n;
      if (v.seats[s] === null) {
        v.seats[ch.seatIndex] = null;
        v.seats[s] = ch.id;
        ch.seatIndex = s;
        ch.vehicleSeat = s === 0 ? 'driver' : 'passenger';
        ch.reload = null;
        game.events.emit('seatChanged', { character: ch, vehicle: v, seat: s });
        return true;
      }
    }
    return false;
  },

  /** Would a character box fit at feet position p? */
  fits(game, p) {
    const hw = CONFIG.PLAYER.WIDTH / 2, w = game.world;
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + CONFIG.PLAYER.HEIGHT - 0.01); y++)
      for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]])
        if (w.isSolid(Math.floor(p.x + ox), y, Math.floor(p.z + oz))) return false;
    return true;
  },
};
