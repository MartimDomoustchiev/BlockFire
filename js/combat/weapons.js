/* ============================================================
 * Guns.
 *
 * A weapon is a non-stacking ItemStack { id: 'w_<class>', count: 1,
 * data: { rarity: 0..4, mag } }. Its stats are the class stats from
 * CONFIG.WEAPONS scaled by the rarity multipliers in CONFIG.RARITY.
 *
 * Per-tick weapon logic for a Character (all driven by its Intent):
 *   - fire cadence is exact at 60 Hz: a cooldown accumulator lets a
 *     5.5 shots/s rifle fire 55 shots in 10 s, never 50 or 60;
 *   - semi-automatic guns fire on click, with a short input buffer;
 *   - spread = (base + moving + airborne) * ADS factor + bloom;
 *     bloom grows per shot and recovers over time;
 *   - recoil kicks the aim upward and recovers;
 *   - reload moves ammo items from the inventory into the magazine;
 *   - bows draw while the trigger is held and loose on release
 *     (ch.draw 0..1 scales the arrow's speed and damage).
 * Hitscan / projectiles / damage live in combat/damage.js.
 * ============================================================ */
const WEAPON_ITEM = {};          // class -> item id
for (const cls of Object.keys(CONFIG.WEAPONS)) {
  const w = CONFIG.WEAPONS[cls];
  WEAPON_ITEM[cls] = defItem('w_' + cls, { kind: 'weapon', maxStack: 1, name: w.name, weapon: { cls }, thrown: !!w.thrown, bow: !!w.bow }).id;
}
for (const id of Object.keys(CONFIG.CONSUMABLES)) {
  const c = CONFIG.CONSUMABLES[id];
  defItem(id, { kind: 'consumable', name: c.name, maxStack: c.maxStack, consumable: c, rarity: c.rarity });
}

/** A fresh weapon stack with a full magazine. */
function makeWeapon(cls, rarity) {
  rarity = Math.max(0, Math.min(CONFIG.RARITY.length - 1, rarity | 0));
  return { id: WEAPON_ITEM[cls], count: 1, data: { rarity, mag: Weapons.stats(cls, rarity).mag } };
}

