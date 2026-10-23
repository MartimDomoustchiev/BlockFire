/* Story content: the Order's gear (AC-style loadout, outfit, forge, sell), the gear screen, letters, challenges,
 * the campaign's chapters with "use" targets, and the lobby look. */

/** Opens story mode (fresh save) and pauses the sim for scripted stepping (same helpers as story.test.js). */
async function storyPage(ctx, extra = '') {
  const r = await ctx.open('autostart=1&mode=story&rd=4' + extra, {
    waitReady: false,
    beforeGoto: (p) => p.addInitScript(() => { try { localStorage.removeItem('blockfire.story.v1'); } catch (e) { /* */ } }),
  });
  await r.page.waitForFunction(() => window.__game && window.__game.story && document.getElementById('loading').style.display === 'none', null, { timeout: 120000 });
  await r.page.evaluate(() => {
    const g = __game;
    g.paused = true;
    window.__step = (n, it) => { g.player.controller = new ScriptedController(it || {}); for (let i = 0; i < n; i++) g.tick(1 / 60); };
  });
  return r;
}

const STORY_CONTENT_TESTS = {
  'story gear: loadout slots take only their kind, wearing pieces gives stats, the forge upgrades, selling pays': async (ctx) => {
    const { page } = await storyPage(ctx);
    const r = await page.evaluate(() => {
      const g = __game, S = g.story, ch = g.player, inv = ch.inventory, out = {};
      const idx = (id) => inv.slots.findIndex((s) => s && s.id === id);
      inv.add(makeStack('gear_hood'));
      const hood = idx('gear_hood');
      out.hoodInPack = hood >= Gear.LOADOUT;
      out.stealthBefore = Gear.stats(ch).stealth;
      out.equip = Gear.act(S, ch, 'equip', hood).ok;
      out.stealthWorn = Gear.stats(ch).stealth;
      out.takeOff = Gear.act(S, ch, 'equip', hood).ok;
      out.stealthOff = Gear.stats(ch).stealth;
      // a hood never goes into the sword slot
      out.badMove = Gear.act(S, ch, 'move', hood, 1).ok;
      // a bow goes into the ranged slot when equipped from the pack
      inv.set(10, makeStack('w_bow'));
      const bow = idx('w_bow');
      out.bowEquip = Gear.act(S, ch, 'equip', bow).ok && inv.get(2) && inv.get(2).id === 'w_bow';
      // forge: needs the shop, the forge in reach, and the materials
      inv.add(makeStack('gear_bracers'));
      const br = idx('gear_bracers');
      Gear.act(S, ch, 'equip', br);
      out.upgradeNoShop = Gear.act(S, ch, 'upgrade', br).ok;
      S.shop = true;
      S.unlockShop();
      ch.teleport(S.places.V1.poi.well.x, S.places.V1.poi.well.y + 0.01, S.places.V1.poi.well.z);
      out.upgradeNotNear = Gear.act(S, ch, 'upgrade', br).ok;
      ch.teleport(S.shopkeeper.pos.x + 1.5, S.shopkeeper.pos.y, S.shopkeeper.pos.z);
      inv.add(makeStack('cloth_scrap', 2)); inv.add(makeStack('leather_strip', 1));
      S.addSilver(40);
      const armourBefore = Gear.stats(ch).defense;
      out.upgrade = Gear.act(S, ch, 'upgrade', br).ok;
      out.level = inv.get(br).data.lvl;
      out.defenseUp = Gear.stats(ch).defense > armourBefore;
      // selling: a bandage pays its price; the hidden blade and worn gear can't be sold
      inv.add(makeStack('bandage', 2));
      const silver = S.silver, band = idx('bandage');
      out.sell = Gear.act(S, ch, 'sell', band).ok && S.silver > silver;
      out.noSellBlade = Gear.act(S, ch, 'sell', 0).ok;
      out.noSellWorn = Gear.act(S, ch, 'sell', br).ok;
      return out;
    });
    ctx.assert(r.hoodInPack, 'the hood starts in the pack');
    ctx.assert(r.equip && r.stealthWorn > r.stealthBefore, 'wearing the hood adds stealth: ' + JSON.stringify(r));
    ctx.assert(r.takeOff && r.stealthOff === r.stealthBefore, 'taking it off removes the stealth');
    ctx.assert(!r.badMove, 'a hood cannot go into the sword slot');
    ctx.assert(r.bowEquip, 'a bow from the pack goes into the ranged slot');
    ctx.assert(!r.upgradeNoShop && !r.upgradeNotNear, 'upgrades need the forge: shop open and Ida in reach');
    ctx.assert(r.upgrade && r.level === 2 && r.defenseUp, 'the forge upgrades a piece and its defense grows: ' + JSON.stringify(r));
    ctx.assert(r.sell, 'selling pays silver');
    ctx.assert(!r.noSellBlade && !r.noSellWorn, 'the hidden blade and worn gear are not for sale');
  },

  'story gear screen: Tab opens the Order\'s gear with a loadout and a 31-slot pack; Escape closes it': async (ctx) => {
    const { page } = await storyPage(ctx);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.__screens && window.__screens.isOpen && window.__screens.kind === 'gear', null, { timeout: 5000 });
    const n = await page.evaluate(() => ({
      loadout: document.querySelectorAll('#storyScreen .gLRow').length,
      pack: document.querySelectorAll('#storyScreen .gGrid .slot').length,
      worn: document.querySelectorAll('#storyScreen .gWorn').length,
      hotbar: document.querySelectorAll('.hud[data-player="0"] .hotbar .slot').length,
      hotbarShown: [...document.querySelectorAll('.hud[data-player="0"] .hotbar .slot')].filter((s) => s.style.display !== 'none').length,
    }));
    ctx.assert(n.loadout === 5 && n.pack === 31 && n.worn === 4, 'loadout 5, pack 31, worn 4: ' + JSON.stringify(n));
    ctx.assert(n.hotbarShown === 5, 'the hotbar shows the five loadout slots in story: ' + JSON.stringify(n));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__screens.isOpen, null, { timeout: 5000 });
  },

  'story letters and challenges: a letter is read once and counted; a challenge pays when its goal is met': async (ctx) => {
    const { page } = await storyPage(ctx);
    const r = await page.evaluate(() => {
      const g = __game, S = g.story, ch = g.player, out = {};
      const before = S.silver, lettersBefore = S.letters.size;
      const letter0 = S.letters.has(0) ? 1 : 0;
      ch.inventory.add({ id: 'order_letter', count: 1, data: { letter: 0 } });
      ch.inventory.add({ id: 'order_letter', count: 1, data: { letter: 0 } });   // the same letter twice counts once
      S._collectLetters();
      out.letters = S.letters.size - lettersBefore + letter0;
      out.packEmpty = !ch.inventory.slots.some((s) => s && s.id === 'order_letter');
      out.firstDone = S.challengesDone.has('first');
      S.stats.kills = 1;
      S._checkChallenges();
      out.firstDone2 = S.challengesDone.has('first');
      out.silver = S.silver - before;
      // a saved story keeps letters and challenges
      S.save();
      const saved = JSON.parse(localStorage.getItem('blockfire.story.v1'));
      out.saved = saved.letters.indexOf(0) >= 0 && saved.challenges.indexOf('first') >= 0 && saved.v === 3;
      return out;
    });
    ctx.assert(r.letters === 1 && r.packEmpty, 'letters are read off the pack: ' + JSON.stringify(r));
    // (the same takedown can finish other challenges too - Quiet Death I for a silent one - each paying its own silver)
    ctx.assert(!r.firstDone && r.firstDone2 && r.silver >= 20, 'First Blood pays 20 silver once the kill is counted: ' + JSON.stringify(r));
    ctx.assert(r.saved, 'letters and challenges are saved');
  },

  'story chapter V Toll Roads: reach camp one, take three tickets through "use" targets, return them to Wren': async (ctx) => {
    const { page, errors } = await storyPage(ctx);
    const info = await page.evaluate(() => {
      const g = __game, S = g.story;
      g.player.teleport(0.5, CONFIG.CHUNK_HEIGHT - 2, 0.5);
      S.chapter = STORY_CHAPTERS.findIndex((c) => c.title === 'Toll Roads');
      S.startChapter();
      return { title: S.activity.def.title, first: S.objective().text, index: S.chapter };
    });
    ctx.assert(info.title === 'Toll Roads', 'the chapter starts: ' + JSON.stringify(info));
    // play the chapter by walking to each point and pressing E (the use takes its time while we stand still)
    const useAt = async (label) => {
      const pos = await page.evaluate(() => {
        const S = __game.story, A = S.activity, u = (A.M.uses || []).find((x) => !x.done && x.step === A.stepI);
        return u ? { x: u.at.x, y: u.at.y, z: u.at.z } : null;
      });
      ctx.assert(pos, label + ': a use target exists for this step');
      await page.evaluate((p) => {
        const g = __game, w = g.world, solid = (x, y, z) => w.isSolid(x, y, z);
        // the camp guards would see us at the strongbox and cancel the action: this test takes the steps, not the stealth
        for (const c of Array.from(g.characters())) if (c.npcRole === 'guard' && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 60) g.removeEntity(c);
        for (const r of [1.5, 2, 2.5, 3]) for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2, x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
          for (let y = Math.floor(p.y) + 3; y >= Math.floor(p.y) - 3; y--) {
            if (solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z)) { g.player.teleport(x + 0.5, y, z + 0.5); return; }
          }
        }
      }, pos);
      // press E, then hold still until the action completes (2.2 s)
      await page.evaluate(() => { window.__step(1, { interact: true }); window.__step(150, {}); });
    };
    await page.evaluate(() => { const g = __game; const C1 = g.story.places.C1; g.player.teleport(C1.x, C1.poi.strongbox.y + 0.01, C1.z); window.__step(14, {}); });   // the director checks a step every 0.1 s (6 ticks): give it time to see us arrive
    await useAt('camp one');
    const t1 = await page.evaluate(() => __game.story.totalCount('toll_ticket'));
    ctx.assert(t1 === 1, 'one ticket after camp one: ' + t1);
    await useAt('camp two');
    await useAt('camp three');
    const t3 = await page.evaluate(() => __game.story.totalCount('toll_ticket'));
    ctx.assert(t3 === 3, 'three tickets collected: ' + t3);
    const flag = await page.evaluate(() => !!__game.story.flags.tollsTaken);
    ctx.assert(flag, 'the Tollbreaker flag is set after the third ticket');
    // back to Wren to finish the chapter
    await page.evaluate(() => { const m = __game.story.mentor; __game.player.teleport(m.pos.x + 1.5, m.pos.y + 0.01, m.pos.z); window.__step(3, { interact: true }); window.__step(3, {}); });
    const done = await page.evaluate(() => ({ active: __game.story.activity ? __game.story.activity.def.title : null, chapter: __game.story.chapter, tickets: __game.story.totalCount('toll_ticket') }));
    ctx.assert(done.active === null && done.chapter === info.index + 1 && done.tickets === 0, 'the chapter completes and the tickets are handed over: ' + JSON.stringify(done));
    ctx.assert(errors.length === 0 || errors.every((e) => /GPU|GL Driver/.test(e)), 'no page errors');
  },

  'story chapters: the granary, bells and night watch start with their objective and their use targets where the plan puts them': async (ctx) => {
    const { page, errors } = await storyPage(ctx);
    const r = await page.evaluate(() => {
      const g = __game, S = g.story, out = {};
      const start = (title) => { S.activity = null; S.chapter = STORY_CHAPTERS.findIndex((c) => c.title === title); S.startChapter(); return S.activity; };
      // granary: three sacks in the square of V4, as uses of the second step
      let A = start('The Granary');
      out.granaryTitle = A.def.title;
      out.granaryFirst = S.objective().text;
      S._enterStep(1);
      out.granaryUses = (A.M.uses || []).filter((u) => u.step === 1).length;
      out.granaryNear = (A.M.uses || []).every((u) => Math.hypot(u.at.x - S.places.V4.x, u.at.z - S.places.V4.z) < 40);
      S.activity = null;
      // bells: the bell rope of each tower is its own step's use
      A = start('Bells of Ironwood');
      out.bellsTitle = A.def.title;
      S._enterStep(2);
      out.bellUses = (A.M.uses || []).filter((u) => u.step === 2).length;
      out.bellAtTower = (A.M.uses || []).every((u) => ['V2', 'V3', 'V4'].some((k) => Math.hypot(u.at.x - S.places[k].poi.tower.top.x, u.at.z - S.places[k].poi.tower.top.z) < 0.5));
      S.activity = null;
      // night watch: three braziers on the outer edge of the keep's wall walk, away from the gate
      A = start('Night Watch');
      out.nightTitle = A.def.title;
      S._enterStep(1);
      out.nightUses = (A.M.uses || []).filter((u) => u.step === 1).length;
      out.nightOnKeep = (A.M.uses || []).every((u) => Math.hypot(u.at.x - S.places.keep.x, u.at.z - S.places.keep.z) < 40);
      const g0 = S.places.keep.poi.gate.out;
      out.nightAwayFromGate = (A.M.uses || []).every((u) => Math.hypot(u.at.x - g0.x, u.at.z - g0.z) > 25);
      out.nightOnWalls = (A.M.uses || []).every((u) => Math.abs(u.at.y - (S.places.keep.h + 8)) < 0.5);
      S.activity = null;
      return out;
    });
    ctx.assert(r.granaryTitle === 'The Granary' && r.granaryUses === 3 && r.granaryNear, 'granary: three sacks in the square: ' + JSON.stringify(r));
    ctx.assert(r.bellsTitle === 'Bells of Ironwood' && r.bellUses >= 1 && r.bellAtTower, 'bells: the rope at the tower top: ' + JSON.stringify(r));
    ctx.assert(r.nightTitle === 'Night Watch' && r.nightUses === 3 && r.nightOnKeep, 'night watch: three braziers at the keep: ' + JSON.stringify(r));
    ctx.assert(r.nightAwayFromGate && r.nightOnWalls, 'night watch: the braziers stand on the wall walk, away from the gate: ' + JSON.stringify(r));
    ctx.assert(errors.length === 0 || errors.every((e) => /GPU|GL Driver/.test(e)), 'no page errors');
  },

  'lobby look: the look you pick is kept, validated, and shown on the stage; invalid values fall back': async (ctx) => {
    const { page } = await ctx.open('', { waitReady: false });
    await page.waitForFunction(() => !!window.__lobby, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const n = PLAYER_LOOK.normalize({ skin: 99, style: 'x', hair: 2, hood: 1, cloak: true, top: -1 });
      const s = JSON.parse(localStorage.getItem('blockfire.settings.v2') || '{}');
      window.__lobby.setLook(n);
      return { n, skinFallback: n.skin === PLAYER_LOOK.DEFAULT.skin, hair: n.hair, hood: n.hood, cloak: n.cloak, stageLook: window.__lobby.actor.lookSpec.hair };
    });
    ctx.assert(r.skinFallback && r.hair === 2 && r.hood === true && r.cloak === true && r.stageLook === 2, 'normalised look: ' + JSON.stringify(r));
    // the look round-trips through the network encoding
    const rt = await page.evaluate(() => {
      const a = PLAYER_LOOK.normalize({ skin: 4, style: 2, hair: 7, top: 9, bottom: 5, accent: 3, facial: 2, hood: true, cloak: false });
      const b = NetProto.unlook(NetProto.look(a));
      return JSON.stringify(a) === JSON.stringify(b);
    });
    ctx.assert(rt, 'the look survives the network encoding');
  },
};

module.exports = { tests: STORY_CONTENT_TESTS };
