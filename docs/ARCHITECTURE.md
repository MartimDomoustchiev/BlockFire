# BLOCKFIRE - architecture contract

This document is the shared contract for every build stage. Code must follow it; if a
stage genuinely needs to change a decision here, update this file in the same change and
say why. Product requirements live in `docs/SPEC.md`.

## 1. Hard constraints

- **Runs offline from `file://` by double-clicking `index.html`.** No ES modules, no bundler,
  no npm runtime deps, no network. Every source file is a classic `<script>` that defines
  globals (classes, consts, functions). Load order is the `<script>` list in `index.html`.
  Exception (added with online play, section 10): the optional ONLINE mode uses the network,
  through the local copy `vendor/peerjs.min.js`. Nothing else ever does.
- **Three.js is the local `three.min.js` (r149).** Use only APIs that exist in r149
  (e.g. `outputEncoding`, not `outputColorSpace`).
- **Web Workers** are started from a Blob URL via `WorkerBundle` (see `js/worker/bundle.js`).
  Worker code never touches the DOM or THREE.
- **All art is procedural** (canvas-painted pixel textures/icons, box-built models).
  **All audio is synthesised** with Web Audio. No external assets of any kind.
- **Originality:** no trademarked names, characters, skins, logos, weapon names or sounds.
- **60 FPS target.** No per-frame allocations in hot loops where avoidable; heavy work
  (chunk gen/meshing) in workers; geometry uploads rate-limited per frame.
- **Every gameplay number lives in `js/constants.js`** (`CONFIG.*`): damage, fire rates,
  rarity multipliers, storm timings, build costs, vehicle tuning, bot difficulty, etc.

## 2. Folder layout (target)

```
index.html               shell + DOM for HUD/menus + script order
three.min.js
js/constants.js          CONFIG (all tunables)
js/core/                 rng.js, events.js, math helpers, game.js (Game + fixed-step loop)
js/world/                blocks.js, world.js (chunks/streaming/edits), raycast.js, block-entities
js/worker/               bundle.js, noise.js, terrain.js, mesher.js, entry.js  (worker-side)
js/render/               textures.js (atlas + icons), materials.js, sky.js, models.js (character + item models), viewport.js
js/input/                input.js (raw kb/mouse), controllers.js (KeyboardMouse/Gamepad -> Intent)
js/entities/             entity.js, character.js, item-drop.js, projectile.js, vehicle.js
js/items/                items.js (registry), inventory.js, crafting.js (recipes), furnace.js
js/combat/               weapons.js, damage.js, loot.js
js/build/                building.js (pieces, grid, edit mode)
js/ai/                   bot.js (brain/state machine), nav.js
js/match/                modes.js, match.js, storm.js
js/ui/                   hud.js, inventory-ui.js, menus.js, minimap.js, feed.js
js/audio/                audio.js (Web Audio synth)
js/main.js               boot only
tests/                   headless Playwright tests (dev only, not needed to play)
docs/                    SPEC.md, ARCHITECTURE.md
```
Files may be added; keep one responsibility per file and keep `index.html` script order correct
(dependencies first, `main.js` last).

## 3. Simulation model (networking-ready)

- `Game` owns all gameplay state: `world`, `entities` (Map id -> Entity), `match`, `time`
  (sim seconds), `timeOfDay`, `rng`, `events`. Exposed as `window.__game` for tests/debugging.
- **Fixed timestep**: `Game.tick(dt = 1/CONFIG.SIM_HZ)` at 60 Hz driven by an accumulator in the
  rAF loop (max ~5 catch-up steps). Rendering happens once per rAF after ticking.
- **Sim code never reads the DOM, keyboard, mouse or gamepad.** Each Character has a
  `controller` that returns an **Intent** each tick. Human controllers translate raw input;
  `BotController` produces intents from AI. Same rules apply to humans and bots.
- **No `Math.random()` in sim code.** Use `game.rng` (seeded `Rng`), or hashes of
  (seed, ids, coordinates). Cosmetic-only randomness (particles) may use `Math.random`.
