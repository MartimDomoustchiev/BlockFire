/* ============================================================
 * Story mode director (host side). Owns everything the campaign
 * adds on top of the island:
 *
 *   people      guards on posts and patrols, villagers in the
 *               squares, Old Wren at the hideout; NPCs far from every
 *               player sleep, fallen guards come back unseen
 *   campaign    eighteen chapters (missions*.js) run step by step, with
 *               dialogue, objectives, markers, fail conditions and
 *               checkpoints ("desynchronized" -> retry)
 *   contracts   side jobs from the notice boards
 *   viewpoints  climb, synchronize (E), reveal the map, fast travel
 *   notoriety   rises with fights and dead innocents, falls when you
 *               tear down wanted posters
 *   silver      the Order's purse, spent at Ida's shop
 *   saving      progress is kept in localStorage (host / offline)
 * Everything shared (objective, silver, viewpoints...) is one state
 * for all players; sharedState() is what online clients receive.
 * ============================================================ */
const STORY_SAVE_KEY = 'blockfire.story.v1';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
// the campaign in order: the five of missions.js (core), the four of missions-extra.js and the nine of missions-more.js between them
const STORY_CHAPTERS = [
  STORY_CHAPTERS_CORE[0],                                   // I     The Quiet Order
  STORY_CHAPTERS_CORE[1],                                   // II    The Ledger
  STORY_CHAPTERS_CORE[2],                                   // III   The Smith of Ironwood
  STORY_MORE_CHAPTERS.iron,                                 // IV    Iron for the Forge
  STORY_NEW_CHAPTERS.tollRoads,                             // V     Toll Roads
  STORY_MORE_CHAPTERS.informant,                            // VI    The Informant
  STORY_NEW_CHAPTERS.granary,                               // VII   The Granary
  STORY_MORE_CHAPTERS.prisoners,                            // VIII  The Prisoners
  STORY_CHAPTERS_CORE[3],                                   // IX    The Captain
  STORY_MORE_CHAPTERS.pickpocket,                           // X     The Pickpocket
  STORY_MORE_CHAPTERS.answer,                               // XI    Vale's Answer
  STORY_NEW_CHAPTERS.bells,                                 // XII   Bells of Ironwood
  STORY_MORE_CHAPTERS.pages,                                // XIII  The Missing Pages
  STORY_NEW_CHAPTERS.nightWatch,                            // XIV   Night Watch
  STORY_MORE_CHAPTERS.marksmen,                             // XV    Marksmen of the Keep
  STORY_MORE_CHAPTERS.rally,                                // XVI   Rally the Villages
  STORY_MORE_CHAPTERS.seal,                                 // XVII  The Seal
  STORY_CHAPTERS_CORE[4],                                   // XVIII The Magistrate
];
const STORY_CHAPTER_MAP_V1 = [0, 1, 2, 5, 8, 9];            // a version 1 save's chapter index (five chapters) -> a version 2 one (nine)
const STORY_V2_PLACES = [0, 1, 2, 4, 6, 8, 11, 13, 17];     // where the nine chapters of a version 2 save sit in today's eighteen

class Story {
  constructor(game, planInfo, opts = {}) {
    this.game = game;
    this.plan = new StoryPlan(planInfo);
    game.story = this;
    this.places = this._choosePlaces();
    this.notoriety = 0;                  // 0..3: how hunted the Order is (shared by every player)
    this.silver = 0;                     // the Order's purse (shared)
    this.chapter = 0;                    // next chapter to play; STORY_CHAPTERS.length = all done
    this.finished = false;
    this.shop = false;                   // Ida's shop at the hideout (after chapter III)
    this.contractsDone = 0;
    this.synced = new Set();             // viewpoint ids
    this.explored = [];                  // [x, z, r] circles of the map that are revealed
    this.activity = null;                // running chapter or contract
    this.offers = new Map();             // notice board site key -> contract offers
    this.alarms = new Map();             // site key -> game time the site's alarm ends
    this.lastFight = new Map();
    this.people = [];                    // ambient NPCs (and how to bring them back)
    this.leftovers = [];                 // mission NPCs to clear away once nobody sees them
    this.lineQueue = [];                 // dialogue waiting to be said
    this.lineUntil = 0;
    this.prompts = new Map();            // player id -> what E would do { kind, text, target }
    this.actions = new Map();            // player id -> timed action in progress (sync, lock picking)
    this.posters = [];
    this.hayLandings = [];
    this.version = 1;                    // bumped when shared state changes (online sync)
    this.wakeAt = this.upkeepAt = this.fogAt = this.runAt = 0;
    this.rng = new Rng(game.seed ^ 0x51a7);
    this.saveEnabled = opts.save !== false && !game.replica;
    // challenges and collectibles (challenges.js): counters, named flags, what is done
    this.stats = { kills: 0, silent: 0, arrows: 0, parries: 0, leaps: 0, contracts: 0, travels: 0, purchases: 0, distance: 0, posters: 0,
      consumed: 0, smokeThrown: 0, upgrades: 0, maxedGear: 0, notorietyMax: 0, chapterClean: 0, chapterCleanHands: 0, chapterUnhurt: 0, nightChapters: 0, deaths: 0 };
    this.flags = {};                     // granaryClean, bellsClean, tollsTaken
    this.letters = new Set();            // Order letters read (indexes into ORDER_LETTERS)
    this.challengesDone = new Set();
    this.visited = new Set();            // site keys the players have set foot in
    this.chap = { spotted: false, innocent: false, hurt: false, alarm: false };   // what happened in this chapter
    this._lastXZ = new Map();
    this.letterItems = [];
    this.challengeAt = 0; this.letterAt = 0;
    this.hideSpots = [];
    for (const s of this.plan.sites) {
      for (const h of s.poi.hides || []) this.hideSpots.push(h);
      if (s.poi.tower) this.hideSpots.push(s.poi.tower.hay);
    }
    const ev = game.events;
    this.offs = [
      ev.on('shot', (e) => this._onShot(e)),
      ev.on('dryFire', (e) => this._outOfAmmo(e.character, e.cls)),
      ev.on('damage', (e) => this._onDamage(e)),
      ev.on('kill', (e) => this._onKill(e)),
      ev.on('guardAlert', (e) => this._onAlert(e)),
      ev.on('hayLanding', (e) => { if (e.character.isHuman) this.hayLandings.push({ at: game.time, x: e.x, y: e.y, z: e.z }); }),
      ev.on('parry', (e) => { if (e.character && e.character.isHuman) this.stats.parries++; }),
      ev.on('leap', (e) => { if (e.character && e.character.isHuman) this.stats.leaps++; }),
      ev.on('used', (e) => { if (e.character && e.character.isHuman && (e.item === 'bandage' || e.item === 'medkit' || e.item === 'shield_potion')) this.stats.consumed++; }),
    ];
  }

  // ================================================================== setup
  _choosePlaces() {
    const P = this.plan, d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const take = (from, list) => { list.sort((a, b) => d(a, from) - d(b, from)); return list.shift(); };
    const vs = P.villages.slice(), cs = P.camps.slice(), out = { hideout: P.hideout, keep: P.keep };
    out.V1 = take(P.hideout, vs); out.V2 = take(out.V1, vs); out.V3 = take(out.V2, vs); out.V4 = vs[0] || out.V1;
    out.C1 = take(out.V2, cs); out.C2 = take(out.V3, cs); out.C3 = cs[0] || out.C1;
    return out;
  }

