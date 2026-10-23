# BLOCKFIRE

An offline 3D voxel battle sandbox: a Minecraft-style block world with a fast gun, building and vehicle
arena shooter on top. Plain HTML + JavaScript + a local copy of Three.js (r149). No build step, no
downloaded assets: every texture is painted procedurally on a canvas, every model is built from boxes and
every sound is synthesised with the Web Audio API. Everything plays without internet except the optional
**Online** mode, which lets friends on other devices join your game.

## Run it

**On a Mac: the app.** Double-click **`BLOCKFIRE.app`**. It's a real Mac app: its own window, Dock icon and menu
bar, native full screen, no browser around it, and it works offline. Drag it into *Applications* (and onto the
Dock) to keep it. It remembers its window size and whether you left it in full screen.
- To rebuild it after changing the game: `./mac/build.sh` (needs Xcode or its Command Line Tools).
- On another Mac it isn't from the App Store, so the first time right-click it and choose **Open**.

**In a browser:** double-click `index.html` (any modern browser with WebGL).

**The start screen is a lobby.** Your character stands on a stage in front of the Order's banners: change its name,
skin, hair, clothes, accent colour, hood, cloak and face (or press RANDOMISE), drag the stage to turn it, pick a mode
card and press START. Esc (or **Start** on a gamepad) pauses; the same screen then offers RESUME, NEW GAME and QUIT TO LOBBY.
Click into the game to capture the mouse.

**Full screen:** the **FULL SCREEN** button at the top of the menu, **Alt/Option + Enter** at any time, or
the *Full screen* setting, which switches to full screen whenever a game starts. In the Mac app you can also
use the green window button or **Control + Command + F**.

**On Windows:** double-click `windows/BLOCKFIRE.bat`. It opens the game in its own window with Microsoft Edge (built into
Windows 10 and 11) or Google Chrome, and falls back to your default browser. Nothing to install.

**On a phone or tablet:** open the game on the same link as your friends (see *As an app from a website*) and pick the
lobby's mode. Touch controls appear while you play: a stick, a drag to look, and big FIRE, AIM and JUMP buttons. Turn the
phone sideways. Android Chrome goes full screen by itself; on an iPhone use *Share > Add to Home Screen* for a
full-screen app.

**As an app from a website:** put the folder on any website (GitHub Pages, itch.io, Netlify...) and it
becomes an installable app that works offline after the first visit.
- Chrome and Edge show an **INSTALL APP** button in the menu.
- In Safari use *File > Add to Dock*.
- On a phone or tablet use *Share > Add to Home Screen*.
- To try it locally: `cd blockfire && python3 -m http.server 8000`, then open http://localhost:8000.

## Modes

| Mode | What it is |
|---|---|
| **Solo vs Bots** | Drop onto a procedurally generated island with 1-7 bots (easy / normal / hard). Loot chests and floor loot, build, drive, survive the shrinking storm. Last one standing wins. No respawn. |
| **Split-screen Duel** | Two players side by side: player 1 on keyboard + mouse, player 2 on a gamepad. Optional extra bots. Rules: last one standing, or respawn and first to 5 kills. |
| **Free Build** | Infinite world, no enemies, no storm, building materials and blocks never run out, flying allowed. |
| **Explore** | Infinite world sandbox: mine, craft, smelt, loot chests, fight training dummies (debug), drive. Respawn on death. |
| **Story** | A stealth campaign on Kestrel Isle: eighteen chapters, challenges, twelve letters and the Order's gear. Solo or co-op online. Saves progress. |

## Story mode

Kestrel Isle is ruled by Magistrate Corvin Vale, and his Tollmen squeeze its villages dry. You are the newest member of
a hidden order that fights back from the shadows. The island is generated from a fixed seed: four villages, three
enforcer camps, Vale's walled keep on the central hill and the Order's ruined hideout, all joined by roads.
The land is desert: sand dunes, green fields by the water, palms, sandstone and mudbrick, with the sun casting
soft shadows and the sky turning at dusk. The ground is smooth, the buildings are blocks. Other modes keep their blocky look.