const Weapons = {
  _cache: new Map(),

  /** Effective stats for a class at a rarity (cached). */
  stats(cls, rarity) {
    const key = cls + ':' + rarity;
    let s = this._cache.get(key);
    if (s) return s;
    const b = CONFIG.WEAPONS[cls], r = CONFIG.RARITY[rarity];
    s = Object.assign({}, b, {
      cls, rarity,
      damage: b.damage * r.damage,
      interval: 1 / (b.fireRate * r.fireRate),
      spread: b.spread * r.spread,
      pelletSpread: b.pelletSpread * r.spread,
      mag: Math.max(1, Math.round(b.mag * r.mag)),
      reload: b.reload * r.reload,
    });
    this._cache.set(key, s);
    return s;
  },

  /** Stats for a held stack, or null if it isn't a weapon. */
  of(stack) {
    const it = stack && ITEMS[stack.id];
    return it && it.weapon ? this.stats(it.weapon.cls, stack.data.rarity) : null;
  },

  label(stack) {
    const st = this.of(stack);
    return st ? CONFIG.RARITY[st.rarity].name + ' ' + st.name : stackLabel(stack);
  },

  reserve(game, ch, st) {
    return game.rules.infiniteAmmo ? Infinity : ch.inventory.count(st.ammo);
  },

  /** Current spread half-angle in radians. */
  spread(ch, st) {
    const moving = Math.hypot(ch.vel.x, ch.vel.z) > 0.5;
    let s = st.spread + (moving ? st.moveSpread : 0) + (ch.onGround || ch.flying ? 0 : st.airSpread);
    const ads = ch.adsT;
    s *= 1 - ads + ads * st.adsSpread;
    return s + ch.bloom;
  },

  update(ch, it, dt, game, building) {
    const C = CONFIG.COMBAT;
    ch.recoil *= Math.exp(-C.RECOIL_RECOVER * dt);
    const held = ch.heldStack();
    const st = building ? null : this.of(held);
    if (!st || ch.vehicleSeat === 'driver') {
      ch.adsT = Math.max(0, ch.adsT - C.ADS_SPEED * dt);
      ch.reload = null;
      ch.bloom = 0;
      ch.fireCd = 0;
      ch.draw = 0;
      return;
    }
    ch.adsT += Math.max(-C.ADS_SPEED * dt, Math.min(C.ADS_SPEED * dt, (it.aim ? 1 : 0) - ch.adsT));
    ch.bloom = Math.max(0, ch.bloom - st.bloomRecover * dt);
    ch.fireCd -= dt;

    // --- reload ---
    if (ch.reload && ch.reload.slot !== ch.selectedSlot) ch.reload = null;
    if (ch.reload) {
      ch.reload.t -= dt;
      if (ch.reload.t <= 1e-9) {
        const need = st.mag - held.data.mag;
        const got = game.rules.infiniteAmmo ? need : ch.inventory.remove(st.ammo, need);
        held.data.mag += got;
        ch.reload = null;
        ch.inventory.touch();
        game.events.emit('reloaded', { character: ch, cls: st.cls });
      }
    } else if (it.reload && held.data.mag < st.mag && this.reserve(game, ch, st) > 0) {
      this.startReload(ch, st, game);
    }

    if (st.bow) { this._bow(ch, st, held, it, dt, game); return; }
    ch.draw = 0;

    // --- trigger ---
    if (it.firePressed) ch.shotQueuedAt = game.time;
    const wants = st.auto ? it.fire : (game.time - ch.shotQueuedAt <= C.SEMI_BUFFER);
    if (!wants) { ch.fireCd = Math.max(ch.fireCd, 0); return; }
    if (ch.reload) return;
    if (held.data.mag <= 0) {
      if (this.reserve(game, ch, st) > 0) this.startReload(ch, st, game);
      else if (it.firePressed) game.events.emit('dryFire', { character: ch, cls: st.cls });
      ch.fireCd = Math.max(ch.fireCd, 0);
      return;
    }
    let shots = 0;
    while (ch.fireCd <= 1e-9 && held.data.mag > 0 && shots < 4) {
      this.fire(ch, st, held, game);
      held.data.mag--;
      ch.fireCd += st.interval;
      shots++;
      if (!st.auto) { ch.shotQueuedAt = -Infinity; break; }
    }
    if (shots) {
      ch.inventory.touch();
      if (held.data.mag <= 0 && this.reserve(game, ch, st) > 0) this.startReload(ch, st, game);
    }
  },

  /** Bow: hold to draw, release to loose (a too-short tug just lowers the bow). */
  _bow(ch, st, held, it, dt, game) {
    const B = st.bow;
    if (ch.reload || held.data.mag <= 0) {
      ch.draw = 0;
      if (!ch.reload && held.data.mag <= 0) {
        if (this.reserve(game, ch, st) > 0) this.startReload(ch, st, game);
        else if (it.firePressed) game.events.emit('dryFire', { character: ch, cls: st.cls });
      }
      return;
    }
    if (it.fire) {
      if (!ch.draw) game.events.emit('bowDraw', { character: ch });
      ch.draw = Math.min(1, (ch.draw || 0) + dt / B.draw);
      return;
    }
    const p = ch.draw || 0;
    ch.draw = 0;
    if (p < B.min) return;
    this.fire(ch, this.drawn(st, p), held, game);
    held.data.mag--;
    ch.inventory.touch();
    if (this.reserve(game, ch, st) > 0) this.startReload(ch, st, game);
  },

  /** A bow's stats for one arrow loosed at draw `p` (0..1). */
  drawn(st, p) {
    const B = st.bow, k = (p - B.min) / (1 - B.min);
    return Object.assign({}, st, {
      damage: st.damage * (B.damageMin + (1 - B.damageMin) * k),
      projectile: { speed: st.projectile.speed * (B.speedMin + (1 - B.speedMin) * k), gravity: st.projectile.gravity },
      power: p,
    });
  },

  startReload(ch, st, game) {
    ch.reload = { slot: ch.selectedSlot, t: st.reload, total: st.reload };
    game.events.emit('reloadStart', { character: ch, cls: st.cls });
  },

  /** One trigger pull: every pellet becomes a hitscan ray or a projectile. */
  fire(ch, st, held, game) {
    // a remote player shot at what they saw ~latency ago: test targets where they were then
    Combat.rewindTo = ch.netRemote && ch.netLag ? game.time - ch.netLag : null;
    try { this._fire(ch, st, held, game); } finally { Combat.rewindTo = null; }
  },

  _fire(ch, st, held, game) {
    const o = ch.eyePos(new THREE.Vector3());
    const aim = ch.aimDir(new THREE.Vector3());
    const cone = this.spread(ch, st);
    const ends = [];
    for (let p = 0; p < st.pellets; p++) {
      const d = this.jitter(aim, st.pellets > 1 ? Math.max(cone, st.pelletSpread) : cone, game.rng);
      if (st.projectile) {
        game.addEntity(new Projectile(ch, st, o, d));
      } else {
        ends.push(Combat.hitscan(game, ch, o, d, st));
      }
    }
    ch.bloom = Math.min(st.bloomMax, ch.bloom + st.bloom);
    ch.recoil += st.recoil * (1 - 0.4 * ch.adsT);
    ch.yaw += game.rng.float(-1, 1) * st.recoil * 0.25;
    game.events.emit('shot', { character: ch, cls: st.cls, rarity: st.rarity, origin: o, ends });
  },

  /** Random direction inside a cone of half-angle `angle` around unit vector `d` (uniform over the disc). */
  jitter(d, angle, rng) {
    if (angle <= 0) return d.clone();
    const r = angle * Math.sqrt(rng.next()), phi = rng.next() * Math.PI * 2;
    // orthonormal basis around d
    const up = Math.abs(d.y) < 0.99 ? Weapons._up : Weapons._x;
    const u = new THREE.Vector3().crossVectors(d, up).normalize();
    const v = new THREE.Vector3().crossVectors(d, u);
    const s = Math.sin(r);
    return new THREE.Vector3()
      .copy(d).multiplyScalar(Math.cos(r))
      .addScaledVector(u, s * Math.cos(phi))
      .addScaledVector(v, s * Math.sin(phi))
      .normalize();
  },
};
Weapons._up = new THREE.Vector3(0, 1, 0);
Weapons._x = new THREE.Vector3(1, 0, 0);
