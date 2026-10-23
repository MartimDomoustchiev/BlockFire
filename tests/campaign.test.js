/* The campaign: the eighteen chapters in order, saves from older versions, and a scripted player who plays the whole
 * story from the first word with Old Wren to THE END. The scripted player teleports to each objective, presses E where
 * the game asks for it, removes the ambient guards that would only get in the way, and kills the targets the chapter
 * spawned; it checks that every step can be finished, that nothing throws, and measures how far the real player has to go. */

const CHAPTER_TITLES = [
  'The Quiet Order', 'The Ledger', 'The Smith of Ironwood', 'Iron for the Forge', 'Toll Roads', 'The Informant', 'The Granary',
  'The Prisoners', 'The Captain', 'The Pickpocket', 'Vale\'s Answer', 'Bells of Ironwood', 'The Missing Pages', 'Night Watch',
  'Marksmen of the Keep', 'Rally the Villages', 'The Seal', 'The Magistrate',
];

/** Opens story mode (fresh save), paused, with the stepping helper the other story tests use. */
async function freshStory(ctx, extra = '') {
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

/** The scripted player (runs in the page). Each __solveStep() call makes one move and reports where the story stands. */
function installSolver() {
  const g = __game, S = g.story, P = g.player;
  const C = window.__camp = { path: 0, extra: 0, cleared: new Set(), ticks: {}, fails: [], key: '' };
  const isLoaded = (x, z) => g.world.getBlock(Math.floor(x), 40, Math.floor(z)) !== -1;
  const hop = (x, y, z) => { C.path += Math.hypot(x - P.pos.x, z - P.pos.z); P.teleport(x, y, z); };
  /** Stand on open ground between rmin and rmin + 4 blocks from p. False: the ground there is not loaded yet (we went there to load it). */
  const stand = (p, rmin = 1.5) => {
    const py = p.y !== undefined ? p.y : p.h !== undefined ? p.h + 1 : P.pos.y;
    if (!isLoaded(p.x, p.z)) { hop(p.x, py + 2, p.z); window.__step(2, {}); return false; }
    const w = g.world, solid = (x, y, z) => w.isSolid(x, y, z);
    for (const dys of [[0, 1, -1], [2, -2, 3, -3]]) {          // the same level first: a roof two blocks up is not "next to" the thing
      for (let r = rmin; r <= rmin + 4; r += 0.8) {
        for (let k = 0; k < 12; k++) {
          const ang = k / 12 * Math.PI * 2, x = Math.floor(p.x + Math.cos(ang) * r), z = Math.floor(p.z + Math.sin(ang) * r);
          for (const dy of dys) {
            const y = Math.floor(py) + dy;
            if (solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z) && !w.isWater(x, y, z)) { hop(x + 0.5, y + 0.01, z + 0.5); return true; }
          }
        }
      }
    }
    hop(p.x, py + 0.5, p.z);
    return true;
  };
  const kill = (c) => { if (c && c.alive && c.npcRole === 'guard') Combat.applyDamage(g, c, 99999, { attacker: P, kind: 'assassination' }); };
  const out = (extra) => Object.assign({ ch: S.chapter, path: C.path + C.extra, t: g.time, step: C.key, fin: S.finished }, extra || {});

  window.__solveStep = () => {
    const A = S.activity, tick0 = g.tickCount;
    if (!A) {
      if (!S.nextChapter()) return out({ finished: true });
      if (!stand(S.mentor.pos, 1.5)) return out({ wait: S.mentor.pos });
      window.__step(4, { interact: true }); window.__step(3, {});
      return out({ started: S.activity ? S.activity.def.title : null });
    }
    const M = A.M, step = A.def.steps[A.stepI], key = A.def.key + ':' + A.stepI, stepI0 = A.stepI;
    C.key = key + ' ' + (typeof step.text === 'function' ? step.text(S, M) : step.text);
    if (A.failing) { C.fails.push(A.def.title + ' / step ' + A.stepI + ': ' + A.failing.reason); window.__step(40, {}); return out({ failing: A.failing.reason }); }
    // ambient guards would only cancel the actions here: the chapter's own people (the ones in M.ents) stay
    const clearGuards = (p, R) => {
      const ck = key + '@' + Math.round(p.x / 25) + ',' + Math.round(p.z / 25);
      if (C.cleared.has(ck)) return;
      C.cleared.add(ck);
      const mine = new Set(M.ents.map((r) => r.e));
      for (const c of Array.from(g.characters())) if (c.npcRole === 'guard' && !mine.has(c) && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < R) g.removeEntity(c);
    };
    const done = (extra) => { C.ticks[key] = (C.ticks[key] || 0) + (g.tickCount - tick0); return out(Object.assign({ stuck: C.ticks[key] > 20000 }, extra || {})); };
    const wait = (p) => out({ wait: { x: p.x, z: p.z } });

    // ---- chapter I: the leap of faith - walk off the perch towards the hay
    if (key === 'ch1:2') {
      const T = S.places.V1.poi.tower;
      if (!isLoaded(T.perch.x, T.perch.z)) { stand(T.perch); return wait(T.perch); }
      hop(T.perch.x, T.perch.y + 0.01, T.perch.z);
      P.yaw = Math.atan2(-(T.hay.x - T.top.x), -(T.hay.z - T.top.z));
      window.__step(10, {}); window.__step(20, { moveZ: 1 }); window.__step(180, {});
      return done();
    }
    // ---- chapter II: tail Fitch from twenty blocks, where he cannot grow suspicious
    if (key === 'ch2:2') {
      const f = M.fitch, d = Math.hypot(f.pos.x - P.pos.x, f.pos.z - P.pos.z);
      if (!C.fitchRoute) { C.fitchRoute = true; C.extra += S.routeBetween(S.places.V2, S.places.C1).reduce((s, p, i, a) => s + (i ? Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) : 0), 0); }
      if (d < 17 || d > 32) { const before = C.path; if (!stand(f.pos, 20)) return wait(f.pos); C.path = before; }
      window.__step(30, {});
      return done();
    }
    // ---- The Informant: get into the hay and keep still while the Tollmen talk
    if (key === 'informant:2') {
      clearGuards(M.hay, 45);
      if (!isLoaded(M.hay.x, M.hay.z)) { stand(M.hay); return wait(M.hay); }
      hop(M.hay.x, M.hay.y + 0.01, M.hay.z);
      window.__step(60, {});
      return done();
    }
    // ---- The Pickpocket: sneak up behind Pell and keep still while the key comes loose
    if (key === 'pickpocket:2') {
      const pell = M.pell;
      clearGuards(pell.pos, 45);
      const bx = pell.pos.x + Math.sin(pell.yaw) * 2.0, bz = pell.pos.z + Math.cos(pell.yaw) * 2.0;
      if (!isLoaded(bx, bz)) { stand(pell.pos, 6); return wait(pell.pos); }
      hop(bx, pell.pos.y + 0.01, bz);
      window.__step(1, { interact: true, crouch: true });
      window.__step(200, { crouch: true });
      return done();
    }
    // ---- talking
    const n = step.talk && step.talk(S, M);
    if (n && n.alive) {
      if (!stand(n.pos, 1.5)) return wait(n.pos);
      window.__step(4, { interact: true }); window.__step(2, {});
      return done({ talk: n.name });
    }
    // ---- a locked cage
    const site = step.cage && step.cage(S, M);
    if (site && !S.cageOpen(site)) {
      const f = site.poi.cage.front;
      clearGuards(f, 45);
      if (!stand(f, 1.0)) return wait(f);
      window.__step(1, { interact: true }); window.__step(170, {});
      return done({ cage: site.name });
    }
    // ---- "use" targets: press E and hold still until they are done
    const u = (M.uses || []).find((x) => !x.done && x.step === A.stepI);
    if (u) {
      const at = { x: u.at.x, y: u.at.y, z: u.at.z };
      clearGuards(at, 45);
      if (!stand(at, 1.2)) return wait(at);
      window.__step(1, { interact: true }); window.__step(Math.ceil((u.time || 2.2) * 60) + 25, {});
      return done({ use: typeof u.text === 'string' ? u.text : '?' });
    }
    // ---- everything else: go to the marker, then deal with what the chapter put there
    const m = step.marker ? step.marker(S, M) : null;
    if (!m) { window.__step(60, {}); return done({ noMarker: true }); }
    const at = m.pos ? m.pos : m, isGuard = !!(m.pos && m.npcRole === 'guard');
    clearGuards(at, 50);
    if (!stand(at, isGuard ? 10 : 1.5)) return wait(at);
    window.__step(12, {});
    const prompt = S.interactTarget(P);
    if (prompt && prompt.kind === 'sync') { window.__step(1, { interact: true }); window.__step(120, {}); return done({ sync: true }); }
    if (S.activity === A && A.stepI === stepI0 && !A.failing) {
      if (isGuard) kill(m);
      for (const r of M.ents) if (r.step === A.stepI) kill(r.e);
    }
    window.__step(30, {});
    return done();
  };
  return true;
}