  /** Is this character close enough to Ida's forge to have the gear upgraded? */
  nearForge(ch) {
    const k = this.shopkeeper;
    return !!(this.shop && k && k.alive && ch && ch.alive && Math.hypot(k.pos.x - ch.pos.x, k.pos.z - ch.pos.z) < 7);
  }

  /** Where players come back to life: a mission checkpoint, else the hideout bed. */
  respawnPoint() {
    const b = this.plan.hideout.poi.bed;
    return new THREE.Vector3(b.x, b.y + 0.01, b.z);
  }

  /** A player joins the story (local players at the start, online friends when they arrive). */
  addPlayer(ch, saved) {
    ch.isHuman = true;
    ch.team = 1;
    ch.look = 'order';
    if (ch.model) { ch.model.dispose(); ch.model = null; }
    ch.home = this.respawnPoint();
    if (saved && saved.length) { ch.inventory.slots = saved.map((s) => Story.migrateStack(s)); ch.inventory.touch(); }
    Gear.attach(ch);                     // the loadout's slot rules; saved items go where they belong
    if (!ch.inventory.count('wrist_blade')) {
      ch.inventory.clear();
      ch.inventory.set(0, makeStack('wrist_blade'));
      ch.selectedSlot = 0;
      this.giveKitFor(ch);
    }
    // every member of the Order carries a sword (older saves get theirs now)
    if (!ch.inventory.count('longsword')) this.giveTo(ch, [['longsword', 1]]);
  }

  /** A saved stack in today's items: the throwing knives became a bow and arrows; unknown items are dropped. */
  static migrateStack(s) {
    if (!s) return null;
    const c = cloneStack(s), MAP = { w_knives: 'w_bow', knife: 'arrow' };
    if (MAP[c.id]) c.id = MAP[c.id];
    return ITEMS[c.id] ? c : null;
  }

  /** What a (late-joining) player should carry for the chapters already done. */
  giveKitFor(ch) {
    this.giveTo(ch, [['longsword', 1]]);
    if (this.chapter >= 1) this.giveTo(ch, [['w_bow', 1], ['arrow', 12]]);
    if (this.chapter >= 2) this.giveTo(ch, [['w_smoke', 1], ['smoke_bomb', 3]]);
  }

  /** Players at the hideout, saved progress restored, the island's people where they live. */
  start(humans) {
    const saved = this.saveEnabled ? Story.loadSave(this.game.seed) : null;
    if (saved) this._restore(saved);
    if (!this.explored.length) { const h = this.plan.hideout; this.explored.push([h.x, h.z, 40]); }   // you know your own ground
    const p = this.respawnPoint();
    humans.forEach((h, i) => {
      this.addPlayer(h, i === 0 && saved ? saved.inv : null);
      h.teleport(p.x + i * 0.8, p.y, p.z);
      const m = this.plan.hideout.poi.mentor;
      h.yaw = Math.atan2(-(m.x - h.pos.x), -(m.z - h.pos.z));
    });
    this.populate();
    this._spawnLetters();
    if (this.shop) this._spawnShopkeeper();
    this._updatePosters();
    this.version++;
  }

  populate() {
    const g = this.game, P = this.plan;
    const guard = (site, o) => { const c = Npc.guard(g, site.key, o); this.people.push({ ch: c, kind: 'guard', site, o }); return c; };
    const villager = (site, o) => { const c = Npc.villager(g, site.key, o); this.people.push({ ch: c, kind: 'villager', site, o }); return c; };
    for (const v of P.villages) {
      const poi = v.poi;
      poi.posts.forEach((post) => guard(v, { pos: post }));
      guard(v, { pos: poi.patrol[0], route: poi.patrol });
      const spots = poi.spots.concat(poi.doors, poi.stalls.map((s) => s.front));
      for (const s of poi.stalls) {
        const yaw = Math.atan2(-(s.front.x - s.vendor.x), -(s.front.z - s.vendor.z));
        villager(v, { pos: Object.assign({}, s.vendor, { yaw }), vendor: true });
      }
      for (let i = 0; i < 6; i++) villager(v, { pos: spots[(i * 3) % spots.length], spots });
    }
    for (const c of P.camps) {
      const poi = c.poi;
      poi.posts.forEach((post) => guard(c, { pos: post, marksman: post.marksman }));
      guard(c, { pos: poi.patrol[0], route: poi.patrol });
      guard(c, { pos: poi.patrol[2], route: [poi.patrol[2], poi.patrol[1], poi.patrol[0], poi.patrol[3]] });
    }
    const k = P.keep, kp = k.poi;
    kp.posts.forEach((post) => guard(k, { pos: post, marksman: post.marksman }));
    if (!this.flags.sealed) {              // the forged order of chapter XVII calls the wall and courtyard patrols away for good
      for (const run of kp.walls) guard(k, { pos: run[0], route: run });
      guard(k, { pos: kp.patrol[0], route: kp.patrol });
      guard(k, { pos: kp.patrol[2], route: [kp.patrol[2], kp.patrol[3], kp.patrol[0], kp.patrol[1]] });
    }
    // the Order: Old Wren waits at the hideout
    const m = P.hideout.poi.mentor, e = P.hideout.poi.entrance;
    this.mentor = Npc.ally(g, { name: 'Old Wren', look: 'mentor', pos: Object.assign({}, m, { yaw: Math.atan2(-(e.x - m.x), -(e.z - m.z)) }), tag: 'mentor', health: 500 });
    this.mentor.invulnerable = true;
  }

  _spawnShopkeeper() {
    if (this.shopkeeper && this.shopkeeper.alive) return;
    const q = this.plan.hideout.poi.quartermaster, m = this.plan.hideout.poi.mentor;
    this.shopkeeper = Npc.ally(this.game, { name: 'Ida Marrow', look: 'smith', pos: Object.assign({}, q, { yaw: Math.atan2(-(m.x - q.x), -(m.z - q.z)) }), tag: 'shop', health: 500 });
    this.shopkeeper.invulnerable = true;
  }

  guardsOf(siteKey) { return this.game.characters().filter((c) => c.alive && c.npcRole === 'guard' && c.site === siteKey); }

  hideSpotsNear(p, r) { return this.hideSpots.filter((h) => Math.hypot(h.x - p.x, h.z - p.z) <= r && Math.abs(h.y - p.y) < 4); }

