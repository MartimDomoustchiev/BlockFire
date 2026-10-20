/* ============================================================
 * Blades (story mode): the Order's wrist blade and the enforcers'
 * sabres. Pure sim, driven by the holder's Intent like guns.
 *
 *  - Wrist blade, click: the nearest person in front within reach.
 *    If they don't see it coming (unaware of you, struck from behind,
 *    choking on smoke, or caught winding up a swing - a counter) it's
 *    a silent takedown; otherwise a quick stab.
 *  - Falling onto someone below (air assassination) always kills,
 *    and the victim breaks your fall.
 *  - Sabres wind up for a moment before the cut lands (the tell
 *    that lets players counter or step back).
 *  - The Order's sword: cuts in a 3-step combo (the third hits
 *    hardest; someone who doesn't see it coming dies to one cut),
 *    right mouse raises a block. A block raised just before a sabre
 *    lands is a parry - the attacker staggers, open to a finisher.
 *    Guards fighting you sometimes block a cut from the front.
 * ============================================================ */
const Blade = {
  spec(ch) {
    const s = ch.heldStack(), it = s && ITEMS[s.id];
    return it && it.kind === 'blade' ? it.blade : null;
  },

  update(ch, it, dt, game) {
    ch.bladeCd = Math.max(0, (ch.bladeCd || 0) - dt);
    // the sword's block (right mouse)
    const held = this.spec(ch);
    const blocking = !!(held && held.block && it.aim && ch.alive && !ch.vehicle && !ch.climbing);
    if (blocking && !ch.blocking) ch.blockSince = game.time;
    ch.blocking = blocking;
    if (ch.windup) {
      ch.windup.t -= dt;
      if (ch.windup.t <= 0) { const w = ch.windup; ch.windup = null; this.cut(game, ch, w.spec); }
      return;
    }
    const spec = held;
    if (!spec || !it.firePressed || ch.bladeCd > 0 || ch.vehicle || ch.blocking) return;
    ch.bladeCd = spec.cooldown;
    if (spec.combo) { this.swing(game, ch, spec); return; }
    if (spec.windup) {
      ch.windup = { t: spec.windup, spec };
      ch.strikeUntil = game.time + spec.windup + 0.3;
      game.events.emit('strike', { character: ch, windup: true });
      return;
    }
    ch.strikeUntil = game.time + 0.3;
    game.events.emit('strike', { character: ch });
    const air = spec.assassinate && !ch.onGround && !ch.climbing && ch.vel.y < -1;
    const target = air ? this.below(game, ch) : this.inFront(game, ch, spec.range);
    if (!target) return;
    if (spec.assassinate && (air || Stealth.canAssassinate(game, ch, target))) this.assassinate(game, ch, target, air);
    else this.hit(game, ch, target, spec.damage, 'blade');
  },

  /** A sabre swing lands (after its wind-up) on whoever is still in reach. */
  cut(game, ch, spec) {
    const t = this.inFront(game, ch, spec.range + 0.4);
    if (t) this.hit(game, ch, t, spec.damage, 'sword');
  },

  /** The Order's sword: one cut of the combo, landing at once. */
  swing(game, ch, spec) {
    const S = CONFIG.STORY.SWORD;
    ch.combo = game.time - (ch.lastCut || -9) < S.COMBO_GAP ? ((ch.combo || 0) + 1) % 3 : 0;
    ch.lastCut = game.time;
    ch.strikeUntil = game.time + 0.3;
    game.events.emit('strike', { character: ch, swing: ch.combo });
    const t = this.inFront(game, ch, spec.range);
    if (!t) return;
    // someone who doesn't see it coming (or is staggered, or mid-swing) falls to one cut - but it's no quiet kill
    if (t.npc && Stealth.canAssassinate(game, ch, t)) {
      game.events.emit('swordKill', { character: ch, victim: t });
      Combat.applyDamage(game, t, 9999, { attacker: ch, cls: 'sword', kind: 'melee' });
      return;
    }
    this.hit(game, ch, t, spec.damage * (ch.combo === 2 ? S.FINISHER : 1), 'sword');
  },

  /** Is `a` within `t`'s block arc (in front of them)? */
  facing(t, a) {
    const dx = a.pos.x - t.pos.x, dz = a.pos.z - t.pos.z, L = Math.hypot(dx, dz);
    if (L < 1e-6) return true;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * -Math.sin(t.yaw) + dz * -Math.cos(t.yaw)) / L)));
    return ang < CONFIG.STORY.SWORD.BLOCK_ARC;
  },

  /** A melee blow from `a` lands on `t`: blocked, parried or taken. */
  hit(game, a, t, dmg, cls) {
    const S = CONFIG.STORY.SWORD;
    // a player's raised sword
    if (t.blocking && this.facing(t, a)) {
      if (game.time - (t.blockSince || 0) <= S.PARRY && a.npc) {
        a.windup = null;
        a.stunnedUntil = game.time + S.STAGGER;
        game.events.emit('parry', { character: t, attacker: a });
        return;
      }
      game.events.emit('blocked', { character: t, attacker: a });
      dmg *= S.BLOCK;
    } else if (cls === 'sword' && t.npcRole === 'guard' && t.controller && t.controller.state === 'combat' && !t.windup &&
      (t.stunnedUntil || 0) <= game.time && this.facing(t, a) && game.rng.next() < S.GUARD_BLOCK) {
      // a guard in a fight turns the cut aside with his sabre
      game.events.emit('blocked', { character: t, attacker: a });
      return;
    }
    Combat.applyDamage(game, t, dmg, { attacker: a, cls, kind: 'melee' });
  },

  assassinate(game, ch, target, air) {
    if (air) {
      // drop onto them: land where they stood, the fall is broken
      ch.teleport(target.pos.x, target.pos.y, target.pos.z);
      ch.fallTop = null;
      ch.vel.set(0, 0, 0);
    }
    game.events.emit('assassination', { character: ch, victim: target, air: !!air });
    Combat.applyDamage(game, target, 9999, { attacker: ch, cls: 'blade', kind: 'assassination', ignoreShield: true });
  },

  /**
   * Who a swing would hit: alive, not on our side, within `range`, about our height, no wall between us -
   * the one closest to where we're looking (not just the nearest: the bystander next to your target is
   * safe unless you aim right at them).
   */
  inFront(game, ch, range) {
    let best = null, bestScore = Infinity;
    const fx = -Math.sin(ch.yaw), fz = -Math.cos(ch.yaw);
    for (const c of game.characters()) {
      if (c === ch || !c.alive || (ch.team && c.team === ch.team)) continue;
      const dx = c.pos.x - ch.pos.x, dz = c.pos.z - ch.pos.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(c.pos.y - ch.pos.y) > 1.6) continue;
      const ang = d > 0.4 ? Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) : 0;
      if (ang > 1.1) continue;
      const innocent = c.npcRole === 'villager' || (c.npc && c.team === 3);
      if (innocent && ch.isHuman && ang > 0.35) continue;
      const score = ang * 2 + d * 0.15 + (innocent ? 0.6 : 0);
      if (score >= bestScore || !this.reach(game, ch, c)) continue;
      best = c; bestScore = score;
    }
    return best;
  },

  /**
   * Can a's arm reach b? Blades don't go through walls or palisades, but they do reach around a post:
   * any of three parallel lines (centre, either shoulder) clear of solid blocks will do.
   */
  reach(game, a, b) {
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, L = Math.hypot(dx, dz);
    if (L < 0.5) return true;
    const px = -dz / L, pz = dx / L, dir = Blade._d.set(dx / L, 0, dz / L);
    const solid = (id) => BlockTables.solid[id] === 1 && id !== BLOCK.LEAVES;
    for (const off of [0, 0.3, -0.3]) {
      const o = Blade._o.set(a.pos.x + px * off, a.pos.y + 1.1, a.pos.z + pz * off);
      const hit = raycastBlocks(game.world, o, dir, L, { filter: solid });
      if (!hit || hit.dist >= L - 0.35) return true;
    }
    return false;
  },

  /** Air assassination target: someone below us within reach. */
  below(game, ch) {
    const A = CONFIG.STORY.AIR_KILL;
    let best = null, bd = A.RANGE;
    for (const c of game.characters()) {
      if (c === ch || !c.alive || (ch.team && c.team === ch.team)) continue;
      const drop = ch.pos.y - c.pos.y;
      if (drop < A.DROP_MIN || drop > A.DROP_MAX) continue;
      const d = Math.hypot(c.pos.x - ch.pos.x, c.pos.z - ch.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  },

  /** For the HUD: who a click would take down right now (or null). */
  takedownTarget(game, ch) {
    const spec = this.spec(ch);
    if (!spec || !(spec.assassinate || spec.combo) || !ch.alive) return null;
    if (spec.assassinate && !ch.onGround && !ch.climbing && ch.vel.y < -1) return this.below(game, ch);
    const t = this.inFront(game, ch, spec.range + 0.6);
    return t && (game.replica ? !!t.npcRole && (t.awMe || 0) < 1 : Stealth.canAssassinate(game, ch, t)) ? t : null;
  },
};
Blade._o = new THREE.Vector3(); Blade._d = new THREE.Vector3();
