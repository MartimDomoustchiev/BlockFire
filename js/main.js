/* ============================================================
 * Boot + main loop. Wires renderer, Game, local players (one or two
 * PlayerViews), menus, audio and the inventory screen.
 *
 * The simulation runs in fixed 1/60 s ticks via an accumulator
 * (at most CONFIG.MAX_CATCHUP_TICKS per frame); every view is drawn
 * once per animation frame after ticking. Split-screen draws two
 * views side by side with scissored viewports.
 *
 * Modes: battle (solo vs bots), duel (split-screen, P2 on a gamepad),
 * build (free build), sandbox (explore an infinite world).
 *
 * Debug URL params (handy for testing without a mouse):
 *   ?autostart=1   skip the menu and don't need pointer lock
 *   ?mode=battle|duel|build|sandbox  &bots=5  &difficulty=easy|normal|hard  ?seed=abc  ?rd=8
 *   ?up=20 &pitch=-25 &yaw=30   (sandbox) start flying 'up' blocks above the spawn
 *   ?kit=1  ?dummies=N  ?arena=1  ?vehicles=1   (sandbox) test kits, training dummies, vehicles
 *   ?host=1 / ?join=CODE  &name=Bob  &net=bridge   online host / join (bridge = test transport)
 * ============================================================ */
