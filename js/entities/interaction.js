/* ============================================================
 * Per-tick block interaction for a Character: hold-to-mine,
 * place (with hold-to-repeat), and "use" on crafting tables and
 * furnaces. Pure sim: reads the Intent, changes the world through
 * World/Mining APIs, reports through game.events.
 * ============================================================ */
const Interaction = {
  update(ch, it, dt, game, building) {
    ch.breakCooldown = Math.max(0, ch.breakCooldown - dt);
    ch.placeCooldown = Math.max(0, ch.placeCooldown - dt);
    const t = ch.target = ch.raycastTarget(game.world);
    const noMining = game.rules.noMining;

    // --- mining (not with a gun or a consumable in hand; never in story mode) ---
    const kind = ch.heldKind();
    const combatItem = kind === 'weapon' || kind === 'consumable' || kind === 'blade' || noMining;
    const piece = t && !building ? Building.pieceAtBlock(game, t.x, t.y, t.z) : null;
    if (piece) {
      // build pieces aren't mined block by block: every swing damages the whole piece
      ch.mining = null;
      if (it.fire && !combatItem && ch.build.swing <= 0) {
        ch.build.swing = CONFIG.BUILD.SWING_TIME;
        Building.damageBlock(game, t.x, t.y, t.z, CONFIG.BUILD.PICKAXE_DAMAGE, ch);
        game.events.emit('impact', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5, block: t.block, nx: t.nx, ny: t.ny, nz: t.nz });
      }
    } else if (it.fire && t && !combatItem && !building) {
      const m = ch.mining;
      if (!m || m.x !== t.x || m.y !== t.y || m.z !== t.z || m.block !== t.block) {
        ch.mining = { x: t.x, y: t.y, z: t.z, block: t.block, progress: 0 };
      }
      if (ch.breakCooldown <= 0) {
        const time = Mining.breakTime(ch, t.block);
        if (time === Infinity) ch.mining.progress = 0;
        else {
          ch.mining.progress += time > 0 ? dt / time : 1;
          if (ch.mining.progress >= 1 - 1e-9) {
            Mining.breakBlock(game, ch, t);
            ch.mining = null;
            ch.breakCooldown = CONFIG.MINING.BREAK_COOLDOWN;
            ch.target = ch.raycastTarget(game.world);
          }
        }
      }
    } else {
      ch.mining = null;
    }

    // --- placing (right button with a block item) ---
    const t2 = ch.target;
    if (it.aimPressed) ch.placeCooldown = 0;
    if (it.aim && t2 && ch.placeCooldown <= 0 && !building && !noMining) {
      const held = ch.heldStack();
      if (held && ITEMS[held.id] && ITEMS[held.id].kind === 'block') {
        if (Mining.placeBlock(game, ch, t2, ch.selectedSlot)) {
          ch.placeCooldown = CONFIG.PLACE_REPEAT;
          ch.target = ch.raycastTarget(game.world);
        }
      }
    }

    // --- interact (E): loot chest > crafting table / furnace > weapon on the ground ---
    // (in story mode the story's own interactions - talking, synchronising, cages... - come first)
    if (it.interact && !(game.story && game.story.claimsInteract && game.story.claimsInteract(ch))) {
      const ui = t2 ? (t2.block === BLOCK.CRAFTING_TABLE ? 'crafting' : t2.block === BLOCK.FURNACE ? 'furnace' : null) : null;
      if (t2 && t2.block === BLOCK.CHEST) {
        Loot.openChest(game, ch, t2.x, t2.y, t2.z);
      } else if (ui) {
        if (ui === 'furnace' && !game.world.getBlockEntity(t2.x, t2.y, t2.z)) {
          game.world.setBlockEntity(t2.x, t2.y, t2.z, Furnace.create());
        }
        game.events.emit('openBlockUI', { character: ch, kind: ui, x: t2.x, y: t2.y, z: t2.z });
      } else {
        const drop = Loot.nearestManualDrop(game, ch);
        const car = Vehicles.nearest(game, ch, CONFIG.VEHICLE.ENTER_RANGE);
        // prefer the weapon when it's closer than the vehicle's door
        if (drop && (!car || drop.pos.distanceTo(ch.pos) < 1.2)) Loot.pickUpManual(game, ch, drop);
        else if (car) Vehicles.enter(game, ch, car);
        else if (drop) Loot.pickUpManual(game, ch, drop);
      }
    }
  },
};
