/* Stage 4: fast building - pieces, costs, HP, damage, edit mode, ramp rush, box up. */
const { SETUP } = require('./stage2.test.js');

const BUILD = `(() => {
  T.mats = (n = 100) => { T.p.inventory.clear(); T.p.inventory.add(makeStack('planks', n)); T.p.inventory.add(makeStack('stone', n)); T.p.inventory.add(makeStack('iron_ingot', n)); };
  T.pieces = () => [...T.g.pieces.values()];
  T.aimAt = (x, y, z) => { const dx = x - T.p.pos.x, dy = y - T.p.eyeY, dz = z - T.p.pos.z; T.p.yaw = Math.atan2(-dx, -dz); T.p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
  T.countBlock = (id, x0, x1, y0, y1, z0, z1) => { let n = 0; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (T.w.getBlock(x, y, z) === id) n++; return n; };
  return true;
})()`;

async function setup(ctx) {
  const { page } = await ctx.open('autostart=1&seed=hello&rd=4');
  await page.evaluate(SETUP);
  await page.evaluate(BUILD);
  await page.evaluate(() => { T.arena(); for (const e of [...T.g.entities.values()]) if (e !== T.p) T.g.removeEntity(e); });
  await page.evaluate(() => T.waitSettled());
  return page;
}

