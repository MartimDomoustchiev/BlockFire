/* ============================================================
 * Dropped items. Blocks show as small spinning textured cubes,
 * other items as upright sprites of their icon. After a short delay
 * a drop slides towards a nearby character with room for it and is
 * collected on contact; identical drops lying together merge.
 * ============================================================ */
class ItemDrop extends Entity {
  constructor(stack, x, y, z, vx = 0, vy = 0, vz = 0) {
    super('drop');
    this.stack = stack;
    this.pos.set(x, y, z);
    this.vel.set(vx, vy, vz);
    this.age = 0;
    this.pickupDelay = CONFIG.ITEM_DROP.PICKUP_DELAY;
    this.onGround = false;
    this.mesh = null;
    this.beam = null;
    this.phase = 0;
    this.persistent = false;          // loot: never despawns
    const it = ITEMS[stack.id];
    this.manual = !!(it && it.kind === 'weapon');   // weapons need E to pick up
  }

  /** Rarity tier used for the glow beam (weapons: their rarity; consumables: item tier) or -1. */
  rarity() {
    const it = ITEMS[this.stack.id];
    if (!it) return -1;
    if (it.kind === 'weapon') return this.stack.data.rarity;
    if (it.kind === 'consumable') return it.rarity;
    return -1;
  }

  /** Spawns a drop at a block centre with a small deterministic pop. */
  static pop(game, stack, x, y, z) {
    const r = game.rng, s = CONFIG.ITEM_DROP.POP_SPEED;
    return game.addEntity(new ItemDrop(stack, x, y, z, r.float(-1, 1), s, r.float(-1, 1)));
  }

  /** Throws a stack out of a character's hands along its look direction. */
  static throwFrom(game, ch, stack) {
    const d = ch.lookDir(new THREE.Vector3()), sp = CONFIG.ITEM_DROP.THROW_SPEED;
    const e = new ItemDrop(stack, ch.pos.x + d.x * 0.4, ch.eyeY - 0.3, ch.pos.z + d.z * 0.4, d.x * sp, d.y * sp + CONFIG.ITEM_DROP.THROW_LIFT, d.z * sp);
    e.pickupDelay = CONFIG.ITEM_DROP.THROW_PICKUP_DELAY;                    // don't immediately re-collect what you threw
    return game.addEntity(e);
  }

  update(dt, game) {
    const C = CONFIG.ITEM_DROP;
    this.age += dt;
    if ((this.age > C.DESPAWN && !this.persistent) || this.stack.count <= 0) { this.removed = true; return; }

    // sleep when nobody is near or the ground isn't loaded: long explores leave lots of loot behind
    const w = game.world, p = this.pos;
    let near = Infinity;
    for (const c of game.characters()) { const d = Math.abs(c.pos.x - p.x) + Math.abs(c.pos.z - p.z); if (d < near) near = d; }
    this.asleep = near > C.SLEEP_RADIUS || w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === -1;
    if (this.asleep) return;

    if (!this.manual && this.age >= this.pickupDelay && this._collect(dt, game)) return;

    // physics: gravity + simple voxel collision on a small box
    const v = this.vel, hs = C.SIZE / 2;
    v.y = Math.max(-C.MAX_FALL, v.y - C.GRAVITY * dt);
    if (w.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) {   // buried (e.g. a block placed on it)
      p.y += 4 * dt; v.set(0, 0, 0);
      return;
    }
    const nx = p.x + v.x * dt;
    if (w.isSolid(Math.floor(nx + Math.sign(v.x) * hs), Math.floor(p.y), Math.floor(p.z))) v.x = 0; else p.x = nx;
    const nz = p.z + v.z * dt;
    if (w.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(nz + Math.sign(v.z) * hs))) v.z = 0; else p.z = nz;
    const ny = p.y + v.y * dt;
    this.onGround = false;
    if (v.y <= 0 && w.isSolid(Math.floor(p.x), Math.floor(ny - hs), Math.floor(p.z))) {
      p.y = Math.floor(ny - hs) + 1 + hs; v.y = 0; this.onGround = true;
    } else if (v.y > 0 && w.isSolid(Math.floor(p.x), Math.floor(ny + hs), Math.floor(p.z))) {
      v.y = 0;
    } else p.y = ny;
    if (this.onGround) { const k = Math.max(0, 1 - C.FRICTION * dt); v.x *= k; v.z *= k; }