  // ================================================================== helpers for missions.js
  players() { return this.game.characters().filter((c) => c.isHuman); }
  fmt(t) {
    return String(t).replace(/\{(\w+)\}/g, (m, k) => (this.places[k] ? this.places[k].name : m));
  }
  /** Is any living player within r blocks (horizontally, and within dy vertically if given) of p? */
  near(p, r, dy) {
    return this.players().some((h) => h.alive && Math.hypot(h.pos.x - p.x, h.pos.z - p.z) <= r && (dy === undefined || Math.abs(h.pos.y - p.y) <= dy));
  }
  nearestPlayer(p) {
    let best = null;
    for (const h of this.players()) {
      if (!h.alive) continue;
      const d = Math.hypot(h.pos.x - p.x, h.pos.z - p.z);
      if (!best || d < best.d) best = { ch: h, d };
    }
    return best;
  }
  viewpointOf(site) { return this.plan.viewpoints.find((v) => v.site === site) || null; }
  isSynced(vp) { return !!vp && this.synced.has(vp.id); }
  landedInHayNear(p, since) { return this.hayLandings.some((l) => l.at >= since && Math.hypot(l.x - p.x, l.z - p.z) < 4); }
  /** Mission entities: cleared if the step they were made in is retried, or when the mission ends. */
  temp(M, e) { M.ents.push({ e, step: M.stepI }); return e; }
  keep(M, e) { return this.temp(M, e); }
  dropItem(id, p) {
    const d = new ItemDrop(makeStack(id), p.x, p.y + 0.3, p.z);
    d.persistent = true;
    d.pickupDelay = 0;
    return this.game.addEntity(d);
  }
  anyHas(id) { return this.players().some((h) => h.inventory.count(id) > 0); }
  holder(id) { return this.players().find((h) => h.inventory.count(id) > 0) || null; }
  takeItem(id) { for (const h of this.players()) if (h.inventory.count(id)) h.inventory.remove(id, h.inventory.count(id)); }
  anyCombat() {
    return this.game.characters().some((c) => c.alive && c.npcRole === 'guard' && c.controller.state === 'combat' && c.controller.target && c.controller.target.isHuman);
  }
  /**
   * How fast `npc` (someone being tailed) grows suspicious of the players it can see right now, per second.
   * Behind a wall or a tree, hidden in hay, or lost in a crowd you're safe; close and in plain view you're not.
   */
  suspicionRate(npc, range) {
    const eye = npc.eyePos(new THREE.Vector3()), t = new THREE.Vector3();
    let rate = 0;
    for (const p of this.players()) {
      if (!p.alive || p.hidden) continue;
      const d = p.pos.distanceTo(npc.pos);
      if (d < 2.2) { rate = Math.max(rate, 3); continue; }                         // walked right into him
      if (d > range || !Stealth.inCone(npc, p.pos, d)) continue;
      if (!Stealth.lineOfSight(this.game, eye, t.set(p.pos.x, p.pos.y + 1.2, p.pos.z)) &&
          !Stealth.lineOfSight(this.game, eye, t.set(p.pos.x, p.pos.y + 0.5, p.pos.z))) continue;
      let r = 1.0 * (1 - d / range) + 0.08;
      if (p.blending) r *= 0.12;
      if (p.sneaking) r *= 0.6;
      if (p.isHuman) r *= Gear.stealthMult(p);
      if (p.sprinting || p.climbing) r *= 1.6;
      rate = Math.max(rate, r);
    }
    return rate;
  }

  stackOf(id, n) {
    const it = ITEMS[id];
    return it && it.kind === 'weapon' ? makeWeapon(it.weapon.cls, 1) : makeStack(id, n);
  }
  giveTo(ch, list) {
    for (const [id, n] of list) {
      if (ITEMS[id].kind === 'weapon' && ch.inventory.count(id)) continue;           // one thrower is enough
      const left = ch.inventory.add(this.stackOf(id, n));
      if (left > 0) { const d = ItemDrop.pop(this.game, this.stackOf(id, left), ch.pos.x, ch.pos.y + 1, ch.pos.z); if (d) d.persistent = true; }
    }
  }
  giveAll(list) { for (const h of this.players()) this.giveTo(h, list); }
  giveFirst(list) { const n = this.players()[0]; if (n) this.giveTo(n, list); }
  setCageDoor(site, closed) {
    this.game.world.setBlocks(site.poi.cage.door.map(([x, y, z]) => [x, y, z, closed ? BLOCK.BARS : BLOCK.AIR]));
  }
  cageOpen(site) { const [x, y, z] = site.poi.cage.door[0]; return this.game.world.getBlock(x, y, z) !== BLOCK.BARS; }
  unlockShop() { this.shop = true; this.version++; this._spawnShopkeeper(); }
  /** The forged order (The Seal): the keep's patrols on the walls and in the courtyard march out and do not come back. */
  recallKeepPatrols() {
    this.flags.sealed = true;
    const gone = (rec) => rec.kind === 'guard' && rec.site.kind === 'keep' && !!rec.o.route;
    for (const rec of this.people) if (gone(rec)) { rec.ch.removed = true; }
    this.people = this.people.filter((rec) => !gone(rec));
    this.version++;
  }
  finish() {
    this.finished = true;
    this.version++;
    this.game.events.emit('storyTitle', { title: 'THE END', sub: 'Kestrel Isle is free. The notice boards still need you.', long: true });
  }

  /** Walking route from site A to site B along the roads (for NPCs). Ends at a camp's strongbox or a village square. */
  routeBetween(A, B) {
    const roads = this.plan.roads, prev = new Map([[A.id, null]]), q = [A.id];
    while (q.length) {
      const id = q.shift();
      if (id === B.id) break;
      for (const r of roads) {
        const o = r.a === id ? r.b : r.b === id ? r.a : null;
        if (o !== null && !prev.has(o)) { prev.set(o, id); q.push(o); }
      }
    }
    const seq = [];
    for (let id = B.id; id !== null && id !== undefined; id = prev.get(id)) seq.unshift(id);
    const centre = (s) => (s.kind === 'village' ? s.poi.spots[0] : s.kind === 'camp' ? s.poi.gates[0].in : s.kind === 'keep' ? s.poi.gate.in : s.poi.entrance);
    const pts = [];
    for (let i = 0; i + 1 < seq.length; i++) {
      const r = roads.find((rr) => (rr.a === seq[i] && rr.b === seq[i + 1]) || (rr.b === seq[i] && rr.a === seq[i + 1]));
      if (!r) continue;
      let rp = r.pts.map(([x, z, h]) => ({ x, y: h + 1, z }));
      if (r.a !== seq[i]) rp = rp.reverse();
      if (i > 0) pts.push(centre(this.plan.sites[seq[i]]));
      pts.push(...rp);
    }
    if (B.kind === 'camp') {
      // walk up to the nearest gate from outside, straight through the middle of it, then to the strongbox
      while (pts.length > 1 && Math.abs(pts[pts.length - 1].x - B.x) < 15 && Math.abs(pts[pts.length - 1].z - B.z) < 15) pts.pop();
      const end = pts[pts.length - 1] || B;
      const gate = B.poi.gates.slice().sort((a, b) => Math.hypot(a.out.x - end.x, a.out.z - end.z) - Math.hypot(b.out.x - end.x, b.out.z - end.z))[0];
      pts.push(gate.out, gate.in, B.poi.strongbox);
    } else pts.push(centre(B));
    return pts;
  }

  // ================================================================== dialogue
  lines(list) {
    for (const [who, text] of list) this.lineQueue.push({ who, text: this.fmt(text) });
  }
  talking() { return this.lineQueue.length > 0 || this.game.time < this.lineUntil; }
  _dialogue() {
    const g = this.game;
    if (g.time < this.lineUntil || !this.lineQueue.length) return;
    const l = this.lineQueue.shift();
    const dur = Math.min(7, 2.2 + l.text.length * 0.045);
    this.lineUntil = g.time + dur;
    g.events.emit('storyLine', { who: l.who, text: l.text, dur });
  }

