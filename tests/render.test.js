/* Story mode's look: the smooth ground skin, palms and reeds as real geometry, the desert's blocks, and that the
 * other modes still draw their cubes. The mesher runs in Node here (the same worker code the browser runs). */

const WORKER_FILES = ['js/constants.js', 'js/world/blocks.js', 'js/worker/bundle.js', 'js/worker/noise.js',
  'js/worker/terrain.js', 'js/worker/sites.js', 'js/worker/mesher.js', 'js/worker/entry.js'];

/** A worker with the story's island, plus the chunks around (cx0, cz0): a (2r+1)^2 patch. */
function storyPatch(ctx, seed, cx0, cz0, r, smooth = true) {
  const w = ctx.worker(WORKER_FILES), vm = require('vm');
  const BLOCK = JSON.parse(JSON.stringify(vm.runInContext('BLOCK', w.main)));
  const TABLES = vm.runInContext('BlockTables', w.main), CONFIG = vm.runInContext('CONFIG', w.main);
  w.send({ type: 'init', seed, ids: BLOCK, tables: TABLES, sea: CONFIG.SEA_LEVEL, smooth,
    cfg: { chestChance: 0, island: CONFIG.STORY.ISLAND_RADIUS, story: Object.assign({ towerHeight: CONFIG.STORY.TOWER_HEIGHT }, CONFIG.STORY.SITES) } });
  const chunks = {};
  for (let cz = cz0 - r; cz <= cz0 + r; cz++) for (let cx = cx0 - r; cx <= cx0 + r; cx++) chunks[cx + ',' + cz] = w.send({ type: 'gen', id: 1, cx, cz }).data;
  const mesh = (cx, cz) => {
    const blocks = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) blocks.push(chunks[(cx + dx) + ',' + (cz + dz)] || null);
    return w.send({ type: 'mesh', id: 2, blocks, cx, cz });
  };
  return { w, BLOCK, TABLES, CONFIG, chunks, mesh };
}

