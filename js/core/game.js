/* ============================================================
 * Game: owns all gameplay state and advances it in fixed 60 Hz
 * ticks. Rendering, HUD, audio and input live outside and only
 * observe (state + events) or feed Intents through controllers.
 * ============================================================ */
const GAME_MODES = {
  // open infinite world: everything from stages 1-5, loot, respawn
  sandbox: { allowFly: true, allowTimeSkip: true, infiniteBlocks: false, respawn: true, loot: true, infiniteAmmo: false, friendlyFire: true, island: false },
  // free build: no enemies, no storm, no loot, endless building materials
  build: { allowFly: true, allowTimeSkip: true, infiniteBlocks: true, respawn: true, loot: false, infiniteAmmo: true, friendlyFire: false, island: false, keepInventory: true },
  // solo vs bots on the island with the storm; no respawn
  battle: { allowFly: false, allowTimeSkip: false, infiniteBlocks: false, respawn: false, loot: true, infiniteAmmo: false, friendlyFire: true, island: true },
  // local split-screen duel on the island (respawn optional)
  duel: { allowFly: false, allowTimeSkip: false, infiniteBlocks: false, respawn: false, loot: true, infiniteAmmo: false, friendlyFire: true, island: true },
  // story: the island's villages and camps, missions, stealth (js/story). No mining or building; climbing,
  // sneaking, hiding and fall damage instead.
  story: { allowFly: false, allowTimeSkip: false, infiniteBlocks: false, respawn: true, loot: false, infiniteAmmo: false, friendlyFire: false, island: true,
    story: true, climb: true, sneak: true, fallDamage: true, noMining: true, noBuilding: true, keepInventory: true, regen: true },
};

class Game {
  constructor({ scene, materials, seed, mode = 'sandbox', renderDistance, replica = false }) {
    this.scene = scene;
    this.seed = seed | 0;
    this.mode = mode;
    this.rules = Object.assign({}, GAME_MODES[mode] || GAME_MODES.sandbox);
    // replica: an online client's copy - only its own player is simulated; the host sends everything else
    this.replica = replica;
    if (replica) this.rules.loot = false;
    this.net = null;                   // NetHost / NetClient when online
    this.events = new EventBus();
    this.rng = new Rng(Math.imul(this.seed, 2654435761) ^ 0x5bd1e995);
    this.islandRadius = this.rules.story ? CONFIG.STORY.ISLAND_RADIUS : this.rules.island ? CONFIG.ISLAND.RADIUS : 0;
    this.world = new World({
      scene, materials, seed: this.seed, renderDistance, events: this.events, loot: this.rules.loot,
      island: this.islandRadius, story: this.rules.story,
      chestChance: this.rules.island ? CONFIG.ISLAND.CHEST_CHANCE : CONFIG.LOOT.CHEST_CHANCE,
    });
    this.rules.floorChance = this.rules.island ? CONFIG.ISLAND.FLOOR_CHANCE : CONFIG.LOOT.FLOOR_CHANCE;
    this.match = null;                 // Match for island modes (match/match.js)
    this.story = null;                 // Story director in story mode (story/story.js)
    this.entities = new Map();
    this.charList = [];                // characters only (hot loops avoid scanning every entity)
    this._dropGrid = null;             // per-tick spatial hash of item drops (see dropsNear)
    this._dropGridTick = -1;
    this._nextId = 1;
    this.time = 0;                     // simulated seconds
    this.tickCount = 0;
    this.timeOfDay = CONFIG.TIME.START;
    this.player = null;                // local human Character (tests / debugging / camera)
    this.paused = false;               // when true the main loop stops ticking (tests drive tick() directly)
    this.spawnPoint = new THREE.Vector3(0.5, 40, 0.5);
    this.lootChunks = new Set();       // chunk keys whose floor loot has been rolled
    this.newChunks = [];               // generated since the last tick (loot is spawned inside tick)
    this.events.on('chunkGenerated', (e) => this.newChunks.push(e));
    Building.init(this);
  }

  nextId() { return this._nextId++; }

  addEntity(e) {
    if (!e.id) e.id = this.nextId();
    this.entities.set(e.id, e);
    if (e.type === 'character') this.charList.push(e);
    e.onAdd(this);
    return e;
  }