  // ================================================================== activities (chapters, contracts)
  nextChapter() { return this.finished ? null : STORY_CHAPTERS[this.chapter] || null; }

  startChapter() {
    const def = this.nextChapter();
    if (!def || this.activity) return;
    this.chap = { spotted: false, innocent: false, hurt: false, alarm: false };
    this._startActivity(def, 'chapter');
    this.game.events.emit('storyTitle', { title: 'CHAPTER ' + ROMAN[this.chapter] + ' - ' + def.title.toUpperCase(), sub: '' });
  }

  _startActivity(def, kind, extra) {
    this.activity = Object.assign({ def, kind, M: { ents: [], stepI: -1, stepStart: 0 }, stepI: -1, failing: null }, extra || {});
    if (def.intro) this.lines(def.intro);
    this._enterStep(0);
  }

  _enterStep(i) {
    const A = this.activity, M = A.M, step = A.def.steps[i], g = this.game;
    A.stepI = i; M.stepI = i; M.stepStart = g.time; M.talked = null;
    if (step.lines) this.lines(step.lines);
    if (step.setup) step.setup(this, M);
    const cp = step.checkpoint ? step.checkpoint(this, M) : null;
    for (const h of this.players()) h.home = cp ? new THREE.Vector3(cp.x, cp.y + 0.01, cp.z) : this.respawnPoint();
    this.version++;
  }

  _runActivity() {
    const A = this.activity;
    if (!A) return;
    const g = this.game, M = A.M, step = A.def.steps[A.stepI];
    if (A.failing) {
      if (g.time >= A.failing.at) this._retry(A.failing.from);
      return;
    }
    const humans = this.players();
    let reason = humans.length && humans.every((h) => !h.alive) ? 'You died.' : null;
    if (!reason && step.fail) reason = step.fail(this, M);
    if (reason) {
      A.failing = { at: g.time + 2.8, from: step.retry !== undefined ? step.retry : A.stepI, reason };
      g.events.emit('desync', { reason });
      return;
    }
    if (step.check(this, M)) {
      if (step.done) step.done(this, M);
      if (A.stepI + 1 < A.def.steps.length) this._enterStep(A.stepI + 1);
      else this._complete();
    }
  }

  /** Back to the start of step `from`: its people respawned, guards calmed, players at the checkpoint. */
  _retry(from) {
    const A = this.activity, M = A.M, g = this.game;
    A.failing = null;
    for (const r of M.ents.filter((x) => x.step >= from)) r.e.removed = true;
    if (M.uses) M.uses = M.uses.filter((u) => u.step < from);
    M.ents = M.ents.filter((x) => x.step < from);
    for (const c of g.characters()) {
      if (c.npcRole !== 'guard' || !c.alive) continue;
      const k = c.controller;
      k.state = k.homeState; k.target = null; k.focus = null; k.aware.clear();
      if (k.post) c.teleport(k.post.x, k.post.y + 0.01, k.post.z);
    }
    this.alarms.clear();
    const step = A.def.steps[from];
    const cp = step.checkpoint ? step.checkpoint(this, M) : (A.def.steps[A.stepI].checkpoint ? A.def.steps[A.stepI].checkpoint(this, M) : null);
    for (const h of this.players()) {
      if (!h.alive) h.revive();
      h.health = Math.max(h.health, CONFIG.HEALTH.MAX);
      if (cp) h.teleport(cp.x + (Math.random() - 0.5), cp.y + 0.01, cp.z + (Math.random() - 0.5));
    }
    g.events.emit('storyTitle', { title: 'RETRY', sub: '' });
    this._enterStep(from);
  }

  _complete() {
    const A = this.activity, g = this.game;
    this.activity = null;
    if (A.def.outro) this.lines(A.def.outro);
    for (const r of A.M.ents) if (r.e.alive && !r.e.removed) this.leftovers.push(r.e);
    for (const h of this.players()) h.home = this.respawnPoint();
    if (A.kind === 'chapter') {
      this.chapter++;
      const night = Stealth.isNight(g);
      if (!this.chap.spotted) this.stats.chapterClean++;
      if (!this.chap.innocent) this.stats.chapterCleanHands++;
      if (!this.chap.hurt) this.stats.chapterUnhurt++;
      if (night) this.stats.nightChapters++;
      g.events.emit('storyTitle', { title: 'CHAPTER COMPLETE', sub: A.def.title });
      if (A.def.reward) A.def.reward(this, A.M);
      this.notoriety = 0;                                  // the Order lies low after every chapter
    } else {
      this.contractsDone++;
      this.stats.contracts++;
      this.addSilver(A.def.reward);
      g.events.emit('storyTitle', { title: 'CONTRACT COMPLETE', sub: '+' + A.def.reward + ' silver' });
      if (A.board) this.offers.delete(A.board);
    }
    this.version++;
    this.save();
  }

  /** Give up the running contract (chapters can't be abandoned). */
  abandon() {
    const A = this.activity;
    if (!A || A.kind !== 'contract') return;
    for (const r of A.M.ents) r.e.removed = true;
    this.activity = null;
    for (const h of this.players()) h.home = this.respawnPoint();
    this.version++;
  }

  // ================================================================== contracts and the shop
  offersAt(siteKey) {
    let o = this.offers.get(siteKey);
    if (!o) {
      const site = this.plan.byKey(siteKey);
      o = Contracts.offers(this, site, this.rng);
      this.offers.set(siteKey, o);
    }
    return o;
  }

  /** A player picked contract `i` on the board at `siteKey`. */
  acceptContract(ch, siteKey, i) {
    if (this.activity) { this.game.events.emit('storyMessage', { text: 'Finish what you started first.', kind: 'warn', character: ch }); return false; }
    const o = this.offersAt(siteKey)[i];
    if (!o) return false;
    this._startActivity(o, 'contract', { board: siteKey });
    this.game.events.emit('storyTitle', { title: o.title.toUpperCase(), sub: o.desc });
    return true;
  }

  buy(ch, id) {
    const item = CONFIG.STORY.SHOP.find((s) => s.id === id);
    if (!item || !this.shop) return false;
    const owned = item.give.find(([id]) => ITEMS[id] && ITEMS[id].kind === 'weapon' && ch.inventory.count(id));
    if (owned) { this.game.events.emit('storyMessage', { text: 'You already carry a ' + ITEMS[owned[0]].name + '.', kind: 'warn', character: ch }); return false; }
    if (item.give.some(([id, n]) => ch.inventory.spaceFor(this.stackOf(id, n)) < n)) { this.game.events.emit('storyMessage', { text: 'No room in your pack.', kind: 'warn', character: ch }); return false; }
    if (this.silver < item.price) { this.game.events.emit('storyMessage', { text: 'Not enough silver.', kind: 'warn', character: ch }); return false; }
    this.addSilver(-item.price);
    this.giveTo(ch, item.give);
    this.stats.purchases++;
    this.game.events.emit('storyMessage', { text: 'Bought: ' + item.name, character: ch });
    this.save();
    return true;
  }

