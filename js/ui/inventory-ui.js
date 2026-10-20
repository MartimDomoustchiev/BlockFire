/* ============================================================
 * Inventory / crafting table / furnace screens (the view).
 *
 * The rules live in ScreenSession (screen-session.js). Locally the
 * view drives a ScreenSession directly; as an online client it shows
 * a RemoteSession mirrored from the host and forwards clicks.
 * ============================================================ */
class InventoryUI {
  constructor({ input, getGame }) {
    this.input = input;
    this.getGame = getGame;
    this.root = document.getElementById('screen');
    this.titleEl = document.getElementById('screenTitle');
    this.topEl = document.getElementById('screenTop');
    this.mainEl = document.getElementById('screenMain');
    this.hotEl = document.getElementById('screenHot');
    this.cursorEl = document.getElementById('cursorStack');
    this.tipEl = document.getElementById('tooltip');
    this.isOpen = false;
    this.session = null;
    this.ch = null;
    this.slotEls = [];
    this.hover = null;
    this.mouse = { x: 0, y: 0 };
    this.net = null;          // online client: { send(op) } - screens are then run by the host

    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.isOpen) this._placeFloaters();
    });
    window.addEventListener('keydown', (e) => this._onKey(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) e.preventDefault(); });
  }

  // views onto the session (tests read these)
  get kind() { return this.session ? this.session.kind : null; }
  get cursor() { return this.session ? this.session.cursor : null; }
  get grid() { return this.session ? this.session.grid : null; }

  // ---------------------------------------------------------------- open / close
  /** kind: 'inventory' | 'crafting' | 'furnace'. As an online client this asks the host to open it. */
  open(ch, kind, pos) {
    if (this.net) { this.net.send({ op: 'open', kind, pos: pos || null }); return; }
    if (this.isOpen) this.close(false);
    this._show(ch, new ScreenSession(this.getGame(), ch, kind, pos));
  }

  /** Online client: the host opened (or updated) a screen for us. */
  showRemote(ch, snap) {
    if (!snap) { if (this.isOpen) this._hide(false); return; }
    if (this.isOpen && this.session instanceof RemoteSession && this.session.kind === snap.kind) {
      this.session.apply(snap);
      this.refresh();
      return;
    }
    this._show(ch, new RemoteSession(ch, snap, (op) => this.net.send(op)));
  }

  _show(ch, session) {
    this.ch = ch;
    this.session = session;
    this.isOpen = true;
    if (ch.controller && ch.controller.flush) { ch.controller.enabled = false; ch.controller.flush(); }
    this.input.unlock();
    this._build();
    this.root.classList.remove('hidden');
    this.refresh();
  }

  /** relock: re-capture the mouse (only possible inside a user gesture). */
  close(relock) {
    if (!this.isOpen) return;
    this.session.close();
    this._hide(relock);
  }

  _hide(relock) {
    const ch = this.ch;
    this.session = null;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.cursorEl.style.display = 'none';
    this.tipEl.style.display = 'none';
    // discard the key press that closed us so it doesn't also reach the game
    this.input.takeFrame();
    if (ch && ch.controller) { ch.controller.enabled = true; if (ch.controller.flush) ch.controller.flush(); }
    if (relock) this.input.lock();
  }

  _onKey(e) {
    const game = this.getGame();
    if (!game || !game.player) return;
    if (this.isOpen) {
      if (e.code === 'Escape') { e.preventDefault(); this.close(false); return; }
      if (e.code === 'Tab' || e.code === 'KeyE') { e.preventDefault(); this.close(true); return; }
      if (e.code === 'KeyQ' && this.hover) { e.preventDefault(); this.session.drop(this.hover.ref, e.ctrlKey || e.metaKey); this.refresh(); }
      return;
    }
    if (e.code === 'Tab' && this.canOpen && this.canOpen()) {
      e.preventDefault();
      this.open(game.player, 'inventory');
    }
  }

  // ---------------------------------------------------------------- DOM
  _slot(c, index, extraClass) {
    const el = document.createElement('div');
    el.className = 'slot' + (extraClass ? ' ' + extraClass : '');
    const inner = document.createElement('div');
    inner.className = 'inner';
    el.appendChild(inner);
    const ref = { ref: { c, i: index }, el, inner };
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button !== 0 && e.button !== 2) return;
      this.click(ref, e.button, e.shiftKey);
    });
    el.addEventListener('mouseenter', () => { this.hover = ref; this._placeFloaters(); });
    el.addEventListener('mouseleave', () => { if (this.hover === ref) this.hover = null; this._placeFloaters(); });
    this.slotEls.push(ref);
    return el;
  }

  _build() {
    const s = this.session;
    this.slotEls = [];
    this.topEl.innerHTML = '';
    this.mainEl.innerHTML = '';
    this.hotEl.innerHTML = '';
    this.titleEl.textContent = s.kind === 'furnace' ? 'Furnace' : s.kind === 'crafting' ? 'Crafting Table' : 'Crafting';
    if (s.gridW) {
      const g = document.createElement('div');
      g.className = 'craftgrid';
      g.style.gridTemplateColumns = 'repeat(' + s.gridW + ', var(--slot))';
      for (let i = 0; i < s.gridW * s.gridW; i++) g.appendChild(this._slot('grid', i));
      const arrow = document.createElement('div');
      arrow.className = 'arrow';
      this.topEl.append(g, arrow, this._slot('output', 0, 'big'));
    } else if (s.kind === 'furnace') {
      const col = document.createElement('div');
      col.className = 'furnacecol';
      const flame = document.createElement('div');
      flame.className = 'flame';
      flame.innerHTML = '<i></i>';
      this.flameEl = flame.firstChild;
      col.append(this._slot('furnace', 0), flame, this._slot('furnace', 1, 'fuel'));
      const arrow = document.createElement('div');
      arrow.className = 'arrow progress';
      arrow.innerHTML = '<i></i>';
      this.arrowEl = arrow.firstChild;
      this.topEl.append(col, arrow, this._slot('furnace', 2, 'big'));
    }
    for (let i = CONFIG.HOTBAR_SLOTS; i < CONFIG.INVENTORY_SLOTS; i++) this.mainEl.appendChild(this._slot('inv', i));
    for (let i = 0; i < CONFIG.HOTBAR_SLOTS; i++) this.hotEl.appendChild(this._slot('inv', i));
  }

  click(slot, button, shift) {
    this.session.click(slot.ref, button, shift);
    this.refresh();
  }

  /** Redraws every slot (cheap: unchanged slots are skipped by renderSlot). */
  refresh() {
    if (!this.isOpen) return;
    for (const r of this.slotEls) renderSlot(r.inner, this.session.get(r.ref));
    const cur = this.session.cursor;
    if (cur) {
      renderSlot(this.cursorEl, cur);
      this.cursorEl.style.display = 'block';
    } else this.cursorEl.style.display = 'none';
    this._placeFloaters();
  }

  /** Per-frame: live furnace progress, items picked up while open, broken blocks. */
  update() {
    if (!this.isOpen) return;
    const game = this.getGame();
    if (!game || !this.ch || !this.session.valid()) { this.close(false); return; }
    const f = this.session.be;
    if (f && this.flameEl) {
      this.flameEl.style.height = (f.burnMax > 0 ? Math.round(100 * f.burn / f.burnMax) : 0) + '%';
      this.arrowEl.style.width = Math.round(100 * Math.min(1, f.cook / CONFIG.FURNACE.COOK_TIME)) + '%';
    }
    this.refresh();
  }

  _placeFloaters() {
    const { x, y } = this.mouse;
    this.cursorEl.style.left = (x - 18) + 'px';
    this.cursorEl.style.top = (y - 18) + 'px';
    const s = this.hover && this.session && !this.session.cursor ? this.session.get(this.hover.ref) : null;
    if (s) {
      this.tipEl.textContent = stackLabel(s);
      this.tipEl.style.display = 'block';
      this.tipEl.style.left = (x + 14) + 'px';
      this.tipEl.style.top = (y - 30) + 'px';
    } else this.tipEl.style.display = 'none';
  }
}
