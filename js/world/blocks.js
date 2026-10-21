/* ============================================================
 * Block + tile registry.
 * Block ids are APPEND-ONLY: saved edits and worker tables depend on
 * them. The flat typed-array tables at the bottom are what the chunk
 * workers receive (workers cannot see the rest of this file).
 * ============================================================ */
const BLOCK = Object.freeze({
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD: 5, LEAVES: 6, GLASS: 7,
  BRICK: 8, IRON_ORE: 9, GOLD_ORE: 10, WATER: 11,
  BUILD_WOOD: 12, BUILD_STONE: 13, BUILD_METAL: 14,
  SNOW: 15, BEDROCK: 16, PLANKS: 17, CACTUS: 18,
  CRAFTING_TABLE: 19, FURNACE: 20, CHEST: 21,
  // story mode: villages, camps and the keep
  HAY: 22, BUSH: 23, PATH: 24, COBBLE: 25, ROOF: 26, PLASTER: 27, TIMBER: 28, CLOTH: 29, CANVAS: 30, BARS: 31, BOARD: 32,
  ARMS: 33,
  PALM: 34,        // story mode: the solid core of a palm trunk (drawn as a real palm by the smooth mesher, never as a cube)
});

// Index of each texture inside the atlas (see render/textures.js).
const TILE = Object.freeze({
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6,
  LEAVES: 7, GLASS: 8, BRICK: 9, IRON_ORE: 10, GOLD_ORE: 11, WATER: 12,
  BUILD_WOOD: 13, BUILD_STONE: 14, BUILD_METAL: 15, SNOW: 16, BEDROCK: 17,
  PLANKS: 18, CACTUS_SIDE: 19, CACTUS_TOP: 20,
  TABLE_TOP: 21, TABLE_SIDE: 22, FURNACE_FRONT: 23, FURNACE_SIDE: 24, FURNACE_TOP: 25,
  CHEST_SIDE: 26, CHEST_TOP: 27,
  HAY_SIDE: 28, HAY_TOP: 29, BUSH: 30, PATH_TOP: 31, COBBLE: 32, ROOF: 33, PLASTER: 34, TIMBER: 35,
  CLOTH: 36, CANVAS: 37, BARS: 38, BOARD: 39, ARMS_SIDE: 40, ARMS_TOP: 41,
});

/*
 * Block flags:
 *   solid    - collides with characters / bullets
 *   opaque   - hides the faces of neighbours (face culling + AO)
 *   cutout   - has transparent pixels (alpha-tested: leaves, glass)
 *   liquid   - rendered in the separate translucent water mesh
 *   hardness - break time scale (see CONFIG.MINING); -1 = unbreakable
 *   tool     - tool type that breaks it fast: 'pickaxe' | 'axe' | 'shovel' | null
 *   tier     - harvest level needed to get a drop (0 = anything, even a bare hand;
 *              1 = any pickaxe, 2 = stone or better, 3 = iron or better). See CONFIG.TOOL_TIERS.
 */
const BLOCK_DEFS = [];
function defBlock(id, name, o) {
  const t = o.tiles;
  let tiles = null;
  if (t !== undefined) tiles = (typeof t === 'number') ? { top: t, bottom: t, side: t } : t;
  BLOCK_DEFS[id] = Object.assign(
    { id, name, solid: true, opaque: true, cutout: false, liquid: false, hardness: 1, tool: null, tier: 0 },
    o, { tiles });
}