const RENDER_TESTS = {
  'story mesher: the ground is one smooth skin, with no cracks between chunks and unit normals': async (ctx) => {
    const { chunks, mesh } = storyPatch(ctx, 20260101, 6, 6, 2);
    const a = mesh(6, 6), b = mesh(7, 6), c = mesh(6, 7);
    for (const [name, res] of [['a', a], ['b', b], ['c', c]]) {
      const G = res.ground;
      ctx.assert(G && G.pos.length > 0 && G.index.length > 0, 'chunk ' + name + ' has a ground skin');
      ctx.assert(G.index.length / 3 <= 2 * 256, 'at most two triangles per column: ' + G.index.length / 3);
      let bad = 0;
      for (let i = 0; i < G.pos.length; i += 3) {
        if (!(G.pos[i + 1] >= 0 && G.pos[i + 1] <= 64) || !isFinite(G.pos[i]) || !isFinite(G.pos[i + 2])) bad++;
        const n = Math.hypot(G.normal[i], G.normal[i + 1], G.normal[i + 2]);
        if (Math.abs(n - 1) > 1e-3 || G.normal[i + 1] <= 0) bad++;
      }
      ctx.assert(bad === 0, 'finite heights and unit upward normals in chunk ' + name + ': ' + bad + ' bad');
    }
    // the shared edge: chunk a's vertices at x = 16 are chunk b's at x = 0. Where both chunks have a vertex at the same z the heights
    // agree, unless a cliff splits the skin there (then the two sides are different skins, and a wall of cubes joins them).
    const edge = (G, x) => { const m = new Map(); for (let i = 0; i < G.pos.length; i += 3) if (G.pos[i] === x) { const z = G.pos[i + 2]; (m.get(z) || m.set(z, []).get(z)).push(G.pos[i + 1]); } return m; };
    const ea = edge(a.ground, 16), eb = edge(b.ground, 0);
    let shared = 0, same = 0;
    for (const [z, ys] of ea) {
      const yb = eb.get(z);
      if (!yb) continue;
      shared++;
      if (ys.some((y) => yb.some((y2) => Math.abs(y - y2) < 1e-4))) same++;
    }
    ctx.assert(shared >= 12, 'the two chunks share an edge of vertices: ' + shared);
    ctx.assert(same / shared >= 0.9, 'the skin is continuous across the chunk border: ' + same + ' of ' + shared + ' corners agree');
    // the same for the z edge
    const edgeZ = (G, z) => { const m = new Map(); for (let i = 0; i < G.pos.length; i += 3) if (G.pos[i + 2] === z) { const x = G.pos[i]; (m.get(x) || m.set(x, []).get(x)).push(G.pos[i + 1]); } return m; };
    const fa = edgeZ(a.ground, 16), fc = edgeZ(c.ground, 0);
    let shared2 = 0, same2 = 0;
    for (const [x, ys] of fa) { const yc = fc.get(x); if (!yc) continue; shared2++; if (ys.some((y) => yc.some((y2) => Math.abs(y - y2) < 1e-4))) same2++; }
    ctx.assert(shared2 >= 12 && same2 / shared2 >= 0.9, 'and across the z border: ' + same2 + ' of ' + shared2);
    ctx.assert(Object.keys(chunks).length === 25);
  },

  'story mesher: no cube tops on natural ground, the walls between neighbours are gone, and cliffs keep their cubes': async (ctx) => {
    const { chunks, mesh, BLOCK } = storyPatch(ctx, 20260101, 6, 6, 2);
    const smooth = mesh(6, 6), flat = storyPatch(ctx, 20260101, 6, 6, 2, false).mesh(6, 6);
    // classic meshing (the other modes) draws a cube face for every ground column: many more opaque triangles than the smooth one
    ctx.assert(!flat.ground && !flat.props, 'classic modes get no ground skin and no props');
    ctx.assert(smooth.opaque.index.length < flat.opaque.index.length * 0.8, 'the smooth variant draws far fewer cube faces: ' + smooth.opaque.index.length + ' vs ' + flat.opaque.index.length);
    ctx.assert(smooth.opaque.normal && smooth.opaque.normal.length === smooth.opaque.pos.length, 'cube faces carry their normals in the smooth variant');
    ctx.assert(!flat.opaque.normal, 'and not in the classic one');
    // a story world has no snow, no cacti and no cubes of leaves
    const seen = new Set();
    for (const d of Object.values(chunks)) for (let i = 0; i < d.length; i++) seen.add(d[i]);
    ctx.assert(!seen.has(BLOCK.SNOW) && !seen.has(BLOCK.CACTUS) && !seen.has(BLOCK.LEAVES), 'the story land has no snow, cacti or leaf cubes');
    ctx.assert(seen.has(BLOCK.SAND) && seen.has(BLOCK.PALM), 'it has sand and palm trunk cores');
  },

  'story mesher: palms and reeds are built as geometry, and each palm trunk is a solid column in the data': async (ctx) => {
    const { chunks, mesh, BLOCK, TABLES } = storyPatch(ctx, 20260101, 6, 6, 3);
    let palms = 0, reeds = 0, tris = 0, ms = 0, n = 0;
    for (let cz = 5; cz <= 7; cz++) {
      for (let cx = 5; cx <= 7; cx++) {
        const d = chunks[cx + ',' + cz];
        for (let i = 0; i < d.length; i++) { if (d[i] === BLOCK.PALM && d[i - 256] !== BLOCK.PALM) palms++; if (d[i] === BLOCK.BUSH) reeds++; }
        const t0 = Date.now(), r = mesh(cx, cz);
        ms += Date.now() - t0; n++;
        tris += r.props.index.length / 3;
        ctx.assert(r.props.pos.length === r.props.normal.length && r.props.pos.length === r.props.color.length && r.props.pos.length / 3 === r.props.sway.length, 'props vertex arrays line up');
      }
    }
    ctx.assert(palms >= 5, 'palms grow on this island: ' + palms);
    ctx.assert(tris > palms * 40, 'every palm is real geometry: ' + tris + ' triangles for ' + palms + ' palms and ' + reeds + ' reeds');
    ctx.assert(ms / n < 60, 'meshing a chunk takes well under a frame budget on average: ' + (ms / n).toFixed(1) + ' ms');
    // palm trunks are solid and opaque (collision and sight lines), and have no cube faces of their own
    ctx.assert(TABLES.solid[BLOCK.PALM] === 1 && TABLES.opaque[BLOCK.PALM] === 1 && TABLES.faceTiles[BLOCK.PALM * 6] === -1, 'the palm core is solid, opaque and has no tile');
  },

  'story world draws a lit landscape: a ground skin, palms, the sky dome; the other modes keep their cubes': async (ctx) => {
    const { page } = await ctx.open('autostart=1&mode=story&seed=kestrel-isle&rd=4', { waitReady: false });
    await page.waitForFunction(() => window.__game && window.__game.world && window.__game.world.stats().meshed >= 25 && document.getElementById('loading').style.display === 'none', null, { timeout: 120000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const w = __game.world;
      let ground = 0, props = 0, opaque = 0;
      for (const ch of w.chunks.values()) { if (ch.meshGround) ground++; if (ch.meshProps) props++; if (ch.meshOpaque) opaque++; }
      const dome = __game.world.scene.children.some((c) => c.material && c.material.uniforms && c.material.uniforms.uZenith);
      return { story: !!w.materials.story, ground, props, opaque, dome, sun: !!w.materials.shared.uSunDir, tilePx: w.materials.shared.uTilePx.value };
    });
    ctx.assert(r.story && r.ground >= 10 && r.props >= 3 && r.dome && r.sun && r.tilePx === 128, 'the story draws ground skins, props and a sky dome with its own materials: ' + JSON.stringify(r));
    // the sun's shadow layer must not hide the world from either split-screen camera
    const lay = await page.evaluate(() => {
      const w = __game.world, ch = [...w.chunks.values()].find((c) => c.meshGround);
      const m = ch.meshGround;
      return { shadow: (m.layers.mask & (1 << 6)) !== 0, p0: __views[0].camera.layers.test(m.layers), p1: __views[1].camera.layers.test(m.layers), base: (m.layers.mask & 1) !== 0 };
    });
    ctx.assert(lay.shadow && lay.p0 && lay.p1 && lay.base, 'chunks cast shadows and are visible to both players\' cameras: ' + JSON.stringify(lay));
    await ctx.screenshot(page, 'story-world');
    const { page: p2 } = await ctx.open('autostart=1&mode=sandbox&seed=cubes&rd=4', { waitReady: true });
    const c = await p2.evaluate(() => {
      const w = __game.world;
      let ground = 0, props = 0;
      for (const ch of w.chunks.values()) { if (ch.meshGround) ground++; if (ch.meshProps) props++; }
      return { story: !!w.materials.story, ground, props };
    });
    ctx.assert(!c.story && c.ground === 0 && c.props === 0, 'other modes still draw cubes with the classic materials: ' + JSON.stringify(c));
  },

  'ultra: a desktop graphics card gets Ultra on auto; the post-processed story frame has its shadows, clouds and a picture': async (ctx) => {
    const { page } = await ctx.open('autostart=1&mode=story&seed=kestrel-isle&rd=4&quality=ultra', { waitReady: false });
    await page.waitForFunction(() => window.__game && window.__game.world && window.__game.world.stats().meshed >= 25 && document.getElementById('loading').style.display === 'none', null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    const picks = await page.evaluate(() => [
      GpuTier.pick('ANGLE (AMD, AMD Radeon RX 9060 XT (0x00007590) Direct3D11 vs_5_0 ps_5_0, D3D11)', false),
      GpuTier.pick('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)', false),
      GpuTier.pick('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', false),
      GpuTier.pick('ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)', false),
      GpuTier.pick('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', false),
      GpuTier.pick('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)', false),
      GpuTier.pick('Adreno (TM) 740', true),
    ]);
    ctx.assert(JSON.stringify(picks) === JSON.stringify(['ultra', 'ultra', 'high', 'high', 'high', 'high', 'medium']),
      'auto: ultra for desktop cards (Radeon RX, GeForce RTX), high for built-in graphics and software, medium on touch: ' + JSON.stringify(picks));
    const r = await page.evaluate(() => {
      const gl = document.getElementById('gl').getContext('webgl2');
      return { gfx: __gfx(), err: gl.getError(), aniso: __game.world.materials.shared.uAniso.value, sun: !!__game.world.scene.children.find((c) => c.material && c.material.uniforms && c.material.uniforms.uClouds) };
    });
    ctx.assert(r.gfx.quality === 'ultra' && r.gfx.auto === 'high' && r.gfx.post && r.gfx.ratio >= 1, 'Ultra draws through the post-processing (software rendering alone would get High): ' + JSON.stringify(r.gfx));
    ctx.assert(r.gfx.shadow && r.gfx.shadow[1] === 80 && r.gfx.shadow[0] >= 4096 && r.gfx.clouds === 1 && r.sun, 'a wider sun shadow map and the cumulus dome: ' + JSON.stringify(r));
    ctx.assert(r.err === 0 && r.aniso >= 1, 'no GL errors: ' + JSON.stringify(r));
    // the finished picture is on the canvas: neither black nor one flat colour
    const png = await page.screenshot();
    const stats = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data; let sum = 0, sq = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sq += l * l; }
      const n = d.length / 4, mean = sum / n; return { mean, sd: Math.sqrt(sq / n - mean * mean) };
    }, png.toString('base64'));
    ctx.assert(stats.mean > 40 && stats.mean < 235 && stats.sd > 12, 'the post-processed frame shows the world: ' + JSON.stringify(stats));
    await ctx.screenshot(page, 'story-ultra');
  },
};

module.exports = { tests: RENDER_TESTS };
