/* ============================================================
 * Loot: what chests and floor spawns contain, opening chests, and
 * picking up weapons.
 *
 * All rolls are deterministic: the RNG is seeded from the world seed
 * and the loot's position, so a given seed always has the same chests
 * in the same places with the same contents (also for netcode).
 *
 * Chests are placed by the terrain worker (one block id). Floor loot
 * is spawned when a chunk is generated for the first time.
 * Ammo, consumables and materials are collected by walking over them;
 * weapons need E (and swap with the held weapon when you already
 * carry CONFIG.MAX_WEAPONS).
 * ============================================================ */
const Loot = {
  rng(game, x, y, z, salt) {
    let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791) ^ Math.imul(game.seed, 2654435761) ^ (salt | 0);
    return new Rng(h);
  },

  weighted(rng, weights) {
    const keys = Object.keys(weights);
    let total = 0;
    for (const k of keys) total += weights[k];
    let r = rng.next() * total;
    for (const k of keys) { r -= weights[k]; if (r < 0) return k; }
    return keys[keys.length - 1];
  },

  rollRarity(rng, source) {
    const w = CONFIG.LOOT.RARITY_WEIGHTS[source];
    return +this.weighted(rng, Object.assign({}, w));
  },

  /** A weapon plus a fitting amount of its ammo. */
  rollWeapon(rng, source) {
    const cls = this.weighted(rng, CONFIG.LOOT.WEAPON_WEIGHTS);
    const w = makeWeapon(cls, this.rollRarity(rng, source));
    const ammoId = CONFIG.WEAPONS[cls].ammo;
    return [w, makeStack(ammoId, CONFIG.LOOT.AMMO_WITH_WEAPON[ammoId])];
  },

  rollConsumable(rng) {
    const id = this.weighted(rng, CONFIG.LOOT.CONSUMABLE_WEIGHTS);
    return makeStack(id, id === 'bandage' ? 5 : 1);
  },

  rollAmmo(rng) {
    const ids = Object.keys(CONFIG.LOOT.AMMO_WITH_WEAPON);
    const id = rng.pick(ids);
    return makeStack(id, CONFIG.LOOT.AMMO_WITH_WEAPON[id]);
  },

  rollMaterial(rng) {
    const [id, n] = rng.pick(CONFIG.LOOT.MATERIALS);
    return makeStack(id, n);
  },

  /** Contents of the chest at a block position. */
  chestContents(game, x, y, z) {
    const rng = this.rng(game, x, y, z, 0xC0FFEE);
    const out = this.rollWeapon(rng, 'chest');
    out.push(this.rollConsumable(rng));
    out.push(rng.chance(0.5) ? this.rollAmmo(rng) : this.rollMaterial(rng));
    if (rng.chance(0.35)) out.push(this.rollMaterial(rng));
    return out;
  },

  /** One floor spawn (may be several stacks: weapon + ammo). */
  floorContents(game, x, y, z) {
    const rng = this.rng(game, x, y, z, 0xF100F);
    switch (this.weighted(rng, CONFIG.LOOT.FLOOR_KIND_WEIGHTS)) {
      case 'weapon': return this.rollWeapon(rng, 'floor');
      case 'consumable': return [this.rollConsumable(rng)];
      case 'ammo': return [this.rollAmmo(rng)];
      default: return [this.rollMaterial(rng)];
    }
  },

  openChest(game, ch, x, y, z) {
    if (game.world.getBlock(x, y, z) !== BLOCK.CHEST) return false;
    game.world.setBlock(x, y, z, BLOCK.AIR);
    const items = this.chestContents(game, x, y, z);
    for (const s of items) {
      const d = ItemDrop.pop(game, s, x + 0.5, y + 0.6, z + 0.5);
      d.persistent = true;
    }
    game.events.emit('chestOpened', { x, y, z, by: ch, count: items.length });
    return true;
  },

  /** Floor loot for a freshly generated chunk (called once per chunk per game). */
  spawnFloorLoot(game, cx, cz) {
    const rng = this.rng(game, cx, 0, cz, 0xF1001);
    if (!rng.chance(game.rules.floorChance ?? CONFIG.LOOT.FLOOR_CHANCE)) return;
    const x = cx * 16 + rng.int(2, 13), z = cz * 16 + rng.int(2, 13);
    if (game.rules.island && Math.hypot(x, z) > CONFIG.ISLAND.RADIUS) return;
    const w = game.world;
    for (let y = CONFIG.CHUNK_HEIGHT - 2; y > CONFIG.SEA_LEVEL; y--) {
      const b = w.getBlock(x, y, z);
      if (b <= 0) continue;
      if (!BlockTables.solid[b] || b === BLOCK.LEAVES || b === BLOCK.CHEST) return;
      if (w.getBlock(x, y + 1, z) !== BLOCK.AIR || w.getBlock(x, y + 2, z) !== BLOCK.AIR) return;
      const items = this.floorContents(game, x, y + 1, z);
      items.forEach((s, i) => {
        const d = game.addEntity(new ItemDrop(s, x + 0.5 + i * 0.35, y + 1.2, z + 0.5));
        d.persistent = true;
        d.pickupDelay = 0;
      });
      return;
    }
  },

  /** Nearest weapon drop within reach that needs E to pick up. */
  nearestManualDrop(game, ch) {
    let best = null, bestD = CONFIG.LOOT.PICKUP_RANGE;
    for (const e of game.entities.values()) {
      if (e.type !== 'drop' || e.removed || !e.manual) continue;
      const d = Math.hypot(e.pos.x - ch.pos.x, e.pos.y - (ch.pos.y + 0.6), e.pos.z - ch.pos.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    return best;
  },

  /** E on a weapon drop: take it, swapping with the held weapon when at the weapon cap. */
  pickUpManual(game, ch, drop) {
    const inv = ch.inventory;
    if (inv.spaceFor(drop.stack) > 0) {
      inv.add(drop.stack);
      drop.removed = true;
      game.events.emit('pickup', { character: ch, item: drop.stack.id, count: 1, stack: drop.stack });
      return true;
    }
    const held = ch.heldStack();
    if (held && ITEMS[held.id].kind === 'weapon' && (!inv.slotFits || inv.slotFits(ch.selectedSlot, drop.stack))) {
      const dropped = game.addEntity(new ItemDrop(held, ch.pos.x, ch.pos.y + 0.5, ch.pos.z));
      dropped.pickupDelay = 1;
      dropped.persistent = true;
      inv.set(ch.selectedSlot, drop.stack);
      drop.removed = true;
      ch.reload = null;
      game.events.emit('pickup', { character: ch, item: drop.stack.id, count: 1, stack: drop.stack, swapped: true });
      return true;
    }
    game.events.emit('pickupRefused', { character: ch, item: drop.stack.id });
    return false;
  },
};
