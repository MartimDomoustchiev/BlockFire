/* ============================================================
 * Inventory: fixed slot array of ItemStacks (null = empty).
 * Slots 0-8 are the hotbar. `version` increments on every change so
 * UIs can redraw only when something actually changed.
 * ============================================================ */
class Inventory {
  constructor(size) {
    this.slots = new Array(size).fill(null);
    this.version = 0;
    // optional rule (story mode): slotFits(i, stack) -> may this stack go into slot i? null = any slot takes anything
    this.slotFits = null;
  }

  /** An empty slot that takes `stack` (hotbar first). -1 if none. */
  firstEmptyFor(stack) {
    for (let i = 0; i < this.slots.length; i++) if (!this.slots[i] && (!this.slotFits || this.slotFits(i, stack))) return i;
    return -1;
  }

  get size() { return this.slots.length; }
  get(i) { return this.slots[i] || null; }

  set(i, s) {
    if (!Number.isInteger(i) || i < 0 || i >= this.slots.length) return;     // never grow the array (indices can come from the network)
    this.slots[i] = s && s.count > 0 ? s : null;
    this.version++;
  }

  swap(i, j) {
    const t = this.slots[i];
    this.slots[i] = this.slots[j];
    this.slots[j] = t;
    this.version++;
  }

  /** Marks the inventory changed after editing a stack object in place. */
  touch() { this.version++; }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  weaponCount() {
    let n = 0;
    for (const s of this.slots) if (s && ITEMS[s.id] && ITEMS[s.id].kind === 'weapon') n++;
    return n;
  }

  /** Empty slot, hotbar first. -1 if full. */
  firstEmpty() {
    for (let i = 0; i < this.slots.length; i++) if (!this.slots[i]) return i;
    return -1;
  }

  /** How many of `stack` would fit right now. */
  spaceFor(stack) {
    const it = ITEMS[stack.id];
    if (!it) return 0;
    if (it.kind === 'weapon' && this.weaponCount() >= CONFIG.MAX_WEAPONS) return 0;
    const max = it.maxStack;
    let room = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) { if (!this.slotFits || this.slotFits(i, stack)) room += (stack.data || max === 1) ? 1 : max; }
      else if (canStack(s, stack)) room += max - s.count;
      if (room >= stack.count) return stack.count;
    }
    return Math.min(room, stack.count);
  }

  /**
   * Adds as much of `stack` as fits (merging into existing stacks first,
   * then empty slots, hotbar first). Does not modify `stack`.
   * Returns the count that did NOT fit.
   */
  add(stack) {
    const it = ITEMS[stack.id];
    if (!it || stack.count <= 0) return stack.count | 0;
    if (it.kind === 'weapon' && this.weaponCount() >= CONFIG.MAX_WEAPONS) return stack.count;
    const max = it.maxStack;
    let left = stack.count;
    if (max > 1 && !stack.data) {
      for (let i = 0; i < this.slots.length && left > 0; i++) {
        const s = this.slots[i];
        if (s && canStack(s, stack) && s.count < max) {
          const put = Math.min(left, max - s.count);
          s.count += put;
          left -= put;
        }
      }
    }
    while (left > 0) {
      const i = this.firstEmptyFor(stack);
      if (i < 0) break;
      const put = stack.data ? 1 : Math.min(left, max);
      const ns = { id: stack.id, count: put };
      if (stack.data) ns.data = Object.assign({}, stack.data);
      this.slots[i] = ns;
      left -= put;
    }
    if (left !== stack.count) this.version++;
    return left;
  }

  /** Removes up to n of item id (main inventory before the hotbar). Returns how many were removed. */
  remove(id, n) {
    let left = n;
    const order = [];
    for (let i = CONFIG.HOTBAR_SLOTS; i < this.slots.length; i++) order.push(i);
    for (let i = 0; i < CONFIG.HOTBAR_SLOTS; i++) order.push(i);
    for (const i of order) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.slots[i] = null;
      if (left <= 0) break;
    }
    if (left !== n) this.version++;
    return n - left;
  }

  /** Removes n from slot i. Returns the removed stack (or null). */
  takeFrom(i, n) {
    const s = this.slots[i];
    if (!s || n <= 0) return null;
    const take = Math.min(n, s.count);
    const out = cloneStack(s);
    out.count = take;
    s.count -= take;
    if (s.count <= 0) this.slots[i] = null;
    this.version++;
    return out;
  }

  clear() { this.slots.fill(null); this.version++; }

  serialize() { return this.slots.map(cloneStack); }
}
