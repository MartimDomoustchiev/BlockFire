/* ============================================================
 * Worker module: story-mode sites.
 *
 * From the seed alone (so every worker, and every online player,
 * builds the same island) this plans:
 *   - the Magistrate's keep on the central hill, four villages around
 *     it, three enforcer camps between them and the Order's hideout;
 *   - roads between them (graded: the terrain along a road is blended
 *     towards a smoothed height profile, so roads have no cliffs);
 *   - every block of every structure: houses with gabled roofs,
 *     watchtower viewpoints with a perch and a hay pile below, market
 *     stalls, wells, palisades, tents, cages, the walled keep...
 * Structure blocks are bucketed per chunk and stamped by
 * generateChunk; the flattening and road grading live in
 * columnHeight. Points of interest (doors, guard posts, perches...)
 * go to the main thread through the 'plan' message.
 * ============================================================ */
WorkerBundle.add(function sitesPart() {
  let PLAN = null;            // { sites, roads, segs, buckets }

  function rng32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** cfg: CONFIG.STORY.SITES (flat radius, blend width and max height per kind) + tower heights. */
  function setupSites(cfg) {
    PLAN = null;
    if (cfg) PLAN = buildPlan(cfg);
  }

  // ------------------------------------------------------------------ column queries (used by terrain.js)
  /** Site flattening and road grading applied to a raw terrain height. */
  function adjustHeight(x, z, h) {
    if (!PLAN) return h;
    const rd = nearestRoad(x, z, 7);
    if (rd) {
      const k = rd.d <= 2.5 ? 1 : 1 - (rd.d - 2.5) / 4.5;
      h = h + (rd.h - h) * k * k * (3 - 2 * k);
    }
    for (const s of PLAN.sites) {
      const d = Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z);
      if (d >= s.flat + s.blend) continue;
      let k = d <= s.flat ? 1 : 1 - (d - s.flat) / s.blend;
      k = k * k * (3 - 2 * k);
      h = h + (s.h - h) * k;
      break;
    }
    return h;
  }

  /** Nearest road within maxD blocks: { d, h } (h = graded road height there) or null. */
  function nearestRoad(x, z, maxD) {
    let best = null;
    const px = x + 0.5, pz = z + 0.5;
    for (const g of PLAN.segs) {
      if (px < g.minX - maxD || px > g.maxX + maxD || pz < g.minZ - maxD || pz > g.maxZ + maxD) continue;
      const dx = g.x1 - g.x0, dz = g.z1 - g.z0, L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((px - g.x0) * dx + (pz - g.z0) * dz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (g.x0 + dx * t), pz - (g.z0 + dz * t));
      if (d <= maxD && (!best || d < best.d)) best = { d, h: g.h0 + (g.h1 - g.h0) * t };
    }
    return best;
  }

  /** Should no tree grow here? (inside a site, or next to a road) */
  function siteClear(x, z) {
    if (!PLAN) return false;
    for (const s of PLAN.sites) {
      const d = Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z);
      if (d < s.flat + (s.kind === 'hideout' ? 0 : s.blend) + 2) return true;
    }
    return !!nearestRoad(x, z, 4);
  }

  /** Road surface for a column: 0 none, 1 road on land, 2 bridge over water. */
  function roadSurface(x, z, h) {
    if (!PLAN || !nearestRoad(x, z, 1.9)) return 0;
    return h > SEA ? 1 : 2;
  }

  /** Writes this chunk's share of the structures. */
  function stampChunk(cx, cz, data) {
    if (!PLAN) return;
    const a = PLAN.buckets.get(cx + ',' + cz);
    if (!a) return;
    const ox = cx * 16, oz = cz * 16;
    for (let i = 0; i < a.length; i += 4) data[(a[i] - ox) + (a[i + 2] - oz) * 16 + a[i + 1] * 256] = a[i + 3];
  }

  /** What the main thread needs: sites with their points of interest, and the road polylines. */
  function planInfo() {
    if (!PLAN) return null;
    return {
      sites: PLAN.sites.map((s) => ({ id: s.id, kind: s.kind, x: s.x, z: s.z, h: s.h, flat: s.flat, poi: s.poi })),
      roads: PLAN.roads.map((r) => ({ a: r.a, b: r.b, pts: r.pts })),
    };
  }

  // ------------------------------------------------------------------ planning
  function buildPlan(cfg) {
    const R = ISLAND, rnd = rng32(SEED ^ 0x5717e5);
    const sites = [];
    const avgRaw = (x, z, r) => {
      let sum = 0, n = 0;
      for (let dz = -r; dz <= r; dz += Math.max(1, r / 2)) for (let dx = -r; dx <= r; dx += Math.max(1, r / 2)) { sum += rawColumnHeight(Math.round(x + dx), Math.round(z + dz)); n++; }
      return sum / n;
    };
    const add = (kind, x, z) => {
      const k = cfg[kind];
      const h = Math.round(Math.max(SEA + 4, Math.min(k.maxH, avgRaw(x, z, k.flat * 0.6))));
      const s = { id: sites.length, kind, x: Math.round(x), z: Math.round(z), h, flat: k.flat, blend: k.blend, roads: [], poi: null };
      sites.push(s);
      return s;
    };
    const base = rnd() * Math.PI * 2;
    // the keep: the highest of a few spots near the centre
    let best = null;
    for (let i = 0; i < 24; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * R * 0.12, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = avgRaw(x, z, 6);
      if (!best || h > best.h) best = { x, z, h };
    }
    const keep = add('keep', best.x, best.z);
    const villages = [], camps = [];
    for (let i = 0; i < 4; i++) {
      const a = base + i * Math.PI / 2 + (rnd() - 0.5) * 0.35, d = R * (0.5 + (rnd() - 0.5) * 0.06);
      villages.push(add('village', Math.cos(a) * d, Math.sin(a) * d));
    }
    for (let i = 0; i < 3; i++) {
      const a = base + Math.PI / 4 + i * Math.PI / 2 + (rnd() - 0.5) * 0.25, d = R * 0.6;
      camps.push(add('camp', Math.cos(a) * d, Math.sin(a) * d));
    }
    const ha = base + Math.PI / 4 + 3 * Math.PI / 2 + (rnd() - 0.5) * 0.2;
    const hideout = add('hideout', Math.cos(ha) * R * 0.6, Math.sin(ha) * R * 0.6);

    // roads: keep <-> villages, the village ring, each camp and the hideout to the nearest village
    const links = [];
    for (const v of villages) links.push([keep, v]);
    for (let i = 0; i < 4; i++) links.push([villages[i], villages[(i + 1) % 4]]);
    const nearestVillage = (s) => villages.reduce((m, v) => (!m || Math.hypot(v.x - s.x, v.z - s.z) < Math.hypot(m.x - s.x, m.z - s.z) ? v : m), null);
    for (const c of camps) links.push([c, nearestVillage(c)]);
    links.push([hideout, nearestVillage(hideout)]);
    const roads = [], segs = [];
    PLAN = { sites, roads, segs, buckets: new Map() };       // columnHeight sees the sites from here on
    for (const [A, B] of links) {
      const ang = Math.atan2(B.z - A.z, B.x - A.x);
      A.roads.push(ang); B.roads.push(ang + Math.PI);
      // roads stop at a site's edge - for camps outside the (square) palisade, even on a diagonal
      const endA = A.kind === 'camp' ? A.flat + 2 : A.flat - 3, endB = B.kind === 'camp' ? B.flat + 2 : B.flat - 3;
      const ax = A.x + Math.cos(ang) * endA, az = A.z + Math.sin(ang) * endA;
      const bx = B.x - Math.cos(ang) * endB, bz = B.z - Math.sin(ang) * endB;
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / 22));
      const px = -Math.sin(ang), pz = Math.cos(ang), pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, wig = i === 0 || i === n ? 0 : (rnd() - 0.5) * 16 * Math.sin(Math.PI * t);
        const x = ax + (bx - ax) * t + px * wig, z = az + (bz - az) * t + pz * wig;
        const h = i === 0 ? A.h : i === n ? B.h : Math.max(SEA + 2, avgRaw(x, z, 5));
        pts.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, h]);
      }
      roads.push({ a: A.id, b: B.id, pts });
      for (let i = 0; i < n; i++) {
        const [x0, z0, h0] = pts[i], [x1, z1, h1] = pts[i + 1];
        segs.push({ x0, z0, x1, z1, h0, h1, minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });
      }
    }

    // structures
    const B = PLAN.buckets;
    const put = (x, y, z, id) => {
      if (y < 1 || y >= CH) return;
      const k = (x >> 4) + ',' + (z >> 4);
      let a = B.get(k);
      if (!a) B.set(k, a = []);
      a.push(x, y, z, id);
    };
    const fill = (x0, y0, z0, x1, y1, z1, id) => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) put(x, y, z, id);
    };
    const ring = (x0, z0, x1, z1, y0, y1, id) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) { put(x, y, z0, id); put(x, y, z1, id); }
        for (let z = z0 + 1; z < z1; z++) { put(x0, y, z, id); put(x1, y, z, id); }
      }
    };
    const T = { put, fill, ring, rnd, cfg };
    for (const s of sites) {
      const r = rng32((SEED ^ (s.id * 0x9e3779b1)) >>> 0);
      T.rnd = r;
      if (s.kind === 'village') buildVillage(s, T);
      else if (s.kind === 'camp') buildCamp(s, T);
      else if (s.kind === 'keep') buildKeep(s, T);
      else buildHideout(s, T);
    }
    return PLAN;
  }

  // ------------------------------------------------------------------ shared pieces
  const pt = (x, y, z) => ({ x: x + 0.5, y, z: z + 0.5 });
  /** Yaw that looks along (dx, dz) (characters look down -z at yaw 0). */
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

  /** Angle around the centre that is furthest from every road leaving the site. */
  function quietAngle(s, offset) {
    let best = 0, bestGap = -1;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + (offset || 0);
      let gap = Math.PI;
      for (const r of s.roads) gap = Math.min(gap, Math.abs(Math.atan2(Math.sin(a - r), Math.cos(a - r))));
      if (gap > bestGap) { bestGap = gap; best = a; }
    }
    return best;
  }

  /**
   * Viewpoint tower: a solid 5x5 stone tower `height` blocks tall with timber bands and merlons, a plank
   * perch sticking out towards (dirX, dirZ) at the top, and a hay pile under the perch for the leap.
   */
  function tower(T, x0, z0, F, height, dirX, dirZ, ruined) {
    const { put, fill, ring, rnd } = T;
    const top = F + height;
    fill(x0, F - 2, z0, x0 + 4, top, z0 + 4, ID.COBBLE);
    for (let y = F + 5; y < top; y += 5) ring(x0, z0, x0 + 4, z0 + 4, y, y, ID.TIMBER);
    for (let x = x0; x <= x0 + 4; x++) for (let z = z0; z <= z0 + 4; z++) {
      const edge = x === x0 || x === x0 + 4 || z === z0 || z === z0 + 4;
      if (edge && (x + z) % 2 === 0 && !(ruined && rnd() < 0.5)) put(x, top + 1, z, ID.COBBLE);
    }
    // perch: 3 planks out from the middle of one face, merlon removed where it starts
    const mx = x0 + 2 + dirX * 2, mz = z0 + 2 + dirZ * 2;
    put(mx, top + 1, mz, ID.AIR);
    for (let i = 1; i <= 3; i++) put(mx + dirX * i, top, mz + dirZ * i, ID.PLANKS);
    const tipX = mx + dirX * 3, tipZ = mz + dirZ * 3;
    // hay: 3 wide, 4 long under and beyond the tip (a running leap carries you a little further)
    const hx0 = dirX ? tipX : tipX - 1, hz0 = dirZ ? tipZ : tipZ - 1;
    const hx1 = dirX ? tipX + dirX * 3 : tipX + 1, hz1 = dirZ ? tipZ + dirZ * 3 : tipZ + 1;
    fill(hx0, F + 1, hz0, hx1, F + 2, hz1, ID.HAY);
    fill(hx0, F + 3, hz0, hx1, top - 1, hz1, ID.AIR);
    return {
      top: pt(x0 + 2, top + 1, z0 + 2), perch: pt(tipX, top + 1, tipZ),
      hay: { x: (hx0 + hx1) / 2 + 0.5, y: F + 1, z: (hz0 + hz1) / 2 + 0.5 },
      base: pt(x0 + 2 - dirX * 3, F + 1, z0 + 2 - dirZ * 3), x0, z0, height,
    };
  }

  /** House with plaster (or plank / stone) walls, timber frame, glass windows and a stepped gable roof. */
  function house(T, x0, z0, w, d, F, door, style, P) {
    const { put, fill, ring } = T;
    const x1 = x0 + w - 1, z1 = z0 + d - 1;
    const wall = style === 1 ? ID.PLANKS : style === 2 ? ID.BRICK : ID.PLASTER;
    fill(x0 - 1, F + 1, z0 - 1, x1 + 1, F + 12, z1 + 1, ID.AIR);
    fill(x0, F, z0, x1, F, z1, ID.PLANKS);
    ring(x0, z0, x1, z1, F + 1, F + 4, wall);
    if (style === 2) ring(x0, z0, x1, z1, F + 1, F + 1, ID.COBBLE);
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) fill(x, F + 1, z, x, F + 4, z, ID.TIMBER);
    ring(x0, z0, x1, z1, F + 4, F + 4, ID.TIMBER);
    // windows on every wall
    for (let x = x0 + 2; x <= x1 - 2; x += 2) { put(x, F + 2, z0, ID.GLASS); put(x, F + 2, z1, ID.GLASS); }
    for (let z = z0 + 2; z <= z1 - 2; z += 2) { put(x0, F + 2, z, ID.GLASS); put(x1, F + 2, z, ID.GLASS); }
    // door (2 high) in the middle of the chosen side: 0 -z, 1 +x, 2 +z, 3 -x
    const dx = door === 1 ? x1 : door === 3 ? x0 : Math.floor((x0 + x1) / 2);
    const dz = door === 0 ? z0 : door === 2 ? z1 : Math.floor((z0 + z1) / 2);
    fill(dx, F + 1, dz, dx, F + 2, dz, ID.AIR);
    const ox = door === 1 ? 1 : door === 3 ? -1 : 0, oz = door === 2 ? 1 : door === 0 ? -1 : 0;
    P.doors.push(pt(dx + ox, F + 1, dz + oz));
    P.inside.push(pt(Math.floor((x0 + x1) / 2), F + 1, Math.floor((z0 + z1) / 2)));
    // stepped gable roof along the longer side, flush with the walls (no eaves to get stuck under when climbing)
    const alongX = w >= d;
    const a0 = alongX ? z0 : x0, a1 = alongX ? z1 : x1;
    for (let k = 0; a0 + k <= a1 - k; k++) {
      const y = F + 5 + k, lo = a0 + k, hi = a1 - k;
      if (alongX) {
        fill(x0, y, lo, x1, y, lo, ID.ROOF); fill(x0, y, hi, x1, y, hi, ID.ROOF);
        if (hi - lo > 1) { fill(x0, y, lo + 1, x0, y, hi - 1, wall); fill(x1, y, lo + 1, x1, y, hi - 1, wall); }
      } else {
        fill(lo, y, z0, lo, y, z1, ID.ROOF); fill(hi, y, z0, hi, y, z1, ID.ROOF);
        if (hi - lo > 1) { fill(lo + 1, y, z0, hi - 1, y, z0, wall); fill(lo + 1, y, z1, hi - 1, y, z1, wall); }
      }
    }
    // a poster spot on the wall opposite the door, facing out
    const pw = (door + 2) % 4;
    const px = pw === 1 ? x1 + 1.01 : pw === 3 ? x0 - 0.01 : Math.floor((x0 + x1) / 2) + 0.5;
    const pz = pw === 2 ? z1 + 1.01 : pw === 0 ? z0 - 0.01 : Math.floor((z0 + z1) / 2) + 0.5;
    P.posters.push({ x: px, y: F + 3.5, z: pz, nx: pw === 1 ? 1 : pw === 3 ? -1 : 0, nz: pw === 2 ? 1 : pw === 0 ? -1 : 0 });
    // a bush or two against the side walls
    const side = (door + 1) % 4;
    const bx = side === 1 ? x1 + 1 : side === 3 ? x0 - 1 : x0 + 1, bz = side === 2 ? z1 + 1 : side === 0 ? z0 - 1 : z0 + 1;
    put(bx, F + 1, bz, ID.BUSH);
    if (side === 0 || side === 2) put(bx + 1, F + 1, bz, ID.BUSH); else put(bx, F + 1, bz + 1, ID.BUSH);
    P.hides.push(pt(bx, F + 1, bz));
  }

  /** PATH corridor from the site centre out along each road (width 3); returns boxes to keep clear. */
  function corridors(T, s, from, F) {
    const boxes = [];
    for (const a of s.roads) {
      const dx = Math.cos(a), dz = Math.sin(a);
      for (let t = from; t <= s.flat + s.blend; t += 0.5) {
        const x = Math.round(s.x + dx * t), z = Math.round(s.z + dz * t);
        if (t <= s.flat - 1) for (let o = -1; o <= 1; o++) T.put(x + Math.round(-dz * o), F, z + Math.round(dx * o), ID.PATH);
        if ((t * 2) % 4 === 0) boxes.push([x - 2, z - 2, x + 2, z + 2]);
      }
    }
    return boxes;
  }

  const overlaps = (b, list) => list.some((t) => !(b[2] < t[0] || b[0] > t[2] || b[3] < t[1] || b[1] > t[3]));

  // ------------------------------------------------------------------ village
  function buildVillage(s, T) {
    const { put, fill, ring, rnd } = T;
    const F = s.h, cx = s.x, cz = s.z;
    const P = s.poi = { doors: [], inside: [], stalls: [], posts: [], patrol: [], posters: [], hides: [], spots: [], board: null, tower: null, well: null };
    fill(cx - 6, F, cz - 6, cx + 6, F, cz + 6, ID.PATH);
    fill(cx - 6, F + 1, cz - 6, cx + 6, F + 6, cz + 6, ID.AIR);
    const taken = [[cx - 7, cz - 7, cx + 7, cz + 7]].concat(corridors(T, s, 6, F));
    // well in the middle of the square
    fill(cx - 1, F - 3, cz - 1, cx + 1, F, cz + 1, ID.COBBLE);
    ring(cx - 1, cz - 1, cx + 1, cz + 1, F + 1, F + 1, ID.COBBLE);
    put(cx, F + 1, cz, ID.WATER);                          // full to the brim: whoever steps in can step out again
    put(cx - 1, F + 2, cz - 1, ID.TIMBER); put(cx - 1, F + 3, cz - 1, ID.TIMBER);
    put(cx + 1, F + 2, cz + 1, ID.TIMBER); put(cx + 1, F + 3, cz + 1, ID.TIMBER);
    fill(cx - 1, F + 4, cz - 1, cx + 1, F + 4, cz + 1, ID.ROOF);
    P.well = pt(cx, F + 1, cz);
    // the watchtower stands on the quiet side of the square; its perch points back over the square
    const ta = quietAngle(s);
    const tcx = Math.round(cx + Math.cos(ta) * 11), tcz = Math.round(cz + Math.sin(ta) * 11);
    const ax = Math.abs(Math.cos(ta)) > Math.abs(Math.sin(ta));
    const dirX = ax ? -Math.sign(Math.cos(ta)) : 0, dirZ = ax ? 0 : -Math.sign(Math.sin(ta));
    P.tower = tower(T, tcx - 2, tcz - 2, F, T.cfg.towerHeight.village, dirX, dirZ, false);
    taken.push([tcx - 3, tcz - 3, tcx + 3, tcz + 3]);
    // market stalls around the square
    for (let i = 0, made = 0; i < 12 && made < 3; i++) {
      const a = ta + Math.PI * (0.45 + i * 0.27), r = 8.5;
      const x0 = Math.round(cx + Math.cos(a) * r) - 1, z0 = Math.round(cz + Math.sin(a) * r) - 1;
      const box = [x0 - 1, z0 - 1, x0 + 4, z0 + 3];
      if (overlaps(box, taken.slice(1))) continue;
      taken.push(box);
      for (const [x, z] of [[x0, z0], [x0 + 3, z0], [x0, z0 + 2], [x0 + 3, z0 + 2]]) fill(x, F + 1, z, x, F + 3, z, ID.WOOD);
      fill(x0, F + 4, z0, x0 + 3, F + 4, z0 + 2, ID.CLOTH);
      put(x0 + 1, F + 1, z0 + 1, ID.PLANKS); put(x0 + 2, F + 1, z0 + 1, ID.PLANKS);
      P.stalls.push({ vendor: pt(x0 + 1, F + 1, z0 + 2), front: pt(x0 + 2, F + 1, z0) });
      made++;
    }
    // notice board (contracts) on the far side of the square from the tower
    {
      const a = ta + Math.PI + 0.5, bx = Math.round(cx + Math.cos(a) * 6.5), bz = Math.round(cz + Math.sin(a) * 6.5);
      const alongX = Math.abs(Math.sin(a)) > Math.abs(Math.cos(a));
      const ex = alongX ? 1 : 0, ez = alongX ? 0 : 1;
      fill(bx - ex, F + 1, bz - ez, bx - ex, F + 3, bz - ez, ID.WOOD);
      fill(bx + ex * 2, F + 1, bz + ez * 2, bx + ex * 2, F + 3, bz + ez * 2, ID.WOOD);
      fill(bx, F + 2, bz, bx + ex, F + 3, bz + ez, ID.BOARD);
      const fx = alongX ? 0 : -Math.sign(Math.cos(a)), fz = alongX ? -Math.sign(Math.sin(a)) : 0;
      P.board = { x: bx + ex * 0.5 + 0.5 + fx * 1.2, y: F + 1, z: bz + ez * 0.5 + 0.5 + fz * 1.2, bx, by: F + 2, bz };
    }
    // houses on a ring around the square, doors facing it
    for (let i = 0, made = 0; i < 80 && made < 8; i++) {
      const a = rnd() * Math.PI * 2, r = 12 + rnd() * (s.flat - 18);
      const w = 5 + Math.floor(rnd() * 3), d = 5 + Math.floor(rnd() * 3);
      const x0 = Math.round(cx + Math.cos(a) * r - w / 2), z0 = Math.round(cz + Math.sin(a) * r - d / 2);
      const box = [x0 - 2, z0 - 2, x0 + w + 1, z0 + d + 1];
      if ([[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]].some(([x, z]) => Math.hypot(x - cx, z - cz) > s.flat - 1)) continue;
      if (overlaps(box, taken)) continue;
      taken.push(box);
      const hx = x0 + w / 2 - cx, hz = z0 + d / 2 - cz;
      const door = Math.abs(hx) > Math.abs(hz) ? (hx > 0 ? 3 : 1) : (hz > 0 ? 0 : 2);
      house(T, x0, z0, w, d, F, door, Math.floor(rnd() * 3), P);
      made++;
    }
    // extra hay piles and bushes to hide in
    for (let i = 0, made = 0; i < 30 && made < 2; i++) {
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * 3, x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
      const box = [x - 1, z - 1, x + 2, z + 2];
      if (overlaps(box, taken.slice(1))) continue;
      taken.push(box);
      fill(x, F + 1, z, x + 1, F + 2, z + 1, ID.HAY);
      P.hides.push(pt(x, F + 1, z));
      made++;
    }
    // guards: one where each road enters the square, one at the tower; a patrol around the square
    for (const a of s.roads) P.posts.push({ x: cx + Math.cos(a) * 8.5, y: F + 1, z: cz + Math.sin(a) * 8.5, yaw: yawTo(Math.cos(a), Math.sin(a)) });
    P.posts.push({ x: P.tower.base.x, y: F + 1, z: P.tower.base.z, yaw: 0 });
    for (const [ox, oz] of [[-7, -7], [7, -7], [7, 7], [-7, 7]]) P.patrol.push({ x: cx + ox + 0.5, y: F + 1, z: cz + oz + 0.5 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; P.spots.push({ x: cx + Math.cos(a) * 4 + 0.5, y: F + 1, z: cz + Math.sin(a) * 4 + 0.5 }); }
  }

  // ------------------------------------------------------------------ enforcer camp
  function buildCamp(s, T) {
    const { put, fill, ring, rnd } = T;
    const F = s.h, cx = s.x, cz = s.z, Rp = 12;
    const P = s.poi = { gates: [], posts: [], patrol: [], tents: [], hides: [], cage: null, strongbox: null, lookout: null, spots: [] };
    fill(cx - Rp, F + 1, cz - Rp, cx + Rp, F + 8, cz + Rp, ID.AIR);
    // gates where roads arrive, and always one on the opposite side
    const sides = new Set();
    for (const a of s.roads) {
      const c = Math.cos(a), sn = Math.sin(a);
      sides.add(Math.abs(c) > Math.abs(sn) ? (c > 0 ? 1 : 3) : (sn > 0 ? 2 : 0));
    }
    if (!sides.size) sides.add(0);
    sides.add(([...sides][0] + 2) % 4);
    const gateAt = (side) => side === 0 ? [cx, cz - Rp] : side === 1 ? [cx + Rp, cz] : side === 2 ? [cx, cz + Rp] : [cx - Rp, cz];
    const inGate = (x, z) => [...sides].some((side) => { const [gx, gz] = gateAt(side); return Math.abs(x - gx) <= 1 && Math.abs(z - gz) <= 1 && (x === gx || z === gz); });
    for (let x = cx - Rp; x <= cx + Rp; x++) for (let z = cz - Rp; z <= cz + Rp; z++) {
      if (x !== cx - Rp && x !== cx + Rp && z !== cz - Rp && z !== cz + Rp) continue;
      if (inGate(x, z)) continue;
      fill(x, F + 1, z, x, F + 3 + ((x + z) % 2 === 0 ? 1 : 0), z, ID.WOOD);
    }
    for (const side of sides) {
      const [gx, gz] = gateAt(side), ox = side === 1 ? 1 : side === 3 ? -1 : 0, oz = side === 2 ? 1 : side === 0 ? -1 : 0;
      P.gates.push({ out: pt(gx + ox * 3, F + 1, gz + oz * 3), in: pt(gx - ox * 3, F + 1, gz - oz * 3) });
      P.posts.push({ x: gx - ox * 2 + 0.5 + (oz ? 2 : 0), y: F + 1, z: gz - oz * 2 + 0.5 + (ox ? 2 : 0), yaw: yawTo(ox, oz) });
      for (let t = Rp; t <= s.flat - 1; t++) for (let o = -1; o <= 1; o++) put(cx + ox * t + (oz ? o : 0), F, cz + oz * t + (ox ? o : 0), ID.PATH);
    }
    corridors(T, s, Rp + 1, F);
    // lookout tower in one corner: four log posts, a plank deck, corner railings
    const lc = rnd() < 0.5 ? 1 : -1, ld = rnd() < 0.5 ? 1 : -1;
    const lx = cx + lc * (Rp - 4) - 1, lz = cz + ld * (Rp - 4) - 1;
    for (const [x, z] of [[lx, lz], [lx + 2, lz], [lx, lz + 2], [lx + 2, lz + 2]]) { fill(x, F + 1, z, x, F + 5, z, ID.WOOD); put(x, F + 6, z, ID.WOOD); }
    fill(lx, F + 5, lz, lx + 2, F + 5, lz + 2, ID.PLANKS);
    P.lookout = pt(lx + 1, F + 6, lz + 1);
    // the arms crate, at the foot of the lookout (the marksman watches over it)
    const ax = cx + lc * 6, az = cz + ld * 8;
    put(ax, F + 1, az, ID.ARMS);
    P.armory = { x: ax + 0.5, y: F + 1, z: az + 0.5, bx: ax, by: F + 1, bz: az };
    // tents (open towards the centre)
    const tentSpots = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([a, b]) => !(a === lc && b === ld));
    tentSpots.forEach(([a, b], i) => {
      const tx = cx + a * 6 - 2, tz = cz + b * 6 - 2;
      const alongZ = i % 2 === 0;
      const row = (y, o) => alongZ ? fill(tx + o, y, tz, tx + o, y, tz + 4, ID.CANVAS) : fill(tx, y, tz + o, tx + 4, y, tz + o, ID.CANVAS);
      row(F + 1, 0); row(F + 1, 4); row(F + 2, 1); row(F + 2, 3); row(F + 3, 2);
      // back wall
      if (alongZ) { const bz = b > 0 ? tz + 4 : tz; fill(tx + 1, F + 1, bz, tx + 3, F + 1, bz, ID.CANVAS); put(tx + 2, F + 2, bz, ID.CANVAS); }
      else { const bx = a > 0 ? tx + 4 : tx; fill(bx, F + 1, tz + 1, bx, F + 1, tz + 3, ID.CANVAS); put(bx, F + 2, tz + 2, ID.CANVAS); }
      P.tents.push(pt(tx + 2, F + 1, tz + 2));
    });
    // the strongbox lives in the first tent; a crafting table and furnace stand by the second
    P.strongbox = P.tents[0];
    if (P.tents[1]) { put(Math.floor(P.tents[1].x) + 1, F + 1, Math.floor(P.tents[1].z) + 3, ID.CRAFTING_TABLE); }
    // cage for prisoners (bars, door facing the centre)
    const gx = cx + (lc > 0 ? -1 : 1) * 2 - 1, gz = cz + (ld > 0 ? 1 : -1) * 0 - 1;
    fill(gx, F + 1, gz, gx + 2, F + 3, gz + 2, ID.BARS);
    fill(gx, F + 4, gz, gx + 2, F + 4, gz + 2, ID.BARS);
    fill(gx + 1, F + 1, gz + 1, gx + 1, F + 3, gz + 1, ID.AIR);
    const doorZ = gz;                                     // the -z side is the door
    P.cage = { inside: pt(gx + 1, F + 1, gz + 1), door: [[gx + 1, F + 1, doorZ], [gx + 1, F + 2, doorZ]], front: pt(gx + 1, F + 1, doorZ - 1) };
    // crates for cover along the inside of the palisade (clear of the gates and the patrol lane at 10)
    for (let i = 0; i < 8; i++) {
      const side = Math.floor(rnd() * 4), t = Math.round((rnd() - 0.5) * 16);
      if (Math.abs(t) < 3) continue;
      const x = cx + (side === 1 ? 11 : side === 3 ? -11 : t), z = cz + (side === 2 ? 11 : side === 0 ? -11 : t);
      put(x, F + 1, z, ID.PLANKS);
      if (rnd() < 0.4) put(x, F + 2, z, ID.PLANKS);
    }
    // hay inside (on the lane between the tents), bushes outside the palisade for a quiet approach
    fill(cx - lc * 6, F + 1, cz, cx - lc * 6 + 1, F + 2, cz + 1, ID.HAY);
    P.hides.push(pt(cx - lc * 6, F + 1, cz));
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, r = Rp + 2.5 + rnd() * 1.5, x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
      fill(x, F + 1, z, x + 1, F + 1, z, ID.BUSH);
      P.hides.push(pt(x, F + 1, z));
    }
    P.posts.push({ x: P.lookout.x, y: P.lookout.y, z: P.lookout.z, yaw: yawTo(lc, ld), marksman: true });
    P.posts.push({ x: P.cage.front.x - 1.5, y: F + 1, z: P.cage.front.z - 0.5, yaw: 0 });
    for (const [ox, oz] of [[-10, -10], [10, -10], [10, 10], [-10, 10]]) P.patrol.push({ x: cx + ox + 0.5, y: F + 1, z: cz + oz + 0.5 });
    P.spots.push(pt(cx, F + 1, cz));
  }

  // ------------------------------------------------------------------ the keep
  function buildKeep(s, T) {
    const { put, fill, ring, rnd } = T;
    const F = s.h, cx = s.x, cz = s.z, W = 20;
    const P = s.poi = { posts: [], patrol: [], walls: [], hides: [], gate: null, hall: null, throne: null, tower: null, spots: [] };
    fill(cx - W - 2, F + 1, cz - W - 2, cx + W + 2, F + 14, cz + W + 2, ID.AIR);
    fill(cx - W, F - 2, cz - W, cx + W, F, cz + W, ID.COBBLE);           // paved courtyard
    // two-thick curtain wall with merlons outside
    ring(cx - W, cz - W, cx + W, cz + W, F + 1, F + 7, ID.COBBLE);
    ring(cx - W + 1, cz - W + 1, cx + W - 1, cz + W - 1, F + 1, F + 7, ID.COBBLE);
    for (let x = cx - W; x <= cx + W; x++) for (let z = cz - W; z <= cz + W; z++) {
      if ((x === cx - W || x === cx + W || z === cz - W || z === cz + W) && (x + z) % 2 === 0) put(x, F + 8, z, ID.COBBLE);
    }
    // corner towers
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tx = cx + a * W - 2, tz = cz + b * W - 2;
      fill(tx, F + 1, tz, tx + 4, F + 11, tz + 4, ID.COBBLE);
      for (let x = tx; x <= tx + 4; x++) for (let z = tz; z <= tz + 4; z++) {
        if ((x === tx || x === tx + 4 || z === tz || z === tz + 4) && (x + z) % 2 === 0) put(x, F + 12, z, ID.COBBLE);
      }
      ring(tx, tz, tx + 4, tz + 4, F + 6, F + 6, ID.TIMBER);
    }
    // gate facing the first road
    const ga = s.roads.length ? s.roads[0] : 0, gc = Math.cos(ga), gs = Math.sin(ga);
    const gside = Math.abs(gc) > Math.abs(gs) ? (gc > 0 ? 1 : 3) : (gs > 0 ? 2 : 0);
    const gox = gside === 1 ? 1 : gside === 3 ? -1 : 0, goz = gside === 2 ? 1 : gside === 0 ? -1 : 0;
    const gx = cx + gox * W, gz = cz + goz * W;
    for (let o = -1; o <= 1; o++) for (let k = 0; k <= 1; k++) {
      const x = gx - gox * k + (goz ? o : 0), z = gz - goz * k + (gox ? o : 0);
      fill(x, F + 1, z, x, F + 5, z, ID.AIR);
      put(x, F + 6, z, ID.TIMBER);
    }
    for (let t = W; t <= s.flat - 1; t++) for (let o = -1; o <= 1; o++) put(cx + gox * t + (goz ? o : 0), F, cz + goz * t + (gox ? o : 0), ID.PATH);
    corridors(T, s, W + 1, F);
    P.gate = { out: pt(gx + gox * 3, F + 1, gz + goz * 3), in: pt(gx - gox * 4, F + 1, gz - goz * 4) };
    // stairs up to the wall walk, right of the gate on the inside
    const rx = goz ? 1 : 0, rz = gox ? 1 : 0;                           // along the wall
    for (let i = 0; i < 7; i++) {
      const x = gx - gox * 2 + rx * (3 + i), z = gz - goz * 2 + rz * (3 + i);
      fill(x, F + 1, z, x, F + 1 + i, z, ID.COBBLE);
    }
    // the hall, at the back of the courtyard
    const hw = 7, hd = 5;                                                // half sizes
    const hx = cx - gox * 6, hz = cz - goz * 6;
    const x0 = hx - (gox ? hd : hw), x1 = hx + (gox ? hd : hw), z0 = hz - (goz ? hd : hw), z1 = hz + (goz ? hd : hw);
    fill(x0, F, z0, x1, F, z1, ID.PLANKS);
    ring(x0, z0, x1, z1, F + 1, F + 7, ID.BRICK);
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) fill(x, F + 1, z, x, F + 7, z, ID.TIMBER);
    ring(x0, z0, x1, z1, F + 7, F + 7, ID.TIMBER);
    for (let x = x0 + 2; x <= x1 - 2; x += 3) { fill(x, F + 3, z0, x, F + 4, z0, ID.GLASS); fill(x, F + 3, z1, x, F + 4, z1, ID.GLASS); }
    for (let z = z0 + 2; z <= z1 - 2; z += 3) { fill(x0, F + 3, z, x0, F + 4, z, ID.GLASS); fill(x1, F + 3, z, x1, F + 4, z, ID.GLASS); }
    // door towards the gate, carpet to the throne
    const dx = gox ? (gox > 0 ? x1 : x0) : hx, dz = goz ? (goz > 0 ? z1 : z0) : hz;
    for (let o = -1; o <= 1; o++) fill(dx + (goz ? o : 0), F + 1, dz + (gox ? o : 0), dx + (goz ? o : 0), F + 3, dz + (gox ? o : 0), ID.AIR);
    const backX = gox ? (gox > 0 ? x0 + 1 : x1 - 1) : hx, backZ = goz ? (goz > 0 ? z0 + 1 : z1 - 1) : hz;
    for (let t = 0; ; t++) {
      const x = dx - gox * t, z = dz - goz * t;
      if ((gox && x === backX) || (goz && z === backZ)) break;
      put(x, F, z, ID.CLOTH);
    }
    fill(backX - (goz ? 1 : 0), F + 1, backZ - (gox ? 1 : 0), backX + (goz ? 1 : 0), F + 1, backZ + (gox ? 1 : 0), ID.COBBLE);
    put(backX - gox, F + 2, backZ - goz, ID.TIMBER);
    put(backX - gox, F + 3, backZ - goz, ID.TIMBER);
    P.throne = pt(backX, F + 2, backZ);
    P.hall = { door: pt(dx + gox, F + 1, dz + goz), inside: pt(hx, F + 1, hz) };
    // roof over the hall (stepped, along its long side)
    const alongX = (x1 - x0) >= (z1 - z0);
    const a0 = alongX ? z0 : x0, a1 = alongX ? z1 : x1;
    for (let k = 0; a0 + k <= a1 - k; k++) {
      const y = F + 8 + k, lo = a0 + k, hi = a1 - k;
      if (alongX) { fill(x0, y, lo, x1, y, lo, ID.ROOF); fill(x0, y, hi, x1, y, hi, ID.ROOF); if (hi - lo > 1) { fill(x0, y, lo + 1, x0, y, hi - 1, ID.BRICK); fill(x1, y, lo + 1, x1, y, hi - 1, ID.BRICK); } }
      else { fill(lo, y, z0, lo, y, z1, ID.ROOF); fill(hi, y, z0, hi, y, z1, ID.ROOF); if (hi - lo > 1) { fill(lo + 1, y, z0, hi - 1, y, z0, ID.BRICK); fill(lo + 1, y, z1, hi - 1, y, z1, ID.BRICK); } }
    }
    // the arms crate in the courtyard, beside the hall door
    {
      const ax = hx + gox * (hd + 2) + (goz ? 4 : 0), az = hz + goz * (hd + 2) + (gox ? 4 : 0);
      put(ax, F + 1, az, ID.ARMS);
      P.armory = { x: ax + 0.5, y: F + 1, z: az + 0.5, bx: ax, by: F + 1, bz: az };
    }
    // a skylight in the roof right above the throne: the quiet way in is from above
    fill(backX - 1, F + 8, backZ - 1, backX + 1, F + 18, backZ + 1, ID.AIR);
    P.skylight = pt(backX, F + 8, backZ);
    // the great tower (viewpoint) beside the hall, perch over the courtyard
    const sx = goz ? 1 : 0, sz = gox ? 1 : 0;                           // sideways from the hall
    const tcx = hx + sx * (hw + 5), tcz = hz + sz * (hw + 5);
    P.tower = tower(T, tcx - 2, tcz - 2, F, T.cfg.towerHeight.keep, gox, goz, false);
    // hay and crates in the courtyard
    for (const [a, b] of [[-1, 1], [1, 1]]) {
      const x = cx + gox * 9 + (goz ? a * 9 : 0), z = cz + goz * 9 + (gox ? a * 9 : 0);
      fill(x, F + 1, z, x + 1, F + 2, z + 1, ID.HAY);
      P.hides.push(pt(x, F + 1, z));
      put(x + 3 * b, F + 1, z - 2, ID.PLANKS);
    }
    // guards: outside the gate, inside the gate, by the throne, on the corner towers; patrols on the walls and courtyard
    P.posts.push({ x: P.gate.out.x + (goz ? 2 : 0), y: F + 1, z: P.gate.out.z + (gox ? 2 : 0), yaw: yawTo(gox, goz) });
    P.posts.push({ x: P.gate.out.x - (goz ? 2 : 0), y: F + 1, z: P.gate.out.z - (gox ? 2 : 0), yaw: yawTo(gox, goz) });
    P.posts.push({ x: P.gate.in.x, y: F + 1, z: P.gate.in.z, yaw: yawTo(gox, goz) });
    P.posts.push({ x: P.throne.x + (goz ? 2 : 0) + gox * 2, y: F + 1, z: P.throne.z + (gox ? 2 : 0) + goz * 2, yaw: yawTo(gox, goz) });
    P.posts.push({ x: P.throne.x - (goz ? 2 : 0) + gox * 2, y: F + 1, z: P.throne.z - (gox ? 2 : 0) + goz * 2, yaw: yawTo(gox, goz) });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if ((a === gox && gox) || (b === goz && goz)) P.posts.push({ x: cx + a * W + 0.5, y: F + 12, z: cz + b * W + 0.5, yaw: yawTo(a, b), marksman: true });
    }
    for (const side of [0, 1, 2, 3]) {
      const ox = side === 1 ? 1 : side === 3 ? -1 : 0, oz = side === 2 ? 1 : side === 0 ? -1 : 0;
      const run = [];
      for (const t of [-(W - 4), W - 4]) run.push({ x: cx + ox * (W - 1) + (oz ? t : 0) + 0.5, y: F + 8, z: cz + oz * (W - 1) + (ox ? t : 0) + 0.5 });
      P.walls.push(run);
    }
    for (const [ox, oz] of [[-12, -12], [12, -12], [12, 12], [-12, 12]]) P.patrol.push({ x: cx + ox + 0.5, y: F + 1, z: cz + oz + 0.5 });
    P.spots.push(pt(cx, F + 1, cz));
  }

  // ------------------------------------------------------------------ the Order's hideout
  function buildHideout(s, T) {
    const { put, fill, ring, rnd } = T;
    const F = s.h, cx = s.x, cz = s.z;
    const P = s.poi = { hides: [], spots: [], mentor: null, quartermaster: null, board: null, bed: null, tower: null, entrance: null };
    const ra = s.roads.length ? s.roads[0] : 0;
    const ax = Math.abs(Math.cos(ra)) > Math.abs(Math.sin(ra));
    const ox = ax ? Math.sign(Math.cos(ra)) : 0, oz = ax ? 0 : Math.sign(Math.sin(ra));   // towards the road
    const hw = ax ? 4 : 5, hd = ax ? 5 : 4;
    const x0 = cx - hw, x1 = cx + hw, z0 = cz - hd, z1 = cz + hd;
    fill(x0 - 2, F + 1, z0 - 2, x1 + 2, F + 9, z1 + 2, ID.AIR);
    fill(x0, F, z0, x1, F, z1, ID.COBBLE);
    // ruined chapel walls: holes, broken tops, moss
    for (let y = F + 1; y <= F + 5; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
      const broken = y >= F + 3 && rnd() < (y - F - 2) * 0.22;
      if (!broken) put(x, y, z, rnd() < 0.15 ? ID.STONE : ID.COBBLE);
      else if (y === F + 3 && rnd() < 0.5) put(x, y, z, ID.LEAVES);
    }
    for (let x = x0 + 2; x <= x1 - 2; x += 3) { put(x, F + 6, z0, ID.TIMBER); put(x, F + 6, z1, ID.TIMBER); }
    // doorway towards the road
    const dx = ox ? (ox > 0 ? x1 : x0) : cx, dz = oz ? (oz > 0 ? z1 : z0) : cz;
    for (let o = -1; o <= 0; o++) fill(dx + (oz ? o : 0), F + 1, dz + (ox ? o : 0), dx + (oz ? o : 0), F + 3, dz + (ox ? o : 0), ID.AIR);
    P.entrance = pt(dx + ox * 2, F + 1, dz + oz * 2);
    // inside: the mentor at the back, a bed, the quartermaster's table, the notice board
    const backX = ox ? (ox > 0 ? x0 + 2 : x1 - 2) : cx, backZ = oz ? (oz > 0 ? z0 + 2 : z1 - 2) : cz;
    P.mentor = pt(backX, F + 1, backZ);
    const sx = oz ? 1 : 0, sz = ox ? 1 : 0;                  // sideways inside the chapel
    const bedX = backX + sx * 2, bedZ = backZ + sz * 2;
    put(bedX, F + 1, bedZ, ID.CLOTH); put(bedX + ox, F + 1, bedZ + oz, ID.CLOTH);
    P.bed = pt(bedX + ox * 2, F + 1, bedZ + oz * 2);
    const qx = cx - sx * 3 + ox, qz = cz - sz * 3 + oz;
    put(qx - sx, F + 1, qz - sz, ID.CRAFTING_TABLE);
    P.quartermaster = pt(qx - sx * 0, F + 1, qz - sz * 0);
    // the Order's supply chest beside the table: arrows, smoke and rounds, refilled often
    const chx = qx - sx + ox, chz = qz - sz + oz;
    put(chx, F + 1, chz, ID.ARMS);
    P.armory = { x: chx + 0.5, y: F + 1, z: chz + 0.5, bx: chx, by: F + 1, bz: chz };
    const bx = cx + sx * 3 + ox * 2, bz = cz + sz * 3 + oz * 2;
    put(bx + sx, F + 2, bz + sz, ID.BOARD); put(bx + sx, F + 3, bz + sz, ID.BOARD);
    P.board = { x: bx + 0.5, y: F + 1, z: bz + 0.5, bx: bx + sx, by: F + 2, bz: bz + sz };
    // an old ruined tower behind the chapel: the first viewpoint
    const tcx = cx - ox * (hw + 5) + (oz ? 4 : 0), tcz = cz - oz * (hd + 5) + (ox ? 4 : 0);
    P.tower = tower(T, tcx - 2, tcz - 2, F, T.cfg.towerHeight.hideout, ox ? 0 : -1, ox ? -1 : 0, true);
    for (let i = 0; i < 8; i++) {
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * 3, x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
      if (Math.hypot(x - tcx, z - tcz) < 6) continue;
      put(x, F + 1, z, ID.BUSH);
      P.hides.push(pt(x, F + 1, z));
    }
    P.spots.push(pt(cx, F + 1, cz));
  }
});
