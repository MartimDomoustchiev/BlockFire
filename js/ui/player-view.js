/* ============================================================
 * PlayerView: everything one local player sees - a camera, a HUD
 * root (hotbar, combat, build, vehicle and match HUDs), a viewmodel,
 * the block outline / cracks and the build ghost. Split-screen uses
 * two of these side by side.
 *
 * Render layers keep private things private:
 *   0                    world, entities, effects
 *   1 + index            this player's outline / cracks / build ghost
 *   3 + index            this player's own body (hidden from their own camera
 *                        unless it is the third-person camera)
 *
 * Third person (P; on by default in Story mode): the camera sits
 * behind the right shoulder, pulled in when a wall is in the way, and
 * turns to look at the point the player's eyes aim at - so the
 * crosshair in the middle of the screen is still exactly where shots,
 * takedowns and E land. Aiming down sights switches back to the eyes.
 * ============================================================ */
const LAYER_PRIVATE = 1, LAYER_SELF = 3;

function setLayer(obj, layer) { obj.traverse((o) => o.layers.set(layer)); }

class PlayerView {
  constructor(index, hudRoot, { scene, atlas }) {
    this.index = index;
    this.root = hudRoot;
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(CONFIG.FOV, 1, 0.05, 300);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enableAll();
    for (let i = 0; i < 2; i++) if (i !== index) this.camera.layers.disable(LAYER_PRIVATE + i);
    this.camera.layers.disable(LAYER_SELF + index);
    this.hotbar = new HotbarHud(hudRoot);
    this.combat = new CombatHud(hudRoot);
    this.build = new BuildHud(hudRoot);
    this.vehicle = new VehicleHud(hudRoot);
    this.match = new MatchHud(hudRoot);
    this.storyHud = new StoryHud(hudRoot);
    this.viewmodel = new ViewModel(atlas);
    this.overlays = new BlockOverlays(scene);
    setLayer(this.overlays.outline, LAYER_PRIVATE + index);
    setLayer(this.overlays.crack, LAYER_PRIVATE + index);
    this.ghost = new BuildGhost(scene);
    setLayer(this.ghost.mesh, LAYER_PRIVATE + index);
    this.p2join = hudRoot.querySelector('.p2join');
    this.character = null;
    this.spectate = null;
    this.lastFov = 0;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this._t = new THREE.Vector3(); this._d = new THREE.Vector3(); this._a = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.tp = false;                        // drawing from the third-person camera this frame
  }

  /** Is the over-the-shoulder camera wanted for this player now? */
  wantsThirdPerson(game, p, settings) {
    const on = game.story ? settings.thirdPersonStory : settings.thirdPerson;
    return !!on && p.alive && !(p.adsT > 0.5);
  }

  /** Over-the-shoulder camera aimed at what the player's eyes aim at. */
  _thirdPerson(game, p, cam) {
    const T = CONFIG.THIRD_PERSON, w = game.world;
    const eye = p.eyePos(this._t), look = p.lookDir(this._d);
    const solid = { filter: (id) => BlockTables.solid[id] === 1 && BlockTables.opaque[id] === 1 };
    // the point the crosshair must sit on: the first block or character along the eyes' ray
    const hb = raycastBlocks(w, eye, look, T.AIM_RANGE, { filter: (id) => BlockTables.solid[id] === 1 });
    let aimDist = hb ? hb.dist : T.AIM_RANGE;
    const hc = Combat.rayCharacters(game, eye, look, aimDist, p);
    if (hc) aimDist = hc.dist;
    const aim = this._a.copy(eye).addScaledVector(look, Math.max(T.MIN_AIM, aimDist));
    // shoulder: to the right of (and a little above) the eyes, unless a wall is there
    const yaw = p.yaw, side = this._s.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const hs = raycastBlocks(w, eye, side, T.SIDE + 0.25, solid);
    const sideD = hs ? Math.max(0, hs.dist - 0.25) : T.SIDE;
    const shoulder = side.multiplyScalar(sideD).add(eye);
    shoulder.y += T.UP;
    // then back from the shoulder, pulled in when terrain blocks it
    const back = look.negate();
    const hk = raycastBlocks(w, shoulder, back, T.DIST + 0.3, solid);
    const d = hk ? Math.max(0.15, hk.dist - 0.3) : T.DIST;
    cam.position.copy(shoulder).addScaledVector(back, d);
    cam.lookAt(aim);
    return d;
  }

  attach(game, ch) {
    this.character = ch;
    this.spectate = null;
    this.combat.attach(game, ch);
    this.viewmodel.attach(game, ch);
    this.storyHud.attach(game, ch);
    this.hotbar.setLoadout(game.rules.story ? CONFIG.STORY.GEAR.LOADOUT.map((l) => l.short) : null);
  }

  detach() {
    this.character = null;
    this.overlays.update(null, 0);
    this.ghost.mesh.count = 0;
    this.setHudVisible(false, false);
  }

  setRect(x, y, w, h) {
    this.rect = { x, y, w, h };
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(this.camera.aspect);
  }