  /** Fast travel to a synchronized viewpoint (not while anyone is hunting you, or in the middle of a fail). */
  travel(ch, vpId) {
    const vp = this.plan.viewpoints[vpId];
    if (!vp || !this.synced.has(vp.id) || !ch.alive) return false;
    if (this.anyCombat()) { this.game.events.emit('storyMessage', { text: 'You can\'t travel while you\'re being hunted.', kind: 'warn', character: ch }); return false; }
    ch.teleport(vp.base.x, vp.base.y + 0.01, vp.base.z);
    this.stats.travels++;
    this.game.events.emit('travel', { character: ch, vp: vp.id });
    return true;
  }

  /** A choice made on a story screen (map, board, shop), locally or by an online player. */
  act(ch, a) {
    if (!a || !ch) return false;
    if (a.a === 'travel') return this.travel(ch, a.vp | 0);
    if (a.a === 'accept') return this.acceptContract(ch, String(a.site), a.i | 0);
    if (a.a === 'abandon') { this.abandon(); return true; }
    if (a.a === 'buy') return this.buy(ch, String(a.id));
    if (a.a === 'gear') {
      const r = Gear.act(this, ch, String(a.g), a.i | 0, a.j | 0);
      if (r.msg) this.game.events.emit('storyMessage', { text: r.msg, kind: r.ok ? undefined : 'warn', character: ch });
      if (r.ok) this.save();
      return r.ok;
    }
    return false;
  }

