/* ============================================================
 * Fast building (stage 4).
 *
 * Pieces are made of the BUILD_WOOD / BUILD_STONE / BUILD_METAL
 * voxels, so they collide, render and get destroyed like any block,
 * and a registry tracks which voxels form which piece and its HP.
 *
 * Grid: horizontally, cells are CONFIG.BUILD.CELL (4) blocks aligned
 * to multiples of 4 in world space. Vertically, pieces start at the
 * player's feet level y0 (terrain heights aren't multiples of 4, and
 * this makes each ramp start exactly where the previous one ended).
 * For a player in column cell (cx, cz) facing d (yaw snapped to an axis):
 *   wall   4x4 plane just outside the player's cell on side d, y0..y0+3
 *   floor  4x4 plate in the cell ahead at y0-1 (flush with your feet)
 *   ramp   1-block steps y0..y0+3 rising away from the player in the
 *          cell ahead; each step is 1 high, so auto step-up walks it
 *   roof   4x4 plate at y0+4 over the cell ahead (or your own cell when
 *          looking up) with a raised 2x2 peak
 * The "cell ahead" is always the neighbouring cell you face, so a
 * piece never lands on top of you. Voxels only go into air / water / leaves; voxels that
 * would trap a character are skipped. A piece needs MIN_FILL of its
 * voxels free and never overlaps another piece.
 *
 * Pieces start at START_HP_FRACTION of their HP and grow to full over
 * the material's build time. Bullets, pickaxes and explosions damage
 * them; at 0 HP every voxel disappears.
 *
 * Edit mode (walls): the 4x4 wall is 2x2 tiles of 2x2 blocks. Toggle
 * tiles with fire, confirm with the edit key: removed tiles become a
 * door (bottom) or window (top). Editing again can restore them.
 * ============================================================ */
const PIECE_TYPES = ['wall', 'floor', 'ramp', 'roof'];
const BUILD_MATERIALS = ['wood', 'stone', 'metal'];

