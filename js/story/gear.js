/* ============================================================
 * The Order's gear (story mode): assassin's-creed-style equipment.
 *
 *   loadout   the first five hotbar slots: hidden blade, sword, ranged
 *             weapon, throwable, remedy. Each accepts only its own kind
 *             of item (slotFits), so a bow never lands in the sword slot.
 *   outfit    hood, cloak, bracers and boots: pieces with stats and a
 *             level. Wearing one is data.eq = 1 on its stack; wearing a
 *             second piece for the same place takes the first one off.
 *   pack      everything else, in the remaining inventory slots.
 *   stats     attack (blade damage), defense (damage taken) and stealth
 *             (how slowly guards notice you), summed from what you wear.
 *   forge     Ida upgrades a piece to level 2 and 3 with silver and
 *             materials; selling gives silver back.
 *
 * These rules run where the authority is (the story director, on the
 * host or offline). Screens only ask for actions through Story.act.
 * ============================================================ */
const Gear = {
  G: CONFIG.STORY.GEAR,
  LOADOUT: CONFIG.STORY.GEAR.LOADOUT.length,

  /** Can stack `s` go in inventory slot i? Only loadout slots restrict what they take. */
  slotFits(i, s) {
    if (i >= this.LOADOUT) return true;
    return !!s && this.G.LOADOUT[i].ids.indexOf(s.id) >= 0;
  },

  /** Story characters: their inventory follows the loadout rules, and the outfit starts with the hood. */
  attach(ch) {
    ch.inventory.slotFits = (i, s) => this.slotFits(i, s);
    this.normalize(ch);
  },

  /**
   * Puts every item where it belongs: each loadout slot takes the first item it accepts (from the loadout or the pack),
   * the rest fill the pack in order. Saves and new pickups go through here.
   */
  normalize(ch) {
    const inv = ch.inventory, L = this.LOADOUT, all = [];
    for (let i = 0; i < L; i++) if (inv.get(i)) all.push(inv.get(i));          // loadout items first: they keep their place
    for (let i = L; i < inv.size; i++) if (inv.get(i)) all.push(inv.get(i));
    const used = new Set(), place = new Array(inv.size).fill(null);
    for (let i = 0; i < L; i++) {
      const k = all.findIndex((s, idx) => !used.has(idx) && this.slotFits(i, s));
      if (k >= 0) { place[i] = all[k]; used.add(k); }
    }
    let j = L;
    all.forEach((s, idx) => {
      if (used.has(idx)) return;
      while (j < inv.size && place[j]) j++;
      if (j < inv.size) place[j++] = s;
    });
    for (let i = 0; i < inv.size; i++) inv.set(i, place[i] || null);
    inv.touch();
  },

  /** The gear definition of a stack, or null. */
  pieceOf(s) { return s && ITEMS[s.id] && ITEMS[s.id].kind === 'gear' ? ITEMS[s.id].gear : null; },
  levelOf(s) { return s && s.data && s.data.lvl ? s.data.lvl : 1; },
  worn(s) { return !!(s && s.data && s.data.eq); },

  /** Stats of one piece at its level (fractions of its base points). */
  piecePoints(s) {
    const p = this.pieceOf(s);
    if (!p) return null;
    const k = 1 + this.G.LEVEL_BONUS * (this.levelOf(s) - 1), out = {};
    for (const key of Object.keys(p.stats)) out[key] = Math.round(p.stats[key] * k);
    return out;
  },

  /** Points from everything worn: { attack, defense, stealth }. Cached until the inventory changes. */
  stats(ch) {
    const inv = ch.inventory;
    if (ch._gearStats && ch._gearStats.v === inv.version) return ch._gearStats.s;
    const s = { attack: 0, defense: 0, stealth: 0 };
    for (const it of inv.slots) {
      if (!this.worn(it)) continue;
      const pts = this.piecePoints(it);
      if (pts) for (const k of Object.keys(pts)) s[k] = (s[k] || 0) + pts[k];
    }
    ch._gearStats = { v: inv.version, s };
    return s;
  },

  /** Share of incoming damage that gets through (1 = all of it). */
  damageTakenMult(ch) { return 1 - Math.min(this.G.DEFENSE_CAP, this.stats(ch).defense * this.G.DEFENSE_PER_POINT); },
  /** Blade damage multiplier. */
  attackMult(ch) { return 1 + this.stats(ch).attack * this.G.ATTACK_PER_POINT; },
  /** Awareness growth multiplier (guards noticing this character). */
  stealthMult(ch) { return 1 - Math.min(this.G.STEALTH_CAP, this.stats(ch).stealth * this.G.STEALTH_PER_POINT); },

  /** What a stack sells for (0 if it can't be sold). */
  sellPrice(s) {
    if (!s || this.isQuest(s)) return 0;
    const kind = ITEMS[s.id] && ITEMS[s.id].kind;
    if (kind === 'weapon' || kind === 'ammo') return 0;      // the Order's shop and restocks are the only source of these: no silver loop
    const p = this.pieceOf(s);
    if (p) return Math.round(p.price * 0.4 * (1 + 0.5 * (this.levelOf(s) - 1)));
    if (this.G.MATERIALS[s.id]) return this.G.MATERIALS[s.id].sell * s.count;
    const key = { w_bow: 'bow', w_pistol: 'pistol', w_musket: 'musket', w_smoke: 'smoke' }[s.id] || s.id;
    return (this.G.SELL[key] || 0) * s.count;
  },

  isQuest(s) { return !!s && ITEMS[s.id] && ITEMS[s.id].kind === 'quest'; },

  /** Cost of the next level for a piece (null at the top). */
  upgradeCost(s) {
    const lvl = this.levelOf(s) + 1;          // UPGRADE[n] is the price of reaching level n + 1
    return lvl > this.G.MAX_LEVEL ? null : this.G.UPGRADE[lvl - 1];
  },

  /**
   * Runs one gear action for `ch` (story: the Story supplies the silver and the forge). Returns { ok, msg }.
   *   equip   i: wear or take off a piece; a pack item for the loadout goes to its slot (the one there goes to the pack)
   *   move    i -> j: swap two slots, if each item fits the other slot
   *   sell    i: sell a stack for silver (not equipped gear, not quest items, not the hidden blade)
   *   upgrade i: raise a piece one level at the forge (silver and materials from the pack)
   */
  act(story, ch, op, i, j) {
    const inv = ch.inventory;
    const slot = (x) => Number.isInteger(x) && x >= 0 && x < inv.size;     // indices come from the network too
    if (!slot(i) || (op === 'move' && !slot(j))) return { ok: false, msg: 'That does not go there.' };
    const s = inv.get(i);
    if (op === 'equip') {
      if (!s) return { ok: false, msg: 'Nothing there.' };
      if (this.pieceOf(s)) {
        const slot = this.pieceOf(s).slot;
        if (this.worn(s)) { s.data.eq = 0; inv.touch(); return { ok: true, msg: 'Took off the ' + this.G.SLOT_NAMES[slot].toLowerCase() + '.' }; }
        for (const it of inv.slots) if (it && this.worn(it) && this.pieceOf(it).slot === slot) it.data.eq = 0;
        s.data.eq = 1; inv.touch();
        return { ok: true, msg: 'Wearing ' + this.pieceOf(s).name + '.' };
      }
      if (i < this.LOADOUT) return { ok: false, msg: 'Already in your loadout.' };
      for (let k = 0; k < this.LOADOUT; k++) {
        if (!this.slotFits(k, s)) continue;
        const cur = inv.get(k);
        inv.set(k, s); inv.set(i, cur || null);
        return { ok: true, msg: 'Loadout: ' + this.G.LOADOUT[k].name + '.' };
      }
      return { ok: false, msg: 'That does not go in your loadout.' };
    }
    if (op === 'move') {
      const t = inv.get(j), okA = this.slotFits(j, s), okB = !t || this.slotFits(i, t);
      if (!s || !okA || !okB) return { ok: false, msg: 'That does not go there.' };
      if (i === j) return { ok: true, msg: '' };
      inv.set(j, s); inv.set(i, t || null);
      return { ok: true, msg: '' };
    }
    if (op === 'sell') {
      if (!s) return { ok: false, msg: 'Nothing there.' };
      if (this.isQuest(s) || s.id === 'wrist_blade') return { ok: false, msg: 'You can\'t sell that.' };
      if (this.worn(s)) return { ok: false, msg: 'Take it off first.' };
      const price = this.sellPrice(s);
      if (price <= 0) return { ok: false, msg: 'Nobody wants that.' };
      inv.set(i, null);
      story.addSilver(price);
      return { ok: true, msg: 'Sold for ' + price + ' silver.' };
    }
    if (op === 'upgrade') {
      if (!s || !this.pieceOf(s)) return { ok: false, msg: 'Only gear can be upgraded.' };
      const cost = this.upgradeCost(s);
      if (!cost) return { ok: false, msg: this.pieceOf(s).name + ' is at its best.' };
      if (!story.shop) return { ok: false, msg: 'Come back when Ida has opened her forge.' };
      if (!story.nearForge(ch)) return { ok: false, msg: 'Ida\'s forge is in the hideout: go to her.' };
      const need = Object.keys(cost).filter((k) => k !== 'silver');
      for (const id of need) if (inv.count(id) < cost[id]) return { ok: false, msg: 'Need ' + cost[id] + ' ' + (ITEMS[id] ? ITEMS[id].name.toLowerCase() : id) + '.' };
      if (story.silver < (cost.silver || 0)) return { ok: false, msg: 'Need ' + cost.silver + ' silver.' };
      for (const id of need) inv.remove(id, cost[id]);
      story.addSilver(-(cost.silver || 0));
      s.data.lvl = this.levelOf(s) + 1; inv.touch();
      story.stats.upgrades++;
      if (s.data.lvl >= this.G.MAX_LEVEL) story.stats.maxedGear++;
      return { ok: true, msg: this.pieceOf(s).name + ' is now level ' + s.data.lvl + '.' };
    }
    return { ok: false, msg: '' };
  },
};