  // ================================================================== interaction (E)
  /** What E would do for this character right now: { kind, text, target } or null. */
  interactTarget(ch) {
    if (!ch.alive || ch.vehicle) return null;
    const g = this.game, A = this.activity, step = A && !A.failing ? A.def.steps[A.stepI] : null;
    const close = (p, r, dy = 2) => Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) <= r && Math.abs(p.y - ch.pos.y) <= dy;
    if (step && step.talk) {
      const n = step.talk(this, A.M);
      if (n && n.alive && close(n.pos, 3.2)) return { kind: 'talk', text: 'Talk to ' + n.name, target: n };
    }
    if (A && !A.failing && A.M.uses) {
      for (const u of A.M.uses) if (!u.done && u.step === A.stepI && close(u.at, 2.4)) return { kind: 'use', text: u.text, target: u };
    }
    if (!A && this.mentor && close(this.mentor.pos, 3.2)) {
      const next = this.nextChapter();
      return { kind: 'talk', text: next ? 'Talk to Old Wren - Chapter ' + ROMAN[this.chapter] + ': ' + next.title : 'Talk to Old Wren', target: this.mentor };
    }
    if (this.shop && this.shopkeeper && close(this.shopkeeper.pos, 3.2)) return { kind: 'shop', text: 'Trade with Ida', target: this.shopkeeper };
    if (step && step.cage) {
      const site = step.cage(this, A.M);
      if (site && !this.cageOpen(site) && close(site.poi.cage.front, 2.4)) return { kind: 'cage', text: 'Pick the lock', target: site };
    }
    for (const vp of this.plan.viewpoints) {
      if (this.synced.has(vp.id)) continue;
      if (close(vp.top, 3, 1.6) || close(vp.perch, 1.6, 1.6)) return { kind: 'sync', text: 'Synchronize', target: vp };
    }
    for (const s of this.plan.sites) {
      const b = s.poi.board;
      if (b && close(b, 2.8)) return { kind: 'board', text: 'Read the notice board', target: s };
      const a = s.poi.armory;
      if (a && close(a, 2.4)) {
        const wait = this.crateWait(s, ch), name = s.kind === 'hideout' ? 'Supply chest' : 'Arms crate';
        return { kind: 'resupply', text: wait > 0 ? name + ' - empty, restocked in ' + Math.ceil(wait) + 's' : name + ': restock arrows, smoke bombs and rounds', target: s };
      }
    }
    for (const p of this.posters) if (!p.removed && close(p.pos, 2.2, 3)) return { kind: 'poster', text: 'Tear down the wanted poster', target: p };
    return null;
  }

  claimsInteract(ch) { return !!(ch.isHuman && this.interactTarget(ch)); }

  _interactions() {
    const g = this.game;
    for (const h of this.players()) {
      const act = this.actions.get(h.id);
      if (act) {
        const moved = Math.hypot(h.pos.x - act.from.x, h.pos.z - act.from.z) > 1.5;
        if (!h.alive || moved || h.lastDamageTime > act.start) {
          this.actions.delete(h.id);
          g.events.emit('storyAction', { character: h, kind: act.kind, done: false });
        } else if (g.time >= act.until) {
          this.actions.delete(h.id);
          this._finishAction(h, act);
        }
        this.prompts.set(h.id, null);
        continue;
      }
      const t = this.interactTarget(h);
      this.prompts.set(h.id, t);
      if (t && h.intent && h.intent.interact) this._interact(h, t);
    }
  }

  _interact(h, t) {
    const g = this.game, A = this.activity;
    if (t.kind === 'talk') {
      if (A) A.M.talked = t.target;
      else if (t.target === this.mentor) {
        if (this.nextChapter()) this.startChapter();
        else this.lines([['Old Wren', this.finished ? 'Rest when you can. The boards always have work.' : 'Come back when you are ready.']]);
      }
    } else if (t.kind === 'shop') {
      g.events.emit('storyScreen', { character: h, screen: 'shop' });
    } else if (t.kind === 'board') {
      const offers = this.offersAt(t.target.key).map((o) => ({ title: o.title, desc: o.desc, reward: o.reward }));
      const busy = A ? (A.kind === 'chapter' ? 'Chapter ' + ROMAN[this.chapter] + ': ' + A.def.title : A.def.title) : null;
      g.events.emit('storyScreen', { character: h, screen: 'board', site: t.target.key, offers, busy, contract: !!A && A.kind === 'contract' });
    } else if (t.kind === 'resupply') {
      this.resupply(h, t.target);
    } else if (t.kind === 'poster') {
      t.target.removed = true;
      this.posters = this.posters.filter((p) => p !== t.target);
      this.posterBack = g.time + 150;
      this.stats.posters++;
      this.addNotoriety(-1);
      g.events.emit('storyMessage', { text: 'Poster torn down. Notoriety falls.', character: h });
    } else {
      const time = t.kind === 'sync' ? 1.6 : t.kind === 'use' ? (t.target.time || 2.2) : 2.2;
      this.actions.set(h.id, { kind: t.kind, target: t.target, from: h.pos.clone(), start: g.time, until: g.time + time, total: time });
      g.events.emit('storyAction', { character: h, kind: t.kind, total: time });
    }
  }

  _finishAction(h, act) {
    const g = this.game;
    if (act.kind === 'sync') {
      const vp = act.target;
      this.synced.add(vp.id);
      this.explored.push([Math.round(vp.top.x), Math.round(vp.top.z), 95]);
      this.version++;
      g.events.emit('synced', { character: h, vp: vp.id });
      g.events.emit('storyTitle', { title: 'VIEWPOINT SYNCHRONIZED', sub: vp.name });
      this.save();
    } else if (act.kind === 'use') {
      const u = act.target;
      if (!u.done) { u.done = true; u.run(this, u.M, h); }
    } else if (act.kind === 'cage') {
      this.setCageDoor(act.target, false);
      g.events.emit('cageOpened', { character: h, site: act.target.key });
    }
    g.events.emit('storyAction', { character: h, kind: act.kind, done: true });
  }

  /** Seconds until this site's arms crate has something for this player again (0 = ready). */
  crateWait(site, ch) {
    const A = CONFIG.STORY.ARMORY, used = this.crates && this.crates.get(site.key + ':' + ch.id);
    return used === undefined ? 0 : Math.max(0, used + (site.kind === 'hideout' ? A.HOME_RESTOCK : A.RESTOCK) - this.game.time);
  }

  /** Top up what the player carries from an enemy arms crate. */
  resupply(ch, site) {
    const A = CONFIG.STORY.ARMORY, g = this.game, inv = ch.inventory, got = [];
    if (this.crateWait(site, ch) > 0) return;
    const topUp = (item, to, label) => {
      const n = Math.max(0, to - inv.count(item));
      if (n > 0) { this.giveTo(ch, [[item, n]]); got.push('+' + n + ' ' + label); }
    };
    if (inv.count('w_bow')) topUp('arrow', A.ARROWS, 'arrows');
    if (inv.count('w_smoke')) topUp('smoke_bomb', A.SMOKE, 'smoke bombs');
    if (inv.count('w_pistol')) topUp('ammo_light', inv.count('ammo_light') + A.ROUNDS, 'rounds');
    if (inv.count('w_musket')) topUp('ammo_heavy', inv.count('ammo_heavy') + 10, 'musket balls');
    if (!got.length) {
      g.events.emit('storyMessage', { text: inv.count('w_bow') || inv.count('w_smoke') ? 'You are already fully stocked.' : 'Nothing in here you can use yet.', character: ch });
      return;
    }
    (this.crates || (this.crates = new Map())).set(site.key + ':' + ch.id, g.time);
    g.events.emit('resupplied', { character: ch, site: site.key });
    g.events.emit('storyMessage', { text: 'Restocked: ' + got.join(', '), character: ch });
  }

  // ================================================================== alarms, notoriety, silver
  alarmUntil(siteKey) { return this.alarms.get(siteKey) || 0; }

  raiseAlarm(siteKey, pos, by) {
    if (!siteKey) return;
    const g = this.game;
    this.alarms.set(siteKey, g.time + CONFIG.STORY.AWARE.ALARM_TIME);
    this.chap.alarm = true;
    for (const c of this.guardsOf(siteKey)) {
      if (c === by || c.controller.state === 'combat') continue;
      const a = g.rng.next() * Math.PI * 2, r = 2 + g.rng.next() * 6;
      c.controller.startSearch(g, c, new THREE.Vector3(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r), CONFIG.STORY.AWARE.ALARM_TIME * 0.7);
    }
    g.events.emit('alarm', { site: siteKey, x: pos.x, y: pos.y, z: pos.z });
  }

  addNotoriety(n) {
    const before = this.notoriety;
    this.notoriety = Math.max(0, Math.min(3, this.notoriety + n));
    this.stats.notorietyMax = Math.max(this.stats.notorietyMax, this.notoriety);
    if (this.notoriety !== before) {
      this.version++;
      this.game.events.emit('notoriety', { level: this.notoriety, delta: n });
      this._updatePosters();
    }
  }

  addSilver(n) {
    this.silver = Math.max(0, this.silver + n);
    this.version++;
    this.game.events.emit('silver', { amount: this.silver, delta: n });
  }

  /** Wanted posters: two per notoriety level, on village walls. */
  _updatePosters() {
    const g = this.game, want = this.game.time < (this.posterBack || 0) ? Math.ceil(this.notoriety) * 2 - 1 : Math.ceil(this.notoriety) * 2;
    const spots = [];
    for (const v of this.plan.villages) for (const p of v.poi.posters) spots.push(p);
    while (this.posters.length > Math.max(0, want)) this.posters.pop().removed = true;
    for (let i = 0; this.posters.length < want && i < spots.length; i++) {
      const s = spots[(i * 5 + this.posters.length * 3) % spots.length];
      if (this.posters.some((p) => Math.abs(p.pos.x - s.x) < 0.1 && Math.abs(p.pos.z - s.z) < 0.1)) continue;
      this.posters.push(g.addEntity(new Poster(s.x, s.y, s.z, s.nx, s.nz)));
    }
  }

  /** Out of arrows / smoke: say where to get more (once in a while). */
  _outOfAmmo(ch, cls) {
    if (!ch || !ch.isHuman || (cls !== 'bow' && cls !== 'smoke')) return;
    const g = this.game;
    if (g.time < (ch.ammoHintAt || -99) + 15) return;
    ch.ammoHintAt = g.time;
    const what = cls === 'bow' ? 'arrows' : 'smoke bombs';
    g.events.emit('storyMessage', { character: ch, kind: 'warn',
      text: 'Out of ' + what + '. Restock at the supply chest in the hideout or an enemy arms crate (follow the crate marker)' + (cls === 'bow' ? ', or pick your arrows back up.' : '.') });
  }

  _onShot(e) {
    const st = CONFIG.WEAPONS[e.cls];
    if (e.character) e.character.lastShotAt = this.game.time;
    if (e.cls === 'smoke' && e.character && e.character.isHuman) this.stats.smokeThrown++;
    if (!st || st.silent || !e.character || e.character.npcRole === 'guard') return;
    Stealth.noise(this.game, e.origin, CONFIG.STORY.AWARE.NOISE_RANGE, e.character);
    for (const c of this.game.characters()) {
      if (c.alive && c.npcRole === 'villager' && !c.dormant && c.pos.distanceTo(e.origin) < 24 && c.controller.scare) c.controller.scare(this.game, c, e.origin);
    }
  }

  _onDamage(e) {
    const t = e.target, a = e.attacker;
    if (t && t.invulnerable) { t.health = Math.max(t.health, 1); return; }
    if (t && t.isHuman && e.amount > 0) this.chap.hurt = true;
    if (!a || !a.isHuman || !t || !t.npc) return;
    Stealth.witness(this.game, a, t);
    if (t.npcRole === 'guard' && t.health > 0 && e.kind !== 'assassination') t.controller.callTo(this.game, t, a, a.pos.clone(), true);
  }

  _onKill(e) {
    const v = e.victim, k = e.killer;
    if (k && k.isHuman) {
      this.stats.kills++;
      if (e.kind === 'assassination') this.stats.silent++;
      if (e.cls === 'bow') this.stats.arrows++;
    }
    if (v && v.isHuman) { this.chap.hurt = true; this.stats.deaths++; }
    if (v.npcRole === 'villager' && !v.tag && k && k.isHuman) {
      this.chap.innocent = true;
      this.addNotoriety(1);
      if (this.silver > 0) this.addSilver(-Math.min(this.silver, 20));
      this.game.events.emit('storyMessage', { text: 'An innocent fell. The Order does not kill the people it protects.', kind: 'warn' });
    }
  }

  _onAlert(e) {
    if (!e.target || !e.target.isHuman) return;
    this.chap.spotted = true;
    const site = e.character.site || 'road', g = this.game;
    if (g.time - (this.lastFight.get(site) || -999) > 25) { this.lastFight.set(site, g.time); this.addNotoriety(0.35); }
  }

  // ================================================================== per tick
  tick(dt) {
    const g = this.game;
    if (g.time >= this.wakeAt) { this.wakeAt = g.time + 0.5; this._wake(); }
    if (g.time >= this.upkeepAt) { this.upkeepAt = g.time + 5; this._upkeep(); }
    if (g.time >= this.fogAt) { this.fogAt = g.time + 1; this._explore(); }
    if (g.time >= this.challengeAt) { this.challengeAt = g.time + 1; this._checkChallenges(); }
    if (g.time >= this.letterAt) { this.letterAt = g.time + 0.5; this._collectLetters(); }
    if (g.tickCount % 15 === 0) this._blending();
    this._interactions();
    this._dialogue();
    if (g.time >= this.runAt) { this.runAt = g.time + 0.1; this._runActivity(); }
  }

  _wake() {
    const g = this.game, R2 = CONFIG.STORY.NPC_ACTIVE ** 2;
    const humans = this.players();
    for (const c of g.characters()) {
      if (!c.npc) continue;
      const k = c.controller;
      const busy = k && (k.state === 'combat' || k.state === 'search' || k.mode === 'follow' || (k.mode === 'route' && !k.done));
      const near = humans.some((h) => h.pos.distanceToSquared(c.pos) < R2);
      const dormant = !near && !busy && c.alive;
      if (dormant && !c.dormant) c.vel.set(0, 0, 0);
      c.dormant = dormant;
    }
  }

  _blending() {
    const g = this.game, R = CONFIG.STORY.BLEND_RANGE;
    for (const h of this.players()) {
      let n = 0;
      if (h.alive && !h.sprinting && !h.climbing && h.onGround) {
        for (const c of g.characters()) if (c.npcRole === 'villager' && c.alive && !c.tag && c.pos.distanceTo(h.pos) < R && ++n >= 2) break;
      }
      h.blending = n >= 2;
    }
  }

  /** Reveal the map around players as they explore. */
  _explore() {
    this._track();
    for (const h of this.players()) {
      if (!h.alive) continue;
      const x = Math.round(h.pos.x), z = Math.round(h.pos.z);
      if (this.explored.some(([ex, ez, r]) => Math.hypot(ex - x, ez - z) < r - 14)) continue;
      this.explored.push([x, z, 32]);
      this.version++;
    }
  }

  _upkeep() {
    const g = this.game, G = CONFIG.STORY.GUARD;
    const humans = this.players();
    const unseen = (p, r) => !humans.some((h) => h.pos.distanceTo(p) < r);
    for (const c of Array.from(g.characters())) {
      if (!c.npc || c.alive || !c.corpse || this._inActivity(c)) continue;
      if (g.time - c.corpseAt > 90 && unseen(c.pos, 45)) c.removed = true;
    }
    this.leftovers = this.leftovers.filter((e) => { if (e.removed) return false; if (unseen(e.pos, 50)) { e.removed = true; return false; } return true; });
    for (const rec of this.people) {
      const c = rec.ch;
      if (c.alive || g.time - (c.stats.deathTime || 0) < (rec.kind === 'guard' ? G.RESPAWN : G.RESPAWN * 1.5)) continue;
      if (!unseen(rec.o.pos, 60)) continue;
      c.removed = true;
      rec.ch = rec.kind === 'guard' ? Npc.guard(g, rec.site.key, rec.o) : Npc.villager(g, rec.site.key, rec.o);
    }
    if (this.posterBack && g.time > this.posterBack) { this.posterBack = 0; this._updatePosters(); }
    if (g.time - (this.savedAt || 0) > 30) { this.savedAt = g.time; this.save(); }
    // keep the hay landings list short
    this.hayLandings = this.hayLandings.filter((l) => g.time - l.at < 60);
  }

  _inActivity(c) { return !!(this.activity && this.activity.M.ents.some((r) => r.e === c)); }

  // ================================================================== HUD interface (shared with StoryMirror)
  promptFor(ch) { return this.prompts.get(ch.id) || null; }
  actionFor(ch) { return this.actions.get(ch.id) || null; }
  awarenessOf(guard, ch) { return guard.controller && guard.controller.awareOf ? guard.controller.awareOf(ch) : 0; }
  hunting(guard, ch) { const k = guard.controller; return !!k && k.state === 'combat' && k.target === ch; }
  isSyncedId(id) { return this.synced.has(id); }

  // ================================================================== objective + online state
  /** What the HUD shows: { title, text, hint, marker: {x,y,z} | Character, timer } or null. */
  objective() {
    const A = this.activity;
    if (A) {
      const step = A.def.steps[A.stepI];
      const title = A.kind === 'chapter' ? 'Chapter ' + ROMAN[this.chapter] + ': ' + A.def.title : A.def.title;
      if (A.failing) return { title, text: 'Desynchronized: ' + A.failing.reason, hint: '', marker: null, failing: true };
      return {
        title, text: this.fmt(typeof step.text === 'function' ? step.text(this, A.M) : step.text), hint: step.hint ? this.fmt(step.hint) : '',
        marker: step.marker ? step.marker(this, A.M) : null, timer: step.timer ? Math.max(0, step.timer(this, A.M)) : null,
      };
    }
    const next = this.nextChapter();
    if (next) return { title: 'Chapter ' + ROMAN[this.chapter] + ': ' + next.title, text: 'Talk to Old Wren at the hideout', hint: '', marker: this.mentor };
    return { title: 'Free roam', text: 'Take contracts from the notice boards', hint: '', marker: null };
  }

  /** Shared story state for online clients (sent whenever version changes). */
  sharedState() {
    const o = this.objective();
    const mk = o && o.marker ? (o.marker.isVector3 || o.marker.type !== 'character' ? { p: [r2(o.marker.x), r2(o.marker.y), r2(o.marker.z)] } : { e: o.marker.id }) : null;
    return {
      v: this.version, ch: this.chapter, fin: this.finished ? 1 : 0, sil: this.silver, not: r2(this.notoriety), shop: this.shop ? 1 : 0,
      vps: Array.from(this.synced), fog: this.explored, act: this.activity ? this.activity.kind : 0,
      obj: o ? { t: o.title, x: o.text, h: o.hint, f: o.failing ? 1 : 0, m: mk, tm: o.timer !== null && o.timer !== undefined ? r2(o.timer) : null } : null,
      // the journal (J) and the gear screen read these on a client too
      jr: { s: this._statsOut(), f: this.flags, l: Array.from(this.letters), c: Array.from(this.challengesDone), vi: Array.from(this.visited) },
    };
  }

  _statsOut() {
    const o = {};
    for (const k of Object.keys(this.stats)) o[k] = Math.round(this.stats[k]);
    return o;
  }

  // ================================================================== uses, letters, challenges
  /** A thing to press E on for `u.time` seconds (see missions-extra.js). Cleared with its step on retry. */
  addUse(M, u) {
    u.M = M; u.step = M.stepI; u.done = false;
    (M.uses || (M.uses = [])).push(u);
    return u;
  }

  /** Where the nearest unfinished use of this mission is (for the objective marker), or null. */
  nearestUse(M) {
    const left = (M.uses || []).filter((u) => !u.done && u.step === M.stepI);
    if (!left.length) return null;
    const p = this.nearestPlayer(left[0].at);
    const from = p ? p.ch.pos : left[0].at;
    left.sort((a, b) => Math.hypot(a.at.x - from.x, a.at.z - from.z) - Math.hypot(b.at.x - from.x, b.at.z - from.z));
    return left[0].at;
  }

  /** How many of an item all the players carry together (quest items are shared). */
  totalCount(id) { return this.players().reduce((n, h) => n + h.inventory.count(id), 0); }

  /** Was there an alarm anywhere during this chapter (for the 'unseen' flags)? */
  chapterAlarmed() { return !!this.chap.alarm; }

  /** A bell rings: the village wakes (villagers near the tower run) and the mission notes it. */
  ringBell(M, key) {
    const site = this.places[key], g = this.game, t = site.poi.tower.top, top = new THREE.Vector3(t.x, t.y, t.z);    // scare() keeps what it is given: a Vector3
    M.rung = M.rung || new Set();
    M.rung.add(key);
    for (const c of g.characters()) {
      if (c.npcRole === 'villager' && c.alive && c.controller && c.controller.scare && c.pos.distanceTo(top) < 40) c.controller.scare(g, c, top);
    }
    g.events.emit('storyMessage', { text: 'The bell in ' + site.name + ' rings out across the island.' });
    this.version++;
  }

  /** The twelve Order letters that are still lying about: each is a pickup that is read on collection. */
  _spawnLetters() {
    this.letterItems = [];
    ORDER_LETTERS.forEach((L, i) => {
      if (this.letters.has(i)) return;
      const p = letterSpot(this, L.at);
      if (!p) return;
      const d = new ItemDrop({ id: 'order_letter', count: 1, data: { letter: i } }, p.x, p.y + 0.3, p.z);
      d.persistent = true; d.pickupDelay = 0;
      this.game.addEntity(d);
      this.letterItems.push(d);
    });
  }

  /** Letters picked up are read at once: the letter is taken from the pack and counted. */
  _collectLetters() {
    for (const h of this.players()) {
      const inv = h.inventory;
      for (let i = 0; i < inv.size; i++) {
        const s = inv.get(i);
        if (!s || s.id !== 'order_letter') continue;
        inv.set(i, null);
        const n = s.data ? s.data.letter : -1;
        if (n < 0 || this.letters.has(n)) continue;
        this.letters.add(n);
        this.stats.letters = this.letters.size;
        this.version++;
        this.game.events.emit('storyMessage', { text: '(' + this.letters.size + '/' + ORDER_LETTERS.length + ') ' + ORDER_LETTERS[n].text, character: h });
        this.save();
      }
    }
  }

  /** Distance walked and sites visited, sampled once a second (teleports are not distance). */
  _track() {
    for (const h of this.players()) {
      if (!h.alive) { this._lastXZ.delete(h.id); continue; }
      const prev = this._lastXZ.get(h.id);
      if (prev) { const d = Math.hypot(h.pos.x - prev.x, h.pos.z - prev.z); if (d < 20) this.stats.distance += d; }
      this._lastXZ.set(h.id, { x: h.pos.x, z: h.pos.z });
      for (const s of this.plan.sites) if (!this.visited.has(s.key) && Math.hypot(s.x - h.pos.x, s.z - h.pos.z) < 28) { this.visited.add(s.key); this.version++; }
    }
  }

  /** Every challenge that is now met is completed: its silver and gear go to the players. */
  _checkChallenges() {
    for (const def of STORY_CHALLENGES) {
      if (this.challengesDone.has(def.id)) continue;
      let ok = false;
      try { ok = !!def.check(this); } catch (e) { ok = false; }
      if (ok) this._completeChallenge(def);
    }
  }

  _completeChallenge(def) {
    this.challengesDone.add(def.id);
    const r = def.reward, bits = [];
    if (r.silver) { this.addSilver(r.silver); bits.push('+' + r.silver + ' silver'); }
    if (r.gear) { this.giveAll(r.gear.map((id) => [id, 1])); bits.push(r.gear.map((id) => CONFIG.STORY.GEAR.PIECES[id].name).join(', ')); }
    this.game.events.emit('storyTitle', { title: 'CHALLENGE: ' + def.title.toUpperCase(), sub: def.text + (bits.length ? '  ' + bits.join('  ') : '') });
    this.version++;
    this.save();
  }

  // ================================================================== saving
  save() {
    if (!this.saveEnabled) return;
    const p = this.game.player;
    const data = {
      v: 3, seed: this.game.seed, chapter: this.chapter, finished: this.finished, shop: this.shop, silver: this.silver,
      synced: Array.from(this.synced), explored: this.explored, contracts: this.contractsDone,
      inv: p ? p.inventory.serialize() : null,
      stats: this.stats, flags: this.flags, letters: Array.from(this.letters), crates: Array.from(this.crates || []).map(([k, t]) => [k, t - this.game.time]), challenges: Array.from(this.challengesDone), visited: Array.from(this.visited),
    };
    try { localStorage.setItem(STORY_SAVE_KEY, JSON.stringify(data)); } catch (e) { /* storage full / blocked */ }
  }

  _restore(d) {
    this.chapter = Story.chapterOfSave(d);
    if (d.stats) for (const k of Object.keys(this.stats)) if (typeof d.stats[k] === 'number') this.stats[k] = d.stats[k];
    if (d.flags) this.flags = Object.assign({}, d.flags);
    this.letters = new Set((d.letters || []).filter((i) => i >= 0 && i < ORDER_LETTERS.length));
    this.challengesDone = new Set((d.challenges || []).filter((id) => STORY_CHALLENGES.some((c) => c.id === id)));
    this.visited = new Set(d.visited || []);
    if (Array.isArray(d.crates)) this.crates = new Map(d.crates.filter((c) => Array.isArray(c) && typeof c[1] === 'number').map(([k, dt]) => [String(k), this.game.time + dt]));
    this.finished = !!d.finished;
    this.shop = !!d.shop;
    this.silver = d.silver | 0;
    this.contractsDone = d.contracts | 0;
    this.synced = new Set((d.synced || []).filter((i) => this.plan.viewpoints[i]));
    this.explored = Array.isArray(d.explored) ? d.explored.slice(0, 2000) : [];
  }

  /**
   * The next chapter of a saved story, in today's list of eighteen. A version 1 save counted five chapters, a version 2 save nine:
   * its next chapter becomes the first one after the last it had played, so the new chapters in between are not skipped.
   */
  static chapterOfSave(d) {
    let n = d.chapter | 0;
    if (d.v === 1) n = STORY_CHAPTER_MAP_V1[Math.max(0, Math.min(STORY_CHAPTER_MAP_V1.length - 1, n))];
    if (d.v === 1 || d.v === 2) {
      n = Math.max(0, Math.min(STORY_V2_PLACES.length, n));
      return n <= 0 ? 0 : n >= STORY_V2_PLACES.length ? STORY_CHAPTERS.length : STORY_V2_PLACES[n - 1] + 1;
    }
    return Math.max(0, Math.min(STORY_CHAPTERS.length, n));
  }

  static loadSave(seed) {
    try {
      const d = JSON.parse(localStorage.getItem(STORY_SAVE_KEY) || 'null');
      return d && (d.v === 1 || d.v === 2 || d.v === 3) && d.seed === seed ? d : null;
    } catch (e) { return null; }
  }

  static clearSave() { try { localStorage.removeItem(STORY_SAVE_KEY); } catch (e) { /* */ } }

  dispose() { for (const f of this.offs) f(); }
}
