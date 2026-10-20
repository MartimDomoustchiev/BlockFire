/* ============================================================
 * Hotbar HUD (bottom centre) + the shared slot renderer used by
 * every inventory-style screen.
 * ============================================================ */

/** Fills a .slot element with an ItemStack (icon, count, durability bar). */
function renderSlot(el, stack) {
  const d = stack && stack.data;
  const key = stack ? stack.id + ':' + stack.count + ':' + (d ? d.dur + '/' + d.rarity + '/' + d.mag : '') : '';
  if (el._key === key) return;
  el._key = key;
  el.innerHTML = '';
  const host = el.classList.contains('inner') && el.parentElement && el.parentElement.classList.contains('slot') ? el.parentElement : el;
  const it0 = stack && ITEMS[stack.id];
  const rar = it0 ? (it0.kind === 'weapon' ? d.rarity : it0.kind === 'consumable' ? it0.rarity : -1) : -1;
  if (host) host.style.setProperty('--rar', rar >= 0 ? CONFIG.RARITY[rar].color : 'transparent');
  if (host) host.classList.toggle('rar', rar >= 0);
  if (!stack) { el.removeAttribute('title'); return; }
  const img = document.createElement('img');
  img.src = Icons.url(stack.id);
  img.draggable = false;
  el.appendChild(img);
  if (stack.count > 1 || (it0 && it0.kind === 'weapon')) {
    const n = document.createElement('span');
    n.className = 'count' + (it0.kind === 'weapon' ? ' mag' : '');
    n.textContent = it0.kind === 'weapon' ? d.mag : stack.count;
    el.appendChild(n);
  }
  const it = ITEMS[stack.id];
  if (it && it.kind === 'tool' && stack.data && stack.data.dur < it.tool.durability) {
    const frac = Math.max(0, stack.data.dur / it.tool.durability);
    const bar = document.createElement('i');
    bar.className = 'dur';
    bar.style.width = Math.round(frac * 100) + '%';
    bar.style.background = 'hsl(' + Math.round(frac * 120) + ',80%,50%)';
    el.appendChild(bar);
  }
  el.title = stackLabel(stack);
}

class HotbarHud {
  constructor(hudRoot) {
    this.root = hudRoot.querySelector('.hotbar');
    this.nameEl = hudRoot.querySelector('.itemName');
    this.slots = [];
    for (let i = 0; i < CONFIG.HOTBAR_SLOTS; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      const k = document.createElement('b');
      k.className = 'key';
      k.textContent = i + 1;
      const inner = document.createElement('div');
      inner.className = 'inner';
      s.appendChild(inner); s.appendChild(k);
      this.root.appendChild(s);
      this.slots.push({ el: s, inner });
    }
    this.lastSel = -1;
    this.lastHeldId = null;
    this.nameTimer = 0;
  }

  setVisible(v) { this.root.style.display = v ? '' : 'none'; if (!v) this.nameEl.style.opacity = 0; }

  update(ch, frameDt) {
    if (!ch) return;
    for (let i = 0; i < this.slots.length; i++) {
      renderSlot(this.slots[i].inner, ch.inventory.get(i));
      this.slots[i].el.classList.toggle('sel', i === ch.selectedSlot);
    }
    const held = ch.heldStack();
    const heldId = held ? held.id : null;
    if (ch.selectedSlot !== this.lastSel || heldId !== this.lastHeldId) {
      if (!heldId) this.nameTimer = 0;
      else if (ch.selectedSlot !== this.lastSel || this.lastHeldId === null) {
        this.nameEl.textContent = stackLabel(held);
        this.nameTimer = 1.8;
      }
      this.lastSel = ch.selectedSlot;
      this.lastHeldId = heldId;
    }
    this.nameTimer = Math.max(0, this.nameTimer - frameDt);
    this.nameEl.style.opacity = Math.min(1, this.nameTimer * 2);
  }
}