- **Events**: systems communicate side effects through `game.events.emit(name, payload)`
  (e.g. `blockBroken`, `blockPlaced`, `shot`, `damage`, `kill`, `pickup`, `explosion`,
  `vehicleEnter`). Audio, HUD, kill feed, particles subscribe; they never drive the sim.
- `Game.snapshot()` returns plain JSON-able state (entities, inventories, match) - the hook for
  future netcode. Entity ids are integers from `game.nextId()`.

### Intent (all fields default to 0 / false / null; values are per tick)
```
moveX, moveZ        -1..1  strafe / forward (local to yaw)
lookDX, lookDY      radians to add to yaw / pitch this tick
jump, sprint, crouch            held
fire, firePressed               primary (shoot / mine / confirm build)
aim, aimPressed                 secondary (ADS / place block / edit select)
reload, interact, drop          pressed (interact = chests, doors, vehicles, crafting table, furnace)
slot                -1 or 0..8  direct hotbar select;  slotDelta  -1/0/+1 (wheel / bumpers)
toggleInventory, toggleBuild    pressed
buildPiece          null|'wall'|'floor'|'ramp'|'roof'   select piece (enters build mode)
editMode            pressed (toggle wall edit)
rampRush (held), boxUp (pressed)
throttle, steer, handbrake, boost, switchSeat   (vehicles; reuse moveZ/moveX if simpler)
```

## 4. Core types

- **Entity**: `id, type, pos (THREE.Vector3), vel, yaw, alive, update(dt, game), dispose()`.
- **Character** (humans + bots): AABB 0.6 x 1.8 x 0.6 voxel physics (port of stage-1 Player)
  plus **auto step-up** of up to `CONFIG.PLAYER.STEP_HEIGHT` (1 block) while grounded, with the
  camera eased so it doesn't snap - this is what makes voxel build-ramps (stairs) walkable,
  `health 100`, `shield 100 max (starts 0 in battle)`, `inventory`, `selectedSlot`, `controller`,
  `team`, `name`, `stats {kills, damageDealt, spawnTime, deathTime, placement}`, `vehicle/seat`,
  `buildState`. Hitboxes: head box + body box for weapons. Rendered with an original jointed human model (see section 13).
- **Viewport**: `{ character, camera, rect, hud }`. The renderer draws every viewport with
  scissor/viewport. Stages 1-6 use one; split-screen (stage 7) uses two. Chunk meshes stream
  around **all** viewport characters.
- **Items**: `ITEMS` registry keyed by string id (`'planks'`, `'iron_pickaxe'`, `'ar'`...):
  `{ id, name, kind: 'block'|'material'|'tool'|'weapon'|'ammo'|'consumable', maxStack, icon,
  blockId?, tool?: {type:'pickaxe'|'axe'|'shovel', tier, speed, durability},
  weapon?: {class}, ammo?, consumable?: {...} }`.
  **ItemStack** `{ id, count, data? }` - `data` holds per-instance state (durability, rarity,
  ammo in magazine). Weapons/tools never stack.
- **Inventory**: 36 slots (0-8 = hotbar). API: `add(stack) -> leftover count`, `remove(id, n)`,
  `count(id)`, `get(i)`, `set(i, stack)`, `swap(i, j)`. Characters may carry at most
  `CONFIG.MAX_WEAPONS` (5) weapons.
- **Build materials** (stage 4) are ordinary inventory items: wood = `planks`, stone = `stone`
  (the block item), metal = `iron_ingot`. HUD shows their counts. Build pieces are made of the
  `BUILD_WOOD/STONE/METAL` voxels and tracked per piece for HP.
- **Blocks**: ids in `BLOCK` are **append-only** (never renumber - saved edits and worker tables
  depend on them). Block flags in `BlockTables` (opaque/solid/liquid/cutout/faceTiles...).
  Block entities (furnace state, chests) live in `world.blockEntities` keyed `"x,y,z"`.

## 5. World

- Chunk data (`Uint8Array 16*64*16`, index `x + z*16 + y*256`) is owned by the main thread.
- `world.getBlock / setBlock / setBlocks(list)`; edits mark the chunk (and neighbours when on a
  border, incl. diagonals for AO) dirty and re-mesh with priority over streaming. Old meshes
  stay visible until the new ones arrive (no flicker).
