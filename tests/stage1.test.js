/* Stage 1: terrain generation, greedy meshing, rendering, movement + collision. */
const WORKER_FILES = ['js/constants.js', 'js/world/blocks.js', 'js/worker/bundle.js', 'js/worker/noise.js',
  'js/worker/terrain.js', 'js/worker/sites.js', 'js/worker/mesher.js', 'js/worker/entry.js'];

/** Generates a 5x5 chunk patch around the origin with the worker code running in Node. */
function genPatch(ctx, seed) {
  const w = ctx.worker(WORKER_FILES);
  const BLOCK = JSON.parse(JSON.stringify(require('vm').runInContext('BLOCK', w.main)));
  const TABLES = require('vm').runInContext('BlockTables', w.main);
  w.send({ type: 'init', seed, ids: BLOCK, tables: TABLES, sea: 20 });
  const chunks = {};
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) chunks[cx + ',' + cz] = w.send({ type: 'gen', id: 1, cx, cz }).data;
  return { w, BLOCK, TABLES, chunks };
}

function quadArea(L) {
  let A = 0;
  for (let q = 0; q < L.pos.length / 12; q++) {
    const o = q * 12, P = (i) => [L.pos[o + i * 3], L.pos[o + i * 3 + 1], L.pos[o + i * 3 + 2]];
    const a = P(0), b = P(1), c = P(3);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    A += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
  }
  return A;
}

exports.tests = {
  'mesher area equals brute-force visible faces (several chunks)': async (ctx) => {
    const { w, TABLES, chunks } = genPatch(ctx, 12345);
    const blockAt = (x, y, z) => {
      if (y < 0) return 16; if (y >= 64) return 0;
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
      return chunks[cx + ',' + cz][(x - cx * 16) + (z - cz * 16) * 16 + y * 256];
    };
    for (const [ccx, ccz] of [[0, 0], [-1, 1], [1, -1]]) {
      const nb = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(chunks[(ccx + dx) + ',' + (ccz + dz)]);
      const r = w.send({ type: 'mesh', id: 2, blocks: nb });
      let solid = 0, water = 0;
      for (let y = 0; y < 64; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const gx = ccx * 16 + x, gz = ccz * 16 + z, a = blockAt(gx, y, gz);
        if (!a) continue;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const b = blockAt(gx + dx, y + dy, gz + dz);
          if (TABLES.opaque[b] || a === b) continue;
          if (TABLES.liquid[a]) water++; else solid++;
        }
      }
      ctx.near(quadArea(r.opaque), solid, 1e-6, `solid face area chunk ${ccx},${ccz}`);
      ctx.near(quadArea(r.water), water, 1e-6, `water face area chunk ${ccx},${ccz}`);
      for (const L of [r.opaque, r.water]) {
        for (const v of L.pos) ctx.assert(Number.isFinite(v), 'finite vertex');
        for (const i of L.index) ctx.assert(i < L.pos.length / 3, 'index in range');
      }
    }
  },

  'terrain is deterministic and ore rates are sane': async (ctx) => {
    const a = genPatch(ctx, 777), b = genPatch(ctx, 777);
    for (const k of Object.keys(a.chunks)) ctx.assert(Buffer.compare(Buffer.from(a.chunks[k]), Buffer.from(b.chunks[k])) === 0, 'same seed -> same chunk ' + k);
    const counts = {};
    for (const d of Object.values(a.chunks)) for (const v of d) counts[v] = (counts[v] || 0) + 1;
    const stone = (counts[3] || 0) + (counts[9] || 0) + (counts[10] || 0);
    ctx.assert((counts[9] || 0) / stone < 0.04, 'iron ore under 4% of rock');
    ctx.assert((counts[10] || 0) / stone < 0.02, 'gold ore under 2% of rock');
  },

  'physics: walk/sprint speed, walls, ceilings, gaps, landing': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=5');
    const r = await page.evaluate(() => {
      // Drives the local player through a scripted controller and fixed sim ticks.
      const g = window.__game, world = g.world, player = g.player;
      const keys = new Set();
      player.controller = new ScriptedController(() => ({
        moveZ: keys.has('KeyW') ? 1 : 0, sprint: keys.has('ShiftLeft'), jump: keys.has('Space'),
      }));
      const sim = (secs, dt = 1 / 60) => { for (let t = 0; t < secs - 1e-9; t += dt) g.tick(dt); };
      const set = (x, y, z, id) => { const ch = world.chunks.get(World.key(x >> 4, z >> 4)); ch.data[(x & 15) + (z & 15) * 16 + y * 256] = id; };
      for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) { for (let y = 28; y <= 30; y++) set(x, y, z, 3); for (let y = 31; y <= 45; y++) set(x, y, z, 0); }
      const out = {};
      player.flying = false; player.yaw = 0;
      player.teleport(0.5, 40, 10.5); sim(2);
      out.landY = player.pos.y; out.onGround = player.onGround;
      keys.add('KeyW'); sim(0.2); let z1 = player.pos.z; sim(1); out.walk = z1 - player.pos.z;
      keys.add('ShiftLeft'); sim(0.3); z1 = player.pos.z; sim(1); out.sprint = z1 - player.pos.z; keys.clear();
      for (let x = -3; x <= 3; x++) for (let y = 31; y <= 33; y++) set(x, y, 0, 3);
      player.teleport(0.5, 31.01, 10.5); keys.add('KeyW'); keys.add('ShiftLeft'); sim(4); out.wallZ = player.pos.z; keys.clear();
      for (let x = 8; x <= 10; x++) for (let z = 5; z <= 9; z++) set(x, 33, z, 3);
      player.teleport(9.5, 31.01, 7.5); sim(0.3); keys.add('Space');
      let head = 0; for (let t = 0; t < 1; t += 1 / 60) { g.tick(1 / 60); head = Math.max(head, player.pos.y + 1.8); }
      out.head = head; keys.clear();
      player.teleport(0.5, 60, -10.5); sim(3, 0.05); out.lagLandY = player.pos.y;
      return out;
    });
    ctx.near(r.landY, 31, 0.01, 'lands on the floor'); ctx.assert(r.onGround, 'grounded');
    ctx.near(r.walk, 4.4, 0.05, 'walk speed'); ctx.near(r.sprint, 6.8, 0.05, 'sprint speed');
    ctx.near(r.wallZ, 1.3, 0.01, 'stopped flush against wall');
    ctx.near(r.head, 33, 0.01, 'head stops at ceiling');
    ctx.near(r.lagLandY, 31, 0.01, 'no tunnelling at 20 FPS steps');
  },

  'world renders without errors': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=6&up=14&pitch=-20&yaw=30');
    await page.waitForTimeout(800);
    const stats = await page.evaluate(() => window.__game.world.stats());
    ctx.assert(stats.meshed >= 20, 'chunks meshed: ' + stats.meshed);
    await ctx.screenshot(page, 'stage1-overview');
  },
};
