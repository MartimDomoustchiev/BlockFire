/* ============================================================
 * ScreenSession: the rules of an open inventory / crafting table /
 * furnace screen, separate from the DOM so they can run wherever the
 * authority is - in the page for local players, or on the host for
 * online players (who send their clicks over the network).
 *
 * Slot references are plain { c, i } with c one of
 *   'inv' (36 inventory slots), 'grid' (crafting grid), 'output'
 *   (crafting result) or 'furnace' (0 input, 1 fuel, 2 output).
 *
 * Mouse semantics (familiar block-game rules):
 *   left click   pick up a stack / put it down / swap / merge
 *   right click  pick up half / put down one
 *   shift+left   quick-move (hotbar <-> main, grid -> inventory,
 *                ores -> furnace input, fuel -> furnace fuel)
 *   drop         throw one / the whole stack (Q / Ctrl+Q)
 * The cursor stack and the crafting grid belong to the session; closing
 * puts them back into the inventory (or throws what doesn't fit).
 * ============================================================ */
class ScreenSession {
  /** kind: 'inventory' | 'crafting' | 'furnace' */
  constructor(game, ch, kind, pos) {
    this.game = game;
    this.ch = ch;
    this.kind = kind;
    this.pos = pos || null;
    this.cursor = null;
    this.gridW = kind === 'crafting' ? 3 : kind === 'inventory' ? 2 : 0;
    this.grid = this.gridW ? new Array(this.gridW * this.gridW).fill(null) : null;
    this.be = kind === 'furnace' ? game.world.getBlockEntity(pos.x, pos.y, pos.z) : null;
    this.version = 0;              // bumps on every change (network replication)
  }

  // ---------------------------------------------------------------- containers
  container(c) {
    if (c === 'inv') {
      const inv = this.ch.inventory;
      return { kind: 'inv', get: (i) => inv.get(i), set: (i, s) => inv.set(i, s), accepts: () => true };
    }
    if (c === 'grid') return { kind: 'grid', get: (i) => this.grid[i], set: (i, s) => { this.grid[i] = s && s.count > 0 ? s : null; }, accepts: () => true };
    if (c === 'output') return { kind: 'output', get: () => { const m = this.match(); return m && m.result; }, set: () => {}, accepts: () => false };
    const f = this.be, F = ['input', 'fuel', 'output'];
    return {
      kind: 'furnace',
      get: (i) => f[F[i]],
      set: (i, s) => { f[F[i]] = s && s.count > 0 ? s : null; },
      accepts: (i, s) => i === 0 || (i === 1 && Furnace.fuelValue(s.id) > 0),
    };
  }

  get(ref) { return this.container(ref.c).get(ref.i); }

  match() { return this.grid ? Crafting.match(this.grid, this.gridW) : null; }

  /** False once the block behind this screen is gone or its owner died. */
  valid() {
    if (!this.ch.alive) return false;
    if (!this.pos) return true;
    const w = this.game.world, b = w.getBlock(this.pos.x, this.pos.y, this.pos.z);
    const want = this.kind === 'furnace' ? BLOCK.FURNACE : BLOCK.CRAFTING_TABLE;
    return b === want && (this.kind !== 'furnace' || w.getBlockEntity(this.pos.x, this.pos.y, this.pos.z) === this.be);
  }

  // ---------------------------------------------------------------- clicks
  click(ref, button, shift) {
    const c = this.container(ref.c), r = { c, i: ref.i };
    if (ref.c === 'output') this._clickOutput(shift);
    else if (ref.c === 'furnace' && ref.i === 2) this._takeOnly(r, shift);
    else if (shift && button === 0) this._quickMove(r, ref.c);
    else if (button === 0) this._left(r);
    else this._right(r);
    this.ch.inventory.touch();
    this.version++;
  }

  _left(ref) {
    const slot = ref.c.get(ref.i), cur = this.cursor;
    if (!cur && slot) { this.cursor = slot; ref.c.set(ref.i, null); return; }
    if (cur && !slot) { if (ref.c.accepts(ref.i, cur)) { ref.c.set(ref.i, cur); this.cursor = null; } return; }
    if (!cur || !slot) return;
    if (canStack(cur, slot)) {
      const put = Math.min(cur.count, maxStackOf(slot.id) - slot.count);
      slot.count += put; cur.count -= put;
      ref.c.set(ref.i, slot);
      if (cur.count <= 0) this.cursor = null;
    } else if (ref.c.accepts(ref.i, cur)) {
      ref.c.set(ref.i, cur);
      this.cursor = slot;
    }
  }

