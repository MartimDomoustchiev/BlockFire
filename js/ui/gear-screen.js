/* ============================================================
 * The gear screen (story mode, Tab): the Order's assassin-style
 * inventory, in place of the block inventory.
 *
 *   LOADOUT  five slots you can use now (keys 1-5): hidden blade, sword,
 *            ranged weapon, throwable, remedy. Each takes only its kind.
 *   WORN     the outfit: hood, cloak, bracers, boots, and the stats they give
 *   PACK     everything else, filterable (weapons, gear, remedies, materials)
 *
 * Click selects, double-click equips (or wears), right-click sells. The
 * detail bar shows the selected item, what it would change, and the upgrade
 * at the forge. Every action goes through `act(op, i, j)`, which Story runs
 * (locally, or on the host for online friends). Rules: story/gear.js.
 * ============================================================ */
const GEAR_FILTERS = [
  { id: 'all', name: 'ALL' },
  { id: 'weapons', name: 'WEAPONS' },
  { id: 'gear', name: 'GEAR' },
  { id: 'remedies', name: 'REMEDIES' },
  { id: 'materials', name: 'MATERIALS' },
];

class GearView {
  constructor(root, act) {
    this.root = root;
    this.act = act;
    this.sel = -1;               // selected inventory index
    this.filter = 'all';
    this.key = '';
    this.built = false;
  }

  /** Which filter a stack belongs to (for dimming the others). */
  static groupOf(s) {
    const it = s && ITEMS[s.id];
    if (!it) return null;
    if (it.kind === 'gear') return 'gear';
    if (it.kind === 'weapon' || it.kind === 'blade' || it.kind === 'ammo') return 'weapons';
    if (it.kind === 'consumable' || s.id === 'bandage' || s.id === 'medkit' || s.id === 'shield_potion') return 'remedies';
    if (it.kind === 'material' || it.kind === 'quest') return 'materials';
    return 'weapons';
  }

  /** Builds the screen's DOM once per opening. */
  build() {
    const G = CONFIG.STORY.GEAR, slot = (cls) => '<div class="slot ' + cls + '"><div class="inner"></div></div>';
    const worn = G.SLOTS.map((k) => '<div class="gWorn g-' + k + '" data-w="' + k + '">' + slot('big') + '<em>' + G.SLOT_NAMES[k].toUpperCase() + '</em></div>').join('');
    const tabs = GEAR_FILTERS.map((f) => '<button class="gTab' + (f.id === this.filter ? ' sel' : '') + '" data-f="' + f.id + '">' + f.name + '</button>').join('');
    this.root.innerHTML = '<div class="panel gearPanel">' +
      '<div class="gHead"><button class="sClose alt">CLOSE</button><h2>THE ORDER\'S GEAR</h2><span class="gSilver"></span>' +
      '<span class="gHint">click: select - double-click: equip or wear - right-click: sell - Tab: close</span></div>' +
      '<div class="gBody">' +
        '<div class="gCol gLoad"><div class="gLabel">LOADOUT (keys 1-5)</div>' +
          G.LOADOUT.map((l, k) => '<div class="gLRow" data-l="' + k + '"><b>' + (k + 1) + '</b><span>' + l.name + '</span>' + slot('big') + '</div>').join('') +
        '</div>' +
        '<div class="gCol gDoll"><div class="gLabel">WORN</div><div class="gFig"><svg viewBox="0 0 100 200" aria-hidden="true">' +
          '<circle cx="50" cy="26" r="15" /><path d="M36 46 Q50 40 64 46 L72 112 Q50 120 28 112 Z" /><path d="M30 50 L18 108 L24 110 L36 56 Z" /><path d="M70 50 L82 108 L76 110 L64 56 Z" />' +
          '<path d="M38 112 L34 190 L46 190 L50 124 L54 190 L66 190 L62 112 Z" /></svg>' + worn + '</div>' +
          '<div class="gStats"></div></div>' +
        '<div class="gCol gPack"><div class="gLabel">PACK</div><div class="gTabs">' + tabs + '</div><div class="gGrid"></div></div>' +
      '</div>' +
      '<div class="gDetail"><div class="gDInfo"><div class="gDName"></div><div class="gDText"></div><div class="gDStats"></div></div>' +
        '<div class="gDBtns"><button data-act="equip">EQUIP</button><button data-act="upgrade">UPGRADE</button><button data-act="sell" class="alt">SELL</button></div></div>' +
    '</div>';
    this.silverEl = this.root.querySelector('.gSilver');
    this.statsEl = this.root.querySelector('.gStats');
    this.gridEl = this.root.querySelector('.gGrid');
    this.dName = this.root.querySelector('.gDName');
    this.dText = this.root.querySelector('.gDText');
    this.dStats = this.root.querySelector('.gDStats');
    this.btnEquip = this.root.querySelector('[data-act="equip"]');
    this.btnUpgrade = this.root.querySelector('[data-act="upgrade"]');
    this.btnSell = this.root.querySelector('[data-act="sell"]');
    // loadout rows, worn slots and pack slots, each with its inventory index
    this.loadRefs = [];
    this.root.querySelectorAll('.gLRow').forEach((row) => {
      const k = +row.dataset.l, el = row.querySelector('.slot'), inner = el.firstChild;
      this.loadRefs.push({ i: k, el, inner });
      this._wire(el, k);
    });
    this.wornRefs = [];
    this.root.querySelectorAll('.gWorn').forEach((w) => {
      const el = w.querySelector('.slot');
      this.wornRefs.push({ k: w.dataset.w, el, inner: el.firstChild });
      el.addEventListener('click', () => this._selectWorn(w.dataset.w));
      el.addEventListener('dblclick', () => this._selectWorn(w.dataset.w, true));
    });
    this.packRefs = [];
    for (let j = Gear.LOADOUT; j < CONFIG.INVENTORY_SLOTS; j++) {
      const el = document.createElement('div');
      el.className = 'slot gSlot';
      const inner = document.createElement('div');
      inner.className = 'inner';
      el.appendChild(inner);
      this.gridEl.appendChild(el);
      this.packRefs.push({ i: j, el, inner });
      this._wire(el, j);
    }
    this.root.querySelectorAll('.gTab').forEach((b) => b.addEventListener('click', () => {
      this.filter = b.dataset.f;
      this.root.querySelectorAll('.gTab').forEach((o) => o.classList.toggle('sel', o === b));
      this.key = '';
    }));
    this.btnEquip.addEventListener('click', () => this._equipSel());
    this.btnUpgrade.addEventListener('click', () => { if (this.sel >= 0) this.act('upgrade', this.sel); });
    this.btnSell.addEventListener('click', () => { if (this.sel >= 0) this.act('sell', this.sel); });
    this.built = true;
  }

