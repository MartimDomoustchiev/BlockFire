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
  let SMOOTH = false, GROUND = null, GCOL = null, PROP = null;
  function setupMesher(tables, smooth) {
    OPAQUE = tables.opaque; LIQUID = tables.liquid;
    FACE_TILES = tables.faceTiles; WATER_TILE = tables.waterTile;
    SMOOTH = !!smooth && !!tables.ground;
    GROUND = tables.ground; GCOL = tables.groundColor; PROP = tables.prop;      // 1 = natural ground, 2 = a prop that stands on it (trunks, leaves, hay, bushes)
    P.fill(0);
  }

  // ---- smooth ground: per-column tops of the 20 x 20 columns around (and including) the chunk -------------
  const CW = 20, TOP = new Int16Array(CW * CW), TOPID = new Uint8Array(CW * CW), CR = new Float32Array(CW * CW), CG = new Float32Array(CW * CW), CB = new Float32Array(CW * CW);
  const LINK_DY = 1;                                     // columns this close in height are one skin; more is a cliff (cubes)
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
  }
  // ---- props: palms and reeds as real geometry, wherever the voxel data has their marker blocks ----------
  function newProps() { return { pos: [], normal: [], color: [], sway: [], index: [], vcount: 0 }; }
  const pvert = (G, x, y, z, nx, ny, nz, r, g, b, sw) => { G.pos.push(x, y, z); G.normal.push(nx, ny, nz); G.color.push(r, g, b); G.sway.push(sw); return G.vcount++; };
  const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const rngOf = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hashOf = (x, y, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return h ^ (h >>> 16); };

  /** A leaf strip: a bent centre line with a width that swells and tapers, folded into a shallow V. pts: [x, y, z, halfWidth, t] */
  function strip(G, pts, sx, sz, c0, c1, sway0, sway1, fold) {
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], t = p[4], a = pts[Math.min(pts.length - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      const tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
      // surface normal = side x tangent, the same side the winding faces (the shader flips it for the back); tilted a little
      // to each edge so the fold shades like a leaf
      const n = nrm(-sz * ty, sz * tx - sx * tz, sx * ty);
      const r = c0[0] + (c1[0] - c0[0]) * t, g = c0[1] + (c1[1] - c0[1]) * t, bl = c0[2] + (c1[2] - c0[2]) * t, sw = sway0 + (sway1 - sway0) * t;
      const nl = nrm(n[0] + sx * 0.4, n[1], n[2] + sz * 0.4), nr = nrm(n[0] - sx * 0.4, n[1], n[2] - sz * 0.4);
      const L = pvert(G, p[0] + sx * p[3], p[1] + p[3] * fold, p[2] + sz * p[3], nl[0], nl[1], nl[2], r, g, bl, sw);
      const R = pvert(G, p[0] - sx * p[3], p[1] + p[3] * fold, p[2] - sz * p[3], nr[0], nr[1], nr[2], r, g, bl, sw);
      if (prev) { G.index.push(prev[0], L, prev[1], prev[1], L, R); }
      prev = [L, R];
    }
  }

  function emitPalm(G, px, py, pz, H, seed) {
    const r = rngOf(seed), lean = 0.2 + r() * 0.55, la = r() * Math.PI * 2, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const y0 = py - 0.6, top = H + 0.6 + 0.3, RINGS = 6, SEG = 6, base = G.vcount;
    const at = (t) => [px + lx * t * t, y0 + top * t, pz + lz * t * t];
    for (let k = 0; k < RINGS; k++) {
      const t = k / (RINGS - 1), c = at(t), rad = 0.33 - 0.1 * t + (t < 0.16 ? 0.13 * (1 - t / 0.16) : 0), band = k % 2 ? 0.88 : 1;
      const cr = (0.5 + 0.06 * r()) * band, cg = (0.38 + 0.05 * r()) * band, cb = (0.25 + 0.04 * r()) * band;
      for (let s = 0; s < SEG; s++) {
        const a = s / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), n = nrm(ca, 0.12, sa);
        pvert(G, c[0] + ca * rad, c[1], c[2] + sa * rad, n[0], n[1], n[2], cr, cg, cb, t * t * 0.35);
      }
    }
    for (let k = 0; k < RINGS - 1; k++) {
      for (let s = 0; s < SEG; s++) {
        const i0 = base + k * SEG + s, i1 = base + k * SEG + (s + 1) % SEG, j0 = base + (k + 1) * SEG + s, j1 = base + (k + 1) * SEG + (s + 1) % SEG;
        G.index.push(i0, j0, i1, i1, j0, j1);
      }
    }
    // the crown: a ring of drooping fronds, a few upright ones in the middle, a bunch of dates
    const T = at(1), NF = 7 + Math.floor(r() * 2);
    for (let f = 0; f < NF + 3; f++) {
      const inner = f >= NF, a = (inner ? (f - NF) / 3 : f / NF) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const L = inner ? 1.3 + r() * 0.5 : 2.1 + r() * 0.9, pitch = inner ? 1.5 : 0.8 + r() * 0.3, droop = inner ? 1.4 : 1.25 + r() * 0.45;
      const ca = Math.cos(a), sa = Math.sin(a), pts = [], SEGF = 4;
      for (let i = 0; i <= SEGF; i++) {
        const sP = i / SEGF, d = L * sP * (inner ? 0.55 : 0.92), h = L * (pitch * sP - droop * sP * sP) * (inner ? 0.7 : 1);
        const w = 0.6 * Math.sin(Math.PI * (0.09 + 0.84 * sP)) * (1 - 0.5 * sP * sP) * (inner ? 0.7 : 1);
        pts.push([T[0] + ca * d, T[1] + 0.1 + h, T[2] + sa * d, w, sP]);
      }
      const tint = 0.9 + r() * 0.2;
      strip(G, pts, -sa, ca, [0.17 * tint, 0.34 * tint, 0.11 * tint], [0.42 * tint, 0.58 * tint, 0.18 * tint], 0.3, 1.0, 0.14);
    }
    for (let k = 0; k < 2; k++) {          // dates
      const a = r() * Math.PI * 2, cx = T[0] + Math.cos(a) * 0.22, cz = T[2] + Math.sin(a) * 0.22, cy = T[1] - 0.18, q = 0.13, c = [0.42, 0.24, 0.1];
      const v = [pvert(G, cx, cy + q, cz, 0, 1, 0, c[0], c[1], c[2], 0.5), pvert(G, cx + q, cy, cz, 1, 0, 0, c[0], c[1], c[2], 0.5), pvert(G, cx, cy, cz + q, 0, 0, 1, c[0], c[1], c[2], 0.5),
        pvert(G, cx - q, cy, cz, -1, 0, 0, c[0], c[1], c[2], 0.5), pvert(G, cx, cy, cz - q, 0, 0, -1, c[0], c[1], c[2], 0.5), pvert(G, cx, cy - q, cz, 0, -1, 0, c[0], c[1], c[2], 0.5)];
      G.index.push(v[0], v[2], v[1], v[0], v[3], v[2], v[0], v[4], v[3], v[0], v[1], v[4], v[5], v[1], v[2], v[5], v[2], v[3], v[5], v[3], v[4], v[5], v[4], v[1]);
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

  function propsOf(c, cx, cz) {
    const G = newProps();
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        for (let y = 1; y < 63; y++) {
          const k = PROP[c[x + z * 16 + y * 256]];
          if (!k) continue;
          const seed = hashOf(cx * 16 + x, y, cz * 16 + z);
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
    return { pos: new Float32Array(G.pos), normal: new Float32Array(G.normal), color: new Float32Array(G.color), sway: new Float32Array(G.sway), index: new Uint32Array(G.index) };
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
    return { pos: [], uv: [], tile: [], shade: [], normal: [], index: [], vcount: 0 };
  }

  function emitQuad(L, d, u, v, sign, face, i, ui, vi, w, h, key) {
    const tile = (key >> 8) - 1, ao = key & 255;
    const aoc = [ao & 3, (ao >> 2) & 3, (ao >> 4) & 3, (ao >> 6) & 3];
    let pd = i + (sign > 0 ? 1 : 0);
    if (tile === WATER_TILE && d === 1 && sign > 0) pd -= WATER_DROP;
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
      } else L.shade.push(FACE_SHADE[face] * AO_LEVEL[aoc[k]]);
    }
    // Flip the triangulation diagonal so AO gradients interpolate smoothly.
    const flip = aoc[0] + aoc[2] < aoc[1] + aoc[3];
    const q = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    if (sign > 0) for (let k = 0; k < 6; k++) L.index.push(base + q[k]);
    else for (let k = 0; k < 6; k += 3) L.index.push(base + q[k], base + q[k + 2], base + q[k + 1]);
    L.vcount += 4;
  }

  function packLayer(L) {
    const o = {
      pos: new Float32Array(L.pos), uv: new Float32Array(L.uv),
      tile: new Float32Array(L.tile), shade: new Float32Array(L.shade),
      index: new Uint32Array(L.index),
    };
    if (SMOOTH) o.normal = new Float32Array(L.normal);
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
              if (OPAQUE[b] || a === b) continue;
              if (SMOOTH && GROUND[a] === 1) {
                // natural ground is drawn by the smooth skin: no cube tops, and no cube sides between neighbours of one skin
                const bx = d === 0 ? i : d === 1 ? vi : ui, by = d === 0 ? ui : d === 1 ? i : vi, bz = d === 0 ? vi : d === 1 ? ui : i;
                const tl = colTop(bx, bz);
                if (tl >= 0) {
                  if (d === 1) { if (sign > 0 && by === tl) continue; }
                  else if (linked(tl, colTop(d === 0 ? bx + sign : bx, d === 2 ? bz + sign : bz))) continue;
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
              mask[n] = ((tile + 1) << 8) | ao;
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
              const layer = ((key >> 8) - 1) === WATER_TILE ? waterL : solidL;
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
    }
    return out;
  }
});
