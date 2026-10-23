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
      ctx.assert(G.index.length / 3 <= 2 * 256 + 4 * 256, 'at most two triangles per column, and two per cliff edge: ' + G.index.length / 3);
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

  'story mesher: no cube tops or walls on natural ground; cliffs are closed by strips, so the skin has no holes': async (ctx) => {
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
        ctx.assert(r.props.pos.length === r.props.normal.length && r.props.pos.length === r.props.color.length && r.props.pos.length / 3 === r.props.sway.length && r.props.tex.length === r.props.pos.length, 'props vertex arrays line up');
      }
    }
    ctx.assert(palms >= 5, 'palms grow on this island: ' + palms);
    ctx.assert(tris > palms * 40, 'every palm is real geometry: ' + tris + ' triangles for ' + palms + ' palms and ' + reeds + ' reeds');
    ctx.assert(ms / n < 60, 'meshing a chunk takes well under a frame budget on average: ' + (ms / n).toFixed(1) + ' ms');
    // palm trunks are solid and opaque (collision and sight lines), and have no cube faces of their own
    ctx.assert(TABLES.solid[BLOCK.PALM] === 1 && TABLES.opaque[BLOCK.PALM] === 1 && TABLES.faceTiles[BLOCK.PALM * 6] === -1, 'the palm core is solid, opaque and has no tile');
  },

  'story island: five times the land, an outer ring of sites, 120 relics and 370 challenges that name real places': async (ctx) => {
    const { w, CONFIG } = storyPatch(ctx, 20260101, 0, 0, 0);
    const info = w.send({ type: 'plan', id: 9 }).plan;
    ctx.assert(CONFIG.STORY.ISLAND_RADIUS >= 420, 'the island is five times the first one (radius 190): ' + CONFIG.STORY.ISLAND_RADIUS);
    const outer = info.sites.filter((s) => s.outer);
    ctx.assert(info.sites.length === 16 && outer.length === 7, 'keep, 8 villages, 6 camps, the hideout (7 of them on the outer ring): ' + info.sites.length + ' / ' + outer.length);
    let gap = Infinity;
    for (const a of info.sites) for (const b of info.sites) if (a.id < b.id) gap = Math.min(gap, Math.hypot(a.x - b.x, a.z - b.z) - a.flat - b.flat);
    ctx.assert(gap > 20, 'no two sites overlap: ' + gap.toFixed(1));
    ctx.assert(info.relics.length === 120 && info.relics.every((r) => info.sites.every((s) => Math.hypot(s.x - r.x, s.z - r.z) > s.flat)), '120 relics, none inside a site: ' + info.relics.length);
    // the main thread's view of it, the story's places and the challenges (in a context of their own)
    const vm = require('vm'), fs = require('fs'), path = require('path');
    const c = vm.createContext({ console, THREE: {} });
    for (const f of ['js/constants.js', 'js/story/plan.js', 'js/story/challenges.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), c, { filename: f });
    const r = vm.runInContext(`(() => {
      const plan = new StoryPlan(${JSON.stringify(info)});
      const keys = new Set(plan.sites.map((s) => s.key));
      const ids = new Set(STORY_CHALLENGES.map((x) => x.id));
      const named = STORY_CHALLENGES.filter((x) => /^(visit|sync|leap|travel|relics|contract|kills|silent)-/.test(x.id) && x.id !== 'relics-wilds');
      const missing = named.map((x) => x.id.replace(/^[a-z]+-/, '').replace(/-[0-9]+$/, '')).filter((k) => !keys.has(k));
      return { n: STORY_CHALLENGES.length, ids: ids.size, missing, relicAreas: new Set(plan.relics.map((x) => x.area)).size, inner: plan.villages.filter((v) => !v.outer).length };
    })()`, c);
    ctx.assert(r.n === 370 && r.ids === 370, 'ten times the 37 challenges, each with its own id: ' + r.n + ' / ' + r.ids);
    ctx.assert(r.missing.length === 0, 'every place a challenge names is on the island: ' + JSON.stringify(r.missing.slice(0, 5)));
    ctx.assert(r.relicAreas === 17 && r.inner === 4, 'relics round every site and in the wilds; the story keeps its four villages: ' + JSON.stringify(r));
  },

  'story mesher: stone gets bevelled corners; ivy, awnings and beds are props, not cubes': async (ctx) => {
    const { w, BLOCK } = storyPatch(ctx, 20260101, 0, 0, 0);
    const c = new Uint8Array(16 * 16 * 64), put = (x, y, z, id) => { c[x + z * 16 + y * 256] = id; };
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 20; y++) put(x, y, z, y === 20 ? BLOCK.SAND : BLOCK.STONE);
    for (let y = 21; y <= 23; y++) for (let z = 2; z <= 4; z++) for (let x = 2; x <= 4; x++) put(x, y, z, BLOCK.COBBLE);   // a 3 x 3 x 3 block of stone
    put(3, 24, 1, BLOCK.LEAVES);                                                                                  // ivy on its side, above
    put(3, 22, 1, BLOCK.LEAVES);
    for (const [x, z] of [[8, 8], [11, 8], [8, 10], [11, 10]]) for (let y = 21; y <= 23; y++) put(x, y, z, BLOCK.WOOD);   // posts
    for (let z = 8; z <= 10; z++) for (let x = 8; x <= 11; x++) put(x, 24, z, BLOCK.CLOTH);                         // an awning on them
    put(13, 21, 3, BLOCK.CLOTH); put(13, 21, 4, BLOCK.CLOTH);                                                       // a bed on the floor
    const r = w.send({ type: 'mesh', id: 3, blocks: [null, null, null, null, c, null, null, null, null], cx: 0, cz: 0 });
    const O = r.opaque, nv = O.pos.length / 3;
    ctx.assert(O.edge && O.edge.length === nv * 4, 'every story cube vertex carries its distances to the corner edges');
    // the stone block: vertices cut back from its corners (the bevel) and none outside the block
    let inset = 0, outside = 0, onMid = 0;
    for (let k = 0; k < nv; k++) {
      const x = O.pos[k * 3], y = O.pos[k * 3 + 1], z = O.pos[k * 3 + 2];
      if (x < 1.9 || x > 5.1 || z < 1.9 || z > 5.1 || y < 21 || y > 24.01) continue;
      if (x < 2 - 1e-4 || x > 5 + 1e-4 || z < 2 - 1e-4 || z > 5 + 1e-4 || y > 24 + 1e-4) outside++;
      if (Math.abs(x - 2) < 1e-4 && z > 2.01 && z < 2.1 && y > 23.9 && y < 24.0) inset++;
      for (let e = 0; e < 4; e++) if (O.edge[k * 4 + e] === 0) { onMid++; break; }
    }
    ctx.assert(inset > 0, 'faces are cut back along the corner edges: ' + inset);
    ctx.assert(onMid > 8, 'the bevels meet on their middle lines: ' + onMid);
    ctx.assert(outside === 0, 'nothing sticks out of the block: ' + outside);
    // no cube faces for the ivy, the awning or the bed; their props are there instead
    let clothFaces = 0;
    for (let k = 0; k < nv; k++) { const x = O.pos[k * 3], y = O.pos[k * 3 + 1], z = O.pos[k * 3 + 2]; if (x > 8.01 && x < 11.99 && z > 8.01 && z < 10.99 && y > 24.5) clothFaces++; }
    ctx.assert(clothFaces === 0, 'the awning has no cube top: ' + clothFaces);
    const kinds = {};
    for (let k = 2; k < r.props.tex.length; k += 3) kinds[r.props.tex[k]] = (kinds[r.props.tex[k]] || 0) + 1;
    ctx.assert(kinds[3] > 50, 'ivy leaves: ' + JSON.stringify(kinds));
    ctx.assert(kinds[4] > 100, 'striped cloth (the awning and the bed\'s blanket): ' + JSON.stringify(kinds));
    // the awning sags under the block's top, the bed's mattress is low
    let awn = Infinity, bedTop = 0;
    for (let k = 0; k < r.props.pos.length / 3; k++) {
      const x = r.props.pos[k * 3], y = r.props.pos[k * 3 + 1], z = r.props.pos[k * 3 + 2];
      if (x > 8.2 && x < 11.8 && z > 8.2 && z < 10.8 && y > 24) awn = Math.min(awn, y);
      if (x > 13 && x < 14 && z > 3 && z < 5) bedTop = Math.max(bedTop, y);
    }
    ctx.assert(awn > 24.6 && awn < 25, 'the awning hangs inside its block, sagging: ' + awn);
    ctx.assert(bedTop > 21.3 && bedTop < 21.6, 'the bed is a low mattress: ' + bedTop);
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

  'people: with real bodies on (?humans=1) the lobby figure is a skinned MakeHuman person whose skeleton follows the rig': async (ctx) => {
    const { page } = await ctx.open('humans=1', { waitReady: false });
    await page.waitForFunction(() => typeof HumanModels !== 'undefined' && HumanModels.ready && window.__lobby && __lobby.model && __lobby.model.human, null, { timeout: 180000 });
    const r = await page.evaluate(() => {
      const M = __lobby.model, H = M.human;
      M.armR.shoulder.rotation.set(Math.PI / 2, 0, 0);          // the rig's right arm straight forward
      H.pose(M);
      M.root.updateMatrixWorld(true);
      const sh = H.bones.upperarm_r.getWorldPosition(new THREE.Vector3()), el = H.bones.lowerarm_r.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(M.body.getWorldQuaternion(new THREE.Quaternion()));
      const hair = Object.entries(H.meshes).filter(([k, m]) => /short|long|afro|ponytail|bob|braid/.test(k) && m.visible).length;
      return { kinds: Object.keys(HumanModels.kinds), meshes: Object.keys(H.meshes).length, forward: +el.sub(sh).normalize().dot(fwd).toFixed(3), hair };
    });
    ctx.assert(r.kinds.includes('male') && r.kinds.includes('female') && r.meshes >= 10, 'a man and a woman, with body, clothes, eyes and hair: ' + JSON.stringify(r));
    ctx.assert(r.hair === 1, 'one hair style shows: ' + JSON.stringify(r));
    ctx.assert(r.forward > 0.9, 'the real arm points where the rig\'s arm points: ' + JSON.stringify(r));
    // garments made for the body: a hood (no hair under it), a cloak on its own bone that trails with the rig's cape, a beard
    const g = await page.evaluate(() => {
      __lobby.setLook(Object.assign({}, PLAYER_LOOK.DEFAULT, { hood: true, cloak: true, facial: 2, body: 0 }));
      const M = __lobby.model, H = M.human, vis = (k) => !!(H.meshes[k] && H.meshes[k].visible);
      const before = H.bones.cloak.getWorldQuaternion(new THREE.Quaternion());
      M.cape.rotation.x = -0.6; H.pose(M); M.root.updateMatrixWorld(true);
      const after = H.bones.cloak.getWorldQuaternion(new THREE.Quaternion());
      const hair = Object.entries(H.meshes).filter(([k, m]) => /short|long|afro|ponytail|bob|braid/.test(k) && m.visible).length;
      return { hood: vis('garment_hood'), cloak: vis('garment_cloak'), beard: vis('garment_beard'), skirts: ['garment_tails', 'garment_long', 'garment_kilt'].filter(vis).length,
        hair, turn: +(2 * Math.acos(Math.min(1, Math.abs(before.dot(after))))).toFixed(2), garb: !!H.meshes.garment_hood.geometry.attributes.garb };
    });
    ctx.assert(g.hood && g.cloak && g.beard && g.skirts === 0 && g.hair === 0 && g.garb, 'the hood, the cloak and the beard are worn, no skirt, no hair under the hood: ' + JSON.stringify(g));
    ctx.assert(g.turn > 0.4, 'the cloak swings with the rig\'s cape: ' + JSON.stringify(g));
    // High and up: the accents (boots, bracers, the belt's buckle and pouches, a scabbard); real swords and a bow
    const acc = await page.evaluate(() => {
      const M = __lobby.model, H = M.human, vis = (k) => !!(H.meshes[k] && H.meshes[k].visible);
      const metal = M.swords.longsword.children.filter((c) => c.material && c.material.metalness === 1).length;
      return { tier: HumanModels.tier, boots: vis('garment_boots'), bracers: vis('garment_bracers'), kit: vis('garment_kit'), scabbard: !!M.scabbard,
        swordParts: M.swords.longsword.children.length, metal, bow: M.bow.group.children[0].children.length };
    });
    ctx.assert(acc.tier >= 1 && acc.boots && acc.bracers && acc.kit && acc.scabbard, 'boots, bracers, a belt with a buckle and pouches, a scabbard: ' + JSON.stringify(acc));
    ctx.assert(acc.swordParts >= 5 && acc.metal >= 3 && acc.bow >= 5, 'the sword is blade, guard, grip and pommel in metal and leather; the bow is in parts: ' + JSON.stringify(acc));
    // the setting off: the drawn body again (software rendering keeps it by default)
    const { page: p2 } = await ctx.open('', { waitReady: false });
    await p2.waitForFunction(() => window.__lobby && __lobby.model, null, { timeout: 60000 });
    ctx.assert(await p2.evaluate(() => !__lobby.model.human && HumanModels.enabled === false), 'software rendering draws the bodies');
  },

  'epic: ambient occlusion, a second shadow map for the far land, the sea mirroring the world and grass in the fields': async (ctx) => {
    const { page } = await ctx.open('autostart=1&mode=story&seed=kestrel-isle&rd=4&quality=epic', { waitReady: false, viewport: { width: 640, height: 400 } });
    await page.waitForFunction(() => window.__game && window.__game.world && window.__game.world.stats().meshed >= 25 && document.getElementById('loading').style.display === 'none', null, { timeout: 240000 });
    // somewhere over the sea, looking at the shore, so the reflection is drawn
    await page.evaluate(() => { const g = __game, v = g.story.places.V1, R = CONFIG.STORY.ISLAND_RADIUS, a = Math.atan2(v.z, v.x); g.paused = true; g.player.teleport(Math.cos(a) * (R + 6), CONFIG.SEA_LEVEL + 4, Math.sin(a) * (R + 6)); g.player.yaw = Math.atan2(Math.cos(a), Math.sin(a)); g.timeOfDay = 0.45; });
    await page.waitForFunction(() => __game.world.isAreaMeshed(Math.floor(__game.player.pos.x / 16), Math.floor(__game.player.pos.z / 16), 1), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const gl = document.getElementById('gl').getContext('webgl2'), S = __game.world.materials.shared, P = __post();
      let grass = 0, chunks = 0;
      for (const ch of __game.world.chunks.values()) { if (ch.meshGrass) { grass += ch.meshGrass.geometry.index.count / 3; chunks++; } }
      return { gfx: __gfx(), err: gl.getError(), ao: P.opts.ao, depth: !!P.scene.depthTexture, far: S.uShadowMap2.value !== S.uShadowMap.value, farOn: S.uShadow2On.value,
        refl: S.uReflOn.value, reflRt: !!(__refl().rts[0] && __refl().rts[0].width > 0), grass, chunks };
    });
    ctx.assert(r.gfx.quality === 'epic' && r.gfx.post && r.gfx.ratio >= 1, 'Epic draws through the post-processing: ' + JSON.stringify(r.gfx));
    ctx.assert(r.ao > 0 && r.depth, 'ambient occlusion reads the scene\'s depth: ' + JSON.stringify(r));
    ctx.assert(r.far && r.farOn > 0, 'a second, wide shadow map for the far land: ' + JSON.stringify(r));
    ctx.assert(r.refl > 0.5 && r.reflRt, 'the sea mirrors the world: ' + JSON.stringify(r));
    ctx.assert(r.grass > 1000 && r.chunks > 0, 'grass grows in the fields: ' + JSON.stringify(r));
    ctx.assert(r.err === 0, 'no GL errors: ' + JSON.stringify(r));
    const png = await page.screenshot();
    const stats = await page.evaluate((b64) => new Promise((res) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 40; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 40); const d = x.getImageData(0, 0, 64, 40).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; lo = Math.min(lo, l); hi = Math.max(hi, l); } res({ lo, hi }); };
      img.src = 'data:image/png;base64,' + b64;
    }), png.toString('base64'));
    ctx.assert(stats.hi - stats.lo > 40, 'a picture, not a flat colour: ' + JSON.stringify(stats));
    await ctx.screenshot(page, 'story-epic');
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
      GpuTier.pick('ANGLE (AMD, Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', false),
      GpuTier.pick('ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', false),
    ]);
    ctx.assert(JSON.stringify(picks) === JSON.stringify(['epic', 'epic', 'high', 'high', 'high', 'high', 'medium', 'ultra', 'ultra']),
      'auto: epic for the newest desktop cards (Radeon RX 6600 and up, GeForce RTX), ultra for older desktop cards, high for built-in graphics and software, medium on touch: ' + JSON.stringify(picks));
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
