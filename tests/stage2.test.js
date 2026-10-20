/* Stage 2: editing, raycast, mining, items, inventory, crafting, furnace, UI. */

// Page-side helpers, installed once per page as window.T.
const SETUP = `(() => {
  const g = window.__game, w = g.world, p = g.player;
  g.paused = true;                                      // we tick by hand
  g.rules.loot = false;                                 // no floor loot / chests interfering with item counts
  for (const e of [...g.entities.values()]) if (e.type === 'drop') g.removeEntity(e);
  const T = window.T = { g, w, p, it: {}, once: {} };
  p.controller = new ScriptedController(() => { const o = Object.assign({}, T.it, T.once); T.once = {}; return o; });
  T.tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 60); };
  T.sim = (s) => T.tick(Math.round(s * 60));
  T.press = (fields) => { T.once = fields; T.tick(1); };
  /** Flat stone arena: floor y=28..30, air 31..45, x,z in [-14,14] (spans 4 chunks). */
  T.arena = () => {
    const list = [];
    for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) {
      for (let y = 28; y <= 30; y++) list.push([x, y, z, BLOCK.STONE]);
      for (let y = 31; y <= 45; y++) list.push([x, y, z, BLOCK.AIR]);
    }
    w.setBlocks(list);
    for (const e of [...g.entities.values()]) if (e.type === 'drop') g.removeEntity(e);
  };
  T.stand = (x, z, yaw = 0, pitch = 0) => { p.flying = false; p.teleport(x, 31.001, z); p.yaw = yaw; p.pitch = pitch; T.tick(2); };
  T.lookAt = (bx, by, bz) => {                          // aim at a block centre from the eye
    const ex = p.pos.x, ey = p.eyeY, ez = p.pos.z;
    const dx = bx + 0.5 - ex, dy = by + 0.5 - ey, dz = bz + 0.5 - ez;
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  T.give = (id, n = 1, slot) => { const s = makeStack(id, n); if (slot === undefined) p.inventory.add(s); else p.inventory.set(slot, s); };
  T.settled = () => {
    if (w.dirty.size || w.urgentQueue.length) return false;
    for (const ch of w.chunks.values()) if (ch.meshing) return false;
    return true;
  };
  /** Resolves once every chunk overlapping the block rectangle has data (setBlock fails on missing chunks). */
  T.waitReady = (x0, z0, x1, z1) => new Promise((res, rej) => {
    const t0 = performance.now();
    const ok = () => {
      for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
        const ch = w.chunks.get(World.key(cx, cz));
        if (!ch || ch.state !== ChunkState.READY) return false;
      }
      return true;
    };
    const loop = () => { if (ok()) res(true); else if (performance.now() - t0 > 30000) rej(new Error('chunks not ready')); else setTimeout(loop, 30); };
    loop();
  });
  T.waitSettled = () => new Promise((res, rej) => {
    const t0 = performance.now();
    const loop = () => { if (T.settled()) res(true); else if (performance.now() - t0 > 15000) rej(new Error('remesh timeout')); else setTimeout(loop, 16); };
    loop();
  });
  /** Total quad area of a chunk's opaque mesh. */
  T.meshArea = (cx, cz) => {
    const ch = w.chunks.get(World.key(cx, cz));
    if (!ch.meshOpaque) return 0;
    const pos = ch.meshOpaque.geometry.attributes.position.array;
    let A = 0;
    for (let q = 0; q < pos.length / 12; q++) {
      const o = q * 12;
      const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
      const vx = pos[o + 9] - pos[o], vy = pos[o + 10] - pos[o + 1], vz = pos[o + 11] - pos[o + 2];
      A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    return A;
  };
  /** Brute-force count of visible non-liquid faces of a chunk from world data. */
  T.bruteArea = (cx, cz) => {
    let n = 0;
    const op = BlockTables.opaque, liq = BlockTables.liquid;
    for (let y = 0; y < 64; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const gx = cx * 16 + x, gz = cz * 16 + z, a = w.getBlock(gx, y, gz);
      if (!a || liq[a]) continue;
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const b = w.getBlock(gx + dx, y + dy, gz + dz);
        if (op[b] || a === b) continue;
        n++;
      }
    }
    return n;
  };
  T.events = [];
  for (const name of ['blockBroken', 'blockPlaced', 'pickup', 'toolBroke', 'crafted']) g.events.on(name, (e) => T.events.push(name));
  return true;
})()`;