  _right(ref) {
    const slot = ref.c.get(ref.i), cur = this.cursor;
    if (!cur && slot) {
      const half = Math.ceil(slot.count / 2);
      const taken = cloneStack(slot); taken.count = half;
      slot.count -= half;
      ref.c.set(ref.i, slot.count > 0 ? slot : null);
      this.cursor = taken;
      return;
    }
    if (!cur) return;
    if (!slot) {
      if (!ref.c.accepts(ref.i, cur)) return;
      const one = cloneStack(cur); one.count = 1;
      ref.c.set(ref.i, one);
    } else if (canStack(cur, slot) && slot.count < maxStackOf(slot.id)) {
      slot.count++;
      ref.c.set(ref.i, slot);
    } else {
      if (ref.c.accepts(ref.i, cur)) { ref.c.set(ref.i, cur); this.cursor = slot; }
      return;
    }
    cur.count--;
    if (cur.count <= 0) this.cursor = null;
  }

  /** Furnace output: take only (whole stack, or merge into the cursor). */
  _takeOnly(ref, shift) {
    const slot = ref.c.get(ref.i);
    if (!slot) return;
    if (shift) {
      const left = this.ch.inventory.add(slot);
      if (left > 0) { slot.count = left; ref.c.set(ref.i, slot); } else ref.c.set(ref.i, null);
      return;
    }
    if (!this.cursor) { this.cursor = slot; ref.c.set(ref.i, null); return; }
    if (canStack(this.cursor, slot)) {
      const put = Math.min(slot.count, maxStackOf(slot.id) - this.cursor.count);
      this.cursor.count += put; slot.count -= put;
      ref.c.set(ref.i, slot.count > 0 ? slot : null);
    }
  }

  _clickOutput(shift) {
    let m = this.match();
    if (!m) return;
    const game = this.game;
    if (shift) {
      // craft repeatedly straight into the inventory while it fits
      for (let guard = 0; m && guard < 64 * 9; guard++) {
        if (this.ch.inventory.spaceFor(m.result) < m.result.count) break;
        this.ch.inventory.add(m.result);
        Crafting.consume(this.grid);
        game.events.emit('crafted', { character: this.ch, item: m.result.id, count: m.result.count });
        m = this.match();
      }
      return;
    }
    if (!this.cursor) this.cursor = m.result;
    else if (canStack(this.cursor, m.result) && this.cursor.count + m.result.count <= maxStackOf(m.result.id)) this.cursor.count += m.result.count;
    else return;
    Crafting.consume(this.grid);
    game.events.emit('crafted', { character: this.ch, item: m.result.id, count: m.result.count });
  }

  /** Moves as much of `stack` as possible into inventory slots `indices` (merge first). Returns leftover count. */
  _moveInto(stack, indices) {
    const inv = this.ch.inventory, max = maxStackOf(stack.id);
    let left = stack.count;
    if (!stack.data && max > 1) {
      for (const i of indices) {
        const s = inv.get(i);
        if (left > 0 && s && canStack(s, stack) && s.count < max) {
          const put = Math.min(left, max - s.count);
          s.count += put; left -= put;
        }
      }
    }
    for (const i of indices) {
      if (left <= 0) break;
      if (inv.get(i)) continue;
      const put = Math.min(left, max);
      const ns = cloneStack(stack); ns.count = put;
      inv.set(i, ns);
      left -= put;
    }
    return left;
  }

