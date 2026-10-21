/* ============================================================
 * Story mode's texture atlas: 128 x 128 px tiles painted from tileable noise (no image files), with mip-maps.
 * Same tile numbers as the classic atlas (TILE in world/blocks.js), so the same blocks pick the same slots, but the
 * art is another world's: sandstone ashlar, limewashed mudbrick, acacia beams, palm planks, terracotta, linen awnings,
 * straw, papyrus. Every tile wraps without a seam (the mesher repeats tiles over merged faces).
 * ============================================================ */
function buildStoryAtlas() {
  const N = CONFIG.ATLAS_TILES, PX = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N * PX;
  const ctx = canvas.getContext('2d');

  // ---- tileable value noise ------------------------------------------------------------------
  const ihash = (x, y, s) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  /** value noise over the unit tile with f x f lattice cells that wrap: u, v in [0, 1) */
  const nz = (u, v, f, s) => {
    const x = u * f, y = v * f, ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const w = (a) => ((a % f) + f) % f;
    const a = ihash(w(ix), w(iy), s), b = ihash(w(ix + 1), w(iy), s), c = ihash(w(ix), w(iy + 1), s), d = ihash(w(ix + 1), w(iy + 1), s);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
  const fbm = (u, v, f, s, oct = 4) => {
    let sum = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < oct; o++) { sum += nz(u, v, f << o, s + o * 17) * amp; tot += amp; amp *= 0.5; }
    return sum / tot;
  };
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  /** distance in [0, 0.5] from the nearest edge of a cell of size (cw, ch) at (u, v), 0 at the edge */
  const cellEdge = (u, v, cw, ch, ox = 0) => {
    const x = (((u - ox) / cw) % 1 + 1) % 1, y = ((v / ch) % 1 + 1) % 1;
    return { d: Math.min(x, 1 - x, y, 1 - y), dt: Math.min(Math.min(x, 1 - x) * cw, Math.min(y, 1 - y) * ch), x, y, ix: Math.floor((u - ox) / cw), iy: Math.floor(v / ch) };
  };

  const tile = (idx, painter) => {
    const img = ctx.createImageData(PX, PX);
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        const c = painter((x + 0.5) / PX, (y + 0.5) / PX, x, y);
        const o = (y * PX + x) * 4;
        img.data[o] = clamp(c[0], 0, 255); img.data[o + 1] = clamp(c[1], 0, 255); img.data[o + 2] = clamp(c[2], 0, 255); img.data[o + 3] = c.length > 3 ? c[3] : 255;
      }
    }
    ctx.putImageData(img, (idx % N) * PX, Math.floor(idx / N) * PX);
  };
  const grain = (u, v, s, k = 0.06) => 1 + (ihash(Math.floor(u * PX), Math.floor(v * PX), s) - 0.5) * k * 2;

  // ---- the materials ----------------------------------------------------------------------------
  const SAND = [222, 192, 134], LIME = [226, 214, 184], MUD = [186, 140, 94];

  const sand = (u, v) => {
    const rip = Math.sin((u * 3 + fbm(u, v, 4, 3) * 1.4) * Math.PI * 2) * 0.5 + 0.5;
    return mul(mix(SAND, [236, 208, 152], fbm(u, v, 4, 11)), (0.9 + 0.12 * rip) * (0.92 + 0.16 * fbm(u, v, 16, 12)) * grain(u, v, 5, 0.05));
  };
  tile(TILE.SAND, sand);
  tile(TILE.DIRT, (u, v) => {
    const c = mix([128, 96, 66], [156, 120, 84], fbm(u, v, 4, 21));
    const peb = ihash(Math.floor(u * 16), Math.floor(v * 16), 4) > 0.92 ? 0.82 : 1;
    return mul(c, (0.9 + 0.2 * fbm(u, v, 16, 22)) * peb * grain(u, v, 6, 0.05));
  });
  tile(TILE.GRASS_TOP, (u, v) => mul(mix([98, 126, 52], [128, 152, 66], fbm(u, v, 8, 31)), 0.88 + 0.24 * fbm(u, v, 24, 32) * grain(u, v, 7, 0.1)));
  tile(TILE.GRASS_SIDE, (u, v) => (v < 0.2 + 0.08 * fbm(u, v, 8, 33)
    ? mul(mix([98, 126, 52], [128, 152, 66], fbm(u, v, 8, 31)), 0.9 + 0.2 * fbm(u, v, 24, 32))
    : mul(mix([128, 96, 66], [156, 120, 84], fbm(u, v, 4, 21)), 0.9 + 0.2 * fbm(u, v, 16, 22))));
  /** limestone: layered rock with fissures */
  const rock = (u, v, s = 40) => {
    const layer = Math.sin((v * 5 + fbm(u, v, 3, s) * 1.6) * Math.PI * 2) * 0.5 + 0.5;
    const crack = smooth(0.46, 0.5, Math.abs(fbm(u, v, 6, s + 3) - 0.5));
    return mul(mix([168, 154, 130], [204, 190, 160], fbm(u, v, 4, s + 1)), (0.88 + 0.12 * layer) * (0.8 + 0.2 * crack) * (0.9 + 0.2 * fbm(u, v, 20, s + 2)) * grain(u, v, 8, 0.05));
  };
  tile(TILE.STONE, rock);
  tile(TILE.SNOW, (u, v) => mul([238, 240, 244], 0.96 + 0.06 * fbm(u, v, 8, 50)));
  tile(TILE.BEDROCK, (u, v) => mul([78, 72, 66], 0.8 + 0.4 * fbm(u, v, 8, 51)));

  /** sandstone ashlar: three courses of cut blocks of uneven length (each course splits the tile its own way, so the
      tile still wraps), the arrises worn round, sandy mortar, pits and a patina; light from the top left */
  const ashlar = (u, v) => {
    const rows = 3, row = Math.min(rows - 1, Math.floor(v * rows)), y = v * rows - row;
    // where this course's joints fall: two or three stones, the first joint anywhere
    const n = 2 + (ihash(row, 1, 64) > 0.55 ? 1 : 0), start = ihash(row, 2, 65);
    let x = ((u - start) % 1 + 1) % 1, k = 0, len = 1 / n;
    const cuts = [0];
    for (let i = 1; i < n; i++) cuts.push(i / n + (ihash(row, 10 + i, 66) - 0.5) * 0.5 / n);
    cuts.push(1);
    for (let i = 0; i < n; i++) if (x >= cuts[i] && x < cuts[i + 1]) { k = i; len = cuts[i + 1] - cuts[i]; x = (x - cuts[i]) / len; }
    const id = row * 7 + k;
    // distance to the stone's edge in tile units, the edge wandering a little (eroded arrises)
    const wob = (fbm(u, v, 16, 67) - 0.5) * 0.016;
    const dx = Math.min(x, 1 - x) * len, dy = Math.min(y, 1 - y) / rows, d = Math.min(dx, dy) + wob;
    const tone = 0.88 + 0.22 * ihash(id, row, 61);
    const warm = ihash(id, 3, 68);
    let c = mix([206, 176, 124], [226, 198, 146], fbm(u, v, 4, 62));
    c = mix(c, [214, 172, 116], warm * 0.35);
    c = mul(c, tone * (0.92 + 0.16 * fbm(u, v, 24, 63)) * grain(u, v, 9, 0.035));
    // pits and a darker patina in the hollows
    const pit = smooth(0.78, 0.86, fbm(u, v, 32, 69));
    c = mul(c, 1 - pit * 0.22);
    // worn edges: the face rounds off into the joint, the joint is sandy mortar a little darker than the stone
    const edge = smooth(0.003, 0.03, d);
    const joint = [168, 142, 102];
    c = mix(joint, c, 0.35 + 0.65 * edge);
    const lit = (1 - smooth(0.0, 0.04, dy + wob)) * (y > 0.5 ? 0.09 : -0.1) + (1 - smooth(0.0, 0.03, dx + wob)) * (x < 0.5 ? 0.04 : -0.05);
    return mul(c, 1 + lit * edge);
  };
  tile(TILE.COBBLE, ashlar);
  tile(TILE.BUILD_STONE, ashlar);

  /** mudbrick under a thin limewash that has worn through in places */
  const mudbrick = (u, v) => {
    const row = Math.floor(v * 8), off = (row % 2) * 0.125;
    const e = cellEdge(u, v, 0.25, 0.125, off);
    const tone = 0.86 + 0.28 * ihash(e.ix + row * 5, row, 71);
    let c = mul(mix([176, 128, 84], [204, 160, 110], fbm(u, v, 6, 72)), tone * grain(u, v, 10, 0.07));
    const straw = ihash(Math.floor(u * 32), Math.floor(v * 64), 73) > 0.965;
    if (straw) c = mix(c, [226, 196, 120], 0.8);
    c = mix(c, [104, 74, 48], (1 - smooth(0.004, 0.02, e.dt)) * 0.9);
    return c;
  };
  tile(TILE.BRICK, mudbrick);
  tile(TILE.PLASTER, (u, v) => {
    const wash = fbm(u, v, 3, 80), worn = smooth(0.58, 0.7, fbm(u, v, 5, 81));
    let c = mul(mix([232, 222, 196], [220, 206, 176], wash), 0.94 + 0.1 * fbm(u, v, 24, 82) * grain(u, v, 11, 0.05));
    c = mix(c, mudbrick(u, v), worn * 0.7);                                          // the brick shows through where the wash wore off
    const crack = smooth(0.485, 0.5, Math.abs(fbm(u, v, 7, 83) - 0.5));
    return mul(c, 0.82 + 0.18 * crack);
  });

  /** acacia beams: long grain with knots */
  const wood = (u, v, base, lite, s) => {
    const g = fbm(u * 1.0, v * 0.12, 2, s, 5) * 0.6 + fbm(u * 6, v * 0.5, 4, s + 5, 3) * 0.4;
    const knot = smooth(0.15, 0.0, Math.hypot((u - 0.7) * 1.0, (v - 0.35) * 2.0));
    return mul(mix(base, lite, g), (0.9 + 0.2 * fbm(u, v, 24, s + 9)) * (1 - knot * 0.25) * grain(u, v, s, 0.04));
  };
  tile(TILE.TIMBER, (u, v) => wood(u, v, [92, 62, 40], [128, 90, 56], 90));
  tile(TILE.LOG_SIDE, (u, v) => {
    // palm trunk: ringed where the fronds fell
    const ring = smooth(0.42, 0.5, Math.abs(((v * 8) % 1) - 0.5)) * 0.35 + 0.65;
    return mul(wood(u, v, [150, 116, 76], [190, 152, 104], 91), ring);       // sun-bleached palm, not wet bark
  });
  tile(TILE.LOG_TOP, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    const ring = Math.sin(d * 46 + fbm(u, v, 4, 92) * 3) * 0.5 + 0.5;
    return d > 0.46 ? [104, 78, 52] : mul(mix([150, 112, 72], [186, 146, 96], ring), 0.94 + 0.1 * fbm(u, v, 12, 93));
  });
  const plankBoards = (u, v, s, lite) => {
    const row = Math.floor(v * 4), e = (v * 4) % 1;
    const tone = 0.86 + 0.28 * ihash(row, s, 101);
    let c = mul(wood(u + ihash(row, s, 102), v * 4, [172, 134, 88], lite, s), tone);
    c = mix(c, [80, 56, 34], (1 - smooth(0.0, 0.06, Math.min(e, 1 - e))) * 0.8);
    const nail = Math.hypot(((u * 4) % 1) - 0.5, e - 0.5) < 0.04 && (Math.floor(u * 4) % 2 === 0);
    return nail ? [70, 60, 56] : c;
  };
  tile(TILE.PLANKS, (u, v) => plankBoards(u, v, 111, [204, 166, 112]));
  tile(TILE.BUILD_WOOD, (u, v) => plankBoards(u, v, 112, [210, 172, 116]));
  tile(TILE.BUILD_METAL, (u, v) => { const e = cellEdge(u, v, 0.5, 0.5); return mul(mix([150, 124, 78], [190, 158, 98], fbm(u, v, 8, 113)), 0.7 + 0.5 * smooth(0, 0.06, e.d)); });

  /** terracotta tiles in overlapping courses */
  tile(TILE.ROOF, (u, v) => {
    const row = Math.floor(v * 8), off = (row % 2) * 0.125, e = cellEdge(u, v, 0.25, 0.125, off);
    const tone = 0.84 + 0.3 * ihash(e.ix + row * 3, row, 120);
    const roll = 1 - 0.34 * smooth(0.6, 1.0, e.y);                  // each course shades down towards its lower edge
    const c = mul(mix([172, 88, 56], [200, 112, 70], fbm(u, v, 6, 121)), tone * roll * grain(u, v, 12, 0.05));
    return mix(c, [96, 44, 30], (1 - smooth(0.004, 0.02, Math.min(e.x, 1 - e.x) * 0.25)) * 0.7);
  });

  /** palm leaves (cut out) */
  tile(TILE.LEAVES, (u, v) => {
    const blade = fbm(u * 2, v, 4, 130, 3), a = blade > 0.34 ? 255 : 0;
    const c = mul(mix([52, 112, 44], [110, 160, 62], fbm(u, v, 6, 131)), 0.8 + 0.4 * fbm(u, v, 18, 132));
    return [c[0], c[1], c[2], a];
  });
  /** papyrus reeds (cut out) */
  tile(TILE.BUSH, (u, v) => {
    const stalk = Math.abs(((u * 9 + fbm(u, v, 3, 140) * 0.7) % 1) - 0.5);
    const a = stalk < 0.22 && v > 0.04 * (1 + Math.floor(u * 9) % 3) ? 255 : 0;
    const c = mul(mix([60, 110, 48], [128, 164, 72], v), 0.8 + 0.4 * fbm(u, v, 12, 141));
    return [c[0], c[1], c[2], a];
  });
  tile(TILE.CACTUS_SIDE, (u, v) => {
    const rib = Math.sin(u * Math.PI * 8) * 0.5 + 0.5;
    const spine = ihash(Math.floor(u * 32), Math.floor(v * 32), 150) > 0.97;
    return spine ? [230, 224, 176] : mul(mix([46, 112, 56], [74, 146, 78], rib), 0.9 + 0.2 * fbm(u, v, 12, 151));
  });
  tile(TILE.CACTUS_TOP, (u, v) => mul(mix([62, 134, 72], [90, 164, 92], fbm(u, v, 6, 152)), 0.9 + 0.2 * Math.hypot(u - 0.5, v - 0.5)));

  /** straw bundles bound with twine */
  const strawField = (u, v, s) => {
    const stroke = fbm(u * 0.5, v * 12, 3, s, 3);
    return mul(mix([196, 160, 76], [232, 198, 108], stroke), (0.88 + 0.24 * fbm(u, v, 20, s + 2)) * grain(u, v, s, 0.08));
  };
  tile(TILE.HAY_SIDE, (u, v) => {
    const band = smooth(0.06, 0.0, Math.abs(v - 0.28)) + smooth(0.06, 0.0, Math.abs(v - 0.72));
    return mix(strawField(u, v, 160), [112, 76, 44], clamp(band) * 0.9);
  });
  tile(TILE.HAY_TOP, (u, v) => mul(strawField(v, u, 161), 0.95));
  tile(TILE.PATH_TOP, (u, v) => {
    const peb = ihash(Math.floor(u * 12), Math.floor(v * 12), 170) > 0.86;
    return mul(mix([176, 146, 104], [150, 124, 88], fbm(u, v, 5, 171)), (peb ? 0.8 : 1) * (0.9 + 0.2 * fbm(u, v, 20, 172)));
  });

  /** linen awnings in lapis and cream, woven */
  const weave = (u, v) => 0.9 + 0.12 * (((Math.floor(u * 32) + Math.floor(v * 32)) % 2) ? 1 : 0) * 0.8 + 0.04 * (ihash(Math.floor(u * 64), Math.floor(v * 64), 180) - 0.5);
  tile(TILE.CLOTH, (u, v) => mul(Math.floor(u * 8) % 2 ? [236, 224, 190] : [40, 92, 150], weave(u, v)));
  tile(TILE.CANVAS, (u, v) => {
    const seam = smooth(0.012, 0.0, Math.abs(u - 0.5));
    return mul(mix([214, 198, 158], [196, 178, 138], fbm(u, v, 5, 181)), weave(u, v) * (1 - seam * 0.2));
  });
  tile(TILE.GLASS, (u, v) => {
    const e = cellEdge(u, v, 1, 1);
    if (e.d < 0.06) return [150, 132, 96, 255];
    const sheen = smooth(0.0, 0.5, 1 - Math.abs(u + v - 0.9) * 3);
    return [170 + 60 * sheen, 214 + 30 * sheen, 226 + 20 * sheen, 110 + 60 * sheen];
  });
  tile(TILE.BARS, (u, v) => {
    const bar = Math.abs(((u * 4) % 1) - 0.5) < 0.09, rail = Math.abs(((v * 2) % 1) - 0.5) < 0.05 || v < 0.05 || v > 0.95;
    if (!bar && !rail) return [0, 0, 0, 0];
    const c = mix([92, 78, 52], [150, 122, 70], fbm(u, v, 6, 190));
    return [c[0], c[1], c[2], 255];
  });
  tile(TILE.BOARD, (u, v) => {
    const papers = [[0.06, 0.1, 0.46, 0.46], [0.54, 0.06, 0.94, 0.4], [0.1, 0.56, 0.46, 0.94], [0.56, 0.5, 0.94, 0.88]];
    for (const [x0, y0, x1, y1] of papers) {
      if (u >= x0 && u <= x1 && v >= y0 && v <= y1) {
        if (Math.hypot(u - (x0 + 0.1), v - (y0 + 0.03)) < 0.03) return [168, 36, 36];
        const line = ((v - y0) * 14) % 1 < 0.4 && u > x0 + 0.04 && u < x1 - 0.04;
        return line ? [128, 112, 90] : mul([238, 226, 196], 0.94 + 0.08 * fbm(u, v, 12, 200));
      }
    }
    return plankBoards(u, v, 111, [204, 166, 112]);
  });
  const darkPlank = (u, v) => mul(plankBoards(u, v, 210, [150, 112, 72]), 0.62);
  tile(TILE.ARMS_SIDE, (u, v) => {
    const e = cellEdge(u, v, 1, 1);
    if (e.d < 0.06) return mix([150, 120, 70], [180, 148, 88], fbm(u, v, 8, 211));
    const blade = Math.abs(u - (0.5 - (v - 0.5) * 0.4)) < 0.035 && v > 0.2 && v < 0.78;
    if (blade) return v < 0.6 ? [224, 226, 230] : [170, 120, 60];
    return darkPlank(u, v);
  });
  tile(TILE.ARMS_TOP, (u, v) => { const e = cellEdge(u, v, 1, 1); return e.d < 0.06 || Math.abs(v - 0.5) < 0.03 ? [150, 122, 74] : darkPlank(u, v); });
  // blocks the story world does not use much: plain stand-ins, so nothing is ever a hole in the atlas
  for (const t of [TILE.WATER, TILE.IRON_ORE, TILE.GOLD_ORE, TILE.TABLE_TOP, TILE.TABLE_SIDE, TILE.FURNACE_FRONT, TILE.FURNACE_SIDE, TILE.FURNACE_TOP, TILE.CHEST_SIDE, TILE.CHEST_TOP]) {
    tile(t, (u, v) => (t === TILE.WATER ? mul([40, 110, 130], 0.9 + 0.2 * fbm(u, v, 8, 220)) : plankBoards(u, v, 230 + t, [204, 166, 112])));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.flipY = false;
  tex.userData = { tilePx: PX };
  return tex;
}