defBlock(BLOCK.AIR,   'Air',   { solid: false, opaque: false, hardness: 0 });
defBlock(BLOCK.GRASS, 'Grass', { tiles: { top: TILE.GRASS_TOP, bottom: TILE.DIRT, side: TILE.GRASS_SIDE }, hardness: 0.6, tool: 'shovel' });
defBlock(BLOCK.DIRT,  'Dirt',  { tiles: TILE.DIRT, hardness: 0.5, tool: 'shovel' });
defBlock(BLOCK.STONE, 'Stone', { tiles: TILE.STONE, hardness: 1.5, tool: 'pickaxe', tier: 1 });
defBlock(BLOCK.SAND,  'Sand',  { tiles: TILE.SAND, hardness: 0.5, tool: 'shovel' });
defBlock(BLOCK.WOOD,  'Log',   { tiles: { top: TILE.LOG_TOP, bottom: TILE.LOG_TOP, side: TILE.LOG_SIDE }, hardness: 2.0, tool: 'axe' });
defBlock(BLOCK.LEAVES,'Leaves',{ tiles: TILE.LEAVES, opaque: false, cutout: true, hardness: 0.2 });
defBlock(BLOCK.GLASS, 'Glass', { tiles: TILE.GLASS, opaque: false, cutout: true, hardness: 0.3 });
defBlock(BLOCK.BRICK, 'Brick', { tiles: TILE.BRICK, hardness: 2.0, tool: 'pickaxe', tier: 1 });
defBlock(BLOCK.IRON_ORE, 'Iron Ore', { tiles: TILE.IRON_ORE, hardness: 3.0, tool: 'pickaxe', tier: 2 });
defBlock(BLOCK.GOLD_ORE, 'Gold Ore', { tiles: TILE.GOLD_ORE, hardness: 3.0, tool: 'pickaxe', tier: 3 });
defBlock(BLOCK.WATER, 'Water', { tiles: TILE.WATER, solid: false, opaque: false, liquid: true, hardness: -1 });
defBlock(BLOCK.BUILD_WOOD,  'Build Wood',  { tiles: TILE.BUILD_WOOD,  hardness: 1.0, tool: 'axe' });
defBlock(BLOCK.BUILD_STONE, 'Build Stone', { tiles: TILE.BUILD_STONE, hardness: 1.8, tool: 'pickaxe', tier: 1 });
defBlock(BLOCK.BUILD_METAL, 'Build Metal', { tiles: TILE.BUILD_METAL, hardness: 3.0, tool: 'pickaxe', tier: 1 });
defBlock(BLOCK.SNOW,    'Snow',    { tiles: TILE.SNOW, hardness: 0.3, tool: 'shovel' });
defBlock(BLOCK.BEDROCK, 'Bedrock', { tiles: TILE.BEDROCK, hardness: -1 });
defBlock(BLOCK.PLANKS,  'Planks',  { tiles: TILE.PLANKS, hardness: 1.2, tool: 'axe' });
defBlock(BLOCK.CACTUS,  'Cactus',  { tiles: { top: TILE.CACTUS_TOP, bottom: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE }, hardness: 0.4, tool: 'axe' });
defBlock(BLOCK.CRAFTING_TABLE, 'Crafting Table', { tiles: { top: TILE.TABLE_TOP, bottom: TILE.PLANKS, side: TILE.TABLE_SIDE }, hardness: 1.6, tool: 'axe' });
// Loot chest: opening it (E) spills its loot and removes it. Unbreakable by mining so loot can't be skipped.
defBlock(BLOCK.CHEST, 'Loot Chest', { tiles: { top: TILE.CHEST_TOP, bottom: TILE.CHEST_TOP, side: TILE.CHEST_SIDE }, hardness: -1 });
defBlock(BLOCK.FURNACE, 'Furnace', { tiles: { top: TILE.FURNACE_TOP, bottom: TILE.FURNACE_TOP, side: TILE.FURNACE_SIDE }, hardness: 2.5, tool: 'pickaxe', tier: 1 });
// Story mode. Hay and bushes are hiding spots: you can walk into them (not solid). Hay is opaque, so
// it hides whoever is inside from sight lines; bushes are see-through foliage.
defBlock(BLOCK.HAY, 'Hay', { tiles: { top: TILE.HAY_TOP, bottom: TILE.HAY_TOP, side: TILE.HAY_SIDE }, solid: false, hardness: 0.4 });
defBlock(BLOCK.BUSH, 'Bush', { tiles: TILE.BUSH, solid: false, opaque: false, cutout: true, hardness: 0.2 });
defBlock(BLOCK.PATH, 'Path', { tiles: { top: TILE.PATH_TOP, bottom: TILE.DIRT, side: TILE.DIRT }, hardness: 0.6, tool: 'shovel' });
defBlock(BLOCK.COBBLE, 'Cobblestone', { tiles: TILE.COBBLE, hardness: 2.0, tool: 'pickaxe', tier: 1 });
defBlock(BLOCK.ROOF, 'Roof Tiles', { tiles: TILE.ROOF, hardness: 1.5, tool: 'pickaxe', tier: 1 });
defBlock(BLOCK.PLASTER, 'Plaster', { tiles: TILE.PLASTER, hardness: 1.2, tool: 'pickaxe' });
defBlock(BLOCK.TIMBER, 'Timber', { tiles: TILE.TIMBER, hardness: 2.0, tool: 'axe' });
defBlock(BLOCK.CLOTH, 'Awning', { tiles: TILE.CLOTH, hardness: 0.4 });
defBlock(BLOCK.CANVAS, 'Canvas', { tiles: TILE.CANVAS, hardness: 0.4 });
defBlock(BLOCK.BARS, 'Iron Bars', { tiles: TILE.BARS, opaque: false, cutout: true, hardness: 4, tool: 'pickaxe', tier: 2 });
defBlock(BLOCK.BOARD, 'Notice Board', { tiles: { top: TILE.PLANKS, bottom: TILE.PLANKS, side: TILE.BOARD }, hardness: -1 });
// arms crate: restock arrows, smoke and rounds (E) - in the enforcers' camps and the keep, and the Order's supply chest at the hideout
defBlock(BLOCK.PALM, 'Palm Trunk', { hardness: -1 });          // no tiles: the voxel mesher skips it
defBlock(BLOCK.ARMS, 'Arms Crate', { tiles: { top: TILE.ARMS_TOP, bottom: TILE.PLANKS, side: TILE.ARMS_SIDE }, hardness: -1 });

