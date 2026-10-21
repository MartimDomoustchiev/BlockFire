/* ============================================================
 * Procedural item icons (32x32 canvases, cached).
 *  - Block items: a little isometric cube painted from the atlas,
 *    faces shaded like the terrain.
 *  - Other items: original 16x16 pixel art generated from simple
 *    shape rules, scaled 2x without smoothing, with a dark outline.
 * Tools are drawn along a diagonal: `along` runs up the handle
 * (bottom-left -> top-right), `across` runs perpendicular to it.
 * ============================================================ */
const Icons = {
  atlasCanvas: null,
  cache: new Map(),
  urls: new Map(),

  init(atlasCanvas) { this.atlasCanvas = atlasCanvas; },

  canvas(id) {
    let c = this.cache.get(id);
    if (!c) { c = this._make(id); this.cache.set(id, c); }
    return c;
  },

  url(id) {
    let u = this.urls.get(id);
    if (!u) { u = this.canvas(id).toDataURL(); this.urls.set(id, u); }
    return u;
  },

  _make(id) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const it = ITEMS[id];
    if (it && it.kind === 'block') this._cube(ctx, it.blockId);
    else {
      const px = this._pixels(id);
      const small = document.createElement('canvas');
      small.width = small.height = 16;
      const sctx = small.getContext('2d');
      const img = sctx.createImageData(16, 16);
      for (let i = 0; i < 256; i++) {
        const p = px[i];
        if (!p) continue;
        img.data[i * 4] = p[0]; img.data[i * 4 + 1] = p[1]; img.data[i * 4 + 2] = p[2]; img.data[i * 4 + 3] = 255;
      }
      sctx.putImageData(img, 0, 0);
      ctx.drawImage(small, 0, 0, 32, 32);
    }
    return c;
  },

  /** Isometric cube: top, left and right faces drawn from the atlas with affine transforms. */
  _cube(ctx, blockId) {
    const N = CONFIG.ATLAS_TILES, T = CONFIG.TILE_PX, atlas = this.atlasCanvas;
    const tileXY = (face) => {
      const t = BlockTables.faceTiles[blockId * 6 + face];
      return [(t % N) * T, Math.floor(t / N) * T];
    };
    const faces = [
      // [face index, transform a,b,c,d,e,f, darkening]
      [2, 14 / 16, -7 / 16, 14 / 16, 7 / 16, 2, 9, 0],        // top
      [4, 14 / 16, 7 / 16, 0, 1, 2, 9, 0.22],                 // left (+z side)
      [0, 14 / 16, -7 / 16, 0, 1, 16, 16, 0.4],               // right (+x side)
    ];
    for (const [face, a, b, c, d, e, f, dark] of faces) {
      const [sx, sy] = tileXY(face);
      ctx.setTransform(a, b, c, d, e, f);
      ctx.drawImage(atlas, sx, sy, T, T, 0, 0, 16, 16);
      if (dark > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(0,0,0,' + dark + ')';
        ctx.fillRect(0, 0, 16, 16);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },

  /** Side-view gun silhouettes (muzzle to the right), built from rectangles. */
  _gun(cls, set) {
    const R = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
    const DK = [52, 56, 66], MD = [92, 98, 112], LT = [146, 152, 166], WD = [138, 92, 54], OL = [98, 112, 82], GL = [90, 170, 255];
    switch (cls) {
      case 'ar':
        R(0, 6, 2, 9, DK); R(3, 6, 11, 8, MD); R(3, 6, 11, 6, LT); R(12, 7, 15, 7, DK); R(9, 8, 12, 8, DK);
        R(6, 9, 7, 11, DK); R(7, 12, 7, 12, DK); R(3, 9, 4, 11, DK); R(5, 5, 9, 5, DK); R(12, 6, 12, 6, DK); break;
      case 'smg':
        R(1, 7, 3, 7, DK); R(1, 8, 1, 9, DK); R(4, 6, 11, 8, MD); R(4, 6, 11, 6, LT); R(12, 7, 14, 7, DK);
        R(8, 9, 9, 13, DK); R(4, 9, 5, 11, DK); R(6, 5, 8, 5, DK); break;
      case 'pistol':
        R(3, 5, 12, 7, LT); R(3, 7, 12, 7, MD); R(4, 8, 11, 8, DK); R(4, 9, 7, 13, DK); R(5, 10, 6, 12, MD); R(8, 9, 9, 9, DK); R(9, 10, 9, 10, DK); break;
      case 'shotgun':
        R(0, 7, 3, 9, WD); R(4, 6, 8, 8, DK); R(9, 6, 15, 6, DK); R(9, 7, 14, 7, MD); R(10, 8, 13, 8, WD); R(10, 7, 13, 7, WD); R(5, 9, 6, 10, DK); break;
      case 'sniper':
        R(0, 7, 3, 9, WD); R(4, 7, 9, 8, DK); R(10, 7, 15, 7, DK); R(4, 4, 10, 5, [30, 32, 38]); R(10, 4, 10, 5, GL);
        R(6, 6, 6, 6, DK); R(8, 6, 8, 6, DK); R(4, 9, 5, 10, DK); R(13, 8, 13, 10, MD); break;
      case 'rocket':
        R(1, 5, 14, 8, OL); R(1, 5, 14, 5, [130, 146, 110]); R(14, 4, 15, 9, DK); R(0, 5, 1, 8, DK); R(6, 9, 7, 12, DK); R(8, 3, 9, 4, DK); R(11, 9, 11, 10, DK); break;
      case 'bow':
        this._bow(set); break;
      case 'smoke':
        this._smokeBomb(set); for (const [x, y] of [[12, 2], [13, 1], [14, 3], [11, 1]]) set(x, y, [200, 204, 212]); break;
      case 'musket':
        R(0, 8, 4, 10, WD); R(5, 8, 9, 9, WD); R(9, 7, 15, 7, DK); R(6, 7, 9, 7, MD); R(6, 10, 7, 11, DK); R(4, 7, 5, 7, [150, 120, 60]); break;
    }
  },

  /** A recurve bow, string on the right, with an arrow nocked. */
  _bow(set) {
    for (let y = 1; y <= 14; y++) {
      const t = (y - 7.5) / 6.5, x = Math.round(2 + 4 * t * t);
      const grip = y >= 7 && y <= 8;
      set(x, y, grip ? [70, 46, 28] : [150, 98, 52]);
      if (!grip && Math.abs(t) < 0.75) set(x + 1, y, [112, 72, 38]);
    }
    for (let y = 1; y <= 14; y++) set(7, y, [226, 222, 206]);
    this._arrow(set, 8);
  },

  /** An arrow across the icon at row `y`, head to the right. */
  _arrow(set, y) {
    for (let x = 3; x <= 13; x++) set(x, y, [196, 160, 104]);
    set(14, y, [214, 220, 230]); set(15, y, [240, 244, 250]); set(13, y - 1, [170, 176, 186]); set(13, y + 1, [170, 176, 186]);
    for (const x of [3, 4, 5]) { set(x, y - 1, x === 4 ? [200, 60, 44] : [236, 236, 236]); set(x, y + 1, x === 4 ? [200, 60, 44] : [236, 236, 236]); }
  },

  _smokeBomb(set) {
    for (let y = 5; y <= 13; y++) for (let x = 3; x <= 11; x++) {
      const d = Math.hypot(x - 7, y - 9);
      if (d <= 4.4) set(x, y, d > 3.2 ? [40, 42, 48] : (x < 6 && y < 8 ? [120, 124, 134] : [72, 76, 86]));
    }
    set(8, 4, [140, 100, 60]); set(9, 3, [140, 100, 60]); set(10, 2, [255, 170, 60]);
  },

  _consumable(id, set) {
    const R = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
    if (id === 'bandage') {
      R(3, 5, 10, 11, [232, 222, 198]); R(3, 7, 10, 7, [206, 194, 168]); R(3, 9, 10, 9, [206, 194, 168]);
      R(10, 5, 12, 11, [246, 240, 226]); R(11, 7, 11, 9, [196, 184, 158]); R(12, 11, 14, 12, [232, 222, 198]);
    } else if (id === 'medkit') {
      R(6, 3, 9, 4, [70, 74, 84]); R(2, 5, 13, 12, [236, 238, 240]); R(2, 12, 13, 12, [190, 194, 200]);
      R(7, 6, 8, 11, [48, 176, 84]); R(5, 8, 10, 9, [48, 176, 84]);
    } else {
      R(7, 1, 8, 1, [128, 88, 52]); R(7, 2, 8, 4, [196, 222, 240]); R(4, 5, 11, 13, [56, 136, 255]);
      R(5, 4, 10, 4, [196, 222, 240]); R(5, 6, 5, 10, [170, 214, 255]); R(4, 13, 11, 13, [36, 96, 200]);
    }
  },

  /** 256-entry array of [r,g,b] or null for a non-block item. */
  /** A worn piece of the Order's gear: a hood, a cloak, bracers or boots, in leather and cloth tones. */
  _gearPiece(slot, rar, set, shade) {
    const cloth = [[58, 68, 88], [92, 60, 48], [70, 90, 72], [96, 84, 60]], leather = [[126, 84, 48], [104, 70, 42], [92, 62, 40]];
    if (slot === 'head') {
      for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++) { const d = Math.hypot(x - 7.5, y - 8); if (d < 5.4 && !(y > 7 && x > 5 && x < 10)) set(x, y, shade(cloth[rar - 1] || cloth[0], x < 5 ? 30 : 0)); }
      for (let y = 8; y <= 12; y++) for (let x = 5; x <= 10; x++) set(x, y, [24, 18, 16]);
    } else if (slot === 'cloak') {
      for (let y = 3; y <= 13; y++) for (let x = 3; x <= 12; x++) set(x, y, shade(cloth[(rar - 1) % 4], (x === 5 || x === 9) ? 30 : (x === 7 ? -20 : 0)));
      for (let x = 5; x <= 10; x++) set(x, 3, [40, 30, 26]);
    } else if (slot === 'bracers') {
      for (let y = 5; y <= 11; y++) for (let x = 3; x <= 12; x++) set(x, y, shade(leather[0], y === 5 || y === 11 ? -30 : (x % 4 === 0 ? 20 : 0)));
      for (let x = 6; x <= 9; x++) set(x, 8, [206, 176, 80]);
    } else {
      for (let y = 3; y <= 9; y++) for (let x = 5; x <= 9; x++) set(x, y, shade(leather[1], x === 5 ? 30 : 0));
      for (let y = 10; y <= 13; y++) for (let x = 3; x <= 11; x++) set(x, y, shade(leather[2], y === 13 ? -40 : 0));
      for (let x = 3; x <= 11; x++) set(x, 14, [24, 18, 16]);
    }
  },

  _pixels(id) {
    const px = new Array(256).fill(null);
    const set = (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) px[y * 16 + x] = c; };
    const shade = (c, k) => [c[0] + k, c[1] + k, c[2] + k].map((v) => Math.max(0, Math.min(255, v)));
    const HANDLE = [132, 96, 56];
    const MAT = { wood: [176, 134, 82], stone: [140, 140, 148], iron: [212, 218, 228], gold: [248, 206, 70] };
    const it = ITEMS[id] || {};

    // diagonal tool helpers
    const diag = (fn) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const c = fn(x - y, x + y - 15);
        if (c) set(x, y, c);
      }
    };
    const handle = (a, b, maxAlong) => (b === -1 || b === 0) && a >= -11 && a <= maxAlong ? shade(HANDLE, b === 0 ? -26 : 0) : null;

    if (it.kind === 'tool') {
      const m = MAT[it.tool.tier];
      if (it.tool.type === 'pickaxe') {
        diag((a, b) => {
          const ab = Math.abs(b);
          if (ab <= 7 && ((ab <= 4 && (a === 4 || a === 5)) || (ab >= 5 && (a === 3 || a === 4)))) return shade(m, a === 5 || (ab >= 5 && a === 4) ? 40 : 0);
          return handle(a, b, 3);
        });
      } else if (it.tool.type === 'axe') {
        diag((a, b) => {
          if (a >= 1 && a <= 6 && b >= 1 && b <= 5 && !(b >= 4 && (a === 1 || a === 6))) return shade(m, b === 5 || b === 4 ? 40 : 0);
          return handle(a, b, 6);
        });
      } else {
        diag((a, b) => {
          if (a >= 2 && a <= 7 && b >= -3 && b <= 2 && !(a === 7 && (b === -3 || b === 2))) return shade(m, a === 7 || b === -3 ? 40 : 0);
          return handle(a, b, 1);
        });
      }
    } else if (id === 'stick') {
      diag((a, b) => handle(a, b, 6));
    } else if (id === 'iron_ingot' || id === 'gold_ingot') {
      const m = id === 'iron_ingot' ? MAT.iron : MAT.gold;
      for (let x = 4; x <= 11; x++) for (let y = 6; y <= 7; y++) set(x, y, shade(m, 36));
      for (let x = 3; x <= 12; x++) for (let y = 8; y <= 11; y++) set(x, y, shade(m, y === 11 ? -46 : x === 3 ? -20 : 0));
    } else if (id === 'ammo_rockets') {
      for (let y = 3; y <= 12; y++) for (let x = 6; x <= 9; x++) set(x, y, shade([150, 156, 164], x === 6 ? 30 : 0));
      for (let x = 6; x <= 9; x++) { set(x, 2, [208, 60, 48]); set(x, 3, [208, 60, 48]); }
      set(7, 1, [230, 80, 60]); set(8, 1, [230, 80, 60]);
      for (const x of [4, 5, 10, 11]) { set(x, 11, [208, 60, 48]); set(x, 12, [208, 60, 48]); }
      set(5, 10, [208, 60, 48]); set(10, 10, [208, 60, 48]);
      for (let x = 7; x <= 8; x++) set(x, 13, [255, 170, 60]);
    } else if (id === 'arrow') {
      this._arrow(set, 6); this._arrow(set, 10);
    } else if (id === 'smoke_bomb') {
      this._smokeBomb(set);
    } else if (id === 'cloth_scrap') {
      // a folded roll of cloth with a red selvedge
      for (let y = 4; y <= 12; y++) for (let x = 3; x <= 12; x++) set(x, y, (x + y) % 5 === 0 ? [160, 60, 52] : shade([196, 186, 158], x === 3 ? -30 : 0));
      for (let x = 3; x <= 12; x++) set(x, 4, [120, 110, 90]);
    } else if (id === 'leather_strip') {
      // two tanned strips crossed, stitched
      for (let i = 0; i < 9; i++) { set(3 + i, 4 + i, shade([138, 92, 52], i % 3 === 0 ? 30 : 0)); set(11 - i, 4 + i, shade([124, 82, 46], i % 3 === 1 ? 30 : 0)); }
      for (let i = 0; i < 4; i++) set(7 + i % 2, 6 + 2 * i, [226, 206, 150]);
    } else if (it.kind === 'gear') {
      this._gearPiece(it.gear.slot, it.gear.rarity, set, shade);
    } else if (it.kind === 'blade') {
      if (id === 'longsword') {
        // a straight double-edged sword: steel blade with a fuller, a broad crossguard, leather grip, brass pommel
        diag((a, b) => {
          if (a >= -3 && a <= 10 && (b === 0 || b === -1)) return a === 10 ? (b === 0 ? [240, 244, 250] : null) : b === 0 ? [226, 232, 240] : [160, 168, 180];
          if (a === -4 && b >= -4 && b <= 3) return Math.abs(b + 0.5) > 3 ? [214, 176, 80] : [176, 140, 60];
          if (a <= -5 && a >= -8 && (b === 0 || b === -1)) return (a % 2 === 0) ? [92, 60, 36] : [64, 42, 26];
          if (a === -9 && (b === 0 || b === -1)) return [214, 176, 80];
          return null;
        });
      } else if (id === 'sword') {
        diag((a, b) => (Math.abs(b) <= 0 && a >= -2 && a <= 9 ? [214, 220, 232] : a === -3 && Math.abs(b) <= 2 ? [180, 150, 70] : a <= -4 && a >= -7 && b === 0 ? [74, 52, 36] : null));
      } else {
        // wrist blade: a leather bracer with the blade along it
        for (let y = 7; y <= 11; y++) for (let x = 2; x <= 9; x++) set(x, y, y === 7 || y === 11 ? [90, 60, 36] : [126, 86, 52]);
        for (let x = 4; x <= 7; x++) set(x, 9, [176, 140, 60]);
        for (let x = 8; x <= 14; x++) set(x, 6, [214, 220, 232]);
        set(15, 6, [240, 244, 250]); set(9, 5, [150, 156, 166]);
      }
    } else if (it.kind === 'quest') {
      if (id === 'ledger') {
        for (let y = 3; y <= 13; y++) for (let x = 3; x <= 12; x++) set(x, y, x === 3 ? [70, 40, 24] : x >= 11 ? [230, 222, 196] : [120, 70, 40]);
        for (let y = 5; y <= 7; y++) for (let x = 6; x <= 9; x++) set(x, y, [214, 176, 80]);
      } else if (id === 'letter') {
        for (let y = 5; y <= 12; y++) for (let x = 2; x <= 13; x++) set(x, y, [236, 228, 204]);
        for (let i = 0; i < 6; i++) { set(2 + i, 5 + i, [190, 180, 156]); set(13 - i, 5 + i, [190, 180, 156]); }
        for (const [x, y] of [[7, 10], [8, 10], [7, 11], [8, 11]]) set(x, y, [180, 30, 30]);
      } else if (id === 'iron_crate') {
        for (let y = 4; y <= 13; y++) for (let x = 2; x <= 13; x++) set(x, y, (x + y) % 5 === 0 ? [86, 58, 34] : [128, 92, 58]);
        for (let x = 2; x <= 13; x++) { set(x, 6, [96, 102, 112]); set(x, 11, [96, 102, 112]); }
        for (let y = 4; y <= 13; y++) { set(4, y, [96, 102, 112]); set(11, y, [96, 102, 112]); }
      } else if (id === 'ledger_page') {
        for (let y = 3; y <= 13; y++) for (let x = 4; x <= 11; x++) set(x, y, y === 3 && x % 2 ? [214, 204, 176] : [236, 228, 204]);
        for (const y of [5, 7, 9, 11]) for (let x = 5; x <= (y === 11 ? 8 : 10); x++) set(x, y, [96, 76, 52]);
      } else if (id === 'pell_key') {
        for (const [x, y] of [[3, 6], [4, 5], [5, 5], [6, 6], [6, 7], [5, 8], [4, 8], [3, 7]]) set(x, y, [214, 176, 80]);
        for (let x = 7; x <= 14; x++) set(x, 7, [214, 176, 80]);
        for (const [x, y] of [[12, 8], [12, 9], [14, 8], [14, 9], [14, 10]]) set(x, y, [214, 176, 80]);
      } else if (id === 'magistrate_seal') {
        for (let y = 2; y <= 14; y++) for (let x = 2; x <= 14; x++) { const d = Math.hypot(x - 8, y - 8); if (d <= 5.6) set(x, y, d <= 3.6 && d >= 2.6 ? [196, 64, 64] : [150, 30, 36]); }
        for (const [x, y] of [[6, 6], [7, 8], [8, 10], [9, 8], [10, 6]]) set(x, y, [226, 112, 100]);
      } else {
        for (let y = 5; y <= 12; y++) for (let x = 2; x <= 13; x++) set(x, y, y === 5 || y === 8 ? [150, 156, 166] : [104, 70, 42]);
        for (let y = 7; y <= 10; y++) { set(7, y, [214, 176, 80]); set(8, y, [214, 176, 80]); }
      }
    } else if (it.kind === 'ammo') {
      const spec = {
        ammo_light: { xs: [3, 7, 11], top: 6, w: 2, casing: [226, 196, 92], tip: [180, 120, 70] },
        ammo_medium: { xs: [3, 7, 11], top: 3, w: 2, casing: [210, 168, 70], tip: [170, 110, 64] },
        ammo_heavy: { xs: [4, 10], top: 2, w: 3, casing: [176, 180, 192], tip: [120, 124, 136] },
        ammo_shells: { xs: [3, 7, 11], top: 4, w: 3, casing: [196, 52, 44], tip: [222, 184, 88] },
      }[id];
      for (const x0 of spec.xs) {
        for (let y = spec.top; y <= 13; y++) {
          for (let dx = 0; dx < spec.w; dx++) {
            const isTip = id === 'ammo_shells' ? y >= 12 : y <= spec.top + 1;   // shells: brass base
            if (isTip && id !== 'ammo_shells' && y === spec.top && (dx === 0 || dx === spec.w - 1) && spec.w > 2) continue;  // rounded nose
            set(x0 + dx, y, shade(isTip ? spec.tip : spec.casing, dx === 0 ? 30 : 0));
          }
        }
      }
    } else if (it.kind === 'weapon') {
      this._gun(it.weapon.cls, set);
    } else if (it.kind === 'consumable') {
      this._consumable(id, set);
    } else {
      for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) set(x, y, [200, 60, 200]);   // unknown item: magenta
    }

    // 1px dark outline around the art for readability
    const out = px.slice();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (px[y * 16 + x]) continue;
      const n = (xx, yy) => xx >= 0 && xx < 16 && yy >= 0 && yy < 16 && px[yy * 16 + xx];
      if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) out[y * 16 + x] = [26, 20, 18];
    }
    return out;
  },
};