  setHudVisible(playing, match) {
    this.hotbar.setVisible(playing);
    this.combat.setVisible(playing);
    this.match.setVisible(playing, match);
    if (!playing) this.storyHud.setVisible(false);
    if (!playing) {
      this.combat.showCrosshair(false);
      this.build.root.style.display = 'none';
      this.build.mats.style.display = 'none';
      this.vehicle.root.style.display = 'none';
    }
  }

  /** Who to follow after elimination when there's no respawn. */
  pickSpectate(game) {
    const p = this.character;
    if (p.alive || !game.match || game.rules.respawn) return null;
    const k = p.lastDamagedBy;
    if (k && k.alive && k !== p) return k;
    if (this.spectate && this.spectate.alive) return this.spectate;
    return game.match.participants.find((c) => c.alive) || null;
  }

  /** Per-frame camera + HUD update. Returns the character whose eyes we use. */
  update(game, frameDt, { settings, playing, uiOpen, active, controller }) {
    const p = this.character, cam = this.camera;
    if (!p) return null;
    this.spectate = this.pickSpectate(game);
    const s = this.spectate;
    let tp = false;
    if (s) {
      const t = this._t.set(s.pos.x, s.pos.y + 1.8, s.pos.z);
      const d = s.lookDir(this._d).negate().setY(0.35).normalize();
      const hit = raycastBlocks(game.world, t, d, 5, { filter: (id) => BlockTables.opaque[id] === 1 });
      cam.position.copy(t).addScaledVector(d, hit ? Math.max(1, hit.dist - 0.3) : 5);
      cam.lookAt(t);
    } else if (p.vehicle && p.vehicleSeat === 'driver') {
      // chase camera orbiting the vehicle with the look direction; pulled in when terrain blocks it
      const C = CONFIG.VEHICLE.CAMERA;
      const t = this._t.set(p.vehicle.pos.x, p.vehicle.pos.y + C.HEIGHT, p.vehicle.pos.z);
      const d = p.lookDir(this._d).negate();
      const hit = raycastBlocks(game.world, t, d, C.DIST, { filter: (id) => BlockTables.opaque[id] === 1 });
      cam.position.copy(t).addScaledVector(d, hit ? Math.max(1.2, hit.dist - 0.3) : C.DIST);
      cam.lookAt(t);
    } else if (this.wantsThirdPerson(game, p, settings) && this._thirdPerson(game, p, cam) > CONFIG.THIRD_PERSON.NEAR_HIDE) {
      tp = true;
    } else {
      // first person (also when walls squeeze the shoulder camera right up against our head)
      cam.position.set(p.pos.x, p.eyeY, p.pos.z);
      cam.rotation.set(Math.min(Math.PI / 2 - 0.01, p.pitch + p.recoil), p.yaw, 0);
    }
    if (tp !== this.tp) {
      this.tp = tp;
      if (tp) cam.layers.enable(LAYER_SELF + this.index); else cam.layers.disable(LAYER_SELF + this.index);
    }
    // aim-down-sights zoom (and matching lower look sensitivity)
    const st = Weapons.of(p.heldStack());
    const zoom = st && !s ? 1 + (st.adsZoom - 1) * p.adsT : 1;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(settings.fov) / 2) / zoom));
    if (Math.abs(fov - this.lastFov) > 0.01) { cam.fov = this.lastFov = fov; cam.updateProjectionMatrix(); }
    if (controller) controller.lookScale = 1 / zoom;

    const building = p.build.active || !!p.build.edit;
    const showOutline = playing && p.alive && p.heldKind() !== 'weapon' && !building && !p.vehicle;
    this.overlays.update(showOutline ? p.target : null, p.mining ? p.mining.progress : 0);
    this.ghost.update(playing ? p : null, game);
    this.setHudVisible(playing, !!game.match || !!game.story);
    this.hotbar.update(p, frameDt);
    this.hotbar.root.classList.toggle('dim', building);
    this.hotbar.nameEl.classList.toggle('hide', building);
    this.combat.update(frameDt, cam, this.rect.h);
    this.combat.showCrosshair(playing && active && !uiOpen && p.alive && p.vehicleSeat !== 'driver' && !s);
    this.build.update(p, game, playing);
    this.vehicle.update(p, game);
    if (playing) this.match.update(game, p, s || p, cam);
    this.storyHud.update(game, p, cam, this.rect, playing);
    this.viewmodel.update(p, frameDt, !!(st && st.scope && p.adsT > 0.85) || building || !!s);
    if (this.tp || (p.vehicle && p.vehicleSeat === 'driver')) this.viewmodel.holder.visible = false;
    return s || p;
  }

  /** Draws this view into its rectangle (world, then the viewmodel on top). */
  /** Draws this view into its rectangle: on the canvas, or into the Ultra preset's scene image when `post` is given. */
  render(renderer, scene, post) {
    const r = this.rect;
    if (post) post.bindView(r);
    else {
      renderer.setViewport(r.x, r.y, r.w, r.h);
      renderer.setScissor(r.x, r.y, r.w, r.h);
    }
    renderer.render(scene, this.camera);
    if (this.character && !this.spectate && !this.tp) this.viewmodel.render(renderer);
  }
}
