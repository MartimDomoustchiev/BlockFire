/* ============================================================
 * StoryPlan: the main thread's view of the island the workers
 * planned (worker/sites.js) - named sites with their points of
 * interest, the viewpoints, the roads - plus lookups the rest of the
 * story code needs (which site is here, is this a perch...).
 * ============================================================ */
class StoryPlan {
  constructor(info) {
    this.sites = info.sites.map((s) => Object.assign({}, s));
    this.roads = info.roads;
    const N = CONFIG.STORY.NAMES, count = { village: 0, camp: 0 };
    for (const s of this.sites) {
      if (s.kind === 'village' || s.kind === 'camp') s.name = N[s.kind][count[s.kind]++ % N[s.kind].length];
      else s.name = N[s.kind];
      s.key = s.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    }
    // the relics (worker/sites.js): each with the key of the site whose land it lies in ('wilds' out on the open island)
    this.relics = (info.relics || []).map((r) => Object.assign({}, r, { area: r.area >= 0 && this.sites[r.area] ? this.sites[r.area].key : 'wilds' }));
    this.keep = this.sites.find((s) => s.kind === 'keep');
    this.hideout = this.sites.find((s) => s.kind === 'hideout');
    this.villages = this.sites.filter((s) => s.kind === 'village');
    this.camps = this.sites.filter((s) => s.kind === 'camp');
    // viewpoints: every site with a tower, the hideout's first
    this.viewpoints = [];
    for (const s of [this.hideout].concat(this.villages, [this.keep])) {
      const t = s.poi.tower;
      if (t) this.viewpoints.push({ id: this.viewpoints.length, site: s, name: s.name, top: t.top, perch: t.perch, hay: t.hay, base: t.base });
    }
  }

  byKey(key) { return this.sites.find((s) => s.key === key) || null; }

  /** The site whose grounds contain (x, z), or null on the open island. */
  siteAt(x, z) {
    for (const s of this.sites) if (Math.hypot(s.x - x, s.z - z) <= s.flat + 8) return s;
    return null;
  }

  /** The viewpoint whose perch tip is within `r` blocks of p (standing on it), or null. */
  perchAt(p, r) {
    for (const v of this.viewpoints) {
      if (Math.abs(p.y - v.perch.y) < 1.2 && Math.hypot(p.x - v.perch.x, p.z - v.perch.z) <= r) return v;
    }
    return null;
  }
}
