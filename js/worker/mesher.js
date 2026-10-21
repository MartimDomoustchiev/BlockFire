/* Worker module: greedy chunk mesher with per-vertex ambient occlusion.
 *
 * Story mode asks for the SMOOTH variant: the natural ground (grass, dirt, sand, stone, paths) is not drawn as
 * cubes but as one continuous skin over the columns (the "ground" layer: shared corner heights, smooth normals,
 * colours blended from column to column). Cubes stay for everything built (walls, roofs, floors, trunks) and for
 * cliffs, where two neighbouring columns differ by more than a step. Collision is always the voxels. */
WorkerBundle.add(function mesherPart() {
  /*
   * The chunk (plus a 1-block border copied from its 8 neighbours) is
   * copied into a padded 18 x 66 x 18 array so face / AO tests never
   * need bounds checks. The padded array uses strides STR = [x, y, z].
   *
   * For each of the 6 face directions we sweep slice by slice, build a
   * 2D mask of visible faces (key = tile + packed AO) and merge equal
   * neighbours into big quads (greedy meshing). Cells whose four AO
   * corners differ are never merged, otherwise AO would smear across
   * the merged quad. Texture coordinates are in block units and are
   * wrapped per-pixel in the fragment shader (see materials.js).
   */
  const PW = 18, PH = 66;
  const P = new Uint8Array(PW * PH * PW);
  const STR = [1, PW * PW, PW];
  const PBASE = (1 * PW + 1) * PW + 1;                 // padded index of block (0,0,0)
  const DIMS = [16, 64, 16];
  const FACE_SHADE = [0.78, 0.78, 1.0, 0.5, 0.64, 0.64];   // +x -x +y -y +z -z
  const AO_LEVEL = [0.45, 0.65, 0.82, 1.0];
  const mask = new Int32Array(64 * 16);
  const WATER_DROP = 0.125;                            // water surface sits slightly below the block top
  const CU = [0, 1, 1, 0], CV = [0, 0, 1, 1];

  let OPAQUE, LIQUID, FACE_TILES, WATER_TILE;
  let SMOOTH = false, GROUND = null, GCOL = null, PROP = null, GRASS = 0, GRASS_ID = -1, SAND_ID = -1;
  function setupMesher(tables, smooth) {
    OPAQUE = tables.opaque; LIQUID = tables.liquid;
    FACE_TILES = tables.faceTiles; WATER_TILE = tables.waterTile;
    SMOOTH = !!smooth && !!tables.ground;
    GROUND = tables.ground; GCOL = tables.groundColor; PROP = tables.prop;      // 1 = natural ground, 2 = a prop that stands on it (trunks, leaves, hay, bushes)
    GRASS_ID = tables.grassId === undefined ? -1 : tables.grassId; SAND_ID = tables.sandId === undefined ? -1 : tables.sandId;
    P.fill(0);
  }

  // ---- smooth ground: per-column tops of the 20 x 20 columns around (and including) the chunk -------------
  const CW = 20, TOP = new Int16Array(CW * CW), TOPID = new Uint8Array(CW * CW), CR = new Float32Array(CW * CW), CG = new Float32Array(CW * CW), CB = new Float32Array(CW * CW);
  const LINK_DY = 2;                                     // columns this close in height are one skin; more is a cliff (emitSkirts)
  const CORN = [[-1, -1], [0, -1], [0, 0], [-1, 0]];     // the four columns around a corner, in a cycle
  const colTop = (lx, lz) => TOP[(lz + 2) * CW + lx + 2];
  const linked = (a, b) => a >= 0 && b >= 0 && a - b <= LINK_DY && b - a <= LINK_DY;
  const cc = [0, 0, 0, 0];

  function columnTops(nb, cx, cz) {
    for (let lz = -2; lz < 18; lz++) {
      for (let lx = -2; lx < 18; lx++) {
        const ox = lx < 0 ? 0 : lx > 15 ? 2 : 1, oz = lz < 0 ? 0 : lz > 15 ? 2 : 1, c = nb[oz * 3 + ox], at = (lz + 2) * CW + lx + 2;
        let top = -1, id = 0;
        if (c) {
          const x = lx - (ox - 1) * 16, z = lz - (oz - 1) * 16;
          for (let y = 63; y >= 0; y--) {
            const b = c[x + z * 16 + y * 256];
            if (b === 0 || LIQUID[b] || GROUND[b] === 2) continue;       // air, water and props: look through them
            if (GROUND[b] === 1) { top = y; id = b; }                     // natural ground: smooth it; anything else is built: cubes
            break;
          }
        }
        TOP[at] = top; TOPID[at] = id;
        if (top >= 0) {
          // a little patchwork from column to column, the same for every chunk that sees this column
          const wx = cx * 16 + lx, wz = cz * 16 + lz;
          let h = Math.imul(wx, 374761393) ^ Math.imul(wz, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
          const j = 1 + (((h & 255) / 255) - 0.5) * 0.12;
          CR[at] = GCOL[id * 3] * j; CG[at] = GCOL[id * 3 + 1] * j; CB[at] = GCOL[id * 3 + 2] * j;
        }
      }
    }
  }

  /** Which of the 4 columns around corner (X, Z) belong to the same skin as column `own` (a bit mask over CORN). */
  function cornerSet(X, Z, own) {
    for (let k = 0; k < 4; k++) cc[k] = colTop(X + CORN[k][0], Z + CORN[k][1]);
    let mask = 1 << own;
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < 4; k++) {
        const j = (k + 1) & 3;
        if (((mask >> k) & 1) !== ((mask >> j) & 1) && linked(cc[k], cc[j])) mask |= (1 << k) | (1 << j);
      }
    }
    return mask;
  }
  function cornerHeight(X, Z, own) {
    const mask = cornerSet(X, Z, own);
    let sum = 0, n = 0;
    for (let k = 0; k < 4; k++) if ((mask >> k) & 1) { sum += cc[k] + 1; n++; }
    return sum / n;
  }
  const QN = [0, 0, 0];
  /** Normal of the quad over column (qx, qz) from its four corner heights. */
  function quadNormal(qx, qz) {
    const h00 = cornerHeight(qx, qz, 2), h10 = cornerHeight(qx + 1, qz, 3), h11 = cornerHeight(qx + 1, qz + 1, 0), h01 = cornerHeight(qx, qz + 1, 1);
    const dx = ((h10 - h00) + (h11 - h01)) / 2, dz = ((h01 - h00) + (h11 - h10)) / 2, l = Math.hypot(dx, 1, dz);
    QN[0] = -dx / l; QN[1] = 1 / l; QN[2] = -dz / l;
    return QN;
  }

  function newGround() { return { pos: [], normal: [], color: [], index: [], vcount: 0 }; }

  /** One skin quad per ground column; corners shared with the linked neighbours, so the surface has no seams. */
  function emitGround(G) {
    const own = [2, 1, 0, 3], dxs = [0, 0, 1, 1], dzs = [0, 1, 1, 0];     // A (x,z), B (x,z+1), C (x+1,z+1), D (x+1,z)
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        if (colTop(x, z) < 0) continue;
        const base = G.vcount, hs = [0, 0, 0, 0];
        for (let k = 0; k < 4; k++) {
          const X = x + dxs[k], Z = z + dzs[k], mask = cornerSet(X, Z, own[k]);
          let sum = 0, n = 0, nx = 0, ny = 0, nz = 0, r = 0, g = 0, b = 0;
          for (let j = 0; j < 4; j++) {
            if (!((mask >> j) & 1)) continue;
            const qx = X + CORN[j][0], qz = Z + CORN[j][1], at = (qz + 2) * CW + qx + 2;
            sum += cc[j] + 1; n++; r += CR[at]; g += CG[at]; b += CB[at];
          }
          for (let j = 0; j < 4; j++) {
            if (!((mask >> j) & 1)) continue;
            const q = quadNormal(X + CORN[j][0], Z + CORN[j][1]);
            nx += q[0]; ny += q[1]; nz += q[2];
          }
          const l = Math.hypot(nx, ny, nz) || 1;
          hs[k] = sum / n;
          // contact shade: a corner lower than the ground around it is in a hollow and takes less light (baked here, once)
          let ring = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) ring += cornerHeight(X + dx, Z + dz, 0);
          ring /= 8;
          const ao = Math.max(0.5, Math.min(1.04, 1 - (ring - hs[k]) * 0.3 + (hs[k] - ring) * 0.04));
          G.pos.push(X, hs[k], Z);
          G.normal.push(nx / l, ny / l, nz / l);
          G.color.push(r / n * ao, g / n * ao, b / n * ao);
        }
        // split along the shorter diagonal so ridges and valleys keep their line
        if (Math.abs(hs[0] - hs[2]) <= Math.abs(hs[1] - hs[3])) G.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else G.index.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
        G.vcount += 4;
      }
    }
    emitSkirts(G);
  }

  // edges towards +x and +z: the two corners, and which of each corner's four columns (CORN) the column is (a) and its
  // neighbour across the edge (b)
  const SKIRT = [
    { dx: 1, dz: 0, c: [[1, 0, 3, 2], [1, 1, 0, 1]] },
    { dx: 0, dz: 1, c: [[0, 1, 1, 2], [1, 1, 0, 3]] },
  ];
  /**
   * Where two ground columns are not one skin (a step of more than LINK_DY), a strip joins the two skins' edges at their
   * exact corner heights, so the ground is watertight: no cube walls left standing, no holes to the sky. The steep strip
   * reads as rock in the ground shader. Each chunk does its +x and +z edges; the -x and -z ones belong to the neighbours.
   */
  function emitSkirts(G) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        if (colTop(x, z) < 0) continue;
        for (const S of SKIRT) {
          const nx = x + S.dx, nz = z + S.dz;
          if (colTop(nx, nz) < 0) continue;
          const [p, q] = S.c, P1 = [x + p[0], z + p[1]], P2 = [x + q[0], z + q[1]];
          const a1 = cornerHeight(P1[0], P1[1], p[2]), b1 = cornerHeight(P1[0], P1[1], p[3]);
          const a2 = cornerHeight(P2[0], P2[1], q[2]), b2 = cornerHeight(P2[0], P2[1], q[3]);
          if (Math.abs(a1 - b1) < 1e-3 && Math.abs(a2 - b2) < 1e-3) continue;
          const dir = (a1 + a2) >= (b1 + b2) ? 1 : -1;                 // it faces the lower side
          const n = nrm(S.dx * dir, 0.35, S.dz * dir);
          const ia = (z + 2) * CW + x + 2, ib = (nz + 2) * CW + nx + 2;
          const r = (CR[ia] + CR[ib]) * 0.4, g = (CG[ia] + CG[ib]) * 0.4, b = (CB[ia] + CB[ib]) * 0.4;
          const base = G.vcount;
          for (const [X, Z, h] of [[P1[0], P1[1], a1], [P2[0], P2[1], a2], [P2[0], P2[1], b2], [P1[0], P1[1], b1]]) {
            G.pos.push(X, h, Z); G.normal.push(n[0], n[1], n[2]); G.color.push(r, g, b);
          }
          G.vcount += 4;
          // wind it to face the lower side: the cross product of its first triangle against the outward direction
          const o = base * 3, Pp = G.pos;
          const ux = Pp[o + 3] - Pp[o], uy = Pp[o + 4] - Pp[o + 1], uz = Pp[o + 5] - Pp[o + 2];
          const vx = Pp[o + 6] - Pp[o], vy = Pp[o + 7] - Pp[o + 1], vz = Pp[o + 8] - Pp[o + 2];
          const cx = uy * vz - uz * vy, cz = ux * vy - uy * vx;
          if (cx * S.dx * dir + cz * S.dz * dir >= 0) G.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else G.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
    }
  }
  // ---- props: palms and reeds as real geometry, wherever the voxel data has their marker blocks ----------
  // tex: (along, across, kind) for the prop shader: kind 0 plain, 1 palm bark (around 0..1, height in blocks), 2 a frond
  // (along 0..1 from the base, across -1..1) whose leaflets the shader cuts out
  function newProps() { return { pos: [], normal: [], color: [], sway: [], tex: [], index: [], vcount: 0 }; }
  const pvert = (G, x, y, z, nx, ny, nz, r, g, b, sw, tu = 0, tv = 0, tk = 0) => {
    G.pos.push(x, y, z); G.normal.push(nx, ny, nz); G.color.push(r, g, b); G.sway.push(sw); G.tex.push(tu, tv, tk); return G.vcount++;
  };
  const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const rngOf = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hashOf = (x, y, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return h ^ (h >>> 16); };

  /** A leaf strip: a bent centre line with a width that swells and tapers, folded into a shallow V. pts: [x, y, z, halfWidth, t] */
  function strip(G, pts, sx, sz, c0, c1, sway0, sway1, fold, kind = 0) {
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], t = p[4], a = pts[Math.min(pts.length - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      const tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
      // surface normal = side x tangent, the same side the winding faces (the shader flips it for the back); tilted a little
      // to each edge so the fold shades like a leaf
      const n = nrm(-sz * ty, sz * tx - sx * tz, sx * ty);
      const r = c0[0] + (c1[0] - c0[0]) * t, g = c0[1] + (c1[1] - c0[1]) * t, bl = c0[2] + (c1[2] - c0[2]) * t, sw = sway0 + (sway1 - sway0) * t;
      const nl = nrm(n[0] + sx * 0.4, n[1], n[2] + sz * 0.4), nr = nrm(n[0] - sx * 0.4, n[1], n[2] - sz * 0.4);
      const L = pvert(G, p[0] + sx * p[3], p[1] + p[3] * fold, p[2] + sz * p[3], nl[0], nl[1], nl[2], r, g, bl, sw, t, 1, kind);
      const R = pvert(G, p[0] - sx * p[3], p[1] + p[3] * fold, p[2] - sz * p[3], nr[0], nr[1], nr[2], r, g, bl, sw, t, -1, kind);
      if (prev) { G.index.push(prev[0], L, prev[1], prev[1], L, R); }
      prev = [L, R];
    }
  }

  /**
   * A date palm: a fibrous grey-brown trunk that leans and curves, flared at the foot; a crown of about 26 arching fronds
   * in three tiers (the old ones drooping, the young ones rising); a skirt of dead brown fronds hanging under it; and
   * clusters of dates. Fronds are wide strips: the prop shader cuts their leaflets out (tex kind 2) and draws the trunk's
   * pattern of old leaf bases (kind 1).
   */
  function emitPalm(G, px, py, pz, H, seed) {
    const r = rngOf(seed), lean = 0.25 + r() * 0.6, la = r() * Math.PI * 2, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const y0 = py - 0.6, top = H + 0.6 + 0.4, RINGS = 12, SEG = 9, S1 = SEG + 1, base = G.vcount, bark = 0.85 + r() * 0.15;
    const at = (t) => [px + lx * t * t, y0 + top * t, pz + lz * t * t];
    for (let k = 0; k < RINGS; k++) {
      const t = k / (RINGS - 1), c = at(t);
      const rad = 0.29 - 0.07 * t + (t < 0.12 ? 0.17 * (1 - t / 0.12) ** 2 : 0) + (t > 0.88 ? 0.07 * (t - 0.88) / 0.12 : 0);
      const cr = (0.47 - 0.07 * t) * bark, cg = (0.39 - 0.06 * t) * bark, cb = (0.3 - 0.05 * t) * bark;
      for (let s = 0; s <= SEG; s++) {          // the seam is doubled so the bark pattern wraps cleanly
        const a = s / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), n = nrm(ca, 0.1, sa);
        pvert(G, c[0] + ca * rad, c[1], c[2] + sa * rad, n[0], n[1], n[2], cr, cg, cb, t * t * 0.3, s / SEG, top * t, 1);
      }
    }
    for (let k = 0; k < RINGS - 1; k++) {
      for (let s = 0; s < SEG; s++) {
        const i0 = base + k * S1 + s, i1 = i0 + 1, j0 = i0 + S1, j1 = j0 + 1;
        G.index.push(i0, j0, i1, i1, j0, j1);
      }
    }
    const T = at(1), g0 = 0.88 + r() * 0.2;
    /** one frond from the crown: angle a, length L, rising `pitch`, falling `droop` (both per unit of length) */
    const frond = (a, L, pitch, droop, w0, c0, c1, sway0, sway1, fold) => {
      const ca = Math.cos(a), sa = Math.sin(a), pts = [], SEGF = 8;
      for (let i = 0; i <= SEGF; i++) {
        const s = i / SEGF, d = L * s * 0.92, h = L * (pitch * s - droop * s * s);
        const w = w0 * Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * s)), 0.6) * (1 - 0.3 * s);
        pts.push([T[0] + ca * (d + 0.12), T[1] + 0.05 + h, T[2] + sa * (d + 0.12), w, s]);
      }
      strip(G, pts, -sa, ca, c0, c1, sway0, sway1, fold, 2);
    };
    const green = (k, y = 0) => [[0.23 * k, 0.3 * k, 0.19 * k], [0.42 * k + y, 0.48 * k + y * 0.8, 0.3 * k]];
    const NO = 11 + Math.floor(r() * 3), off = r() * 6.3;
    for (let f = 0; f < NO; f++) {             // the outer tier: long, arching well below the crown
      const [c0, c1] = green(g0 * (0.9 + r() * 0.15), r() < 0.25 ? 0.08 : 0);
      frond(off + f / NO * Math.PI * 2 + (r() - 0.5) * 0.35, 2.7 + r() * 1.0, 0.45 + r() * 0.25, 0.85 + r() * 0.3, 0.85, c0, c1, 0.3, 1.0, 0.22);
    }
    for (let f = 0; f < 8; f++) {              // the middle tier: out and up
      const [c0, c1] = green(g0 * (0.95 + r() * 0.15));
      frond(off + (f + 0.5) / 8 * Math.PI * 2 + (r() - 0.5) * 0.4, 2.3 + r() * 0.7, 1.0 + r() * 0.3, 0.8 + r() * 0.25, 0.75, c0, c1, 0.3, 0.9, 0.26);
    }
    for (let f = 0; f < 5; f++) {              // the young fronds: nearly upright
      const [c0, c1] = green(g0 * 1.08, 0.03);
      frond(off + f / 5 * Math.PI * 2 + r(), 1.5 + r() * 0.6, 2.0 + r() * 0.4, 0.9, 0.55, c0, c1, 0.25, 0.7, 0.3);
    }
    const ND = 3 + Math.floor(r() * 4);
    for (let f = 0; f < ND; f++) {             // dead fronds hanging against the trunk
      const k = 0.85 + r() * 0.25;
      frond(r() * Math.PI * 2, 1.6 + r() * 0.6, -0.3, 1.5 + r() * 0.5, 0.5, [0.34 * k, 0.26 * k, 0.17 * k], [0.52 * k, 0.42 * k, 0.27 * k], 0.1, 0.35, 0.35);
    }
    const NC = 2 + Math.floor(r() * 3);
    for (let c = 0; c < NC; c++) {             // date clusters under the crown
      const a = r() * Math.PI * 2, rr = 0.32 + r() * 0.1, cx0 = T[0] + Math.cos(a) * rr, cz0 = T[2] + Math.sin(a) * rr, cy0 = T[1] - 0.3;
      const ripe = r(), col = ripe < 0.5 ? [0.78, 0.48, 0.12] : [0.55, 0.22, 0.08];
      for (let k = 0; k < 7; k++) {
        const cx = cx0 + (r() - 0.5) * 0.22, cz = cz0 + (r() - 0.5) * 0.22, cy = cy0 - r() * 0.35, q = 0.06, qy = 0.09, j = 0.9 + r() * 0.2;
        const c3 = [col[0] * j, col[1] * j, col[2] * j];
        const v = [pvert(G, cx, cy + qy, cz, 0, 1, 0, ...c3, 0.5), pvert(G, cx + q, cy, cz, 1, 0, 0, ...c3, 0.5), pvert(G, cx, cy, cz + q, 0, 0, 1, ...c3, 0.5),
          pvert(G, cx - q, cy, cz, -1, 0, 0, ...c3, 0.5), pvert(G, cx, cy, cz - q, 0, 0, -1, ...c3, 0.5), pvert(G, cx, cy - qy, cz, 0, -1, 0, ...c3, 0.5)];
        G.index.push(v[0], v[2], v[1], v[0], v[3], v[2], v[0], v[4], v[3], v[0], v[1], v[4], v[5], v[1], v[2], v[5], v[2], v[3], v[5], v[3], v[4], v[5], v[4], v[1]);
      }
    }
  }

  function emitReeds(G, px, py, pz, seed) {
    const r = rngOf(seed), N = 8 + Math.floor(r() * 4);
    for (let i = 0; i < N; i++) {
      const bx = px + (r() - 0.5) * 0.8, bz = pz + (r() - 0.5) * 0.8, h = 0.9 + r() * 1.0, la = r() * Math.PI * 2, lean = 0.15 + r() * 0.4, fa = r() * Math.PI;
      const pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([bx + Math.cos(la) * lean * t * t, py - 0.1 + h * t, bz + Math.sin(la) * lean * t * t, 0.075 * (1 - t * t * 0.9), t]); }
      const tint = 0.9 + r() * 0.25;
      strip(G, pts, Math.cos(fa), Math.sin(fa), [0.22 * tint, 0.38 * tint, 0.12 * tint], [0.62 * tint, 0.7 * tint, 0.3 * tint], 0.15, 1.0, 0.0);
    }
  }

  // ---- story: blocks drawn as props instead of cubes (the voxels, and so walking and climbing, stay) ----------------
  // leaves (prop 3) are ivy on old walls; cloth (prop 4) hung up is an awning, cloth lying free is a bed; cloth set into
  // a floor (a carpet) stays a cube
  const SY = PW * PW, SZ = PW;
  function clothProp(pi) {
    const below = P[pi - SY];
    if (!OPAQUE[below] || GROUND[below] === 2) return 1;          // hung up, or on posts: an awning
    let open = 0;
    if (!OPAQUE[P[pi + 1]]) open++;
    if (!OPAQUE[P[pi - 1]]) open++;
    if (!OPAQUE[P[pi + SZ]]) open++;
    if (!OPAQUE[P[pi - SZ]]) open++;
    return open >= 2 && !OPAQUE[P[pi + SY]] ? 2 : 0;
  }
  const asProp = (id, pi) => SMOOTH && (PROP[id] === 3 || (PROP[id] === 4 && clothProp(pi) > 0));
  const isCloth = (pi) => PROP[P[pi]] === 4;

  /** A clump of ivy: small leaves round the block, flat against the walls beside it, a few strands hanging below. */
  function emitIvy(G, x, y, z, pi, seed) {
    const r = rngOf(seed);
    const walls = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].filter((d) => OPAQUE[P[pi + d[0] + d[2] * SZ]]);
    const leaf = (px, py, pz, ax, ay, az, len, w) => {
      // a leaf along (ax, ay, az) from (px, py, pz): its width across, the side axis perpendicular to it and to up
      let sx = -az, sz = ax; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
      if (Math.abs(ay) > 0.9) { sx = 1; sz = 0; }
      const k = 0.75 + r() * 0.4, c0 = [0.13 * k, 0.24 * k, 0.09 * k], c1 = [0.24 * k, 0.4 * k, 0.15 * k];
      const pts = [];
      for (let i = 0; i <= 3; i++) { const t = i / 3; pts.push([px + ax * len * t, py + ay * len * t - 0.04 * t * t, pz + az * len * t, w * Math.sin(Math.PI * (0.1 + 0.85 * t)), t]); }
      strip(G, pts, sx, sz, c0, c1, 0.05, 0.22, 0.15, 3);
    };
    const N = 34;
    for (let i = 0; i < N; i++) {
      let px = x + 0.1 + r() * 0.8, py = y + r(), pz = z + 0.1 + r() * 0.8;
      let ax = r() - 0.5, ay = r() * 0.6 - 0.1, az = r() - 0.5;
      if (walls.length && r() < 0.7) {           // against a wall: on its face, the leaf lying along it
        const d = walls[Math.floor(r() * walls.length)];
        if (d[0]) { px = d[0] > 0 ? x + 0.98 : x + 0.02; ax = -d[0] * 0.25; }
        if (d[2]) { pz = d[2] > 0 ? z + 0.98 : z + 0.02; az = -d[2] * 0.25; }
      }
      const l = Math.hypot(ax, ay, az) || 1;
      leaf(px, py, pz, ax / l, ay / l, az / l, 0.16 + r() * 0.12, 0.06 + r() * 0.04);
    }
    if (!OPAQUE[P[pi - SY]] && walls.length) {   // strands down the wall
      for (let s = 0; s < 3; s++) {
        const d = walls[s % walls.length], len = 0.6 + r() * 0.9;
        let px = x + 0.2 + r() * 0.6, pz = z + 0.2 + r() * 0.6;
        if (d[0]) px = d[0] > 0 ? x + 0.97 : x + 0.03;
        if (d[2]) pz = d[2] > 0 ? z + 0.97 : z + 0.03;
        for (let k = 0; k < 6; k++) {
          const t = k / 6;
          leaf(px + (r() - 0.5) * 0.08, y + 0.1 - len * t, pz + (r() - 0.5) * 0.08, (r() - 0.5) * 0.6 - d[0] * 0.3, -0.5, (r() - 0.5) * 0.6 - d[2] * 0.3, 0.13 + r() * 0.06, 0.05);
        }
      }
    }
  }

  /** A quad of the cloth (tex kind 4: the prop shader stripes it along tex.x), both sides lit. */
  function clothQuad(G, a, b, c, d, ta, tb, col, sw) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const n = nrm(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const i0 = pvert(G, a[0], a[1], a[2], n[0], n[1], n[2], col[0], col[1], col[2], sw[0], ta, 0, 4);
    const i1 = pvert(G, b[0], b[1], b[2], n[0], n[1], n[2], col[0], col[1], col[2], sw[1], tb, 0, 4);
    const i2 = pvert(G, c[0], c[1], c[2], n[0], n[1], n[2], col[0], col[1], col[2], sw[2], tb, 0, 4);
    const i3 = pvert(G, d[0], d[1], d[2], n[0], n[1], n[2], col[0], col[1], col[2], sw[3], ta, 0, 4);
    G.index.push(i0, i1, i2, i0, i2, i3);
  }

  /** An awning: striped linen stretched over the cell, sagging between the beams, a scalloped valance on its open edges. */
  function emitAwning(G, x, y, z, pi, wx, wz) {
    const top = y + 0.86, N = 6, col = [0.92, 0.86, 0.72];
    const h = (u, v) => top - 0.09 * Math.sin(Math.PI * u) - 0.02 * Math.sin(Math.PI * v);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
        clothQuad(G, [x + u0, h(u0, v0), z + v0], [x + u0, h(u0, v1), z + v1], [x + u1, h(u1, v1), z + v1], [x + u1, h(u1, v0), z + v0],
          wz + v0, wz + v1, col, [0.04, 0.04, 0.04, 0.04]);
      }
    }
    // valances: along each open edge, hanging down, scalloped at the bottom
    const edges = [[0, -1, [x, z], [x + 1, z]], [0, 1, [x + 1, z + 1], [x, z + 1]], [-1, 0, [x, z + 1], [x, z]], [1, 0, [x + 1, z], [x + 1, z + 1]]];
    for (const [ex, ez, A, B] of edges) {
      if (isCloth(pi + ex + ez * SZ)) continue;
      const M = 8;
      for (let k = 0; k < M; k++) {
        const t0 = k / M, t1 = (k + 1) / M;
        const p0 = [A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0], p1 = [A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1];
        const y0 = (ex ? h(ex > 0 ? 1 : 0, t0) : h(t0, ez > 0 ? 1 : 0)), y1 = (ex ? h(ex > 0 ? 1 : 0, t1) : h(t1, ez > 0 ? 1 : 0));
        const d0 = 0.2 + 0.06 * Math.abs(Math.sin(t0 * Math.PI * 4)), d1 = 0.2 + 0.06 * Math.abs(Math.sin(t1 * Math.PI * 4));
        const o = 0.01;
        const s0 = ex ? (wz + (p0[1] - z)) : (wx + (p0[0] - x)), s1 = ex ? (wz + (p1[1] - z)) : (wx + (p1[0] - x));
        clothQuad(G, [p0[0] + ex * o, y0, p0[1] + ez * o], [p1[0] + ex * o, y1, p1[1] + ez * o], [p1[0] + ex * o, y1 - d1, p1[1] + ez * o], [p0[0] + ex * o, y0 - d0, p0[1] + ez * o],
          s0, s1, col, [0.04, 0.04, 0.3, 0.3]);
      }
    }
  }

  /** A bed: a low mattress of linen, a striped blanket over it falling over its open sides. */
  function emitBed(G, x, y, z, pi, wx, wz) {
    const linen = [0.86, 0.8, 0.68], H = 0.38, ins = 0.05;
    const openX0 = !isCloth(pi - 1), openX1 = !isCloth(pi + 1), openZ0 = !isCloth(pi - SZ), openZ1 = !isCloth(pi + SZ);
    const x0 = x + (openX0 ? ins : 0), x1 = x + 1 - (openX1 ? ins : 0), z0 = z + (openZ0 ? ins : 0), z1 = z + 1 - (openZ1 ? ins : 0);
    const box = (ax, ay, az, bx, by, bz, c) => {
      const f = [[[ax, ay, bz], [bx, ay, bz], [bx, by, bz], [ax, by, bz]], [[bx, ay, az], [ax, ay, az], [ax, by, az], [bx, by, az]],
        [[bx, ay, bz], [bx, ay, az], [bx, by, az], [bx, by, bz]], [[ax, ay, az], [ax, ay, bz], [ax, by, bz], [ax, by, az]],
        [[ax, by, bz], [bx, by, bz], [bx, by, az], [ax, by, az]]];
      for (const q of f) {
        const ux = q[1][0] - q[0][0], uy = q[1][1] - q[0][1], uz = q[1][2] - q[0][2], vx = q[3][0] - q[0][0], vy = q[3][1] - q[0][1], vz = q[3][2] - q[0][2];
        const n = nrm(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        const v = q.map((p) => pvert(G, p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], 0));
        G.index.push(v[0], v[1], v[2], v[0], v[2], v[3]);
      }
    };
    box(x0, y, z0, x1, y + H, z1, linen);
    // the blanket: a little above the mattress, hanging down its open sides
    const bt = y + H + 0.015, col = [0.93, 0.88, 0.76], sw = [0, 0, 0, 0];
    clothQuad(G, [x0 - 0.01, bt, z0 - 0.01], [x0 - 0.01, bt, z1 + 0.01], [x1 + 0.01, bt, z1 + 0.01], [x1 + 0.01, bt, z0 - 0.01], wz, wz + 1, col, sw);
    const drop = bt - 0.24;
    if (openX0) clothQuad(G, [x0 - 0.012, bt, z1], [x0 - 0.012, bt, z0], [x0 - 0.012, drop, z0], [x0 - 0.012, drop, z1], wz + 1, wz, col, sw);
    if (openX1) clothQuad(G, [x1 + 0.012, bt, z0], [x1 + 0.012, bt, z1], [x1 + 0.012, drop, z1], [x1 + 0.012, drop, z0], wz, wz + 1, col, sw);
    if (openZ0) clothQuad(G, [x0, bt, z0 - 0.012], [x1, bt, z0 - 0.012], [x1, drop, z0 - 0.012], [x0, drop, z0 - 0.012], wx, wx + 1, col, sw);
    if (openZ1) clothQuad(G, [x1, bt, z1 + 0.012], [x0, bt, z1 + 0.012], [x0, drop, z1 + 0.012], [x1, drop, z1 + 0.012], wx + 1, wx, col, sw);
  }

  /** Story, Epic: how much grass grows (0 none, 1 sparse, 2 the fields full of it). Chunks meshed after this have it. */
  function setGrass(level) { GRASS = level | 0; }

  /**
   * Grass: blades on the green fields and dry tufts here and there on the sand, standing on the ground skin (its height
   * at the blade's foot from the column's corner heights), each a tapered, curving strip that bends in the wind. tex:
   * (along 0..1, the blade's height, kind 5): the prop shader shades it from the shaded foot to a sunlit tip and sinks
   * it into the ground far away.
   */
  function emitGrass(c, cx, cz) {
    const G = newProps();
    const blade = (px, py, pz, h, lean, ang, w, c0, c1) => {
      const dx = Math.cos(ang), dz = Math.sin(ang), sx = -dz, sz = dx;          // leaning towards (dx, dz), flat across (sx, sz)
      let prev = null;
      for (let i = 0; i <= 3; i++) {
        const t = i / 3, x = px + dx * lean * t * t, z = pz + dz * lean * t * t, y = py + h * t, hw = w * (1 - t * 0.92);
        const n = nrm(dx * 0.6, 1, dz * 0.6);
        const r = c0[0] + (c1[0] - c0[0]) * t, g = c0[1] + (c1[1] - c0[1]) * t, b = c0[2] + (c1[2] - c0[2]) * t, sw = t * t * h * 0.9;
        const L = pvert(G, x + sx * hw, y, z + sz * hw, n[0], n[1], n[2], r, g, b, sw, t, h, 5);
        const R = pvert(G, x - sx * hw, y, z - sz * hw, n[0], n[1], n[2], r, g, b, sw, t, h, 5);
        if (prev) G.index.push(prev[0], L, prev[1], prev[1], L, R);
        prev = [L, R];
      }
    };
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const top = colTop(x, z);
        if (top < 0 || top >= 62) continue;
        const id = TOPID[(z + 2) * CW + x + 2], above = c[x + z * 16 + (top + 1) * 256];
        if (above !== 0 && !PROP[above]) continue;                       // built over (a floor, a wall): no grass
        const wx = cx * 16 + x, wz = cz * 16 + z, r = rngOf(hashOf(wx, top, wz) ^ 0x5bd1e995);
        let n = 0, dry = false;
        if (id === GRASS_ID) n = GRASS === 2 ? 20 : 7;
        else if (id === SAND_ID && r() < 0.05 * GRASS) { n = 7; dry = true; }
        if (!n) continue;
        const h00 = cornerHeight(x, z, 2), h10 = cornerHeight(x + 1, z, 3), h11 = cornerHeight(x + 1, z + 1, 0), h01 = cornerHeight(x, z + 1, 1);
        if (Math.max(h00, h10, h11, h01) - Math.min(h00, h10, h11, h01) > 1.2) continue;      // a cliff edge
        const tx = r(), tz = r();
        for (let k = 0; k < n; k++) {
          // a tuft of dry grass keeps together; field grass is everywhere
          const u = dry ? tx * 0.6 + 0.2 + (r() - 0.5) * 0.25 : r(), v = dry ? tz * 0.6 + 0.2 + (r() - 0.5) * 0.25 : r();
          const hy = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h11 * u * v + h01 * (1 - u) * v;
          const k2 = 0.8 + r() * 0.4, ang = r() * Math.PI * 2;
          const c0 = dry ? [0.36 * k2, 0.32 * k2, 0.2 * k2] : [0.16 * k2, 0.27 * k2, 0.08 * k2];
          const c1 = dry ? [0.78 * k2, 0.69 * k2, 0.44 * k2] : (r() < 0.25 ? [0.62 * k2, 0.6 * k2, 0.3 * k2] : [0.42 * k2, 0.56 * k2, 0.2 * k2]);
          const h = dry ? 0.25 + r() * 0.3 : 0.22 + r() * 0.38;
          blade(x + u, hy - 0.04, z + v, h, h * (0.25 + r() * 0.45), ang, 0.018 + r() * 0.016, c0, c1);
        }
      }
    }
    return G;
  }

  function propsOf(c, cx, cz) {
    const G = newProps();
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        for (let y = 1; y < 63; y++) {
          const k = PROP[c[x + z * 16 + y * 256]];
          if (!k) continue;
          const seed = hashOf(cx * 16 + x, y, cz * 16 + z);
          if (k === 3) { emitIvy(G, x, y, z, PBASE + y * SY + z * SZ + x, seed); continue; }
          if (k === 4) {
            const pi = PBASE + y * SY + z * SZ + x, kind = clothProp(pi);
            if (kind === 1) emitAwning(G, x, y, z, pi, cx * 16 + x, cz * 16 + z);
            else if (kind === 2) emitBed(G, x, y, z, pi, cx * 16 + x, cz * 16 + z);
            continue;
          }
          if (k === 1) {
            let n = 0;
            while (y < 63 && PROP[c[x + z * 16 + y * 256]] === 1) { n++; y++; }
            emitPalm(G, x + 0.5, y - n, z + 0.5, n, seed);
            y--;
          } else emitReeds(G, x + 0.5, y, z + 0.5, seed);
        }
      }
    }
    return G;
  }
  function packProps(G) {
    return { pos: new Float32Array(G.pos), normal: new Float32Array(G.normal), color: new Float32Array(G.color), sway: new Float32Array(G.sway),
      tex: new Float32Array(G.tex), index: new Uint32Array(G.index) };
  }

  function packGround(G) {
    return { pos: new Float32Array(G.pos), normal: new Float32Array(G.normal), color: new Float32Array(G.color), index: new Uint32Array(G.index) };
  }

  /** nb: 9 chunk arrays (or null), index (dz+1)*3 + (dx+1); [4] is the chunk itself. */
  function fillPadded(nb, bedrockId) {
    P.fill(0);
    P.fill(bedrockId, 0, PW * PW);          // solid floor so the world bottom is never drawn
    const c = nb[4];
    for (let y = 0; y < 64; y++) {
      for (let z = 0; z < 16; z++) {
        const src = (y * 16 + z) * 16, dst = ((y + 1) * PW + (z + 1)) * PW + 1;
        P.set(c.subarray(src, src + 16), dst);
      }
    }
    let n;
    if ((n = nb[3])) for (let y = 0; y < 64; y++) for (let z = 0; z < 16; z++) P[((y + 1) * PW + z + 1) * PW] = n[15 + z * 16 + y * 256];
    if ((n = nb[5])) for (let y = 0; y < 64; y++) for (let z = 0; z < 16; z++) P[((y + 1) * PW + z + 1) * PW + 17] = n[z * 16 + y * 256];
    if ((n = nb[1])) for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) P[((y + 1) * PW) * PW + x + 1] = n[x + 240 + y * 256];
    if ((n = nb[7])) for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) P[((y + 1) * PW + 17) * PW + x + 1] = n[x + y * 256];
    if ((n = nb[0])) for (let y = 0; y < 64; y++) P[((y + 1) * PW) * PW] = n[255 + y * 256];
    if ((n = nb[2])) for (let y = 0; y < 64; y++) P[((y + 1) * PW) * PW + 17] = n[240 + y * 256];
    if ((n = nb[6])) for (let y = 0; y < 64; y++) P[((y + 1) * PW + 17) * PW] = n[15 + y * 256];
    if ((n = nb[8])) for (let y = 0; y < 64; y++) P[((y + 1) * PW + 17) * PW + 17] = n[y * 256];
  }

  function cornerAO(l, su, sv, ou, ov) {
    const s1 = OPAQUE[P[l + ou * su]], s2 = OPAQUE[P[l + ov * sv]];
    const c = OPAQUE[P[l + ou * su + ov * sv]];
    return (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
  }

  function newLayer() {
    return { pos: [], uv: [], tile: [], shade: [], normal: [], edge: [], index: [], vcount: 0 };
  }

  function emitQuad(L, d, u, v, sign, face, i, ui, vi, w, h, key) {
    const tile = ((key >>> 8) & 0xfff) - 1, ao = key & 255, edges = (key >>> 20) & 15;
    const aoc = [ao & 3, (ao >> 2) & 3, (ao >> 4) & 3, (ao >> 6) & 3];
    let pd = i + (sign > 0 ? 1 : 0);
    if (tile === WATER_TILE && d === 1 && sign > 0) pd -= WATER_DROP;
    if (SMOOTH && edges) { emitBevelled(L, d, u, v, sign, pd, ui, vi, w, h, tile, aoc, edges); return; }
    const base = L.vcount, p = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      p[d] = pd; p[u] = ui + CU[k] * w; p[v] = vi + CV[k] * h;
      L.pos.push(p[0], p[1], p[2]);
      // side faces: texture "up" must be world +y (the u axis on x faces, v on z faces)
      if (d === 0) L.uv.push(CV[k] * h, CU[k] * w); else L.uv.push(CU[k] * w, CV[k] * h);
      L.tile.push(tile);
      if (SMOOTH) {                       // lit from the normal in the shader: only the occlusion is baked
        L.shade.push(AO_LEVEL[aoc[k]]);
        L.normal.push(d === 0 ? sign : 0, d === 1 ? sign : 0, d === 2 ? sign : 0);
        L.edge.push(9, 9, 9, 9);
      } else L.shade.push(FACE_SHADE[face] * AO_LEVEL[aoc[k]]);
    }
    // Flip the triangulation diagonal so AO gradients interpolate smoothly.
    const flip = aoc[0] + aoc[2] < aoc[1] + aoc[3];
    const q = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    if (sign > 0) for (let k = 0; k < 6; k++) L.index.push(base + q[k]);
    else for (let k = 0; k < 6; k += 3) L.index.push(base + q[k], base + q[k + 2], base + q[k + 1]);
    L.vcount += 4;
  }

  /**
   * Story: a face with outside corners, chamfered. The face is inset by BEV on each corner edge and adds half of the
   * bevel there: a strip from its inset edge to the middle line of the bevel, where the neighbouring face's half meets it
   * (both lie in the same 45 degree plane). Where two corner edges meet, a triangle closes the face's share of the
   * block's corner. `edge` carries the distance to each corner edge (0 on the middle line), so the shader turns the light
   * smoothly over the bevel.
   */
  const BEV = 0.07;
  function emitBevelled(L, d, u, v, sign, pd, ui, vi, w, h, tile, aoc, edges) {
    const E0 = edges & 1, E1 = edges & 2, E2 = edges & 4, E3 = edges & 8, c = BEV, hc = c / 2;
    const p = [0, 0, 0];
    // a vertex at face coordinates (lu, lv) from the quad's corner, ph along the normal (negative: into the block)
    const vert = (lu, lv, ph, e0, e1, e2, e3) => {
      p[d] = pd + ph * sign; p[u] = ui + lu; p[v] = vi + lv;
      L.pos.push(p[0], p[1], p[2]);
      if (d === 0) L.uv.push(lv, lu); else L.uv.push(lu, lv);
      L.tile.push(tile);
      const s = Math.min(1, Math.max(0, lu / w)), t = Math.min(1, Math.max(0, lv / h));     // occlusion: bilinear over the face
      L.shade.push(AO_LEVEL[aoc[0]] * (1 - s) * (1 - t) + AO_LEVEL[aoc[1]] * s * (1 - t) + AO_LEVEL[aoc[2]] * s * t + AO_LEVEL[aoc[3]] * (1 - s) * t);
      L.normal.push(d === 0 ? sign : 0, d === 1 ? sign : 0, d === 2 ? sign : 0);
      L.edge.push(E0 ? e0 : 9, E1 ? e1 : 9, E2 ? e2 : 9, E3 ? e3 : 9);
      return L.vcount++;
    };
    // triangles keep the face's winding (u x v = +d; flipped for the back faces)
    const tri = (a, b, cc) => { if (sign > 0) L.index.push(a, b, cc); else L.index.push(a, cc, b); };
    const quad = (a, b, cc, dd) => { tri(a, b, cc); tri(a, cc, dd); };
    const u0 = E0 ? c : 0, u1 = w - (E1 ? c : 0), v0 = E2 ? c : 0, v1 = h - (E3 ? c : 0);
    // distances to the four edges of a point on the face plane
    const fv = (lu, lv) => vert(lu, lv, 0, lu, w - lu, lv, h - lv);
    quad(fv(u0, v0), fv(u1, v0), fv(u1, v1), fv(u0, v1));
    // half bevels along each corner edge (the middle line: hc in from the edge and hc into the block)
    if (E0) quad(vert(hc, v0, -hc, 0, w, v0, h - v0), vert(u0, v0, 0, u0, w - u0, v0, h - v0), vert(u0, v1, 0, u0, w - u0, v1, h - v1), vert(hc, v1, -hc, 0, w, v1, h - v1));
    if (E1) quad(vert(u1, v0, 0, u1, w - u1, v0, h - v0), vert(w - hc, v0, -hc, w, 0, v0, h - v0), vert(w - hc, v1, -hc, w, 0, v1, h - v1), vert(u1, v1, 0, u1, w - u1, v1, h - v1));
    if (E2) quad(vert(u0, hc, -hc, u0, w - u0, 0, h), vert(u1, hc, -hc, u1, w - u1, 0, h), vert(u1, v0, 0, u1, w - u1, v0, h - v0), vert(u0, v0, 0, u0, w - u0, v0, h - v0));
    if (E3) quad(vert(u0, v1, 0, u0, w - u0, v1, h - v1), vert(u1, v1, 0, u1, w - u1, v1, h - v1), vert(u1, h - hc, -hc, u1, w - u1, h, 0), vert(u0, h - hc, -hc, u0, w - u0, h, 0));
    // corners where two corner edges meet: the face's triangle of the bevel, and its third of the block's corner
    const corner = (cu, cv, su, sv, eu, ev) => {
      // cu, cv: the corner; su, sv: +1 / -1 into the face; eu, ev: which edge components are the corner's
      const iu = cu + su * c, iv = cv + sv * c, mu = cu + su * hc, mv = cv + sv * hc, m3u = cu + su * c * 2 / 3, m3v = cv + sv * c * 2 / 3;        // the corner triangle's centre
      const ed = (lu, lv, a, b) => {
        const e = [lu, w - lu, lv, h - lv];
        if (a >= 0) e[eu] = 0;
        if (b >= 0) e[ev] = 0;
        return e;
      };
      const P0 = ed(iu, iv, -1, -1), PA = ed(mu, iv, 0, -1), PB = ed(iu, mv, -1, 0), PM = ed(m3u, m3v, 0, 0);
      const i0 = vert(iu, iv, 0, ...P0), iA = vert(mu, iv, -hc, ...PA), iB = vert(iu, mv, -hc, ...PB);
      const iM = vert(m3u, m3v, -c * 2 / 3, ...PM);
      // keep the winding the face's: the order depends on which corner this is
      if (su * sv > 0) { tri(i0, iA, iB); tri(iA, iM, iB); } else { tri(i0, iB, iA); tri(iA, iB, iM); }
    };
    if (E0 && E2) corner(0, 0, 1, 1, 0, 2);
    if (E1 && E2) corner(w, 0, -1, 1, 1, 2);
    if (E1 && E3) corner(w, h, -1, -1, 1, 3);
    if (E0 && E3) corner(0, h, 1, -1, 0, 3);
  }

  function packLayer(L) {
    const o = {
      pos: new Float32Array(L.pos), uv: new Float32Array(L.uv),
      tile: new Float32Array(L.tile), shade: new Float32Array(L.shade),
      index: new Uint32Array(L.index),
    };
    if (SMOOTH) { o.normal = new Float32Array(L.normal); o.edge = new Float32Array(L.edge); }
    return o;
  }

  function meshChunk(nb, bedrockId, cx, cz) {
    fillPadded(nb, bedrockId);
    const solidL = newLayer(), waterL = newLayer();
    if (SMOOTH) columnTops(nb, cx | 0, cz | 0);

    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3, v = (d + 2) % 3;          // (u, v, d) is right-handed: u x v = +d
      const du = DIMS[u], dv = DIMS[v], dd = DIMS[d];
      const sd = STR[d], su = STR[u], sv = STR[v];
      for (let sign = 1; sign >= -1; sign -= 2) {
        const face = d * 2 + (sign > 0 ? 0 : 1), step = sign * sd;
        for (let i = 0; i < dd; i++) {
          // 1. mask of visible faces in this slice
          let n = 0, any = false;
          for (let vi = 0; vi < dv; vi++) {
            for (let ui = 0; ui < du; ui++, n++) {
              mask[n] = 0;
              const idx = PBASE + i * sd + ui * su + vi * sv;
              const a = P[idx];
              if (a === 0) continue;
              const l = idx + step, b = P[l];
              if ((OPAQUE[b] && !asProp(b, l)) || a === b) continue;
              if (asProp(a, idx)) continue;                                  // drawn as a prop (ivy, an awning, a bed)
              if (SMOOTH && GROUND[a] === 1) {
                // natural ground is drawn by the smooth skin: no cube tops, and no cube sides towards another ground column
                // (one skin, or a cliff that emitSkirts closes)
                const bx = d === 0 ? i : d === 1 ? vi : ui, by = d === 0 ? ui : d === 1 ? i : vi, bz = d === 0 ? vi : d === 1 ? ui : i;
                const tl = colTop(bx, bz);
                if (tl >= 0) {
                  if (d === 1) { if (sign > 0 && by === tl) continue; }
                  else if (colTop(d === 0 ? bx + sign : bx, d === 2 ? bz + sign : bz) >= 0) continue;
                }
              }
              const tile = FACE_TILES[a * 6 + face];
              if (tile < 0) continue;                                       // markers with no cube of their own (palm trunks)
              if (SMOOTH && PROP[a] === 2) continue;                         // reeds are drawn as geometry, not as a bush cube
              let ao = 255;
              if (!LIQUID[a]) {
                ao = cornerAO(l, su, sv, -1, -1) | (cornerAO(l, su, sv, 1, -1) << 2)
                   | (cornerAO(l, su, sv, 1, 1) << 4) | (cornerAO(l, su, sv, -1, 1) << 6);
              }
              // story: which edges of this face are outside corners (the block beside it, and the cell in front of that, open)
              let edges = 0;
              if (SMOOTH && OPAQUE[a] && !LIQUID[a]) {
                if (!OPAQUE[P[idx - su]] && !OPAQUE[P[l - su]]) edges |= 1;
                if (!OPAQUE[P[idx + su]] && !OPAQUE[P[l + su]]) edges |= 2;
                if (!OPAQUE[P[idx - sv]] && !OPAQUE[P[l - sv]]) edges |= 4;
                if (!OPAQUE[P[idx + sv]] && !OPAQUE[P[l + sv]]) edges |= 8;
              }
              mask[n] = (edges << 20) | ((tile + 1) << 8) | ao;
              any = true;
            }
          }
          if (!any) continue;
          // 2. greedy merge
          for (let vi = 0; vi < dv; vi++) {
            for (let ui = 0; ui < du;) {
              const key = mask[vi * du + ui];
              if (!key) { ui++; continue; }
              const ao = key & 255;
              let w = 1, h = 1;
              if (ao === (ao & 3) * 0x55) {            // uniform AO -> may merge
                while (ui + w < du && mask[vi * du + ui + w] === key) w++;
                grow: while (vi + h < dv) {
                  for (let k = 0; k < w; k++) if (mask[(vi + h) * du + ui + k] !== key) break grow;
                  h++;
                }
              }
              const layer = (((key >>> 8) & 0xfff) - 1) === WATER_TILE ? waterL : solidL;
              emitQuad(layer, d, u, v, sign, face, i, ui, vi, w, h, key);
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[(vi + y) * du + ui + x] = 0;
              ui += w;
            }
          }
        }
      }
    }
    const out = { opaque: packLayer(solidL), water: packLayer(waterL) };
    if (SMOOTH) {
      const G = newGround(); emitGround(G); out.ground = packGround(G);
      out.props = packProps(propsOf(nb[4], cx | 0, cz | 0));
      if (GRASS > 0) out.grass = packProps(emitGrass(nb[4], cx | 0, cz | 0));
    }
    return out;
  }
});
