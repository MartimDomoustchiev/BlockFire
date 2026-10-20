/* ============================================================
 * Stealth rules (story mode, host side).
 *
 * Guards see in a cone; walls, hay and smoke block sight (glass,
 * bars and leaves don't). How fast a guard becomes aware of a player
 * depends on distance and on what the player is doing where:
 *   - in a camp or inside the keep walls you're trespassing: anyone
 *     seen there is suspect;
 *   - in a village or on the road you're one more face in the crowd,
 *     unless you climb, run, fight or are notorious;
 *   - sneaking halves it, walking among villagers nearly hides you,
 *     hay and bushes hide you completely (unless a searcher is right
 *     next to you).
 * Violence that a guard sees, gunshots it hears and bodies it finds
 * all raise the alarm.
 * ============================================================ */
// what blocks a line of sight: walls, hay and foliage (you can hide behind a tree); glass and bars don't
const SIGHT_STOPS = (b) => b === BLOCK.HAY || b === BLOCK.LEAVES ||
  (BlockTables.solid[b] === 1 && b !== BLOCK.GLASS && b !== BLOCK.BARS);

const Stealth = {
  BARKS: {
    suspicious: ['Hm? Who goes there?', 'Did something move?', 'Show yourself!', 'Is someone there?'],
    climb: ['Oi! Get down from there!', 'Off the roof, you!', 'What are you doing up there?'],
    combat: ['Intruder!', 'There! Get them!', 'To arms!', 'Stop right there!'],
    search: ['Where did they go?', 'Spread out, find them!', 'Check the hay!', 'They can\'t have gone far.'],
    calm: ['Must have been the wind.', 'Back to my post.', 'Nothing here.', 'Gone. For now.'],
    body: ['A body! Sound the alarm!', 'Murder! Find the killer!', 'Man down! Search the area!'],
    scream: ['Help! Murder!', 'Guards! Guards!', 'Run!'],
  },

  /** Who guards hunt: living players, and prisoners escaping with them. */
  humans(game) { return game.characters().filter((c) => (c.isHuman || c.fugitive) && c.alive); },

  isNight(game) { const t = game.timeOfDay; return t < 0.22 || t > 0.8; },

  /** Restricted ground: inside a camp's palisade or the keep's walls. */
  restricted(game, x, z, margin = 0) {
    const plan = game.story && game.story.plan;
    if (!plan) return false;
    for (const s of plan.camps) if (Math.abs(x - s.x) <= 12.5 + margin && Math.abs(z - s.z) <= 12.5 + margin) return true;
    const k = plan.keep;
    return Math.abs(x - k.x) <= 20.5 + margin && Math.abs(z - k.z) <= 20.5 + margin;
  },

  smokeAt(game, p) {
    for (const e of game.entities.values()) if (e.type === 'smoke' && e.contains(p)) return e;
    return null;
  },

  /** Can `from` (an eye position) see the point `to`? Blocks, hay and smoke stop sight. */
  lineOfSight(game, from, to) {
    const d = Stealth._d.copy(to).sub(from), dist = d.length();
    if (dist < 1e-3) return true;
    d.divideScalar(dist);
    const hit = raycastBlocks(game.world, from, d, dist, { filter: SIGHT_STOPS });
    if (hit && hit.dist < dist - 0.3) return false;
    for (const e of game.entities.values()) if (e.type === 'smoke' && e.blocks(from, to)) return false;
    return true;
  },

  /** Is a character with these flags doing something a guard would find suspicious? Multiplier for awareness. */
  suspicion(game, guard, p) {
    const A = CONFIG.STORY.AWARE, story = game.story;
    const restricted = this.restricted(game, p.pos.x, p.pos.z);
    // inside: trespassing; loitering right outside the walls: watched; anywhere else: one more face
    let k = restricted ? A.TRESPASS : this.restricted(game, p.pos.x, p.pos.z, A.APPROACH) ? A.LOITER : A.PUBLIC;
    if (p.climbing) k = Math.max(k, A.CLIMB);
    if (p.sprinting) k = Math.max(k, restricted ? A.TRESPASS * A.SPRINT : 0.5);
    const n = story ? story.notoriety : 0;
    if (n > 0) k = Math.max(k, n * A.NOTORIETY);
    const held = p.heldStack(), it = held && ITEMS[held.id];
    if (it && it.kind === 'weapon' && !it.thrown && (!it.bow || p.draw > 0.3)) k = Math.max(k, 0.6);   // a gun in hand, a drawn bow
    if (p.strikeUntil !== undefined && game.time < p.strikeUntil + 0.8) k = Math.max(k, 3);   // mid-attack
    if (p.sneaking) k *= A.SNEAK;
    if (p.blending && !restricted) k *= A.BLEND;
    return k;
  },

  /**
   * How far a guard's awareness may go: in public (villages, roads), climbing or running only makes them
   * suspicious - they watch, come over and shout. They attack when you trespass, turn violent, or are notorious.
   */
  awarenessCap(game, p) {
    if (this.restricted(game, p.pos.x, p.pos.z)) return 1;
    if ((game.story ? game.story.notoriety : 0) >= 2) return 1;
    const t = game.time;
    if ((p.strikeUntil !== undefined && t < p.strikeUntil + 2) || (p.lastShotAt !== undefined && t < p.lastShotAt + 3)) return 1;
    const held = p.heldStack(), it = held && ITEMS[held.id];
    if (it && it.kind === 'weapon' && !it.thrown && (it.bow ? p.draw > 0.3 : p.adsT > 0.5)) return 1;   // aiming a gun / bow at people
    return 0.95;
  },

  /** Would the wrist blade kill `victim` outright? (unaware of the attacker, from behind, stunned, mid-swing) */
  canAssassinate(game, attacker, victim) {
    if (!victim.npc || !victim.alive) return false;
    if ((victim.stunnedUntil || 0) > game.time || victim.windup) return true;
    const ctl = victim.controller;
    const aware = ctl && ctl.awareOf ? ctl.awareOf(attacker) : 0;
    if (aware < 1 || (ctl && ctl.state !== 'combat')) return true;
    // facing away from the attacker
    const dx = attacker.pos.x - victim.pos.x, dz = attacker.pos.z - victim.pos.z;
    const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / Math.max(1e-6, Math.hypot(dx, dz)))));
    return ang > CONFIG.STORY.BEHIND_ANGLE;
  },

  /** Guards near `pos` turn on `target` (or come to look). */
  alert(game, from, target, pos) {
    const R = CONFIG.STORY.AWARE.CALL_RANGE;
    for (const g of game.characters()) {
      if (!g.alive || g.npcRole !== 'guard' || g === from || g.dormant) continue;
      if (g.pos.distanceTo(pos) > R) continue;
      g.controller.callTo(game, g, target, pos);
    }
  },

  /** A loud noise (gunshot, scream): guards in range come to look; any who can see the culprit attack. */
  noise(game, pos, range, culprit) {
    for (const g of game.characters()) {
      if (!g.alive || g.npcRole !== 'guard' || g.dormant) continue;
      if (g.pos.distanceTo(pos) > range) continue;
      g.controller.hear(game, g, pos, culprit);
    }
  },

  /** Somebody attacked somebody: guards and villagers who saw it react. */
  witness(game, attacker, victim) {
    if (!attacker || !attacker.isHuman) return;
    const eyeA = attacker.eyePos(new THREE.Vector3()), eyeV = victim.eyePos(new THREE.Vector3());
    for (const c of game.characters()) {
      if (!c.alive || !c.npc || c === victim || c.dormant) continue;
      const d = c.pos.distanceTo(attacker.pos);
      if (d > 26) continue;
      const eye = c.eyePos(new THREE.Vector3());
      const sawIt = (this.inCone(c, attacker.pos, d) && this.lineOfSight(game, eye, eyeA)) ||
        (this.inCone(c, victim.pos, c.pos.distanceTo(victim.pos)) && this.lineOfSight(game, eye, eyeV));
      if (!sawIt) continue;
      if (c.npcRole === 'guard') c.controller.callTo(game, c, attacker, attacker.pos.clone(), true);
      else if (c.npcRole === 'villager' && c.controller.scare) c.controller.scare(game, c, attacker.pos);
    }
  },

  /** Is point `p` (distance `d`) in `ch`'s view cone? Anyone very close is sensed anyway - less close when sneaking. */
  inCone(ch, p, d, sneaking) {
    const V = CONFIG.STORY.VISION;
    if (d < (sneaking ? V.CLOSE_SNEAK : V.CLOSE)) return true;
    const dx = p.x - ch.pos.x, dz = p.z - ch.pos.z, L = Math.hypot(dx, dz);
    if (L < 1e-6) return true;
    const fx = -Math.sin(ch.yaw), fz = -Math.cos(ch.yaw);
    return Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / L))) < V.FOV;
  },

  bark(game, ch, kind) {
    const list = this.BARKS[kind];
    if (!list || game.time < (ch.barkAt || 0)) return;
    ch.barkAt = game.time + 4;
    game.events.emit('bark', { character: ch, text: list[Math.floor(game.rng.next() * list.length)], kind });
  },
};
Stealth._d = new THREE.Vector3();