- Edited chunks are never lost on unload (stash modified data; reuse it on reload).
- **Island mode** (battle/duel): terrain is an island of radius `CONFIG.ISLAND.RADIUS`; all
  island chunk *data* is generated up front and stays resident (bots/physics need it);
  *meshes* stream around viewers. Sandbox mode: infinite world.
- `raycastBlocks(world, origin, dir, maxDist)` -> `{ x, y, z, block, nx, ny, nz, dist }` (voxel DDA).

## 6. UI

- DOM overlay for HUD/menus (crisp pixel style: monospace font, chunky borders, palette from
  `index.html` CSS variables). Each viewport has its own HUD root positioned over its rect.
- UI reads game state and emits *intents/commands*; it never mutates sim state directly
  except through Inventory/crafting APIs that the sim also uses.

## 7. Default key bindings (keyboard + mouse)

| Key | Action |
|---|---|
| WASD / Space / Shift / C | move / jump / sprint / crouch |
| Mouse L | fire, mine, confirm build piece |
| Mouse R | aim (ADS) with a weapon, place block with a block item, select tiles in edit mode |
| 1-9, wheel | hotbar |
| R | reload |
| E | interact (chest, pickup, vehicle enter/exit, crafting table, furnace) |
| Tab | inventory / crafting  (inside the inventory: Q over a slot drops 1, Ctrl+Q drops the stack) |
| Q | toggle build mode;  in build mode Z wall, X floor, C ramp, V roof (wheel cycles) |
| G | edit wall (in build mode) |
| T | box-up;  hold B = ramp rush |
| F | fly toggle (sandbox only) |
| N | skip time of day (sandbox/debug) |
| F3 | debug panel |
| Esc | pause |

Gamepad (standard mapping) is defined in stage 7.

## 8. Testing

`tests/` holds headless Chromium tests (Playwright from the local npx cache; see
`tests/README.md`). Run `node tests/run.js` (all) or `node tests/run.js stage2` (filter).
Each stage adds `tests/stageN.test.js`. Tests drive the game through `window.__game` and
`?autostart=1` URL params; screenshots go to `tests/output/`.

## 9. As built (notes added after stage 7)

- **Modes** (`GAME_MODES` in `js/core/game.js`): `sandbox` (explore), `build` (free build: infinite blocks, no loot),
  `battle` (island + storm + bots, no respawn) and `duel` (island, two local players, optional respawn).
- **Views**: `js/ui/player-view.js` - one `PlayerView` per local player (camera, HUD root, viewmodel, outline,
  build ghost). Split-screen renders two views with scissored viewports; the second HUD root is a clone of the
  first. Render layers: 0 world, 1+i player i's private overlays, 3+i player i's own body (hidden from their camera).
- **Island**: `World.preload(radius)` generates and pins every island chunk's data up front; meshes still stream.
- **Gamepad**: `js/input/gamepad.js` (standard mapping) produces the same Intents as keyboard + mouse.
- **Audio**: `js/audio/audio.js` subscribes to game events; nothing in the sim depends on it.
- **Deviations**: build-piece vertical alignment follows the player's feet (terrain heights aren't multiples
  of 4); the inventory screen is player-1-only in split-screen; crouch has no movement effect (C = fly down).

## 10. Online play (added after stage 7)

Friends on other devices join a game over the internet with a 5-letter room code. Code: `js/net/`.

- **Topology: host-authoritative, peer-to-peer.** The hosting browser runs the real `Game`. Every friend
  connects straight to it over a WebRTC data channel (PeerJS 1.5.4, vendored). The free public PeerJS server
  only does matchmaking: the host registers the peer id `blockfire-<ROOMCODE>` and clients look it up. PeerJS
  supplies STUN plus TURN relays for routers that block direct links. Up to 8 players. Duel is local only.
- **Transport** (`transport.js`): `PeerTransport` (real) and `BridgeTransport` (tests: two pages joined by the
  Playwright harness, chosen with `?net=bridge`). Messages are JSON; the game code never touches WebRTC.