  removeEntity(e) {
    this.entities.delete(e.id);
    if (e.type === 'character') { const i = this.charList.indexOf(e); if (i >= 0) this.charList.splice(i, 1); }
    e.removed = true;
    e.dispose();
  }

  /** Advances the simulation by one fixed step. */
  tick(dt = 1 / CONFIG.SIM_HZ) {
    this.time += dt;
    this.tickCount++;
    if (this.replica) {
      for (const e of this.charList) if (e.netPredicted) e.update(dt, this);
      this.timeOfDay = (this.timeOfDay + dt / CONFIG.TIME.DAY_LENGTH) % 1;
      return;
    }
    if (this.newChunks.length) {
      for (const c of this.newChunks) {
        if (this.rules.loot && !this.lootChunks.has(c.key)) { this.lootChunks.add(c.key); Loot.spawnFloorLoot(this, c.cx, c.cz); }
      }
      this.newChunks.length = 0;
    }
    let skip = false;
    for (const e of Array.from(this.entities.values())) {
      if (!e.removed && !e.dormant) e.update(dt, this);           // dormant: story NPCs far from every player
      if (e.type === 'character' && e.intent.skipTime && this.rules.allowTimeSkip) skip = true;
    }
    for (const e of Array.from(this.entities.values())) {
      if (e.removed) this.removeEntity(e);
      else if (e.type === 'character' && !e.alive && e.respawnAt !== null && this.time >= e.respawnAt) {
        e.revive(e.home || this.spawnPoint);
        this.events.emit('respawn', { character: e });
      }
    }
    Building.tick(this, dt);
    if (this.match) this.match.tick(dt);
    if (this.story) this.story.tick(dt);
    if (this.net) {
      // position history for lag-compensated hit checks (last ~0.6 s)
      for (const c of this.charList) {
        const h = c.hist || (c.hist = []);
        h.push({ t: this.time, x: c.pos.x, y: c.pos.y, z: c.pos.z });
        if (h.length > 36) h.shift();
      }
    }
    for (const [key, be] of this.world.blockEntities) {
      if (be.type === 'furnace' && Furnace.tick(be, dt)) this.events.emit('smelted', { key });
    }
    this.timeOfDay = (this.timeOfDay + dt / CONFIG.TIME.DAY_LENGTH + (skip ? CONFIG.TIME.SKIP : 0)) % 1;
  }

  /** Presentation pass, once per drawn frame. */
  render(frameDt) {
    for (const e of this.entities.values()) e.render(frameDt, this);
  }

  /** All characters (live array - don't modify). */
  characters() { return this.charList; }

  /** Item drops within ~r blocks of (x,z), from a spatial hash rebuilt once per tick. */
  dropsNear(x, z, r) {
    if (this._dropGridTick !== this.tickCount) {
      this._dropGridTick = this.tickCount;
      const g = this._dropGrid = new Map();
      for (const e of this.entities.values()) {
        if (e.type !== 'drop' || e.removed || e.asleep) continue;
        const k = Math.floor(e.pos.x / 4) * 100003 + Math.floor(e.pos.z / 4);
        let a = g.get(k); if (!a) g.set(k, a = []); a.push(e);
      }
    }
    const out = [], cx0 = Math.floor((x - r) / 4), cx1 = Math.floor((x + r) / 4), cz0 = Math.floor((z - r) / 4), cz1 = Math.floor((z + r) / 4);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const a = this._dropGrid.get(cx * 100003 + cz);
      if (a) for (const e of a) out.push(e);
    }
    return out;
  }

  /** Plain JSON-able state: the hook for saves / netcode. */
  snapshot() {
    return {
      seed: this.seed, mode: this.mode, time: this.time, tick: this.tickCount, timeOfDay: this.timeOfDay,
      entities: Array.from(this.entities.values()).map((e) => e.serialize()),
      blockEntities: Array.from(this.world.blockEntities.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
      pieces: Building.snapshot(this),
      match: this.match ? { state: this.match.state, storm: this.match.storm && this.match.storm.serialize() } : null,
    };
  }

  dispose() {
    for (const e of this.entities.values()) e.dispose();
    this.entities.clear();
    this.charList.length = 0;
    this.world.dispose();
    this.events.clear();
  }
}
