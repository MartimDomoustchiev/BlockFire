/* ============================================================
 * StoryMirror: an online client's read-only copy of the host's
 * Story, enough for the HUD, the map and the screens. The plan comes
 * from the client's own workers (same seed, same island); the rest
 * arrives in snapshots (Story.sharedState + the player's own prompt
 * and timed action). Offers the same small interface as Story:
 *   objective(), notoriety, silver, synced, explored, plan,
 *   promptFor(ch), actionFor(ch), awarenessOf(guard, ch), hunting(guard, ch)
 * and what the journal and the gear screen read: stats, flags, letters,
 * challengesDone, visited, nearForge(ch).
 * ============================================================ */
class StoryMirror {
  constructor(game, planInfo) {
    this.game = game;
    this.plan = new StoryPlan(planInfo);
    game.story = this;
    this.mirror = true;
    this.notoriety = 0;
    this.silver = 0;
    this.chapter = 0;
    this.finished = false;
    this.shop = false;
    this.synced = new Set();
    this.explored = [];
    this.stats = {}; this.flags = {};
    this.letters = new Set(); this.challengesDone = new Set(); this.visited = new Set(); this.relics = new Set();
    this.obj = null;
    this.prompt = null;
    this.action = null;
  }

  /** A shared-state snapshot from the host. */
  apply(s) {
    if (!s) return;
    this.chapter = s.ch; this.finished = !!s.fin; this.silver = s.sil; this.notoriety = s.not; this.shop = !!s.shop;
    this.synced = new Set(s.vps || []);
    this.explored = s.fog || [];
    if (s.jr) {
      this.stats = s.jr.s || {}; this.flags = s.jr.f || {};
      this.letters = new Set(s.jr.l || []); this.challengesDone = new Set(s.jr.c || []); this.visited = new Set(s.jr.vi || []); this.relics = new Set(s.jr.rl || []);
    }
    this.obj = s.obj;
    this.objAt = this.game.time;
  }

  /** This player's own bits: what E would do, and the timed action in progress. */
  applyMine(d) {
    this.prompt = d.sp ? { text: d.sp } : null;
    this.action = d.ac ? { kind: d.ac[0], until: this.game.time + d.ac[1], total: d.ac[2] } : null;
  }

  objective() {
    const o = this.obj;
    if (!o) return null;
    let marker = null;
    if (o.m && o.m.e !== undefined) marker = this.game.entities.get(o.m.e) || null;
    else if (o.m && o.m.p) marker = { x: o.m.p[0], y: o.m.p[1], z: o.m.p[2] };
    const timer = o.tm !== undefined && o.tm !== null ? Math.max(0, o.tm - (this.game.time - this.objAt)) : null;
    return { title: o.t, text: o.x, hint: o.h, failing: !!o.f, marker, timer };
  }

  /** Close enough to Ida's table at the hideout to have gear upgraded (the host checks again when it acts). */
  nearForge(ch) {
    const q = this.plan.hideout.poi.quartermaster;
    return !!(this.shop && q && ch && ch.alive && Math.hypot(q.x - ch.pos.x, q.z - ch.pos.z) < 7);
  }

  isSyncedId(id) { return this.synced.has(id); }
  promptFor() { return this.prompt; }
  actionFor() { return this.action; }
  awarenessOf(guard) { return guard.awMe || 0; }
  hunting(guard) { return !!guard.huntMe; }
  claimsInteract() { return false; }
  tick() {}
  dispose() {}
}