- **Client = replica.** A client builds its own `Game` with `replica: true` from the host's seed and mode, so
  terrain is generated locally and only block *edits* travel (in the welcome, then as deltas). A replica only
  ticks its own player (`netPredicted`). Everything else is a proxy (`netProxy`) that is interpolated 100 ms
  behind the newest snapshot.
- **Movement is client-reported.** The client moves its own player instantly and sends its position with
  its inputs (30 Hz). On the host that player is `netRemote`: a `RemoteController` replays the inputs one per
  tick and takes the reported position. The host still owns teleports (sequence number `netTpSeq`, acked as
  `tpa`) and knockback (`netImpulse`, applied by the client). This trades cheat-resistance for feel; it is a
  game among friends.
- **Everything else is host-run:** shooting (hitscan is lag-compensated by rewinding characters to what the
  shooter saw, using `Character.hist`), building, mining, inventory screens (`ScreenSession` on the host,
  mirrored by `RemoteSession`), vehicles, bots, storm and match.
- **Snapshots** (`host.js`, 20 Hz per client): entity records that changed since that client's last snapshot,
  limited to `NET.VIEW_RANGE` for drops and projectiles; the client's own private state (health, inventory,
  reload, open screen, teleports...); game events (sounds, effects, kill feed, entities packed as `{$e:id}`);
  block edits; build-piece changes; match and storm state. Clients predict their own gunshots cosmetically.
- **Battle flow:** online battles open in a lobby on the island and the host starts the match with Enter.
  Players who join mid-match spectate. The host's PLAY AGAIN re-welcomes everyone into the new game.
- **Robustness:**
  - A worker-timer heartbeat keeps both sides pinging when a tab is hidden. Each side drops the other after
    `NET.TIMEOUT` seconds of silence.
  - A hidden host tab keeps simulating from that heartbeat, so the game doesn't freeze for friends.
  - The host forgets a friend's held buttons after `NET.HOLD_TICKS` ticks without input.
  - The host loads terrain data (no meshes) within `NET.DATA_RADIUS` chunks of every friend
    (`World.update(viewers, others)`).
  - Joins time out after `NET.CONNECT_TIMEOUT` seconds with an explanation.
  - Clients with a different `NET.VERSION` are refused. Bump it whenever the protocol or world generation
    changes.
- **Tests:** `tests/net.test.js` (bridge transport, no internet needed).

## 11. Story mode (added after online play)

A stealth campaign on its own island (`CONFIG.STORY.SEED`). Mode `story` in `GAME_MODES`:
- island rules apply;
- climbing, sneaking, fall damage and keep-inventory are on;
- mining, building and loot are off.

- **Sites** (`js/worker/sites.js`, worker side):
  - From the seed alone, the workers plan the keep, 4 villages, 3 camps, the hideout and 12 roads.
  - `columnHeight` flattens each site and grades the roads towards a smoothed height profile.
  - Every structure block is bucketed per chunk and stamped by `generateChunk`.
  - New blocks are appended to the registry (ids 22-33): hay and bushes (walk-in hiding spots; hay is opaque, so it
    blocks sight), path, cobble, roof, plaster, timber, cloth, canvas, bars, notice board, arms crate.
  - Points of interest go to the main thread via the `plan` worker message: doors, posts, patrols, perches, hay,
    cages, boards and posters. Online clients ask their own workers, since the seed is the same.
- **Navigation** (`js/story/nav.js`): A* over standable cells (solid floor, 2 free blocks; step up 1, drop up to 3;
  no corner cutting). It aims for the ground under an airborne goal, string-pulls the path with a body-width
  margin, and rations searches per tick (count + nodes) with a short shared failure memory.
  `NpcController.walk()` follows paths with a small separation nudge, re-centres when snagged on a corner,
  re-plans when the goal moves, and falls back to straight-line steering (climbing) when there's no walkable
  route.
- **Healing** (`Character._regen`, rule `regen`): players get `STORY.REGEN.RATE` health per second after
  `STORY.REGEN.DELAY` seconds without damage. It runs on the host or offline, so online health stays
  authoritative. NPCs never regenerate.