    // merge with identical neighbours twice a second
    if ((game.tickCount + this.id) % C.MERGE_INTERVAL === 0) this._merge(game);
  }

  /** Magnet + pickup. Returns true if the drop is being pulled (physics skipped). */
  _collect(dt, game) {
    const C = CONFIG.ITEM_DROP;
    let best = null, bestD = C.MAGNET_RADIUS;
    for (const e of game.characters()) {
      if (!e.alive || !e.inventory || e.npc) continue;            // story NPCs don't pick things up
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.y + C.CHEST_OFFSET - this.pos.y, e.pos.z - this.pos.z);
      if (d < bestD && e.inventory.spaceFor(this.stack) > 0) { best = e; bestD = d; }
    }
    if (!best) return false;
    if (bestD <= C.PICKUP_RADIUS) {
      const before = this.stack.count;
      const left = best.inventory.add(this.stack);
      if (left < before) {
        game.events.emit('pickup', { character: best, item: this.stack.id, count: before - left });
        if (left <= 0) { this.removed = true; return true; }
        this.stack.count = left;
      }
      return false;
    }
    const tx = best.pos.x - this.pos.x, ty = best.pos.y + C.CHEST_OFFSET - this.pos.y, tz = best.pos.z - this.pos.z;
    const k = Math.min(1, C.MAGNET_SPEED * dt / bestD);
    this.pos.x += tx * k; this.pos.y += ty * k; this.pos.z += tz * k;
    this.vel.set(0, 0, 0);
    return true;
  }

  _merge(game) {
    const C = CONFIG.ITEM_DROP, max = maxStackOf(this.stack.id);
    if (this.stack.data || max <= 1) return;
    for (const e of game.dropsNear(this.pos.x, this.pos.z, C.MERGE_RADIUS)) {
      if (e === this || e.removed || !canStack(e.stack, this.stack)) continue;
      if (e.pos.distanceTo(this.pos) > C.MERGE_RADIUS) continue;
      const put = Math.min(e.stack.count, max - this.stack.count);
      if (put <= 0) return;
      this.stack.count += put;
      e.stack.count -= put;
      if (e.stack.count <= 0) e.removed = true;
      this.age = Math.min(this.age, e.age);
    }
  }

  render(frameDt, game) {
    if (this.asleep) { this.dispose(); return; }        // far away: no mesh at all (recreated when woken)
    if (!this.mesh) {
      this.mesh = DropVisuals.make(this.stack.id);
      this.phase = (this.id * 2.399) % (Math.PI * 2);
      game.scene.add(this.mesh);
      const r = this.rarity();
      if (r >= 0) { this.beam = DropVisuals.beam(r); game.scene.add(this.beam); }
    }
    this.phase += frameDt * 1.6;
    const lift = this.manual ? 0.3 : 0.06;
    this.mesh.position.set(this.pos.x, this.pos.y + lift + Math.sin(this.phase * 1.4) * 0.05, this.pos.z);
    if (this.mesh.isMesh) this.mesh.rotation.y = this.phase;
    if (this.beam) this.beam.position.set(this.pos.x, this.pos.y - CONFIG.ITEM_DROP.SIZE / 2, this.pos.z);
  }

  dispose() {
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this.beam && this.beam.parent) this.beam.parent.remove(this.beam);
    this.mesh = this.beam = null;
  }

  serialize() { return Object.assign(super.serialize(), { stack: cloneStack(this.stack), age: this.age }); }
}

/*
 * Shared meshes/materials for drops. Materials are tinted every frame
 * with the scene light so drops darken at night like the terrain.
 */
const DropVisuals = {
  atlas: null,
  cubeMat: null,
  geoms: new Map(),
  spriteMats: new Map(),

  init(atlasTexture) {
    this.atlas = atlasTexture;
    this.cubeMat = new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, alphaTest: 0.5 });
  },

  make(itemId) {
    const it = ITEMS[itemId];
    if (it && it.kind === 'block') return new THREE.Mesh(this._cubeGeom(it.blockId), this.cubeMat);
    let mat = this.spriteMats.get(itemId);
    if (!mat) {
      const tex = new THREE.CanvasTexture(Icons.canvas(itemId));
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 });
      this.spriteMats.set(itemId, mat);
    }
    const sp = new THREE.Sprite(mat);
    const big = it && it.kind === 'weapon' ? 0.85 : 0.42;
    sp.scale.set(big, big, big);
    return sp;
  },

  beamMats: [],
  beamGeom: null,
  /** Vertical additive light beam + ground ring in the rarity colour (cached materials). */
  beam(rarity) {
    if (!this.beamGeom) {
      this.beamGeom = new THREE.CylinderGeometry(0.05, 0.16, 3.2, 8, 1, true);
      this.beamGeom.translate(0, 1.6, 0);
      this.ringGeom = new THREE.RingGeometry(0.22, 0.42, 16);
      this.ringGeom.rotateX(-Math.PI / 2);
      this.ringGeom.translate(0, 0.02, 0);
    }
    let mats = this.beamMats[rarity];
    if (!mats) {
      const col = new THREE.Color(CONFIG.RARITY[rarity].color);
      const opts = { color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
      mats = this.beamMats[rarity] = [new THREE.MeshBasicMaterial(Object.assign({ opacity: 0.26 }, opts)),
        new THREE.MeshBasicMaterial(Object.assign({ opacity: 0.6 }, opts))];
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.beamGeom, mats[0]), new THREE.Mesh(this.ringGeom, mats[1]));
    g.renderOrder = 3;
    return g;
  },

  /** Cube with each face mapped to that block's atlas tile and shaded like the terrain. */
  _cubeGeom(blockId) {
    let g = this.geoms.get(blockId);
    if (g) return g;
    const S = CONFIG.ITEM_DROP.SIZE, N = CONFIG.ATLAS_TILES;
    g = new THREE.BoxGeometry(S, S, S);
    const uv = g.attributes.uv, colors = [];
    const SHADE = [0.78, 0.78, 1.0, 0.5, 0.64, 0.64];
    for (let face = 0; face < 6; face++) {
      const tile = BlockTables.faceTiles[blockId * 6 + face];
      const col = tile % N, row = Math.floor(tile / N);
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        uv.setXY(i, (col + uv.getX(i)) / N, (row + 1 - uv.getY(i)) / N);
        colors.push(SHADE[face], SHADE[face], SHADE[face]);
      }
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.geoms.set(blockId, g);
    return g;
  },

  /** Called once per frame with the current scene light colour. */
  tint(light) {
    if (this.cubeMat) this.cubeMat.color.copy(light);
    for (const m of this.spriteMats.values()) m.color.copy(light);
  },
};
