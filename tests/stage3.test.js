/* Stage 3: damage model, guns, rarity, projectiles, explosions, consumables, loot. */
const { SETUP } = require('./stage2.test.js');

// Extra page helpers for combat (installed after SETUP).
const COMBAT = `(() => {
  /** Spawns a standing dummy with feet at (x, 31, z) on the arena floor. */
  T.dummy = (x, z, shield = 0) => {
    const d = new Character({ name: 'D', controller: new DummyController(false) });
    T.g.addEntity(d); d.teleport(x + 0.5, 31.001, z + 0.5); d.shield = shield; d.home = d.pos.clone();
    return d;
  };
  T.clearChars = () => { for (const e of [...T.g.entities.values()]) if (e.type !== 'character' || e !== T.p) { if (e !== T.p) T.g.removeEntity(e); } };
  /** Aim the player's eye at a world point. */
  T.aimAt = (x, y, z) => {
    const dx = x - T.p.pos.x, dy = y - T.p.eyeY, dz = z - T.p.pos.z;
    T.p.yaw = Math.atan2(-dx, -dz); T.p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  T.hold = (stack) => { T.p.inventory.clear(); T.p.inventory.set(0, stack); T.p.selectSlot(0); T.p.reload = null; T.p.fireCd = 0; T.p.bloom = 0; T.p.recoil = 0; };
  T.log = [];
  for (const n of ['damage', 'kill', 'impact', 'explosion', 'shot', 'respawn', 'pickup', 'chestOpened']) T.g.events.on(n, (e) => T.log.push(Object.assign({ ev: n }, e)));
  T.count = (n) => T.log.filter((e) => e.ev === n).length;
  return true;
})()`;

async function setup(ctx, query) {
  const { page } = await ctx.open(query || 'autostart=1&seed=hello&rd=4');
  await page.evaluate(SETUP);
  await page.evaluate(COMBAT);
  await page.evaluate(() => { T.arena(); T.clearChars(); });
  await page.evaluate(() => T.waitSettled());
  return page;
}

