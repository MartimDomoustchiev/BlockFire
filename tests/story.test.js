/* Story mode: the island's sites, movement, stealth, the campaign, contracts, the shop, online co-op. */

/** Opens story mode (fresh save) and waits until the hideout is ready; the sim is paused for scripted stepping. */
async function story(ctx, extra = '') {
  const r = await ctx.open('autostart=1&mode=story&rd=4' + extra, {
    waitReady: false,
    beforeGoto: (p) => p.addInitScript(() => { try { if (!sessionStorage.getItem('keepStory')) localStorage.removeItem('blockfire.story.v1'); } catch (e) { /* */ } }),
  });
  await r.page.waitForFunction(() => window.__game && window.__game.story && document.getElementById('loading').style.display === 'none', null, { timeout: 120000 });
  await r.page.evaluate(() => {
    const g = __game;
    g.paused = true;
    window.__step = (n, it) => { g.player.controller = new ScriptedController(it || {}); for (let i = 0; i < n; i++) g.tick(1 / 60); };
    window.__obj = () => { const o = g.story.objective(); return o ? o.text : null; };
    // stand next to someone, on the side facing `toward` (so we don't end up inside a wall)
    window.__beside = (c, toward, d = 1.8) => {
      const dx = toward.x - c.pos.x, dz = toward.z - c.pos.z, L = Math.hypot(dx, dz) || 1;
      g.player.teleport(c.pos.x + dx / L * d, c.pos.y, c.pos.z + dz / L * d);
    };
  });
  return r;
}

/** Host + client pages joined by the test bridge (see net.test.js). */
async function pair(ctx, hostQuery) {
  const pages = {};
  const deliver = async (json) => {
    const m = JSON.parse(json);
    const target = m.to === 'host' ? pages.host : pages.client;
    if (target) await target.evaluate((j) => window.__netIn && window.__netIn(j), json).catch(() => {});
  };
  const clear = (p) => p.addInitScript(() => { try { localStorage.removeItem('blockfire.story.v1'); } catch (e) { /* */ } });
  await ctx.open(hostQuery, { waitReady: false, beforeGoto: async (p) => { pages.host = p; await clear(p); await p.exposeFunction('__netOut', deliver); } });
  await pages.host.waitForFunction(() => window.__game && window.__game.net, null, { timeout: 60000 });
  await ctx.open('autostart=1&net=bridge&join=TEST&name=Bob&rd=4', {
    waitReady: false,
    beforeGoto: async (p) => { pages.client = p; await clear(p); await p.exposeFunction('__netOut', deliver); await p.addInitScript(() => { window.__netId = 'c1'; }); },
  });
  await pages.client.waitForFunction(() => window.__game && window.__game.net && window.__game.net.tpAck > 0 && window.__game.story && window.__game.story.mirror,
    null, { timeout: 150000 });
  await pages.host.waitForFunction(() => window.__game.story && window.__game.characters().some((c) => c.netRemote && c.isHuman), null, { timeout: 30000 });
  return pages;
}

const DRIVE = `(f) => {
  const g = window.__game, me = g.player;
  window.__drive = f;
  me.controller = new RecordingController(new ScriptedController(() => { const o = Object.assign({}, window.__drive || {}, window.__once || {}); window.__once = null; return o; }), (it) => g.net.queueIntent(it));
}`;

