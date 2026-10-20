/* ============================================================
 * World: owns all chunk data on the main thread, streams chunks in
 * and out around the viewers, applies block edits, and farms
 * generation + meshing out to a pool of Web Workers.
 *
 * Chunk lifecycle:
 *   (absent) -> GENERATING -> READY (data) -> meshed (meshState DONE)
 * A chunk is only meshed once its 4 side neighbours have data, so
 * border faces are culled correctly.
 *
 * Edits: setBlock() changes the data and puts the chunk (plus the
 * neighbours whose border faces / AO it affects) into a dirty set.
 * Dirty chunks re-mesh ahead of streaming work using reserved worker
 * slots; the old mesh stays visible until the new one is uploaded.
 * A chunk edited again while its job is in flight simply stays dirty
 * and re-meshes once more when the job returns, so a stale mesh can
 * never be the last one shown. Modified chunks are stashed when they
 * unload and restored instead of regenerated.
 * ============================================================ */
const ChunkState = { NONE: 0, GENERATING: 1, READY: 2 };
const MeshState = { NONE: 0, DONE: 2 };

class Chunk {
  constructor(cx, cz, key) {
    this.cx = cx; this.cz = cz; this.key = key;
    this.data = null;                  // Uint8Array(16*64*16), index = x + z*16 + y*256
    this.state = ChunkState.NONE;
    this.meshState = MeshState.NONE;   // DONE once any mesh has been applied
    this.meshing = false;              // a mesh job is in flight
    this.meshRequested = false;        // a mesh job has been sent at least once
    this.meshSeq = 0;                  // id of the newest mesh request
    this.appliedSeq = 0;               // id of the mesh currently shown (older results are dropped)
    this.modified = false;             // has player edits -> stash on unload
    this.removed = false;
    this.meshOpaque = null;
    this.meshWater = null;
  }
}

class World {
  constructor({ scene, materials, seed, renderDistance, events, loot, chestChance, island, story }) {
    this.scene = scene;
    this.materials = materials;
    this.seed = seed | 0;
    this.rd = renderDistance;
    this.events = events || null;
    this.chunks = new Map();
    this.stash = new Map();            // key -> data of modified chunks that were unloaded
    this.blockEntities = new Map();    // "x,y,z" -> state object (furnaces, chests...)
    this.dirty = new Set();            // chunks waiting for an edit re-mesh
    this.workers = [];
    this.jobs = new Map();
    this.jobId = 0;
    this.meshQueue = [];               // streamed results, uploaded a few per frame
    this.urgentQueue = [];             // edit results, uploaded immediately
    this.offsets = [];
    this.lastCenters = '';
    this.error = null;
    this.lootEnabled = loot !== false;  // worker places loot chests
    this.chestChance = chestChance !== undefined ? chestChance : CONFIG.LOOT.CHEST_CHANCE;
    this.island = island || 0;           // battle island radius (blocks), 0 = infinite world
    this.story = !!story;                // story mode: the workers also build villages, camps and roads
    this.pinned = new Set();             // chunk keys whose data must stay loaded (the island)
    this.pendingEdits = new Map();       // online client: chunk key -> [[x,y,z,id]] waiting for that chunk
    this.preloadList = [];               // chunk coords still to generate up front
    this._buildOffsets();
    this._startWorkers();
  }

  static key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
  static beKey(x, y, z) { return x + ',' + y + ',' + z; }

