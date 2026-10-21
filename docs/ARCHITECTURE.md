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
  - The activity runner runs chapters and contracts from `missions.js`, `missions-extra.js` and `missions-more.js`.
  - Each step can have setup, check, fail, checkpoint, talk, cage, timer and retry. A failure is a "desync":
    the step's entities are cleared, guards are calmed, players go back to the checkpoint and the step's setup re-runs.
- **HUD** (`js/ui/story-hud.js`, `story-screens.js`): objective, markers, awareness meters, takedown reticle,
  prompts, subtitles, barks, title cards, the map with fast travel, the notice board and the shop. These read a
  small interface that both `Story` and the client's `StoryMirror` implement (the mirror also carries what the
  journal and the gear screen read: `stats`, `flags`, `letters`, `challengesDone`, `visited`, `nearForge(ch)`).
- **Online:**
  - Snapshots carry `sty` (`Story.sharedState()`) when its version changes, including the journal block `jr`.
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

## 14. Start screen, looks and characters (the lobby pass)

- **Lobby** (`index.html` `#overlay`, `js/ui/menu.js`, `js/ui/lobby-stage.js`): the first screen. Three areas: YOUR
  CHARACTER (name and look), the stage in the middle, and the side panel (PLAY mode cards, SETTINGS, CONTROLS, ONLINE).
  The stage is its own `THREE.Scene`, drawn with the game's renderer while no game runs (`main.js` frame, `!game`). The
  camera frames the figure into the free area (`#stageSlot`), so the panels never cover it. The pause menu is the same
  overlay with `#overlay.paused`.
- **Looks** (`js/render/looks.js`): palettes (skin, hair style and colour, tops, trousers, accents, facial hair) and
  `PLAYER_LOOK.normalize`, which turns any input into a valid spec `{ skin, style, hair, top, bottom, accent, facial,
  hood, cloak }`. Settings keep it (`settings.look`). A `Character` carries it as `lookSpec` with `look: 'player'`
  (or `'order'` in story, where the uniform stays and the colours follow the player). Bots keep the arena ranger and the
  story NPC looks.
- **Online:** the joiner's look goes in `hello.look`; every character record carries `ls` (the packed spec, see
  `NetProto.look`). `NET.VERSION` is 7 (journal state in `sty`, eighteen chapters, four new quest items).
- **Models** (`js/render/models.js`): faces (eyes with whites, brows, nose, lips, cheeks, jaw, ears), hair in seven
  styles (`BodyGeometry.hairParts`), jackets with lapels and buttons, pleated cloaks, collars, belts and pockets, boots
  with cuffs and soles, and a vertical shading gradient on each segment (`BodyKit.grad`, applied in `BodyKit.merge`).
  Materials are Phong (a little sheen) and still share geometry between look-alikes.
- **Stage props:** the character holds the Order's longsword; the lobby camera turns with a drag or the wheel
  (`LobbyStage.nudge`).

## 15. Story gear: the Order's loadout, outfit and forge

Story mode uses no block inventory. Rules: `js/story/gear.js`. Screen: `js/ui/gear-screen.js` (Tab in story, a
`StoryScreens` kind).

- **Loadout** = inventory slots 0-4 (`Gear.LOADOUT`): hidden blade, sword, ranged, throwable, remedy. The inventory's
  optional rule `Inventory.slotFits(i, stack)` (set by `Gear.attach`) lets a loadout slot take only its kinds
  (`CONFIG.STORY.GEAR.LOADOUT[i].ids`). The hotbar shows the five labelled slots (`HotbarHud.setLoadout`).
- **Outfit** = gear pieces (`kind: 'gear'`, `CONFIG.STORY.GEAR.PIECES`): a stack with `data = { lvl, eq }`. Wearing a
  piece sets `eq`; a second piece for the same place takes the first off. Pieces have a slot, a rarity and base stats.
- **Stats** are summed from what is worn (`Gear.stats`, cached on the inventory version): attack (blade damage),
  defense (damage taken, `Combat.applyDamage`) and stealth (how slowly guards notice you, `NpcController.perceive` and
  `Story.suspicionRate`). Falls ignore defense.
- **Forge and selling:** `Gear.act(story, ch, op, i, j)` with ops `equip`, `move`, `sell`, `upgrade`. Upgrades need Ida
  in reach (`Story.nearForge`), the shop open, silver and materials (`CONFIG.STORY.GEAR.UPGRADE`).