const Building = {
  // ---------------------------------------------------------------- state
  init(game) {
    game.pieces = new Map();           // id -> piece
    game.pieceAt = new Map();          // "x,y,z" -> piece id
    game.nextPieceId = 1;
  },

  key(x, y, z) { return x + ',' + y + ',' + z; },

  pieceAtBlock(game, x, y, z) {
    const id = game.pieceAt.get(this.key(x, y, z));
    return id ? game.pieces.get(id) || null : null;
  },

  newState() {
    return { active: false, piece: 'wall', material: 'wood', target: null, cooldown: 0, lastKey: '', swing: 0, edit: null };
  },

  // ---------------------------------------------------------------- geometry
  /** Yaw snapped to one of the 4 axis directions: [dx, dz]. */
  facing(yaw) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? [1, 0] : [-1, 0];
    return fz > 0 ? [0, 1] : [0, -1];
  },

  /** Target slot for a piece type: { type, cx, cy, cz, dx, dz, key }. */
  target(ch, type) {
    const S = CONFIG.BUILD.CELL;
    const [dx, dz] = this.facing(ch.yaw);
    const cy = Math.floor(ch.pos.y + 0.001);              // feet level (named cy for the slot key)
    const pcx = Math.floor(ch.pos.x / S), pcz = Math.floor(ch.pos.z / S);
    const ax = pcx + dx, az = pcz + dz;                        // the neighbouring cell you face
    let t;
    if (type === 'wall') t = { type, cx: pcx, cy, cz: pcz, dx, dz };
    else if (type === 'floor') t = ch.pitch < -0.75 ? { type, cx: pcx, cy, cz: pcz, dx, dz } : { type, cx: ax, cy, cz: az, dx, dz };
    else if (type === 'ramp') t = { type, cx: ax, cy, cz: az, dx, dz };
    else t = ch.pitch > 0.6 ? { type, cx: pcx, cy, cz: pcz, dx, dz } : { type, cx: ax, cy, cz: az, dx, dz };
    t.key = [t.type, t.cx, t.cy, t.cz, t.dx, t.dz].join(',');
    return t;
  },

  /** Every voxel a piece would occupy (before filtering). */
  voxels(t) {
    const S = CONFIG.BUILD.CELL, x0 = t.cx * S, y0 = t.cy, z0 = t.cz * S, out = [];
    switch (t.type) {
      case 'wall': {
        // just outside the player's cell on the facing side
        const ex = t.dx > 0 ? x0 + S : t.dx < 0 ? x0 - 1 : 0;
        const ez = t.dz > 0 ? z0 + S : t.dz < 0 ? z0 - 1 : 0;
        for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
          if (t.dx) out.push([ex, y0 + v, z0 + u, u, v]); else out.push([x0 + u, y0 + v, ez, u, v]);
        }
        break;
      }
      case 'floor':
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) out.push([x0 + i, y0 - 1, z0 + j, i, j]);
        break;
      case 'ramp':
        for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
          // i = distance along the facing direction from the near edge of the cell
          const along = t.dx > 0 ? x0 + i : t.dx < 0 ? x0 + S - 1 - i : null;
          const alongZ = t.dz > 0 ? z0 + i : t.dz < 0 ? z0 + S - 1 - i : null;
          if (t.dx) out.push([along, y0 + i, z0 + j, i, j]); else out.push([x0 + j, y0 + i, alongZ, j, i]);
        }
        break;
      case 'roof':
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) out.push([x0 + i, y0 + S, z0 + j, i, j]);
        for (let j = 1; j < S - 1; j++) for (let i = 1; i < S - 1; i++) out.push([x0 + i, y0 + S + 1, z0 + j, i, j]);
        break;
    }
    return out;
  },

  /** Can a piece voxel go into this world cell right now? */
  freeCell(game, x, y, z) {
    if (y < 0 || y >= CONFIG.CHUNK_HEIGHT) return false;
    const b = game.world.getBlock(x, y, z);
    if (b !== BLOCK.AIR && b !== BLOCK.WATER && b !== BLOCK.LEAVES) return false;
    for (const e of game.entities.values()) if (e.type === 'character' && e.alive && e.overlapsCell(x, y, z)) return false;
    return true;
  },

  /** Placement check: { ok, cells, reason }. */
  evaluate(game, ch, t, material) {
    const all = this.voxels(t);
    for (const v of all) if (game.pieceAt.has(this.key(v[0], v[1], v[2]))) return { ok: false, cells: [], all, reason: 'occupied' };
    const cells = all.filter((v) => this.freeCell(game, v[0], v[1], v[2]));
    if (cells.length < all.length * CONFIG.BUILD.MIN_FILL) return { ok: false, cells, all, reason: 'blocked' };
    if (!this.canAfford(game, ch, material)) return { ok: false, cells, all, reason: 'materials' };
    return { ok: true, cells, all, reason: null };
  },

  canAfford(game, ch, material) {
    if (game.rules.infiniteBlocks) return true;
    const m = CONFIG.BUILD.MATERIALS[material];
    return ch.inventory.count(m.item) >= m.cost;
  },

  materialCount(ch, material) { return ch.inventory.count(CONFIG.BUILD.MATERIALS[material].item); },

  // ---------------------------------------------------------------- placing / destroying
  place(game, ch, t, material) {
    const ev = this.evaluate(game, ch, t, material);
    if (!ev.ok) return null;
    const M = CONFIG.BUILD.MATERIALS[material];
    if (!game.rules.infiniteBlocks) ch.inventory.remove(M.item, M.cost);
    const piece = {
      id: game.nextPieceId++, type: t.type, material, key: t.key, slot: t,
      maxHp: M.hp, hp: M.hp * CONFIG.BUILD.START_HP_FRACTION, building: true,
      cells: ev.cells.map((v) => [v[0], v[1], v[2], v[3], v[4]]), total: ev.cells.length,
      removedTiles: [], owner: ch.id,
    };
    game.pieces.set(piece.id, piece);
    for (const v of piece.cells) game.pieceAt.set(this.key(v[0], v[1], v[2]), piece.id);
    game.world.setBlocks(piece.cells.map((v) => [v[0], v[1], v[2], M.block]));
    game.events.emit('piecePlaced', { piece, by: ch });
    return piece;
  },

  destroy(game, piece, by) {
    if (!game.pieces.has(piece.id)) return;
    game.pieces.delete(piece.id);
    const list = [];
    for (const v of piece.cells) {
      const k = this.key(v[0], v[1], v[2]);
      if (game.pieceAt.get(k) === piece.id) {
        game.pieceAt.delete(k);
        list.push([v[0], v[1], v[2], BLOCK.AIR]);
      }
    }
    game.world.setBlocks(list);
    game.events.emit('pieceDestroyed', { piece, by, cells: list });
  },

  /** Damage from bullets / tools. Non-piece blocks are ignored. */
  damageBlock(game, x, y, z, amount, by) {
    const piece = this.pieceAtBlock(game, x, y, z);
    if (!piece || !(amount > 0)) return false;
    piece.hp -= amount;
    piece.building = false;                       // damaged pieces stop growing (like in BR games)
    game.events.emit('pieceDamaged', { piece, amount, by, x, y, z });
    if (piece.hp <= 0) this.destroy(game, piece, by);
    return true;
  },

  /** A piece voxel was removed by something else (explosion, mining): forget it; collapse badly holed pieces. */
  onBlockDestroyed(game, x, y, z) {
    const k = this.key(x, y, z);
    const id = game.pieceAt.get(k);
    if (!id) return;
    game.pieceAt.delete(k);
    const piece = game.pieces.get(id);
    if (!piece) return;
    piece.cells = piece.cells.filter((v) => !(v[0] === x && v[1] === y && v[2] === z));
    if (piece.cells.length <= piece.total * (1 - CONFIG.BUILD.EXPLOSION_DESTROY_FRACTION)) this.destroy(game, piece, null);
  },

  /** Grows pieces that are still being built. */
  tick(game, dt) {
    for (const p of game.pieces.values()) {
      if (!p.building) continue;
      const M = CONFIG.BUILD.MATERIALS[p.material];
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * (1 - CONFIG.BUILD.START_HP_FRACTION) * dt / M.buildTime);
      if (p.hp >= p.maxHp) p.building = false;
    }
  },

  // ---------------------------------------------------------------- per-character input
  /**
   * Build-mode logic for one character for one tick. Returns true while
   * build mode is active (weapons/mining are then suppressed).
   */
  /** preview: an online client's own player - track the mode / piece / target for the ghost, never place. */
  update(ch, it, dt, game, preview) {
    const b = ch.build;
    b.cooldown = Math.max(0, b.cooldown - dt);
    b.swing = Math.max(0, b.swing - dt);
    if (!ch.alive || ch.vehicle) { b.active = false; b.edit = null; return false; }

    if (it.buildPiece) { b.active = true; b.piece = it.buildPiece; b.edit = null; }
    else if (it.toggleBuild) { b.active = !b.active; b.edit = null; }
    if (it.slot >= 0 || it.slotDelta) {
      if (b.active && it.slotDelta && it.slot < 0) {            // wheel cycles pieces while building
        const i = PIECE_TYPES.indexOf(b.piece);
        b.piece = PIECE_TYPES[(i + Math.sign(it.slotDelta) + PIECE_TYPES.length) % PIECE_TYPES.length];
      } else { b.active = false; b.edit = null; }
    }

    // shortcuts work in and out of build mode
    if (!preview && it.boxUp) this.boxUp(game, ch);
    if (!preview && it.rampRush) this.rampRush(game, ch);

    // edit mode on a wall piece (an online client gets its edit state from the host)
    if (!preview && it.editMode) {
      if (b.edit) this.confirmEdit(game, ch);
      else this.startEdit(game, ch);
    }
    if (b.edit) {
      if (!preview) this.updateEdit(game, ch, it);
      return true;
    }
    if (!b.active) { b.target = null; return false; }

    if (it.aimPressed) b.material = BUILD_MATERIALS[(BUILD_MATERIALS.indexOf(b.material) + 1) % BUILD_MATERIALS.length];
    const t = this.target(ch, b.piece);
    const ev = this.evaluate(game, ch, t, b.material);
    b.target = { slot: t, ok: ev.ok, cells: ev.ok ? ev.cells : ev.all, reason: ev.reason };
    if (!preview && it.fire && ev.ok && (it.firePressed || b.cooldown <= 0)) {
      if (this.place(game, ch, t, b.material)) b.cooldown = CONFIG.BUILD.REPEAT;
    }
    return true;
  },

  /**
   * Ramp rush (called every tick while held). Standing on a ramp, the next
   * ramp goes in the cell beyond it, starting exactly at its top; otherwise
   * in the cell next to yours at your feet level. So holding forward +
   * ramp rush builds one continuous staircase.
   */
  rampRush(game, ch) {
    const S = CONFIG.BUILD.CELL, material = ch.build.material;
    let t = null;
    const under = this.pieceUnder(game, ch);
    if (under && under.type === 'ramp') {
      const s = under.slot;
      t = { type: 'ramp', cx: s.cx + s.dx, cy: s.cy + S, cz: s.cz + s.dz, dx: s.dx, dz: s.dz };
    } else {
      const [dx, dz] = this.facing(ch.yaw);
      t = { type: 'ramp', cx: Math.floor(ch.pos.x / S) + dx, cy: Math.floor(ch.pos.y + 0.001), cz: Math.floor(ch.pos.z / S) + dz, dx, dz };
    }
    t.key = [t.type, t.cx, t.cy, t.cz, t.dx, t.dz].join(',');
    for (const p of game.pieces.values()) {
      if (p.key === t.key) return null;
      if (p.type === 'ramp' && p.slot.cx === t.cx && p.slot.cz === t.cz && Math.abs(p.slot.cy - t.cy) < S) return null;  // never stack ramps
    }
    return this.evaluate(game, ch, t, material).ok ? this.place(game, ch, t, material) : null;
  },

  /** The piece the character is standing on (checks under the centre and the box corners). */
  pieceUnder(game, ch) {
    const y = Math.floor(ch.pos.y - 0.05), hw = CONFIG.PLAYER.WIDTH / 2 - 1e-4;
    for (const [ox, oz] of [[0, 0], [hw, hw], [-hw, hw], [hw, -hw], [-hw, -hw]]) {
      const p = this.pieceAtBlock(game, Math.floor(ch.pos.x + ox), y, Math.floor(ch.pos.z + oz));
      if (p) return p;
    }
    return null;
  },

  /** Four walls, a floor and a roof around the player's own cell. */
  boxUp(game, ch) {
    const S = CONFIG.BUILD.CELL, material = ch.build.material;
    const cx = Math.floor(ch.pos.x / S), cy = Math.floor(ch.pos.y + 0.001), cz = Math.floor(ch.pos.z / S);
    const slots = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ type: 'wall', cx, cy, cz, dx, dz }));
    slots.push({ type: 'floor', cx, cy, cz, dx: 1, dz: 0 }, { type: 'roof', cx, cy, cz, dx: 1, dz: 0 });
    let n = 0;
    for (const t of slots) {
      t.key = [t.type, t.cx, t.cy, t.cz, t.dx, t.dz].join(',');
      if (this.place(game, ch, t, material)) n++;
    }
    game.events.emit('boxUp', { by: ch, pieces: n });
    return n;
  },

  // ---------------------------------------------------------------- edit mode
  startEdit(game, ch) {
    const o = ch.eyePos(new THREE.Vector3()), d = ch.lookDir(new THREE.Vector3());
    const t = raycastBlocks(game.world, o, d, CONFIG.REACH);
    let piece = t && this.pieceAtBlock(game, t.x, t.y, t.z);
    if (!piece || piece.type !== 'wall') piece = this.wallOnRay(game, o, d);   // aiming through a door / window
    if (!piece) return false;
    ch.build.edit = { pieceId: piece.id, selected: piece.removedTiles.slice(), hover: -1, wasActive: ch.build.active };
    ch.build.active = true;
    return true;
  },

  /** Where a ray crosses a wall piece's plane: { u, v, dist } in wall-local blocks, or null. */
  wallHit(piece, o, d) {
    const s = piece.slot, S = CONFIG.BUILD.CELL;
    const plane = s.dx ? (s.dx > 0 ? s.cx * S + S : s.cx * S - 1) + 0.5 : (s.dz > 0 ? s.cz * S + S : s.cz * S - 1) + 0.5;
    const oc = s.dx ? o.x : o.z, dc = s.dx ? d.x : d.z;
    if (Math.abs(dc) < 1e-6) return null;
    const tt = (plane - oc) / dc;
    if (tt <= 0) return null;
    const hx = o.x + d.x * tt, hy = o.y + d.y * tt, hz = o.z + d.z * tt;
    const u = Math.floor(s.dx ? hz - s.cz * S : hx - s.cx * S), v = Math.floor(hy - s.cy);
    if (u < 0 || u >= S || v < 0 || v >= S) return null;
    return { u, v, dist: tt };
  },

  /** Nearest wall piece whose plane the ray crosses within reach (sees through cut-out tiles). */
  wallOnRay(game, o, d) {
    let best = null, bestD = CONFIG.REACH + 1;
    for (const p of game.pieces.values()) {
      if (p.type !== 'wall') continue;
      const h = this.wallHit(p, o, d);
      if (h && h.dist < bestD) { best = p; bestD = h.dist; }
    }
    return best;
  },

  /** Tile index (0..3) of a wall-local voxel: u = along the wall, v = height. */
  tileOf(u, v) { return (v >> 1) * 2 + (u >> 1); },

  updateEdit(game, ch, it) {
    const e = ch.build.edit, piece = game.pieces.get(e.pieceId);
    if (!piece) { ch.build.edit = null; return; }
    // aim at the wall plane (works through already-removed tiles)
    const h = this.wallHit(piece, ch.eyePos(new THREE.Vector3()), ch.lookDir(new THREE.Vector3()));
    e.hover = h && h.dist < CONFIG.REACH + 2 ? this.tileOf(h.u, h.v) : -1;
    if (it.firePressed && e.hover >= 0) {
      const i = e.selected.indexOf(e.hover);
      if (i >= 0) e.selected.splice(i, 1); else e.selected.push(e.hover);
    }
  },

  /** Applies the edit: selected tiles are removed, deselected removed tiles come back. */
  confirmEdit(game, ch) {
    const e = ch.build.edit;
    ch.build.edit = null;
    if (e) ch.build.active = e.wasActive;                 // back to whatever you were holding before editing
    const piece = e && game.pieces.get(e.pieceId);
    if (!piece) return;
    const block = CONFIG.BUILD.MATERIALS[piece.material].block;
    if (e.selected.length >= 4) e.selected = e.selected.slice(0, 3);   // a wall keeps at least one tile
    const list = [];
    for (const v of this.voxels(piece.slot)) {
      const tile = this.tileOf(v[3], v[4]);
      const k = this.key(v[0], v[1], v[2]);
      const owned = game.pieceAt.get(k) === piece.id;
      if (e.selected.includes(tile)) {
        if (owned) { game.pieceAt.delete(k); list.push([v[0], v[1], v[2], BLOCK.AIR]); }
      } else if (!owned && piece.removedTiles.includes(tile) && this.freeCell(game, v[0], v[1], v[2]) && !game.pieceAt.has(k)) {
        game.pieceAt.set(k, piece.id); list.push([v[0], v[1], v[2], block]);
      }
    }
    piece.cells = this.voxels(piece.slot).filter((v) => game.pieceAt.get(this.key(v[0], v[1], v[2])) === piece.id);
    // a tile counts as removed while any of its voxels is missing (e.g. someone stood in it during a restore)
    const missing = new Set();
    for (const v of this.voxels(piece.slot)) if (game.pieceAt.get(this.key(v[0], v[1], v[2])) !== piece.id) missing.add(this.tileOf(v[3], v[4]));
    piece.removedTiles = Array.from(missing).sort();
    game.world.setBlocks(list);
    game.events.emit('pieceEdited', { piece, by: ch, removed: piece.removedTiles.slice() });
  },

  snapshot(game) {
    return Array.from(game.pieces.values()).map((p) => ({ id: p.id, type: p.type, material: p.material, hp: p.hp, slot: p.slot, removedTiles: p.removedTiles }));
  },
};