  _quickMove(ref, cname) {
    const s = ref.c.get(ref.i);
    if (!s) return;
    const H = CONFIG.HOTBAR_SLOTS, N = CONFIG.INVENTORY_SLOTS;
    const range = (a, b) => { const r = []; for (let i = a; i < b; i++) r.push(i); return r; };
    let left;
    if (cname === 'inv') {
      if (this.kind === 'furnace') {
        const fc = this.container('furnace');
        const target = Furnace.isSmeltable(s.id) ? 0 : Furnace.fuelValue(s.id) > 0 ? 1 : -1;
        if (target >= 0) {
          const cur = fc.get(target);
          if (!cur) { fc.set(target, s); ref.c.set(ref.i, null); return; }
          if (canStack(cur, s)) {
            const put = Math.min(s.count, maxStackOf(s.id) - cur.count);
            cur.count += put; s.count -= put;
            ref.c.set(ref.i, s.count > 0 ? s : null);
            return;
          }
        }
      }
      left = this._moveInto(s, ref.i < H ? range(H, N) : range(0, H));
    } else {
      left = this._moveInto(s, range(0, N));     // grid / furnace -> inventory
    }
    if (left <= 0) ref.c.set(ref.i, null);
    else { s.count = left; ref.c.set(ref.i, s); }
  }

  /** Q / Ctrl+Q over a slot. */
  drop(ref, wholeStack) {
    if (ref.c === 'output') return;
    const c = this.container(ref.c), s = c.get(ref.i);
    if (!s) return;
    const n = wholeStack ? s.count : 1;
    const out = cloneStack(s); out.count = n;
    s.count -= n;
    c.set(ref.i, s.count > 0 ? s : null);
    ItemDrop.throwFrom(this.game, this.ch, out);
    this.ch.inventory.touch();
    this.version++;
  }

  /** Puts the cursor stack and the crafting grid back (or drops them). */
  close() {
    const game = this.game, ch = this.ch;
    const leftovers = [];
    if (this.cursor) leftovers.push(this.cursor);
    if (this.grid) for (const s of this.grid) if (s) leftovers.push(s);
    for (const s of leftovers) {
      if (!ch.alive && !game.rules.keepInventory) {        // died with the screen open: it falls with you
        ItemDrop.pop(game, s, ch.pos.x, ch.pos.y + 0.8, ch.pos.z);
        continue;
      }
      const left = ch.inventory.add(s);
      if (left > 0) { const t = cloneStack(s); t.count = left; ItemDrop.throwFrom(game, ch, t); }
    }
    this.cursor = null;
    if (this.grid) this.grid.fill(null);
    this.version++;
  }

  /** Plain state for the network (inventory itself travels separately). */
  snapshot() {
    const f = this.be;
    return {
      kind: this.kind, pos: this.pos, gridW: this.gridW, v: this.version,
      grid: this.grid ? this.grid.map(cloneStack) : null, cursor: cloneStack(this.cursor),
      furnace: f ? { input: cloneStack(f.input), fuel: cloneStack(f.fuel), output: cloneStack(f.output), burn: f.burn, burnMax: f.burnMax, cook: f.cook } : null,
    };
  }
}

/*
 * What an online client's screen shows: the host's session state mirrored
 * locally. Reads come from the last snapshot (the inventory from the local
 * replica of our character); clicks are sent to the host.
 */
class RemoteSession {
  constructor(ch, snap, send) {
    this.ch = ch;
    this.send = send;
    this.apply(snap);
  }
  apply(snap) {
    this.kind = snap.kind; this.pos = snap.pos; this.gridW = snap.gridW;
    this.grid = snap.grid; this.cursor = snap.cursor;
    this.be = snap.furnace;
  }
  container(c) {
    if (c === 'inv') return { get: (i) => this.ch.inventory.get(i) };
    if (c === 'grid') return { get: (i) => this.grid[i] };
    if (c === 'output') return { get: () => { const m = this.match(); return m && m.result; } };
    const F = ['input', 'fuel', 'output'];
    return { get: (i) => this.be && this.be[F[i]] };
  }
  get(ref) { return this.container(ref.c).get(ref.i); }
  match() { return this.grid ? Crafting.match(this.grid, this.gridW) : null; }
  valid() { return this.ch.alive; }
  click(ref, button, shift) { this.send({ op: 'click', ref: { c: ref.c, i: ref.i }, button, shift: !!shift }); }
  drop(ref, whole) { this.send({ op: 'drop', ref: { c: ref.c, i: ref.i }, whole: !!whole }); }
  close() { this.send({ op: 'close' }); }
}