const CAMPAIGN_TESTS = {
  'campaign: eighteen chapters in order, each with text, a check and a marker; the first and last are where the story starts and ends': async (ctx) => {
    const { page } = await freshStory(ctx);
    const r = await page.evaluate(() => {
      const out = { titles: STORY_CHAPTERS.map((c) => c.title), keys: STORY_CHAPTERS.map((c) => c.key), roman: ROMAN.length };
      out.bad = [];
      STORY_CHAPTERS.forEach((c, i) => {
        if (!c.intro || !c.intro.length || !c.outro || !c.outro.length || typeof c.reward !== 'function') out.bad.push(c.title + ': intro/outro/reward');
        c.steps.forEach((s, j) => {
          if (!s.text || typeof s.check !== 'function') out.bad.push(c.title + ' step ' + j + ': text/check');
          if (!s.marker && !s.talk) out.bad.push(c.title + ' step ' + j + ': no marker');
        });
      });
      out.last = STORY_CHAPTERS[STORY_CHAPTERS.length - 1].reward.toString().includes('finish');
      out.steps = STORY_CHAPTERS.reduce((n, c) => n + c.steps.length, 0);
      return out;
    });
    ctx.assert(JSON.stringify(r.titles) === JSON.stringify(CHAPTER_TITLES), 'the chapters, in order: ' + JSON.stringify(r.titles));
    ctx.assert(new Set(r.keys).size === 18 && r.roman >= 18, 'eighteen distinct chapter keys and enough numerals: ' + JSON.stringify(r.keys));
    ctx.assert(r.bad.length === 0, 'every chapter has an intro, an outro, a reward, and every step text, check and marker: ' + JSON.stringify(r.bad));
    ctx.assert(r.last, 'the last chapter ends the story');
    console.log('       ' + r.steps + ' steps in 18 chapters');
  },

  'campaign: saves from version 1 (five chapters) and version 2 (nine) continue at the right chapter of eighteen': async (ctx) => {
    const { page } = await freshStory(ctx);
    const r = await page.evaluate(() => {
      const v2 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => Story.chapterOfSave({ v: 2, chapter: n }));
      const v1 = [0, 1, 2, 3, 4, 5].map((n) => Story.chapterOfSave({ v: 1, chapter: n }));
      const v3 = [0, 9, 17, 18, 40].map((n) => Story.chapterOfSave({ v: 3, chapter: n }));
      return { v2, v1, v3, title: (n) => null };
    });
    // v2 next chapter -> the first chapter after the last one it had played
    ctx.assert(JSON.stringify(r.v2) === JSON.stringify([0, 1, 2, 3, 5, 7, 9, 12, 14, 18]), 'version 2 saves: ' + JSON.stringify(r.v2));
    ctx.assert(JSON.stringify(r.v1) === JSON.stringify([0, 1, 2, 7, 14, 18]), 'version 1 saves: ' + JSON.stringify(r.v1));
    ctx.assert(JSON.stringify(r.v3) === JSON.stringify([0, 9, 17, 18, 18]), 'version 3 saves are used as they are, and clamped: ' + JSON.stringify(r.v3));
    // a v2 save in the middle of the story opens the game at that chapter, with its silver and flags
    const { page: p2 } = await ctx.open('autostart=1&mode=story&rd=4&seed=migrate', {
      waitReady: false,
      beforeGoto: (p) => p.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) localStorage.removeItem('blockfire.story.v1'); } catch (e) { /* */ } }),
    });
    await p2.waitForFunction(() => window.__game && window.__game.story && document.getElementById('loading').style.display === 'none', null, { timeout: 120000 });
    await p2.evaluate(() => {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('blockfire.story.v1', JSON.stringify({ v: 2, seed: __game.seed, chapter: 6, finished: false, shop: true, silver: 321, synced: [0], explored: [], contracts: 2, inv: null, flags: { tollsTaken: true } }));
    });
    await p2.reload({ timeout: 120000 });   // the story loads its island and its look (slow in a software-rendered browser)
    await p2.waitForFunction(() => window.__game && window.__game.story && document.getElementById('loading').style.display === 'none', null, { timeout: 120000 });
    const mig = await p2.evaluate(() => ({ chapter: __game.story.chapter, title: STORY_CHAPTERS[__game.story.chapter].title, silver: __game.story.silver, shop: __game.story.shop, tolls: !!__game.story.flags.tollsTaken, synced: __game.story.synced.size }));
    // (the save is from the smaller island: its viewpoints were other places, so they are not carried over)
    ctx.assert(mig.title === 'The Pickpocket' && mig.silver >= 321 && mig.shop && mig.tolls && mig.synced === 0, 'a version 2 save (next: Bells) continues at the first chapter after the last one played: ' + JSON.stringify(mig));
    const label = await p2.evaluate(() => { const m = document.getElementById('storyNew'); window.__menu && window.__menu.syncStorySave && window.__menu.syncStorySave(); return m ? m.options[0].textContent : null; });
    ctx.assert(label === null || /Chapter X of XVIII/.test(label), 'the menu names the chapter: ' + label);
  },

  'campaign: the Seal opens faster with Pell\'s key, and a player who skipped the Pickpocket can still pick the lock': async (ctx) => {
    const { page } = await freshStory(ctx);
    const r = await page.evaluate(() => {
      const S = __game.story, out = {};
      S.activity = null; S.chapter = STORY_CHAPTERS.findIndex((c) => c.title === 'The Seal'); S.startChapter();
      S._enterStep(1);
      const u = S.activity.M.uses[0];
      out.slow = u.time; out.slowText = u.text;
      S.giveAll([['pell_key', 1]]);
      out.fast = u.time; out.fastText = u.text;
      S.activity = null;
      return out;
    });
    ctx.assert(r.slow === 6 && r.fast === 1.6 && /Pell/.test(r.slowText) && /Unlock/.test(r.fastText), 'the lockbox: ' + JSON.stringify(r));
  },

  'campaign: a scripted player plays all eighteen chapters, from Old Wren\'s first word to THE END': async (ctx) => {
    const { page, errors } = await freshStory(ctx, '&seed=campaign');
    await page.evaluate(installSolver);
    const rows = [];
    let last = { ch: 0, path: 0, t: 0 }, titleNow = null, started = null, iter = 0, stuckAt = null;
    for (; iter < 6000; iter++) {
      const r = await page.evaluate(() => window.__solveStep());
      if (r.wait) { await page.waitForFunction(({ x, z }) => __game.world.getBlock(Math.floor(x), 40, Math.floor(z)) !== -1, r.wait, { timeout: 60000 }); continue; }
      if (r.started) { started = r.started; titleNow = r.started; }
      if (r.ch !== last.ch) {
        rows.push({ title: CHAPTER_TITLES[last.ch], blocks: Math.round(r.path - last.path), sim: Math.round(r.t - last.t) });
        last = { ch: r.ch, path: r.path, t: r.t };
      }
      if (r.finished || r.fin) break;
      if (r.stuck) { stuckAt = r.step; break; }
    }
    ctx.assert(!stuckAt, 'no step of the story takes more than 20000 ticks; stuck at: ' + stuckAt);
    const end = await page.evaluate(() => {
      const S = __game.story;
      window.__step(90, {});                 // challenges are checked once a second: let The Magistrate Falls pay out
      S.save();
      const d = JSON.parse(localStorage.getItem('blockfire.story.v1'));
      return {
        chapter: S.chapter, finished: S.finished, silver: S.silver, v: d.v, savedChapter: d.chapter, savedFinished: d.finished, fails: window.__camp.fails,
        sealed: !!S.flags.sealed, freed: S.flags.prisonersFreed, challenges: S.challengesDone.size, total: STORY_CHALLENGES.length, magistrate: S.challengesDone.has('magistrate'),
        keepPatrols: __game.characters().filter((c) => c.alive && c.npcRole === 'guard' && c.site === S.places.keep.key && c.controller.route).length,
        recallKept: S.people.filter((p) => p.kind === 'guard' && p.site.kind === 'keep' && p.o.route).length,
      };
    });
    ctx.assert(end.finished && end.chapter === 18, 'the story is finished after eighteen chapters: ' + JSON.stringify(end));
    ctx.assert(end.v === 3 && end.savedChapter === 18 && end.savedFinished, 'the finished story is saved as version 3: ' + JSON.stringify(end));
    ctx.assert(end.sealed && end.recallKept === 0, 'the forged order recalled the keep\'s patrols: ' + JSON.stringify(end));
    ctx.assert(end.freed >= 1, 'at least one prisoner got home: ' + JSON.stringify(end));
    ctx.assert(end.magistrate, 'the Magistrate challenge is done');
    ctx.assert(errors.length === 0 || errors.every((e) => /GPU|GL Driver/.test(e)), 'no page errors: ' + JSON.stringify(errors.slice(0, 3)));
    // the length of the main road: the straight-line walk of every objective, and the time the scripted player spent waiting on NPCs
    const WALK = 5.2, ROUTE = 1.35;              // blocks per second (run and walk), and how much longer a real path is than a straight line
    let total = 0;
    for (const x of rows) { x.min = (x.blocks * ROUTE / WALK + x.sim) / 60; total += x.min; }
    console.log('       chapter                       blocks   sim s   min (main road, no fighting)');
    for (const x of rows) console.log('       ' + String(x.title).padEnd(28) + String(x.blocks).padStart(7) + String(x.sim).padStart(8) + String(x.min.toFixed(1)).padStart(8));
    console.log('       main road: about ' + total.toFixed(0) + ' minutes of walking and waiting; fails seen on the way: ' + (end.fails.length ? JSON.stringify(end.fails) : 'none'));
    ctx.assert(rows.length === 18, 'every chapter was completed in turn: ' + rows.length);
  },
};

module.exports = { tests: CAMPAIGN_TESTS, installSolver };
