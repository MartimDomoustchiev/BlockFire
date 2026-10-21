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
    this.scene.background = new THREE.Color(0x141a27);
    this.scene.fog = new THREE.Fog(0x202a40, 26, 60);
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

  /** Scenery: a plinth and the square's flagstones, banners, torches, far roofs and embers. */
  _buildSet() {
    const S = this.scene, parts = [];
    const add = (geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, this._lit(color)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); S.add(m); return m;
    };
    // flagstones: a ring of slabs around a round plinth
    const stone = [0x4a5366, 0x535d72, 0x434c60];
    for (let i = -7; i <= 7; i++) for (let j = -7; j <= 7; j++) {
      const r = Math.hypot(i, j);
      if (r > 7.6) continue;
      add(ShadedBox.get(1, 0.4, 1), stone[Math.abs(i * 7 + j * 13) % 3], i, -0.2, j);
    }
    add(new THREE.CylinderGeometry(1.25, 1.35, 0.2, 28), 0x8b93a6, 0, 0.1, 0);       // the plinth the figure stands on
    add(new THREE.CylinderGeometry(1.0, 1.0, 0.02, 28), 0x2d3446, 0, 0.21, 0);       // inlaid disc
    // the Order's banners on poles, behind and to each side
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.08, 4.4, 0.08), 0x3a2e24, side * 3.4, 2.2, -3.8);
      add(new THREE.BoxGeometry(0.9, 2.2, 0.03), side < 0 ? 0x8c2e24 : 0x34424f, side * 3.4, 3.0, -3.74);
      add(new THREE.BoxGeometry(0.34, 0.34, 0.04), 0xc8a040, side * 3.4, 3.4, -3.7, 0, 0, Math.PI / 4);
    }
    // torches at the plinth's edge: an iron stand and a flame
    this.flames = [];
    for (const [x, z] of [[-2.1, 1.2], [2.1, 1.2]]) {
      add(new THREE.BoxGeometry(0.1, 1.4, 0.1), 0x2b2620, x, 0.7, z);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb040 }));
      f.position.set(x, 1.5, z); S.add(f); this.flames.push(f);
    }
    this.torchLight = new THREE.PointLight(0xffa550, 1.1, 9, 1.6);
    this.torchLight.position.set(0, 2.2, 1.6);
    S.add(this.torchLight);
    // far roofs and towers: a silhouette of the island town
    const far = [[-13, -10, 4, 9], [-6, -16, 3, 12], [2, -18, 4, 15], [10, -12, 3, 10], [15, -4, 3, 7], [-16, -2, 3, 8], [13, 8, 3, 6], [-12, 9, 3, 6]];
    for (const [x, z, w, h] of far) add(ShadedBox.get(w, h, w), 0x2a3346, x, h / 2 - 0.2, z);
    // embers drifting up past the torches
    const n = 60, pos = new Float32Array(n * 3);
    this.emberSeed = [];
    for (let i = 0; i < n; i++) { this.emberSeed.push(Math.random(), Math.random(), Math.random()); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffa040, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false }));
    S.add(this.embers);
    // the sky: a dome with a gradient from deep blue down to a warm horizon
    const dome = new THREE.SphereGeometry(70, 24, 12), cols = [];
    const top = new THREE.Color(0x1d2a4a), mid = new THREE.Color(0x3a4a70), low = new THREE.Color(0xd08a5a);
    const P = dome.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i) / 70, c = y > 0.2 ? top.clone().lerp(mid, 1 - (y - 0.2) / 0.8) : low.clone().lerp(mid, Math.max(0, (y + 0.1) / 0.3));
      if (y < -0.1) c.copy(new THREE.Color(0x0e1320));
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
    if (this.model) this.model.update(a, dt);
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
