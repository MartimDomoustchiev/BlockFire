/* ============================================================
 * The lobby stage: the 3D picture behind the start screen. Your
 * character stands on a plinth in front of the Order's banners, with
 * torches, embers and the town's roofs far behind. It is its own
 * scene, drawn with the game's renderer while no game is running.
 *
 * The camera frames the figure into the free area of the menu (the
 * element `slotEl`), so the panels never hide it. Drag or use the
 * wheel over that area to turn and zoom. The character holds the
 * weapon of the mode you have picked (the Order's sword in Story).
 * ============================================================ */
class LobbyStage {
  constructor(renderer, slotEl) {
    this.renderer = renderer;
    this.slotEl = slotEl;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1a26);
    this.scene.fog = new THREE.Fog(0x5a3f3a, 24, 70);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 150);
    this.t = 0;
    this.turn = 0;              // player-dragged yaw offset (radians)
    this.zoomK = 1;             // 1 = default distance; the wheel changes it
    this.spin = 0;              // slow idle sway
    this.embers = null;
    CharacterLights.install(this.scene);
    this._buildSet();
    this.actor = {
      id: 7, team: 0, look: 'player', lookSpec: PLAYER_LOOK.DEFAULT, held: null,
      pos: new THREE.Vector3(0, 0.22, 0), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
      onGround: true, inWater: false, sneaking: false, climbing: false, leap: null, gliding: false, vehicle: null,
      alive: true, corpse: false, draw: 0, reload: null, blocking: false, combo: 0, strikeUntil: 0, lastDamageTime: -99,
      game: null, heldStack: () => this.actor.held,
    };
    this.model = null;
    this.setLook(PLAYER_LOOK.DEFAULT);
  }

  /** Dresses the figure in a look (validated first). */
  setLook(spec) {
    this.actor.lookSpec = PLAYER_LOOK.normalize(spec);
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    this.model = new CharacterModel(this.actor, this.scene);
    this.scene.add(this.model.root);
  }

  /** The item in hand: a stack like the inventory's, or null. */
  setHeld(stack) { this.actor.held = stack || null; }

  /**
   * Scenery: a temple court at dusk. A sandstone floor with an inlaid ring around the plinth, columns, the Order's
   * banners, two bronze braziers, obelisks and pyramids far off against a warm sky, and embers.
   */
  _buildSet() {
    const S = this.scene;
    const add = (geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, this._lit(color)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); S.add(m); return m;
    };
    add(new THREE.CylinderGeometry(9, 9, 0.4, 72), 0x9c8263, 0, -0.2, 0);             // the court's floor
    add(new THREE.CylinderGeometry(3.3, 3.3, 0.02, 64), 0x6e5a44, 0, 0.005, 0);       // an inlaid ring of darker stone
    add(new THREE.CylinderGeometry(3.05, 3.05, 0.03, 64), 0xa48a69, 0, 0.01, 0);
    add(new THREE.CylinderGeometry(1.25, 1.4, 0.2, 48), 0xc2aa86, 0, 0.1, 0);        // the plinth the figure stands on
    add(new THREE.CylinderGeometry(1.0, 1.0, 0.02, 48), 0x5c4a38, 0, 0.21, 0);       // its inlaid disc
    // columns around the court: a shaft, a base and a flared capital
    for (const [x, z] of [[-5.2, -2.6], [5.2, -2.6], [-6.4, 1.8], [6.4, 1.8], [-3.2, -5.6], [3.2, -5.6]]) {
      add(new THREE.CylinderGeometry(0.42, 0.48, 6.5, 20), 0xb39876, x, 3.25, z);
      add(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 20), 0xa58a69, x, 0.15, z);
      add(new THREE.CylinderGeometry(0.78, 0.44, 0.6, 20), 0xa58a69, x, 6.7, z);
    }
    // the Order's banners on poles, behind and to each side
    for (const side of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.045, 0.045, 4.4, 10), 0x3a2e24, side * 3.4, 2.2, -3.8);
      add(new THREE.BoxGeometry(0.9, 2.2, 0.02), side < 0 ? 0x7c241c : 0x1f2c3a, side * 3.4, 3.0, -3.74);
      add(new THREE.BoxGeometry(0.3, 0.3, 0.03), 0xc8a040, side * 3.4, 3.4, -3.71, 0, 0, Math.PI / 4);
    }
    // bronze braziers at the plinth's edge, and their flames
    this.flames = [];
    for (const [x, z] of [[-2.1, 1.2], [2.1, 1.2]]) {
      add(new THREE.CylinderGeometry(0.05, 0.09, 1.2, 10), 0x4a3522, x, 0.6, z);
      add(new THREE.CylinderGeometry(0.32, 0.12, 0.24, 18), 0x8a6232, x, 1.28, z);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb040 }));
      f.position.set(x, 1.46, z); f.scale.set(1, 1.5, 1); S.add(f); this.flames.push(f);
    }
    this.torchLight = new THREE.PointLight(0xffa550, 1.1, 9, 1.6);
    this.torchLight.position.set(0, 2.2, 1.6);
    S.add(this.torchLight);
    // far off: obelisks and pyramids in the dusk haze
    for (const [x, z, h] of [[-9, -14, 9], [9, -15, 8]]) {
      add(new THREE.CylinderGeometry(0.35, 0.7, h, 4), 0x5a4436, x, h / 2, z, 0, Math.PI / 4);
      add(new THREE.ConeGeometry(0.5, 0.9, 4), 0xb08a4a, x, h + 0.45, z, 0, Math.PI / 4);
    }
    add(new THREE.ConeGeometry(16, 13, 4), 0x4a3630, -18, 6.3, -44, 0, Math.PI / 4);
    add(new THREE.ConeGeometry(10, 8, 4), 0x45322d, 12, 3.8, -48, 0, Math.PI / 4 + 0.2);
    // embers drifting up past the torches
    const n = 60, pos = new Float32Array(n * 3);
    this.emberSeed = [];
    for (let i = 0; i < n; i++) { this.emberSeed.push(Math.random(), Math.random(), Math.random()); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffa040, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false }));
    S.add(this.embers);
    // the sky: a dusk dome, deep indigo above, rose in the middle, a warm glow low behind the pyramids
    const dome = new THREE.SphereGeometry(70, 48, 24), cols = [];
    const top = new THREE.Color(0x15172e), mid = new THREE.Color(0x5e4458), low = new THREE.Color(0xe7a062), sun = new THREE.Color(0xffd59a);
    const P = dome.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i) / 70, c = y > 0.2 ? top.clone().lerp(mid, 1 - (y - 0.2) / 0.8) : low.clone().lerp(mid, Math.max(0, (y + 0.1) / 0.3));
      const toSun = Math.max(0, -P.getZ(i) / 70) * Math.max(0, 1 - Math.abs(y - 0.04) / 0.3);
      c.lerp(sun, Math.pow(toSun, 3) * 0.6);
      if (y < -0.1) c.copy(new THREE.Color(0x24191a));
      cols.push(c.r, c.g, c.b);
    }
    dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    S.add(sky);
  }

  _lit(color) {
    if (!this._mats) this._mats = new Map();
    let m = this._mats.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color, vertexColors: false }); this._mats.set(color, m); }
    return m;
  }

  /** Turns the figure by `dx` radians (drag) and zooms by `dz` wheel notches. */
  nudge(dx, dz) {
    this.turn += dx;
    this.zoomK = Math.max(0.6, Math.min(1.8, this.zoomK * Math.exp(dz * 0.0015)));
  }

  update(dt) {
    this.t += dt;
    const ember = this.embers.geometry.attributes.position;
    for (let i = 0; i < this.emberSeed.length / 3; i++) {
      const s = this.emberSeed, k = i * 3;
      const life = (this.t * (0.12 + s[k] * 0.1) + s[k + 1]) % 1;
      const x = Math.sin(i * 12.9898 + this.t * 0.2) * (0.6 + s[k] * 1.8) * (1 - life * 0.4);
      const z = Math.cos(i * 78.233 + this.t * 0.15) * (0.6 + s[k + 2] * 1.8) * (1 - life * 0.4);
      ember.setXYZ(i, x, 0.5 + life * 3.2, z);
    }
    ember.needsUpdate = true;
    this.torchLight.intensity = 1.0 + Math.sin(this.t * 17) * 0.08 + Math.sin(this.t * 5.3) * 0.06;
    this.spin = Math.sin(this.t * 0.35) * 0.22;
    const a = this.actor;
    a.yaw = Math.PI + this.spin + this.turn;                  // yaw 0 faces -z: turn to face the camera (+z)
    if (this.model) {
      // while the real people are still loading the plinth stays empty: no drawn figure that is swapped a moment later
      this.model.root.visible = !HumanModels.pending();
      this.model.update(a, dt);
    }
  }

  /** Draws the stage over the whole canvas. W and H are the canvas size in CSS pixels. */
  render(W, H) {
    const r = this.renderer, cam = this.camera;
    // the figure's centre goes to the centre of the free area; the camera backs off so the figure fills its height
    const box = this.slotEl ? this.slotEl.getBoundingClientRect() : { left: W / 2, top: H / 2, width: W, height: H };
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    // 30 degree lens: the visible height at distance d is 0.536 d; the figure fills about 0.7 of the slot height
    const slotH = Math.max(160, box.height);
    const dist = 4.6 * (H / slotH) * this.zoomK;
    cam.aspect = W / H;
    cam.position.set(0, 1.05 + dist * 0.05, dist);
    cam.lookAt(0, 1.0, 0);
    cam.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    cam.updateProjectionMatrix();
    r.setViewport(0, 0, W, H);
    r.setScissorTest(false);
    r.clear();
    r.render(this.scene, cam);
    cam.clearViewOffset();
  }

  dispose() {
    if (this.model) this.model.dispose();
    this.embers.geometry.dispose();
  }
}