  /** Mouse on a slot: click selects (or moves the selection into a loadout slot), double-click equips, right-click sells. */
  _wire(el, i) {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.sel >= 0 && this.sel !== i && i < Gear.LOADOUT) { this.act('move', this.sel, i); this.sel = -1; return; }
      this.sel = i; this.key = '';
    });
    el.addEventListener('dblclick', () => { this.sel = i; this._equipSel(); });
    // a right click (or a long press on a phone) on a pack slot sells it; a long press on a phone only selects it
    el.addEventListener('pointerdown', (e) => { this.pointer = e.pointerType; });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); this.sel = i; this.key = '';
      if (this.pointer !== 'touch') this.act('sell', i);
    });
  }

  _selectWorn(k, equip) {
    const inv = this.ch.inventory;
    const idx = inv.slots.findIndex((s) => Gear.worn(s) && Gear.pieceOf(s).slot === k);
    if (idx < 0) return;
    this.sel = idx; this.key = '';
    if (equip) this.act('equip', idx);
  }

  /** Equip action for the selected item: wear a piece, or put a weapon / remedy in its loadout slot. */
  _equipSel() {
    if (this.sel < 0) return;
    const s = this.ch.inventory.get(this.sel);
    if (!s) return;
    this.act('equip', this.sel);
  }

  open(ch, st) {
    this.ch = ch;
    this.sel = -1;
    this.key = '';
    this.build();                // the screen's DOM is cleared on close, so it is built again each time
    this.refresh(ch, st, true);
  }

  /** Per frame while open: redraws only when the pack, the silver or the selection changed. */
  refresh(ch, st, force) {
    this.ch = ch;
    const inv = ch.inventory, key = [inv.version, st.silver, this.sel, this.filter, st.shop ? 1 : 0, st.nearForge(ch) ? 1 : 0].join('|');
    if (!force && key === this.key) return;
    this.key = key;
    const G = CONFIG.STORY.GEAR;
    this.silverEl.textContent = 'silver ' + st.silver;
    for (const r of this.loadRefs) { renderSlot(r.inner, inv.get(r.i)); r.el.classList.toggle('sel', r.i === this.sel); }
    for (const r of this.wornRefs) {
      const idx = inv.slots.findIndex((s) => Gear.worn(s) && Gear.pieceOf(s).slot === r.k);
      renderSlot(r.inner, idx >= 0 ? inv.get(idx) : null);
      r.el.classList.toggle('sel', idx >= 0 && idx === this.sel);
      r.el.classList.toggle('empty', idx < 0);
    }
    for (const r of this.packRefs) {
      const s = inv.get(r.i);
      renderSlot(r.inner, s);
      r.el.classList.toggle('sel', r.i === this.sel);
      r.el.classList.toggle('dim', this.filter !== 'all' && !!s && GearView.groupOf(s) !== this.filter);
      r.el.classList.toggle('worn', Gear.worn(s));
    }
    // what the worn gear does
    const S = Gear.stats(ch);
    const bar = (label, pts, text) => '<div class="gStat"><span>' + label + '</span><i><b style="width:' + Math.min(100, pts * 3) + '%"></b></i><em>' + text + '</em></div>';
    this.statsEl.innerHTML =
      bar('ATTACK', S.attack, S.attack ? '+' + Math.round(S.attack * G.ATTACK_PER_POINT * 100) + '% blades' : 'none') +
      bar('DEFENSE', S.defense, S.defense ? '-' + Math.round(Math.min(G.DEFENSE_CAP, S.defense * G.DEFENSE_PER_POINT) * 100) + '% damage' : 'none') +
      bar('STEALTH', S.stealth, S.stealth ? '-' + Math.round(Math.min(G.STEALTH_CAP, S.stealth * G.STEALTH_PER_POINT) * 100) + '% noticed' : 'none');
    this._detail(ch, st);
  }

  _detail(ch, st) {
    const inv = ch.inventory, s = this.sel >= 0 ? inv.get(this.sel) : null, G = CONFIG.STORY.GEAR;
    const it = s && ITEMS[s.id];
    this.btnEquip.disabled = !s;
    this.btnSell.disabled = !s || Gear.sellPrice(s) <= 0 || Gear.worn(s) || s.id === 'wrist_blade';
    this.btnSell.textContent = s && Gear.sellPrice(s) > 0 ? 'SELL ' + Gear.sellPrice(s) : 'SELL';
    this.btnUpgrade.disabled = !s || !Gear.pieceOf(s) || !Gear.upgradeCost(s);
    if (!s) {
      this.dName.textContent = 'Select an item';
      this.dName.style.color = '';
      this.dText.textContent = 'Wear outfit pieces for stats. Weapons and remedies go in the loadout (keys 1-5). Sell what you do not need; upgrade gear at Ida\'s forge.';
      this.dStats.textContent = '';
      this.btnEquip.textContent = 'EQUIP';
      return;
    }
    const p = Gear.pieceOf(s), rar = p ? p.rarity : (it.kind === 'consumable' ? it.rarity : it.kind === 'weapon' && s.data ? s.data.rarity : -1);
    this.dName.textContent = stackLabel(s);
    this.dName.style.color = rar >= 0 ? CONFIG.RARITY[rar].color : '';
    if (p) {
      const now = Gear.piecePoints(s), k = Gear.levelOf(s);
      const worn = inv.slots.find((o) => Gear.worn(o) && Gear.pieceOf(o).slot === p.slot);
      const fmt = (pts) => Object.keys(pts).map((key) => '+' + pts[key] + ' ' + key).join(', ');
      let txt = p.desc + '\n' + 'Now: ' + fmt(now) + (k < G.MAX_LEVEL ? '.  Level ' + (k + 1) + ': ' + fmt(Gear.piecePoints(Object.assign({}, s, { data: { lvl: k + 1 } }))) : '.');
      if (!Gear.worn(s) && worn) {
        const before = Gear.piecePoints(worn), diff = [];
        for (const key of ['attack', 'defense', 'stealth']) {
          const d = (now[key] || 0) - (before[key] || 0);
          if (d) diff.push((d > 0 ? '+' : '') + d + ' ' + key);
        }
        txt += '\nCompared with ' + ITEMS[worn.id].name + ': ' + (diff.length ? diff.join(', ') : 'the same');
      }
      this.dText.textContent = txt;
      const cost = Gear.upgradeCost(s);
      this.dStats.textContent = cost ? 'Upgrade to level ' + (k + 1) + ': ' + cost.silver + ' silver' +
        Object.keys(cost).filter((c) => c !== 'silver').map((c) => ', ' + cost[c] + ' ' + (ITEMS[c] ? ITEMS[c].name.toLowerCase() : c)).join('') +
        (st.nearForge(ch) ? '' : ' (at Ida\'s forge)') : 'Fully upgraded.';
      this.btnEquip.textContent = Gear.worn(s) ? 'TAKE OFF' : 'WEAR';
    } else {
      const slotOf = { longsword: 'Sword', sword: 'Sword', wrist_blade: 'Hidden blade', w_bow: 'Ranged', w_pistol: 'Ranged', w_musket: 'Ranged', w_smoke: 'Throwable', bandage: 'Remedy', medkit: 'Remedy', shield_potion: 'Remedy' }[s.id];
      this.dText.textContent = (it.desc || (it.kind === 'material' ? 'Materials for upgrades. Ida pays for them too.' : it.kind === 'ammo' ? 'Ammunition: you carry it, the loadout fires it.' : it.kind === 'quest' ? 'A thing the Order needs. It cannot be sold.' : ''))
        + (slotOf ? '\nLoadout slot: ' + slotOf + '.' : '') + (s.count > 1 ? '\nYou carry ' + s.count + '.' : '');
      this.dStats.textContent = Gear.sellPrice(s) > 0 ? 'Sells for ' + Gear.sellPrice(s) + ' silver.' : '';
      this.btnEquip.textContent = slotOf ? (inv.slots.indexOf(s) < Gear.LOADOUT ? 'IN LOADOUT' : 'EQUIP') : 'EQUIP';
      this.btnEquip.disabled = !s || !slotOf || inv.slots.indexOf(s) < Gear.LOADOUT;
    }
  }
}