async function setup(ctx, query) {
  const { page } = await ctx.open(query || 'autostart=1&seed=hello&rd=4');
  await page.evaluate(SETUP);
  await page.evaluate(() => T.arena());
  await page.evaluate(() => T.waitSettled());
  return page;
}

exports.tests = {
  'raycast: negative coords, axis-aligned rays, start inside a block': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const w = T.w;
      w.setBlock(-6, 33, -6, BLOCK.BRICK);
      const down = raycastBlocks(w, { x: -8.5, y: 40.5, z: -5.5 }, { x: 0, y: -1, z: 0 }, 20);
      const negX = raycastBlocks(w, { x: 0.5, y: 33.5, z: -5.5 }, { x: -1, y: 0, z: 0 }, 20);
      const inside = raycastBlocks(w, { x: 2.5, y: 29.5, z: 2.5 }, { x: 0, y: 1, z: 0 }, 5);
      const diag = raycastBlocks(w, { x: 3.2, y: 34.7, z: 3.3 }, { x: -1, y: -1, z: -1 }, 20);
      const miss = raycastBlocks(w, { x: 0.5, y: 40, z: 0.5 }, { x: 0, y: 1, z: 0 }, 10);
      return { down, negX, inside, diag, miss };
    });
    ctx.assert(r.down && r.down.x === -9 && r.down.y === 30 && r.down.z === -6 && r.down.ny === 1, 'down ray hits floor at -9,30,-6 top: ' + JSON.stringify(r.down));
    ctx.near(r.down.dist, 9.5, 1e-9, 'down distance');
    ctx.assert(r.negX && r.negX.x === -6 && r.negX.nx === 1 && r.negX.block === 8, '-x ray hits brick east face: ' + JSON.stringify(r.negX));
    ctx.assert(r.inside && r.inside.dist === 0 && r.inside.y === 29, 'start inside block returns it at dist 0');
    ctx.assert(r.diag && r.diag.y === 30 && r.diag.ny === 1, 'diagonal ray lands on the floor top: ' + JSON.stringify(r.diag));
    ctx.assert(r.miss === null, 'ray into the sky misses');
  },

  'edits across chunk borders re-mesh correctly (mesh area == visible faces)': async (ctx) => {
    const page = await setup(ctx);
    // a column + pillars + holes straddling the 4-chunk corner at (0,0)
    await page.evaluate(() => {
      const list = [];
      for (let y = 31; y <= 36; y++) list.push([0, y, 0, BLOCK.BRICK], [-1, y, -1, BLOCK.GLASS], [15, y, 0, BLOCK.PLANKS], [-1, y, 0, BLOCK.LEAVES]);
      list.push([0, 30, -1, BLOCK.AIR], [-1, 30, 0, BLOCK.AIR], [16, 30, 3, BLOCK.AIR]);
      T.w.setBlocks(list);
    });
    await page.evaluate(() => T.waitSettled());
    await page.waitForTimeout(100);
    const res = await page.evaluate(() => {
      const out = [];
      for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0]]) out.push([cx, cz, T.meshArea(cx, cz), T.bruteArea(cx, cz)]);
      return out;
    });
    for (const [cx, cz, mesh, brute] of res) ctx.near(mesh, brute, 1e-6, `chunk ${cx},${cz} mesh area`);
    // then dig one block again while a job may be in flight: final mesh must match
    await page.evaluate(() => { T.w.setBlock(0, 36, 0, BLOCK.AIR); T.w.setBlock(0, 35, 0, BLOCK.AIR); });
    await page.evaluate(() => T.waitSettled());
    await page.waitForTimeout(50);
    const again = await page.evaluate(() => [T.meshArea(0, 0), T.bruteArea(0, 0)]);
    ctx.near(again[0], again[1], 1e-6, 'chunk 0,0 after rapid second edit');
  },

  'edited chunks survive unload and reload': async (ctx) => {
    const page = await setup(ctx);
    await page.evaluate(() => { T.w.setBlock(5, 31, 5, BLOCK.GOLD_ORE); T.stand(0.5, 0.5); });
    await page.evaluate(() => { T.p.flying = true; T.p.teleport(600.5, 50, 600.5); });
    await page.waitForFunction(() => !T.w.chunks.has(World.key(0, 0)), null, { timeout: 30000 });
    const stashed = await page.evaluate(() => T.w.stash.has(World.key(0, 0)));
    ctx.assert(stashed, 'modified chunk stashed on unload');
    await page.evaluate(() => { T.p.teleport(0.5, 40, 0.5); });
    await page.waitForFunction(() => { const c = T.w.chunks.get(World.key(0, 0)); return c && c.meshState === MeshState.DONE; }, null, { timeout: 30000 });
    const b = await page.evaluate(() => [T.w.getBlock(5, 31, 5), T.w.getBlock(0, 40, 0)]);
    ctx.assert(b[0] === 10, 'gold ore still there after reload');
    ctx.assert(b[1] === 0, 'arena air still there after reload');
  },

  'mining times follow hardness, tools and harvest tiers; bedrock never breaks': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const mineTicks = (blockId, itemId) => {
        T.w.setBlock(3, 31, 0, blockId);
        T.p.inventory.set(0, itemId ? makeStack(itemId) : null);
        T.p.selectSlot(0);
        T.stand(0.5, 0.5, 0, 0); T.lookAt(3, 31, 0);
        T.it = { fire: true };
        let n = 0;
        while (T.w.getBlock(3, 31, 0) === blockId && n < 60 * 30) { T.tick(1); n++; }
        T.it = {};
        T.tick(12);
        return n;
      };
      out.handStone = mineTicks(BLOCK.STONE, null);
      out.woodPickStone = mineTicks(BLOCK.STONE, 'wood_pickaxe');
      out.handDirt = mineTicks(BLOCK.DIRT, null);
      out.bedrock = mineTicks(BLOCK.BEDROCK, 'iron_pickaxe');
      out.info = {
        handStone: Mining.info({ heldStack: () => null }, BLOCK.STONE),
        woodIron: Mining.info({ heldStack: () => makeStack('wood_pickaxe') }, BLOCK.IRON_ORE),
        stoneIron: Mining.info({ heldStack: () => makeStack('stone_pickaxe') }, BLOCK.IRON_ORE),
        stoneGold: Mining.info({ heldStack: () => makeStack('stone_pickaxe') }, BLOCK.GOLD_ORE),
        ironGold: Mining.info({ heldStack: () => makeStack('iron_pickaxe') }, BLOCK.GOLD_ORE),
        axeLog: Mining.info({ heldStack: () => makeStack('stone_axe') }, BLOCK.WOOD),
        pickLog: Mining.info({ heldStack: () => makeStack('stone_pickaxe') }, BLOCK.WOOD),
      };
      return out;
    });
    const M = { HARVEST: 1.5, NO: 5 };
    ctx.near(r.handStone, Math.ceil(1.5 * M.NO * 60), 1, 'stone by hand ticks');
    ctx.near(r.woodPickStone, Math.ceil(1.5 * M.HARVEST / 2 * 60), 1, 'stone with wooden pickaxe ticks');
    ctx.near(r.handDirt, Math.ceil(0.5 * M.HARVEST * 60), 1, 'dirt by hand ticks');
    ctx.assert(r.bedrock >= 60 * 30, 'bedrock never breaks');
    ctx.assert(!r.info.handStone.canHarvest && !r.info.woodIron.canHarvest && r.info.stoneIron.canHarvest, 'iron ore needs stone pickaxe');
    ctx.assert(!r.info.stoneGold.canHarvest && r.info.ironGold.canHarvest, 'gold ore needs iron pickaxe');
    ctx.assert(r.info.axeLog.time < r.info.pickLog.time && r.info.axeLog.effective, 'axe is the right tool for logs');
  },

  'drops: grass->dirt, stone needs a pickaxe, furnaces spill contents; pickup fills inventory': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const brk = (blockId, itemId) => {                 // block 2 away: inside the pickup magnet
        T.w.setBlock(2, 31, 0, blockId);
        T.p.inventory.clear();
        if (itemId) T.p.inventory.set(0, makeStack(itemId));
        T.p.selectSlot(0);
        T.stand(0.5, 0.5); T.lookAt(2, 31, 0);
        T.it = { fire: true };
        let n = 0;
        while (T.w.getBlock(2, 31, 0) === blockId && n < 60 * 20) { T.tick(1); n++; }
        T.it = {};
        T.sim(2.5);                                       // drops fly to the player and get collected
        const inv = {};
        for (const s of T.p.inventory.slots) if (s) inv[s.id] = (inv[s.id] || 0) + s.count;
        return inv;
      };
      out.grass = brk(BLOCK.GRASS);
      out.stoneHand = brk(BLOCK.STONE);
      out.stonePick = brk(BLOCK.STONE, 'wood_pickaxe');
      out.glass = brk(BLOCK.GLASS);
      // furnace with contents
      T.w.setBlock(2, 31, 0, BLOCK.FURNACE);
      const f = Furnace.create(); f.input = makeStack('dirt', 3); f.fuel = makeStack('planks', 2); f.output = makeStack('iron_ingot', 1);
      T.w.setBlockEntity(2, 31, 0, f);                  // dirt isn't smeltable, so the fuel stays unlit
      out.furnace = brk(BLOCK.FURNACE, 'stone_pickaxe');
      out.beGone = T.w.getBlockEntity(2, 31, 0) === null;
      out.drops = [...T.g.entities.values()].filter((e) => e.type === 'drop').length;
      return out;
    });
    ctx.assert(r.grass.dirt === 1 && !r.grass.grass, 'grass drops dirt: ' + JSON.stringify(r.grass));
    ctx.assert(Object.keys(r.stoneHand).length === 0, 'stone by hand drops nothing: ' + JSON.stringify(r.stoneHand));
    ctx.assert(r.stonePick.stone === 1, 'stone with pickaxe drops stone');
    ctx.assert(!r.glass.glass, 'glass drops nothing');
    ctx.assert(r.furnace.furnace === 1 && r.furnace.dirt === 3 && r.furnace.planks === 2 && r.furnace.iron_ingot === 1, 'furnace + contents collected: ' + JSON.stringify(r.furnace));
    ctx.assert(r.beGone, 'furnace block entity removed');
    ctx.assert(r.drops === 0, 'all drops collected');
  },

  'inventory model: merge, overflow, remove order, tools never stack, spaceFor': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=3');
    const r = await page.evaluate(() => {
      const inv = new Inventory(36), out = {};
      out.left1 = inv.add(makeStack('stone', 100));          // 64 + 36
      out.slots1 = [inv.get(0).count, inv.get(1).count];
      out.left2 = inv.add(makeStack('stone', 28));           // tops slot 1 to 64
      out.slot1 = inv.get(1).count;
      inv.add(makeStack('wood_pickaxe')); inv.add(makeStack('wood_pickaxe'));
      out.picks = inv.slots.filter((s) => s && s.id === 'wood_pickaxe').length;
      out.pickDur = inv.get(2).data.dur;
      inv.set(20, makeStack('stone', 10));
      out.removed = inv.remove('stone', 15);                 // main inventory (slot 20) first
      out.after = [inv.get(0) && inv.get(0).count, inv.get(1) && inv.get(1).count, inv.get(20)];
      for (let i = 0; i < 36; i++) if (!inv.get(i)) inv.set(i, makeStack('dirt', 64));
      out.full = inv.add(makeStack('dirt', 5));
      out.space = inv.spaceFor(makeStack('stone', 64));
      inv.swap(0, 35);
      out.swapped = [inv.get(0).id, inv.get(35).id];
      return out;
    });
    ctx.assert(r.left1 === 0 && r.slots1[0] === 64 && r.slots1[1] === 36, 'overflow into a second stack');
    ctx.assert(r.left2 === 0 && r.slot1 === 64, 'merges into the partial stack');
    ctx.assert(r.picks === 2 && r.pickDur === 59, 'tools occupy separate slots with durability');
    ctx.assert(r.removed === 15 && r.after[2] === null && r.after[0] === 59 && r.after[1] === 64, 'remove takes from main inventory before hotbar: ' + JSON.stringify(r.after));
    ctx.assert(r.full === 5, 'full inventory rejects');
    ctx.assert(r.space === 5, 'spaceFor counts room in partial stacks');
    ctx.assert(r.swapped[0] === 'dirt' && r.swapped[1] === 'stone', 'swap');
  },

  'placing: not inside players, consumes the item, works across chunk borders, hold repeats': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.p.inventory.clear();
      T.give('brick', 10, 0); T.p.selectSlot(0);
      T.stand(0.5, 0.5, 0, 0);
      // aim straight down at the floor under our feet: the cell above it is where we stand
      T.p.pitch = -Math.PI / 2 + 0.02; T.tick(1);
      T.press({ aim: true, aimPressed: true });
      out.selfBlocked = T.w.getBlock(0, 31, 0) === BLOCK.AIR && T.p.inventory.count('brick') === 10;
      // place on the floor across the x=-1/0 chunk border
      T.stand(1.5, 0.5); T.lookAt(-1, 30, 0);
      T.press({ aim: true, aimPressed: true });
      out.placed = T.w.getBlock(-1, 31, 0) === BLOCK.BRICK;
      out.count = T.p.inventory.count('brick');
      // hold to repeat: aim at a wall face and keep the button down for 1s
      T.w.setBlocks([[0, 31, -4, BLOCK.STONE], [0, 32, -4, BLOCK.STONE]]);
      T.stand(0.5, 0.5); T.lookAt(0, 31, -4);
      T.it = { aim: true }; T.once = { aimPressed: true };
      T.sim(1);
      T.it = {};
      out.afterHold = T.p.inventory.count('brick');
      return out;
    });
    ctx.assert(r.selfBlocked, 'cannot place a block inside yourself');
    ctx.assert(r.placed && r.count === 9, 'placed one brick across the chunk border');
    ctx.assert(r.afterHold < 9 && r.afterHold >= 9 - 5, 'holding place repeats at the configured rate (placed ' + (9 - r.afterHold) + ')');
    await page.evaluate(() => T.waitSettled());
    await page.waitForTimeout(50);
    const areas = await page.evaluate(() => [[T.meshArea(-1, 0), T.bruteArea(-1, 0)], [T.meshArea(0, 0), T.bruteArea(0, 0)]]);
    for (const [m, b] of areas) ctx.near(m, b, 1e-6, 'mesh matches after placing');
  },

  'tool durability wears down and the tool breaks': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      T.p.inventory.clear();
      T.p.inventory.set(0, makeStack('gold_pickaxe')); T.p.selectSlot(0);
      const dur0 = T.p.heldStack().data.dur;
      let broken = 0;
      for (let i = 0; i < dur0 + 2; i++) {
        T.w.setBlock(2, 31, 0, BLOCK.STONE);
        T.stand(0.5, 0.5); T.lookAt(2, 31, 0);
        T.it = { fire: true };
        let n = 0;
        while (T.w.getBlock(2, 31, 0) === BLOCK.STONE && n < 600) { T.tick(1); n++; }
        T.it = {}; T.tick(10);
        if (!T.p.heldStack() || T.p.heldStack().id !== 'gold_pickaxe') { broken = i + 1; break; }
      }
      return { dur0, broken, events: T.events.filter((e) => e === 'toolBroke').length };
    });
    ctx.assert(r.dur0 === 32, 'golden pickaxe durability from CONFIG');
    ctx.assert(r.broken === 32 && r.events === 1, 'breaks after exactly its durability: ' + JSON.stringify(r));
  },

  'controller delivers presses exactly once across 0 or many ticks per frame': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=3');
    const r = await page.evaluate(() => {
      let frame = null;
      const fake = { down: () => false, buttonDown: () => false, takeFrame: () => { const f = frame || { pressedKeys: new Set(), pressedButtons: new Set(), dx: 0, dy: 0, wheel: 0 }; frame = null; return f; } };
      const c = new KeyboardMouseController(fake, { sensitivity: 1 });
      const out = {};
      frame = { pressedKeys: new Set(['KeyE']), pressedButtons: new Set([0]), dx: 10, dy: 0, wheel: 1 };
      c.poll();
      const a = c.getIntent(), b = c.getIntent(), d = c.getIntent();       // 3 ticks in one frame
      out.many = [a.interact, b.interact, d.interact, a.firePressed, b.firePressed, a.slotDelta, b.slotDelta];
      out.look = [a.lookDX, b.lookDX];
      frame = { pressedKeys: new Set(['KeyR']), pressedButtons: new Set(), dx: 0, dy: 0, wheel: 0 };
      c.poll();                                                          // frame with 0 ticks
      c.poll();                                                          // next frame, nothing new
      out.zero = [c.getIntent().reload, c.getIntent().reload];
      return out;
    });
    ctx.assert(JSON.stringify(r.many) === JSON.stringify([true, false, false, true, false, 1, 0]), 'edge events once: ' + JSON.stringify(r.many));
    ctx.assert(r.look[0] < 0 && r.look[1] === 0, 'mouse look delivered once');
    ctx.assert(r.zero[0] === true && r.zero[1] === false, 'press survives a frame with no ticks');
  },

  'step-up climbs 1-block ledges but not 2-block walls': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const list = [];
      for (let x = -3; x <= 3; x++) {
        for (let z = -9; z <= -3; z++) list.push([x, 31, z, BLOCK.STONE]);          // 1-high platform
        list.push([x, 31, 6, BLOCK.STONE], [x, 32, 6, BLOCK.STONE]);                // 2-high wall
      }
      T.w.setBlocks(list);
      T.stand(0.5, 1.5, 0); T.it = { moveZ: 1 }; T.sim(1.5); T.it = {};
      out.ledge = { y: T.p.pos.y, z: T.p.pos.z, eye: T.p.eyeOffset };
      T.stand(0.5, 9.5, 0); T.it = { moveZ: 1 }; T.sim(2); T.it = {};           // walk -z into the 2-high wall at z=6
      out.wall = { y: T.p.pos.y, z: T.p.pos.z };
      return out;
    });
    ctx.near(r.ledge.y, 32, 0.01, 'stood on the 1-block ledge');
    ctx.assert(r.ledge.z < -3, 'walked over the ledge: z=' + r.ledge.z);
    ctx.near(r.wall.y, 31, 0.01, 'stayed on the floor at the 2-block wall');
    ctx.near(r.wall.z, 7.3, 0.01, 'stopped flush against the 2-block wall');
  },

  'crafting matcher: anywhere in grid, mirrored, grid size, shapeless, no conflicts': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=3');
    const r = await page.evaluate(() => {
      const S = (id) => (id ? makeStack(id, 1) : null);
      const grid = (w, ids) => ids.map(S);
      const m = (w, ids) => { const x = Crafting.match(grid(w, ids), w); return x ? x.result.id + 'x' + x.result.count : null; };
      return {
        planks: m(2, [null, null, null, 'log']),
        sticks3: m(3, [null, null, 'planks', null, null, 'planks', null, null, null]),
        table: m(2, ['planks', 'planks', 'planks', 'planks']),
        axe: m(3, ['planks', 'planks', null, 'planks', 'stick', null, null, 'stick', null]),
        axeMirror: m(3, [null, 'planks', 'planks', null, 'stick', 'planks', null, 'stick', null]),
        pickIn2x2: m(2, ['stone', 'stone', null, 'stick']),
        pick: m(3, ['iron_ingot', 'iron_ingot', 'iron_ingot', null, 'stick', null, null, 'stick', null]),
        furnace: m(3, ['stone', 'stone', 'stone', 'stone', null, 'stone', 'stone', 'stone', 'stone']),
        lightAmmo: m(3, [null, null, null, null, null, null, null, null, 'iron_ingot']),
        mediumAmmo: m(2, ['iron_ingot', 'iron_ingot', null, null]),
        heavyAmmo: m(3, ['gold_ingot', null, null, null, null, null, null, null, 'iron_ingot']),
        buildMetal: m(2, ['iron_ingot', 'iron_ingot', 'iron_ingot', 'iron_ingot']),
        nothing: m(3, ['dirt', 'log', null, null, null, null, null, null, null]),
      };
    });
    const want = {
      planks: 'planksx4', sticks3: 'stickx4', table: 'crafting_tablex1', axe: 'stone_axex1'.replace('stone', 'wood'),
      axeMirror: 'wood_axex1', pickIn2x2: null, pick: 'iron_pickaxex1', furnace: 'furnacex1',
      lightAmmo: 'ammo_lightx24', mediumAmmo: 'ammo_mediumx24', heavyAmmo: 'ammo_heavyx8', buildMetal: 'build_metalx4', nothing: null,
    };
    for (const k of Object.keys(want)) ctx.assert(r[k] === want[k], `${k}: got ${r[k]}, want ${want[k]}`);
  },

  'furnace: fuel accounting, smelting over time, output stacking, survives unload': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.w.setBlock(3, 31, 3, BLOCK.FURNACE);
      const f = Furnace.create();
      T.w.setBlockEntity(3, 31, 3, f);
      f.input = makeStack('iron_ore', 3); f.fuel = makeStack('planks', 3); f.output = makeStack('iron_ingot', 5);
      T.sim(0.1);
      out.firstFuel = f.fuel.count;                     // one plank lit immediately
      T.sim(13.9);
      out.after14 = { input: f.input, fuel: f.fuel, output: f.output && f.output.count, burning: f.burn > 0 };
      // nothing to smelt -> no fuel is consumed
      const g = Furnace.create(); g.fuel = makeStack('log', 2);
      for (let i = 0; i < 300; i++) Furnace.tick(g, 1 / 60);
      out.idleFuel = g.fuel.count;
      // full output blocks smelting
      const h = Furnace.create(); h.input = makeStack('sand', 2); h.fuel = makeStack('log', 1); h.output = makeStack('glass', 64);
      for (let i = 0; i < 600; i++) Furnace.tick(h, 1 / 60);
      out.blocked = [h.input.count, h.output.count, h.fuel && h.fuel.count];
      return out;
    });
    ctx.assert(r.firstFuel === 2, 'lights one plank');
    ctx.assert(r.after14.input === null && r.after14.output === 8, 'smelted all 3 ore onto the existing 5 ingots: ' + JSON.stringify(r.after14));
    ctx.assert(r.after14.fuel && r.after14.fuel.count === 1, 'two planks (6s each) cover exactly 12s of smelting: ' + JSON.stringify(r.after14.fuel));
    ctx.assert(r.idleFuel === 2, 'no fuel burned with nothing to smelt');
    ctx.assert(r.blocked[0] === 2 && r.blocked[1] === 64 && r.blocked[2] === 1, 'full output blocks smelting and fuel use');
    // survive unload
    await page.evaluate(() => { T.p.flying = true; T.p.teleport(600.5, 50, 600.5); });
    await page.waitForFunction(() => !T.w.chunks.has(World.key(0, 0)), null, { timeout: 30000 });
    await page.evaluate(() => { T.p.teleport(3.5, 40, 3.5); });
    await page.waitForFunction(() => { const c = T.w.chunks.get(World.key(0, 0)); return c && c.state === ChunkState.READY; }, null, { timeout: 30000 });
    const back = await page.evaluate(() => [T.w.getBlock(3, 31, 3), T.w.getBlockEntity(3, 31, 3) && T.w.getBlockEntity(3, 31, 3).output.count]);
    ctx.assert(back[0] === BLOCK_FURNACE_ID && back[1] === 8, 'furnace + contents survive unload: ' + JSON.stringify(back));
  },

  'inventory screen: real mouse clicks craft planks/sticks, split, shift-move, close returns items': async (ctx) => {
    const page = await setup(ctx, 'autostart=1&seed=hello&rd=4');
    await page.evaluate(() => { T.p.inventory.clear(); T.give('log', 3, 0); T.give('dirt', 10, 1); T.g.paused = false; });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const open = await page.evaluate(() => !document.getElementById('screen').classList.contains('hidden'));
    ctx.assert(open, 'Tab opens the inventory screen');
    const slots = () => page.$$('#screen .slot');
    // DOM order: 4 grid slots, output, 27 main, 9 hotbar
    const S = await slots();
    const grid = S.slice(0, 4), out = S[4], hot = S.slice(32, 41), main = S.slice(5, 32);
    await hot[0].click();                                  // pick up 3 logs
    await grid[3].click({ button: 'right' });              // place one log in the grid
    let st = await page.evaluate(() => ({ cursor: window.__ui.cursor, grid: window.__ui.grid.map((s) => s && s.id + s.count) }));
    ctx.assert(st.cursor && st.cursor.count === 2 && st.grid[3] === 'log1', 'right click places one: ' + JSON.stringify(st));
    await out.click();                                     // cursor holds logs -> can't take planks
    st = await page.evaluate(() => ({ cursor: window.__ui.cursor }));
    ctx.assert(st.cursor.id === 'log', 'output refuses while holding a different item');
    await main[0].click();                                 // put the 2 logs down in main inventory
    await out.click();                                     // take 4 planks
    st = await page.evaluate(() => ({ cursor: window.__ui.cursor, grid: window.__ui.grid.map((s) => s && s.id + s.count) }));
    ctx.assert(st.cursor && st.cursor.id === 'planks' && st.cursor.count === 4 && st.grid[3] === null, 'crafted 4 planks, log consumed: ' + JSON.stringify(st));
    await grid[0].click({ button: 'right' });              // planks into column 0 (rows 0 and 1) -> sticks
    await grid[2].click({ button: 'right' });
    await out.click({ modifiers: ['Shift'] });             // shift-craft sticks into the inventory
    const inv1 = await page.evaluate(() => ({ stick: T.p.inventory.count('stick'), planks: T.p.inventory.count('planks') }));
    ctx.assert(inv1.stick === 4, 'shift-click crafted sticks into inventory: ' + JSON.stringify(inv1));
    await hot[1].click({ modifiers: ['Shift'] });          // dirt hotbar -> main
    const moved = await page.evaluate(() => [T.p.inventory.get(1), T.p.inventory.count('dirt')]);
    ctx.assert(moved[0] === null && moved[1] === 10, 'shift-click moved dirt out of the hotbar');
    await hot[2].click({ button: 'right' });               // empty slot, cursor has 2 planks -> place 1
    await page.keyboard.press('Tab');                      // close with a planks in cursor
    await page.waitForTimeout(50);
    const end = await page.evaluate(() => ({
      open: window.__ui.isOpen, planks: T.p.inventory.count('planks'), logs: T.p.inventory.count('log'),
      drops: [...T.g.entities.values()].filter((e) => e.type === 'drop').length,
    }));
    ctx.assert(!end.open, 'Tab closes');
    ctx.assert(end.planks === 2 && end.logs === 2, 'nothing lost or duplicated: ' + JSON.stringify(end));
    ctx.assert(end.drops === 0, 'no items were thrown');
    await ctx.screenshot(page, 'stage2-inventory');
  },

  'crafting table and furnace screens open with E and craft/smelt': async (ctx) => {
    const page = await setup(ctx);
    await page.evaluate(() => {
      T.p.inventory.clear();
      T.give('iron_ingot', 3, 0); T.give('stick', 2, 1); T.give('iron_ore', 2, 2); T.give('log', 1, 3);
      T.w.setBlock(2, 31, 0, BLOCK.CRAFTING_TABLE);
      T.stand(0.5, 0.5); T.lookAt(2, 31, 0);
      T.press({ interact: true });
    });
    let st = await page.evaluate(() => ({ open: window.__ui.isOpen, kind: window.__ui.kind, grid: window.__ui.grid && window.__ui.grid.length }));
    ctx.assert(st.open && st.kind === 'crafting' && st.grid === 9, 'E opens a 3x3 crafting table');
    await page.evaluate(() => {
      const ui = window.__ui;
      ui.grid[0] = makeStack('iron_ingot'); ui.grid[1] = makeStack('iron_ingot'); ui.grid[2] = makeStack('iron_ingot');
      ui.grid[4] = makeStack('stick'); ui.grid[7] = makeStack('stick');
      T.p.inventory.remove('iron_ingot', 3); T.p.inventory.remove('stick', 2);
      ui.refresh();
    });
    await ctx.screenshot(page, 'stage2-crafting-table');
    const S = await page.$$('#screen .slot');
    await S[9].click();                                    // output slot after 9 grid slots
    st = await page.evaluate(() => ({ cursor: window.__ui.cursor && window.__ui.cursor.id }));
    ctx.assert(st.cursor === 'iron_pickaxe', 'crafted an iron pickaxe on the table');
    await page.keyboard.press('KeyE');                      // close (cursor returns to inventory)
    await page.evaluate(() => {
      T.w.setBlock(-2, 31, 0, BLOCK.FURNACE);
      T.w.setBlockEntity(-2, 31, 0, Furnace.create());
      T.stand(0.5, 0.5); T.lookAt(-2, 31, 0);
      T.press({ interact: true });
    });
    st = await page.evaluate(() => ({ open: window.__ui.isOpen, kind: window.__ui.kind, pick: T.p.inventory.count('iron_pickaxe') }));
    ctx.assert(st.open && st.kind === 'furnace' && st.pick === 1, 'E opens the furnace; pickaxe kept: ' + JSON.stringify(st));
    const F = await page.$$('#screen .slot');
    // furnace DOM: input, fuel, output, then 27 main + 9 hotbar
    const hot = F.slice(30, 39);
    await hot[2].click({ modifiers: ['Shift'] });            // ore -> input
    await hot[3].click({ modifiers: ['Shift'] });            // log -> fuel
    const f = await page.evaluate(() => { const be = T.w.getBlockEntity(-2, 31, 0); return [be.input && be.input.id, be.fuel && be.fuel.id]; });
    ctx.assert(f[0] === 'iron_ore' && f[1] === 'log', 'shift-click routes ore to input and log to fuel: ' + JSON.stringify(f));
    await page.evaluate(() => { T.sim(8.2); window.__ui.update(); });
    await ctx.screenshot(page, 'stage2-furnace');
    await F[2].click({ modifiers: ['Shift'] });               // take ingots
    const done = await page.evaluate(() => T.p.inventory.count('iron_ingot'));
    ctx.assert(done === 2, 'collected 2 smelted ingots: ' + done);
  },
};

const BLOCK_FURNACE_ID = 20;

exports.SETUP = SETUP;