- **Online:** the screen sends `{ op: 'story', a: 'gear', g: op, i, j }` (the sub-operation is `g`, because `op` is the
  transport's field); the host runs it through `Story.act`.

## 16. The campaign: chapters, uses, letters, challenges and the journal

- **Chapters:** `STORY_CHAPTERS` (`story.js`) composes eighteen: the five of `missions.js` (`STORY_CHAPTERS_CORE`), the four
  of `missions-extra.js` (Toll Roads, The Granary, Bells of Ironwood, Night Watch) and the nine of `missions-more.js`
  (`STORY_MORE_CHAPTERS`: Iron for the Forge, The Informant, The Prisoners, The Pickpocket, Vale's Answer, The Missing
  Pages, Marksmen of the Keep, Rally the Villages, The Seal). Order: I Quiet Order, II Ledger, III Smith, IV Iron, V Toll
  Roads, VI Informant, VII Granary, VIII Prisoners, IX Captain, X Pickpocket, XI Vale's Answer, XII Bells, XIII Pages,
  XIV Night Watch, XV Marksmen, XVI Rally, XVII Seal, XVIII Magistrate. `StoryKit` (same file) holds the shared step
  builders and point finders (`clear`, `report`, `roadPoint`, `wallSpots`, `houseOf`, `elder`).
  - **Saves are version 3.** `Story.chapterOfSave(d)` migrates older ones: version 1 (five chapters) goes through
    `STORY_CHAPTER_MAP_V1` to a version 2 index (nine chapters); a version 2 save's next chapter becomes the first
    chapter after the last one it had played (`STORY_V2_PLACES`), so the new chapters in between are played, not skipped.
  - **Chapter links:** Pell's key (X) makes the lockbox of XVII quick (1.6 s instead of 6 s); the forged order of XVII
    (`Story.recallKeepPatrols`, flag `sealed`) removes the keep's wall and courtyard patrols for good, and `populate`
    skips them on later loads.
  - **Moving targets and conditions:** a use target may have getters (`at` follows an NPC, `text` and `time` depend on
    what the player carries). Uses are checked before the shop, so a use at Ida's forge wins over "Trade with Ida".
- **Uses:** a step adds things to press E on with `S.addUse(M, { at, text, time, run(S, M, ch) })`. The director
  counts them as a timed action (like sync and cage), runs `run` when the action finishes, and drops them when their
  step is retried. The objective marker points at the nearest one (`S.nearestUse`).
- **Contracts:** six kinds (assassinate, steal, rescue, courier, bounty, collect). `Contracts.make` hands the last two
  to `STORY_NEW_CONTRACTS`.
- **Order letters:** twelve collectibles (`ORDER_LETTERS` in `challenges.js`) lie at points of interest. Each is a
  persistent `ItemDrop` that is read when picked up (`Story._collectLetters` takes it out of the pack and counts it).
- **Challenges** (`STORY_CHALLENGES`, 37): goals over `S.stats` (counters kept by event hooks: kills, silent takedowns,
  arrows, parries, leaps, travel, distance, sites visited, purchases, forge upgrades, chapters done unseen, and so
  on) and `S.flags` (granary, bells, tolls, informant, Pell's key, columns, marksmen, the seal). `Story._checkChallenges` runs once a second; a completion pays silver and
  some pay challenge-only gear (`CONFIG.STORY.GEAR.PIECES`, price 0).
- **Journal** (J in story): chapters, challenges with their rewards, and the letters read so far (`journalHTML`).
- **Length:** measured by `tests/campaign.test.js`, which plays all eighteen chapters with a scripted player and adds up the
  straight-line distance between its objectives (about 8,100 blocks, x1.35 for real paths, at 5.2 blocks per second) and the
  time it spends waiting for NPCs (about 5 minutes): **about 40 minutes for the main road at a run**, with no fighting,
  no retries and no looking around. The test prints the table (per chapter: blocks, waiting seconds, minutes). A first
  playthrough with stealth, fights and the odd retry takes a few times that; the 37 challenges, 12 letters, contracts and
  gear upgrades come on top. It is not a day.

## 17. Touch controls (phones and tablets)

`js/input/touch.js` (`TouchUI`) is an overlay that drives the same `Input` object as the keyboard: the stick sets
`input.move` (an analogue move used by `KeyboardMouseController`), drags on the open screen call `touchLook`, and
buttons press keys or mouse buttons (`touchKey`, `touchButton`) or dispatch the key event the UI already listens for
(Tab, M, J). `Input.touch` makes lock and unlock plain flags, so there is no pointer lock to wait for.

- **Shown** while playing with nothing else open, when the pointer is coarse (`TouchUI.wanted`) or with `?touch=1`.
  Layout by mode, top left: GEAR, MAP and JOURNAL in story; FLY in explore and free build; BUILD in free build; INV
  elsewhere. FIRE, AIM, JUMP, RELOAD, USE, CROUCH and NEXT on the right; MENU at the top right, beside the minimap. `body.touch` moves the HUD (vitals, ammo, material counts) out of the way.
- **Platforms:** Android Chrome goes full screen and locks landscape (`AppShell.toggleFullscreen`). iPhone Safari has
  no full screen API, so the page says to use Add to Home Screen (standalone mode). Portrait shows a turn-your-phone
  message. The first touch unlocks audio. The viewport disables pinch zoom.
- **Tests:** `tests/touch.test.js` sends real touch events through the DevTools protocol (`Input.dispatchTouchEvent`).

## 18. Performance

Measured headless (Chromium with software WebGL, so absolute numbers are not a phone or a GPU): the JavaScript per
tick is 0.1-0.2 ms and the rest of a frame is the GPU. Frame time follows render distance (about 25, 37 and 45 ms at
4, 6 and 8 chunks) and triangles, not screen size.

- **Graphics presets** (Settings > Graphics, `CONFIG.QUALITY`): Low (4 chunks, 0.75 pixel ratio, story people drawn to
  60 blocks), Medium (6, 1.0, 75), High (8, 1.5, 90) and Ultra (12 chunks, section 21). The default is *Auto*
  (`GpuTier.pick` in `render/post.js`, from the card's name in `WEBGL_debug_renderer_info`): Ultra for a desktop-class
  card (Radeon RX, GeForce RTX / GTX 1060 and up, Arc), Medium on touch screens, High otherwise (built-in graphics,
  Apple, software rendering). Settings saved before Auto existed move to Auto once (`qualityV`). `?quality=` overrides.
- **Auto resolution** (`main.js` `adaptResolution`): when frames run long for a while the pixel ratio drops (to 0.6 of
  the preset), and it rises again when they are short. `CONFIG.AUTO_RESOLUTION` has the thresholds; a preset can
  override them (`autoRes`: Ultra keeps above ~57 fps and may go up to 1.34x on a fast, high refresh screen).
- Dynamic render distance (Auto distance) already lowers the distance while the frame rate is low.

## 20. The story land: desert, smooth ground and sun shadows (NET.VERSION 8)

Story mode no longer draws the island as cubes. The other modes are unchanged (classic cubes, classic materials).

- **Terrain** (`worker/terrain.js`, story only): sand dunes, green irrigated fields along the water (`storyTop`), bare
  limestone on steep slopes and high ground. Palms grow in the green and on the dunes (`storyTreeKind`), reeds on the
  dry shore. The sea floor and shores are sand; there is no snow, no cactus and no leaf cube in the story land.
- **Smooth ground** (`worker/mesher.js`, `SMOOTH`): the natural ground (grass, dirt, sand, stone, path) is one
  continuous skin per chunk with a height at each corner, averaged over the neighbouring columns that are at most one
  block apart (`LINK_DY`); a cliff keeps its cubes. Vertex colours come from the column's material and are jittered per
  column with a hash of the world position, so chunks agree on their borders. The skin is drawn by `World._makeGround` as the chunk's `meshGround` mesh, and casts shadows like the cubes.
  Collision is still the voxels, so walking and climbing do not change.
- **Built things stay cubes**: walls, roofs (flat, with parapets), floors, trunks of the keep and the camps. Every chunk
  waits for all 8 neighbours before it is meshed (story only), because the skin reads the diagonal columns too.
- **Palms and reeds** (`emitPalm`, `emitReeds`, `propsOf`): real geometry, built in the mesher from the palm marker
  block (`BLOCK.PALM`, solid, no tile) and the bush blocks on the shore. Fronds sway in the prop shader (`sway`).
- **Look pass 2** (NET.VERSION 9): the atlas tiles are 128 px; the ground skin has baked contact shade (a corner lower
  than the ground around it takes less light, `emitGround` in the mesher); its shader bends the normal with the slope of
  two noise scales and wind ripples, and shades wet sand by the water and sun-dried grass towards olive; shadows are 12
  rotated taps over a disc a few texels wide (soft edges); the tone curve is ACES-like with a warm-highlight, cool-shadow
  grade; the sky has a warm horizon band towards the sun and slow cirrus streaks; the
  High preset's shadow map is 4096. Village houses are brick or plaster, not planks.
- **Materials** (`render/story-materials.js`, `render/story-textures.js`): a 128-pixel tile atlas with mip-maps, painted
  from tileable value noise (sandstone ashlar, mudbrick with limewash, acacia beams, palm planks, terracotta, linen,
  straw, papyrus), and four shaders: voxels, ground skin, props and water (ripples, a sun glint, Fresnel sky).
  The shared uniforms (`uSunDir`, `uSunColor`, `uSkyAmb`, `uGndAmb`) are set by `Sky._updateStory` from the clock:
  the sun at day, the moon and a cooler ambient at night.
- **Sky** (`render/sky.js`): a dome with a gradient, a round sun with a glow, a moon and stars at night. Set on `Sky`
  only when the story materials are in use; the cube modes keep their sky.
- **Sun shadows** (`render/shadow.js`): one depth map from the sun, centred ahead of the viewer. Only layer 1 (chunks,
  props, people) casts. It is redrawn when the view has moved 3 blocks, the sun has turned, or after 15 frames; the
  shaders take four taps of it. The size comes from the quality preset (`CONFIG.QUALITY.*.shadow`: 0 on Low, 1024 on
  Medium, 2048 on High).
- **People** (`render/models.js`): the island's dress is linen, ochre and indigo; the guards wear kilts and bare
  chests with a bronze collar (`usekh`), the captain and the Magistrate a striped nemes (`nemes`) and a feather.
  These are original garments inspired by the period and place, not any game's models.

**Measured** (headless Chromium, software WebGL, one page, the story at the start, 1000x600):
classic sandbox 54 fps; story Low 31, Medium 23, High 19 (shadows are about a third of it; props and the voxel shader
the rest). Two pages in one browser (the co-op test) slow the friend's page to a few frames a second, so the co-op test
waits for the friend's game to start ticking before it presses E. Real GPUs and phones were not measured here.

## 21. Ultra: desktop graphics cards (post-processing)

Ultra is for desktop graphics cards (the user's is a Radeon RX 9060 XT). Everything below is off on Low, Medium and High,
except the anisotropic filtering and the aerial haze, which are cheap.

- **Post-processing** (`render/post.js`, `PostFX`): the views draw into one off-screen target (`PlayerView.render(...,
  post)` binds its rectangle there) with 4x MSAA, at max(screen pixel ratio, 1.5) times the CSS size and the auto
  resolution scale, capped at twice 4K. Then: bloom (luminance threshold 0.86, dual Kawase blur down to 1/32 and back
  up), sun rays (story: each pixel marches 48 steps towards the sun on screen and gathers the open sky near it; the sky
  dome writes alpha 0, clouds a little more, everything else 1, so whatever stands in front of the sun shadows the
  rays; one pass per view, so split screen has two suns), and the final pass: a 4-tap filter down to the canvas, a
  contrast-adaptive sharpen (clamped to the neighbours' range), bloom and rays added, a film grade (gentle S-curve,
  golden highlights, teal shadows, half strength outside story), a vignette and a dither against banding.
  The canvas itself stays at the screen's resolution; the lobby stage is not post-processed.
- **Textures**: the story voxel shader samples with `textureGrad` instead of a hand-picked `textureLod`, with the
  footprint scaled so the mip level stays at 2.5 or finer (no bleeding between atlas tiles) while the atlas's
  anisotropic filtering (`aniso`: 1 / 2 / 4 / 16 by preset, `uAniso`) keeps faces at grazing angles sharp.
- **Haze** (all story presets): the fog colour turns towards the sun's colour when you look towards it, and a thin
  aerial haze (`1 - exp(-0.0045 d)`, at most 30%) starts long before the fog proper.
- **Shadows**: an 8192 map reaching 80 blocks (`shadowExtent`) instead of 4096 over 46: twice the reach, the same
  sharpness. Clamped to the card's largest texture.
- **Clouds** (`Sky.clouds`, `uClouds`): cumulus on the story dome, five octaves of noise lit from the sun's side.
- **Windows launcher**: Edge or Chrome is started with `--force_high_performance_gpu --ignore-gpu-blocklist` (only
  when the browser was not already running).

**Measured** on an Apple M1 laptop (headless Chromium on Metal, vsync off, story on the hills, auto resolution off):
High at 1920x1080 214 fps; Ultra (12 chunks) at 1920x1080 61 fps, at 2560x1440 36 fps. A desktop RX 9060 XT is several
times an M1's GPU; it was not measured. Software WebGL (the tests) picks High on Auto.

## 22. Look pass 3: palms, the sea to the horizon, haze for everything, the UI and the phone apps' design

- **Date palms** (`emitPalm` in `worker/mesher.js`): a curved, flared trunk (12 rings x 9 sides) and about 26 fronds in
  three tiers, a skirt of dead fronds and clusters of dates. Props carry a `tex` attribute (along, across, kind): the
  prop shader cuts the leaflets out of each frond (`frondCut`, widened by `fwidth` so far fronds do not shimmer) and
  draws the trunk's old leaf bases (kind 1). Props are on `PROP_SHADOW_LAYER` (7): the sun's shadow pass draws them
  again with `materials.propDepth`, which cuts the same leaflets, so their shadows are dappled.
- **The far ocean** (`materials.ocean`, `updateOcean` in `main.js`): a plane under the chunks' water that follows the
  camera out to 1300 blocks (story cameras' far plane), fading in from 40 to 64 blocks so the shallow sea floor shows
  near you. Its distance is computed per pixel (the plane's corners are far away: an interpolated distance would be
  wrong). Water hazes over a much longer distance than land (`1 - exp(-0.0028 d)`), so the sea runs to the horizon.
- **Haze**: the day's horizon (and fog) is a pale, faintly blue white, warm only towards the sun. `scene.fog` follows the
  terrain's fog, so people, items and effects fade with the land; the storm wall and loot beams keep `fog: false`.
- **Sky alpha**: the dome writes its sun-ray mask into alpha only for the Ultra post-processing (`Sky.skyMask`). The
  canvas has an alpha channel, so on the other presets alpha 0 would show the page behind the sky.
- **The UI theme** (the last block of `index.html`'s styles): a classical serif (Optima / Palatino) for titles and
  buttons, the system sans for text, dark glass panels with gold hairlines, ivory and gold instead of orange, thin bars,
  a round minimap. Touch buttons are glass circles with drawn icons (`TOUCH_ICONS` in `input/touch.js`); on a phone
  the vitals sit under the compass and prompts wrap and drop the key hint.
- **The lobby stage** (`ui/lobby-stage.js`): a temple court at dusk: a sandstone floor with an inlaid ring, columns,
  bronze braziers, obelisks and pyramids against an indigo-to-gold sky.
- **The phone apps' icon and launch screen** (`drawEmblem` in `mac/make-icons.js`, `native/resources/`): the Quiet
  Order's sigil, an original design (a gold ring, a blade pointing down through it, swept wings) on warm black.

## 23. Real people (MakeHuman bodies) and a watertight ground

- **The people** (`render/humans.js`, assets in `js/assets/humans-data.js`, built by `tools/humans/`): a man and a woman
  from MakeHuman's CC0 system assets, skinned to its `game_engine` skeleton (pelvis, three spine bones, neck, head,
  clavicles, arms, hands with fingers, legs, feet). `HumanModels` loads the data script in the background and prepares
  each kind once; until then, on the Low preset and on software rendering the drawn bodies stay (`?humans=1/0`).
  `HumanModels.generation` changes when they arrive or are switched: characters rebuild their models.
- **Posing**: `CharacterModel` keeps its rig of joints and its animation unchanged. `HumanBody.pose` composes each joint's
  rotation down its chain (torso, head, shoulders, elbows, hands, hips, thighs, shins, feet) and turns each bone's rest
  rotation by it; limb bones are first straightened to point down like the rig at rest (the bind pose is an A-pose). The
  spine takes a third of the torso's turn per bone, the neck 40% of the head's. Fingers rest a little curled and close
  round what the hand holds (`grip`).
- **Dress** (`humanDress` in models.js): the skin texture tinted to the skin tone; the shirt and trousers greyed and tinted
  with the outfit's colours (above / below the belt, a `top` attribute); shoes and hair tinted the same way; the iris
  turned dark brown. The skin under worn clothes is cut away (an `under` vertex mask from the build) so it never shows
  through; a bare chest hides the shirt and shows the skin, a kilt hides the trousers.
- **Garments** (`BodyGeometry.garments`): robes and the kilt, capes and cloaks (now a curved sheet round the back),
  hoods, helmets, the nemes, hats, collars, sashes, the ranger's armour, bracers, the mentor's beard; weapons and the bow.
  They hang on holders fixed to bones (`HumanBody.attach`), turned like their joint of the rig.
- **Looks** carry `body` (Man / Woman, NET.VERSION 10).
- **Cost** (M1 laptop, story at High, 1080p): 231 fps with the drawn bodies, 145 with real people.
- **Ground** (`emitSkirts` in the mesher): cube faces between two natural ground columns are gone entirely; where two
  columns are not one skin (a step of more than `LINK_DY`, now 2) a strip joins their edges at the exact corner heights,
  so the skin is watertight (no stone walls left standing in the sand, no holes to the sky). Steep strips read as rock.

## 24. Garments made for the bodies, stone that is not voxels (NET.VERSION 11)

- **Skinned garments** (`tools/humans/garments.py`, run inside the Blender build): the Order's coat skirt (`garment_tails`:
  open at the front, split behind), the long robe, the coat, the pleated kilt, a belt, the hood (a soft peak, the face
  open, a capelet over the shoulders), the headcloth, the cloak, the broad collar (usekh) and the beard. Each is a mesh
  skinned to the skeleton, shaped by casting rays at the body and its clothes: cloth drapes from the widest ring above it
  (a running maximum, then a convex hull per ring), with folds that deepen towards the hem. Skirts are made round straight
  legs (the game straightens the bind pose's legs) and carried back into the bind pose through the inverse of that
  skinning; their panels follow the thighs, so they move with the walk. The cloak hangs from a bone of its own (`cloak`,
  under `spine_03`) that the game turns with the rig's cape group (`HUMAN_JOINTS.cloak`). Vertex colour R marks the trim,
  G the shade in the folds; `humanMaterial(..., { garment: true })` tints them (robe colour, trim colour) and darkens the
  inside (the hood round the face). `humanDress(o).wear` says what is worn; `BodyGeometry.garments` leaves the old drawn
  robes, hoods, cloaks, collars and beards out when the body has its own (`kind.garments`).
- **The start screen and the loading screen** never show the drawn body while the real people are still loading
  (`HumanModels.pending()`): the plinth stays empty for that moment, and story's loading screen waits for them (20 s at most).
- **Chamfered stone** (`emitBevelled` in the mesher, story only): a face's edges that are outside corners (the block beside
  it and the cell in front of that both open) are cut back 7 cm and get half of a 45 degree bevel; the neighbouring face
  adds the other half, and corners close with small triangles. Such faces are not merged with plain ones. The `edge`
  attribute (distance to each corner edge, 0 on the bevel's middle line) lets the voxel shader turn the light smoothly over
  the bevel and wear it unevenly. Collision is still the voxels.
- **Weathering** (voxel shader): large patches of warmer and paler stone, streaks down the walls, sand on what faces up,
  lighter worn corners. The sandstone tile is three courses of uneven stones with eroded edges and sandy joints.
- **Props instead of cubes**: leaves are ivy (small leaves on the walls, strands hanging down); cloth hung up or on posts
  is an awning (striped linen sagging between the beams, a scalloped valance on its open edges); cloth lying free is a
  bed (a linen mattress, a striped blanket over it). Cloth set into a floor (a carpet) stays a cube. Prop blocks do not
  hide their neighbours' faces (`asProp`). The ruined chapel's walls are all dressed stone now (NET.VERSION 11).

## 19. Engine boundaries (what a reusable engine would take)

Not extracted yet. Generic parts (no BLOCKFIRE rules in them): `core/` (fixed-step `Game`, events, rng), `world/`
(chunk streaming, edits, raycast), `worker/` (noise, mesher, the worker bundle), `render/` (atlas, sky, materials,
character shapes), `input/` (controllers and touch), `items/inventory.js`, `entities/` (AABB physics), `net/`
(transport, protocol, host and client). BLOCKFIRE content: `constants.js` values, `match/`, `ai/`, `combat/` rules,
`story/` (director, missions, NPCs, stealth, gear, challenges), `ui/` screens and HUD, the modes table in `core/game.js`,
and `main.js` (the boot that wires them). Extracting an engine means moving the generic parts behind one boot API and
leaving the content as a game on top. See the README for the open question.