exports.tests = {
  'pieces: wall / ramp / roof / floor geometry, material cost, refuse without materials or when occupied': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.mats(100);
      T.stand(2.5, 2.5, 0, 0);                         // cell (0,0), facing -z
      T.press({ buildPiece: 'wall' }); T.press({ fire: true, firePressed: true });
      out.wall = T.countBlock(BLOCK.BUILD_WOOD, 0, 3, 31, 34, -1, -1);
      out.planks = T.p.inventory.count('planks');
      T.tick(10);
      T.press({ fire: true, firePressed: true });       // same slot again
      out.dup = T.pieces().length;
      T.press({ aimPressed: true });                   // -> stone
      T.p.yaw = Math.PI / 2;                           // face -x
      T.press({ buildPiece: 'ramp' }); T.press({ fire: true, firePressed: true });
      const ramp = T.pieces().find((p) => p.type === 'ramp');
      out.ramp = ramp && [ramp.material, ramp.cells.length, ramp.slot.cx, ramp.slot.dx];
      out.rampSteps = [T.w.getBlock(-1, 31, 1), T.w.getBlock(-2, 32, 1), T.w.getBlock(-3, 33, 1), T.w.getBlock(-4, 34, 1)];
      out.stone = T.p.inventory.count('stone');
      T.p.yaw = Math.PI; T.p.pitch = 0;                // face +z
      T.press({ aimPressed: true });                   // -> metal
      T.press({ buildPiece: 'roof' }); T.press({ fire: true, firePressed: true });
      const roof = T.pieces().find((p) => p.type === 'roof');
      out.roof = roof && [roof.material, roof.cells.length, roof.slot.cz];
      // floor over a hole (cell ahead in +x)
      const hole = []; for (let x = 4; x <= 7; x++) for (let z = 0; z <= 3; z++) hole.push([x, 30, z, BLOCK.AIR]);
      T.w.setBlocks(hole);
      T.p.yaw = -Math.PI / 2;                          // face +x
      T.press({ aimPressed: true });                   // -> wood
      T.press({ buildPiece: 'floor' }); T.press({ fire: true, firePressed: true });
      out.floor = T.countBlock(BLOCK.BUILD_WOOD, 4, 7, 30, 30, 0, 3);
      // no materials
      T.p.inventory.clear();
      T.p.yaw = 0; T.stand(10.5, 10.5, 0, 0);
      T.press({ buildPiece: 'wall' }); T.press({ fire: true, firePressed: true });
      out.broke = T.p.build.target && T.p.build.target.reason;
      out.total = T.pieces().length;
      return out;
    });
    ctx.assert(r.wall === 16, 'wall is 16 voxels: ' + r.wall);
    ctx.assert(r.planks === 95, 'wall cost 5 planks: ' + r.planks);
    ctx.assert(r.dup === 1, 'cannot build the same slot twice');
    ctx.assert(r.ramp && r.ramp[0] === 'stone' && r.ramp[1] === 16 && r.ramp[2] === -1 && r.ramp[3] === -1, 'stone ramp in the cell ahead: ' + JSON.stringify(r.ramp));
    ctx.assert(r.rampSteps.every((b) => b === 13), 'ramp rises 1 block per block away from the player: ' + r.rampSteps);
    ctx.assert(r.stone === 95, 'ramp cost 5 stone');
    ctx.assert(r.roof && r.roof[0] === 'metal' && r.roof[1] === 20, 'metal roof with a peak: ' + JSON.stringify(r.roof));
    ctx.assert(r.floor === 16, 'floor bridges the hole: ' + r.floor);
    ctx.assert(r.broke === 'materials' && r.total === 4, 'no materials, no piece: ' + r.broke);
  },

  'piece HP grows while building; bullets and pickaxe swings damage it; 0 HP removes every voxel': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.mats(100);
      T.stand(2.5, 2.5, 0, 0);
      T.press({ buildPiece: 'wall' }); T.press({ fire: true, firePressed: true });
      const p = T.pieces()[0];
      out.start = p.hp;
      T.sim(0.75);
      out.mid = p.hp;
      T.sim(1);
      out.full = [p.hp, p.building];
      // shoot it
      T.press({ toggleBuild: true });
      T.p.inventory.set(0, makeWeapon('ar', 0)); T.p.selectSlot(0);
      T.aimAt(1.5, 32.5, -0.5);
      T.press({ fire: true, firePressed: true });
      out.afterShot = p.hp;
      // pickaxe swings
      T.p.inventory.set(0, makeStack('stone_pickaxe'));
      T.it = { fire: true }; T.sim(0.5); T.it = {};
      out.afterSwing = p.hp;
      // finish it with damage
      Building.damageBlock(T.g, 1, 32, -1, 1000, T.p);
      out.gone = [T.g.pieces.size, T.countBlock(BLOCK.BUILD_WOOD, 0, 3, 31, 34, -1, -1), T.g.pieceAt.size];
      return out;
    });
    ctx.near(r.start, 150 * 0.15, 1.5, 'starts at 15% HP (plus one tick of growth)');
    ctx.assert(r.mid > r.start && r.mid < 150, 'grows while building');
    ctx.assert(r.full[0] === 150 && r.full[1] === false, 'reaches full HP after the build time');
    ctx.near(r.afterShot, 120, 1e-6, 'a 30 damage rifle bullet');
    ctx.assert(r.afterSwing <= r.afterShot - 50, 'pickaxe swing damages the piece: ' + r.afterSwing);
    ctx.assert(r.gone.every((v) => v === 0), 'destroyed piece leaves nothing behind: ' + r.gone);
  },

  'edit mode cuts a door in a wall, the player walks through, and editing again restores it': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.mats(100);
      T.stand(2.5, 2.5, 0, 0);
      T.press({ buildPiece: 'wall' }); T.press({ fire: true, firePressed: true });
      T.press({ toggleBuild: true });
      T.aimAt(0.5, 32, -0.5);                          // bottom-left tile of the wall (u 0..1, v 0..1)
      T.press({ editMode: true });
      out.editing = !!T.p.build.edit;
      T.press({ firePressed: true, fire: true });
      out.selected = T.p.build.edit.selected.slice();
      T.press({ editMode: true });                     // confirm
      out.door = [T.w.getBlock(0, 31, -1), T.w.getBlock(1, 32, -1), T.w.getBlock(2, 31, -1), T.w.getBlock(0, 33, -1)];
      out.cells = T.pieces()[0].cells.length;
      // walk through the door (it's at x 0..1)
      T.stand(1.0, 1.5, 0, 0);
      T.it = { moveZ: 1 }; T.sim(1.2); T.it = {};
      out.through = T.p.pos.z;
      // restore
      T.stand(1.0, 1.5, 0, 0); T.aimAt(0.5, 32, -0.5);
      T.press({ editMode: true }); T.press({ firePressed: true, fire: true }); T.press({ editMode: true });
      out.restored = [T.w.getBlock(0, 31, -1), T.pieces()[0].cells.length];
      return out;
    });
    ctx.assert(r.editing && JSON.stringify(r.selected) === '[0]', 'selected the bottom-left tile: ' + r.selected);
    ctx.assert(r.door[0] === 0 && r.door[1] === 0 && r.door[2] === 12 && r.door[3] === 12, 'door cut, rest intact: ' + r.door);
    ctx.assert(r.cells === 12, 'piece lost 4 voxels');
    ctx.assert(r.through < -2, 'walked through the door: z=' + r.through);
    ctx.assert(r.restored[0] === 12 && r.restored[1] === 16, 'edit restored the tile: ' + r.restored);
  },

  'ramp rush builds a continuous staircase while walking; box up encloses the player': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.mats(200);
      T.stand(0.5, 10.5, 0, 0);
      T.it = { moveZ: 1, rampRush: true }; T.sim(4); T.it = {};
      out.climb = T.p.pos.y - 31;
      out.ramps = T.pieces().filter((p) => p.type === 'ramp').length;
      out.planks = T.p.inventory.count('planks');
      // box up on flat ground
      for (const p of T.pieces()) Building.destroy(T.g, p);
      T.stand(-6.5, 6.5, 0, 0);
      T.press({ boxUp: true });
      out.box = T.pieces().map((p) => p.type).sort().join(',');
      // try to walk out in every direction
      const start = T.p.pos.clone();
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { T.p.yaw = yaw; T.it = { moveZ: 1 }; T.sim(0.8); T.it = {}; }
      out.pos = [T.p.pos.x, T.p.pos.z];
      out.y = T.p.pos.y;
      return out;
    });
    ctx.assert(r.climb >= 12, 'climbed at least 12 blocks in 4 s: ' + r.climb);
    ctx.assert(r.ramps >= 3 && r.planks === 200 - 5 * r.ramps, 'one ramp per cell, 5 planks each: ' + r.ramps + ' / ' + r.planks);
    ctx.assert(r.box === 'roof,wall,wall,wall,wall', 'four walls and a roof (floor is the ground): ' + r.box);
    // cell (-2, 1) spans x -8..-4, z 4..8; walls sit just outside it
    ctx.assert(r.pos[0] > -8 && r.pos[0] < -4 && r.pos[1] > 4 && r.pos[1] < 8 && r.y < 32, 'still inside the box: ' + r.pos.map((v) => v.toFixed(2)));
  },

  'rocket blows a hole and collapses a heavily damaged piece': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      T.mats(100);
      T.stand(2.5, 2.5, 0, 0);
      T.press({ buildPiece: 'wall' }); T.press({ fire: true, firePressed: true });
      T.press({ toggleBuild: true });
      Combat.explode(T.g, 1.5, 32.5, -1.5, Weapons.stats('rocket', 0), null);
      return { pieces: T.g.pieces.size, left: T.countBlock(BLOCK.BUILD_WOOD, 0, 3, 31, 34, -1, -1), map: T.g.pieceAt.size };
    });
    ctx.assert(r.pieces === 0 && r.left === 0 && r.map === 0, 'piece collapsed completely: ' + JSON.stringify(r));
  },

  'build mode renders: ghost, piece bar, material counts': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=4&arena=1', { viewport: { width: 1100, height: 650 } });
    await page.evaluate(() => {
      const p = __game.player; let it = { buildPiece: 'ramp' };
      p.controller = new ScriptedController(() => { const o = it; it = {}; return o; });
      p.pitch = -0.3;
    });
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({
      bar: getComputedStyle(document.querySelector('.hud[data-player=\"0\"] .buildbar')).display !== 'none',
      mats: document.querySelector('.hud[data-player=\"0\"] .mats').textContent.replace(/\s+/g, ' '),
      target: !!__game.player.build.target,
    }));
    ctx.assert(s.bar && s.target, 'build bar + target: ' + JSON.stringify(s));
    await ctx.screenshot(page, 'stage4-build');
  },
};