- **Movement** (`Character`): `_climbCheck` (forward + jump/sprint into a wall), sneaking (crouch), `_trackFall`
  (host side; hay and water are safe), and the leap of faith (stepping off a perch steers you into its hay).
- **People** (`js/story/npc.js`): NPCs are Characters with controllers built on BotController's steering.
  - `GuardController` states: idle/patrol, suspicious, combat, search, investigate (noise, bodies), return.
  - Two sword guards press the attack at a time; marksmen shoot muskets.
  - `VillagerController` wanders, chats and flees. `AllyController` stands, follows (escorts) or walks a route,
    glancing back (tail targets).
  - NPCs with no player within `NPC_ACTIVE` are dormant (not simulated), and models are culled beyond
    `NPC_DRAW_DIST`.
- **Stealth** (`js/story/stealth.js`):
  - Per guard and per player, awareness grows from 0 to 1 with sight, distance, trespassing and suspicious acts.
    Sneaking slows it, blending nearly stops it, and hiding stops it.
  - In public, `Stealth.awarenessCap` keeps guards at "suspicious" unless the player is violent or notorious.
  - Leaves, hay and walls block sight.
  - Tail targets have their own suspicion meter (`Story.suspicionRate`).
  - Gunshots are noise, violence has witnesses, villagers scream, and found bodies raise a site alarm.
- **Blades** (`js/story/blade.js`): the wrist blade kills outright under `Stealth.canAssassinate`; air
  assassinations target someone below. Sabres wind up before they hit. The Order's `longsword` cuts a 3-step combo
  (`Blade.swing`; the third cut x `SWORD.FINISHER`; one cut kills anyone `canAssassinate` allows) and blocks on right
  mouse (`ch.blocking`, `ch.blockSince`). Every melee blow goes through `Blade.hit`: a raised block in front takes
  `SWORD.BLOCK` of it; a block younger than `SWORD.PARRY` is a parry (the attacker is stunned for `SWORD.STAGGER`); a
  fighting guard turns aside `SWORD.GUARD_BLOCK` of sword cuts.
- **Bow, smoke, muskets** are weapon classes. The bow (`WEAPONS.bow.bow`) draws while the trigger is held
  (`ch.draw` 0..1) and looses on release (`Weapons._bow`, `Weapons.drawn` scales speed and damage). Arrows are
  projectiles that leave an `arrow` pickup where they land or by the body they kill. Smoke is a `SmokeCloud` entity.
  Old saves are migrated by `Story.migrateStack` (throwing knives became the bow; everyone gets a sword).
- **Director** (`js/story/story.js`, host only). It owns population, upkeep (bodies cleared, guards respawn
  unseen), notoriety, silver, posters, viewpoints, fog of war, interactions (E: talk, sync, cage, board, poster,
  shop, resupply), timed actions, dialogue, the activity runner and saving.
  - Arms crates (`poi.armory` in every camp, the keep and the hideout): `Story.resupply` tops up arrows, smoke bombs
    and rounds for the gear the player carries, then that crate is empty for that player for `STORY.ARMORY.RESTOCK`
    seconds (`HOME_RESTOCK` at the hideout; `crateWait`). Running dry (`dryFire`) tells the player where to go; the
    HUD's supply marker points at the nearest stocked crate when arrows or smoke run low.
  - The activity runner runs chapters and contracts from `missions.js`.
  - Each step can have setup, check, fail, checkpoint, talk, cage, timer and retry. A failure is a "desync":
    the step's entities are cleared, guards are calmed, players go back to the checkpoint and the step's setup re-runs.
- **HUD** (`js/ui/story-hud.js`, `story-screens.js`): objective, markers, awareness meters, takedown reticle,
  prompts, subtitles, barks, title cards, the map with fast travel, the notice board and the shop. These read a
  small interface that both `Story` and the client's `StoryMirror` implement.
