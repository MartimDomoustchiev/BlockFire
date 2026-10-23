/* Stage 6: island, storm, bots, match flow. */

async function battle(ctx, query) {
  const { page } = await ctx.open(query || 'autostart=1&seed=isle1&rd=4&mode=battle&bots=3&difficulty=normal', { minMeshed: 0, timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__game.match && window.__game.match.state !== 'starting', null, { timeout: 120000 });
  await page.evaluate(() => {
    const g = window.__game; g.paused = true;
    window.T = { g, p: g.player, m: g.match };
    T.p.controller = new ScriptedController(() => ({}));
    T.tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 60); };
    T.sim = (s) => T.tick(Math.round(s * 60));
  });
  return page;
}

exports.tests = {
  'island: land inside the radius, ocean outside, every island chunk preloaded and pinned': async (ctx) => {
    const page = await battle(ctx);
    const r = await page.evaluate(() => {
      const w = T.g.world, R = CONFIG.ISLAND.RADIUS;
      const top = (x, z) => { for (let y = 63; y >= 0; y--) { const b = w.getBlock(x, y, z); if (b > 0) return [y, b]; } return [-1, 0]; };
      let land = 0, n = 0, oceanOk = true;
      for (let a = 0; a < 64; a++) {
        const ang = a / 64 * Math.PI * 2;
        const [yi, bi] = top(Math.round(Math.cos(ang) * R * 0.3), Math.round(Math.sin(ang) * R * 0.3)); n++; if (bi !== BLOCK.WATER && yi > CONFIG.SEA_LEVEL) land++;
        const [yo, bo] = top(Math.round(Math.cos(ang) * (R + 8)), Math.round(Math.sin(ang) * (R + 8)));
        if (bo !== BLOCK.WATER) oceanOk = false;
      }
      return { landShare: land / n, oceanOk, progress: w.preloadProgress(), pinned: w.pinned.size };
    });
    ctx.assert(r.landShare > 0.8, 'mostly land in the middle: ' + r.landShare);
    ctx.assert(r.oceanOk, 'ocean beyond the radius');
    ctx.assert(r.progress === 1 && r.pinned > 250, 'island preloaded: ' + JSON.stringify(r));
  },

  'match start: everyone glides in spread out with the start kit; vehicles and barrels placed': async (ctx) => {
    const page = await battle(ctx, 'autostart=1&seed=isle2&rd=4&mode=battle&bots=5');
    const r = await page.evaluate(() => {
      const ps = T.m.participants;
      let minD = Infinity;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) minD = Math.min(minD, Math.hypot(ps[i].pos.x - ps[j].pos.x, ps[i].pos.z - ps[j].pos.z));
      const out = {
        n: ps.length, gliding: ps.filter((c) => c.gliding).length, high: ps.every((c) => c.pos.y >= CONFIG.ISLAND.DROP_HEIGHT - 1),
        kit: ps.every((c) => c.inventory.count('wood_pickaxe') === 1), minD,
        vehicles: [...T.g.entities.values()].filter((e) => e.type === 'vehicle').length,
        barrels: [...T.g.entities.values()].filter((e) => e.type === 'barrel').length,
      };
      T.sim(20);
      out.landed = ps.filter((c) => !c.gliding).length;
      return out;
    });
    ctx.assert(r.n === 6 && r.gliding === 6 && r.high && r.kit, 'six gliding players with kits: ' + JSON.stringify(r));
    ctx.assert(r.minD >= 10, 'spread out: ' + r.minD.toFixed(1));
    ctx.assert(r.vehicles >= 3 && r.barrels >= 3, 'vehicles + barrels: ' + r.vehicles + '/' + r.barrels);
    ctx.assert(r.landed === 6, 'everyone landed within 20 s');
  },

  'storm: phases shrink inside each other, damage once per second straight to health': async (ctx) => {
    const page = await battle(ctx, 'autostart=1&seed=isle3&rd=4&mode=battle&bots=0');
    const r = await page.evaluate(() => {
      // (a match always has at least one bot: this one stands still and is kept alive like the observer, so neither the
      // storm nor a fight ends the match before the storm has closed)
      const bots = T.m.participants.filter((c) => c.isBot);
      for (const b of bots) b.controller = new ScriptedController(() => ({}));
      const s = T.m.storm, out = { circles: [] };
      const P = CONFIG.STORM.PHASES;
      let total = 0;
      for (const ph of P) total += ph.wait + ph.shrink;
      let prev = { x: s.cur.x, z: s.cur.z, r: s.cur.r }, nested = true;
      for (let t = 0; t < total + 5; t++) {
        T.p.health = 100; T.p.alive = true;            // keep the observer alive
        for (const b of bots) { b.health = 100; b.alive = true; }
        T.tick(60);
        if (s.cur.r < prev.r - 1e-6) {
          if (Math.hypot(s.cur.x - prev.x, s.cur.z - prev.z) + s.cur.r > prev.r + 1e-6) nested = false;
          prev = { x: s.cur.x, z: s.cur.z, r: s.cur.r };
        }
      }
      out.final = [s.state, s.cur.r];
      out.nested = nested;
      // damage outside: place the player far from the final circle
      T.p.revive(); T.p.shield = 100; T.p.gliding = false; T.p.teleport(s.cur.x + 60, 50, s.cur.z); T.p.flying = true;
      T.p.stormAcc = 0;                                  // start the once-a-second clock fresh (it carries over from the loop above)
      const h0 = T.p.health;
      T.tick(60 * 3 + 2);
      out.dmg = [h0 - T.p.health, T.p.shield];
      return out;
    });
    ctx.assert(r.final[0] === 'final' && r.final[1] === 0, 'storm closes completely: ' + r.final);
    ctx.assert(r.nested, 'every new circle lies inside the previous one');
    ctx.near(r.dmg[0], 3 * CONFIG_DPS_LAST, 1e-6, '3 ticks of last-phase damage');
    ctx.assert(r.dmg[1] === 100, 'shield untouched by the storm');
  },

  'bots: find, aim at and damage a visible enemy; reaction delay before the first shot': async (ctx) => {
    const page = await battle(ctx, 'autostart=1&seed=isle4&rd=4&mode=battle&bots=1&difficulty=hard');
    const r = await page.evaluate(() => {
      const bot = T.m.participants.find((c) => c.isBot);
      // flat test pad in the sky
      const list = [];
      for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) { list.push([x, 55, z, BLOCK.STONE]); for (let y = 56; y <= 60; y++) list.push([x, y, z, BLOCK.AIR]); }
      T.g.world.setBlocks(list);
      for (const c of T.m.participants) { c.gliding = false; c.flying = false; }
      bot.teleport(0.5, 56, 10.5); T.p.teleport(0.5, 56, -10.5);
      bot.inventory.clear(); bot.inventory.set(0, makeWeapon('ar', 2)); bot.inventory.add(makeStack('ammo_medium', 200)); bot.selectSlot(0);
      T.p.revive(); T.p.gliding = false; T.p.teleport(0.5, 56, -10.5);
      let firstShotAt = -1, shots = 0;
      T.g.events.on('shot', (e) => { if (e.character === bot) { shots++; if (firstShotAt < 0) firstShotAt = T.g.time; } });
      const t0 = T.g.time, h0 = T.p.health + T.p.shield;
      T.sim(6);
      return { shots, delay: firstShotAt - t0, dmg: h0 - (T.p.health + T.p.shield), state: bot.controller.state, alive: T.p.alive };
    });
    ctx.assert(r.shots > 5, 'bot fired: ' + JSON.stringify(r));
    ctx.assert(r.delay >= CONFIG_HARD_REACTION * 0.75, 'waited its reaction time first: ' + r.delay.toFixed(2));
    ctx.assert(r.dmg > 30 || !r.alive, 'and hit: ' + JSON.stringify(r));
  },

  'bot brain: reloads behind cover instead of in the open, and goes after gunfire it cannot see': async (ctx) => {
    const page = await battle(ctx, 'autostart=1&seed=isle4&rd=4&mode=battle&bots=1&difficulty=hard');
    const r = await page.evaluate(() => {
      const bot = T.m.participants.find((c) => c.isBot);
      const list = [];
      for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) { list.push([x, 55, z, BLOCK.STONE]); for (let y = 56; y <= 60; y++) list.push([x, y, z, BLOCK.AIR]); }
      for (let x = -3; x <= 3; x++) for (let y = 56; y <= 58; y++) list.push([x, y, 4, BLOCK.STONE]);          // a wall between us
      T.g.world.setBlocks(list);
      for (const c of T.m.participants) { c.gliding = false; c.flying = false; }
      T.p.revive(); T.p.gliding = false; T.p.teleport(0.5, 56, -12.5);
      // 1. the bot beside the wall, in the open, its gun empty: it should get behind the wall to reload
      bot.teleport(6.5, 56, 8.5);
      bot.inventory.clear(); const gun = makeWeapon('ar', 2); gun.data.mag = 0; bot.inventory.set(0, gun); bot.inventory.add(makeStack('ammo_medium', 200)); bot.selectSlot(0);
      // (it peeks out again once it has reloaded: look while the reload is running)
      const seenFrom = () => {
        const eye = T.p.eyePos(new THREE.Vector3()), head = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.5, bot.pos.z);
        const dir = head.clone().sub(eye), L = dir.length(); dir.divideScalar(L);
        const hit = raycastBlocks(T.g.world, eye, dir, L, { filter: BULLET_STOPS });
        return !hit || hit.dist >= L - 0.6;
      };
      let hidden = false;
      for (let i = 0; i < 40 && !hidden; i++) { T.sim(0.1); if (bot.reload && !seenFrom()) hidden = true; }
      // 2. gunfire out of sight: a shot far off, behind the wall from the bot
      bot.inventory.clear(); bot.inventory.set(0, makeWeapon('ar', 2)); bot.inventory.add(makeStack('ammo_medium', 200)); bot.selectSlot(0);
      bot.teleport(0.5, 56, 16.5); T.p.teleport(0.5, 56, -20.5);
      const box = [];
      for (let x = -2; x <= 3; x++) for (let z = -23; z <= -18; z++) for (let y = 56; y <= 59; y++) if (x === -2 || x === 3 || z === -23 || z === -18 || y === 59) box.push([x, y, z, BLOCK.STONE]);
      T.g.world.setBlocks(box);                                                               // the player boxed in: unseen
      bot.controller.target = null; bot.controller.lastSeen = null; bot.controller.state = 'roam'; bot.controller.vis.clear(); bot.lastDamagedBy = null;
      bot.controller.hearShot(T.g, bot);                                                       // (starts listening)
      T.g.events.emit('shot', { character: T.p, cls: 'ar', origin: new THREE.Vector3(0.5, 57.5, -20.5), ends: [] });
      bot.controller.think(T.g, bot);
      const goal = bot.controller.goal;
      return { hidden, moved: Math.hypot(bot.pos.x - 6.5, bot.pos.z - 8.5), state: bot.controller.state, toShot: goal ? Math.hypot(goal.x - 0.5, goal.z + 20.5) : -1 };
    });
    ctx.assert(r.hidden, 'the bot went behind the wall to reload: ' + JSON.stringify(r));
    ctx.assert(r.state === 'hunt' && r.toShot >= 0 && r.toShot < 14, 'and went after the gunfire it heard (coming in from the side): ' + JSON.stringify(r));
  },

  'match end: last one standing wins, placements count down, results report stats': async (ctx) => {
    const page = await battle(ctx, 'autostart=1&seed=isle5&rd=4&mode=battle&bots=3');
    const r = await page.evaluate(() => {
      const bots = T.m.participants.filter((c) => c.isBot);
      Combat.applyDamage(T.g, bots[0], 999, { attacker: T.p });
      T.tick(1);
      Combat.applyDamage(T.g, bots[1], 999, { attacker: bots[2] });
      T.tick(1);
      const mid = T.m.state;
      Combat.applyDamage(T.g, bots[2], 999, { attacker: T.p });
      T.tick(2);
      return {
        mid, state: T.m.state, winner: T.m.winner === T.p, places: bots.map((b) => b.stats.placement),
        res: T.m.results(T.p), bot2: T.m.results(bots[2]),
      };
    });
    ctx.assert(r.mid === 'playing' && r.state === 'ended' && r.winner, 'player wins after the last bot falls');
    ctx.assert(JSON.stringify(r.places) === '[4,3,2]', 'placements 4,3,2: ' + r.places);
    ctx.assert(r.res.placement === 1 && r.res.kills === 2 && r.res.won && r.res.damage > 0, 'results: ' + JSON.stringify(r.res));
    ctx.assert(r.bot2.kills === 1 && r.bot2.placement === 2, 'loser results: ' + JSON.stringify(r.bot2));
  },

  'battle soak: 7 bots for 3 simulated minutes without errors, entities bounded': async (ctx) => {
    const page = await battle(ctx, 'autostart=1&seed=isle6&rd=4&mode=battle&bots=7&difficulty=normal');
    const r = await page.evaluate(() => {
      T.p.alive = false; T.p.health = 0;               // the local player sits this one out
      let maxEnt = 0;
      const t0 = performance.now();
      for (let s = 0; s < 180; s++) { T.tick(60); maxEnt = Math.max(maxEnt, T.g.entities.size); }
      const ms = performance.now() - t0;
      return { alive: T.m.participants.filter((c) => c.alive).length, kills: T.m.participants.reduce((a, c) => a + c.stats.kills, 0), maxEnt, msPerTick: ms / (180 * 60), state: T.m.state };
    });
    ctx.assert(r.maxEnt < 800, 'entity count bounded: ' + r.maxEnt);
    ctx.assert(r.kills >= 1, 'bots fought: ' + JSON.stringify(r));
    ctx.assert(r.msPerTick < 4, 'simulation cost per tick ' + r.msPerTick.toFixed(2) + ' ms');
  },

  'battle renders HUD: minimap, compass, storm info': async (ctx) => {
    const page = await battle(ctx);
    await page.evaluate(() => { T.g.paused = false; });
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => ['minimap', 'compass', 'matchInfo', 'stormInfo'].map((c) => getComputedStyle(document.querySelector('.hud[data-player="0"] .' + c)).display));
    ctx.assert(s.every((d) => d !== 'none'), 'match HUD visible: ' + s);
    await ctx.screenshot(page, 'stage6-battle');
  },
};

const CONFIG_DPS_LAST = 10;
const CONFIG_HARD_REACTION = 0.22;