(function () {
  const params = new URLSearchParams(location.search);
  const AUTOSTART = params.has('autostart');

  const settings = loadSettings();
  AppShell.init();
  /** Starting a game from the menu (a click: browsers allow full screen then). */
  const gameStarting = () => { if (settings.startFullscreen) AppShell.toggleFullscreen(true); };
  if (params.has('seed')) settings.seed = params.get('seed');
  if (params.has('rd')) settings.renderDistance = Math.max(CONFIG.RENDER_DISTANCE.MIN, Math.min(CONFIG.RENDER_DISTANCE.MAX, +params.get('rd')));
  if (params.has('rd')) settings.dynamicRd = false;
  if (params.has('tp')) settings.thirdPersonStory = settings.thirdPerson = params.get('tp') === '1';
  if (AUTOSTART) settings.mode = params.get('mode') || 'sandbox';
  if (params.has('bots')) { settings.bots = +params.get('bots'); settings.duelBots = +params.get('bots'); }
  if (params.has('difficulty')) settings.difficulty = params.get('difficulty');

  const canvas = document.getElementById('gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });     // edges are smoothed by the pixel ratio (High renders at 1.5x)
  } catch (e) {
    document.getElementById('err').style.display = 'block';
    document.getElementById('err').textContent = 'WebGL is not available in this browser: ' + e.message;
    return;
  }
  // graphics quality: render distance and pixel ratio presets, and a resolution that adapts to the frame rate.
  // 'auto' (the default) stands for the preset that suits the graphics card: Ultra on a desktop card (render/post.js).
  const gpuName = GpuTier.name(renderer);
  CharShading.init(renderer);            // people's light in story mode: the sun's shadow, the land's tone, a sky to reflect
  const autoQuality = GpuTier.pick(gpuName, TouchUI.wanted());
  if (params.has('quality')) settings.quality = params.get('quality');
  const qualityName = () => (CONFIG.QUALITY[settings.quality] ? settings.quality : autoQuality);
  const preset = () => CONFIG.QUALITY[qualityName()];
  let post = null;                        // the Ultra preset's post-processing (render/post.js), made the first time it is needed
  // real people (render/humans.js): on every preset but Low, and not on software rendering (too slow to skin);
  // ?humans=1 / ?humans=0 decide for tests
  const softwareGpu = /swiftshader|llvmpipe|software/i.test(gpuName);
  const humansWanted = () => (params.has('humans') ? params.get('humans') === '1' : qualityName() !== 'low' && !softwareGpu);
  const dynRes = { scale: 1, slow: 0, fast: 0, ema: 16 };
  function basePixelRatio() { return Math.min(window.devicePixelRatio || 1, preset().pixelRatio); }
  function applyPixelRatio() {
    // with post-processing the canvas stays at the screen's resolution: the resolution scale applies to the scene image
    renderer.setPixelRatio(preset().post ? basePixelRatio() : Math.max(0.5, basePixelRatio() * dynRes.scale));
  }
  /** Anisotropic filtering on the story atlas (its shader keeps the mip level in step: render/story-materials.js). */
  function applyTextureQuality() {
    if (!storyMat) return;
    const a = Math.max(1, Math.min(preset().aniso || 1, renderer.capabilities.getMaxAnisotropy()));
    const tex = storyMat.shared.uAtlas.value;
    if (tex.anisotropy !== a) { tex.anisotropy = a; tex.needsUpdate = true; }
    storyMat.shared.uAniso.value = a;
  }
  /** A preset: the player picks it (render distance follows) or the page starts with it (distance kept as saved). */
  function applyQuality(start) {
    const p = preset();
    CONFIG.STORY.NPC_DRAW_DIST = p.npcDraw;
    if (p.post) { if (!post) post = new PostFX(renderer); post.configure(p.post); }
    sky.clouds = p.clouds || 0;
    dynRes.scale = 1;
    applyTextureQuality();
    HumanModels.setEnabled(humansWanted());
    HumanModels.setTier(p.post ? 2 : qualityName() === 'high' ? 1 : 0);      // Ultra / Epic: physical materials; High: fine relief
    if (HumanModels.enabled) HumanModels.load();
    if (startStage.model && startStage.model.gen !== HumanModels.generation) startStage.setLook(settings.look);
    if (game) game.world.setGrass(p.grass || 0);
    if (!start) {
      settings.renderDistance = p.rd; saveSettings(settings);
      const rd = document.getElementById('rd'); if (rd) { rd.value = p.rd; document.getElementById('rdVal').textContent = p.rd + ' ch'; }
      effectiveRd = p.rd; applyDistance();
    }
    applyPixelRatio(); layout();
  }
  /** Resolution scale: lower it while frames run long, raise it back when they are short. */
  function adaptResolution(dt) {
    const R = Object.assign({}, CONFIG.AUTO_RESOLUTION, preset().autoRes), ms = dt * 1000;
    dynRes.ema += (ms - dynRes.ema) * Math.min(1, dt * 2);
    if (!settings.autoResolution || state !== 'playing') { dynRes.slow = dynRes.fast = 0; return; }
    if (dynRes.ema > R.SLOW_MS) { dynRes.slow += dt; dynRes.fast = 0; } else if (dynRes.ema < R.FAST_MS) { dynRes.fast += dt; dynRes.slow = 0; } else dynRes.slow = dynRes.fast = 0;
    let changed = false;
    if (dynRes.slow > R.SLOW_TIME && dynRes.scale > R.MIN + 1e-6) { dynRes.scale = Math.max(R.MIN, dynRes.scale - R.STEP); dynRes.slow = 0; changed = true; }
    const top = R.MAX || 1;              // Ultra goes above 1 when frames are fast (a high refresh screen with time to spare)
    if (dynRes.fast > R.FAST_TIME && dynRes.scale < top - 1e-6) { dynRes.scale = Math.min(top, dynRes.scale + R.STEP); dynRes.fast = 0; changed = true; }
    if (changed) applyPixelRatio();
  }
  renderer.autoClear = false;            // each view clears its own rectangle; the viewmodel draws on top
  renderer.info.autoReset = false;       // count every pass in the debug panel
  const scene = new THREE.Scene();
  // the haze the terrain shaders fade into, for everything else (people, items, effects): what the land hides, hides
  // them too. setFog keeps it in step; markers you must see from afar (the storm, loot beams) opt out with fog: false.
  scene.fog = new THREE.Fog(0xffffff, 40, 100);

  const atlas = buildAtlasTexture();
  const materials = createChunkMaterials(atlas);
  let storyMat = null;                    // story mode draws its own lit landscape (render/story-materials.js), built the first time it is needed
  const materialsFor = (mode) => {
    if (mode !== 'story') return materials;
    if (!storyMat) { storyMat = createStoryMaterials(buildStoryAtlas()); applyTextureQuality(); }
    return storyMat;
  };
  const mats = () => (game && game.world ? game.world.materials : materials);       // the materials of the world being drawn
  let sunShadow = null;                   // story mode's sun shadows (render/shadow.js), sized by the quality preset
  const shadowSize = () => Math.min(preset().shadow || 0, renderer.capabilities.maxTextureSize);
  Icons.init(atlas.image);
  DropVisuals.init(atlas);
  const input = new Input(canvas);
  const kbm = new KeyboardMouseController(input, settings);
  const pad = new GamepadController(settings, 0);
  // touch controls (phones and tablets): the on-screen buttons feed the same Input object as the keyboard
  const touch = TouchUI.wanted() ? new TouchUI(input, settings, { pause: () => pauseFromTouch() }) : null;
  if (touch) { input.touch = true; document.body.classList.add('touch'); }
  const sky = new Sky(scene, new THREE.Object3D());
  const menu = new Menu(settings, onSettingChanged);
  const effects = new Effects(scene, atlas.image);
  const stormVisual = new StormVisual(scene);
  // the start screen: your character on the stage, in the look you chose, with the Order's sword at its side
  const startStage = new LobbyStage(renderer, document.getElementById('stageSlot'));
  window.__lobby = startStage;     // tests and debugging: the start screen's stage
  window.__refl = () => refl;     // debugging: the sea's reflection (its targets and mirrored camera)
  window.__post = () => post;     // debugging: the post-processing (its options, ao = 9 shows the occlusion alone)
  window.__gfx = () => ({ quality: qualityName(), auto: autoQuality, gpu: gpuName, post: !!(preset().post && post), ratio: post ? post.ratio : 0,
    pixelRatio: renderer.getPixelRatio(), shadow: sunShadow ? [sunShadow.size, sunShadow.extent] : null, clouds: sky.clouds });
  const autoOpt = document.querySelector('#quality option[value="auto"]');
  if (autoOpt) autoOpt.textContent = 'Auto - ' + autoQuality[0].toUpperCase() + autoQuality.slice(1) + ' for this graphics card';
  startStage.setLook(settings.look);
  startStage.setHeld(makeStack('longsword'));
  menu.lookChanged = (look) => startStage.setLook(look);
  HumanModels.onReady(() => startStage.setLook(settings.look));     // the real person replaces the drawn one on the stage
  /** Player 2 (the gamepad) wears a different accent and top so the two are easy to tell apart. */
  const p2Look = () => PLAYER_LOOK.normalize(Object.assign({}, settings.look, {
    accent: (settings.look.accent + 3) % LOOK_ACCENTS.length, top: (settings.look.top + 4) % LOOK_TOPS.length,
  }));

  // two HUD roots (the second is a clone of the first, shown in split-screen)
  const hudRoot1 = document.querySelector('.hud[data-player="0"]');
  const hudRoot2 = hudRoot1.cloneNode(true);
  hudRoot2.dataset.player = '1';
  hudRoot1.after(hudRoot2);
  const views = [new PlayerView(0, hudRoot1, { scene, atlas }), new PlayerView(1, hudRoot2, { scene, atlas })];
  let active = [views[0]];

  let game = null;
  let state = 'menu';            // menu | loading | playing
  let loadingSince = 0;          // when the loading screen went up (story waits a while for the real people)
  let spawnReady = false;
  let accumulator = 0;
  let resultsAt = Infinity, resultsShown = false;
  let fps = 0, frames = 0, fpsClock = performance.now(), debugClock = 0;
  let effectiveRd = settings.renderDistance, rdLow = 0, rdHigh = 0;
  // online play (js/net): role 'local' | 'host' | 'client'
  let net = null, netRole = 'local', roomCode = null, lobby = false, currentMode = null;

  const ui = new InventoryUI({ input, getGame: () => game });
  window.__ui = ui;              // tests
  // story mode screens (map, notice board, shop); choices run on the Story here, or go to the host online
  const storyAct = (a) => {
    if (!game || !game.story) return;
    if (netRole === 'client') { if (net) net.sendUi(Object.assign({ op: 'story' }, a)); }
    else game.story.act(game.player, a);
  };
  const screens = new StoryScreens({ input, getGame: () => game, getMap: () => ({ img: views[0].match.mapImg, R: views[0].match.mapR }), act: storyAct });
  window.__screens = screens;
  window.__views = views;        // tests
  const uiOpen = () => ui.isOpen || screens.isOpen;
  ui.canOpen = () => state === 'playing' && isActive() && game && game.player && game.player.alive && !game.player.vehicle && !screens.isOpen && !(game && game.story);

  // ---- settings ------------------------------------------------------
  function setFog(underwater) {
    const far = underwater ? 20 : effectiveRd * CONFIG.CHUNK_SIZE * CONFIG.FOG.FAR_FRACTION;
    const M = mats();
    M.shared.uFogFar.value = far;
    M.shared.uFogNear.value = underwater ? 0.5 : far * CONFIG.FOG.NEAR_FRACTION;
    scene.fog.color.copy(M.shared.uFogColor.value);
    scene.fog.near = M.shared.uFogNear.value;
    scene.fog.far = far;
  }
  /** Story mode: the sun's shadow map for this frame, centred on the first view; off when the preset has none. */
  let farShadow = null;                   // Epic: the wide second map for the far land
  function updateSunShadow(camera) {
    const M = mats(), size = shadowSize(), extent = preset().shadowExtent || 46;
    if (!M.story || !size) { if (M.shared.uShadowOn) M.shared.uShadowOn.value = 0; return; }
    if (!sunShadow || sunShadow.size !== size || sunShadow.extent !== extent) { if (sunShadow) sunShadow.dispose(); sunShadow = new SunShadow(size, extent); }
    sunShadow.bind(M.shared);
    sunShadow.render(renderer, scene, M.shared, camera, M.propDepth);
    const F = preset().shadowFar;
    if (!F) { if (farShadow) { farShadow.dispose(); farShadow = null; } M.shared.uShadow2On.value = 0; return; }
    if (!farShadow || farShadow.size !== F.size || farShadow.extent !== F.extent) { if (farShadow) farShadow.dispose(); farShadow = new SunShadow(F.size, F.extent, 2); }
    farShadow.bind(M.shared);
    farShadow.render(renderer, scene, M.shared, camera, M.propDepth);
  }
  // Epic: the sea mirrors the world. Each view draws the scene from its camera mirrored in the sea's surface (the water
  // itself hidden, everything under the surface clipped by an oblique near plane) into a smaller image the water shader
  // projects into (the same arrangement as three.js's Reflector)
  const WATER_SURFACE_DROP = 0.125;       // the sea's top faces sit this far under the block top (worker/mesher.js)
  const refl = { rts: [], cam: new THREE.PerspectiveCamera(), m: new THREE.Matrix4(), rot: new THREE.Matrix4(), n: new THREE.Vector3(0, 1, 0),
    p: new THREE.Vector3(), v: new THREE.Vector3(), t: new THREE.Vector3(), look: new THREE.Vector3(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4() };
  function renderReflection(v, i, underwater) {
    const M = mats(), k = preset().reflect, cam = v.camera;
    if (!M.story || !M.shared.uReflOn) return;
    const h = CONFIG.SEA_LEVEL + 1 - WATER_SURFACE_DROP;          // the sea's top blocks are at SEA_LEVEL
    M.shared.uReflOn.value = 0;
    if (!k || underwater || cam.position.y < h + 0.05) return;
    const pr = renderer.getPixelRatio(), W = Math.max(16, Math.round(v.rect.w * pr * k)), H = Math.max(16, Math.round(v.rect.h * pr * k));
    let rt = refl.rts[i];
    if (!rt) rt = refl.rts[i] = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    if (rt.width !== W || rt.height !== H) rt.setSize(W, H);
    const R = refl, rc = R.cam, n = R.n;
    R.p.set(0, h, 0);
    cam.updateMatrixWorld();
    R.v.setFromMatrixPosition(cam.matrixWorld);
    R.rot.extractRotation(cam.matrixWorld);
    R.look.set(0, 0, -1).applyMatrix4(R.rot).add(R.v);
    // the mirrored eye and the mirrored point it looks at
    rc.position.set(R.v.x, 2 * h - R.v.y, R.v.z);
    R.t.set(R.look.x, 2 * h - R.look.y, R.look.z);
    rc.up.set(0, 1, 0).applyMatrix4(R.rot).reflect(n);
    rc.lookAt(R.t);
    rc.near = cam.near; rc.far = cam.far; rc.layers.mask = cam.layers.mask;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    rc.matrixWorldInverse.copy(rc.matrixWorld).invert();
    M.shared.uReflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique near plane: nothing below the surface reaches the mirror (Eric Lengyel's projection trick)
    R.plane.setFromNormalAndCoplanarPoint(n, R.p).applyMatrix4(rc.matrixWorldInverse);
    R.clip.set(R.plane.normal.x, R.plane.normal.y, R.plane.normal.z, R.plane.constant);
    const e = rc.projectionMatrix.elements;
    R.q.set((Math.sign(R.clip.x) + e[8]) / e[0], (Math.sign(R.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    R.clip.multiplyScalar(2 / R.clip.dot(R.q));
    e[2] = R.clip.x; e[6] = R.clip.y; e[10] = R.clip.z + 1 - 0.003; e[14] = R.clip.w;
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();
    // draw it, without the water
    const prevTarget = renderer.getRenderTarget(), prevScissor = renderer.getScissorTest();
    const wasWater = M.water.visible, wasOcean = ocean ? ocean.visible : false;
    M.water.visible = false; if (ocean) ocean.visible = false;
    rt.viewport.set(0, 0, W, H); rt.scissorTest = false;
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(scene, rc);
    M.water.visible = wasWater; if (ocean) ocean.visible = wasOcean;
    renderer.setRenderTarget(prevTarget);
    renderer.setScissorTest(prevScissor);
    M.shared.uReflect.value = rt.texture; M.shared.uReflOn.value = refl.debug ? 2 : 1; M.shared.uReflH.value = h;
  }
  let ocean = null;                       // story: the sea out to the horizon (the story materials' `ocean`)
  const OCEAN_FAR = 1300;                 // story cameras see this far: the ocean fades into the haze before it ends
  /** Story mode: the far ocean under this view and a camera that reaches the horizon; the other modes end at the fog. */
  function updateOcean(camera, underwater) {
    const M = mats(), far = M.ocean ? OCEAN_FAR : effectiveRd * CONFIG.CHUNK_SIZE + 48;
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    if (!M.ocean) { if (ocean) ocean.visible = false; return; }
    if (!ocean) {
      ocean = new THREE.Mesh(new THREE.PlaneGeometry(2 * OCEAN_FAR, 2 * OCEAN_FAR).rotateX(-Math.PI / 2), M.ocean);
      ocean.frustumCulled = false;
      ocean.renderOrder = 0.5;            // under the chunks' water (renderOrder 1), which blends over it
      scene.add(ocean);
    }
    ocean.visible = !underwater;
    ocean.position.set(camera.position.x, CONFIG.SEA_LEVEL - 0.2, camera.position.z);
    M.ocean.uniforms.uCam.value.set(camera.position.x, camera.position.z);
  }
  function applyDistance() {
    for (const v of views) { v.camera.far = effectiveRd * CONFIG.CHUNK_SIZE + 48; v.camera.updateProjectionMatrix(); }
    if (game) game.world.setRenderDistance(effectiveRd);
  }
  function onSettingChanged(key) {
    if (key === 'quality') { applyQuality(false); return; }
    if (key === 'autoResolution') { dynRes.scale = 1; applyPixelRatio(); return; }
    if (key === 'renderDistance' || key === 'dynamicRd') { effectiveRd = settings.renderDistance; applyDistance(); }
    if (key === 'volume') Sound.setVolume(settings.volume);
  }
  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setSize(W, H, false);
    if (active.length === 2) {
      views[0].setRect(0, 0, Math.floor(W / 2), H);
      views[1].setRect(Math.floor(W / 2), 0, W - Math.floor(W / 2), H);
    } else views[0].setRect(0, 0, W, H);
    document.body.classList.toggle('split', active.length === 2);
  }
  window.addEventListener('resize', layout);
  layout(); applyDistance();
  Sound.setVolume(settings.volume);
  applyQuality(true);

  // ---- helpers for debug setups ----------------------------------------
  function giveKit(ch) {
    const kit = [['wood_pickaxe', 1], ['stone_pickaxe', 1], ['iron_pickaxe', 1], ['stone_axe', 1], ['stone_shovel', 1],
      ['log', 32], ['planks', 64], ['stone', 64], ['iron_ore', 8], ['gold_ore', 4], ['sand', 8],
      ['crafting_table', 1], ['furnace', 1], ['iron_ingot', 4], ['glass', 16], ['brick', 32]];
    for (const [id, n] of kit) ch.inventory.add(makeStack(id, n));
  }

  /** First free y above open ground at a column; null if unloaded, under a tree or in water. */
  function groundY(x, z) {
    for (let y = CONFIG.CHUNK_HEIGHT - 2; y > 0; y--) {
      const b = game.world.getBlock(x, y, z);
      if (b < 0) return null;
      if (b === BLOCK.LEAVES || b === BLOCK.WOOD || b === BLOCK.WATER) return null;
      if (BlockTables.solid[b]) return y + 1;
    }
    return null;
  }

  function spawnDummies(n) {
    const p = game.player;
    for (let i = 0; i < n; i++) {
      const ang = p.yaw + (i - (n - 1) / 2) * 0.35, dist = 9 + (i % 3) * 4;
      let x = 0, z = 0, y = null;
      for (let tries = 0; tries < 12 && y === null; tries++) {
        const dd = dist + tries * 1.5, aa = ang + (tries % 2 ? 0.15 : -0.15) * tries;
        x = Math.floor(p.pos.x - Math.sin(aa) * dd); z = Math.floor(p.pos.z - Math.cos(aa) * dd);
        y = groundY(x, z);
      }
      if (y === null) continue;
      const d = new Character({ name: 'Dummy ' + (i + 1), controller: new DummyController(i % 2 === 1, i), team: 0 });
      game.addEntity(d);
      d.teleport(x + 0.5, y, z + 0.5);
      d.yaw = p.yaw + Math.PI;
      d.home = new THREE.Vector3(x + 0.5, y, z + 0.5);
      d.respawnDelay = CONFIG.DUMMY.RESPAWN;
      if (i % 3 === 2) d.shield = 50;
    }
  }

  /** One of each vehicle near the player (boat at the closest water) plus fuel barrels. */
  function spawnVehicles() {
    const p = game.player, out = [];
    const place = (kind, ang, dist) => {
      for (let tries = 0; tries < 16; tries++) {
        const a = p.yaw + ang + tries * 0.4, d = dist + tries;
        const x = Math.floor(p.pos.x - Math.sin(a) * d), z = Math.floor(p.pos.z - Math.cos(a) * d);
        const y = groundY(x, z);
        if (y === null) continue;
        let flat = true;
        for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const yy = groundY(x + ox, z + oz); if (yy === null || Math.abs(yy - y) > 1) flat = false; }
        if (!flat) continue;
        const v = game.addEntity(new Vehicle(kind));
        v.pos.set(x + 0.5, y, z + 0.5); v.yaw = p.yaw + Math.PI / 2;
        out.push(v);
        return v;
      }
      return null;
    };
    place('car', 0.6, 7); place('sports', -0.6, 8); place('truck', Math.PI * 0.85, 9);
    const car = out[0];
    if (car) for (let i = 0; i < 2; i++) {
      const b = game.addEntity(new FuelBarrel());
      const y = groundY(Math.floor(car.pos.x + 3 + i), Math.floor(car.pos.z + 2)) ?? car.pos.y;
      b.pos.set(Math.floor(car.pos.x + 3 + i) + 0.5, y, Math.floor(car.pos.z + 2) + 0.5);
    }
    let best = null;
    for (let r = 4; r < 80 && !best; r += 2) {
      for (let k = 0; k < 24 && !best; k++) {
        const a = k / 24 * Math.PI * 2, x = Math.floor(p.pos.x + Math.cos(a) * r), z = Math.floor(p.pos.z + Math.sin(a) * r);
        const w = game.world;
        if (w.getBlock(x, CONFIG.SEA_LEVEL, z) === BLOCK.WATER && w.getBlock(x, CONFIG.SEA_LEVEL - 1, z) === BLOCK.WATER &&
            w.getBlock(x + 2, CONFIG.SEA_LEVEL, z) === BLOCK.WATER && w.getBlock(x - 2, CONFIG.SEA_LEVEL, z) === BLOCK.WATER) best = [x, z];
      }
    }
    if (best) { const b = game.addEntity(new Vehicle('boat')); b.pos.set(best[0] + 0.5, CONFIG.SEA_LEVEL + 1 - 0.15, best[1] + 0.5); }
  }

  function setupArena() {
    const p = game.player, inv = p.inventory;
    inv.clear();
    Object.keys(CONFIG.WEAPONS).slice(0, 5).forEach((cls, i) => inv.set(i, makeWeapon(cls, i)));
    inv.set(5, makeStack('bandage', 10)); inv.set(6, makeStack('medkit', 2)); inv.set(7, makeStack('shield_potion', 3));
    inv.set(8, makeStack('planks', 64));
    inv.add(makeStack('planks', 128)); inv.add(makeStack('stone', 96)); inv.add(makeStack('iron_ingot', 30));
    for (const id of Object.keys(CONFIG.LOOT.AMMO_WITH_WEAPON)) inv.add(makeStack(id, CONFIG.LOOT.AMMO_WITH_WEAPON[id] * 3));
    [['rocket', 4], ['sniper', 3], ['shotgun', 2], ['smg', 1], ['ar', 0]].forEach(([cls, r], i) => {
      const a = p.yaw + Math.PI + (i - 2) * 0.5, x = p.pos.x - Math.sin(a) * 3.5, z = p.pos.z - Math.cos(a) * 3.5;
      const y = groundY(Math.floor(x), Math.floor(z));
      if (y === null) return;
      const d = game.addEntity(new ItemDrop(makeWeapon(cls, r), x, y + 0.2, z));
      d.persistent = true;
    });
    spawnDummies(4);
  }

  /** Free build: a hotbar of building blocks that never run out. */
  function giveBuildKit(ch) {
    ['stone', 'brick', 'planks', 'glass', 'build_wood', 'build_stone', 'build_metal', 'log', 'sand'].forEach((id, i) => ch.inventory.set(i, makeStack(id, 64)));
    ch.inventory.add(makeStack('iron_pickaxe'));
    ch.inventory.add(makeWeapon('rocket', 4));
    ch.inventory.add(makeStack('ammo_rockets', 99));
  }

  /** A random dry spot on the island (online lobby / joiners), or the world spawn. */
  function spawnSpotFor() {
    if (game.rules.story) {
      const s = game.story ? game.story.respawnPoint() : new THREE.Vector3(0.5, CONFIG.CHUNK_HEIGHT - 2, 0.5);
      return { x: s.x + (Math.random() - 0.5) * 2, y: s.y, z: s.z + (Math.random() - 0.5) * 2 };
    }
    if (!game.rules.island) {
      const s = game.spawnPoint;
      return { x: s.x + (Math.random() - 0.5) * 3, y: s.y + 0.5, z: s.z + (Math.random() - 0.5) * 3 };
    }
    for (let i = 0; i < 200; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * CONFIG.ISLAND.RADIUS * 0.35;
      const x = Math.floor(Math.cos(a) * d), z = Math.floor(Math.sin(a) * d), y = groundY(x, z);
      if (y !== null) return { x: x + 0.5, y: y + 0.01, z: z + 0.5 };
    }
    return { x: 0.5, y: CONFIG.ISLAND.DROP_HEIGHT, z: 0.5 };
  }

  // ---- world lifecycle ----------------------------------------------
  function startWorld(modeOverride) {
    if (game) quitGame(true);
    menu.showError('');
    resultsAt = Infinity; resultsShown = false;
    lobby = false;
    // split-screen duel is local only: an online host plays it as solo vs bots
    const mode = modeOverride || (netRole === 'host' && settings.mode === 'duel' ? 'battle' : settings.mode);
    const raw = mode === 'story' ? (params.get('seed') || CONFIG.STORY.SEED) : settings.seed.trim();   // the story has its own island
    const seed = raw === '' ? (Math.random() * 0x7fffffff) | 0 : hashSeed(raw);
    currentMode = mode;
    effectiveRd = settings.renderDistance;
    game = new Game({ scene, materials: materialsFor(mode), seed, mode, renderDistance: effectiveRd });
    game.world.setGrass(preset().grass || 0);          // Epic: grass in the story's fields
    if (mode === 'duel') game.rules.respawn = settings.duelRespawn === 1;
    applyDistance();

    const p1 = new Character({ name: mode === 'duel' ? 'Player 1' : netRole === 'host' ? (settings.playerName || 'Host') : 'You', controller: kbm, isLocal: true, look: 'player', lookSpec: settings.look });
    p1.localIndex = 0;
    game.addEntity(p1);
    game.player = p1;
    const humans = [p1];
    active = [views[0]];
    if (mode === 'duel') {
      const p2 = new Character({ name: 'Player 2', controller: pad, isLocal: true, look: 'player', lookSpec: p2Look() });
      p2.localIndex = 1;
      game.addEntity(p2);
      game.player2 = p2;
      humans.push(p2);
      active = [views[0], views[1]];
    }
    layout();
    active.forEach((v, i) => v.attach(game, humans[i]));
    kbm.flush(); pad.flush();
    effects.attach(game, p1);
    Sound.attach(game, active.map((v) => ({ camera: v.camera, character: v.character })));
    game.events.on('openBlockUI', (e) => {
      if (e.character === game.player) ui.open(e.character, e.kind, { x: e.x, y: e.y, z: e.z });
    });
    hookStoryScreens(game);
    game.events.on('matchEnd', () => { resultsAt = Math.min(resultsAt, game.time + CONFIG.MATCH.END_DELAY); });
    game.events.on('kill', (e) => {
      // no respawn: the match is over for you once every local player has fallen
      if (!game.match || game.rules.respawn || !humans.includes(e.victim)) return;
      if (humans.every((h) => !h.alive)) resultsAt = Math.min(resultsAt, game.time + CONFIG.MATCH.END_DELAY);
    });
    spawnReady = false;
    accumulator = 0;
    state = 'loading';
    loadingSince = performance.now();
    window.__game = game;      // for console debugging and tests
    if (netRole === 'host') net.attach(game);
    if (game.rules.story) {
      // story: generate the whole island and ask the workers where its villages and camps are
      game.world.preload(game.islandRadius);
      for (const h of humans) h.teleport(0.5, CONFIG.CHUNK_HEIGHT - 2, 0.5);
      game.matchHumans = humans;
      const g = game;
      game.world.requestPlan((plan) => { g.storyPlan = plan; });
      spawnReady = true;
      return;
    }
    if (game.rules.island) {
      // island match: generate the whole island first, then everyone drops in
      game.world.preload(CONFIG.ISLAND.RADIUS);
      for (const h of humans) h.teleport(0.5, CONFIG.ISLAND.DROP_HEIGHT, 0.5);
      game.matchHumans = humans;
      spawnReady = true;
      return;
    }
    game.world.requestSpawn((s) => {
      p1.teleport(s.x, s.y + 0.01, s.z);
      game.spawnPoint.set(s.x, s.y + 0.01, s.z);
      if (mode === 'build') giveBuildKit(p1);
      if (params.has('up')) { p1.flying = true; p1.pos.y += +params.get('up'); }
      if (params.has('pitch')) p1.pitch = +params.get('pitch') * Math.PI / 180;
      if (params.has('yaw')) p1.yaw = +params.get('yaw') * Math.PI / 180;
      if (params.has('kit')) giveKit(p1);
      spawnReady = true;
    });
  }

  /** keepNet: replacing the game (play again / host restart) without leaving the online session. */
  function quitGame(keepNet) {
    if (!keepNet) leaveNet();
    ui.close(false);
    if (game) game.dispose();
    game = null;
    window.__game = null;
    for (const v of views) v.detach();
    Sound.stopLoops();
    stormVisual.update(null);
    document.body.classList.remove('match');
    views[0].match.hideResults();
  }

  function leaveNet() {
    if (net) net.close();
    net = null; netRole = 'local'; roomCode = null; lobby = false;
    ui.net = null;
    document.getElementById('netBadge').style.display = 'none';
    document.getElementById('lobby').style.display = 'none';
  }

  // ---- online: host -------------------------------------------------
  function hostGame(retry = 0) {
    Sound.init();
    if (game) quitGame();
    leaveNet();
    roomCode = makeRoomCode();
    const t = createTransport('host', roomCode);
    netRole = 'host';
    net = new NetHost(t, roomCode, { spawnSpot: () => spawnSpotFor(), giveBuildKit, peersChanged: () => {} });
    menu.netStatus('Opening room ' + roomCode + '...');
    t.onOpen(() => menu.netStatus('Room ' + roomCode + ' is open - share the code with your friends.'));
    t.onError((e) => {
      if (e === 'room-taken' && retry < 3) { hostGame(retry + 1); return; }
      menu.netStatus(e === 'room-taken' ? 'Could not open a room, try again.' : e);
    });
    startWorld();
    startHeartbeat();
    input.lock();
  }

  /** Host: everyone in the lobby drops into the match. */
  function startOnlineMatch() {
    if (!game || game.match || !lobby) return;
    lobby = false;
    game.match = new Match(game, { bots: Math.max(0, settings.bots), difficulty: settings.difficulty, respawn: false });
    const humans = [game.player].concat(net.remoteCharacters());
    game.match.start(humans);
  }

  // ---- online: join -------------------------------------------------
  function joinGame(code) {
    if (!code) { menu.netStatus('Enter the room code your friend gave you.'); return; }
    Sound.init();
    if (game) quitGame();
    leaveNet();
    roomCode = code;
    netRole = 'client';
    menu.netStatus('Connecting to room ' + code + '...');
    net = new NetClient(createTransport('client', code), settings.playerName || 'Player', {
      look: () => settings.look,
      welcome: (m) => startReplica(m),
      restart: () => { resultsShown = false; views[0].match.hideResults(); },
      results: (r, winner) => {
        resultsShown = true;
        input.unlock();
        views[0].match.showResults(Object.assign({}, r, winner && !r.won ? { title: winner.toUpperCase() + ' WINS' } : {}), game);
        const again = document.getElementById('btnAgain');
        if (again) { again.textContent = 'WAITING FOR HOST'; again.disabled = true; }
      },
      screen: (sc) => { if (game && game.player) ui.showRemote(game.player, sc); },
      closed: (reason) => {
        const r = reason;
        resultsShown = false;                       // the results screen goes with the host's game
        if (game) { quitGame(); state = 'menu'; active = [views[0]]; layout(); }
        leaveNet();
        menu.netStatus(r);
        input.unlock();
      },
      status: (s) => menu.netStatus(s),
    });
    ui.net = { send: (op) => net && net.sendUi(op) };
    startHeartbeat();
    input.lock();
  }

  /** Client: builds the local copy of the host's world. */
  function startReplica(m) {
    if (game) quitGame(true);
    resultsAt = Infinity; resultsShown = false;
    views[0].match.hideResults();
    effectiveRd = settings.renderDistance;
    game = new Game({ scene, materials: materialsFor(m.mode), seed: m.seed, mode: m.mode, renderDistance: effectiveRd, replica: true });
    game.world.setGrass(preset().grass || 0);          // Epic: grass in the story's fields
    game.rules.respawn = !!m.respawn;
    game._nextId = 1e9;
    game.timeOfDay = m.tod;
    applyDistance();
    const me = new Character({ name: settings.playerName || 'Player', controller: new RecordingController(kbm, (it) => net && net.queueIntent(it)), isLocal: true, look: 'player', lookSpec: settings.look });
    me.id = m.id;
    if (game.rules.story) me.look = 'order';      // the same uniform as the host's copy of this player (Story.addPlayer)
    me.netPredicted = true;
    me.localIndex = 0;
    game.addEntity(me);
    game.player = me;
    active = [views[0]];
    layout();
    views[0].attach(game, me);
    kbm.flush();
    effects.attach(game, me);
    Sound.attach(game, [{ camera: views[0].camera, character: me }]);
    state = 'loading';
    loadingSince = performance.now();
    spawnReady = true;
    accumulator = 0;
    window.__game = game;
    hookStoryScreens(game);
    if (game.rules.island) game.world.preload(game.islandRadius || CONFIG.ISLAND.RADIUS);
    if (game.rules.story) {
      // the same island from the same seed: our own workers know where everything is
      const g = game;
      game.world.requestPlan((plan) => {
        if (game !== g || !plan) return;
        new StoryMirror(g, plan);
        if (net && net.pendingSty) g.story.apply(net.pendingSty);
      });
    }
    document.body.classList.toggle('match', !!game.rules.island);
    menu.netStatus('Joined room ' + roomCode + '.');
    return { game, me };
  }

  /** Story screens open when the story asks for one for this machine's player. */
  function hookStoryScreens(g) {
    g.events.on('storyScreen', (e) => { if (e.character && e.character === g.player && !uiOpen()) screens.open(e.screen, e); });
  }

  /** The MENU button on touch screens: pause (the same as Esc, which needs a keyboard). */
  function pauseFromTouch() {
    if (game && state === 'playing' && !uiOpen() && !resultsShown) input.unlock();
  }

  function quitToMenu() {
    quitGame();
    state = 'menu';
    resultsShown = false;
    active = [views[0]];
    layout();
  }

  function showResults() {
    resultsShown = true;
    input.unlock();
    const m = game.match;
    if (game.player2) {
      const r1 = m.results(game.player), r2 = m.results(game.player2), w = m.winner;
      const title = w === game.player ? 'PLAYER 1 WINS' : w === game.player2 ? 'PLAYER 2 WINS' : w ? w.name.toUpperCase() + ' WINS' : 'DRAW';
      views[0].match.showResults(Object.assign({}, r1, { title, versus: r2 }), game);
    } else views[0].match.showResults(m.results(game.player), game);
  }

  // ---- UI wiring -----------------------------------------------------
  function isActive() { return !!game && (input.locked || AUTOSTART); }

  menu.el.play.addEventListener('click', () => {
    Sound.init();
    gameStarting();
    const fresh = document.getElementById('storyNew');
    if (settings.mode === 'story' && fresh && fresh.value === '1') { Story.clearSave(); fresh.value = '0'; menu.syncStorySave(); }
    if (netRole === 'client') { quitGame(); menu.netStatus(''); }     // leaves the friend's room
    startWorld();
    input.lock();
  });
  menu.el.resume.addEventListener('click', () => { Sound.init(); input.lock(); });
  // drag (or use the wheel) over the stage to turn and zoom the lobby character
  const overlayEl = document.getElementById('overlay'), stageEl = document.getElementById('stageSlot');
  let stageDrag = null;
  overlayEl.addEventListener('pointerdown', (e) => { if (e.target === overlayEl || e.target === stageEl) stageDrag = { x: e.clientX }; });
  window.addEventListener('pointermove', (e) => { if (stageDrag) { startStage.nudge((e.clientX - stageDrag.x) * 0.012, 0); stageDrag.x = e.clientX; } });
  window.addEventListener('pointerup', () => { stageDrag = null; });
  overlayEl.addEventListener('wheel', (e) => { if (e.target === overlayEl || e.target === stageEl) startStage.nudge(0, e.deltaY); }, { passive: true });
  menu.el.quit.addEventListener('click', () => quitToMenu());
  menu.onHost = () => { gameStarting(); hostGame(); };
  menu.onJoin = (code) => { gameStarting(); joinGame(code); };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && netRole === 'host' && lobby && state === 'playing' && !ui.isOpen && !e.altKey && !e.ctrlKey && !e.metaKey && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) startOnlineMatch();
    if (e.code === 'KeyM' && !e.defaultPrevented && game && game.story && state === 'playing' && !uiOpen() && isActive() && game.player.alive) { e.preventDefault(); screens.open('map'); }
    // story: J opens the journal (chapters, challenges, letters)
    if (e.code === 'KeyJ' && !e.repeat && game && game.story && state === 'playing' && !uiOpen() && isActive()) { e.preventDefault(); screens.open('journal'); }
    // story: Tab opens the Order's gear (the block inventory is not used in story)
    if (e.code === 'Tab' && !e.repeat && game && game.story && state === 'playing' && !uiOpen() && isActive() && game.player.alive) { e.preventDefault(); screens.open('gear'); }
    if (e.code === 'KeyP' && !e.repeat && game && state === 'playing' && !uiOpen() && isActive() && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) {
      // first / third-person camera (remembered separately for Story mode and the rest)
      const k = game.story ? 'thirdPersonStory' : 'thirdPerson';
      settings[k] = !settings[k];
      saveSettings(settings);
      if (menu.el.thirdPersonStory) menu.el.thirdPersonStory.checked = settings.thirdPersonStory;
    }
  });
  canvas.addEventListener('click', () => { if (game && state !== 'menu' && !uiOpen() && !resultsShown) { Sound.init(); input.lock(); } });
  window.addEventListener('keydown', (e) => { if (e.code === 'F3') menu.toggleDebug(); });
  for (const v of views) {
    v.match.onPlayAgain = () => {
      if (netRole === 'client') return;                          // only the host can restart an online game
      Sound.init(); startWorld(netRole === 'host' ? currentMode : undefined); input.lock();
    };
    v.match.onMenu = () => quitToMenu();
  }

  // ---- dynamic render distance ---------------------------------------
  function adaptDistance(dt) {
    if (!settings.dynamicRd || !game || state !== 'playing') return;
    if (fps && fps < 45) { rdLow += dt; rdHigh = 0; } else if (fps >= 57) { rdHigh += dt; rdLow = 0; } else { rdLow = rdHigh = 0; }
    if (rdLow > 2 && effectiveRd > Math.max(CONFIG.RENDER_DISTANCE.MIN, 4)) { effectiveRd--; rdLow = 0; applyDistance(); }
    if (rdHigh > 6 && effectiveRd < settings.renderDistance) { effectiveRd++; rdHigh = 0; applyDistance(); }
  }

  // ---- main loop -----------------------------------------------------
  const STEP = 1 / CONFIG.SIM_HZ;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const frameDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    lastFrameAt = performance.now();
    if (net) net.keepAlive();

    pad.poll();
    if (pad.takeStart() && game && state === 'playing' && !resultsShown) {
      if (input.locked) input.unlock(); else input.lock();
    }
    const act = isActive();
    const online = netRole !== 'local';
    if (touch) {
      touch.setVisible(state === 'playing' && act && !uiOpen() && !resultsShown && !!game && !game.paused);
      touch.setMode(game ? (game.rules.story ? 'story' : game.mode === 'build' ? 'build' : game.mode === 'sandbox' ? 'sandbox' : 'arena') : 'arena');
    }
    document.body.classList.toggle('playing', !!game && state === 'playing' && act);
    kbm.enabled = act && !uiOpen();
    menu.showOverlay(!act && !uiOpen() && !resultsShown && state !== 'loading', !!game);
    const islandLoad = game && game.rules.island && state === 'loading';
    menu.showLoading(state === 'loading', islandLoad ? 'GENERATING ISLAND' : 'GENERATING WORLD', islandLoad ? game.world.preloadProgress() : 0);
    // online games never pause: the world keeps going for everyone else
    const playing = state === 'playing' && (act || uiOpen() || online);
    for (const v of views) if (!active.includes(v) || !game) v.setHudVisible(false, false);

    if (!game) startStage.update(frameDt);
    if (game) {
      // stream chunks around what each view shows (the player, or who they spectate)
      const eyes = active.map((v) => v.spectate || v.character).filter(Boolean);
      game.world.update(spawnReady ? eyes.map((h) => h.pos) : [{ x: 0, z: 0 }], remoteEyes());
      if (game.world.error) menu.showError(game.world.error);

      if (state === 'loading' && netRole === 'client') {
        const ready = net && net.tpAck > 0 && (game.rules.island ? game.world.preloadProgress() >= 1
          : game.world.isAreaMeshed(Math.floor(game.player.pos.x / 16), Math.floor(game.player.pos.z / 16), 1));
        if (ready) {
          if (game.rules.island) { views[0].match.buildMap(game, effects.tileColors); }
          state = 'playing';
          kbm.flush();
          input.takeFrame();
        }
      } else if (state === 'loading' && game.rules.story) {
        // story: island generated + plan known -> players to the hideout; play once it's meshed around them
        if (!game.story && game.storyPlan && game.world.preloadProgress() >= 1) {
          new Story(game, game.storyPlan);
          game.story.start(game.matchHumans.concat(netRole === 'host' && net ? net.remoteCharacters() : []));
          views[0].match.buildMap(game, effects.tileColors);
          document.body.classList.add('match');
        } else if (game.story && (!HumanModels.pending() || performance.now() - loadingSince > 20000) && game.world.isAreaMeshed(Math.floor(game.player.pos.x / 16), Math.floor(game.player.pos.z / 16), 2)) {
          state = 'playing';
          kbm.flush();
          input.takeFrame();
        }
      } else if (state === 'loading' && netRole === 'host' && game.rules.island && game.world.preloadProgress() >= 1) {
        // online battle: wait in a lobby on the island until the host starts the match
        views[0].match.buildMap(game, effects.tileColors);
        const s = spawnSpotFor();
        game.player.teleport(s.x, s.y, s.z);
        for (const c of net.remoteCharacters()) { const t = spawnSpotFor(); c.teleport(t.x, t.y, t.z); }
        lobby = true;
        document.body.classList.add('match');
        state = 'playing';
        kbm.flush();
        input.takeFrame();
      } else if (state === 'loading' && game.rules.island && game.world.preloadProgress() >= 1) {
        views[0].match.buildMap(game, effects.tileColors);
        views[1].match.mapImg = views[0].match.mapImg;
        views[1].match.mapR = views[0].match.mapR;
        const duel = game.mode === 'duel';
        game.match = new Match(game, {
          bots: duel ? settings.duelBots : Math.max(1, settings.bots), difficulty: settings.difficulty,
          respawn: game.rules.respawn, killTarget: duel && game.rules.respawn ? 5 : 0,
        });
        game.match.start(game.matchHumans);
        document.body.classList.add('match');
        state = 'playing';
        kbm.flush(); pad.flush();
        input.takeFrame();
      } else if (state === 'loading' && !game.rules.island && spawnReady &&
          game.world.isAreaMeshed(Math.floor(game.player.pos.x / 16), Math.floor(game.player.pos.z / 16), 2)) {
        state = 'playing';
        kbm.flush();
        input.takeFrame();
        if (game.mode === 'sandbox') {
          if (params.has('arena')) setupArena();
          else if (params.has('dummies')) spawnDummies(Math.min(12, +params.get('dummies') || 3));
          if (params.has('vehicles')) spawnVehicles();
        }
      }
      if (playing && !game.paused) {          // game.paused: tests step the sim by hand
        if (act || uiOpen()) kbm.poll(); else input.takeFrame();
        accumulator += frameDt;
        let n = 0;
        while (accumulator >= STEP && n < CONFIG.MAX_CATCHUP_TICKS) { game.tick(STEP); accumulator -= STEP; n++; }
        if (n === CONFIG.MAX_CATCHUP_TICKS) accumulator = 0;          // too slow: drop time instead of spiralling
      } else {
        input.takeFrame();                                             // ignore input while paused/loading
        pad.flush();
      }
      game.lightColor = mats().shared.uLight.value;
      game.render(frameDt);
      for (const v of active) {
        v.update(game, frameDt, {
          settings, playing: state === 'playing', uiOpen: uiOpen() && v.index === 0, active: act,
          controller: v.index === 0 ? kbm : pad,
        });
      }
      if (active[1]) {
        views[1].p2join.style.display = pad.connected ? 'none' : 'block';
        if (!pad.connected) views[1].p2join.textContent = 'Player 2: connect a gamepad and press any button';
      }
      if (net && state !== 'loading') net.update(frameDt);
      updateNetUi();
      ui.update();
      screens.update();
      stormVisual.update(game);
      if (!resultsShown && game.match && game.time >= resultsAt) showResults();
      adaptDistance(frameDt);
    adaptResolution(frameDt);
      Sound.update(frameDt, game);
    }

    // ---- draw every active view ----
    const light = mats().shared.uLight.value;
    DropVisuals.tint(light);
    effects.update(frameDt, views[0].camera, light);
    if (game) CharacterModel.setLight(game, light, mats().story ? mats().shared : null);
    CharShading.sync(game && mats().story ? mats().shared : null, HumanModels.tier >= 1);
    renderer.info.reset();
    if (!game) {
      // no game running: the start screen's stage
      startStage.render(window.innerWidth, window.innerHeight);
    } else {
    // Ultra: every view draws into the post-processing image, which is finished onto the canvas below
    const pp = preset().post ? post : null;
    sky.skyMask = pp ? 1 : 0;
    if (pp) pp.begin(window.innerWidth, window.innerHeight, Math.max(renderer.getPixelRatio(), preset().post.ssaa) * dynRes.scale);
    else {
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.setScissorTest(true);
    }
    for (const v of active) {
      const eyes = v.spectate || v.character;
      const underwater = !!game && !!eyes && eyes.headInWater && state === 'playing' && !v.spectate;
      setFog(underwater);
      sky.camera = v.camera;
      if (mats().shared.uTime) mats().shared.uTime.value = now / 1000;
      updateOcean(v.camera, underwater);          // first: the sky dome is sized from the camera's reach
      sky.update(game ? game.timeOfDay : CONFIG.TIME.START, mats().shared, underwater);
      if (v === active[0]) updateSunShadow(v.camera);
      renderReflection(v, active.indexOf(v), underwater);
      v.viewmodel.light.copy(mats().shared.uLight.value);
      v.render(renderer, scene, pp);
    }
    if (pp) pp.end(window.innerWidth, window.innerHeight, active, sky.sunForRays(), !!mats().story);
    else renderer.setScissorTest(false);
    }

    frames++;
    if (now - fpsClock >= 500) { fps = Math.round(frames * 1000 / (now - fpsClock)); frames = 0; fpsClock = now; }
    if (now - debugClock > 250) { debugClock = now; updateDebug(); }
  }

  /** Room badge + battle lobby panel. */
  function updateNetUi() {
    const badge = document.getElementById('netBadge'), lob = document.getElementById('lobby');
    if (!net || !game) { badge.style.display = 'none'; lob.style.display = 'none'; return; }
    badge.style.display = 'block';
    badge.textContent = netRole === 'host'
      ? 'ONLINE  -  ROOM ' + roomCode + '  -  ' + net.playerCount() + ' PLAYER' + (net.playerCount() > 1 ? 'S' : '')
      : 'ONLINE  -  ROOM ' + roomCode + '  -  ' + Math.round(net.rtt * 1000) + ' ms';
    const inLobby = netRole === 'host' ? lobby : !!(game.match && game.match.lobby);
    lob.style.display = inLobby && state === 'playing' ? 'block' : 'none';
    if (!inLobby) return;
    const names = netRole === 'host' ? [game.player.name + ' (host)'].concat(net.names()) : game.match.lobby;
    lob.innerHTML = '<h3>WAITING ROOM</h3><div class="code">' + esc(roomCode) + '</div>' +
      '<div class="who">' + names.map(esc).join(' &middot; ') + '</div>' +
      '<div class="go">' + (netRole === 'host' ? 'Press ENTER to start the match (' + Math.max(0, settings.bots) + ' bots)' : 'Waiting for the host to start the match...') + '</div>';
  }

  function updateDebug() {
    const info = renderer.info.render;
    let txt = 'BLOCKFIRE\n' + fps + ' FPS   draw calls ' + info.calls + '   tris ' + info.triangles + '   rd ' + effectiveRd +
      '\ngraphics ' + qualityName() + (settings.quality === 'auto' ? ' (auto)' : '') + '   scale ' + dynRes.scale.toFixed(2) + '   gpu ' + (gpuName || '?');
    if (game) {
      const p = game.player, st = game.world.stats();
      txt += '\nmode ' + game.mode + '   xyz ' + p.pos.x.toFixed(1) + ' ' + p.pos.y.toFixed(1) + ' ' + p.pos.z.toFixed(1) +
             '   chunk ' + Math.floor(p.pos.x / 16) + ',' + Math.floor(p.pos.z / 16);
      txt += '\nchunks ' + st.loaded + '  meshed ' + st.meshed + '  queue ' + st.queued + '  dirty ' + st.dirty + '  stashed ' + st.stashed;
      txt += '\nentities ' + game.entities.size + '   time ' + (game.timeOfDay * 24).toFixed(1) + 'h   ' +
             (p.flying ? 'FLYING' : p.gliding ? 'gliding' : p.inWater ? 'swimming' : p.onGround ? 'ground' : 'air') +
             (game.player2 ? '   pad ' + (pad.connected ? 'connected' : 'none') : '');
      if (p.target) {
        const def = BLOCK_DEFS[p.target.block];
        txt += '\ntarget ' + (def ? def.name : p.target.block) + ' @ ' + p.target.x + ',' + p.target.y + ',' + p.target.z;
        if (p.mining) txt += '  ' + Math.round(p.mining.progress * 100) + '%';
      }
    }
    menu.setDebugText(txt);
  }

  /** Online host: the simulation needs terrain around every friend, wherever they wander. */
  function remoteEyes() {
    return netRole === 'host' && net ? net.remoteCharacters().filter((c) => c.alive).map((c) => c.pos) : [];
  }

  // ---- online play in a background tab --------------------------------
  // Browsers stop requestAnimationFrame in hidden tabs. A worker timer (workers aren't
  // throttled like page timers) keeps the keep-alive pings going on both sides, and on the
  // host keeps the simulation and the snapshots running so the game doesn't freeze for
  // every friend while the host looks at another tab.
  let lastFrameAt = performance.now();
  let heartbeat = null;

  function startHeartbeat() {
    if (heartbeat) return;
    try {
      const src = 'setInterval(function () { postMessage(0); }, 50);';
      heartbeat = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      heartbeat.onmessage = () => {
        if (!net) return;
        net.keepAlive();
        if (netRole === 'host' && game && net && performance.now() - lastFrameAt > 250) backgroundStep();
      };
    } catch (e) { /* no workers: the frame loop does the keep-alive, and the game waits while the host's tab is hidden */ }
  }

  function backgroundStep() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const eyes = active.map((v) => v.spectate || v.character).filter(Boolean);
    game.world.update(spawnReady ? eyes.map((h) => h.pos) : [{ x: 0, z: 0 }], remoteEyes());
    if (state !== 'playing' || game.paused) return;
    input.takeFrame();
    accumulator += dt;
    let n = 0;
    while (accumulator >= STEP && n < CONFIG.MAX_CATCHUP_TICKS) { game.tick(STEP); accumulator -= STEP; n++; }
    if (n === CONFIG.MAX_CATCHUP_TICKS) accumulator = 0;
    net.update(dt);
  }

  if (AUTOSTART) {
    if (params.has('name')) settings.playerName = params.get('name');
    if (params.has('host')) hostGame();
    else if (params.has('join')) joinGame(normalizeRoomCode(params.get('join')));
    else startWorld();
  }
  requestAnimationFrame(frame);
})();
