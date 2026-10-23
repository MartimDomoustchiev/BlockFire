/* ============================================================
 * Item registry + ItemStack helpers.
 *
 * An ItemStack is a plain object { id, count, data? }. `data` holds
 * per-instance state (tool durability, later weapon rarity / ammo in
 * the magazine); stacks with data never merge.
 * ============================================================ */
const ITEMS = {};
const BLOCK_ITEM = {};          // block id -> id of the item that places it

function defItem(id, o) {
  ITEMS[id] = Object.assign({ id, name: id, kind: 'material', maxStack: 64 }, o);
  return ITEMS[id];
}

// --- Placeable blocks -------------------------------------------------------
[
  ['grass', BLOCK.GRASS], ['dirt', BLOCK.DIRT], ['stone', BLOCK.STONE], ['sand', BLOCK.SAND],
  ['log', BLOCK.WOOD], ['leaves', BLOCK.LEAVES], ['glass', BLOCK.GLASS], ['brick', BLOCK.BRICK],
  ['iron_ore', BLOCK.IRON_ORE], ['gold_ore', BLOCK.GOLD_ORE],
  ['build_wood', BLOCK.BUILD_WOOD], ['build_stone', BLOCK.BUILD_STONE], ['build_metal', BLOCK.BUILD_METAL],
  ['snow', BLOCK.SNOW], ['planks', BLOCK.PLANKS], ['cactus', BLOCK.CACTUS],
  ['crafting_table', BLOCK.CRAFTING_TABLE], ['furnace', BLOCK.FURNACE],
  ['hay', BLOCK.HAY], ['bush', BLOCK.BUSH], ['path', BLOCK.PATH], ['cobble', BLOCK.COBBLE], ['roof_tiles', BLOCK.ROOF],
  ['plaster', BLOCK.PLASTER], ['timber', BLOCK.TIMBER], ['cloth', BLOCK.CLOTH], ['canvas', BLOCK.CANVAS], ['iron_bars', BLOCK.BARS],
].forEach(([id, blockId]) => {
  defItem(id, { kind: 'block', blockId, name: BLOCK_DEFS[blockId].name });
  BLOCK_ITEM[blockId] = id;
});

// --- Materials ---------------------------------------------------------------
defItem('stick', { name: 'Stick' });
defItem('iron_ingot', { name: 'Iron Ingot' });
defItem('gold_ingot', { name: 'Gold Ingot' });

// --- Tools -----------------------------------------------------------------------
const TOOL_TIER_NAMES = { wood: 'Wooden', stone: 'Stone', iron: 'Iron', gold: 'Golden' };
const TOOL_TYPE_NAMES = { pickaxe: 'Pickaxe', axe: 'Axe', shovel: 'Shovel' };
for (const tier of Object.keys(CONFIG.TOOL_TIERS)) {
  const t = CONFIG.TOOL_TIERS[tier];
  for (const type of Object.keys(TOOL_TYPE_NAMES)) {
    defItem(tier + '_' + type, {
      kind: 'tool', maxStack: 1,
      name: TOOL_TIER_NAMES[tier] + ' ' + TOOL_TYPE_NAMES[type],
      tool: { type, tier, level: t.level, speed: t.speed, durability: t.durability },
    });
  }
}

// --- Ammo (used by the guns in stage 3) -------------------------------------------
defItem('ammo_light',   { kind: 'ammo', name: 'Light Rounds',  maxStack: 999 });
defItem('ammo_medium',  { kind: 'ammo', name: 'Medium Rounds', maxStack: 999 });
defItem('ammo_heavy',   { kind: 'ammo', name: 'Heavy Slugs',   maxStack: 999 });
defItem('ammo_shells',  { kind: 'ammo', name: 'Scatter Shells', maxStack: 999 });
defItem('ammo_rockets', { kind: 'ammo', name: 'Rockets',       maxStack: 99 });

// --- Story mode ---------------------------------------------------------------------------
defItem('arrow', { kind: 'ammo', name: 'Arrow', maxStack: 30 });
defItem('smoke_bomb', { kind: 'ammo', name: 'Smoke Bomb', maxStack: 6 });
for (const id of Object.keys(CONFIG.STORY.BLADES)) {
  const b = CONFIG.STORY.BLADES[id];
  defItem(id, { kind: 'blade', name: b.name, maxStack: 1, blade: Object.assign({ id }, b) });
}
defItem('ledger', { kind: 'quest', name: "Tax Collector's Ledger", maxStack: 1 });
defItem('letter', { kind: 'quest', name: 'Sealed Letter', maxStack: 1 });
defItem('strongbox', { kind: 'quest', name: 'Strongbox', maxStack: 1 });
defItem('toll_ticket', { kind: 'quest', name: 'Toll Ticket', maxStack: 1 });
defItem('order_letter', { kind: 'quest', name: 'Order Letter', maxStack: 1 });
defItem('relic', { kind: 'quest', name: 'Old Relic', maxStack: 1 });
defItem('iron_crate', { kind: 'quest', name: 'Crate of Iron Bars', maxStack: 1 });
defItem('ledger_page', { kind: 'quest', name: 'Torn Ledger Page', maxStack: 1 });
defItem('pell_key', { kind: 'quest', name: "Pell's Key", maxStack: 1 });
defItem('magistrate_seal', { kind: 'quest', name: "Magistrate's Seal", maxStack: 1 });

// --- The Order's gear (story): outfit pieces with stats and levels, and the materials that upgrade them ---
for (const id of Object.keys(CONFIG.STORY.GEAR.PIECES)) {
  const p = CONFIG.STORY.GEAR.PIECES[id];
  defItem(id, { kind: 'gear', maxStack: 1, name: p.name, gear: Object.assign({ id }, p) });
}
for (const id of Object.keys(CONFIG.STORY.GEAR.MATERIALS)) {
  defItem(id, { kind: 'material', maxStack: 99, name: CONFIG.STORY.GEAR.MATERIALS[id].name });
}

// --- Stack helpers -------------------------------------------------------------------
/** New stack; tools start at full durability. */
function makeStack(id, count = 1) {
  const it = ITEMS[id];
  if (!it) throw new Error('Unknown item ' + id);
  const s = { id, count };
  if (it.kind === 'tool') s.data = { dur: it.tool.durability };
  if (it.kind === 'gear') s.data = { lvl: 1, eq: 0 };          // level, and whether it is worn
  return s;
}

function cloneStack(s) {
  if (!s) return null;
  const c = { id: s.id, count: s.count };
  if (s.data) c.data = Object.assign({}, s.data);
  return c;
}

function maxStackOf(id) { return ITEMS[id] ? ITEMS[id].maxStack : 64; }

/** Can b be merged onto a? */
function canStack(a, b) {
  return !!(a && b && a.id === b.id && !a.data && !b.data && maxStackOf(a.id) > 1);
}

/** Display name incl. durability for tooltips. */
function stackLabel(s) {
  const it = ITEMS[s.id];
  if (!it) return s.id;
  let t = it.name;
  if (it.kind === 'tool' && s.data) t += '  (' + s.data.dur + '/' + it.tool.durability + ')';
  if (it.kind === 'weapon' && s.data) t = CONFIG.RARITY[s.data.rarity].name + ' ' + it.name;
  if (it.kind === 'gear' && s.data) t += '  (level ' + s.data.lvl + (s.data.eq ? ', worn' : '') + ')';
  return t;
}