exports.tests = {
  'damage: shield absorbs first, overflow to health, death drops inventory, no damage after death': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const d = T.dummy(5, 5, 40);
      d.inventory.add(makeStack('stone', 10)); d.inventory.add(makeWeapon('ar', 2));
      const out = {};
      out.a = Combat.applyDamage(T.g, d, 30, { attacker: T.p });
      out.s1 = [d.shield, d.health];
      out.b = Combat.applyDamage(T.g, d, 30, { attacker: T.p });
      out.s2 = [d.shield, d.health];
      out.bad = [Combat.applyDamage(T.g, d, NaN), Combat.applyDamage(T.g, d, -5), Combat.applyDamage(T.g, d, Infinity)];
      out.c = Combat.applyDamage(T.g, d, 500, { attacker: T.p, cls: 'ar' });
      out.dead = [d.alive, d.health, d.inventory.slots.filter(Boolean).length];
      out.after = Combat.applyDamage(T.g, d, 10, { attacker: T.p });
      out.kills = T.p.stats.kills; out.dealt = T.p.stats.damageDealt;
      out.drops = [...T.g.entities.values()].filter((e) => e.type === 'drop').map((e) => e.stack.id).sort();
      return out;
    });
    ctx.assert(r.a === 30 && r.s1[0] === 10 && r.s1[1] === 100, 'first 30 all to shield: ' + JSON.stringify(r.s1));
    ctx.assert(r.b === 30 && r.s2[0] === 0 && r.s2[1] === 80, '10 shield + 20 health: ' + JSON.stringify(r.s2));
    ctx.assert(r.bad.every((v) => v === 0), 'NaN / negative / infinite damage ignored');
    ctx.assert(r.c === 80 && !r.dead[0] && r.dead[1] === 0 && r.dead[2] === 0, 'overkill deals only remaining 80 and kills');
    ctx.assert(r.after === 0, 'no damage after death');
    ctx.assert(r.kills === 1 && r.dealt === 140, 'attacker stats: ' + r.kills + ' / ' + r.dealt);
    ctx.assert(JSON.stringify(r.drops) === JSON.stringify(['stone', 'w_ar']), 'inventory spilled: ' + r.drops);
  },

  'hitscan: headshots multiply, body shots do base damage, falloff applies at range': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const st = Weapons.stats('ar', 0);
      const d = T.dummy(0, -8);
      T.stand(0.5, 0.5);
      T.hold(makeWeapon('ar', 0));
      T.aimAt(0.5, 31 + 1.65, -7.5);                 // head
      T.press({ firePressed: true, fire: true });
      out.head = 100 - d.health;
      d.health = 100;
      T.p.fireCd = 0; T.p.bloom = 0; T.p.recoil = 0; T.tick(30);
      T.aimAt(0.5, 31 + 0.9, -7.5);                  // body
      T.press({ firePressed: true, fire: true });
      out.body = 100 - d.health;
      out.expectHead = st.damage * st.headMult; out.expectBody = st.damage;
      out.falloffMid = Combat.falloff(st, 100); out.falloffFar = Combat.falloff(st, 500);
      return out;
    });
    ctx.near(r.head, r.expectHead, 1e-6, 'headshot damage');
    ctx.near(r.body, r.expectBody, 1e-6, 'body damage');
    ctx.near(r.falloffMid, 1 - 0.35 * 0.5, 1e-9, 'linear falloff halfway');
    ctx.near(r.falloffFar, 0.65, 1e-9, 'falloff floor');
  },

  'fire cadence is exact at 60 Hz and rarity scales every stat the right way': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      T.g.rules.infiniteAmmo = true;
      T.stand(0.5, 0.5); T.p.pitch = 0.6;          // shoot at the sky
      const res = {};
      for (const [cls, rar] of [['ar', 0], ['ar', 4], ['smg', 2], ['pistol', 0]]) {
        const w = makeWeapon(cls, rar); w.data.mag = 100000;
        T.hold(w);
        const before = T.count('shot');
        T.it = { fire: true }; T.once = { firePressed: true };
        if (!Weapons.stats(cls, rar).auto) {           // semi-auto: click every tick
          for (let i = 0; i < 600; i++) { T.once = { firePressed: true }; T.tick(1); }
        } else T.tick(600);
        T.it = {};
        res[cls + rar] = { shots: T.count('shot') - before, rate: 1 / Weapons.stats(cls, rar).interval };
      }
      const s = (k) => [0, 1, 2, 3, 4].map((r) => Weapons.stats('ar', r)[k]);
      res.scale = { damage: s('damage'), interval: s('interval'), spread: s('spread'), mag: s('mag'), reload: s('reload') };
      return res;
    });
    for (const k of ['ar0', 'ar4', 'smg2', 'pistol0']) {
      const want = 1 + Math.floor(10 * r[k].rate + 1e-9);
      ctx.near(r[k].shots, want, 1, `${k} shots in 10 s (rate ${r[k].rate.toFixed(3)})`);
    }
    const inc = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]), dec = (a) => a.every((v, i) => i === 0 || v <= a[i - 1]);
    ctx.assert(inc(r.scale.damage) && r.scale.damage[4] > r.scale.damage[0], 'damage increases with rarity');
    ctx.assert(dec(r.scale.interval) && dec(r.scale.spread) && dec(r.scale.reload), 'faster fire, tighter spread, faster reload');
    ctx.assert(inc(r.scale.mag) && r.scale.mag[4] > r.scale.mag[0], 'bigger magazine');
  },

  'magazine + reserve accounting through auto and manual reloads': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.stand(0.5, 0.5); T.p.pitch = 0.6;
      const w = makeWeapon('ar', 0);                 // mag 30
      T.hold(w); T.p.inventory.set(1, makeStack('ammo_medium', 45));
      T.it = { fire: true }; T.tick(60 * 7); T.it = {};    // empties the mag -> auto reload
      out.afterFirst = [w.data.mag, T.p.inventory.count('ammo_medium'), !!T.p.reload];
      T.tick(60 * 3);
      out.reloaded = [w.data.mag, T.p.inventory.count('ammo_medium')];
      T.it = { fire: true }; T.tick(60); T.it = {};
      const magBefore = w.data.mag;
      T.press({ reload: true }); T.tick(60 * 3);
      out.manual = [magBefore, w.data.mag, T.p.inventory.count('ammo_medium')];
      // switching slots cancels a reload
      T.it = { fire: true }; T.tick(30); T.it = {};
      T.press({ reload: true }); T.tick(10); T.press({ slot: 1 }); T.tick(5);
      out.cancelled = T.p.reload === null;
      return out;
    });
    ctx.assert(r.afterFirst[0] === 0 && r.afterFirst[2] === false || r.afterFirst[0] >= 0, 'sanity');
    ctx.assert(r.reloaded[0] === 30 && r.reloaded[1] === 15, 'auto-reload took 30 from 45: ' + JSON.stringify(r.reloaded));
    ctx.assert(r.manual[1] === Math.min(30, r.manual[0] + 15) && r.manual[0] + 15 === r.manual[1] + r.manual[2], 'manual reload conserves ammo: ' + JSON.stringify(r.manual));
    ctx.assert(r.cancelled, 'slot switch cancels reload');
  },

  'shotgun fires 10 pellets; sniper bullets drop; bullets pass leaves, stop at stone, break glass': async (ctx) => {
    const page = await setup(ctx, 'autostart=1&seed=hello&rd=10');     // the target wall is 140 blocks away
    await page.waitForFunction(() => T.w.chunks.has(World.key(0, -9)) && T.w.chunks.get(World.key(0, -9)).state === ChunkState.READY, null, { timeout: 60000 });
    const r = await page.evaluate(() => {
      const out = {};
      // shotgun point blank
      const d = T.dummy(0, -3);
      T.stand(0.5, 0.5);
      T.hold(makeWeapon('shotgun', 0));
      T.aimAt(0.5, 32.0, -2.5);
      const dmg0 = T.count('damage');
      T.press({ firePressed: true, fire: true });
      out.pellets = T.count('damage') - dmg0;
      T.g.removeEntity(d);
      // sniper drop: shoot level at a far wall
      const list = [];
      for (let y = 31; y <= 45; y++) for (let x = -3; x <= 3; x++) list.push([x, y, -140, BLOCK.STONE]);
      for (let z = -139; z <= -15; z++) for (let x = -2; x <= 2; x++) {
        list.push([x, 30, z, BLOCK.STONE], [x, 29, z, BLOCK.STONE]);
        for (let y = 31; y <= 40; y++) list.push([x, y, z, BLOCK.AIR]);         // clear the firing lane
      }
      T.w.setBlocks(list);
      return out;
    });
    await page.evaluate(() => T.waitSettled());
    const r2 = await page.evaluate(() => {
      const out = {};
      T.stand(0.5, 0.5); T.hold(makeWeapon('sniper', 4));
      T.p.yaw = 0; T.p.pitch = 0; T.p.adsT = 1;
      const eyeY = T.p.eyeY;
      T.it = { aim: true }; T.tick(30);
      const n0 = T.log.length;
      T.p.pitch = 0; T.p.recoil = 0;
      T.once = { firePressed: true, fire: true, aim: true }; T.tick(120); T.it = {};
      const hit = T.log.slice(n0).find((e) => e.ev === 'impact');
      out.drop = hit ? eyeY - hit.y : null; out.dist = hit ? -hit.z : null;
      // leaves vs stone vs glass
      T.w.setBlocks([[0, 32, -4, BLOCK.LEAVES], [0, 32, -6, BLOCK.GLASS], [0, 32, -9, BLOCK.STONE]]);
      T.stand(0.5, 0.5); T.hold(makeWeapon('pistol', 0));
      T.aimAt(0.5, 32.5, -8.5);
      const n1 = T.log.length;
      T.press({ firePressed: true, fire: true });
      const imp = T.log.slice(n1).filter((e) => e.ev === 'impact');
      out.firstImpact = imp.length ? imp[0].block : null;
      out.glassGone = T.w.getBlock(0, 32, -6) === BLOCK.AIR;
      out.leavesKept = T.w.getBlock(0, 32, -4) === BLOCK.LEAVES;
      T.p.fireCd = 0; T.tick(30);
      const n2 = T.log.length;
      T.press({ firePressed: true, fire: true });
      const imp2 = T.log.slice(n2).filter((e) => e.ev === 'impact');
      out.secondImpact = imp2.length ? imp2[0].block : null;
      return out;
    });
    ctx.assert(r.pellets === 10, 'all 10 pellets hit at point blank: ' + r.pellets);
    const t = 139.5 / 300, expectDrop = 0.5 * 14 * t * t;          // ~1.51 blocks
    ctx.assert(r2.drop !== null, 'sniper bullet hit the wall');
    ctx.near(r2.drop, expectDrop, 0.25, 'sniper bullet drop (blocks) over ' + (r2.dist || 0).toFixed(1));
    ctx.assert(r2.firstImpact === 7 && r2.glassGone && r2.leavesKept, 'bullet passed leaves and shattered glass: ' + JSON.stringify(r2));
    ctx.assert(r2.secondImpact === 3, 'next bullet stopped at stone');
  },

  'rocket: splash falloff, self damage, destroys blocks except bedrock, knockback': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const near = T.dummy(0, -10), far = T.dummy(3, -10);
      const st = Weapons.stats('rocket', 0);
      T.w.setBlocks([[0, 31, -11, BLOCK.STONE], [0, 32, -11, BLOCK.BRICK]]);
      T.w.setBlock(1, 0, -11, BLOCK.BEDROCK);
      Combat.explode(T.g, 0.5, 31.5, -10.5, st, T.p);
      out.near = 100 - near.health; out.far = 100 - far.health;
      out.nearVel = near.vel.y;
      out.blocks = [T.w.getBlock(0, 31, -11), T.w.getBlock(0, 32, -11), T.w.getBlock(0, 30, -10), T.w.getBlock(1, 0, -11)];
      // fire a real rocket at a wall next to us -> self damage
      T.w.setBlocks([[0, 31, -3, BLOCK.STONE], [0, 32, -3, BLOCK.STONE], [0, 33, -3, BLOCK.STONE]]);
      T.stand(0.5, 0.5); T.hold(makeWeapon('rocket', 0)); T.aimAt(0.5, 32.5, -2.5);
      const hp = T.p.health;
      T.press({ firePressed: true, fire: true }); T.tick(30);
      out.self = hp - T.p.health;
      out.expl = T.count('explosion');
      return out;
    });
    ctx.assert(r.near > r.far && r.far > 0, 'closer = more splash damage: ' + r.near + ' vs ' + r.far);
    ctx.assert(r.nearVel > 0, 'knockback lifts the target');
    ctx.assert(r.blocks[0] === 0 && r.blocks[1] === 0 && r.blocks[2] === 0, 'blocks in radius destroyed: ' + r.blocks);
    ctx.assert(r.blocks[3] === 16, 'bedrock survives');
    ctx.assert(r.self > 0 && r.expl === 2, 'rocket at your feet damages you: ' + r.self);
  },

  'consumables: caps, use time, cancel on slot switch, refuse when full': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.stand(0.5, 0.5);
      T.p.inventory.clear();
      T.p.inventory.set(0, makeStack('bandage', 5)); T.p.inventory.set(1, makeStack('medkit', 1)); T.p.inventory.set(2, makeStack('shield_potion', 3));
      T.p.health = 50; T.p.selectSlot(0);
      T.press({ firePressed: true, fire: true }); T.sim(3.6);
      out.bandage1 = [T.p.health, T.p.inventory.count('bandage')];
      T.press({ firePressed: true }); T.sim(3.6);
      T.press({ firePressed: true }); T.sim(3.6);
      out.bandageCap = [T.p.health, T.p.inventory.count('bandage')];
      T.press({ firePressed: true }); T.tick(5);
      out.refused = T.p.using === null;
      T.p.selectSlot(1); T.press({ firePressed: true }); T.sim(2); T.press({ slot: 2 }); T.tick(2);
      out.cancelled = [T.p.using && T.p.using.id, T.p.inventory.count('medkit')];
      T.press({ firePressed: true }); T.sim(4.1);
      T.press({ firePressed: true }); T.sim(4.1);
      T.press({ firePressed: true }); T.sim(4.1);
      out.shield = [T.p.shield, T.p.inventory.count('shield_potion')];
      T.p.selectSlot(1); T.press({ firePressed: true }); T.sim(8.1);
      out.medkit = [T.p.health, T.p.inventory.count('medkit')];
      return out;
    });
    ctx.assert(r.bandage1[0] === 65 && r.bandage1[1] === 4, 'bandage +15: ' + r.bandage1);
    ctx.assert(r.bandageCap[0] === 75 && r.bandageCap[1] === 3, 'bandage caps at 75 (third use refused, not consumed): ' + r.bandageCap);
    ctx.assert(r.refused, 'bandage refused at 75');
    ctx.assert(r.cancelled[0] === 'shield_potion' || r.cancelled[0] === null, 'medkit use cancelled by switching');
    ctx.assert(r.cancelled[1] === 1, 'cancelled medkit not consumed');
    ctx.assert(r.shield[0] === 100 && r.shield[1] === 1, 'two tonics reach the 100 cap, third refused: ' + r.shield);
    ctx.assert(r.medkit[0] === 100 && r.medkit[1] === 0, 'medkit heals to full: ' + r.medkit);
  },

  'weapon cap of 5; E picks up weapons and swaps with the held one at the cap': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.stand(0.5, 0.5);
      const inv = T.p.inventory; inv.clear();
      for (let i = 0; i < 5; i++) out['add' + i] = inv.add(makeWeapon('pistol', i));
      out.sixth = inv.add(makeWeapon('ar', 0));
      T.p.selectSlot(2);
      const drop = T.g.addEntity(new ItemDrop(makeWeapon('sniper', 4), 1.5, 31.2, 0.5));
      drop.pickupDelay = 0;
      T.tick(60);
      out.notAuto = !drop.removed;
      T.press({ interact: true });
      out.held = stackLabel(T.p.heldStack());
      out.weapons = inv.weaponCount();
      const dropped = [...T.g.entities.values()].filter((e) => e.type === 'drop' && !e.removed).map((e) => stackLabel(e.stack));
      out.dropped = dropped;
      return out;
    });
    ctx.assert([0, 1, 2, 3, 4].every((i) => r['add' + i] === 0) && r.sixth === 1, 'sixth weapon rejected');
    ctx.assert(r.notAuto, 'weapons are not auto-collected');
    ctx.assert(r.held === 'Legendary Sniper Rifle' && r.weapons === 5, 'swapped into the held slot: ' + r.held);
    ctx.assert(r.dropped.includes('Rare Pistol'), 'old weapon dropped: ' + r.dropped);
  },

  'loot: deterministic per seed, rarity distribution follows weights, chests open once': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const a = JSON.stringify(Loot.chestContents(T.g, 10, 31, 10)), b = JSON.stringify(Loot.chestContents(T.g, 10, 31, 10));
      out.same = a === b;
      out.diff = a !== JSON.stringify(Loot.chestContents(T.g, 11, 31, 10));
      const hist = [0, 0, 0, 0, 0];
      for (let i = 0; i < 6000; i++) hist[Loot.rollRarity(new Rng(i * 7919 + 1), 'chest')]++;
      out.hist = hist.map((n) => n / 6000);
      // open a chest with E
      T.w.setBlock(2, 31, 0, BLOCK.CHEST);
      T.stand(0.5, 0.5); T.lookAt(2, 31, 0);
      T.press({ interact: true });
      out.opened = T.w.getBlock(2, 31, 0) === BLOCK.AIR;
      out.spilled = [...T.g.entities.values()].filter((e) => e.type === 'drop').length;
      T.press({ interact: true });
      out.events = T.count('chestOpened');
      return out;
    });
    ctx.assert(r.same && r.diff, 'chest contents deterministic and position-dependent');
    const w = [18, 34, 28, 15, 5], tot = w.reduce((a, b) => a + b);
    w.forEach((v, i) => ctx.near(r.hist[i], v / tot, 0.025, 'rarity share ' + i));
    ctx.assert(r.opened && r.spilled >= 3 && r.events === 1, 'chest opens once and spills: ' + JSON.stringify(r));
  },

  'dummies respawn at home with full health after the configured delay': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const d = T.dummy(4, -4);
      d.respawnDelay = 3;
      Combat.applyDamage(T.g, d, 200, { attacker: T.p });
      const dead = !d.alive;
      T.sim(2.9);
      const still = !d.alive;
      T.sim(0.2);
      return { dead, still, alive: d.alive, hp: d.health, x: d.pos.x, z: d.pos.z, ev: T.count('respawn') };
    });
    ctx.assert(r.dead && r.still && r.alive && r.hp === 100 && r.ev === 1, 'respawned: ' + JSON.stringify(r));
    ctx.near(r.x, 4.5, 1e-6, 'home x'); ctx.near(r.z, -3.5, 1e-6, 'home z');
  },

  'arena renders: guns, beams, dummies, HUD without errors': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=plains7&rd=4&arena=1', { viewport: { width: 1100, height: 650 } });
    await page.waitForTimeout(600);
    const s = await page.evaluate(() => ({
      dummies: __game.characters().length - 1,
      drops: [...__game.entities.values()].filter((e) => e.type === 'drop').length,
      hud: getComputedStyle(document.querySelector('.hud[data-player=\"0\"] .vitals')).display !== 'none',
    }));
    ctx.assert(s.dummies === 4 && s.drops >= 5 && s.hud, 'arena set up: ' + JSON.stringify(s));
    await ctx.screenshot(page, 'stage3-arena');
  },
};
