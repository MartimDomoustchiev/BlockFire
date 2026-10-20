# BLOCKFIRE - product spec (original brief)

Build an offline 3D voxel PvP shooter as a self-contained project (HTML + JavaScript + Three.js with a local copy of three.min.js in the same folder, so it runs with no internet). Hybrid design: a block-based sandbox world with a fast-paced gun-and-vehicle arena shooter on top.

## ORIGINALITY RULE
Use original names, logos, characters, and art. Do not use any trademarked names, skins, or assets. All textures are procedurally generated on a canvas (simple pixel-style patterns). Working title: "BLOCKFIRE".

## CORE LOOP
Land on a procedurally generated voxel island, scavenge weapons and resources, break and place blocks to build cover and ramps, drive vehicles, and be the last player standing as a storm shrinks the map.

## MODES
1. Local split-screen duel (2 players): P1 keyboard + mouse, P2 gamepad (Gamepad API)
2. Solo vs bots (1-7 AI opponents)
3. Free build sandbox (no enemies, no storm)

## VOXEL WORLD (Minecraft-style)
- Infinite or large chunked world (16x16x64 chunks), generated with seeded simplex/perlin noise
- Biomes: grassland, desert, snow, forest, with trees, water, caves, and ores
- Block types: grass, dirt, stone, sand, wood, leaves, glass, brick, ore (iron/gold), water, plus a placeable "build wood/stone/metal" set
- Chunk meshing with face culling and greedy meshing; only visible faces rendered; chunk loading/unloading by distance
- Break blocks (hold to mine, with crack animation and different hardness per block), place blocks, block drops go into inventory
- Day/night cycle, simple ambient occlusion, fog

## CRAFTING AND INVENTORY (Minecraft-style)
- Hotbar (9 slots) + inventory grid, stackable items
- 2x2 and 3x3 crafting: planks, sticks, tools (pickaxe, axe, shovel with tiers), furnace (smelt ore into ingots), ammo crafting from ingots
- Resource gathering by chopping trees and mining stone/ore

## FAST BUILDING (Fortnite-style)
- Dedicated build mode key: place wall, floor, ramp, and roof pieces on a grid, snapped to the nearest cell, instantly (build speed matters)
- Pieces cost resources (wood/stone/metal) and have HP by material; they can be shot and destroyed
- Edit-mode: select tiles of a wall to cut a door/window
- Quick "ramp rush" and "box up" shortcuts for panic defense

## GUNS (Fortnite-style)
- Rarity tiers: common (grey), uncommon (green), rare (blue), epic (purple), legendary (gold); higher tier = more damage, faster fire rate, better spread, bigger magazine
- Weapon classes: assault rifle, pump shotgun, SMG, sniper (bullet drop + scope zoom), pistol, rocket launcher (splash damage that destroys blocks)
- Ammo types per class, reload animation, recoil, spread that grows while moving/firing, ADS (aim down sights), hitscan for most guns and projectile physics for rockets/snipers
- Headshot multiplier, damage numbers, hit markers, kill feed
- Weapons spawn in chests and floor loot with colored glow beams by rarity
- 5 inventory weapon slots + consumables (bandage, medkit, shield potion)

## HEALTH AND SHIELD
100 HP + 100 shield. Shield absorbs damage first and recharges only through consumables.

## VEHICLES (Fortnite-style)
- Drivable: car (4 seats), fast 2-seat sports car, off-road truck, and a boat for water
- Arcade driving physics (acceleration, steering, drift, handbrake, boost), cars take damage and explode when HP hits 0
- Drivers can't shoot; passengers can shoot from windows
- Car collides with and breaks weak blocks (leaves, glass); jumps and ramps work
- Fuel gauge, refuel at fuel stations/barrels

## STORM / MATCH RULES
- Shrinking circular storm in 5 phases dealing increasing damage per second
- Minimap with storm circle, compass, player markers
- Match ends when one player/team remains; show placement, kills, damage dealt, survival time
- Respawn disabled in battle mode; optional respawn timer in duel mode

## BOT AI
- Bots gather, build cover, loot, drive, and fight with state machine (loot, roam, engage, flee, flee-storm), three difficulty levels, line-of-sight checks and imperfect aim

## UI/UX
- Main menu (mode select, seed, difficulty, controls, settings: FOV, sensitivity, volume, render distance)
- HUD: health/shield bars, ammo, hotbar, build-material counts, minimap, kill feed, crosshair that changes with spread
- Pause menu, clean pixel/voxel visual style, 60 FPS target with dynamic render distance

## AUDIO
All sounds synthesized with the Web Audio API (gunshots per class, footsteps by block type, engine hum, block break/place, storm ambience, hit confirm).

## TECHNICAL REQUIREMENTS
- Modular code: world/chunks, meshing, physics/collision (AABB vs voxels), player controller, weapons, building system, vehicles, AI, networking-ready game state, UI, audio
- Web Workers for chunk generation/meshing to avoid frame drops
- Constants file for tweaking damage, fire rates, rarity multipliers, storm timings, build costs
- Comments on key systems; include a README with controls and run instructions

## BUILD ORDER
1. Voxel world, chunk meshing, first-person movement and collision  (DONE)
2. Break/place blocks, inventory, crafting  (DONE)
3. Weapons, rarity, loot, health/shield  (DONE)
4. Fast-building system  (DONE)
5. Vehicles  (DONE)
6. Storm, bots, match flow  (DONE)
7. Split-screen, menus, audio, polish  (DONE)
