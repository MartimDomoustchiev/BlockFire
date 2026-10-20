/* ============================================================
 * Furnace block entity. Lives in world.blockEntities (so it survives
 * chunk unloads) and is ticked by Game.tick whether or not anybody
 * has its screen open.
 *
 * Fuel is only consumed when there is something smeltable AND room
 * in the output. While burning, cook progress advances; without
 * fuel it cools back down at COOL_RATE.
 * ============================================================ */
const SMELTING = {
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  sand: 'glass',
};

const Furnace = {
  create() {
    return { type: 'furnace', input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
  },

  fuelValue(id) { return CONFIG.FURNACE.FUEL[id] || 0; },
  isSmeltable(id) { return !!SMELTING[id]; },

  /** True if one more result of the current input fits in the output slot. */
  canSmelt(f) {
    if (!f.input) return false;
    const out = SMELTING[f.input.id];
    if (!out) return false;
    if (!f.output) return true;
    return f.output.id === out && !f.output.data && f.output.count < maxStackOf(out);
  },

  tick(f, dt) {
    const C = CONFIG.FURNACE;
    const smeltable = this.canSmelt(f);
    if (f.burn <= 0 && smeltable && f.fuel && this.fuelValue(f.fuel.id) > 0) {
      f.burn = f.burnMax = this.fuelValue(f.fuel.id);
      f.fuel.count--;
      if (f.fuel.count <= 0) f.fuel = null;
    }
    if (f.burn > 0) {
      f.burn = Math.max(0, f.burn - dt);
      if (smeltable) {
        f.cook += dt;
        if (f.cook >= C.COOK_TIME - 1e-9) {               // tolerance: 240 x (1/60) can sum to 3.9999...
          f.cook = Math.max(0, f.cook - C.COOK_TIME);
          const out = SMELTING[f.input.id];
          f.input.count--;
          if (f.input.count <= 0) f.input = null;
          if (f.output) f.output.count++;
          else f.output = makeStack(out, 1);
          if (!this.canSmelt(f)) f.cook = 0;
          return true;                     // produced an item this tick
        }
      } else f.cook = 0;
    } else {
      f.cook = Math.max(0, f.cook - C.COOL_RATE * dt);
    }
    return false;
  },

  /** Stacks inside (for spilling when the furnace is broken). */
  contents(f) { return [f.input, f.fuel, f.output].filter(Boolean).map(cloneStack); },
};
