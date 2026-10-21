/* ============================================================
 * First-person viewmodel: whatever the local player holds, drawn in
 * a separate scene after the world (depth cleared) so it never
 * clips into walls.
 *
 * Animation sources (presentation only, read from the Character):
 *   bob/sway from movement and turning, ADS blend (adsT) moves the
 *   gun to the centre, recoil kick on 'shot' events, reload dip from
 *   the reload timer, swing while mining / placing, a muzzle flash.
 * The sniper hides the viewmodel when scoped in.
 *
 * Arms: the player's own forearms and hands (sleeve, bracer or glove,
 * a hand with four fingers and a thumb) in the colours of their
 * outfit, holding each item the way it is held - a pistol grip, the
 * left hand under a rifle's handguard, the bow in the left hand while
 * the right draws the string, the sword in a fighting grip, a block
 * on the palm, an empty fist with the hidden blade under the wrist.
 * The sword cuts in three different strokes (right to left, back left
 * to right, overhead) and is raised across the view to block.
 * Climbing shows both hands reaching up the wall. Lit by the same sun
 * and sky as the characters (CharacterLights).
 * ============================================================ */

/*
 * Where the hands go on each item, in model units: `r` / `l` the point the right / left hand grips,
 * `rp` / `lp` the pose (see ARM_POSES), `re` / `le` the direction from the wrist to the elbow.
 */
