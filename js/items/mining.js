/* ============================================================
 * Mining + placing rules.
 *
 * Break time (seconds):
 *   hardness * HARVEST_MULT      when the held item can harvest the block
 *   hardness * NO_HARVEST_MULT   when the block needs a better tool (no drop)
 *   ... divided by the tool's speed if it is the right tool type.
 * A block can be harvested when it needs no tool (tier 0) or the held
 * tool is the right type with level >= the block's tier.
 * ============================================================ */
const Mining = {
  /** { time, canHarvest, effective, tool } for `ch` breaking block `id`. */
  info(ch, id) {
    const def = BLOCK_DEFS[id];
    if (!def || def.hardness < 0 || def.liquid || id === BLOCK.AIR) return { time: Infinity, canHarvest: false, effective: false, tool: null };
    const held = ch.heldStack();
    const tool = held && ITEMS[held.id] && ITEMS[held.id].tool ? ITEMS[held.id].tool : null;
    const effective = !!(tool && def.tool && tool.type === def.tool);
    const canHarvest = def.tier === 0 || (effective && tool.level >= def.tier);
    const M = CONFIG.MINING;
    let time = def.hardness * (canHarvest ? M.HARVEST_MULT : M.NO_HARVEST_MULT);
    if (effective) time /= tool.speed;
    if (def.hardness > 0) time = Math.max(M.MIN_TIME, time);
    return { time, canHarvest, effective, tool };
  },

  breakTime(ch, id) { return this.info(ch, id).time; },

  /** Item stacks dropped when `ch` breaks block `id` (rng = game.rng). */
  drops(ch, id, rng) {
    if (!this.info(ch, id).canHarvest) return [];
    switch (id) {
      case BLOCK.GRASS: return [makeStack('dirt', 1)];
      case BLOCK.GLASS: return [];
      case BLOCK.LEAVES: return rng.chance(CONFIG.MINING.LEAF_STICK_CHANCE) ? [makeStack('stick', 1)] : [];
      default: return BLOCK_ITEM[id] ? [makeStack(BLOCK_ITEM[id], 1)] : [];
    }
  },

  /** Breaks the targeted block for `ch`: drops, block-entity contents, tool wear, events. */
  breakBlock(game, ch, t) {
    const w = game.world;
    const id = w.getBlock(t.x, t.y, t.z);
    if (id <= 0) return false;
    const drops = this.drops(ch, id, game.rng);
    if (!w.setBlock(t.x, t.y, t.z, BLOCK.AIR)) return false;
    Building.onBlockDestroyed(game, t.x, t.y, t.z);
    // containers spill their contents
    const be = w.getBlockEntity(t.x, t.y, t.z);
    if (be) {
      w.setBlockEntity(t.x, t.y, t.z, null);
      if (be.type === 'furnace') for (const s of Furnace.contents(be)) drops.push(s);
    }
    for (const s of drops) ItemDrop.pop(game, s, t.x + 0.5, t.y + 0.5, t.z + 0.5);
    // tool wear
    const held = ch.heldStack();
    if (held && held.data && held.data.dur !== undefined && BLOCK_DEFS[id].hardness > 0) {
      held.data.dur--;
      if (held.data.dur <= 0) {
        ch.inventory.set(ch.selectedSlot, null);
        game.events.emit('toolBroke', { character: ch, item: held.id });
      } else ch.inventory.touch();
    }
    game.events.emit('blockBroken', { x: t.x, y: t.y, z: t.z, block: id, by: ch });
    return true;
  },

  /** Can a block go into cell (x,y,z)? In the world, empty (air/water) and not inside any character. */
  canPlaceAt(game, x, y, z) {
    if (y < 0 || y >= CONFIG.CHUNK_HEIGHT) return false;
    const b = game.world.getBlock(x, y, z);
    if (b !== BLOCK.AIR && b !== BLOCK.WATER) return false;
    for (const e of game.entities.values()) {
      if (e.type === 'character' && e.alive && e.overlapsCell(x, y, z)) return false;
    }
    return true;
  },

  /** Places the block item from `slot` against the targeted face. Returns true on success. */
  placeBlock(game, ch, t, slot) {
    const s = ch.inventory.get(slot);
    const item = s && ITEMS[s.id];
    if (!item || item.kind !== 'block') return false;
    if (!t.nx && !t.ny && !t.nz) return false;          // looking from inside a block
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    if (!this.canPlaceAt(game, x, y, z)) return false;
    if (!game.world.setBlock(x, y, z, item.blockId)) return false;
    if (item.blockId === BLOCK.FURNACE) game.world.setBlockEntity(x, y, z, Furnace.create());
    if (!game.rules.infiniteBlocks) ch.inventory.takeFrom(slot, 1);
    game.events.emit('blockPlaced', { x, y, z, block: item.blockId, by: ch });
    return true;
  },
};
