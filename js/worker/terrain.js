/* Worker module: procedural terrain (heightmap, biomes, caves, ores, trees). */
WorkerBundle.add(function terrainPart() {
  const CS = 16, CH = 64;
  const BIOME_GRASS = 0, BIOME_DESERT = 1, BIOME_SNOW = 2, BIOME_FOREST = 3;
  let ID = null, SEA = 20, SEED = 0, CHEST_CHANCE = 0, ISLAND = 0, STORY = false;
  let nTerrain, nDetail, nMount, nTemp, nMoist, nCave, nOre;

  function setupTerrain(ids, sea, seed, cfg) {
    ID = ids; SEA = sea; SEED = seed | 0;
    CHEST_CHANCE = (cfg && cfg.chestChance) || 0;
    ISLAND = (cfg && cfg.island) || 0;           // >0: radius of the battle island
    STORY = !!(cfg && cfg.story);                // the story's land: desert, fields, palms (no snow, no cubes of leaves)
    nTerrain = makeNoise(SEED);
    nDetail = makeNoise(SEED + 101);
    nMount = makeNoise(SEED + 202);
    nTemp = makeNoise(SEED + 303);
    nMoist = makeNoise(SEED + 404);
    nCave = makeNoise(SEED + 505);
    nOre = makeNoise(SEED + 707);
    setupSites(cfg && cfg.story);                 // story mode: villages, camps, roads (sites.js)
  }

  /** Terrain surface height (y of the top solid block) for a world column, after site flattening and road grading. */
  function columnHeight(x, z) {
    const h = rawColumnHeight(x, z);
    return Math.max(3, Math.min(60, Math.round(adjustHeight(x, z, h))));
  }

  /** The natural terrain height, before any story-mode shaping. */
  function rawColumnHeight(x, z) {
    const base = fbm2(nTerrain, x * 0.006, z * 0.006, 4);
    const detail = fbm2(nDetail, x * 0.04, z * 0.04, 2);
    let m = fbm2(nMount, x * 0.004 + 50, z * 0.004, 3) - 0.02;
    m = m > 0 ? Math.min(1, m * 1.7) : 0;
    let h = 24 + base * 17 + detail * 3 + Math.pow(m, 1.3) * 28;
    if (ISLAND > 0) {
      // island: a gentle dome inside the radius, sinking to sea floor beyond it
      const d = Math.hypot(x, z) / ISLAND;
      const k = d <= 0.7 ? 1 : d >= 1 ? 0 : 1 - (d - 0.7) / 0.3;
      const kk = k * k * (3 - 2 * k);
      const floor = SEA - 8;
      h = floor + (Math.max(h, SEA + 3) + 3 * kk - floor) * kk;
    }
    return Math.max(3, Math.min(60, Math.round(h)));
  }

  function columnBiome(x, z) {
    const t = fbm2(nTemp, x * 0.0035, z * 0.0035, 2);
    const m = fbm2(nMoist, x * 0.0035 + 700, z * 0.0035, 2);
    if (t > 0.2 && m < 0.18) return BIOME_DESERT;
    if (t < -0.22) return BIOME_SNOW;
    if (m > 0.1) return BIOME_FOREST;
    return BIOME_GRASS;
  }

  function topBlock(h, b) {
    if (h <= SEA + 1) return h >= SEA - 5 ? ID.SAND : ID.DIRT;   // beaches / sea floor
    if (h >= 50) return ID.SNOW;                                  // snowy peaks
    if (h >= 44) return ID.STONE;                                 // bare rock
    if (b === BIOME_DESERT) return ID.SAND;
    if (b === BIOME_SNOW) return ID.SNOW;
    return ID.GRASS;
  }

  /**
   * Story mode's ground: sand dunes, green fields on the low wet ground, bare limestone where the slope is steep or the
   * land is high. `slope` is the largest drop to a neighbouring column (0 where it is not known).
   */
  function storyTop(x, z, h, slope) {
    if (h <= SEA + 1) return h >= SEA - 6 ? ID.SAND : ID.DIRT;       // shores and river beds
    if (slope >= 2 || h >= 46) return ID.STONE;
    const m = fbm2(nMoist, x * 0.012 + 300, z * 0.012, 3);
    if (h <= SEA + 7 && m > -0.05) return ID.GRASS;                  // the irrigated strip along the water
    if (m > 0.3 && h <= SEA + 15) return ID.GRASS;                   // an oasis
    return ID.SAND;
  }
  function storySub(top) { return top === ID.GRASS ? ID.DIRT : top === ID.STONE ? ID.STONE : ID.SAND; }

  /** Story mode: 1 = a palm. Groves in the green, palms along the water, the odd lone palm in the desert. */
  function storyTreeKind(x, z, h, top) {
    if (h <= SEA + 1 || h >= 46) return 0;
    if (siteClear(x, z)) return 0;
    const r = (hash2(x, z, SEED) & 0xffff) / 65536;
    if (top === ID.GRASS) return r < 0.05 ? 1 : 0;
    if (top === ID.SAND) return r < (h <= SEA + 6 ? 0.018 : 0.0016) ? 1 : 0;
    return 0;
  }

  function subBlock(h, b) {
    if (h <= SEA + 1) return topBlock(h, b);
    if (h >= 44) return ID.STONE;
    if (b === BIOME_DESERT) return ID.SAND;
    return ID.DIRT;
  }

  /** 0 = nothing, 1 = tree, 2 = cactus. Pure function of the column, so
   *  neighbouring chunks agree on where trees stand. */
  function treeKind(x, z, h, b) {
    if (h <= SEA + 1 || h >= 50) return 0;
    if (siteClear(x, z)) return 0;
    const top = topBlock(h, b);
    const r = (hash2(x, z, SEED) & 0xffff) / 65536;
    if (top === ID.GRASS) return r < (b === BIOME_FOREST ? 0.04 : 0.007) ? 1 : 0;
    if (top === ID.SNOW) return r < 0.011 ? 1 : 0;
    if (top === ID.SAND && b === BIOME_DESERT) return r < 0.004 ? 2 : 0;
    return 0;
  }

  function isCave(x, y, z) {
    // "spaghetti" tunnels: where two noise fields are both near zero
    const a = nCave.noise3(x * 0.045, y * 0.07, z * 0.045);
    if (a > -0.07 && a < 0.07) {
      const b = nCave.noise3(x * 0.045 + 100, y * 0.07 + 40, z * 0.045 + 100);
      if (b > -0.07 && b < 0.07) return true;
    }
    // occasional deep chambers
    if (y < 30 && nCave.noise3(x * 0.02 + 300, y * 0.035, z * 0.02) > 0.62) return true;
    return false;
  }

  /** Builds the block array of one chunk. Index = x + z*16 + y*256. */
  function generateChunk(cx, cz) {
    const data = new Uint8Array(CS * CH * CS);
    const R = 3, E = CS + 2 * R;           // columns around the chunk, so trees spill over borders
    const ox = cx * CS - R, oz = cz * CS - R;
    const Hs = new Int16Array(E * E), Bs = new Uint8Array(E * E);
    for (let ez = 0; ez < E; ez++) {
      for (let ex = 0; ex < E; ex++) {
        Hs[ez * E + ex] = columnHeight(ox + ex, oz + ez);
        Bs[ez * E + ex] = columnBiome(ox + ex, oz + ez);
      }
    }

    const { STONE, WATER, BEDROCK, IRON_ORE, GOLD_ORE, WOOD, LEAVES, CACTUS } = ID;

    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const e = (z + R) * E + (x + R);
        const h = Hs[e], b = Bs[e];
        const wx = cx * CS + x, wz = cz * CS + z;
        const road = roadSurface(wx, wz, h);
        let top, sub;
        if (STORY) {
          const slope = Math.max(Math.abs(h - Hs[e - 1]), Math.abs(h - Hs[e + 1]), Math.abs(h - Hs[e - E]), Math.abs(h - Hs[e + E]));
          top = road === 1 ? ID.PATH : storyTop(wx, wz, h, slope); sub = storySub(top === ID.PATH ? ID.SAND : top);
        } else { top = road === 1 ? ID.PATH : topBlock(h, b); sub = subBlock(h, b); }
        const yMax = Math.max(h, SEA);
        if (road === 2) data[x + z * CS + (SEA + 1) * 256] = ID.PLANKS;     // bridge deck over water
        for (let y = 0; y <= yMax; y++) {
          const idx = x + z * CS + y * 256;
          if (y === 0) { data[idx] = BEDROCK; continue; }
          if (y > h) { data[idx] = WATER; continue; }   // only reached when y <= SEA
          if (y === h) { data[idx] = top; continue; }
          if (y >= h - 3) { data[idx] = sub; continue; }
          // deep rock: caves and ores
          if (y >= 3 && isCave(wx, y, wz)) continue;
          let blk = STONE;
          if (y < 44 && nOre.noise3(wx * 0.18 + 7, y * 0.18, wz * 0.18) > 0.84) blk = IRON_ORE;
          else if (y < 28 && nOre.noise3(wx * 0.22 + 500, y * 0.22 + 500, wz * 0.22) > 0.9) blk = GOLD_ORE;
          data[idx] = blk;
        }
      }
    }

    // Trees / cacti. Every chunk evaluates the trees of the surrounding
    // columns and writes only the blocks that fall inside itself.
    const put = (wx, y, wz, id, replaceLeaves) => {
      const lx = wx - cx * CS, lz = wz - cz * CS;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= CH) return;
      const idx = lx + lz * CS + y * 256;
      const cur = data[idx];
      if (cur === 0 || (replaceLeaves && cur === LEAVES)) data[idx] = id;
    };
    for (let ez = 0; ez < E; ez++) {
      for (let ex = 0; ex < E; ex++) {
        const h = Hs[ez * E + ex];
        let kind;
        if (STORY) {
          const inner = ex > 0 && ez > 0 && ex < E - 1 && ez < E - 1;
          const slope = inner ? Math.max(Math.abs(h - Hs[ez * E + ex - 1]), Math.abs(h - Hs[ez * E + ex + 1]), Math.abs(h - Hs[(ez - 1) * E + ex]), Math.abs(h - Hs[(ez + 1) * E + ex])) : 0;
          kind = storyTreeKind(ox + ex, oz + ez, h, storyTop(ox + ex, oz + ez, h, slope));
          // reeds on the dry shore: a bush block each (the smooth mesher draws them as reeds, and they hide you as before)
          if (!kind && h >= SEA + 1 && h <= SEA + 2 && inner && !siteClear(ox + ex, oz + ez) && (hash2(ox + ex * 7, oz + ez * 3, SEED ^ 0x3b1) & 0xffff) / 65536 < 0.1) put(ox + ex, h + 1, oz + ez, ID.BUSH, false);
        } else kind = treeKind(ox + ex, oz + ez, h, Bs[ez * E + ex]);
        if (!kind) continue;
        const wx = ox + ex, wz = oz + ez;
        const rh = hash2(wx * 3 + 1, wz * 5 + 2, SEED);
        if (STORY) { const th = 4 + rh % 3; for (let k = 1; k <= th; k++) put(wx, h + k, wz, ID.PALM, false); continue; }       // the trunk's collider; the mesher draws the palm
        if (kind === 2) {
          const ch = 1 + rh % 3;
          for (let k = 1; k <= ch; k++) put(wx, h + k, wz, CACTUS, false);
          continue;
        }
        const th = 4 + rh % 3, topY = h + th;
        for (let k = 1; k <= th; k++) put(wx, h + k, wz, WOOD, true);
        for (let ly = topY - 2; ly <= topY + 1; ly++) {
          const r = ly >= topY ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              if (dx === 0 && dz === 0 && ly <= topY) continue;                     // trunk
              if (Math.abs(dx) === r && Math.abs(dz) === r) {
                if (r === 2 && ((rh >>> (ly + dx + dz + 8)) & 1)) continue;         // ragged corners
                if (ly === topY + 1) continue;                                       // rounded crown
              }
              put(wx + dx, ly, wz + dz, LEAVES, false);
            }
          }
        }
      }
    }
    // Loot chest: at most one per chunk, on a dry surface column, deterministic from the seed.
    const ch = hash2(cx * 7 + 3, cz * 13 + 5, SEED ^ 0x5a17);
    if ((ch & 0xffff) / 65536 < CHEST_CHANCE) {
      const lx = 2 + ((ch >>> 16) % 12), lz = 2 + ((ch >>> 20) % 12);
      const h = Hs[(lz + R) * E + (lx + R)];
      if (h > SEA && h < CH - 2) {
        const top = data[lx + lz * CS + h * 256], above = lx + lz * CS + (h + 1) * 256;
        if (top !== ID.LEAVES && top !== ID.WATER && data[above] === 0) data[above] = ID.CHEST;
      }
    }
    stampChunk(cx, cz, data);
    return data;
  }

  /** Finds a dry, tree-free spot near the origin for the player to start on. */
  function findSpawn() {
    for (let k = 0; k < 3000; k++) {
      const r = 3 * Math.sqrt(k), a = k * 2.399963;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const h = columnHeight(x, z);
      if (h <= SEA + 2 || h >= 40) continue;
      let clear = true;
      for (let dz = -3; dz <= 3 && clear; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const hh = columnHeight(x + dx, z + dz);
          if (treeKind(x + dx, z + dz, hh, columnBiome(x + dx, z + dz))) { clear = false; break; }
        }
      }
      if (clear) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
    }
    return { x: 0.5, y: Math.max(columnHeight(0, 0), SEA) + 1, z: 0.5 };
  }
});
