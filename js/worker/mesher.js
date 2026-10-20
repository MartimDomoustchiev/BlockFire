/* Worker module: greedy chunk mesher with per-vertex ambient occlusion. */
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
  function setupMesher(tables) {
    OPAQUE = tables.opaque; LIQUID = tables.liquid;
    FACE_TILES = tables.faceTiles; WATER_TILE = tables.waterTile;
    P.fill(0);
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
    return { pos: [], uv: [], tile: [], shade: [], index: [], vcount: 0 };
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
      L.shade.push(FACE_SHADE[face] * AO_LEVEL[aoc[k]]);
    }
    // Flip the triangulation diagonal so AO gradients interpolate smoothly.
    const flip = aoc[0] + aoc[2] < aoc[1] + aoc[3];
    const q = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    if (sign > 0) for (let k = 0; k < 6; k++) L.index.push(base + q[k]);
    else for (let k = 0; k < 6; k += 3) L.index.push(base + q[k], base + q[k + 2], base + q[k + 1]);
    L.vcount += 4;
  }

  function packLayer(L) {
    return {
      pos: new Float32Array(L.pos), uv: new Float32Array(L.uv),
      tile: new Float32Array(L.tile), shade: new Float32Array(L.shade),
      index: new Uint32Array(L.index),
    };
  }

  function meshChunk(nb, bedrockId) {
    fillPadded(nb, bedrockId);
    const solidL = newLayer(), waterL = newLayer();

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
              const tile = FACE_TILES[a * 6 + face];
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
    return { opaque: packLayer(solidL), water: packLayer(waterL) };
  }
});
