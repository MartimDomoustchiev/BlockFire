/* ============================================================
 * NPC navigation: A* over the voxel world.
 *
 * A node is a cell a character can stand in: something solid below,
 * two free blocks for the body. From a cell you can walk to any of the
 * 8 neighbours whose floor is at most one block up (the auto step-up
 * climbs it) or three blocks down (a short drop). Diagonals may not
 * cut corners. Water is walkable but costly. Searches are bounded
 * (MAX_NODES) and rationed per tick so dozens of NPCs can't stall a
 * frame. Found paths are shortened by skipping waypoints that can be
 * walked to in a straight line.
 * ============================================================ */
const Nav = {
  MAX_NODES: 1600,                     // per search
  PER_TICK: 6,                         // searches allowed per simulation tick...
  NODES_PER_TICK: 1800,                // ...and nodes expanded per tick, all searches together
  _tick: -1, _used: 0, _nodes: 0,
  _fails: [],                          // recent failed searches { x, z, gx, gz, at }: don't repeat them
  DIRS: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],

  /** May another search run this tick? */
  allowed(game) {
    if (this._tick !== game.tickCount) { this._tick = game.tickCount; this._used = 0; this._nodes = 0; }
    return this._used < this.PER_TICK && this._nodes < this.NODES_PER_TICK;
  },

  /** Can a character stand with its feet at (x, y, z)? */
  standable(w, x, y, z) {
    const below = w.getBlock(x, y - 1, z);
    if (below < 0) return false;
    if (!BlockTables.solid[below] && below !== BLOCK.WATER) return false;
    return !w.isSolid(x, y, z) && !w.isSolid(x, y + 1, z);
  },

  /** Feet level to stand on in column (x, z) when coming from level y (same level first, then up 1, then down). */
  levelFrom(w, x, z, y) {
    for (const dy of [0, 1, -1, -2, -3]) {
      const yy = y + dy;
      if (this.standable(w, x, yy, z)) return yy;
    }
    return null;
  },

  /** The feet level of a character (or point) at p: the standable cell at or just below it. */
  feet(w, p) {
    const x = Math.floor(p.x), z = Math.floor(p.z), y = Math.floor(p.y + 0.05);
    for (let yy = y; yy >= y - 3; yy--) if (this.standable(w, x, yy, z)) return yy;
    for (let yy = y + 1; yy <= y + 2; yy++) if (this.standable(w, x, yy, z)) return yy;
    return null;
  },

  key(x, y, z) { return ((x + 8192) * 16384 + (z + 8192)) * 64 + y; },

  /**
   * Path from `from` to `to` (world points). opts.near: accept arriving within this many blocks of the goal.
   * Returns [{x, y, z}] (cell centres, feet height) or null when there is no way (or the search ran out).
   */
  find(game, from, to, opts = {}) {
    this._used++;
    const w = game.world, max = opts.maxNodes || this.MAX_NODES;
    // someone nearby just failed to reach the same spot: so would we
    this._fails = this._fails.filter((f) => game.time - f.at < 1.5);
    if (this._fails.some((f) => Math.hypot(f.gx - to.x, f.gz - to.z) < 1.5 && Math.hypot(f.x - from.x, f.z - from.z) < 3 && Math.abs(f.y - from.y) < 1)) return null;
    let near = opts.near || 0.9;
    if (this.feet(w, to) === null) near = Math.max(near, 1.6);           // the goal is in a wall / post / hay: next to it will do
    const sx = Math.floor(from.x), sz = Math.floor(from.z);
    const sy = this.feet(w, from);
    if (sy === null) return null;
    // aim for the ground under the goal (someone seen mid-jump or up a wall is chased to where they'll land)
    let gy = to.y !== undefined ? to.y : sy;
    const gx = to.x, gz = to.z, fx = Math.floor(gx), fz = Math.floor(gz);
    for (let y = Math.floor(gy); y >= Math.floor(gy) - 12 && y > 0; y--) if (this.standable(w, fx, y, fz)) { gy = y; break; }
    const h = (x, z) => { const dx = Math.abs(x + 0.5 - gx), dz = Math.abs(z + 0.5 - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const heap = new NavHeap();
    const nodes = new Map();
    const start = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sz), parent: null, closed: false };
    nodes.set(this.key(sx, sy, sz), start);
    heap.push(start);
    let best = start, bestH = h(sx, sz), n = 0;
    while (heap.size) {
      const c = heap.pop();
      if (c.closed) continue;
      c.closed = true;
      const ch = h(c.x, c.z);
      if (ch <= near && Math.abs(c.y - gy) <= 2) return this._path(w, c);
      if (ch < bestH) { bestH = ch; best = c; }
      this._nodes++;
      if (++n > max) break;
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = this.DIRS[d];
        const nx = c.x + dx, nz = c.z + dz;
        const ny = this.levelFrom(w, nx, nz, c.y);
        if (ny === null) continue;
        if (dx && dz) {
          // diagonal: both side cells must be open at our level, and no level change
          if (ny !== c.y || this.levelFrom(w, c.x + dx, c.z, c.y) !== c.y || this.levelFrom(w, c.x, c.z + dz, c.y) !== c.y) continue;
        }
        const k = this.key(nx, ny, nz);
        let o = nodes.get(k);
        if (o && o.closed) continue;
        let cost = dx && dz ? 1.414 : 1;
        if (ny > c.y) cost += 0.6;
        if (ny < c.y) cost += 0.3 * (c.y - ny);
        if (w.getBlock(nx, ny - 1, nz) === BLOCK.WATER || w.getBlock(nx, ny, nz) === BLOCK.WATER) cost += 3;
        const g = c.g + cost;
        if (!o) { o = { x: nx, y: ny, z: nz, g, f: g + h(nx, nz), parent: c, closed: false }; nodes.set(k, o); heap.push(o); }
        else if (g < o.g) { o.g = g; o.f = g + h(nx, nz); o.parent = c; heap.push(o); }
      }
    }
    // out of budget: a partial path towards the goal is still better than walking into a wall
    if (opts.partial && best !== start) return this._path(w, best);
    this._fails.push({ x: from.x, y: from.y, z: from.z, gx: to.x, gz: to.z, at: game.time });
    return null;
  },

  _path(w, end) {
    const cells = [];
    for (let c = end; c; c = c.parent) cells.push(c);
    cells.reverse();
    // string-pulling: from each kept waypoint, jump to the farthest one we can walk to in a straight line
    const out = [];
    let i = 0;
    while (i < cells.length - 1) {
      let j = Math.min(cells.length - 1, i + 24);
      while (j > i + 1 && !this.straight(w, cells[i], cells[j])) j--;
      out.push(cells[j]);
      i = j;
    }
    if (!out.length) out.push(cells[cells.length - 1]);
    return out.map((c) => ({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }));
  },

  /** Can you walk from cell a to cell b in a straight line (no walls, no steps bigger than one block)? */
  straight(w, a, b) {
    const ax = a.x + 0.5, az = a.z + 0.5, bx = b.x + 0.5, bz = b.z + 0.5;
    const L = Math.hypot(bx - ax, bz - az), steps = Math.ceil(L / 0.35);
    const px = -(bz - az) / (L || 1) * 0.45, pz = (bx - ax) / (L || 1) * 0.45;      // body half-width either side, plus a margin
    let y = a.y;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      for (const o of [0, 1, -1]) {
        const x = Math.floor(ax + (bx - ax) * t + px * o), z = Math.floor(az + (bz - az) * t + pz * o);
        const ny = this.levelFrom(w, x, z, y);
        if (ny === null || ny > y + 1 || ny < y - 1) return false;
        if (o === 0) y = ny;
      }
    }
    return y === b.y;
  },
};

/** Minimal binary heap on node.f for A*. */
class NavHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