  // ---------- workers -------------------------------------------------
  _startWorkers() {
    this.workerURL = WorkerBundle.url();
    const cores = navigator.hardwareConcurrency || 4;
    const n = Math.max(1, Math.min(CONFIG.WORLD.MAX_WORKERS, cores - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(this.workerURL);
      w.pending = 0;
      w.onmessage = (e) => this._onMessage(w, e.data);
      w.onerror = (e) => { this.error = 'Worker error: ' + e.message; console.error(this.error, e); };
      w.postMessage({
        type: 'init', seed: this.seed, ids: BLOCK, tables: BlockTables, sea: CONFIG.SEA_LEVEL,
        cfg: {
          chestChance: this.lootEnabled ? this.chestChance : 0, island: this.island,
          story: this.story ? Object.assign({ towerHeight: CONFIG.STORY.TOWER_HEIGHT }, CONFIG.STORY.SITES) : null,
        },
      });
      this.workers.push(w);
    }
  }

  _limit(priority) { return CONFIG.WORLD.JOBS_PER_WORKER + (priority ? CONFIG.WORLD.PRIORITY_JOBS : 0); }

  _hasCapacity(priority) {
    const lim = this._limit(priority);
    for (const w of this.workers) if (w.pending < lim) return true;
    return false;
  }

  /** Sends a job to the least busy worker; returns false if all are full. */
  _dispatch(msg, cb, priority) {
    const lim = this._limit(priority);
    let best = null;
    for (const w of this.workers) if (w.pending < lim && (!best || w.pending < best.pending)) best = w;
    if (!best) return false;
    const id = ++this.jobId;
    this.jobs.set(id, cb);
    best.pending++;
    best.postMessage(Object.assign({ id }, msg));
    return true;
  }

  _onMessage(w, m) {
    w.pending--;
    const cb = this.jobs.get(m.id);
    this.jobs.delete(m.id);
    if (cb) cb(m);
  }

  requestSpawn(cb) {
    const send = () => { if (!this._dispatch({ type: 'spawn' }, (m) => cb(m.spawn), true)) setTimeout(send, 20); };
    send();
  }

  /** Story mode: the sites and roads the workers planned from the seed (see worker/sites.js). */
  requestPlan(cb) {
    const send = () => { if (!this._dispatch({ type: 'plan' }, (m) => cb(m.plan), true)) setTimeout(send, 20); };
    send();
  }

  // ---------- streaming -----------------------------------------------
  _buildOffsets() {
    const r = this.rd + 1, list = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= r * r) list.push({ dx, dz, d2 });
      }
    }
    list.sort((a, b) => a.d2 - b.d2);
    this.offsets = list;
  }

  setRenderDistance(rd) { this.rd = rd; this._buildOffsets(); this.lastCenters = ''; }

  /**
   * Generates every chunk within `radius` blocks of the origin up front and keeps
   * their data resident (meshes still stream around viewers). Used for the battle
   * island, so bots and physics work anywhere on it.
   */
  preload(radius) {
    const r = Math.ceil(radius / CONFIG.CHUNK_SIZE) + 1, list = [];
    for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
      if ((cx * 16 + 8) ** 2 + (cz * 16 + 8) ** 2 > (radius + 24) ** 2) continue;
      list.push([cx, cz, cx * cx + cz * cz]);
      this.pinned.add(World.key(cx, cz));
    }
    list.sort((a, b) => a[2] - b[2]);
    this.preloadList = list;
  }

  /** 0..1 share of pinned chunks that have data. */
  preloadProgress() {
    if (!this.pinned.size) return 1;
    let n = 0;
    for (const k of this.pinned) { const c = this.chunks.get(k); if (c && c.state === ChunkState.READY) n++; }
    return n / this.pinned.size;
  }

  /**
   * Called every frame. `viewers` is an array of {x, z} world positions
   * (one per split-screen player); chunks stream around all of them.
   * `others` (online host: remote players) only get block data within
   * NET.DATA_RADIUS chunks - enough for the simulation, no meshes.
   */
  update(viewers, others = []) {
    const cs = CONFIG.CHUNK_SIZE;
    const centers = viewers.map((v) => [Math.floor(v.x / cs), Math.floor(v.z / cs)]);
    const dataCenters = others.map((v) => [Math.floor(v.x / cs), Math.floor(v.z / cs)]);
    const meshR2 = this.rd * this.rd;

    // 1. edit re-meshes first (reserved worker slots)
    for (const ch of this.dirty) {
      if (ch.removed || ch.state !== ChunkState.READY) { this.dirty.delete(ch); continue; }
      if (ch.meshing) continue;                         // re-meshed again when its job returns
      if (!ch.meshRequested) { this.dirty.delete(ch); continue; }   // first streaming mesh will read the new data
      if (!this._neighboursReady(ch)) continue;
      if (!this._requestMesh(ch, true)) break;
      this.dirty.delete(ch);
    }

    // 2. mesh streamed chunks that have everything they need (nearest first, interleaving viewers)
    if (this._hasCapacity(false)) {
      outer: for (const o of this.offsets) {
        if (o.d2 > meshR2) break;
        for (const [pcx, pcz] of centers) {
          const ch = this.chunks.get(World.key(pcx + o.dx, pcz + o.dz));
          if (!ch || ch.state !== ChunkState.READY || ch.meshRequested) continue;
          if (!this._neighboursReady(ch)) continue;
          if (!this._requestMesh(ch, false)) break outer;
        }
      }
    }

    // 3. generate (or restore from the stash) missing chunks, nearest first
    const dataR = typeof NET !== 'undefined' ? NET.DATA_RADIUS : 0, dataR2 = dataR * dataR;
    outer2: for (const o of this.offsets) {
      for (const [pcx, pcz] of centers) if (!this._ensure(pcx + o.dx, pcz + o.dz)) break outer2;
      if (o.d2 <= dataR2) for (const [pcx, pcz] of dataCenters) if (!this._ensure(pcx + o.dx, pcz + o.dz)) break outer2;
    }

    // 3b. pre-generate pinned (island) chunks with whatever capacity is left
    while (this.preloadList.length && this._hasCapacity(false)) {
      const [cx, cz] = this.preloadList.shift(), key = World.key(cx, cz);
      if (this.chunks.has(key)) continue;
      const ch = new Chunk(cx, cz, key);
      ch.state = ChunkState.GENERATING;
      this.chunks.set(key, ch);
      this._dispatch({ type: 'gen', cx, cz }, (m) => {
        if (ch.removed) return;
        ch.data = m.data;
        ch.state = ChunkState.READY;
        this._applyPending(ch);
        if (this.events) this.events.emit('chunkGenerated', { cx, cz, key });
      }, false);
    }

    // 4. upload finished meshes: all edit results, a few streamed ones
    while (this.urgentQueue.length) {
      const { ch, res } = this.urgentQueue.shift();
      if (!ch.removed) this._applyMesh(ch, res);
    }
    for (let n = 0; n < CONFIG.WORLD.MESH_APPLY_PER_FRAME && this.meshQueue.length; n++) {
      const { ch, res } = this.meshQueue.shift();
      if (!ch.removed) this._applyMesh(ch, res);
    }

    // 5. unload chunks far from every viewer (only when a viewer changed chunk)
    const sig = centers.concat(dataCenters).map((c) => c.join(',')).join('|');
    if (sig !== this.lastCenters) {
      this.lastCenters = sig;
      const lim = this.rd + 1 + CONFIG.WORLD.UNLOAD_MARGIN, lim2 = lim * lim;
      const dlim = dataR + 1 + CONFIG.WORLD.UNLOAD_MARGIN, dlim2 = dlim * dlim;
      const near = (ch, list, l2) => {
        for (const [pcx, pcz] of list) {
          const dx = ch.cx - pcx, dz = ch.cz - pcz;
          if (dx * dx + dz * dz <= l2) return true;
        }
        return false;
      };
      for (const ch of this.chunks.values()) {
        if (!near(ch, centers, lim2) && !near(ch, dataCenters, dlim2)) this._unload(ch);
      }
    }
  }

  /** Makes sure chunk (cx, cz) exists: restores it from the stash or starts generating it. False when the workers are busy. */
  _ensure(cx, cz) {
    const key = World.key(cx, cz);
    if (this.chunks.has(key)) return true;
    const ch = new Chunk(cx, cz, key);
    const saved = this.stash.get(key);
    if (saved) {
      this.stash.delete(key);
      ch.data = saved; ch.modified = true; ch.state = ChunkState.READY;
      this._applyPending(ch);
      this.chunks.set(key, ch);
      return true;
    }
    if (!this._hasCapacity(false)) return false;
    ch.state = ChunkState.GENERATING;
    this.chunks.set(key, ch);
    this._dispatch({ type: 'gen', cx, cz }, (m) => {
      if (ch.removed) return;
      ch.data = m.data;
      ch.state = ChunkState.READY;
      this._applyPending(ch);
      if (this.events) this.events.emit('chunkGenerated', { cx, cz, key });
    }, false);
    return true;
  }

  _neighboursReady(ch) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.chunks.get(World.key(ch.cx + dx, ch.cz + dz));
      if (!n || n.state !== ChunkState.READY) return false;
    }
    return true;
  }

  _requestMesh(ch, priority) {
    const blocks = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(World.key(ch.cx + dx, ch.cz + dz));
        blocks.push(n && n.state === ChunkState.READY ? n.data : null);
      }
    }
    const seq = ch.meshSeq + 1;
    const ok = this._dispatch({ type: 'mesh', blocks }, (res) => {
      ch.meshing = false;
      if (ch.removed) return;
      res.seq = seq;
      (priority ? this.urgentQueue : this.meshQueue).push({ ch, res });
    }, priority);
    if (ok) { ch.meshing = true; ch.meshRequested = true; ch.meshSeq = seq; }
    return ok;
  }

  _applyMesh(ch, res) {
    if (res.seq < ch.appliedSeq) return;      // a newer mesh is already showing
    ch.appliedSeq = res.seq;
    this._disposeMeshes(ch);
    ch.meshOpaque = this._makeMesh(ch, res.opaque, this.materials.opaque, 0);
    ch.meshWater = this._makeMesh(ch, res.water, this.materials.water, 1);
    ch.meshState = MeshState.DONE;
  }

  _makeMesh(ch, m, material, renderOrder) {
    if (!m.index.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setAttribute('tile', new THREE.BufferAttribute(m.tile, 1));
    g.setAttribute('shade', new THREE.BufferAttribute(m.shade, 1));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    // Chunk-local bounds so three.js can frustum-cull without scanning vertices.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 32, 8), 36);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(ch.cx * CONFIG.CHUNK_SIZE, 0, ch.cz * CONFIG.CHUNK_SIZE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);
    return mesh;
  }

  _disposeMeshes(ch) {
    for (const k of ['meshOpaque', 'meshWater']) {
      if (ch[k]) { this.scene.remove(ch[k]); ch[k].geometry.dispose(); ch[k] = null; }
    }
  }

  _unload(ch) {
    if (this.pinned.has(ch.key)) {
      // island chunk: drop only the meshes, keep the data
      if (ch.meshOpaque || ch.meshWater || ch.meshRequested) {
        this._disposeMeshes(ch);
        ch.meshState = MeshState.NONE;
        ch.meshRequested = false;
      }
      return;
    }
    ch.removed = true;
    if (ch.modified && ch.data) this.stash.set(ch.key, ch.data);
    this._disposeMeshes(ch);
    this.dirty.delete(ch);
    this.chunks.delete(ch.key);
  }

  dispose() {
    for (const ch of this.chunks.values()) { ch.removed = true; this._disposeMeshes(ch); }
    this.chunks.clear();
    this.stash.clear();
    this.dirty.clear();
    this.blockEntities.clear();
    this.meshQueue.length = this.urgentQueue.length = 0;
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.jobs.clear();
    URL.revokeObjectURL(this.workerURL);
  }

  // ---------- editing --------------------------------------------------
  /** Sets one block. Returns false if the chunk isn't loaded or y is out of range. */
  setBlock(x, y, z, id) {
    if (y < 0 || y >= CONFIG.CHUNK_HEIGHT) return false;
    const ch = this.chunks.get(World.key(x >> 4, z >> 4));
    if (!ch || ch.state !== ChunkState.READY) return false;
    const i = (x & 15) + (z & 15) * 16 + y * 256;
    const old = ch.data[i];
    if (old === id) return true;
    ch.data[i] = id;
    ch.modified = true;
    this._markEditDirty(ch, x & 15, z & 15);
    if (this.events) this.events.emit('blockChanged', { x, y, z, old, id });
    return true;
  }

  /** Applies a host's block edit now, or as soon as its chunk exists (online clients). */
  applyNetEdit(x, y, z, id) {
    if (this.setBlock(x, y, z, id)) return;
    const key = World.key(x >> 4, z >> 4);
    let list = this.pendingEdits.get(key);
    if (!list) this.pendingEdits.set(key, list = []);
    list.push([x, y, z, id]);
  }

  _applyPending(ch) {
    const list = this.pendingEdits.get(ch.key);
    if (!list) return;
    this.pendingEdits.delete(ch.key);
    for (const [x, y, z, id] of list) ch.data[(x & 15) + (z & 15) * 16 + y * 256] = id;
    ch.modified = true;
  }

  /** Batch edit: [[x,y,z,id], ...]. Each affected chunk re-meshes once. Returns count applied. */
  setBlocks(list) {
    let n = 0;
    for (const e of list) if (this.setBlock(e[0], e[1], e[2], e[3])) n++;
    return n;
  }

  _markEditDirty(ch, lx, lz) {
    this.dirty.add(ch);
    // Border faces and AO of the neighbours read this block too.
    const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (dx) this._markDirtyAt(ch.cx + dx, ch.cz);
    if (dz) this._markDirtyAt(ch.cx, ch.cz + dz);
    if (dx && dz) this._markDirtyAt(ch.cx + dx, ch.cz + dz);
  }

  _markDirtyAt(cx, cz) {
    const n = this.chunks.get(World.key(cx, cz));
    if (n && n.state === ChunkState.READY) this.dirty.add(n);
  }

  getBlockEntity(x, y, z) { return this.blockEntities.get(World.beKey(x, y, z)) || null; }
  setBlockEntity(x, y, z, be) {
    const k = World.beKey(x, y, z);
    if (be) this.blockEntities.set(k, be); else this.blockEntities.delete(k);
  }

  // ---------- queries --------------------------------------------------
  /** Block id at world coords. -1 = chunk not loaded, bedrock below the world, air above it. */
  getBlock(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= CONFIG.CHUNK_HEIGHT) return BLOCK.AIR;
    const ch = this.chunks.get(World.key(x >> 4, z >> 4));
    if (!ch || !ch.data) return -1;
    return ch.data[(x & 15) + (z & 15) * 16 + y * 256];
  }

  /** Solid for collision. Unloaded terrain counts as solid so nothing falls into the void. */
  isSolid(x, y, z) {
    const b = this.getBlock(x, y, z);
    return b === -1 || BlockTables.solid[b] === 1;
  }

  isWater(x, y, z) { return this.getBlock(x, y, z) === BLOCK.WATER; }

  /** True when every chunk within `r` chunks of (cx,cz) has been meshed. */
  isAreaMeshed(cx, cz, r) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ch = this.chunks.get(World.key(cx + dx, cz + dz));
        if (!ch || ch.meshState !== MeshState.DONE) return false;
      }
    }
    return true;
  }

  stats() {
    let meshed = 0;
    for (const ch of this.chunks.values()) if (ch.meshState === MeshState.DONE) meshed++;
    return { loaded: this.chunks.size, meshed, queued: this.meshQueue.length, dirty: this.dirty.size, stashed: this.stash.size };
  }
}
