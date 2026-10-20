/* ============================================================
 * BLOCKFIRE - tweakable constants
 * Everything gameplay-related that you may want to balance lives
 * here. Later stages (weapons, storm, build costs...) add their
 * own sections to this file.
 * ============================================================ */
const CONFIG = {
  // --- Simulation -----------------------------------------------------
  SIM_HZ: 60,                  // fixed simulation ticks per second
  MAX_CATCHUP_TICKS: 5,        // most ticks run per rendered frame (slower frames drop time)

  // --- World geometry -------------------------------------------------
  CHUNK_SIZE: 16,        // x/z size of a chunk
  CHUNK_HEIGHT: 64,      // y size of a chunk (world height)
  SEA_LEVEL: 20,

  // --- Texture atlas --------------------------------------------------
  ATLAS_TILES: 8,        // atlas is 8x8 tiles
  TILE_PX: 16,           // each tile is 16x16 pixels

  // --- Streaming ------------------------------------------------------
  RENDER_DISTANCE: { DEFAULT: 8, MIN: 3, MAX: 16 },   // in chunks
  WORLD: {
    MAX_WORKERS: 4,
    JOBS_PER_WORKER: 2,        // streaming jobs queued per worker at once
    PRIORITY_JOBS: 2,          // extra per-worker slots only edit re-meshes may use
    UNLOAD_MARGIN: 2,          // chunks beyond renderDistance+1 before unload
    MESH_APPLY_PER_FRAME: 3,   // streamed geometry uploads per frame (edits are always applied at once)
  },

  // --- Camera / input defaults ---------------------------------------
  FOV: 75,
  SENSITIVITY: 1.0,            // multiplier on MOUSE_RAD_PER_PX
  MOUSE_RAD_PER_PX: 0.0022,
  // over-the-shoulder camera (P): behind and right of the eyes; the view aims at whatever the eyes aim at
  THIRD_PERSON: { DIST: 2.8, SIDE: 0.8, UP: 0.32, MIN_AIM: 3.5, AIM_RANGE: 90, NEAR_HIDE: 0.75 },

  // --- Player ----------------------------------------------------------
  PLAYER: {
    WIDTH: 0.6,
    HEIGHT: 1.8,
    EYE: 1.62,
    WALK_SPEED: 4.4,           // blocks / second
    SPRINT_SPEED: 6.8,
    SWIM_SPEED: 2.6,
    FLY_SPEED: 11,
    FLY_FAST_SPEED: 32,
    FLY_ACCEL: 60,
    JUMP_VELOCITY: 8.2,        // ~1.3 blocks of jump height
    GRAVITY: 26,
    TERMINAL_VELOCITY: 55,
    GROUND_ACCEL: 55,
    AIR_ACCEL: 14,
    WATER_ACCEL: 20,
    WATER_GRAVITY: 7,
    WATER_SWIM_UP: 3.6,
    WATER_SINK_MAX: 3.5,
    STEP_HEIGHT: 1.0,          // auto step-up onto ledges this high while walking (makes voxel ramps walkable)
    STEP_EASE: 14,             // camera catch-up rate after a step (1/s, exponential)
  },

  // --- Block interaction ------------------------------------------------
  REACH: 5,                    // blocks; max distance to target / mine / place
  PLACE_REPEAT: 0.22,          // seconds between placements while holding the place button
  MINING: {
    HARVEST_MULT: 1.5,         // break time = hardness * this  (when the block can be harvested)
    NO_HARVEST_MULT: 5,        // ... * this when the block needs a tool you don't have (and drops nothing)
    BREAK_COOLDOWN: 0.15,      // pause after a break before the next block starts
    MIN_TIME: 0.05,            // anything breakable takes at least this long
    LEAF_STICK_CHANCE: 0.12,   // leaves drop a stick this often
  },

  // Tool tiers. level = harvest level (see BLOCK_DEFS[].tier), speed = break-speed multiplier.
  TOOL_TIERS: {
    wood:  { level: 1, speed: 2,  durability: 59 },
    stone: { level: 2, speed: 4,  durability: 131 },
    iron:  { level: 3, speed: 6,  durability: 250 },
    gold:  { level: 1, speed: 12, durability: 32 },
  },

  // --- Inventory / items -------------------------------------------------
  INVENTORY_SLOTS: 36,         // 0-8 are the hotbar
  HOTBAR_SLOTS: 9,
  MAX_WEAPONS: 5,              // weapons a character may carry at once
  ITEM_DROP: {
    SIZE: 0.25,
    GRAVITY: 22,
    PICKUP_DELAY: 0.6,         // seconds before a fresh drop can be collected
    PICKUP_RADIUS: 1.35,       // from the character's chest
    MAGNET_RADIUS: 2.8,        // drops inside this slide towards the character
    MAGNET_SPEED: 9,
    MERGE_RADIUS: 1.0,
    DESPAWN: 300,              // seconds
    POP_SPEED: 3.2,            // initial upward speed when a block pops its drop
    THROW_SPEED: 6,            // speed of items thrown out of the inventory
    SLEEP_RADIUS: 56,          // drops farther than this from every character sleep (no physics, no mesh)
    THROW_LIFT: 2,             // extra upward speed of thrown items
    THROW_PICKUP_DELAY: 1.5,   // thrown items can't be re-collected for this long
    FRICTION: 8,               // ground friction (1/s)
    MAX_FALL: 40,
    CHEST_OFFSET: 0.9,         // height of the pickup point above a character's feet
    MERGE_INTERVAL: 30,        // ticks between merge checks
  },

  // --- Crafting / smelting -----------------------------------------------
  CRAFT_YIELD: {
    planks: 4, stick: 4, brick: 4,
    build_wood: 3, build_stone: 3, build_metal: 4,
    ammo_light: 24, ammo_medium: 24, ammo_shells: 10, ammo_heavy: 8, ammo_rockets: 2,
  },
  FURNACE: {
    COOK_TIME: 4,              // seconds per smelted item
    COOL_RATE: 2,              // cook progress lost per second while unfuelled
    FUEL: {                    // burn seconds per item
      log: 12, planks: 6, stick: 2, crafting_table: 6, build_wood: 4,
      wood_pickaxe: 4, wood_axe: 4, wood_shovel: 4,
    },
  },

  // --- Health / damage ----------------------------------------------------
  HEALTH: {
    MAX: 100,
    SHIELD_MAX: 100,
    START_SHIELD: 0,           // shield only comes from consumables
    RESPAWN_TIME: 4,           // seconds (modes with respawn)
  },
  HITBOX: {                    // relative to the feet; widths are half-extents
    HEAD_BOTTOM: 1.42, HEAD_TOP: 1.86, HEAD_HALF: 0.24,
    BODY_TOP: 1.42, BODY_HALF: 0.32,
  },
  CONSUMABLES: {
    bandage:       { name: 'Bandage Roll', health: 15, maxHealth: 75, time: 3.5, maxStack: 15, rarity: 1 },
    medkit:        { name: 'Field Medkit', health: 100, maxHealth: 100, time: 8, maxStack: 3, rarity: 1 },
    shield_potion: { name: 'Shield Tonic', shield: 50, maxShield: 100, time: 4, maxStack: 3, rarity: 2 },
  },

  // --- Weapons ------------------------------------------------------------
  // Rarity multipliers: higher tier = more damage, faster fire, tighter spread, bigger magazine, faster reload.
  RARITY: [
    { id: 'common',    name: 'Common',    color: '#a3a8b0', damage: 1.00, fireRate: 1.00, spread: 1.00, mag: 1.00, reload: 1.00 },
    { id: 'uncommon',  name: 'Uncommon',  color: '#3fcf4a', damage: 1.08, fireRate: 1.04, spread: 0.92, mag: 1.10, reload: 0.95 },
    { id: 'rare',      name: 'Rare',      color: '#3a8dff', damage: 1.16, fireRate: 1.08, spread: 0.84, mag: 1.20, reload: 0.90 },
    { id: 'epic',      name: 'Epic',      color: '#b04dff', damage: 1.25, fireRate: 1.12, spread: 0.76, mag: 1.30, reload: 0.85 },
    { id: 'legendary', name: 'Legendary', color: '#ffb22e', damage: 1.35, fireRate: 1.16, spread: 0.68, mag: 1.40, reload: 0.80 },
  ],
  /*
   * Weapon classes. Angles are radians (half-angle of the spread cone).
   *   damage      per bullet / pellet (rockets: splash damage at the centre)
   *   fireRate    shots per second;  auto = hold to fire
   *   spread      hip-fire base spread; moveSpread/airSpread added when moving / airborne
   *   bloom       spread added per shot (up to bloomMax), recovers at bloomRecover per second
   *   adsSpread   multiplier while aiming down sights;  adsZoom = FOV zoom while aiming
   *   falloff     [start, end, minFactor] damage multiplier by distance (hitscan only)
   *   projectile  { speed, gravity } -> simulated bullet instead of hitscan
   *   recoil      upward view kick per shot (radians)
   */
  WEAPONS: {
    ar: {
      name: 'Assault Rifle', ammo: 'ammo_medium', auto: true, damage: 30, headMult: 1.5, fireRate: 5.5, mag: 30, reload: 2.3,
      spread: 0.014, moveSpread: 0.03, airSpread: 0.06, bloom: 0.006, bloomMax: 0.05, bloomRecover: 0.14,
      adsSpread: 0.35, adsZoom: 1.45, range: 260, falloff: [50, 150, 0.65], recoil: 0.011, pellets: 1, pelletSpread: 0,
    },
    smg: {
      name: 'SMG', ammo: 'ammo_light', auto: true, damage: 17, headMult: 1.75, fireRate: 11, mag: 30, reload: 2.0,
      spread: 0.026, moveSpread: 0.02, airSpread: 0.05, bloom: 0.004, bloomMax: 0.045, bloomRecover: 0.2,
      adsSpread: 0.6, adsZoom: 1.25, range: 130, falloff: [18, 60, 0.55], recoil: 0.006, pellets: 1, pelletSpread: 0,
    },
    pistol: {
      name: 'Pistol', ammo: 'ammo_light', auto: false, damage: 24, headMult: 2.0, fireRate: 6.5, mag: 16, reload: 1.4,
      spread: 0.014, moveSpread: 0.02, airSpread: 0.05, bloom: 0.01, bloomMax: 0.05, bloomRecover: 0.2,
      adsSpread: 0.4, adsZoom: 1.25, range: 160, falloff: [25, 80, 0.6], recoil: 0.018, pellets: 1, pelletSpread: 0,
    },
    shotgun: {
      name: 'Pump Shotgun', ammo: 'ammo_shells', auto: false, damage: 9, headMult: 2.0, fireRate: 1.0, mag: 5, reload: 4.4,
      spread: 0.0, moveSpread: 0.0, airSpread: 0.01, bloom: 0, bloomMax: 0, bloomRecover: 1,
      adsSpread: 0.8, adsZoom: 1.15, range: 45, falloff: [7, 22, 0.35], recoil: 0.05, pellets: 10, pelletSpread: 0.075,
    },
    sniper: {
      name: 'Sniper Rifle', ammo: 'ammo_heavy', auto: false, damage: 105, headMult: 2.5, fireRate: 0.33, mag: 1, reload: 2.6,
      spread: 0.08, moveSpread: 0.04, airSpread: 0.1, bloom: 0, bloomMax: 0, bloomRecover: 1,
      adsSpread: 0.0, adsZoom: 4.5, scope: true, range: 600, recoil: 0.06, pellets: 1, pelletSpread: 0,
      projectile: { speed: 300, gravity: 14 },
    },
    rocket: {
      name: 'Rocket Launcher', ammo: 'ammo_rockets', auto: false, damage: 110, headMult: 1.0, fireRate: 0.75, mag: 1, reload: 3.0,
      spread: 0.01, moveSpread: 0.01, airSpread: 0.02, bloom: 0, bloomMax: 0, bloomRecover: 1,
      adsSpread: 0.5, adsZoom: 1.3, range: 400, recoil: 0.08, pellets: 1, pelletSpread: 0,
      projectile: { speed: 52, gravity: 0 }, splash: 4.2, blockRadius: 2.7,
    },
    // --- story mode gear (not in the loot tables) ---
    // the Order's hunting bow: hold to draw (DRAW seconds to full), release to loose. A quick tug (under
    // MIN of a full draw) puts the arrow back. Speed and damage grow with the draw; one arrow nocked at a time.
    bow: {
      name: 'Hunting Bow', ammo: 'arrow', auto: false, damage: 100, headMult: 1.5, fireRate: 2, mag: 1, reload: 0.35,
      spread: 0.003, moveSpread: 0.012, airSpread: 0.03, bloom: 0, bloomMax: 0, bloomRecover: 1,
      adsSpread: 0.4, adsZoom: 1.35, range: 140, recoil: 0.012, pellets: 1, pelletSpread: 0,
      projectile: { speed: 64, gravity: 9 }, silent: true, bow: { draw: 0.7, min: 0.22, speedMin: 0.45, damageMin: 0.3 },
      arrow: true,
    },
    smoke: {
      name: 'Smoke Bomb', ammo: 'smoke_bomb', auto: false, damage: 0, headMult: 1, fireRate: 1, mag: 1, reload: 0.3,
      spread: 0.01, moveSpread: 0.01, airSpread: 0.02, bloom: 0, bloomMax: 0, bloomRecover: 1,
      adsSpread: 1, adsZoom: 1, range: 40, recoil: 0, pellets: 1, pelletSpread: 0,
      projectile: { speed: 20, gravity: 16 }, silent: true, thrown: true, smoke: 5.5,
    },
    // the enforcers' marksmen
    musket: {
      name: 'Musket', ammo: 'ammo_heavy', auto: false, damage: 28, headMult: 1.5, fireRate: 0.4, mag: 1, reload: 3.2,
      spread: 0.02, moveSpread: 0.03, airSpread: 0.06, bloom: 0, bloomMax: 0, bloomRecover: 1,
      adsSpread: 0.5, adsZoom: 1.6, range: 160, recoil: 0.05, pellets: 1, pelletSpread: 0,
      projectile: { speed: 150, gravity: 9 },
    },
  },
  COMBAT: {
    ADS_SPEED: 7,              // 1/s, aim-down-sights blend speed
    RECOIL_RECOVER: 7,         // 1/s, view kick recovery
    SEMI_BUFFER: 0.22,         // a semi-auto click this early before the gun is ready still fires
    EXPLOSION_KNOCKBACK: 13,
    PROJECTILE_LIFETIME: 6,
  },

  // --- Loot ---------------------------------------------------------------
  LOOT: {
    CHEST_CHANCE: 0.22,        // chance a generated chunk contains a chest
    FLOOR_CHANCE: 0.3,         // chance a generated chunk gets a floor-loot spawn
    RARITY_WEIGHTS: {          // common .. legendary
      floor: [46, 31, 15, 6, 2],
      chest: [18, 34, 28, 15, 5],
    },
    WEAPON_WEIGHTS: { ar: 26, smg: 20, pistol: 18, shotgun: 20, sniper: 8, rocket: 6 },
    AMMO_WITH_WEAPON: { ammo_medium: 60, ammo_light: 72, ammo_shells: 12, ammo_heavy: 8, ammo_rockets: 4 },
    FLOOR_KIND_WEIGHTS: { weapon: 40, consumable: 25, ammo: 25, material: 10 },
    CONSUMABLE_WEIGHTS: { bandage: 50, medkit: 15, shield_potion: 35 },
    MATERIALS: [['planks', 20], ['stone', 20], ['iron_ingot', 4]],
    PICKUP_RANGE: 2.4,         // E picks up weapons within this many blocks
  },
  DUMMY: { STRAFE_SPEED: 0.7, RESPAWN: 3 },

  // --- Vehicles -------------------------------------------------------------
  /*
   * Arcade driving. Speeds in blocks/s, accelerations in blocks/s^2.
   *   grip       how fast sideways sliding dies out (1/s); driftGrip while the handbrake is held
   *   steer      max turn rate (rad/s) once moving
   *   step       ledge height the wheels climb without stopping (build ramps are 1-block steps)
   *   size       [length, width, height] of the collision box
   *   seats      [x, y, z] feet offsets of seated characters (x right, z forward); seat 0 is the driver
   */
  VEHICLES: {
    car: {
      name: 'Runabout', seats: [[-0.45, -0.15, 0.2], [0.45, -0.15, 0.2], [-0.45, -0.15, -0.85], [0.45, -0.15, -0.85]],
      maxSpeed: 22, accel: 13, brake: 30, reverse: 8, coast: 4, steer: 1.9, grip: 7, driftGrip: 1.2, boost: 1.45,
      hp: 600, fuel: 100, fuelRate: 0.8, step: 1.25, size: [3.6, 1.9, 1.6], color: 0x2f7fd8, water: false,
    },
    sports: {
      name: 'Streak GT', seats: [[-0.42, -0.35, -0.1], [0.42, -0.35, -0.1]],
      maxSpeed: 32, accel: 20, brake: 34, reverse: 9, coast: 4, steer: 2.15, grip: 8.5, driftGrip: 1.4, boost: 1.4,
      hp: 450, fuel: 80, fuelRate: 1.0, step: 1.15, size: [3.8, 1.8, 1.25], color: 0xe23b2f, water: false,
    },
    truck: {
      name: 'Rockhopper 4x4', seats: [[-0.5, 0.2, 0.5], [0.5, 0.2, 0.5], [-0.5, 0.45, -1.1], [0.5, 0.45, -1.1]],
      maxSpeed: 18, accel: 11, brake: 28, reverse: 7, coast: 3, steer: 1.6, grip: 10, driftGrip: 2, boost: 1.35,
      hp: 1000, fuel: 120, fuelRate: 0.9, step: 1.6, size: [4.4, 2.2, 2.0], color: 0x6f7f3a, water: false,
    },
    boat: {
      name: 'Skiff', seats: [[0, 0.0, -0.9], [-0.45, 0.0, 0.3], [0.45, 0.0, 0.3], [0, 0.0, 1.1]],
      maxSpeed: 20, accel: 11, brake: 18, reverse: 6, coast: 2.5, steer: 1.5, grip: 2.5, driftGrip: 0.8, boost: 1.4,
      hp: 500, fuel: 90, fuelRate: 0.8, step: 0.6, size: [4.0, 2.0, 1.1], color: 0xf2f2ee, water: true,
    },
  },
  VEHICLE: {
    GRAVITY: 24,
    ENTER_RANGE: 3.2,
    WEAK_BLOCKS: [6, 7, 18],   // leaves, glass, cactus: smashed when driven into
    CRASH_SPEED: 9,            // impacts faster than this hurt the vehicle
    CRASH_DAMAGE: 9,           // HP per block/s above CRASH_SPEED
    LAND_SPEED: 16,            // landing faster than this (vertical) hurts
    MAX_LAUNCH: 9,             // vertical speed cap when flying off a ramp top (~1.7 blocks of air)
    RAM_DAMAGE: 2.2,           // to characters hit, per block/s
    RAM_MIN_SPEED: 6,
    PIECE_RAM: 8,              // damage to build pieces per block/s of impact
    WATER_SPEED: 0.25,         // land vehicles in deep water crawl at this fraction
    LAND_SPEED_BOAT: 2,        // boats on land
    EXPLOSION: { damage: 70, splash: 5, blockRadius: 1.5 },
    REFUEL_RANGE: 4,
    REFUEL_RATE: 14,           // fuel / s near a fuel barrel
    BARREL_HP: 60,
    BARREL_EXPLOSION: { damage: 55, splash: 4, blockRadius: 1.2 },
    CAMERA: { DIST: 7.5, HEIGHT: 2.6 },
  },

  // --- Fast building --------------------------------------------------------
  BUILD: {
    CELL: 4,                   // grid cell size in blocks (pieces are 4x4)
    MATERIALS: {               // item spent per piece, HP when finished, seconds to reach full HP
      wood:  { item: 'planks',     cost: 5, hp: 150, buildTime: 1.5, block: 12 },
      stone: { item: 'stone',      cost: 5, hp: 300, buildTime: 3.0, block: 13 },
      metal: { item: 'iron_ingot', cost: 2, hp: 450, buildTime: 5.0, block: 14 },
    },
    START_HP_FRACTION: 0.15,   // a fresh piece starts this fraction of its HP and grows to full
    REPEAT: 0.09,              // seconds between placements while holding fire (build spam)
    MIN_FILL: 0.4,             // a piece needs this fraction of its voxels to be free to be placed
    PICKAXE_DAMAGE: 50,        // damage per swing on a piece with a tool / bare hands
    SWING_TIME: 0.45,
    EXPLOSION_DESTROY_FRACTION: 0.4,  // a piece that loses this share of its voxels collapses
  },

  // --- Battle island / match ------------------------------------------------
  ISLAND: {
    RADIUS: 150,               // blocks; terrain sinks into the ocean beyond this
    CHEST_CHANCE: 0.55,        // chests per chunk on the island (denser than sandbox)
    FLOOR_CHANCE: 0.6,
    DROP_HEIGHT: 60,           // players start this high and glide down
    MIN_SPAWN_SPACING: 28,
    VEHICLES: { car: 3, sports: 1, truck: 2, boat: 2 },
    BARRELS: 5,
  },
  MATCH: {
    START_KIT: [['wood_pickaxe', 1], ['planks', 20]],
    END_DELAY: 3,              // seconds between the last kill and the results screen
    RESPAWN_TIME_LIMIT: 600,   // respawn duels end after this many seconds (most kills wins)
  },
  GLIDE: { FALL_SPEED: 5, SPEED: 10, ACCEL: 18 },
  // Storm: each phase waits, then shrinks the safe circle to radiusFrac of the island over `shrink` seconds.
  // Damage per second outside the circle goes straight to health (shields don't help).
  STORM: {
    PHASES: [
      { wait: 45, shrink: 35, radiusFrac: 0.62, dps: 1 },
      { wait: 35, shrink: 30, radiusFrac: 0.38, dps: 2 },
      { wait: 30, shrink: 25, radiusFrac: 0.2, dps: 4 },
      { wait: 25, shrink: 20, radiusFrac: 0.08, dps: 7 },
      { wait: 20, shrink: 25, radiusFrac: 0.0, dps: 10 },
    ],
    START_RADIUS_FRAC: 1.15,   // first circle covers the whole island
  },

  // --- Bots ---------------------------------------------------------------
  BOTS: {
    DIFFICULTY: {
      easy:   { reaction: 0.85, aimError: 0.09, turnRate: 3.2, view: 45, buildChance: 0.08, healAt: 35, headshot: 0.0, strafe: 0.4 },
      normal: { reaction: 0.45, aimError: 0.05, turnRate: 5.5, view: 70, buildChance: 0.3, healAt: 45, headshot: 0.15, strafe: 0.8 },
      hard:   { reaction: 0.22, aimError: 0.025, turnRate: 9, view: 95, buildChance: 0.65, healAt: 55, headshot: 0.35, strafe: 1.0 },
    },
    THINK_INTERVAL: 0.2,       // seconds between decisions
    LOS_INTERVAL: 0.25,
    LOOT_RADIUS: 28,
    STUCK_TIME: 1.2,
    NAMES_A: ['Rusty', 'Neon', 'Quiet', 'Lucky', 'Brisk', 'Pixel', 'Copper', 'Turbo', 'Frosty', 'Mossy', 'Solar', 'Grumpy'],
    NAMES_B: ['Badger', 'Comet', 'Crate', 'Falcon', 'Gecko', 'Hammer', 'Lantern', 'Otter', 'Pickle', 'Rocket', 'Sprout', 'Yeti'],
  },

  // --- Story mode -----------------------------------------------------------
  STORY: {
    SEED: 'kestrel-isle',      // the story always plays on the same island (any seed works, though)
    ISLAND_RADIUS: 190,
    // per site kind: flattened radius, blend ring around it, highest ground level allowed (towers must fit under 64)
    SITES: {
      keep:    { flat: 27, blend: 12, maxH: 34 },
      village: { flat: 23, blend: 12, maxH: 37 },
      camp:    { flat: 16, blend: 10, maxH: 40 },
      hideout: { flat: 13, blend: 10, maxH: 38 },
    },
    TOWER_HEIGHT: { village: 20, keep: 24, hideout: 14 },
    NAMES: {
      village: ['Brindle', 'Saltreach', 'Mossford', 'Harrowdale'],
      camp: ['Redcliff Camp', 'Ironwood Camp', 'Tollgate Camp'],
      keep: 'Vale Keep', hideout: 'The Lantern Ruin',
    },
    // movement
    CLIMB_SPEED: 3.8,          // blocks/s up any wall: hold forward + jump (or sprint) against it
    CLIMB_SIDE: 1.8,           // sideways speed while climbing
    WALL_EJECT: [5, 6.5],      // back + jump while climbing: push off the wall (horizontal, vertical)
    SNEAK_SPEED: 2.4,          // crouch-walking: slower, quieter, harder to see
    SAFE_FALL: 4.5,            // falls up to this many blocks are free
    FALL_DAMAGE: 7,            // per block fallen beyond SAFE_FALL (landing in hay or water is always safe)
    HAY_CUSHION: 8,            // max fall speed inside hay
    LEAP_RANGE: 2.2,           // stepping off within this many blocks of a perch tip is a leap of faith
    REGEN: { DELAY: 5, RATE: 12 },   // players heal by themselves: RATE health/s after DELAY s without taking damage
    // arms crates in enemy camps and the keep: top up what you carry (each crate restocks after RESTOCK s)
    // arms crates (enemy camps, the keep) and the Order's supply chest at the hideout (E): fill up to these
    ARMORY: { ARROWS: 24, SMOKE: 4, ROUNDS: 48, RESTOCK: 120, HOME_RESTOCK: 20, LOW_ARROWS: 3 },
    NPC_DRAW_DIST: 90,         // villagers and guards farther than this from the camera aren't drawn
    NPC_ACTIVE: 75,            // NPCs with no player this close stand still (not simulated)
    // melee: the wrist blade kills outright when the target doesn't see it coming (unaware, from behind,
    // from above, or while it winds up a swing); otherwise it's a quick stab
    BLADES: {
      wrist_blade: { name: 'Wrist Blade', damage: 34, range: 2.4, cooldown: 0.5, assassinate: true },
      sword: { name: 'Sabre', damage: 13, range: 2.4, cooldown: 1.2, windup: 0.45, visible: true },
      // the Order's sword: a 3-cut combo (the third cut hits harder), right mouse to block. A block raised just
      // before a sabre lands is a parry: the attacker staggers, open to a finishing blow
      longsword: { name: 'Order Sword', damage: 36, range: 2.8, cooldown: 0.42, visible: true, combo: true, block: true, sword: true },
    },
    SWORD: {
      COMBO_GAP: 1.0,          // s: a cut this soon after the last continues the combo
      FINISHER: 1.6,           // damage multiplier on the third cut
      BLOCK: 0.2,              // damage let through a block (melee from the front)
      BLOCK_ARC: 1.3,          // radians either side of where you face
      PARRY: 0.4,              // s: a block this fresh is a parry
      STAGGER: 1.6,            // s the parried attacker staggers
      GUARD_BLOCK: 0.35,       // chance a fighting guard blocks a cut from the front
      BLOCK_SPEED: 0.55,       // movement while blocking
    },
    AIR_KILL: { RANGE: 2.6, DROP_MIN: 0.8, DROP_MAX: 12 },  // air assassination: target this far below you
    BEHIND_ANGLE: 2.0,         // radians between the victim's facing and the attacker: "from behind"
    // guard perception
    VISION: {
      RANGE: 30,               // blocks in daylight
      FOV: 1.15,               // half angle (radians) of the view cone
      NIGHT: 0.6,              // range multiplier at night
      CLOSE: 3,                // anyone this close is noticed even outside the cone
      CLOSE_SNEAK: 1.1,        // ...but someone sneaking up from behind only this close (takedown range is 2.4)
      HIDDEN: 1.4,             // hiding in hay / bushes: only noticed this close (or by a searching guard at 2.5)
      LOS_EVERY: 0.2,          // seconds between line-of-sight checks per guard
    },
    AWARE: {
      RATE: 1.3,               // awareness per second at point blank; falls off with distance
      SUSPICIOUS: 0.35,        // turn, look, come closer
      DECAY: 0.22,             // per second while unseen
      SNEAK: 0.5, SPRINT: 1.6, CLIMB: 1.9, BLEND: 0.2, TRESPASS: 1.6, NOTORIETY: 0.35,
      PUBLIC: 0.0,             // base rate in villages for someone doing nothing suspicious
      APPROACH: 8, LOITER: 0.45, // within this many blocks outside a camp / the keep: watched (slowly)
      CALL_RANGE: 20,          // an alerted guard calls everyone within this range
      NOISE_RANGE: 45,         // gunshots are heard this far
      SEARCH_TIME: 18,         // seconds a guard searches before giving up
      LOSE_SIGHT: 3.5,         // seconds without seeing the target before combat turns into a search
      BODY_RANGE: 18,          // guards notice bodies this far away
      ALARM_TIME: 30,          // a found body puts the whole site on alert this long
    },
    GUARD: { HEALTH: 100, CAPTAIN_HEALTH: 220, WALK: 0.55, RUN: 1, REACTION: 0.5, AIM_ERROR: 0.05, RESPAWN: 240 },
    SMOKE: { TIME: 9, STUN: 4 },
    BLEND_RANGE: 2.8,          // two villagers this close hide you in the crowd (while walking)
    // Ida's shop at the hideout (open after chapter III); prices in silver
    SHOP: [
      { id: 'arrows', name: '12 arrows', price: 20, give: [['w_bow', 1], ['arrow', 12]] },
      { id: 'smoke', name: '2 smoke bombs', price: 40, give: [['w_smoke', 1], ['smoke_bomb', 2]] },
      { id: 'bandage', name: '3 bandage rolls', price: 20, give: [['bandage', 3]] },
      { id: 'medkit', name: 'Field medkit', price: 45, give: [['medkit', 1]] },
      { id: 'shield', name: 'Shield tonic', price: 50, give: [['shield_potion', 1]] },
      { id: 'pistol', name: 'Pistol + 24 rounds (loud!)', price: 120, give: [['w_pistol', 1], ['ammo_light', 24]] },
      { id: 'rounds', name: '24 light rounds', price: 20, give: [['ammo_light', 24]] },
    ],
  },

  // --- Day / night ------------------------------------------------------
  TIME: {
    DAY_LENGTH: 480,           // real seconds per full day
    START: 0.38,               // 0 = midnight, 0.25 = sunrise, 0.5 = noon
    SKIP: 0.125,               // fraction of a day skipped by the N key (3 hours)
  },

  // --- Fog --------------------------------------------------------------
  FOG: {
    FAR_FRACTION: 0.96,        // fog end as a fraction of render distance
    NEAR_FRACTION: 0.55,       // fog start as a fraction of fog end
  },
};
