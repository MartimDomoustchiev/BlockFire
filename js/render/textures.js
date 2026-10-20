/* ============================================================
 * Procedural texture atlas. Every tile is a 16x16 pixel pattern
 * painted onto a canvas - no image files are loaded.
 * ============================================================ */
function buildAtlasTexture() {
  const N = CONFIG.ATLAS_TILES, PX = CONFIG.TILE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N * PX;
  const ctx = canvas.getContext('2d');

  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const c8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  /** base colour with random brightness jitter */
  const jit = (r, c, v) => { const k = (r() - 0.5) * v; return [c[0] + k, c[1] + k, c[2] + k, 255]; };

  function tile(idx, painter) {
    const rng = mulberry(idx * 7919 + 13);
    const img = ctx.createImageData(PX, PX);
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        const c = painter(x, y, rng);
        const o = (y * PX + x) * 4;
        img.data[o] = c8(c[0]); img.data[o + 1] = c8(c[1]); img.data[o + 2] = c8(c[2]); img.data[o + 3] = c8(c[3]);
      }
    }
    ctx.putImageData(img, (idx % N) * PX, Math.floor(idx / N) * PX);
  }

  const stone = (x, y, r) => {
    const c = jit(r, [124, 124, 128], 28);
    if (r() < 0.07) { c[0] -= 26; c[1] -= 26; c[2] -= 26; }
    return c;
  };
  const oreOn = (color, blobs) => (x, y, r) => {
    for (const [bx, by] of blobs) {
      if (Math.abs(x - bx) + Math.abs(y - by) <= 1 && r() < 0.9) return jit(r, color, 24);
    }
    return stone(x, y, r);
  };

  tile(TILE.GRASS_TOP, (x, y, r) => jit(r, [92, 152, 50], 34));
  tile(TILE.DIRT, (x, y, r) => { const c = jit(r, [132, 94, 64], 26); if (r() < 0.05) { c[0] -= 30; c[1] -= 30; c[2] -= 30; } return c; });
  tile(TILE.GRASS_SIDE, (x, y, r) => {
    const edge = 3 + (((x * 5 + 1) % 4) < 2 ? 1 : 0);
    return y < edge ? jit(r, [92, 152, 50], 34) : jit(r, [132, 94, 64], 26);
  });
  tile(TILE.STONE, stone);
  tile(TILE.SAND, (x, y, r) => jit(r, [220, 208, 152], 18));
  tile(TILE.LOG_SIDE, (x, y, r) => {
    const c = jit(r, [104, 80, 48], 16);
    if ((x * 3) % 5 === 0) { c[0] -= 24; c[1] -= 20; c[2] -= 14; }
    return c;
  });
  tile(TILE.LOG_TOP, (x, y, r) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d >= 7) return jit(r, [92, 68, 40], 10);
    return jit(r, Math.floor(d) % 2 ? [150, 114, 68] : [176, 140, 88], 10);
  });
  tile(TILE.LEAVES, (x, y, r) => {
    if (r() < 0.18) return [0, 0, 0, 0];
    const c = jit(r, [50, 130, 42], 44); return c;
  });
  tile(TILE.GLASS, (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [196, 228, 240, 255];
    if ((x === 3 && y === 3) || (x === 4 && y === 4) || (x === 5 && y === 5) || (x === 10 && y === 11) || (x === 11 && y === 12)) return [225, 244, 252, 255];
    return [0, 0, 0, 0];
  });
  tile(TILE.BRICK, (x, y, r) => {
    const row = Math.floor(y / 4);
    if (y % 4 === 3 || (x + (row % 2 ? 4 : 0)) % 8 === 7) return jit(r, [186, 180, 170], 14);
    return jit(r, [158, 68, 52], 26);
  });
  tile(TILE.IRON_ORE, oreOn([218, 172, 142], [[3, 4], [10, 3], [6, 11], [12, 12], [13, 7]]));
  tile(TILE.GOLD_ORE, oreOn([252, 216, 66], [[4, 3], [11, 5], [5, 10], [11, 12], [2, 13]]));
  tile(TILE.WATER, (x, y, r) => {
    const c = jit(r, [44, 104, 208], 18);
    if (((x + y * 2) % 7) === 0) { c[0] += 22; c[1] += 22; c[2] += 18; }
    return c;
  });
  tile(TILE.BUILD_WOOD, (x, y, r) => {
    if (x % 4 === 3) return jit(r, [128, 92, 54], 12);
    return jit(r, [198, 152, 94], 14);
  });
  tile(TILE.BUILD_STONE, (x, y, r) => {
    const row = Math.floor(y / 8);
    if (y % 8 === 7 || (x + (row % 2 ? 8 : 0)) % 16 === 15) return jit(r, [96, 96, 104], 10);
    return jit(r, [146, 146, 154], 16);
  });
  tile(TILE.BUILD_METAL, (x, y, r) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const rivet = (x === 2 || x === 13) && (y === 2 || y === 13);
    if (rivet) return [226, 232, 240, 255];
    if (edge) return jit(r, [92, 100, 116], 8);
    return jit(r, [152, 162, 178], 12);
  });
  tile(TILE.SNOW, (x, y, r) => { const c = jit(r, [240, 244, 250], 12); c[2] += 4; return c; });
  tile(TILE.BEDROCK, (x, y, r) => jit(r, [62, 62, 66], 44));
  tile(TILE.PLANKS, (x, y, r) => (y % 4 === 3 ? jit(r, [124, 90, 52], 10) : jit(r, [176, 134, 82], 16)));
  tile(TILE.CACTUS_SIDE, (x, y, r) => {
    const c = jit(r, [44, 124, 54], 16);
    if (x % 4 === 0) { c[0] -= 14; c[1] -= 24; c[2] -= 14; }
    if (r() < 0.04) return [226, 230, 180, 255];
    return c;
  });
  tile(TILE.CACTUS_TOP, (x, y, r) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    return edge ? jit(r, [34, 98, 44], 10) : jit(r, [70, 156, 78], 14);
  });

  const planks = (x, y, r) => (y % 4 === 3 ? jit(r, [124, 90, 52], 10) : jit(r, [176, 134, 82], 16));
  tile(TILE.TABLE_TOP, (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return jit(r, [96, 66, 36], 10);       // frame
    if (x === 5 || x === 10 || y === 5 || y === 10) return jit(r, [120, 84, 48], 8);       // 3x3 work grid
    return jit(r, [188, 146, 92], 14);
  });
  tile(TILE.TABLE_SIDE, (x, y, r) => {
    if (y < 3) return jit(r, [96, 66, 36], 10);                                             // table top edge
    if ((x === 3 || x === 12) && y >= 3) return jit(r, [104, 74, 42], 8);                    // legs
    if (y >= 5 && y <= 11 && x >= 6 && x <= 9) {                                            // hanging tools
      if (x === 7 && y <= 10) return [150, 150, 158, 255];
      if (y === 5 && x >= 6 && x <= 9) return [170, 170, 178, 255];
    }
    return planks(x, y, r);
  });
  const cobble = (x, y, r) => {
    const cell = ((Math.floor(x / 4) + Math.floor(y / 3) * 3) * 7) % 5;
    const edge = x % 4 === 0 || y % 3 === 0;
    const base = 110 + cell * 8;
    return edge ? jit(r, [base - 34, base - 34, base - 30], 10) : jit(r, [base, base, base + 4], 16);
  };
  tile(TILE.FURNACE_SIDE, cobble);
  tile(TILE.FURNACE_TOP, (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return jit(r, [88, 88, 92], 8);
    return jit(r, [138, 138, 142], 12);
  });
  tile(TILE.FURNACE_FRONT, (x, y, r) => {
    if (x >= 4 && x <= 11 && y >= 8 && y <= 13) {                                            // fire mouth
      if (y >= 12) return jit(r, [236, 120 + (x % 3) * 20, 40], 20);
      return jit(r, [28, 24, 24], 8);
    }
    if (x >= 3 && x <= 12 && y >= 7 && y <= 14) return jit(r, [70, 70, 74], 8);             // mouth rim
    if (y === 3 && x >= 4 && x <= 11) return jit(r, [60, 60, 64], 6);                        // vent slot
    return cobble(x, y, r);
  });

  // loot chest: dark wood with gold trim and a glowing lock (original design)
  const chestWood = (x, y, r) => jit(r, (y % 5 === 4) ? [70, 44, 28] : [112, 72, 44], 10);
  tile(TILE.CHEST_SIDE, (x, y, r) => {
    if (x === 0 || x === 15 || y === 0 || y === 15 || y === 6) return jit(r, [236, 186, 60], 18);      // gold bands
    if (x >= 6 && x <= 9 && y >= 5 && y <= 9) return (x === 7 || x === 8) && y === 7 ? [255, 250, 200, 255] : jit(r, [250, 210, 80], 12);  // lock
    return chestWood(x, y, r);
  });
  tile(TILE.CHEST_TOP, (x, y, r) => {
    if (x === 0 || x === 15 || y === 0 || y === 15 || x === 7 || x === 8) return jit(r, [236, 186, 60], 18);
    return chestWood(x, y, r);
  });

  // ---- story mode: villages, camps, the keep ----
  const straw = (x, y, r) => {
    const c = jit(r, [214, 178, 84], 30);
    if ((x * 7 + Math.floor(y / 3) * 3) % 5 === 0) { c[0] -= 30; c[1] -= 34; c[2] -= 20; }          // stalks
    return c;
  };
  tile(TILE.HAY_SIDE, (x, y, r) => (y === 4 || y === 11) ? jit(r, [140, 56, 40], 16) : straw(x, y, r));   // twine bands
  tile(TILE.HAY_TOP, (x, y, r) => ((x + y) % 4 === 0 || (x - y + 16) % 5 === 0) ? jit(r, [184, 146, 60], 16) : straw(x, y, r));
  tile(TILE.BUSH, (x, y, r) => {
    if (r() < 0.1) return [0, 0, 0, 0];
    if (r() < 0.035) return jit(r, [196, 52, 70], 20);                                                // berries
    return jit(r, [44, 106, 40], 40);
  });
  tile(TILE.PATH_TOP, (x, y, r) => {
    const c = jit(r, [152, 120, 84], 22);
    if (r() < 0.09) return jit(r, [128, 124, 118], 20);                                               // gravel
    return c;
  });
  tile(TILE.COBBLE, cobble);
  tile(TILE.ROOF, (x, y, r) => {
    const row = Math.floor(y / 4), off = row % 2 ? 2 : 0;
    if (y % 4 === 3) return jit(r, [92, 38, 30], 10);                                                 // shadow under each course
    if ((x + off) % 4 === 0) return jit(r, [118, 48, 36], 10);
    return jit(r, [164, 70, 50], 18);
  });
  tile(TILE.PLASTER, (x, y, r) => {
    const c = jit(r, [222, 214, 194], 12);
    if (r() < 0.025) { c[0] -= 40; c[1] -= 40; c[2] -= 36; }
    return c;
  });
  tile(TILE.TIMBER, (x, y, r) => {
    const c = jit(r, [92, 62, 38], 12);
    if ((y * 3 + (x % 3)) % 7 === 0) { c[0] -= 18; c[1] -= 14; c[2] -= 10; }                      // grain
    return c;
  });
  tile(TILE.CLOTH, (x, y, r) => (Math.floor(x / 4) % 2 ? jit(r, [228, 206, 160], 10) : jit(r, [186, 52, 42], 14)));
  tile(TILE.CANVAS, (x, y, r) => (x === 7 || y === 0) ? jit(r, [150, 132, 98], 10) : jit(r, [198, 182, 142], 14));
  tile(TILE.BARS, (x, y, r) => {
    if (x === 2 || x === 7 || x === 12 || y === 1 || y === 14) return jit(r, [70, 72, 80], 18);
    if (x === 3 || x === 8 || x === 13) return jit(r, [46, 48, 54], 10);
    return [0, 0, 0, 0];
  });
  tile(TILE.BOARD, (x, y, r) => {
    const papers = [[1, 2, 6, 7], [8, 1, 14, 6], [2, 9, 7, 14], [9, 8, 14, 13]];
    for (const [x0, y0, x1, y1] of papers) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        if (x === x0 + 2 && y === y0) return [176, 40, 40, 255];                                       // pin
        return (y - y0) % 2 === 1 && x > x0 && x < x1 ? jit(r, [120, 110, 96], 10) : jit(r, [232, 222, 196], 8);
      }
    }
    return planks(x, y, r);
  });

  // arms crate: dark planks, iron bands, a painted knife on the side
  const darkWood = (x, y, r) => (y % 5 === 4 ? jit(r, [62, 42, 26], 8) : jit(r, [96, 66, 40], 12));
  tile(TILE.ARMS_SIDE, (x, y, r) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return jit(r, [70, 74, 82], 10);                          // iron frame
    if (x === 7 + Math.round((y - 7.5) * -0.6) && y >= 3 && y <= 12) return y <= 9 ? [226, 230, 236, 255] : [170, 120, 60, 255];
    if (x >= 3 && x <= 12 && (y === 3 || y === 12)) return jit(r, [70, 74, 82], 8);
    return darkWood(x, y, r);
  });
  tile(TILE.ARMS_TOP, (x, y, r) => {
    if (x === 0 || x === 15 || y === 0 || y === 15 || y === 7 || y === 8) return jit(r, [70, 74, 82], 10);
    if ((x === 3 || x === 12) && (y === 3 || y === 12)) return [190, 196, 204, 255];                          // rivets
    return darkWood(x, y, r);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;   // pixel style, no mip bleeding between atlas tiles
  tex.generateMipmaps = false;
  tex.flipY = false;                     // row 0 of the canvas = v 0 (see fragment shader)
  return tex;
}