/*
 * Flat lookup tables indexed by block id (length 256 so any byte is safe).
 * faceTiles[id*6 + face] where face = axis*2 + (negative ? 1 : 0),
 * i.e. order is +x, -x, +y(top), -y(bottom), +z, -z.
 */
const BlockTables = (function () {
  const N = 256;
  const t = {
    opaque: new Uint8Array(N), solid: new Uint8Array(N),
    liquid: new Uint8Array(N), cutout: new Uint8Array(N),
    faceTiles: new Int16Array(N * 6).fill(-1),
    waterTile: TILE.WATER,
    // story mode's smooth ground (worker/mesher.js): 1 = natural ground, drawn as one skin; 2 = a prop that stands on it, looked through
    ground: new Uint8Array(N),
    groundColor: new Float32Array(N * 3),
    prop: new Uint8Array(N),            // story mode: blocks the smooth mesher draws as real geometry: 1 = palm trunk, 2 = reeds (a bush), 3 = ivy (leaves), 4 = an awning or a bed (cloth)
  };
  const GROUND_COLORS = {
    [BLOCK.GRASS]: [0.46, 0.55, 0.22], [BLOCK.DIRT]: [0.5, 0.37, 0.25], [BLOCK.STONE]: [0.66, 0.6, 0.52], [BLOCK.SAND]: [0.88, 0.73, 0.47],
    [BLOCK.SNOW]: [0.9, 0.92, 0.95], [BLOCK.PATH]: [0.68, 0.57, 0.4],
  };
  for (const id of Object.keys(GROUND_COLORS)) { t.ground[id] = 1; t.groundColor.set(GROUND_COLORS[id], id * 3); }
  for (const id of [BLOCK.WOOD, BLOCK.LEAVES, BLOCK.CACTUS, BLOCK.BUSH, BLOCK.HAY, BLOCK.PALM]) t.ground[id] = 2;
  t.prop[BLOCK.PALM] = 1; t.prop[BLOCK.BUSH] = 2; t.prop[BLOCK.LEAVES] = 3; t.prop[BLOCK.CLOTH] = 4;
  BLOCK_DEFS.forEach((d, id) => {
    if (!d) return;
    t.opaque[id] = d.opaque ? 1 : 0;
    t.solid[id] = d.solid ? 1 : 0;
    t.liquid[id] = d.liquid ? 1 : 0;
    t.cutout[id] = d.cutout ? 1 : 0;
    if (d.tiles) {
      const f = d.tiles, o = id * 6;
      t.faceTiles[o] = t.faceTiles[o + 1] = f.side;
      t.faceTiles[o + 2] = f.top;
      t.faceTiles[o + 3] = f.bottom;
      t.faceTiles[o + 4] = t.faceTiles[o + 5] = f.side;
    }
  });
  return t;
})();