const ARM_GRIPS = {
  ar:      { r: [0, -0.085, 0.06], l: [0, -0.04, -0.25], lp: 'under' },
  smg:     { r: [0, -0.085, 0.03], l: [0, -0.15, -0.12], lp: 'grip' },
  pistol:  { r: [0, -0.08, 0.012] },
  shotgun: { r: [0, -0.055, 0.12], l: [0, -0.05, -0.3], lp: 'under' },
  sniper:  { r: [0, -0.085, -0.02], l: [0, -0.04, -0.24], lp: 'under' },
  rocket:  { r: [0, -0.085, -0.05], l: [0.02, -0.06, -0.3], lp: 'under' },
  musket:  { r: [0, -0.07, 0.1], l: [0, -0.02, -0.24], lp: 'under' },
  smoke:   { r: [0, -0.02, -0.06], rp: 'cradle' },
  fist:    { r: [0, 0, 0], rp: 'punch', re: [0.2, -0.32, 0.92] },
  blade:   { r: [0, 0, 0], rp: 'punch', re: [0.2, -0.32, 0.92] },
  sword:   { r: [0, 0, 0.06], rp: 'grip' },
  held:    { r: [0, -0.07, 0], rp: 'cradle' },
};
/** Hand orientations as the model-space directions of the hand's x / y / z axes (z = x × y). */
const ARM_POSES = {
  grip:   [[1, 0, 0], [0, 1, 0]],        // a vertical grip: fingers forward around it
  under:  [[0, 1, 0], [0, 0, -1]],       // (left) palm up under a handguard
  knife:  [[1, 0, 0], [0, 0, 1]],        // a handle along the view (a sword's grip), fingers up around it
  cradle: [[0, -1, 0], [1, 0, 0]],       // palm up, something resting on it
  punch:  [[0, 1, 0], [-1, 0, 0]],       // a fist, palm down, knuckles forward
  climbR: [[0, 0, 1], [-1, 0, 0]],       // fingers up, gripping a ledge in front
  climbL: [[0, 0, -1], [1, 0, 0]],
};
class ViewModel {
  constructor(atlas) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.01, 10);
    this.holder = new THREE.Group();
    this.holder.scale.setScalar(0.5);       // models are built ~2x scale for easy authoring
    this.scene.add(this.holder);
    this.atlas = atlas;
    this.models = new Map();
    this.current = null;
    this.currentKey = '';
    this.kick = 0;
    this.swing = 0;
    this.flash = 0;
    this.bob = 0;
    this.lastYaw = 0; this.lastPitch = 0;
    this.sway = new THREE.Vector2();
    this.light = new THREE.Color(1, 1, 1);
    this.mats = [];
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.flashMesh.visible = false;
    CharacterLights.install(this.scene);
    this.armMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.outfitKey = null;
    this.armGeo = null;
    this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }

  /** Forearm and hand geometry in the colours of `ch`'s outfit (rebuilt when the outfit changes). */
  _arms(ch) {
    const key = (ch.look || 'ranger') + ':' + (ch.look ? (ch.lookSpec ? JSON.stringify(ch.lookSpec) : 0) : (ch.team || ch.id));
    if (key === this.outfitKey) return this.armGeo;
    // a new outfit: rebuild every held model with the new arms
    if (this.current) this.holder.remove(this.current);
    this.models.clear(); this.mats = []; this.current = null; this.currentKey = '';
    if (this.climbArms) { this.scene.remove(this.climbArms); this.climbArms = null; }
    const o = outfitFor(ch), K = BodyKit, skin = o.gloves || o.skin;
    // a capsule between two points
    const seg = (a, b, r0, r1, color, out) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
      const g = new THREE.CylinderGeometry(r1, r0, L, 9, 1);
      this._q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      g.applyQuaternion(this._q);
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      out.push({ g, c: new THREE.Color(color) }, K.sph(r1, color, b[0], b[1], b[2]));
    };
    // a closed hand around a grip running along y at (-0.035 * side, *, -0.075); the wrist at the origin
    const hand = (side, fist) => {
      const P = [], x = (v) => v * side;
      P.push(K.sph(0.05, skin, 0, 0, -0.055, 0.56, 1.0, 1.18));                 // back of the hand / palm
      P.push(K.cyl(0.03, 0.033, 0.05, skin, 0, 0, 0.0, Math.PI / 2, 0, 0));      // wrist
      const fy = [0.034, 0.012, -0.01, -0.03], fr = [0.0118, 0.0122, 0.0116, 0.0102];
      for (let i = 0; i < 4; i++) {
        const y = fy[i], r = fr[i], k = [0, y, -0.104];
        // around a grip, or curled tight into a fist
        const m = fist ? [x(-0.024), y, -0.122] : [x(-0.034), y, -0.128], t = fist ? [x(-0.034), y, -0.088] : [x(-0.066), y, -0.098];
        P.push(K.sph(r * 1.12, skin, k[0], k[1], k[2]));
        seg(k, m, r, r, skin, P);
        seg(m, t, r, r * 0.92, skin, P);
      }
      if (fist) {
        seg([x(-0.012), 0.024, -0.03], [x(-0.04), 0.028, -0.062], 0.0145, 0.013, skin, P);  // thumb across the fingers
        seg([x(-0.04), 0.028, -0.062], [x(-0.044), 0.012, -0.094], 0.013, 0.0115, skin, P);
      } else {
        seg([x(-0.012), 0.03, -0.022], [x(-0.05), 0.046, -0.058], 0.0145, 0.013, skin, P);   // thumb over the top
        seg([x(-0.05), 0.046, -0.058], [x(-0.07), 0.036, -0.086], 0.013, 0.0115, skin, P);
      }
      return K.merge(P);
    };
    // the forearm from the wrist (origin) to the elbow along +z: bracer / glove cuff, then the sleeve
    const F = [];
    seg([0, 0, 0.0], [0, 0, 0.34], 0.032, 0.043, o.rolled ? o.skin : (o.gloves || o.skin), F);
    if (o.bracers) {
      F.push(K.cyl(0.043, 0.048, 0.16, o.bracers, 0, 0, 0.095, Math.PI / 2, 0, 0));
      F.push(K.torus(0.046, 0.006, 0x8a8f98, 0, 0, 0.04), K.torus(0.049, 0.006, 0x8a8f98, 0, 0, 0.145));
      F.push(K.box(0.028, 0.016, 0.15, 0x6a6e78, 0, -0.045, 0.085));            // the hidden blade's housing
    } else if (o.gloves) F.push(K.cyl(0.04, 0.045, 0.07, o.gloves, 0, 0, 0.04, Math.PI / 2, 0, 0));
    if (!o.rolled) {
      F.push(K.cyl(0.05, 0.075, 0.5, o.sleeve, 0, 0, 0.4, Math.PI / 2, 0, 0));
      F.push(K.torus(0.051, 0.008, o.trim || new THREE.Color(o.sleeve).multiplyScalar(0.7).getHex(), 0, 0, 0.152));
      if (o.ranger) F.push(K.box(0.07, 0.03, 0.2, o.ranger, 0, 0.06, 0.3));     // armour plate
    }
    this.armGeo = { hand: [null, hand(1), hand(-1)], fist: hand(1, true), fore: K.merge(F) };
    this.outfitKey = key;
    return this.armGeo;
  }

  /** A hand gripping `at` in pose `pose`, its forearm running off towards `elbow`, added to `g`. */
  _arm(g, side, at, pose, elbow) {
    const A = this.armGeo, P = ARM_POSES[pose], m = this._m;
    const X = new THREE.Vector3(...P[0]), Y = new THREE.Vector3(...P[1]), Z = new THREE.Vector3().crossVectors(X, Y);
    m.makeBasis(X, Y, Z);
    const hand = new THREE.Mesh(pose === 'punch' ? A.fist : A.hand[side > 0 ? 1 : 2], this.armMat);
    hand.quaternion.setFromRotationMatrix(m);
    const grip = this._v.set(-0.035 * side, 0, -0.075).applyQuaternion(hand.quaternion);
    hand.position.set(at[0] - grip.x, at[1] - grip.y, at[2] - grip.z);
    const fore = new THREE.Mesh(A.fore, this.armMat);
    fore.position.copy(hand.position);
    fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...elbow).normalize());
    g.add(hand, fore);
    return { hand, fore };
  }

  /** Arms for a held model of kind `kind` (a key of ARM_GRIPS). */
  _withArms(g, kind) {
    const G = ARM_GRIPS[kind];
    if (!G) return g;
    g.userData.armR = this._arm(g, 1, G.r, G.rp || 'grip', G.re || [0.16, -0.42, 0.9]);
    if (G.l) g.userData.armL = this._arm(g, -1, G.l, G.lp || 'grip', G.le || [-0.42, -0.5, 0.76]);
    return g;
  }

  /** Both hands reaching up a wall (shown instead of the held item while climbing). */
  _climbArms() {
    if (this.climbArms) return this.climbArms;
    const c = new THREE.Group();
    const r = new THREE.Group(), l = new THREE.Group();
    r.scale.setScalar(0.5); l.scale.setScalar(0.5);
    this._arm(r, 1, [0, 0, 0], 'climbR', [0.25, -0.75, 0.6]);
    this._arm(l, -1, [0, 0, 0], 'climbL', [-0.25, -0.75, 0.6]);
    c.add(r, l);
    c.userData.r = r; c.userData.l = l;
    this.scene.add(c);
    this.climbArms = c;
    return c;
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** Hooks the local player's events (call again for each new Game). */
  attach(game, ch) {
    if (this.unsub) this.unsub();
    this.ch = ch;
    const offs = [
      game.events.on('shot', (e) => { if (e.character === this.ch) { this.kick = 1; const w = CONFIG.WEAPONS[e.cls]; if (!w || !(w.thrown || w.bow)) this.flash = 0.05; } }),
      game.events.on('blockPlaced', (e) => { if (e.by === this.ch) this.swing = Math.max(this.swing, 0.6); }),
      game.events.on('blockBroken', (e) => { if (e.by === this.ch) this.swing = 1; }),
      game.events.on('strike', (e) => { if (e.character === this.ch) { this.stab = 1; if (e.swing !== undefined) { this.cutKind = e.swing; this.cutT = 0; } } }),
    ];
    this.unsub = () => offs.forEach((f) => f());
  }

  _mat(hex) {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: hex });
    m.userData.base = new THREE.Color(hex);
    this.mats.push(m);
    return m;
  }

  _box(g, w, h, d, m, x, y, z) {
    const mesh = new THREE.Mesh(ShadedBox.get(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  }

  /** Box-built gun per class, barrel along -z. Accent stripes use the rarity colour. */
  _gun(cls, rarity) {
    const g = new THREE.Group();
    const dk = this._mat(0x30343d), md = this._mat(0x505663), acc = this._mat(new THREE.Color(CONFIG.RARITY[rarity].color).getHex());
    const wood = this._mat(0x8a5c36), olive = this._mat(0x667256);
    acc.userData.glow = true;
    const B = (w, h, d, m, x, y, z) => this._box(g, w, h, d, m, x, y, z);
    let tip = -0.5;
    switch (cls) {
      case 'ar':
        B(0.07, 0.09, 0.42, md, 0, 0, -0.1); B(0.05, 0.05, 0.22, dk, 0, 0.01, -0.4); B(0.06, 0.12, 0.06, dk, 0, -0.09, -0.06);
        B(0.05, 0.11, 0.05, dk, 0, -0.08, 0.06); B(0.06, 0.08, 0.16, dk, 0, -0.01, 0.17); B(0.03, 0.03, 0.14, dk, 0, 0.065, -0.1);
        B(0.075, 0.02, 0.3, acc, 0, 0.035, -0.1); tip = -0.52; break;
      case 'smg':
        B(0.07, 0.09, 0.3, md, 0, 0, -0.08); B(0.045, 0.045, 0.12, dk, 0, 0.01, -0.28); B(0.05, 0.16, 0.05, dk, 0, -0.11, -0.12);
        B(0.05, 0.1, 0.05, dk, 0, -0.08, 0.03); B(0.03, 0.03, 0.14, dk, 0, -0.01, 0.13); B(0.075, 0.02, 0.22, acc, 0, 0.035, -0.08); tip = -0.35; break;
      case 'pistol':
        B(0.06, 0.07, 0.24, md, 0, 0.02, -0.08); B(0.05, 0.13, 0.06, dk, 0, -0.07, 0.01); B(0.065, 0.015, 0.2, acc, 0, 0.055, -0.08); tip = -0.21; break;
      case 'shotgun':
        B(0.07, 0.08, 0.26, dk, 0, 0, 0); B(0.05, 0.05, 0.42, dk, 0, 0.02, -0.33); B(0.06, 0.05, 0.16, wood, 0, -0.04, -0.3);
        B(0.06, 0.09, 0.2, wood, 0, -0.02, 0.2); B(0.075, 0.02, 0.2, acc, 0, 0.045, 0); tip = -0.55; break;
      case 'sniper':
        B(0.07, 0.08, 0.36, dk, 0, 0, -0.06); B(0.04, 0.04, 0.4, dk, 0, 0.01, -0.42); B(0.05, 0.05, 0.24, dk, 0, 0.08, -0.08);
        B(0.06, 0.1, 0.2, wood, 0, -0.02, 0.2); B(0.04, 0.1, 0.04, dk, 0, -0.08, -0.02); B(0.075, 0.02, 0.24, acc, 0, -0.035, -0.06); tip = -0.63; break;
      case 'rocket':
        B(0.13, 0.13, 0.7, olive, 0.02, 0.04, -0.15); B(0.15, 0.15, 0.06, dk, 0.02, 0.04, -0.5); B(0.05, 0.12, 0.05, dk, 0, -0.08, -0.05);
        B(0.04, 0.06, 0.06, dk, 0.02, 0.14, -0.2); B(0.135, 0.03, 0.4, acc, 0.02, -0.02, -0.15); tip = -0.54; break;
      case 'smoke': {
        const ball = this._mat(0x474b56);
        B(0.12, 0.12, 0.12, ball, 0, 0.04, -0.06); B(0.02, 0.06, 0.02, wood, 0.02, 0.12, -0.08); tip = -0.12; break;
      }
      case 'musket':
        B(0.06, 0.07, 0.5, wood, 0, -0.01, 0.06); B(0.035, 0.035, 0.6, dk, 0, 0.03, -0.42); B(0.04, 0.08, 0.05, dk, 0, -0.07, -0.02); tip = -0.72; break;
    }
    g.userData.tip = tip;
    return this._withArms(g, cls);
  }

  _blockCube(blockId) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true, alphaTest: 0.5 });
    mat.userData.base = new THREE.Color(1, 1, 1);
    this.mats.push(mat);
    const m = new THREE.Mesh(DropVisuals._cubeGeom(blockId), mat);
    m.scale.setScalar(0.9);
    m.rotation.set(0.15, 0.6, 0);
    m.position.y = 0.1;
    g.add(m);
    return this._withArms(g, 'held');
  }

  _itemPlane(id) {
    const g = new THREE.Group();
    const tex = new THREE.CanvasTexture(Icons.canvas(id));
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    mat.userData.base = new THREE.Color(1, 1, 1);
    this.mats.push(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), mat);
    m.rotation.set(-0.2, -0.9, 0.3);
    m.position.set(-0.04, 0.08, -0.02);
    g.add(m);
    return this._withArms(g, 'held');
  }

  /** Wrist blade (a bracer; the blade shoots out on a strike) or a sabre. */
  _bladeModel(id) {
    const g = new THREE.Group();
    const steel = this._mat(0xdde2ea);
    let blade;
    if (CONFIG.STORY.BLADES[id] && CONFIG.STORY.BLADES[id].visible) return this._swordModel(id);
    {
      // the wrist blade slides out from under the bracer, past the knuckles
      this._withArms(g, 'blade');
      const fore = g.userData.armR.fore;
      blade = this._box(g, 0.022, 0.01, 0.3, steel, 0, 0, 0);
      blade.quaternion.copy(fore.quaternion);
      blade.position.copy(fore.position).add(this._v.set(0, -0.05, -0.1).applyQuaternion(fore.quaternion));
    }
    g.userData.blade = blade;
    g.userData.hidden = true;
    return g;
  }

  _fist() {
    return this._withArms(new THREE.Group(), 'fist');
  }

  _modelFor(stack) {
    const it = stack && ITEMS[stack.id];
    const key = !it ? 'fist' : it.kind === 'weapon' ? it.weapon.cls + ':' + stack.data.rarity : it.kind === 'block' ? 'b' + it.blockId : 'i' + it.id;
    if (key === this.currentKey) return this.current;
    if (this.current) this.holder.remove(this.current);
    let m = this.models.get(key);
    if (!m) {
      m = !it ? this._fist() : it.bow ? this._bowModel() : it.kind === 'weapon' ? this._gun(it.weapon.cls, stack.data.rarity) : it.kind === 'block' ? this._blockCube(it.blockId)
        : it.kind === 'blade' ? this._bladeModel(it.id) : this._itemPlane(it.id);
      this.models.set(key, m);
    }
    this.holder.add(m);
    this.current = m;
    this.currentKey = key;
    this.isGun = !!(it && it.kind === 'weapon' && !it.bow);
    if (this.isGun) { m.add(this.flashMesh); this.flashMesh.position.set(0, 0.01, m.userData.tip); }
    return m;
  }

  /** The bow upright and canted in the left hand; the right hand rides the string as it's drawn. */
  _bowModel() {
    const g = new THREE.Group();
    const rig = new BowRig(this.armMat);
    rig.strMat.userData.base = new THREE.Color(0xe8e4d4);
    this.mats.push(rig.strMat);
    rig.group.rotation.set(0, -0.06, 0.3);
    g.add(rig.group);
    this._arm(rig.group, -1, [0, 0, 0], 'grip', [-0.15, -0.85, 0.5]);
    const pull = new THREE.Group();
    rig.group.add(pull);
    this._arm(pull, 1, [0, 0, 0], 'grip', [0.6, -0.45, 0.66]);
    g.userData.bow = rig; g.userData.pull = pull;
    return g;
  }

  /**
   * A sword in a fighting grip. The hand turns with the sword (the wrist); the forearm stays put, running
   * from the wrist down and back out of view, so cuts and the block don't swing the whole arm about.
   */
  _swordModel(id) {
    const g = new THREE.Group(), s = new THREE.Group();
    s.add(new THREE.Mesh(WeaponGeometry.get(id), this.armMat));
    const arm = this._arm(s, 1, [0, 0, 0.02], 'knife', [0.3, -0.62, 0.72]);
    s.remove(arm.fore); g.add(arm.fore);
    arm.fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.3, -0.62, 0.72).normalize());
    g.add(s);
    g.userData.sword = s; g.userData.arm = arm;
    return g;
  }

  /**
   * Sword pose for cut `kind` (0 right to left, 1 left to right, 2 overhead) at progress t (0..1): up into the
   * stroke, sweep through, back to guard. Sets `this._pose` = { p: hand offset, q: sword orientation }.
   */
  _cutPose(kind, t) {
    const S = ViewModel.SWORD, K = S.cuts[kind] || S.cuts[0], ease = (u) => u * u * (3 - 2 * u);
    let a, b, u;
    if (t < 0.2) { a = S.idle; b = K[0]; u = ease(t / 0.2); }
    else if (t < 0.7) { a = K[0]; b = K[1]; u = Math.pow((t - 0.2) / 0.5, 0.8); }
    else { a = K[1]; b = S.idle; u = ease((t - 0.7) / 0.3); }
    const out = this._pose || (this._pose = { p: [0, 0, 0], q: new THREE.Quaternion() });
    for (let i = 0; i < 3; i++) out.p[i] = a.p[i] * (1 - u) + b.p[i] * u;
    out.q.copy(a.q).slerp(b.q, u);
    return out;
  }

  update(ch, frameDt, scoped) {
    this._arms(ch);
    const held = ch.heldStack();
    const m = this._modelFor(held);
    this.holder.visible = ch.alive && !scoped && ch.vehicleSeat !== 'driver' && !ch.climbing;
    // climbing: both hands reach up the wall in turn
    const climbing = ch.alive && ch.climbing && !scoped;
    if (climbing || this.climbArms) {
      const c = this._climbArms();
      c.visible = climbing;
      if (climbing) {
        const t = performance.now() / 1000 * 7, up = Math.max(0, ch.vel.y) > 0.2 ? 1 : 0.25;
        c.userData.r.position.set(0.17, -0.06 + Math.sin(t) * 0.06 * up, -0.34);
        c.userData.l.position.set(-0.17, -0.06 - Math.sin(t) * 0.06 * up, -0.34);
      }
    }

    // movement bob + look sway
    const speed = Math.hypot(ch.vel.x, ch.vel.z);
    const grounded = ch.onGround && !ch.flying;
    this.bob += frameDt * (grounded ? speed * 1.9 : 0);
    const bobAmt = Math.min(1, speed / 6) * (grounded ? 1 : 0.2) * (1 - 0.8 * ch.adsT);
    const dyaw = ch.yaw - this.lastYaw, dpitch = ch.pitch - this.lastPitch;
    this.lastYaw = ch.yaw; this.lastPitch = ch.pitch;
    this.sway.x += (Math.max(-0.08, Math.min(0.08, dyaw)) - this.sway.x) * Math.min(1, frameDt * 10);
    this.sway.y += (Math.max(-0.08, Math.min(0.08, dpitch)) - this.sway.y) * Math.min(1, frameDt * 10);

    // base pose: hip vs. aim-down-sights
    const a = ch.adsT;
    const U = m.userData;
    const hip = U.bow ? [-0.075, -0.07, -0.46] : U.sword ? [0.2, -0.2, -0.36] : this.isGun ? [0.17, -0.155, -0.36] : [0.2, -0.17, -0.36];
    const ads = U.bow ? [-0.04, -0.045, -0.36] : [0, -0.062, -0.24];
    let x = hip[0] + (ads[0] - hip[0]) * a, y = hip[1] + (ads[1] - hip[1]) * a, z = hip[2] + (ads[2] - hip[2]) * a;
    x += Math.sin(this.bob) * 0.012 * bobAmt + this.sway.x * 0.4;
    y += -Math.abs(Math.cos(this.bob)) * 0.014 * bobAmt - this.sway.y * 0.3;
    let rx = 0, ry = this.sway.x * 1.5, rz = 0;

    // recoil kick
    this.kick = Math.max(0, this.kick - frameDt * 9);
    z += this.kick * 0.06; rx += this.kick * 0.14;
    // reload dip
    if (ch.reload) {
      const p = 1 - ch.reload.t / ch.reload.total;
      const s = Math.sin(Math.PI * Math.min(1, p));
      y -= s * 0.14; rx -= s * 0.7; rz += s * 0.4;
    }
    // consumable in use: raise and wobble
    if (ch.using) { y += 0.06; rz += Math.sin(performance.now() / 90) * 0.06; }
    // mining / placing swing
    const swinging = ch.mining && ch.mining.progress > 0;
    if (swinging) this.swing = Math.max(this.swing, 0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 110)));
    this.swing = Math.max(0, this.swing - frameDt * 4);
    rx -= this.swing * 0.9; y -= this.swing * 0.05; z -= this.swing * 0.05;

    // blade strike: thrust forward, the hidden blade springs out
    this.stab = Math.max(0, (this.stab || 0) - frameDt * 4);
    if (m.userData.blade) {
      const s = Math.sin(Math.min(1, this.stab) * Math.PI);
      z -= s * 0.22; y += s * 0.04; rx += s * 0.25;
      m.userData.blade.visible = !m.userData.hidden || this.stab > 0.05;
    }
    // bow: the string (and the hand on it) comes back as the bow is drawn
    if (U.bow) {
      const d = ch.draw || 0, nz = U.bow.set(d, !ch.reload && held && held.data.mag > 0);
      U.pull.position.set(0, 0, nz);
      x -= d * 0.02; rz -= d * 0.04;
      if (d > 0.95) { x += (Math.random() - 0.5) * 0.002; y += (Math.random() - 0.5) * 0.002; }   // the strain of a full draw
    }
    // sword: three different cuts, and the block raised across the view
    if (U.sword) {
      if (this.cutT === undefined) this.cutT = 1;
      this.cutT = Math.min(1, this.cutT + frameDt / 0.32);
      this.blockT = (this.blockT || 0) + ((ch.blocking ? 1 : 0) - (this.blockT || 0)) * Math.min(1, frameDt * 16);
      const S = ViewModel.SWORD, c = this.cutT < 1 ? this._cutPose(this.cutKind || 0, this.cutT) : S.idle, k = this.blockT;
      const sw = U.sword, P = this._sp || (this._sp = new THREE.Vector3());
      P.set(c.p[0], c.p[1], c.p[2]).lerp(this._v.set(S.block.p[0], S.block.p[1], S.block.p[2]), k);
      sw.position.copy(P);
      sw.quaternion.copy(c.q).slerp(S.block.q, k);
      // the forearm follows the wrist
      sw.updateMatrix();
      U.arm.fore.position.copy(U.arm.hand.position).applyMatrix4(sw.matrix);
    }
    this.holder.position.set(x, y, z);
    this.holder.rotation.set(rx, ry, rz);

    // muzzle flash
    this.flash = Math.max(0, this.flash - frameDt);
    this.flashMesh.visible = this.isGun && this.flash > 0;
    if (this.flashMesh.visible) this.flashMesh.rotation.z = Math.random() * Math.PI;

    for (const mat of this.mats) {
      if (mat.userData.glow) continue;
      mat.color.copy(mat.userData.base).multiply(this.light);
    }
    return m;
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