- **Campaign:** eighteen chapters, each started by talking to Old Wren at the hideout. Press **J** for the journal:
  chapters, challenges and the letters you have read.
  1. *The Quiet Order:* climbing, viewpoints, the leap of faith, your first takedown.
  2. *The Ledger:* tail the tax collector without being seen, then steal his ledger from a camp. He glances back
     now and then, and a meter over his head fills while he can see you. Walls, trees, hay and crowds hide you.
  3. *The Smith of Ironwood:* free Ida Marrow from her cage and escort her to safety. She then opens a shop at the
     hideout.
  4. *Iron for the Forge:* three crates of confiscated iron lie inside village houses. Haul them to Ida and light her forge.
  5. *Toll Roads:* take a toll ticket from each of the three camps' strongboxes (press E) and return them to Wren.
  6. *The Informant:* a bookkeeper in Mossford will talk, but only where nobody sees: hide in the hay and overhear two
     Tollmen without being noticed.
  7. *The Granary:* spoil the grain sacks in Harrowdale without raising the alarm.
  8. *The Prisoners:* pick the locks of the three camp cages. Each freed villager walks home along the roads, and any
     guard who sees them will cut them down.
  9. *The Captain:* assassinate Captain Brask Hollen as he inspects a camp with two bodyguards, then lose the pursuit.
  10. *The Pickpocket:* sneak up behind Quartermaster Pell in Saltreach and lift the key from his belt.
  11. *Vale's Answer:* three columns of Tollmen march on Brindle. Break them on the road, one at a time.
  12. *Bells of Ironwood:* climb the bell towers of three villages and ring them (E at the rope).
  13. *The Missing Pages:* a paper chase through bushes outside a camp and behind village houses, for the pages Fitch
      tore out of the ledger.
  14. *Night Watch:* light the three signal braziers on the keep's wall walk, then get clear.
  15. *Marksmen of the Keep:* take down the three musketeers on the walls before anyone goes in.
  16. *Rally the Villages:* four elders, four favours: a hidden elder, a beacon on a tower, a sergeant who has to go.
  17. *The Seal:* slip into Vale's hall and take the Magistrate's seal from his lockbox (faster with Pell's key). The
      forged order that follows calls the keep's wall and courtyard patrols away for good.
  18. *The Magistrate:* get inside Vale Keep and end it. Look for the skylight in the hall roof.

  Failing an objective (being spotted while tailing, losing someone you escort, dying) means **desynchronization**:
  you restart from the last checkpoint.
- **Climbing and parkour:** hold W and SPACE (or SHIFT) against any wall to climb it. Back + SPACE jumps off.
  Rooftops and towers connect the villages.
- **Viewpoints:** every village, the hideout and the keep have a watchtower. Climb it and press E to synchronize. This
  reveals the map around it and makes it a fast-travel point (M opens the map; click a gold eye). Walk off the wooden
  perch for a **leap of faith**: you are steered into the hay below, unhurt. Other long falls hurt.
- **Stealth:**
  - Guards have a view cone. A meter over their head fills as they notice you; a red "!" means they're attacking.
  - Inside a camp's palisade or the keep's walls you are trespassing, and anyone seen there is a target.
  - In villages and on roads you're one more face in the crowd. Climbing or running makes guards suspicious:
    they watch you and shout. They only attack if you turn violent or are notorious.
  - Walls, trees and hay block sight; glass and bars don't.
  - Sneak with C. Walk next to two villagers to blend in. Hay piles and bushes hide you completely; guards
    searching for you poke the hay.
  - Gunshots are heard far away, villagers scream when they see violence, and guards who find a body put the whole
    site on alert.
- **Healing:** go 5 seconds without taking damage and your health comes back by itself, as in the classic
  assassin games. Bandages and medkits from Ida's shop heal you in the middle of a fight.
- **Takedowns:** click with the wrist blade on someone who doesn't see it coming: they are unaware of you, you're
  behind them, they are choking on smoke, or they are winding up a sabre swing (a counter). It's a silent kill;
  otherwise it's just a stab. Falling onto a guard from above is an **air assassination**, and the guard breaks your
  fall. Guards take turns attacking; marksmen shoot from the towers.
- **Sword:** every member of the Order carries one. Click to cut: three strokes in a combo (right to left, back left
  to right, overhead), and the third hits hardest. Right mouse raises the sword to block, which takes most of the
  damage. Block just as a sabre comes down to **parry**: the guard staggers and one cut finishes him. Guards in a fight
  sometimes turn your cuts aside. Anyone who doesn't see it coming falls to a single cut, but unlike the wrist blade
  it isn't silent to anyone watching.
- **Gear (Tab):** the Order does not carry a block inventory. Five loadout slots (keys 1-5) hold your hidden blade, your
  sword, a ranged weapon, a throwable and a remedy. Outfit pieces (hood, cloak, bracers, boots) give attack, defense and
  stealth; wear them, buy them from Ida, upgrade them at her forge with silver and materials, or sell what you do not need.
  Gear taken from challenges is not for sale.
- **Challenges:** 37 optional goals across the campaign (silent takedowns, leaps, viewpoints, the twelve letters, unseen
  chapters, quiet bells, the informant, Pell's key, forging gear and more). They pay silver, and some pay a piece of gear.
- **Gear, arms and weapons:**
  - A hunting bow (from chapter I). Hold the left mouse button to draw and release to shoot. A full draw flies
    straight and kills; a quick shot is weaker. Arrows that hit the ground or a wall, or kill someone, can be picked
    up again by walking over them.
  - Smoke bombs: guards inside are stunned and blind, and nobody sees through the cloud.
  - Healing items.
  - A pistol, which is loud.
- **Restocking:** press E at a supply chest to refill your arrows, smoke bombs and rounds.
  - The Order's own chest stands next to Ida's table in the hideout. It is safe and refills after 20 seconds.
  - Every enforcer camp and the keep has an arms crate. It is dangerous to reach and empty for 2 minutes after you
    use it.
  - They are the brown boxes on the map and the minimap. When you are low on arrows or out of smoke, a crate marker on
    screen points to the nearest stocked one.
- **Camera:** Story mode plays over the shoulder (third person) so you can see your hooded assassin climb, sneak and
  leap. P switches between first and third person in any mode; aiming down sights always uses your own eyes. In first
  person you see your own forearms and hands (bracer, sleeve, fingers) holding whatever you carry. The setting is under
  SETTINGS > Story camera.
- **Notoriety:** 3 pips, top left. It rises when you start fights or kill innocents, and higher notoriety makes guards
  notice you faster, even in villages. Tear down the wanted posters in the villages (E) to lower it. It resets after
  each chapter.
- **Contracts:** the notice board in each village and at the hideout offers three jobs: an assassination, theft of a
  strongbox, rescue of a prisoner, or a timed letter delivery. They pay **silver**, which you spend at Ida's shop.
- **Co-op:** host a Story game from the ONLINE tab and friends join as fellow members of the Order. The objective,
  map, viewpoints, silver and notoriety are shared, and anyone can talk to Wren, take contracts or shop. Guards'
  meters are per player.
- **Saving:** progress (chapter, viewpoints, map, silver, the host's gear) is saved in the browser. To start over,
  choose *Start a new story* on the PLAY tab.

## Online (play with friends on other devices)

Needs an internet connection on every device. Up to 8 players.

1. **Host:** pick a mode on the PLAY tab (Solo vs Bots, Story, Free Build or Explore), open the **ONLINE** tab, type
   a name and press **HOST ONLINE GAME**. You get a 5-letter room code (also shown at the top of the screen).
2. **Friends:** open the game, ONLINE tab, type a name and the room code, press **JOIN GAME**.
3. **Solo vs Bots** starts in a lobby: everyone waits on the island and the host presses **Enter** to drop
   in. Players who join during a match watch until the next one; the host's PLAY AGAIN starts a new match
   for everyone. Story, Free Build and Explore have no lobby: friends appear as soon as they join.

Everyone needs **the same version** of the game files. Either send your friends the `blockfire` folder (zip
it), or upload it to any free static host (GitHub Pages, itch.io as an HTML game, Netlify) and share the link.
That also lets phones and tablets open it: they have touch controls (see *Touch* below).

How it works: the host's browser runs the game. Friends connect straight to it (WebRTC) after a free public
matchmaking server ([PeerJS](https://peerjs.com)) introduces them using the room code. No game data goes
through that server. If a friend can't connect, a strict network (some school or work Wi-Fi) is usually
blocking peer-to-peer traffic; try a phone hotspot. If the host leaves, the game ends for everyone.
Split-screen Duel is local only; hosting with it selected starts Solo vs Bots.

## Touch (phones and tablets)

Touch controls appear while you play on a touch screen (you can force them on a desktop with `?touch=1`):

- **Stick** (bottom left): move. Push it fully forward to sprint.
- **Drag anywhere else:** look. Settings > Touch look sets how fast.
- **FIRE** (big, bottom right): hold to shoot, mine, draw the bow or strike. **AIM**: aim down sights, block with the sword.
- **JUMP** (climb: push against a wall), **RELOAD**, **USE** (E), **CROUCH** (sneak), **NEXT** (next item).
- **GEAR**, **MAP** and **JOURNAL** in story, **FLY** in explore and free build, **BUILD** in free build, **INV** elsewhere (top left). **MENU** (top right) pauses.

Phones in portrait ask you to turn sideways. Graphics: on phones the game starts on *Medium*, and Settings > Graphics
(Low, Medium, High, Ultra) and *Auto resolution* keep the frame rate up.

## Controls

| Keyboard + mouse | Action | Gamepad |
|---|---|---|
| W A S D | move | left stick (click: sprint) |
| Mouse | look | right stick |
| Space | jump / swim up / handbrake | A |
| Shift | sprint / vehicle boost | left stick click |
| C | crouch / fly down | right stick click |
| Left mouse | shoot, mine, use a healing item, place a build piece | RT (driving: gas) |
| Right mouse | aim down sights, place a block, switch build material | LT (driving: brake) |
| R | reload | X |
| E | open chest, pick up weapon, enter/exit vehicle, use crafting table / furnace | Y |
| 1-9, wheel | hotbar (build mode: wheel cycles pieces) | LB / RB |
| Tab | inventory + 2x2 crafting (Q over a slot throws 1, Ctrl+Q the stack) | - |
| Q | build mode: Z wall, X floor, C ramp, V roof | B (RT build, LT material) |
| G | edit the wall you look at: click tiles, G to confirm (doors / windows) | d-pad up |
| T / hold B | box up / ramp rush | d-pad left / right |
| F | in a vehicle: switch seat; otherwise fly (Explore / Free Build) | d-pad down (seat) |
| N | skip 3 hours (Explore / Free Build) | - |
| W + Space (against a wall) | story: climb (back + Space jumps off) | left stick + A |
| C | story: sneak | right stick click |
| M | story: map and fast travel | - |
| P | first / third-person camera | - |
| Alt/Option + Enter | full screen on/off | - |
| F3 | debug panel | - |
| Esc | pause | Start |

## How it plays

- **World**: 16x16x64 chunks streamed around the players, seeded simplex noise, four biomes (grassland, desert,
  snow, forest) with trees, cacti, water, caves and iron/gold ore. Greedy meshing with ambient occlusion runs in
  Web Workers. Day/night cycle with fog. Battle maps are an island; everything beyond its edge is ocean.
- **Mining & crafting**: hold to mine (crack animation, hardness per block; stone needs a pickaxe, iron ore a
  stone pickaxe, gold ore an iron pickaxe). Drops are collected by walking over them. 2x2 crafting in the
  inventory, 3x3 at a crafting table, smelting in a furnace. Recipes:

  | Result | Recipe |
  |---|---|
  | 4 planks | 1 log |
  | 4 sticks | 2 planks stacked |
  | Crafting table | 2x2 planks |
  | Furnace | 8 stone in a ring |
  | 4 brick | 2x2 stone |
  | 3 build wood / 3 build stone / 4 build metal | 3 planks in a row / 3 stone in a row / 2x2 iron ingots |
  | Pickaxe / axe / shovel | planks, stone, iron or gold + sticks (classic shapes; axe mirrors) |
  | Ammo (light / medium / shells / heavy / rockets) | 1 iron / 2 iron / 3 iron / gold + iron / 2 gold + iron (any layout) |

  Furnace: ore or sand on top, fuel (logs, planks, sticks, wooden items) below -> ingots / glass.
- **Guns**: assault rifle, SMG, pistol, pump shotgun, sniper rifle (real bullet drop, scope), rocket launcher
  (splash damage, blows holes in terrain). Five rarities (common grey -> legendary gold) raise damage, fire rate,
  magazine and reload speed and tighten spread. Spread grows when moving, jumping and firing (bloom) and shrinks
  when aiming; recoil kicks the view. Headshots deal extra damage. Damage numbers, hit markers, kill feed.
  You can carry 5 weapons.
- **Health**: 100 HP + up to 100 shield. Shield absorbs first and only comes from Shield Tonics. Bandage Rolls heal
  to 75, Field Medkits to 100. The storm ignores shields.
- **Loot**: gold-trimmed chests (E) and floor loot glow with a beam in the item's rarity colour. Ammo, healing and
  materials are picked up automatically; weapons with E (swapping with the one in your hand when you carry 5).
- **Fast building**: walls, floors, ramps and roofs on a 4-block grid from wood (planks), stone or metal (iron
  ingots). Pieces start weak and build up to full HP (wood 150, stone 300, metal 450) and can be shot down.
  Edit walls into doors and windows. Ramp rush builds a staircase as you run; box up encloses you instantly.
- **Vehicles**: Runabout (4 seats), Streak GT sports car (2 seats, fast), Rockhopper 4x4 (tough, climbs better) and
  a Skiff boat. Arcade driving with drift, handbrake and boost, fuel (refill next to fuel barrels), crash damage,
  smash through leaves and glass, launch off ramps. Drivers can't shoot; passengers can. Vehicles explode at 0 HP.
- **Storm**: 5 phases; each waits, then shrinks the safe circle to a new one inside it. Damage per second outside
  rises every phase. The minimap shows the current storm and the next circle.
- **Bots**: loot, roam, heal, flee the storm, drive, build cover when shot and fight with imperfect, reaction-
  delayed aim. Easy / normal / hard change aim error, reaction time, turn speed, sight range and how often they build.

## Tuning

Every gameplay number is in `js/constants.js`: weapon stats and rarity multipliers, damage and hitboxes, loot
tables, build costs and HP, vehicle handling, storm phases, bot difficulty, crafting yields, player movement,
world generation parameters and more.

## Graphics

Settings > Graphics picks a preset (Low, Medium, High or Ultra: render distance, sharpness, how far story people are
drawn). The default, *Auto*, picks Epic or Ultra on a desktop graphics card (Radeon RX, GeForce RTX and the like), Medium on
phones and High elsewhere. Ultra draws the scene at 1.5x with 4x anti-aliasing and filters it down sharp, adds bloom,
sun rays and a film grade, a wider and finer shadow map, cumulus clouds and 12 chunks of view.
In story mode people stand in the land's light (its sun, its shadows); from High up they wear boots, bracers, pouches,
a scabbard and a quiver, and on Ultra and Epic their skin, cloth, hair and eyes use physical materials. Swords and the bow
are modelled in steel, bronze, brass, wood and leather.
*Epic* (the newest desktop cards: Radeon RX 6600 and up, GeForce RTX) adds ambient occlusion, distant shadows, the sea
mirroring the island, grass in the fields, 2x supersampling and 16 chunks of view.
*Auto resolution* sharpens or softens the picture to keep the frame rate up. Auto distance is separate.
On Medium and above, people are real human bodies (MakeHuman, see Originality) in garments made for them (the Order's
hooded coat, robes, kilts, cloaks, headcloths, collars, beards) that move with the body; Low keeps the lighter drawn
figures. The lobby's *Body* row picks a man or a woman. In story mode the stone has worn, bevelled edges instead of
cube corners, leaves grow as ivy and cloth hangs as awnings or lies as beds.

### The island, the challenges and the bots

Kestrel Isle is five times the size it was: the story's villages and camps lie further apart, and an outer ring of four
more villages and three more camps waits to be explored, with 120 relics hidden across it. The journal holds 370
challenges. Bots fight with a plan: they pick their target, use cover to reload and heal, hear gunfire and come at it
from the side; the island's guards surround you, wait for an opening, cut and step back.

## Project layout

```
index.html              page shell: menus, HUD template, styles, script order
three.min.js            local Three.js r149
docs/                   SPEC.md (the brief), ARCHITECTURE.md (design contract)
js/constants.js         all tunables
js/core/                seeded RNG, event bus, Game (fixed 60 Hz simulation, modes)
js/world/               block registry, World (chunks, streaming, edits, island preload), voxel raycast
js/worker/              Web Worker code: noise, terrain + island + chests, greedy mesher, message router
js/items/               items, inventory, mining rules, crafting recipes, furnace
js/combat/              weapons, damage + explosions, consumables, loot
js/build/               fast-building pieces, edit mode, ramp rush, box up
js/entities/            Entity, Character, interaction, item drops, projectiles, vehicles + fuel barrels
js/ai/                  bot brain (state machine, aiming, navigation, driving)
js/match/               storm, match flow (spawns, placements, results)
js/input/               keyboard/mouse, controllers -> Intents, gamepad, touch controls (touch.js)
js/render/              texture atlas, shaders, sky, icons, overlays, models, viewmodel, effects, build ghost, vehicles
js/ui/                  start screen and lobby stage (menu, lobby-stage), per-player HUDs, inventory and gear screens, PlayerView
js/audio/               Web Audio synthesiser
js/net/                 online play: transport (PeerJS / test bridge), wire protocol, NetHost, NetClient
js/story/               story mode: plan (sites), director, missions (+ missions-extra, missions-more: eighteen chapters) + contracts, challenges and letters, gear, NPC brains, stealth, blades + swords, smoke, posters
js/worker/sites.js      story mode: plans villages, camps, keep, hideout and roads from the seed and builds every block
vendor/peerjs.min.js    local copy of PeerJS 1.5.4 (WebRTC + room-code matchmaking)
js/ui/app-shell.js      full screen, Mac app bridge, installable web app (manifest + offline cache)
js/main.js              boot, modes, split-screen rendering, online host/join, frame loop
mac/                    the Mac app: BlockfireApp.swift (native window), build.sh, the icon (make-icons.js)
windows/                BLOCKFIRE.bat: opens the game in its own Edge or Chrome window
BLOCKFIRE.app           the built Mac app (made by mac/build.sh; not committed, see .gitignore)
icons/, manifest.webmanifest, sw.js   installable web app: icons, manifest, offline cache
tests/                  headless Chromium test suite (dev only)
```

The simulation only reads Intents (from keyboard/mouse, gamepad, bot or network controllers), uses a seeded
RNG, and reports side effects as events. Online play is built on that: see `docs/ARCHITECTURE.md` section 10.

## Tests (development only)

`node tests/run.js` runs the headless-browser tests for all 7 build stages, online play and story mode (see
`tests/README.md`). The online tests connect two browser pages through an in-process bridge, so they need no
internet.

## Debug URL parameters

`index.html?autostart=1&mode=battle&bots=5&difficulty=hard&seed=abc&rd=6` skips the menu.
Explore-mode extras: `&kit=1` (tools + materials), `&arena=1` (every gun + dummies + loot), `&dummies=4`,
`&vehicles=1`, `&up=20&pitch=-25&yaw=30` (start flying).
Online: `&host=1` hosts the chosen mode, `&join=ABCDE` joins a room, `&name=Sam` sets the player name.
Story: `?autostart=1&mode=story` (add `&seed=x` for a different island).
Camera: `&tp=1` / `&tp=0` forces third / first person.

## Originality

All names, characters, vehicles, weapons, textures and sounds in BLOCKFIRE are original and generated in code, except:

- **The people's bodies** (`js/assets/humans-data.js`): a man and a woman built with [MakeHuman](http://www.makehumancommunity.org)
  from its system assets (body, skins, eyes, brows, lashes, hair, a shirt with trousers, shoes), all released under
  **CC0** (public domain). `tools/humans/` rebuilds them; the game greys and tints the clothes; the robes, hoods, cloaks,
  kilts, collars and beards are the game's own, made for these bodies by `tools/humans/garments.py`.
- **`vendor/three/GLTFLoader.js` and `SkeletonUtils.js`**: from three.js r147 (MIT licence, like `three.min.js`).