- **Online:**
  - Snapshots carry `sty` (`Story.sharedState()`) when its version changes.
  - Per player, they carry the prompt and the timed action (`me.sp` / `me.ac`).
  - Guard records carry their awareness of that player (`aw` / `hm`).
  - Story events are forwarded, and screen choices go back as `{op:'story'}` UI messages.
- **Tests:** `tests/story.test.js`.

## 12. The app shell (added after story mode)

- **Full screen** (`js/ui/app-shell.js`): the menu button, Alt+Enter, and the *start in full screen* setting
  (applied on the START click, which browsers accept as the user gesture). In a browser it uses the Fullscreen
  API; in the Mac app it asks the app for native full screen.
- **Mac app** (`mac/BlockfireApp.swift`, built by `mac/build.sh` into `BLOCKFIRE.app`):
  - An AppKit window around a WKWebView that loads the bundled game files from `Contents/Resources/game`.
    Universal binary, ad-hoc signed.
  - The page talks to the app through `window.webkit.messageHandlers.native` (`fullscreen`, `quit`); the app
    sets `window.__nativeApp` and reports full-screen changes to `window.__appFullscreen()`.
  - Pointer lock in WKWebView needs WebKit's private UI-delegate hook: the app answers
    `_webViewRequestPointerLock:` through `WKPageDidAllowPointerLock`.
  - In the app, the page claims every key (otherwise macOS beeps at "unhandled" keys) and disables the page
    context menu and text selection.
  - `--selftest [mode] --report file` runs the game with real AppKit clicks, keys and mouse motion and writes
    what works to a JSON file.
- **Installable web app:** served over http(s), the page adds `manifest.webmanifest` and registers `sw.js`
  (stale-while-revalidate cache of every same-origin file), so an installed copy starts offline. None of this
  runs on file://.
- **Icons:** `mac/make-icons.js` paints the icon (a stone block on fire) and writes `mac/AppIcon.icns` (via
  sips + iconutil) and `icons/*.png`.
- **Tests:** `tests/app.test.js` (full screen; the web app over a local http server, then fully offline).

## 13. Characters, hands and the camera (added after the app shell)

- **Character models** (`js/render/models.js`): every character is one jointed human body (hips, knees, ankles,
  waist, neck, shoulders, elbows; `RIG` holds the measurements, ~1.8 tall like the hitbox). `outfitFor(ch)` turns
  `ch.look` (null = the arena "ranger", or order / guard / captain / magistrate / mentor / smith / clerk /
  villager) and the id into colours and garments; `BodyGeometry` builds each body segment from rounded shapes merged
  into one vertex-coloured geometry, cached per outfit, so look-alikes share geometry. Materials are
  `MeshLambertMaterial`, lit by `CharacterLights` (a hemisphere + directional light per scene that follow the
  terrain's day/night light colour). Poses: walk / run with knees and elbows, sneak crouch, climb, leap of faith and
  gliding (the body tips about the hips), aiming, sword and blade strikes, seated, corpse. Presentation only: the
  hitboxes are unchanged.
- **First-person arms** (`js/render/viewmodel.js`): the viewmodel adds the player's forearms and hands, in the
  outfit's colours, to every held model. `ARM_GRIPS` says where each hand grips each item and `ARM_POSES` how it is
  turned; climbing shows both hands reaching up the wall.
- **Third-person camera** (`PlayerView._thirdPerson`): behind the right shoulder (`CONFIG.THIRD_PERSON`), pulled
  in by walls, and turned to look at the point the eyes' ray hits, so the crosshair stays exactly where shots,
  takedowns and E land (all of which still come from the eyes). It turns on the player's own-body layer and hides the
  viewmodel; aiming down sights returns to the eyes. Settings `thirdPersonStory` (default on) and `thirdPerson`
  (other modes, default off); P toggles the one for the current mode.
- **Weapons in hand** (`WeaponGeometry`, `BowRig` in models.js): proper sword and sabre blades and a recurve bow
  whose string and nocked arrow follow `ch.draw`, shared by the character models and the first-person view. The
  viewmodel turns the sword at the wrist through three cut poses and a block pose (`ViewModel.SWORD`).
- **Tests:** `story.test.js` ("story arms crates", "story bow", "story sword", "story looks").