exports.tests = {
  'story world: keep, villages, camps and hideout are built from the seed, joined by roads': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, P = g.story.plan, w = g.world;
      const kinds = {};
      for (const s of P.sites) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
      const towers = P.viewpoints.map((v) => {
        const t = v.site.poi.tower;
        return { stone: w.getBlock(Math.floor(t.top.x), t.top.y - 1, Math.floor(t.top.z)) === BLOCK.COBBLE,
          perch: w.getBlock(Math.floor(t.perch.x), t.perch.y - 1, Math.floor(t.perch.z)) === BLOCK.PLANKS,
          hay: w.getBlock(Math.floor(t.hay.x), t.hay.y, Math.floor(t.hay.z)) === BLOCK.HAY };
      });
      // the middle of a road is a path
      const road = P.roads[0], mid = road.pts[Math.floor(road.pts.length / 2)];
      let path = false;
      for (let y = 60; y > 0 && !path; y--) { const b = w.getBlock(Math.floor(mid[0]), y, Math.floor(mid[1])); if (b > 0 && b !== BLOCK.WATER) path = b === BLOCK.PATH || b === BLOCK.PLANKS; if (b > 0) break; }
      const camp = P.camps[0], cage = camp.poi.cage;
      return {
        kinds, roads: P.roads.length, towers, path, names: P.sites.map((s) => s.name),
        cageBars: cage.door.every(([x, y, z]) => w.getBlock(x, y, z) === BLOCK.BARS),
        board: P.villages.every((v) => w.getBlock(v.poi.board.bx, v.poi.board.by, v.poi.board.bz) === BLOCK.BOARD),
        people: { guards: g.characters().filter((c) => c.npcRole === 'guard').length, villagers: g.characters().filter((c) => c.npcRole === 'villager').length },
      };
    });
    ctx.assert(r.kinds.keep === 1 && r.kinds.village === 8 && r.kinds.camp === 6 && r.kinds.hideout === 1, 'sites (4 villages and 3 camps for the story, an outer ring of 4 and 3 more): ' + JSON.stringify(r.kinds));
    ctx.assert(r.roads >= 10 && r.path, 'roads with path surface: ' + r.roads + ' ' + r.path);
    ctx.assert(r.towers.length === 10 && r.towers.every((t) => t.stone && t.perch && t.hay), 'viewpoint towers with perch and hay: ' + JSON.stringify(r.towers));
    ctx.assert(r.cageBars && r.board, 'camp cages and village notice boards');
    ctx.assert(r.people.guards > 40 && r.people.villagers > 25, 'populated: ' + JSON.stringify(r.people));
    await page.evaluate(() => {
      const g = __game, v = g.story.places.V1, p = g.player;
      g.paused = false;
      p.teleport(v.x + 13, v.h + 9, v.z + 13); p.flying = true; p.yaw = Math.atan2(13, 13); p.pitch = -0.35;
    });
    await page.waitForFunction(() => { const p = __game.player.pos; return __game.world.isAreaMeshed(Math.floor(p.x / 16), Math.floor(p.z / 16), 2); }, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await ctx.screenshot(page, 'story-village');
  },

  'story movement: climb any wall, leap of faith into hay, fall damage, sneaking': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, T = g.story.places.V2.poi.tower, out = {};
      for (const c of g.characters()) if (c.npc && c.site === g.story.places.V2.key) c.removed = true;   // nobody watching
      __step(1);
      const tx = T.x0 + 2.5, tz = T.z0 + 2.5;
      p.teleport(T.base.x, T.base.y + 0.01, T.base.z);
      p.yaw = Math.atan2(-(tx - T.base.x), -(tz - T.base.z));
      __step(20);
      for (let i = 0; i < 60 * 9 && !(p.onGround && p.pos.y > T.top.y - 1.2); i++) __step(1, { moveZ: 1, jump: true });
      out.top = Math.abs(p.pos.y - T.top.y) < 1.2;
      p.teleport(T.perch.x, T.perch.y + 0.01, T.perch.z);
      p.yaw = Math.atan2(-(T.hay.x - T.top.x), -(T.hay.z - T.top.z));
      __step(10); __step(20, { moveZ: 1, jump: true });
      out.leaping = !!p.leap;
      __step(60 * 3);
      out.leapHp = p.health;
      out.inHay = g.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.2), Math.floor(p.pos.z)) === BLOCK.HAY;
      out.hidden = p.hidden;
      p.revive(); p.teleport(T.base.x, T.base.y + 14, T.base.z);
      __step(60 * 3);
      out.fallHp = p.health;
      p.revive(); p.teleport(T.base.x, T.base.y + 0.01, T.base.z); p.yaw = p.yaw + Math.PI;
      __step(10);
      const a = p.pos.clone();
      __step(60, { moveZ: 1, crouch: true });
      out.sneak = +a.distanceTo(p.pos).toFixed(2);
      out.sneaking = p.sneaking;
      return out;
    });
    ctx.assert(r.top, 'climbed to the top of the tower');
    ctx.assert(r.leaping && r.inHay && r.hidden && r.leapHp === 100, 'leap of faith lands in the hay, unhurt and hidden: ' + JSON.stringify(r));
    ctx.assert(r.fallHp < 70 && r.fallHp > 0, 'a 14-block fall onto the ground hurts: ' + r.fallHp);
    ctx.assert(r.sneaking && r.sneak > 1.8 && r.sneak < 2.8, 'sneaking is slow: ' + r.sneak);
  },

  'story stealth: trespassers are spotted, help is called, hay breaks the chase; takedowns from behind and above': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, out = {};
      const camp = st.places.C1, guards = st.guardsOf(camp.key);
      const cg = guards.find((c) => !c.controller.route && !c.controller.marksman && Math.hypot(c.pos.x - camp.x, c.pos.z - camp.z) < 9) || guards[0];
      __step(2);
      p.teleport(cg.pos.x - Math.sin(cg.yaw) * 6, cg.pos.y, cg.pos.z - Math.cos(cg.yaw) * 6);
      let t = null;
      for (let i = 0; i < 300 && t === null; i++) { __step(1); if (cg.controller.state === 'combat') t = i / 60; }
      out.spotted = t;
      out.helpers = guards.filter((c) => c.controller.state === 'combat').length;
      const hay = camp.poi.hides[0];
      p.teleport(hay.x, hay.y + 0.01, hay.z);
      __step(60 * 6);
      out.hidden = p.hidden;
      out.searching = guards.filter((c) => c.controller.state === 'search').length;
      // a quiet village guard: from behind
      st._retry && st.activity && 0;
      for (const c of g.characters()) if (c.npcRole === 'guard') { c.controller.state = c.controller.homeState; c.controller.aware.clear(); c.controller.target = null; }
      st.notoriety = 0;
      const v = st.places.V3, vg = st.guardsOf(v.key).find((c) => !c.controller.route);
      // (on open ground: wherever his post is, there may be a wall right behind him)
      const open = v.poi.spots[Math.min(3, v.poi.spots.length - 1)];
      vg.teleport(open.x, open.y + 0.01, open.z); vg.yaw = 0;
      p.revive();
      p.teleport(vg.pos.x + Math.sin(vg.yaw) * 1.5, vg.pos.y, vg.pos.z + Math.cos(vg.yaw) * 1.5);
      p.yaw = vg.yaw; p.selectSlot(0);
      __step(3);
      out.reticle = Blade.takedownTarget(g, p) === vg;
      __step(1, { fire: true, firePressed: true });
      __step(30);
      out.behind = !vg.alive && vg.corpse;
      const vg2 = st.guardsOf(v.key).find((c) => c.alive);
      let fall = 0;
      g.events.on('damage', (e) => { if (e.target === p && e.kind === 'fall') fall += e.amount; });
      p.teleport(vg2.pos.x + 0.5, vg2.pos.y + 7.5, vg2.pos.z);
      __step(24);
      __step(1, { fire: true, firePressed: true });
      __step(30);
      out.air = { dead: !vg2.alive, fall };
      return out;
    });
    ctx.assert(r.spotted !== null && r.spotted < 2.5, 'trespasser spotted: ' + r.spotted);
    ctx.assert(r.helpers >= 2, 'the guard called for help: ' + r.helpers);
    ctx.assert(r.hidden && r.searching >= 1, 'hiding in hay turned the chase into a search: ' + JSON.stringify(r));
    ctx.assert(r.reticle && r.behind, 'takedown from behind: ' + JSON.stringify(r));
    ctx.assert(r.air.dead && r.air.fall === 0, 'air assassination, fall broken: ' + JSON.stringify(r.air));
  },

  'story healing: health comes back by itself after a while without damage (players only)': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, out = {};
      const w = st.mentor, en = st.plan.hideout.poi.entrance, L = Math.hypot(en.x - w.pos.x, en.z - w.pos.z);
      p.teleport(w.pos.x + (en.x - w.pos.x) / L * 2.5, w.pos.y, w.pos.z + (en.z - w.pos.z) / L * 2.5);   // safe at the hideout
      __step(5);
      Combat.applyDamage(g, p, 60, { kind: 'fall' });
      out.hurt = Math.round(p.health);
      __step(60 * (CONFIG.STORY.REGEN.DELAY - 1));
      out.beforeDelay = Math.round(p.health);                         // nothing yet
      Combat.applyDamage(g, p, 10, { kind: 'fall' });                 // hurt again: the wait starts over
      __step(60 * (CONFIG.STORY.REGEN.DELAY - 1));
      out.afterSecondHit = Math.round(p.health);
      __step(60 * 3);
      out.healing = Math.round(p.health);
      __step(60 * 6);
      out.full = Math.round(p.health);
      // guards don't heal
      const guard = g.characters().find((c) => c.npcRole === 'guard' && c.alive);
      const hp = guard.health;
      Combat.applyDamage(g, guard, 30, {});
      __step(60 * 10);
      out.guard = [Math.round(hp - 30), Math.round(guard.health)];
      return out;
    });
    ctx.assert(r.hurt === 40 && r.beforeDelay === 40 && r.afterSecondHit === 30, 'no healing until a while after the last hit: ' + JSON.stringify(r));
    ctx.assert(r.healing > 40 && r.healing < 100, 'then it comes back: ' + JSON.stringify(r));
    ctx.assert(r.full === 100, 'up to full: ' + JSON.stringify(r));
    ctx.assert(r.guard[0] === r.guard[1], 'guards do not regenerate: ' + JSON.stringify(r.guard));
  },

  'story arms crates: restock arrows, smoke and rounds in enemy camps, the keep and the hideout; empty until restocked': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, A = CONFIG.STORY.ARMORY, out = {};
      const crates = st.plan.sites.filter((s) => s.poi.armory);
      out.where = crates.map((s) => s.kind).sort();
      out.blocks = crates.every((s) => { const a = s.poi.armory; return g.world.getBlock(a.bx, a.by, a.bz) === BLOCK.ARMS; });
      const camp = st.plan.camps[0], a = camp.poi.armory;
      for (const c of g.characters()) if (c.npc && c.site === camp.key) c.removed = true;   // nobody home
      const msgs = [];
      g.events.on('storyMessage', (e) => msgs.push(e.text));
      let restocked = 0;
      g.events.on('resupplied', () => restocked++);
      // nothing to restock with no bow or smoke yet
      p.teleport(a.x + 1.5, a.y, a.z); p.yaw = Math.PI / 2;
      __step(3);
      out.prompt = (st.interactTarget(p) || {}).kind;
      __step(1, { interact: true }); __step(2);
      out.nothing = msgs.slice();
      // with the chapter I-II kit, a few arrows shot and a pistol: E tops everything up
      st.giveTo(p, [['w_bow', 1], ['arrow', 3], ['w_smoke', 1], ['smoke_bomb', 1]]);
      p.inventory.set(6, makeWeapon('pistol', 0));
      __step(1, { interact: true }); __step(2);
      out.after = { arrows: p.inventory.count('arrow'), smoke: p.inventory.count('smoke_bomb'), rounds: p.inventory.count('ammo_light') };
      out.restocked = restocked;
      // straight away again: empty, and says when it will be restocked
      p.inventory.remove('arrow', 5);
      const before = p.inventory.count('arrow');
      out.waitText = st.interactTarget(p).text;
      __step(1, { interact: true }); __step(2);
      out.emptyArrows = p.inventory.count('arrow') - before;
      // after the restock time it's full again
      g.time += A.RESTOCK + 1;
      out.readyText = st.interactTarget(p).text;
      __step(1, { interact: true }); __step(2);
      out.refill = p.inventory.count('arrow');
      out.restocked2 = restocked;
      // the Order's own supply chest at the hideout, refilled much sooner
      const home = st.plan.hideout.poi.armory;
      p.teleport(home.x + 1.2, home.y, home.z + 0.2);
      __step(3);
      p.inventory.remove('arrow', 20);
      out.homeText = (st.interactTarget(p) || {}).text;
      __step(1, { interact: true }); __step(2);
      out.home = p.inventory.count('arrow');
      p.inventory.remove('arrow', 20);
      g.time += A.HOME_RESTOCK + 1;
      __step(1, { interact: true }); __step(2);
      out.homeAgain = p.inventory.count('arrow');
      // out of arrows: told where to go
      p.inventory.remove('arrow', 99); msgs.length = 0;
      p.selectSlot(p.inventory.slots.findIndex((x) => x && x.id === 'w_bow'));
      p.heldStack().data.mag = 0;
      __step(1, { fire: true, firePressed: true }); __step(2);
      out.outMsg = msgs.join(' ');
      return out;
    });
    ctx.assert(r.where.filter((k) => k === 'camp').length === 6 && r.where.includes('keep') && r.where.includes('hideout') && r.blocks, 'a crate in every camp, the keep and the hideout: ' + JSON.stringify(r.where));
    ctx.assert(r.prompt === 'resupply' && /Nothing in here/.test(r.nothing.join(' ')), 'crate prompt, nothing to take without the gear: ' + JSON.stringify(r));
    const A = await page.evaluate(() => CONFIG.STORY.ARMORY);
    ctx.assert(r.after.arrows === A.ARROWS && r.after.smoke === A.SMOKE && r.after.rounds === A.ROUNDS && r.restocked === 1, 'restocked: ' + JSON.stringify(r.after));
    ctx.assert(/empty, restocked in \d+s/.test(r.waitText) && r.emptyArrows === 0, 'empty until it is restocked: ' + JSON.stringify(r));
    ctx.assert(/restock/.test(r.readyText) && r.refill === A.ARROWS && r.restocked2 === 2, 'ready again later: ' + JSON.stringify(r));
    ctx.assert(/Supply chest/.test(r.homeText) && r.home === A.ARROWS && r.homeAgain === A.ARROWS, 'the hideout supply chest: ' + JSON.stringify(r));
    ctx.assert(/Out of arrows.*hideout/.test(r.outMsg), 'out of arrows says where to restock: ' + r.outMsg);
  },

  'story bow: hold to draw, release to loose; a full draw flies farther and hits harder; arrows can be picked up again': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, out = {};
      const w = st.mentor, en = st.plan.hideout.poi.entrance;
      let shots = 0, pickups = 0;
      g.events.on('shot', (e) => { if (e.cls === 'bow') shots++; });
      g.events.on('pickup', (e) => { if (e.item === 'arrow') pickups++; });
      __beside(w, en, 3);
      st.giveTo(p, [['w_bow', 1], ['arrow', 6]]);
      p.selectSlot(p.inventory.slots.findIndex((x) => x && x.id === 'w_bow'));
      p.yaw = Math.atan2(-(en.x - w.pos.x), -(en.z - w.pos.z)); p.pitch = 0.05;
      __step(30);                                                                // nock the first arrow
      const arrows = () => g.entities.size && [...g.entities.values()].filter((e) => e.type === 'projectile' && e.st.cls === 'bow');
      // a quick tug: the bow is lowered, nothing is loosed
      __step(6, { fire: true }); __step(2);
      out.tug = { flying: arrows().length, left: p.inventory.count('arrow') + p.heldStack().data.mag };
      // a full draw
      __step(50, { fire: true });
      out.drawn = +p.draw.toFixed(2);
      __step(1);
      const full = arrows()[0];
      out.full = full ? { speed: +full.vel.length().toFixed(1), dmg: Math.round(full.st.damage), max: Math.round(Weapons.of(p.heldStack()).damage) } : null;
      __step(40);
      // a half draw
      __step(Math.round(60 * (CONFIG.WEAPONS.bow.bow.draw * 0.5)), { fire: true });
      __step(1);
      const half = arrows().find((a) => a !== full);
      out.half = half ? { speed: +half.vel.length().toFixed(1), dmg: Math.round(half.st.damage) } : null;
      out.left = p.inventory.count('arrow') + p.heldStack().data.mag;
      // where they land, arrows wait to be picked up: one into the ground a few steps ahead, walked over
      __step(40);
      p.pitch = -0.5;
      __step(50, { fire: true }); __step(30);
      const drop = [...g.entities.values()].find((e) => e.type === 'drop' && e.stack.id === 'arrow' && e.pos.distanceTo(p.pos) < 8);
      out.landed = !!drop || pickups > 0;
      __step(90, { moveZ: 1 });
      out.shots = shots; out.pickups = pickups;
      out.pickedUp = p.inventory.count('arrow') + p.heldStack().data.mag;
      // an arrow that kills drops by the body
      const guard = st.guardsOf(st.places.V1.key)[0];
      guard.health = 1;
      const o = guard.pos.clone().add(new THREE.Vector3(0, 1.4, 4));
      g.addEntity(new Projectile(p, Weapons.drawn(Weapons.stats('bow', 0), 1), o, new THREE.Vector3(0, -0.02, -1).normalize()));
      __step(30);
      out.killed = !guard.alive;
      out.byBody = [...g.entities.values()].some((e) => e.type === 'drop' && e.stack.id === 'arrow' && Math.hypot(e.pos.x - guard.pos.x, e.pos.z - guard.pos.z) < 1.5);
      return out;
    });
    ctx.assert(r.tug.flying === 0 && r.tug.left === 7, 'a quick tug looses nothing: ' + JSON.stringify(r.tug));
    ctx.assert(r.drawn === 1 && r.full && r.full.speed > 60 && r.full.dmg === r.full.max && r.full.max >= 100, 'a full draw: fast and deadly: ' + JSON.stringify(r));
    ctx.assert(r.half && r.half.speed < r.full.speed * 0.85 && r.half.dmg < 70, 'a half draw: slower, weaker: ' + JSON.stringify(r.half));
    ctx.assert(r.left === 5 && r.shots === 3 && r.landed && r.pickups >= 1 && r.pickedUp === 5, 'arrows used, then picked up again: ' + JSON.stringify(r));
    ctx.assert(r.killed && r.byBody, 'an arrow that kills drops by the body: ' + JSON.stringify(r));
  },

  'story sword: a 3-cut combo, guards block now and then, a block takes the sting out, a parry staggers them for a finishing blow': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, S = CONFIG.STORY.SWORD, out = {};
      out.kit = p.inventory.count('longsword');
      const V = st.places.V1;
      for (const c of g.characters()) if (c.npc && c.site === V.key) c.removed = true;
      __step(1);
      const spot = V.poi.spots[0] || { x: V.x, y: V.h + 1, z: V.z };
      p.teleport(spot.x, spot.y, spot.z); p.yaw = 0;
      p.selectSlot(p.inventory.slots.findIndex((x) => x && x.id === 'longsword'));
      // a guard in a fight, facing us, his controller held still
      const still = { getIntent: () => makeIntent(), callTo() {}, startSearch() {}, hear() {}, investigate() {} };
      const fight = () => Object.assign({ state: 'combat', target: p, awareOf: () => 1 }, still);
      const mk = (hp) => {
        const c = Npc.guard(g, V.key, { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z - 1.8, yaw: 0 } });
        c.yaw = Math.atan2(-(p.pos.x - c.pos.x), -(p.pos.z - c.pos.z)); c.controller = fight(); c.health = hp; return c;
      };
      const events = [];
      for (const n of ['blocked', 'parry', 'swordKill']) g.events.on(n, () => events.push(n));
      const guardBlock = S.GUARD_BLOCK;
      S.GUARD_BLOCK = 0;
      // three cuts in a row: 0, 1, 2 - the third hits harder
      const a = mk(500), hp = [], combos = [];
      for (let i = 0; i < 3; i++) { __step(1, { fire: true, firePressed: true }); combos.push(p.combo); hp.push(Math.round(a.health)); __step(30); }
      out.combo = combos; out.hp = hp;
      // after a pause the combo starts over
      __step(70); __step(1, { fire: true, firePressed: true }); out.restart = p.combo;
      a.removed = true; __step(1);
      // guards sometimes turn a cut aside
      S.GUARD_BLOCK = 1;
      const b = mk(100); __step(40); __step(1, { fire: true, firePressed: true });
      out.guardBlocked = { hp: Math.round(b.health), ev: events.includes('blocked') };
      S.GUARD_BLOCK = 0;
      b.removed = true; __step(1);
      // our block: a sabre cut that lands on a raised sword does a fifth of the damage
      const c = mk(100);
      p.health = 100;
      __step(40, { aim: true });
      events.length = 0;
      Blade.cut(g, c, CONFIG.STORY.BLADES.sword);
      out.blocked = { hp: +(100 - p.health).toFixed(1), ev: events.slice() };
      // a parry: block raised just as the cut lands - he staggers and one cut finishes him
      p.health = 100;
      __step(5);                                        // lower the sword...
      __step(3, { aim: true });                         // ...and raise it at the last moment
      events.length = 0;
      Blade.cut(g, c, CONFIG.STORY.BLADES.sword);
      out.parry = { hp: Math.round(100 - p.health), ev: events.slice(), staggered: (c.stunnedUntil || 0) > g.time, open: Stealth.canAssassinate(g, p, c) };
      __step(25);
      __step(1, { fire: true, firePressed: true });
      out.finished = { dead: !c.alive, ev: events.includes('swordKill') };
      // and someone who never saw it coming falls to a single cut
      const d = Npc.guard(g, V.key, { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z - 1.8, yaw: Math.PI } });
      d.yaw = p.yaw;                                    // facing away from us, none the wiser
      d.controller = Object.assign({ state: 'idle', awareOf: () => 0 }, still);
      __step(40); __step(1, { fire: true, firePressed: true });
      out.unaware = !d.alive;
      S.GUARD_BLOCK = guardBlock;
      // older saves: the throwing knives become a bow and arrows, and everyone gets a sword
      out.migrate = [Story.migrateStack({ id: 'w_knives', count: 1, data: { rarity: 0, mag: 1 } }).id, Story.migrateStack({ id: 'knife', count: 7 }).id + ':7', Story.migrateStack({ id: 'gone_item', count: 1 })];
      return out;
    });
    const D = 36;
    ctx.assert(r.kit === 1, 'every member of the Order carries a sword');
    ctx.assert(JSON.stringify(r.combo) === '[0,1,2]' && r.restart === 0, 'combo 0, 1, 2 then starts over: ' + JSON.stringify(r));
    ctx.assert(r.hp[0] === 500 - D && r.hp[1] === 500 - 2 * D && r.hp[2] === Math.round(500 - 2 * D - D * 1.6), 'the third cut hits harder: ' + JSON.stringify(r.hp));
    ctx.assert(r.guardBlocked.hp === 100 && r.guardBlocked.ev, 'a guard turns the cut aside: ' + JSON.stringify(r.guardBlocked));
    ctx.assert(Math.abs(r.blocked.hp - 13 * 0.2) < 0.2 && r.blocked.ev.includes('blocked'), 'a block takes most of the damage: ' + JSON.stringify(r.blocked));
    ctx.assert(r.parry.hp === 0 && r.parry.ev.includes('parry') && r.parry.staggered && r.parry.open, 'a parry: no damage, he staggers: ' + JSON.stringify(r.parry));
    ctx.assert(r.finished.dead && r.finished.ev && r.unaware, 'finishing blows: ' + JSON.stringify(r));
    ctx.assert(r.migrate[0] === 'w_bow' && r.migrate[1] === 'arrow:7' && r.migrate[2] === null, 'saves migrate: ' + JSON.stringify(r.migrate));
  },

  'story looks: people are built like people, hands in first person, the camera behind the shoulder (P)': async (ctx) => {
    const { page } = await story(ctx);
    await page.evaluate(() => {
      const g = __game, p = g.player;
      g.paused = false;
      const guard = g.characters().find((c) => c.npcRole === 'guard' && c.alive);
      p.teleport(guard.pos.x + 4, guard.pos.y + 3, guard.pos.z); p.flying = true;
    });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const g = __game, p = g.player, out = {};
      g.paused = true;
      const guard = g.characters().find((c) => c.npcRole === 'guard' && c.alive && c.model);
      const parts = []; guard.model.root.traverse((o) => { if (o.isMesh) parts.push(o.geometry.attributes.position.count); });
      out.guardParts = parts.length; out.guardVerts = parts.reduce((a, b) => a + b, 0);
      out.knees = !!(guard.model.legL && guard.model.legL.shin && guard.model.armR.elbow);
      out.lit = guard.model.mat.type;
      out.lights = g.scene.children.filter((o) => o.isLight).map((o) => o.type).sort();
      return out;
    });
    ctx.assert(m.guardParts >= 14 && m.guardVerts > 1500 && m.knees, 'a jointed, rounded body (not a few boxes): ' + JSON.stringify(m));
    ctx.assert(m.lit === 'MeshPhongMaterial' && m.lights.includes('HemisphereLight') && m.lights.includes('DirectionalLight'), 'lit by sun and sky: ' + JSON.stringify(m));
    // third person by default in story mode: our own body is drawn, the camera sits behind it and aims where we aim
    const cam = () => page.evaluate(() => {
      const g = __game, p = g.player, v = __views[0], c = v.camera;
      const eye = p.eyePos(new THREE.Vector3()), look = p.lookDir(new THREE.Vector3());
      const hb = raycastBlocks(g.world, eye, look, CONFIG.THIRD_PERSON.AIM_RANGE, { filter: (id) => BlockTables.solid[id] === 1 });
      const aim = eye.clone().addScaledVector(look, Math.max(CONFIG.THIRD_PERSON.MIN_AIM, hb ? hb.dist : CONFIG.THIRD_PERSON.AIM_RANGE));
      const fwd = c.getWorldDirection(new THREE.Vector3());
      return { dist: +c.position.distanceTo(eye).toFixed(2), onAim: fwd.dot(aim.clone().sub(c.position).normalize()), seesSelf: c.layers.test(p.model.root.layers), viewmodel: v.tp };
    });
    // open ground so nothing pulls the camera in
    await page.evaluate(() => { const g = __game, p = g.player; p.teleport(p.pos.x, p.pos.y + 6, p.pos.z); p.flying = true; p.pitch = -0.2; });
    await page.waitForTimeout(400);
    const tp = await cam();
    await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })); });
    await page.waitForTimeout(300);
    const fp = await cam();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('blockfire.settings.v2') || '{}').thirdPersonStory);
    ctx.assert(tp.dist > 2 && tp.onAim > 0.9995 && tp.seesSelf && tp.viewmodel, 'third person: behind the shoulder, crosshair on the aim point, own body drawn: ' + JSON.stringify(tp));
    ctx.assert(fp.dist < 0.01 && !fp.seesSelf && !fp.viewmodel && saved === false, 'P: back to the eyes (and remembered): ' + JSON.stringify(fp));
  },

  'story stealth in public: climbing in front of a village guard makes him suspicious, not hostile; violence does': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, out = {};
      const V = st.places.V1, T = V.poi.tower;
      const guard = st.guardsOf(V.key).find((c) => Math.hypot(c.pos.x - T.base.x, c.pos.z - T.base.z) < 1.5);
      const barks = [];
      g.events.on('bark', (e) => { if (e.character === guard) barks.push(e.text); });
      // climb the tower right in front of its guard
      p.teleport(T.base.x, T.base.y + 0.01, T.base.z);
      p.yaw = Math.atan2(-(T.x0 + 2.5 - T.base.x), -(T.z0 + 2.5 - T.base.z));
      guard.yaw = p.yaw + Math.PI;                                  // he's watching
      __step(10);
      for (let i = 0; i < 60 * 5; i++) __step(1, { moveZ: 1, jump: true });
      out.climbState = guard.controller.state;
      out.aware = +guard.controller.awareOf(p).toFixed(2);
      out.barks = barks.slice();
      // now hit a villager in front of him (on the open side, away from the tower)
      const ax = guard.pos.x - (T.x0 + 2.5), az = guard.pos.z - (T.z0 + 2.5), L = Math.hypot(ax, az) || 1;
      p.climbing = false;
      p.teleport(guard.pos.x + ax / L * 2, guard.pos.y, guard.pos.z + az / L * 2);
      const vil = g.characters().find((c) => c.npcRole === 'villager' && c.site === V.key && c.alive);
      vil.teleport(guard.pos.x + ax / L * 3.2, guard.pos.y, guard.pos.z + az / L * 3.2);
      p.yaw = Math.atan2(-(vil.pos.x - p.pos.x), -(vil.pos.z - p.pos.z)); vil.yaw = p.yaw;
      guard.yaw = Math.atan2(-(p.pos.x - guard.pos.x), -(p.pos.z - guard.pos.z));
      __step(2); __step(1, { fire: true, firePressed: true }); __step(20);
      out.afterViolence = guard.controller.state;
      out.hit = vil.health < 60 || !vil.alive;
      return out;
    });
    ctx.assert(r.climbState !== 'combat' && r.aware > 0.3, 'climbing in public: suspicious, not attacked: ' + JSON.stringify(r));
    ctx.assert(r.barks.some((b) => /down|roof|up there/.test(b)), 'he shouts at you to get down: ' + JSON.stringify(r.barks));
    ctx.assert(r.hit && r.afterViolence === 'combat', 'violence in front of him starts a fight: ' + JSON.stringify(r));
  },

  'story chapter I: talk to Wren, climb, synchronize, leap, takedown, return - rewards, HUD and save': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, out = { objs: [] }, w = st.mentor, en = st.plan.hideout.poi.entrance;
      __beside(w, en);
      __step(3);
      out.prompt = st.promptFor(p) && st.promptFor(p).text;
      __step(1, { interact: true }); __step(2);
      out.objs.push(__obj());
      const T = st.places.V1.poi.tower;
      p.teleport(T.top.x, T.top.y + 0.01, T.top.z);
      __step(20); out.objs.push(__obj());
      __step(1, { interact: true }); __step(110); out.objs.push(__obj());
      p.teleport(T.perch.x, T.perch.y + 0.01, T.perch.z);
      p.yaw = Math.atan2(-(T.hay.x - T.top.x), -(T.hay.z - T.top.z));
      __step(10); __step(20, { moveZ: 1 }); __step(180); out.objs.push(__obj());
      const bully = st.activity.M.bully;
      bully.controller.look = () => {};        // hold still (his idle sway would turn him away)
      // stand on a free, level cell with a clear line to him, facing him (walls and stalls block the blade)
      let ok = false;
      for (const d of [1.5, 2, 1.2, 2.5]) for (let k = 0; k < 16 && !ok; k++) {
        const a = k / 16 * Math.PI * 2, x = Math.floor(bully.pos.x + Math.cos(a) * d), z = Math.floor(bully.pos.z + Math.sin(a) * d);
        const w = g.world;
        if (!(w.isSolid(x, Math.floor(bully.pos.y) - 1, z) && !w.isSolid(x, Math.floor(bully.pos.y), z) && !w.isSolid(x, Math.floor(bully.pos.y) + 1, z))) continue;
        p.teleport(x + 0.5, bully.pos.y, z + 0.5);
        p.yaw = Math.atan2(-(bully.pos.x - p.pos.x), -(bully.pos.z - p.pos.z)); p.selectSlot(0);
        ok = Blade.reach(g, p, bully) && Blade.inFront(g, p, 3.0) === bully;
      }
      if (!ok) throw new Error('no clear spot to strike the bully from');
      __step(3); __step(1, { fire: true, firePressed: true }); __step(20);
      out.objs.push(__obj());
      __beside(w, en); __step(3); __step(1, { interact: true }); __step(10);
      out.objs.push(__obj());
      out.chapter = st.chapter; out.silver = st.silver; out.arrows = p.inventory.count('arrow'); out.bow = p.inventory.count('w_bow'); out.sword = p.inventory.count('longsword'); out.synced = st.synced.size;
      out.save = JSON.parse(localStorage.getItem('blockfire.story.v1') || 'null');
      return out;
    });
    ctx.assert(/Talk to Old Wren/.test(r.prompt), 'prompt to talk: ' + r.prompt);
    ctx.assert(/Climb the watchtower/.test(r.objs[0]) && /Synchronize/.test(r.objs[1]) && /leap of faith/.test(r.objs[2]) &&
      /Take down/.test(r.objs[3]) && /Return to Old Wren/.test(r.objs[4]), 'objectives in order: ' + JSON.stringify(r.objs));
    // 50 for the chapter, and 20 more for First Blood (the first takedown is a challenge too)
    ctx.assert(r.chapter === 1 && r.silver >= 70 && r.arrows === 12 && r.bow === 1 && r.sword === 1 && r.synced === 1, 'chapter done, rewarded: ' + JSON.stringify(r));
    ctx.assert(r.save && r.save.chapter === 1 && r.save.synced.length === 1, 'progress saved: ' + JSON.stringify(r.save));
    await page.evaluate(() => { __game.paused = false; });
    await page.waitForTimeout(600);
    const hud = await page.evaluate(() => document.querySelector('.hud[data-player="0"] .storyObj').innerText);
    ctx.assert(/Chapter II/i.test(hud), 'HUD shows the next chapter: ' + hud);
    await ctx.screenshot(page, 'story-hud');
  },

  'story chapters II-III: tailing (spotted -> desynchronized -> retry), lock picking and escorting': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, out = {};
      st.chapter = 1;
      st.startChapter();
      const V2 = st.places.V2;
      out.go = __obj();
      p.teleport(V2.x + 19, V2.h + 1.01, V2.z);
      __step(12); out.find = __obj();
      const fitch = st.activity.M.fitch;
      const at = st.places.V2.poi.spots[0], hay = V2.poi.tower.hay;
      p.teleport(hay.x, hay.y + 0.01, hay.z);                    // hidden in the hay, within sight of the square
      __step(12); out.tail = __obj();
      // walk right up to Fitch's face: spotted
      p.teleport(fitch.pos.x - Math.sin(fitch.yaw) * 2, fitch.pos.y, fitch.pos.z - Math.cos(fitch.yaw) * 2);
      __step(45);
      out.failing = st.activity.failing && st.activity.failing.reason;
      __step(60 * 3);
      const again = st.activity.M.fitch;
      out.retried = { fresh: again !== fitch && again.alive, home: +Math.hypot(again.pos.x - at.x, again.pos.z - at.z).toFixed(1) };
      // chapter III: the cage
      st.activity = null; st.chapter = 2; st.startChapter();
      const C2 = st.places.C2;
      for (const c of st.guardsOf(C2.key)) { c.removed = true; }                  // an empty camp for this test
      p.teleport(C2.poi.cage.front.x, C2.poi.cage.front.y + 0.01, C2.poi.cage.front.z);
      __step(15); out.cageObj = __obj();
      out.cagePrompt = st.promptFor(p) && st.promptFor(p).text;
      __step(1, { interact: true }); __step(150);
      out.open = st.cageOpen(C2);
      __step(15); out.escortObj = __obj();
      const ida = st.activity.M.ida;
      out.follows = ida.controller.mode === 'follow';
      // carry on to the village: Ida follows
      const V3 = st.places.V3;
      p.teleport(V3.x + 3, V3.h + 1.01, V3.z + 3); ida.teleport(V3.x + 4, V3.h + 1.01, V3.z + 4);
      __step(20); out.talkObj = __obj();
      return out;
    });
    ctx.assert(/Go to/.test(r.go) && /Find Fitch|Tail Fitch/.test(r.find) && /Tail Fitch/.test(r.tail), 'tail mission steps: ' + JSON.stringify(r));
    ctx.assert(/spotted/.test(r.failing || ''), 'being seen by Fitch desynchronizes: ' + r.failing);
    ctx.assert(r.retried.fresh && r.retried.home < 3, 'retry: Fitch back in the square: ' + JSON.stringify(r.retried));
    ctx.assert(/Free Ida/.test(r.cageObj) && /Pick the lock/.test(r.cagePrompt || '') && r.open, 'lock picked: ' + JSON.stringify(r));
    ctx.assert(/Escort Ida/.test(r.escortObj) && r.follows, 'Ida follows: ' + r.escortObj);
    ctx.assert(/Talk to Ida/.test(r.talkObj), 'escort done: ' + r.talkObj);
  },

  'story people find their way: Fitch walks his whole route, guards reach you, villagers keep moving; trees hide you': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, st = g.story, p = g.player, out = {};
      const tick = (n) => { for (let i = 0; i < n; i++) { p.controller = new ScriptedController({}); g.tick(1 / 60); } };
      // Fitch's road from the square to the camp's strongbox (~250 blocks on the bigger island, houses and a palisade in the way)
      const V2 = st.places.V2, route = st.routeBetween(V2, st.places.C1);
      const f = Npc.ally(g, { name: 'Fitch', look: 'clerk', role: 'villager', team: 3, pos: Object.assign({}, V2.poi.spots[0]), health: 60 });
      f.controller = new AllyController(99, { mode: 'route', points: route, pace: 0.55, glances: true });
      p.flying = true; p.health = 1e9;                    // an invulnerable observer floating above him
      let s = 0;
      for (; s < 450 && !f.controller.done; s++) { tick(60); p.pos.set(f.pos.x, Math.min(60, f.pos.y + 20), f.pos.z); }
      out.fitch = { done: f.controller.done, secs: s, stuck: (f.controller.nav && f.controller.nav.stucks) || 0 };
      f.removed = true;
      // a stone stage in the sky: a watcher at one end, you 8 blocks in front of him, a wall of leaves between
      p.flying = false;
      const V0 = st.places.V1, fx = Math.floor(V0.x), fz = Math.floor(V0.z) + 30, Y = 52, stage = [];
      for (let dx = -3; dx <= 3; dx++) for (let dz = -10; dz <= 1; dz++) { stage.push([fx + dx, Y, fz + dz, BLOCK.STONE]); for (let y = Y + 1; y <= Y + 4; y++) stage.push([fx + dx, y, fz + dz, BLOCK.AIR]); }
      g.world.setBlocks(stage);
      const wt = Npc.ally(g, { name: 'Watcher', look: 'clerk', role: 'villager', team: 3, pos: { x: fx + 0.5, y: Y + 1, z: fz + 0.5 }, health: 60 });
      wt.controller = new AllyController(5, { mode: 'stand', post: { x: fx + 0.5, y: Y + 1, z: fz + 0.5, yaw: 0 } });
      wt.yaw = 0;
      p.teleport(fx + 0.5, Y + 1.01, fz - 7.5);
      const leaves = [];
      for (let dx = -3; dx <= 3; dx++) for (let y = Y + 1; y <= Y + 4; y++) leaves.push([fx + dx, y, fz - 4, BLOCK.LEAVES]);
      g.world.setBlocks(leaves);
      tick(3);
      out.behindLeaves = st.suspicionRate(wt, 16);
      g.world.setBlocks(leaves.map(([x, y, z]) => [x, y, z, BLOCK.AIR]));
      tick(2);
      out.inTheOpen = st.suspicionRate(wt, 16);
      wt.removed = true;
      // villagers keep walking about for a minute
      const V1 = st.places.V1;
      p.teleport(V1.x + 0.5, V1.h + 20, V1.z + 0.5); p.flying = true;
      tick(30);
      const vs = g.characters().filter((c) => c.npcRole === 'villager' && c.site === V1.key && !c.controller.vendor);
      const last = vs.map((c) => c.pos.clone()), moved = vs.map(() => 0);
      for (let k = 0; k < 60; k++) { tick(60); vs.forEach((c, i) => { moved[i] += c.pos.distanceTo(last[i]); last[i].copy(c.pos); }); }
      out.villagers = moved.map((m) => Math.round(m));
      // camp guards reach an intruder standing on open ground
      const C = st.places.C1, gs = st.guardsOf(C.key).filter((c) => !c.controller.marksman);
      p.flying = false; p.teleport(C.x + 0.5, C.h + 1.01, C.z + 4.5); p.health = 1e9;
      tick(5);
      for (const c of gs) { c.controller.lastSeenAt.clear(); c.controller.engage(g, c, p, false); }
      tick(60 * 10);
      out.guards = gs.map((c) => +c.pos.distanceTo(p.pos).toFixed(1));
      return out;
    });
    ctx.assert(r.fitch.done && r.fitch.secs < 450, 'Fitch reached the strongbox (a longer walk on the bigger island): ' + JSON.stringify(r.fitch));
    ctx.assert(r.behindLeaves === 0 && r.inTheOpen > 0, 'leaves hide you from Fitch: ' + r.behindLeaves + ' / ' + r.inTheOpen);
    ctx.assert(r.villagers.every((m) => m >= 10), 'villagers keep moving: ' + r.villagers);
    ctx.assert(r.guards.filter((d) => d < 6).length >= 3, 'guards closed in: ' + r.guards);
  },

  'story chapter II: a careful player tails Fitch all the way to the camp without being spotted': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, st = g.story, p = g.player, out = {};
      st.chapter = 1; st.startChapter();
      const V2 = st.places.V2, hay = V2.poi.tower.hay;
      p.teleport(hay.x, hay.y + 0.01, hay.z);                  // watch from the hay in the square
      __step(30);
      const fitch = st.activity.M.fitch, trail = [];
      let maxSus = 0, s = 0;
      for (; s < 300 && st.activity && st.activity.stepI === 2 && !st.activity.failing; s++) {
        for (let k = 0; k < 6; k++) { __step(10); trail.push(fitch.pos.clone()); }
        // follow in his footsteps, ~22 blocks behind
        let back = null, acc = 0;
        for (let i = trail.length - 1; i > 0; i--) { acc += trail[i].distanceTo(trail[i - 1]); if (acc >= 22) { back = trail[i - 1]; break; } }
        if (back) p.teleport(back.x, back.y + 0.01, back.z);
        maxSus = Math.max(maxSus, (st.activity && st.activity.M.sus) || 0);
      }
      out.secs = s; out.maxSus = +maxSus.toFixed(2);
      out.failed = st.activity && st.activity.failing && st.activity.failing.reason;
      out.obj = st.objective().text;
      return out;
    });
    ctx.assert(!r.failed && /Steal the ledger/.test(r.obj), 'tailed Fitch to the camp: ' + JSON.stringify(r));
    ctx.assert(r.maxSus < 0.6, 'he never got close to spotting a careful follower: ' + r.maxSus);
  },

  'story contracts and shop: notice board offers, a timed delivery, buying from Ida, fast travel': async (ctx) => {
    const { page } = await story(ctx);
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, st = g.story, out = {};
      const v = st.places.V1, b = v.poi.board;
      p.teleport(b.x, b.y + 0.01, b.z);
      let screen = null;
      g.events.on('storyScreen', (e) => { screen = e; });
      __step(3);
      out.prompt = st.promptFor(p) && st.promptFor(p).text;
      __step(1, { interact: true }); __step(2);
      out.offers = screen && screen.offers.length;
      out.screenOpen = window.__screens.isOpen && window.__screens.kind === 'board';
      window.__screens.close(false);
      const offers = st.offersAt(v.key), ci = offers.findIndex((o) => o.kind === 'courier');
      const i = ci >= 0 ? ci : 0;
      st.act(p, { a: 'accept', site: v.key, i });
      out.kind = offers[i].kind;
      out.obj = __obj();
      out.timer = st.objective().timer;
      if (out.kind === 'courier') {
        out.letter = p.inventory.count('letter');
        const rcpt = st.activity.M.r;
        p.teleport(rcpt.pos.x + 1.2, rcpt.pos.y, rcpt.pos.z);
        __step(5); __step(1, { interact: true }); __step(10);
        out.done = st.contractsDone;
      }
      // the shop
      st.unlockShop(); st.addSilver(100);
      const s0 = st.silver;
      st.act(p, { a: 'buy', id: 'medkit' });
      out.bought = { medkits: p.inventory.count('medkit'), spent: s0 - st.silver };
      // fast travel to a synced viewpoint
      st.synced.add(0);
      const vp = st.plan.viewpoints[0];
      st.act(p, { a: 'travel', vp: 0 });
      out.travel = +Math.hypot(p.pos.x - vp.base.x, p.pos.z - vp.base.z).toFixed(1);
      return out;
    });
    ctx.assert(/notice board/.test(r.prompt || '') && r.offers === 3 && r.screenOpen, 'board shows 3 contracts: ' + JSON.stringify(r));
    ctx.assert(/Contract|Assassinate|Steal|Free|Deliver/.test(r.obj || ''), 'contract objective: ' + r.obj);
    if (r.kind === 'courier') ctx.assert(r.letter === 1 && r.timer > 0 && r.done === 1, 'courier delivered in time: ' + JSON.stringify(r));
    ctx.assert(r.bought.medkits === 1 && r.bought.spent === 45, 'bought a medkit: ' + JSON.stringify(r.bought));
    ctx.assert(r.travel < 1, 'fast travelled to the viewpoint: ' + r.travel);
  },

  'story online co-op: a friend joins the Order, shares the objective and silver, sees guards notice them, and takes them down': async (ctx) => {
    const { host, client } = await pair(ctx, 'autostart=1&net=bridge&host=1&mode=story&rd=4');
    const a = await host.evaluate(() => { const b = __game.characters().find((c) => c.netRemote); return { look: b.look, blade: b.inventory.count('wrist_blade'), obj: __game.story.objective().text }; });
    ctx.assert(a.look === 'order' && a.blade === 1, 'the friend is one of the Order: ' + JSON.stringify(a));
    await client.waitForFunction((t) => __game.story.objective() && __game.story.objective().text === t, a.obj, { timeout: 8000 });
    // the friend talks to Wren: the chapter starts for everyone
    await host.evaluate(() => {
      const g = __game, w = g.story.mentor, en = g.story.plan.hideout.poi.entrance, b = g.characters().find((c) => c.netRemote);
      const dx = en.x - w.pos.x, dz = en.z - w.pos.z, L = Math.hypot(dx, dz);
      b.teleport(w.pos.x + dx / L * 1.8, w.pos.y, w.pos.z + dz / L * 1.8);
    });
    await client.waitForFunction(() => __game.story.promptFor() && /Old Wren/.test(__game.story.promptFor().text), null, { timeout: 8000 });
    await client.evaluate(`(${DRIVE})({})`);
    // the friend's game starts ticking once its area is meshed: a software-rendered browser can take a while over that
    await client.waitForFunction(() => __game.tickCount > 0, null, { timeout: 120000, polling: 250 });
    await client.evaluate(() => { window.__once = { interact: true }; });
    await host.waitForFunction(() => __game.story.activity && __game.story.activity.kind === 'chapter', null, { timeout: 8000 });
    await client.waitForFunction(() => /Climb the watchtower/.test(__game.story.objective().text), null, { timeout: 8000 });
    await host.evaluate(() => __game.story.addSilver(30));
    await client.waitForFunction(() => __game.story.silver === 30, null, { timeout: 5000 });
    // the journal and the gear screen read stats, letters, challenges and nearForge: a client's mirror has them too
    await host.evaluate(() => { const S = __game.story; S.stats.kills = 3; S.letters.add(2); S.challengesDone.add('first'); S.flags.sealed = true; S.version++; });
    await client.waitForFunction(() => __game.story.stats.kills === 3 && __game.story.letters.has(2) && __game.story.challengesDone.has('first') && __game.story.flags.sealed, null, { timeout: 5000 });
    const jr = await client.evaluate(() => {
      const st = __game.story, html = window.__screens.journalHTML(st);
      return { tally: /kills 3/.test(html), letter: st.letters.has(2) && /letters \d+\/12/.test(html), challenge: new RegExp('challenges [1-9][0-9]*/' + STORY_CHALLENGES.length + ' ').test(html), forge: st.nearForge(__game.player) === false };
    });
    ctx.assert(jr.tally && jr.letter && jr.challenge && jr.forge, 'the journal on a client shows the host\'s numbers: ' + JSON.stringify(jr));
    // trespassing in a camp in front of a guard: the friend's HUD meter fills
    const gid = await host.evaluate(() => {
      const g = __game, st = g.story, camp = st.places.C1, b = g.characters().find((c) => c.netRemote);
      const cg = st.guardsOf(camp.key).find((c) => !c.controller.route && !c.controller.marksman && Math.hypot(c.pos.x - camp.x, c.pos.z - camp.z) < 9) || st.guardsOf(camp.key)[0];
      b.teleport(cg.pos.x - Math.sin(cg.yaw) * 6, cg.pos.y, cg.pos.z - Math.cos(cg.yaw) * 6);
      return cg.id;
    });
    await client.waitForFunction((id) => { const c = __game.entities.get(id); return c && (c.awMe > 0.3 || c.huntMe); }, gid, { timeout: 10000 })
      .catch(async () => { throw new Error('no awareness on the client: ' + JSON.stringify(await host.evaluate((id) => { const c = __game.entities.get(id); return { st: c.controller.state, aw: [...c.controller.aware.values()] }; }, gid))); });
    // a quiet village guard taken down from behind by the friend
    const vid = await host.evaluate(() => {
      const g = __game, st = g.story;
      for (const c of g.characters()) if (c.npcRole === 'guard') { c.controller.state = c.controller.homeState; c.controller.aware.clear(); c.controller.target = null; }
      st.notoriety = 0;
      const v = st.places.V3, vg = st.guardsOf(v.key).find((c) => !c.controller.route), b = g.characters().find((c) => c.netRemote);
      const open = v.poi.spots[Math.min(3, v.poi.spots.length - 1)];          // (on open ground: there may be a wall behind his post)
      vg.teleport(open.x, open.y + 0.01, open.z); vg.yaw = 0;
      b.teleport(vg.pos.x + Math.sin(vg.yaw) * 1.5, vg.pos.y, vg.pos.z + Math.cos(vg.yaw) * 1.5);
      return vg.id;
    });
    await client.waitForFunction((id) => { const c = __game.entities.get(id); return c && c.pos.distanceTo(__game.player.pos) < 2.5; }, vid, { timeout: 8000 });
    await client.evaluate((id) => { const g = __game, c = g.entities.get(id); g.player.yaw = c.yaw; g.player.selectSlot(0); window.__once = { fire: true, firePressed: true }; }, vid);
    await host.waitForFunction((id) => { const c = __game.entities.get(id); return c && !c.alive; }, vid, { timeout: 8000 })
      .catch(async () => { throw new Error('takedown not on host: ' + JSON.stringify(await host.evaluate((id) => { const g = __game, c = g.entities.get(id), b = g.characters().find((x) => x.netRemote); return { d: c.pos.distanceTo(b.pos), state: c.controller.state, held: b.heldStack(), yaw: [b.yaw, c.yaw] }; }, vid))); });
    await client.waitForFunction((id) => { const c = __game.entities.get(id); return c && !c.alive && c.corpse; }, vid, { timeout: 5000 });
    // the friend heals by themselves too (the host decides health)
    await host.evaluate(() => {
      const g = __game, b = g.characters().find((c) => c.netRemote);
      for (const c of g.characters()) if (c.npcRole === 'guard') { c.controller.state = c.controller.homeState; c.controller.aware.clear(); c.controller.target = null; }
      const w = g.story.mentor; b.teleport(w.pos.x, w.pos.y, w.pos.z);
      Combat.applyDamage(g, b, 50, { kind: 'fall' });
    });
    await client.waitForFunction(() => __game.player.health <= 50, null, { timeout: 5000 });
    await client.waitForFunction(() => __game.player.health >= 99, null, { timeout: 20000 });
    await ctx.screenshot(client, 'story-coop-client');
  },
};