/**
 * Sword poses: where the hand is (model units, from the guard position) and which way the blade points (`dir`)
 * with its flat facing `up`. Cuts are [start of the stroke, end of the stroke].
 */
ViewModel.SWORD = (() => {
  const pose = (p, dir, up) => {
    const z = new THREE.Vector3(...dir).normalize().negate();          // the blade runs along -z of the sword
    const y = new THREE.Vector3(...up); y.addScaledVector(z, -y.dot(z)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    return { p, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)) };
  };
  return {
    idle: pose([0, 0, 0], [-0.3, 0.78, -0.55], [0.6, 0.2, 0.8]),
    block: pose([-0.2, 0.2, -0.04], [-1, 0.12, -0.2], [0, 0.35, 1]),
    cuts: [
      [pose([0.12, 0.24, 0.02], [0.9, 0.35, -0.3], [0, 1, 0.2]), pose([-0.42, 0.1, -0.12], [-0.9, -0.1, -0.45], [0, 1, 0.1])],     // right to left
      [pose([-0.4, 0.22, 0.0], [-0.9, 0.35, -0.3], [0, -1, 0.2]), pose([0.12, 0.08, -0.12], [0.9, -0.1, -0.45], [0, -1, 0.1])],      // back, left to right
      [pose([-0.1, 0.32, 0.06], [0.05, 0.9, 0.45], [1, 0, 0]), pose([-0.14, -0.06, -0.14], [0.02, -0.55, -0.85], [1, 0, 0])],      // overhead
    ],
  };
})();
