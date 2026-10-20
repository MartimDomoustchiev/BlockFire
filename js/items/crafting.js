/* ============================================================
 * Crafting recipes + matcher.
 *
 * Shaped recipes are written as rows of characters (' ' = empty).
 * Matching trims the crafting grid to the bounding box of its items,
 * so a recipe works anywhere in the grid; it also matches mirrored
 * left-to-right. A 3-wide recipe can never fit the 2x2 grid, which
 * is what makes the crafting table necessary.
 * Shapeless recipes match an exact multiset of ingredients.
 * Every recipe consumes exactly one item from each used grid slot.
 * ============================================================ */
const RECIPES = [];

function shaped(rows, key, outId, count) { RECIPES.push({ type: 'shaped', rows, key, out: outId, count: count || 1 }); }
function shapeless(ingredients, outId, count) {
  RECIPES.push({ type: 'shapeless', ingredients: ingredients.slice().sort(), out: outId, count: count || 1 });
}

(function defineRecipes() {
  const Y = CONFIG.CRAFT_YIELD;
  shaped(['L'], { L: 'log' }, 'planks', Y.planks);
  shaped(['P', 'P'], { P: 'planks' }, 'stick', Y.stick);
  shaped(['PP', 'PP'], { P: 'planks' }, 'crafting_table');
  shaped(['SSS', 'S S', 'SSS'], { S: 'stone' }, 'furnace');
  shaped(['SS', 'SS'], { S: 'stone' }, 'brick', Y.brick);
  shaped(['PPP'], { P: 'planks' }, 'build_wood', Y.build_wood);
  shaped(['SSS'], { S: 'stone' }, 'build_stone', Y.build_stone);
  shaped(['II', 'II'], { I: 'iron_ingot' }, 'build_metal', Y.build_metal);   // (1-3 ingots alone are ammo)
  const MATERIAL = { wood: 'planks', stone: 'stone', iron: 'iron_ingot', gold: 'gold_ingot' };
  for (const tier of Object.keys(MATERIAL)) {
    const key = { M: MATERIAL[tier], s: 'stick' };
    shaped(['MMM', ' s ', ' s '], key, tier + '_pickaxe');
    shaped(['MM', 'Ms', ' s'], key, tier + '_axe');
    shaped(['M', 's', 's'], key, tier + '_shovel');
  }
  // ammo
  shapeless(['iron_ingot'], 'ammo_light', Y.ammo_light);
  shapeless(['iron_ingot', 'iron_ingot'], 'ammo_medium', Y.ammo_medium);
  shapeless(['iron_ingot', 'iron_ingot', 'iron_ingot'], 'ammo_shells', Y.ammo_shells);
  shapeless(['gold_ingot', 'iron_ingot'], 'ammo_heavy', Y.ammo_heavy);
  shapeless(['gold_ingot', 'gold_ingot', 'iron_ingot'], 'ammo_rockets', Y.ammo_rockets);
})();

const Crafting = {
  /**
   * grid: array of ItemStack|null, row-major, `w` columns wide.
   * Returns { recipe, result: ItemStack } or null.
   */
  match(grid, w) {
    const h = grid.length / w;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const ids = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = grid[y * w + x];
        if (!s) continue;
        ids.push(s.id);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (!ids.length) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const cell = (x, y) => { const s = grid[(minY + y) * w + minX + x]; return s ? s.id : null; };
    const sorted = ids.slice().sort();

    for (const r of RECIPES) {
      if (r.type === 'shapeless') {
        if (r.ingredients.length === sorted.length && r.ingredients.every((id, i) => id === sorted[i])) return this._result(r);
        continue;
      }
      if (r.rows.length !== bh || r.rows[0].length !== bw) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < bh && ok; y++) {
          for (let x = 0; x < bw; x++) {
            const ch = r.rows[y][mirror ? bw - 1 - x : x];
            const want = ch === ' ' ? null : r.key[ch];
            if (cell(x, y) !== want) { ok = false; break; }
          }
        }
        if (ok) return this._result(r);
      }
    }
    return null;
  },

  _result(r) { const s = makeStack(r.out, r.count); return { recipe: r, result: s }; },

  /** Uses up one item from every occupied grid slot (after taking a result). */
  consume(grid) {
    for (let i = 0; i < grid.length; i++) {
      const s = grid[i];
      if (!s) continue;
      s.count--;
      if (s.count <= 0) grid[i] = null;
    }
  },
};
