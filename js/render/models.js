/* ============================================================
 * Character models (presentation only): people, not blocks.
 *
 * Every character is built on a human skeleton - hips, knees,
 * ankles, waist, neck, shoulders, elbows, wrists - from rounded
 * shapes (capsule-like limbs, an oval torso, a head with eyes, nose,
 * mouth and ears) lit by the scene's sun and sky (CharacterLights),
 * so they shade naturally and darken at night. Each look dresses the
 * same body: the Order's hooded robe with split tails, guards'
 * tabards and kettle helmets, the captain's cape and plume, the
 * magistrate's coat and top hat, villagers in varied clothes (some
 * in long skirts, some in straw hats), and the armoured "ranger" of
 * the arena modes with a glowing visor.
 *
 * All the shapes of one body segment are merged into one mesh with
 * vertex colours, and segment geometry is shared between characters
 * that look alike, so dozens of people stay cheap to draw.
 * Animation: walk / run cycles with knees and elbows, sneaking,
 * climbing, the leap of faith, gliding, aiming, stabs and sword cuts,
 * corpses lying where they fell.
 * ============================================================ */
const MODEL_PALETTE = [
  { suit: 0xd9692b, trim: 0x2a2f3a, visor: 0x5fe0ff },   // orange
  { suit: 0x3a7bd5, trim: 0x1f2633, visor: 0xffd34a },   // blue
  { suit: 0x4caf50, trim: 0x23302a, visor: 0xff6ad5 },   // green
  { suit: 0xb54ad6, trim: 0x2a2234, visor: 0x8cff6a },   // purple
  { suit: 0xd8c14a, trim: 0x2f2b1f, visor: 0x6ad1ff },   // yellow
  { suit: 0xd64a4a, trim: 0x2f1f1f, visor: 0xa8ff5f },   // red
  { suit: 0x7a8794, trim: 0x22272d, visor: 0xffa64a },   // grey
  { suit: 0x39c1b5, trim: 0x1f2f2d, visor: 0xff7a5f },   // teal
];

/** BoxGeometry with per-face shading in a vertex colour attribute (cached by size). */
const ShadedBox = {
  cache: new Map(),
  get(w, h, d) {
    const k = w + 'x' + h + 'x' + d;
    let g = this.cache.get(k);
    if (g) return g;
    g = new THREE.BoxGeometry(w, h, d);
    const SH = [0.8, 0.8, 1.0, 0.55, 0.68, 0.68], col = [];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) col.push(SH[f], SH[f], SH[f]);
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.cache.set(k, g);
    return g;
  },
};


/** Shapes with a baked colour, merged into one geometry per body segment. */
const BodyKit = {
  _m: new THREE.Matrix4(), _q: new THREE.Quaternion(), _e: new THREE.Euler(), _p: new THREE.Vector3(), _s: new THREE.Vector3(),
  place(geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    this._e.set(rx || 0, ry || 0, rz || 0);
    this._q.setFromEuler(this._e);
    this._m.compose(this._p.set(x || 0, y || 0, z || 0), this._q, this._s.set(sx || 1, sy || 1, sz || 1));
    geo.applyMatrix4(this._m);
    return { g: geo, c: new THREE.Color(color) };
  },
  cyl(rt, rb, h, color, x, y, z, rx, ry, rz, sx, sy, sz) { return this.place(new THREE.CylinderGeometry(rt, rb, h, 10, 1), color, x, y, z, rx, ry, rz, sx, sy, sz); },
  shell(rt, rb, h, color, open, x, y, z, rx, ry, rz) {
    // an open-ended cone; `open` radians cut out at the front (-z) for split robe tails
    const g = new THREE.CylinderGeometry(rt, rb, h, 16, 1, true, Math.PI + open / 2, Math.PI * 2 - open);
    return this.place(g, color, x, y, z, rx, ry, rz);
  },
  sph(r, color, x, y, z, sx, sy, sz) { return this.place(new THREE.SphereGeometry(r, 12, 9), color, x, y, z, 0, 0, 0, sx, sy, sz); },
  cap(r, color, thetaLen, x, y, z, sx, sy, sz) { return this.place(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, thetaLen), color, x, y, z, 0, 0, 0, sx, sy, sz); },
  hood(r, color, x, y, z) {
    // a sphere shell open at the face
    const open = 1.5, g = new THREE.SphereGeometry(r, 16, 10, Math.PI * 1.5 + open / 2, Math.PI * 2 - open, 0, 2.1);
    return this.place(g, color, x, y, z, 0, 0, 0, 1, 1.05, 1.05);
  },
  box(w, h, d, color, x, y, z, rx, ry, rz) { return this.place(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz); },
  cone(r, h, color, x, y, z, rx, ry, rz, sx, sy, sz) { return this.place(new THREE.ConeGeometry(r, h, 10), color, x, y, z, rx, ry, rz, sx, sy, sz); },
  torus(r, t, color, x, y, z, rx, ry, rz, sx, sy, sz) { return this.place(new THREE.TorusGeometry(r, t, 6, 16), color, x, y, z, rx, ry, rz, sx, sy, sz); },
  /** A tapered rod from point a to point b (radius r0 at a, r1 at b), with a ball on the b end. */
  seg(a, b, r0, r1, color, out, ball = true) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, L, 9, 1);
    g.applyQuaternion(this._q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    out.push({ g, c: new THREE.Color(color) });
    if (ball) out.push(this.sph(r1, color, b[0], b[1], b[2]));
  },

  /** One indexed geometry (position, normal, colour) from many coloured parts. */
  merge(parts) {
    let nv = 0, ni = 0;
    for (const p of parts) { nv += p.g.attributes.position.count; ni += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const p of parts) {
      const g = p.g, n = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      for (let i = 0; i < n; i++) { col[(vo + i) * 3] = p.c.r; col[(vo + i) * 3 + 1] = p.c.g; col[(vo + i) * 3 + 2] = p.c.b; }
      if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo; io += I.length; }
      else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
      vo += n;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  },
};

// skeleton measurements (metres = blocks); the whole body is ~1.8 tall like the collision box
const RIG = { HIP_Y: 0.93, HIP_X: 0.095, THIGH: 0.44, SHIN: 0.42, NECK: 0.52, SHOULDER_X: 0.205, SHOULDER_Y: 0.44, UPPER: 0.29, FORE: 0.25 };

const SKIN_TONES = [0xe0b48c, 0xc8956a, 0xf0c8a0, 0x9c6a44, 0xd9a47a, 0x7a4e30];

/*
 * Looks. Colours plus which garments to put on. Villagers and the arena "ranger" pick colours by id;
 * guards vary their skin. Garments: robe 'tails' (split at the front) | 'long' | 'coat'; head 'hood' |
 * 'helmet' (kettle hat) | 'ranger' (full helmet + visor) | 'tophat' | 'cap' | 'straw' | 'scarf' | hair.
 */
const OUTFITS = {
  order:      { shirt: 0x3c4a5c, sleeve: 0x3c4a5c, trousers: 0x262c35, boots: 0x2e2218, belt: 0x5a3e26, trim: 0xb08a3c, hood: 0x34424f, robe: 'tails', robeColor: 0x34424f, bracers: 0x6a4a2e, sash: true },
  mentor:     { shirt: 0x6c7078, sleeve: 0x6c7078, trousers: 0x3e3a36, boots: 0x2a2420, belt: 0x5a4632, hood: 0x5c6068, robe: 'long', robeColor: 0x62666e, beard: 0xe8e8e8 },
  guard:      { shirt: 0x6a707a, sleeve: 0x6a707a, trousers: 0x4a4038, boots: 0x231d18, belt: 0x3a2a1c, tabard: 0x8c2e24, helmet: 0x9aa2ac, gloves: 0x3a2e24 },
  captain:    { shirt: 0x6a707a, sleeve: 0x6a707a, trousers: 0x3a3430, boots: 0x15120f, belt: 0xc8a040, tabard: 0x5e1a16, helmet: 0xc8a040, plume: 0xd03030, cape: 0x6e1e1a, gloves: 0x2a2018, trim: 0xc8a040 },
  magistrate: { shirt: 0x4a2a62, sleeve: 0x4a2a62, trousers: 0x221a28, boots: 0x15121a, belt: 0xd8b04a, robe: 'coat', robeColor: 0x4a2a62, tophat: 0x17151c, chain: 0xd8b04a, collar: 0xf0ece0, hair: 0x9a9a9a },
  smith:      { shirt: 0xb8a58a, sleeve: 0xb8a58a, trousers: 0x4a3a2c, boots: 0x2a2018, belt: 0x5a3a24, apron: 0x5a3a24, hair: 0xb5482a, rolled: true },
  clerk:      { shirt: 0x2f5a3a, sleeve: 0x2f5a3a, trousers: 0x2a2a30, boots: 0x1c1814, belt: 0x8a7a40, robe: 'coat', robeColor: 0x2f5a3a, cap: 0x23412a, hair: 0x5a3a20 },
};
const VILLAGER_COLORS = {
  tunic: [0x9a5b3a, 0x5b7a3a, 0x3a5b8a, 0x8a7a4a, 0x7a3a5a, 0xa08060, 0x6a6a72, 0xb0703a],
  legs: [0x4a3a2c, 0x3a3a3a, 0x5a4a3a, 0x2e3a4a],
  skirt: [0x6a3a3a, 0x3a4a6a, 0x5a6a3a, 0x7a6a5a],
  hair: [0x2a1c12, 0x6a4a2a, 0xc8a050, 0x9a9a9a, 0x3a2a1a, 0x8a3a1a],
};

/** The resolved outfit (colours + garments) for a character. */
function outfitFor(ch) {
  const id = Math.abs(ch.id | 0), pick = (a, k) => a[(id >> k) % a.length];
  if (ch.look === 'villager') {
    const woman = id % 2 === 1, V = VILLAGER_COLORS;
    const o = { shirt: pick(V.tunic, 0), sleeve: pick(V.tunic, 0), trousers: pick(V.legs, 2), boots: 0x3a2a1c, belt: 0x4a3622, hair: pick(V.hair, 3), skin: pick(SKIN_TONES, 4) };
    if (woman) { o.robe = 'long'; o.robeColor = pick(V.skirt, 1); if (id % 3 === 0) o.scarf = pick(V.skirt, 5); }
    else if (id % 5 === 0) o.straw = 0xd8c07a;
    if (id % 7 === 3) o.apron = 0xe8e0cc;
    return o;
  }
  const base = OUTFITS[ch.look];
  if (base) return Object.assign({ skin: ch.look === 'guard' ? pick(SKIN_TONES, 2) : SKIN_TONES[0] }, base);
  // the arena ranger: armoured suit in the team colour, full helmet with a glowing visor, backpack
  const pal = MODEL_PALETTE[((ch.team || ch.id) % MODEL_PALETTE.length + MODEL_PALETTE.length) % MODEL_PALETTE.length];
  return { shirt: pal.suit, sleeve: pal.suit, trousers: pal.trim, boots: pal.suit, belt: pal.trim, gloves: pal.trim, ranger: pal.suit, visor: pal.visor, backpack: pal.trim, skin: SKIN_TONES[0] };
}

/** Geometry for every body segment of an outfit (cached: people who look alike share it). */
const BodyGeometry = {
  cache: new Map(),
  get(o) {
    const key = JSON.stringify(o);
    let g = this.cache.get(key);
    if (!g) { g = this.build(o); this.cache.set(key, g); }
    return g;
  },

  build(o) {
    const K = BodyKit, R = RIG, skin = o.skin, S = {};
    const darkSkin = new THREE.Color(skin).multiplyScalar(0.85).getHex();
    // legs: thigh, shin (with knee and boot), foot - each hanging down from its joint
    S.thigh = K.merge([K.cyl(0.086, 0.066, R.THIGH, o.trousers, 0, -R.THIGH / 2, 0)]);
    S.shin = K.merge([
      K.sph(0.066, o.trousers, 0, 0, 0),
      K.cyl(0.064, 0.05, R.SHIN, o.trousers, 0, -R.SHIN / 2, 0),
      K.cyl(0.067, 0.06, 0.22, o.boots, 0, -R.SHIN + 0.11, 0),
    ]);
    S.foot = K.merge([K.box(0.1, 0.07, 0.2, o.boots, 0, -0.035, -0.04), K.sph(0.052, o.boots, 0, -0.035, -0.14, 1, 0.68, 1.1)]);
    // hips: pelvis and belt
    S.pelvis = K.merge([
      K.cyl(0.152, 0.162, 0.17, o.trousers, 0, -0.04, 0, 0, 0, 0, 1, 1, 0.72),
      K.torus(0.157, 0.024, o.belt, 0, 0.03, 0, Math.PI / 2, 0, 0, 1, 0.72, 1),
      K.box(0.05, 0.045, 0.02, o.trim || 0x9a8a5a, 0, 0.03, -0.118),
    ]);
    // the torso from the waist up: chest, shoulders, neck, and whatever is worn over it
    const T = [
      K.cyl(0.19, 0.152, 0.46, o.shirt, 0, 0.23, 0, 0, 0, 0, 1, 1, 0.64),
      K.sph(0.082, o.shirt, -R.SHOULDER_X + 0.01, R.SHOULDER_Y - 0.01, 0, 1, 0.9, 0.9),
      K.sph(0.082, o.shirt, R.SHOULDER_X - 0.01, R.SHOULDER_Y - 0.01, 0, 1, 0.9, 0.9),
      K.cyl(0.05, 0.056, 0.12, skin, 0, 0.5, 0),
    ];
    if (o.tabard) {
      T.push(K.box(0.3, 0.66, 0.022, o.tabard, 0, 0.13, -0.128), K.box(0.3, 0.66, 0.022, o.tabard, 0, 0.13, 0.128));
      T.push(K.box(0.07, 0.07, 0.01, o.trim || 0xd8c070, 0, 0.3, -0.142, 0, 0, Math.PI / 4));          // a badge
    }
    if (o.apron) T.push(K.box(0.3, 0.72, 0.02, o.apron, 0, 0.08, -0.13));
    if (o.sash) T.push(K.box(0.07, 0.5, 0.02, o.trim, 0.02, 0.22, -0.124, 0, 0, 0.55));
    if (o.chain) T.push(K.torus(0.1, 0.012, o.chain, 0, 0.36, -0.06, 1.25, 0, 0));
    if (o.collar) T.push(K.cyl(0.075, 0.115, 0.06, o.collar, 0, 0.47, 0));
    if (o.hood) T.push(K.cyl(0.13, 0.25, 0.17, o.hood, 0, 0.415, 0, 0, 0, 0, 1, 1, 0.78));            // mantle over the shoulders
    if (o.backpack) T.push(K.box(0.3, 0.34, 0.13, o.backpack, 0, 0.26, 0.17), K.box(0.26, 0.06, 0.14, o.backpack, 0, 0.45, 0.16));
    if (o.ranger) T.push(K.box(0.36, 0.3, 0.03, o.ranger, 0, 0.28, -0.125));                         // chest plate
    S.torso = K.merge(T);
    // head (pivot at the base of the neck)
    const H = [
      K.sph(0.115, skin, 0, 0.16, 0, 0.92, 1.08, 1),
      K.sph(0.026, skin, -0.108, 0.16, 0, 0.5, 1, 0.9), K.sph(0.026, skin, 0.108, 0.16, 0, 0.5, 1, 0.9),
      K.box(0.026, 0.045, 0.034, darkSkin, 0, 0.152, -0.116),
      K.box(0.045, 0.01, 0.012, 0x7a3a30, 0, 0.108, -0.104),
    ];
    if (!o.ranger) {
      H.push(K.sph(0.017, 0x1a1a1e, -0.041, 0.182, -0.098), K.sph(0.017, 0x1a1a1e, 0.041, 0.182, -0.098));
      H.push(K.box(0.04, 0.008, 0.01, o.hair || 0x3a2a1a, -0.041, 0.207, -0.103), K.box(0.04, 0.008, 0.01, o.hair || 0x3a2a1a, 0.041, 0.207, -0.103));
    }
    if (o.hair && !o.hood && !o.helmet && !o.ranger) {
      H.push(K.cap(0.124, o.hair, 1.45, 0, 0.17, 0.006, 0.94, 1.0, 1.02));
      H.push(K.sph(0.11, o.hair, 0, 0.14, 0.03, 0.95, 0.9, 0.9));                                     // the back of the head
    }
    if (o.hood) {
      H.push(K.hood(0.142, o.hood, 0, 0.17, 0.012));
      H.push(K.cone(0.05, 0.1, o.hood, 0, 0.29, -0.1, -1.1, 0, 0));                                    // the hood's peak
      H.push(K.cone(0.11, 0.2, o.hood, 0, 0.08, 0.1, 0.35, 0, 0, 1, 1, 0.5));                           // drape down the back
    }
    if (o.helmet) {
      H.push(K.cap(0.135, o.helmet, Math.PI / 2, 0, 0.19, 0));
      H.push(K.cyl(0.205, 0.205, 0.016, o.helmet, 0, 0.192, 0));
      if (o.plume) H.push(K.cone(0.035, 0.24, o.plume, 0, 0.42, 0.02, 0.25, 0, 0));
    }
    if (o.ranger) {
      H.push(K.sph(0.138, o.ranger, 0, 0.17, 0, 1, 1.02, 1.04));
      H.push(K.box(0.05, 0.12, 0.05, o.backpack, 0.11, 0.3, 0.06));                                    // antenna stub
    }
    if (o.tophat) H.push(K.cyl(0.095, 0.1, 0.2, o.tophat, 0, 0.36, 0), K.cyl(0.16, 0.16, 0.016, o.tophat, 0, 0.262, 0), K.cyl(0.101, 0.101, 0.035, 0x6a1a1a, 0, 0.285, 0));
    if (o.cap) H.push(K.cap(0.128, o.cap, 1.2, 0, 0.19, 0), K.box(0.14, 0.012, 0.08, o.cap, 0, 0.215, -0.13, 0.15, 0, 0));
    if (o.straw) H.push(K.cyl(0.24, 0.24, 0.014, o.straw, 0, 0.245, 0), K.cyl(0.1, 0.115, 0.09, o.straw, 0, 0.29, 0));
    if (o.scarf) H.push(K.hood(0.13, o.scarf, 0, 0.17, 0.01));
    if (o.beard) H.push(K.cone(0.07, 0.17, o.beard, 0, 0.03, -0.07, Math.PI + 0.25, 0, 0));
    S.head = K.merge(H);
    // arms: upper arm, then forearm + hand (two variants, the thumb on the inside)
    S.upper = K.merge([K.cyl(0.056, 0.048, R.UPPER, o.sleeve, 0, -R.UPPER / 2, 0)]);
    const forearm = (side) => {
      const handC = o.gloves || skin, F = [
        K.sph(0.05, o.sleeve, 0, 0, 0),
        K.cyl(0.048, 0.038, R.FORE, o.rolled ? skin : o.sleeve, 0, -R.FORE / 2, 0),
        K.box(0.068, 0.082, 0.04, handC, 0, -R.FORE - 0.04, 0),
        K.box(0.064, 0.05, 0.034, handC, 0, -R.FORE - 0.095, -0.012, 0.35, 0, 0),
        K.box(0.022, 0.045, 0.024, handC, side * 0.04, -R.FORE - 0.035, -0.018, 0, 0, side * 0.3),
      ];
      if (o.bracers) F.push(K.cyl(0.052, 0.046, 0.12, o.bracers, 0, -R.FORE + 0.075, 0));
      if (o.gloves) F.push(K.cyl(0.046, 0.044, 0.05, o.gloves, 0, -R.FORE + 0.02, 0));
      return K.merge(F);
    };
    S.foreL = forearm(1);
    S.foreR = forearm(-1);
    // robe tails / long robe / coat: hangs from the waist
    if (o.robe) {
      const len = o.robe === 'long' ? 0.84 : o.robe === 'coat' ? 0.62 : 0.54;
      const open = o.robe === 'long' ? 0 : o.robe === 'coat' ? 0.5 : 0.9;
      const bottom = o.robe === 'long' ? 0.3 : 0.27;
      S.skirt = K.merge([K.shell(0.172, bottom, len, o.robeColor, open, 0, -len / 2 + 0.04, 0)]);
      S.skirtLen = len;
    }
    if (o.cape) S.cape = K.merge([K.box(0.38, 0.84, 0.02, o.cape, 0, -0.42, 0)]);
    return S;
  },
};

/**
 * Held weapons, shared by the character models and the first-person view. Built along -z from the
 * point the hand grips (the origin), vertex-coloured, merged, cached.
 */
const WeaponGeometry = {
  cache: new Map(),
  get(kind) {
    let g = this.cache.get(kind);
    if (!g) { g = this[kind](); this.cache.set(kind, g); }
    return g;
  },

  /** A blade with a diamond cross-section (edges left and right), a fuller, crossguard, wrapped grip, pommel. */
  _sword(o) {
    const K = BodyKit, P = [], L = o.length, z0 = -0.085;
    const blade = (rt, rb, h, color, z, w, t) => K.place(new THREE.CylinderGeometry(rt, rb, h, 4, 1), color, 0, 0, z, -Math.PI / 2, 0, 0, w, 1, t);
    P.push(blade(0.62, 1, L, o.steel, z0 - L / 2, o.width / 2, 0.007));
    P.push(blade(0, 0.62, o.tip, o.steel, z0 - L - o.tip / 2, o.width / 2, 0.007));
    P.push(K.box(0.009, 0.0152, L * 0.72, o.fuller, 0, 0, z0 - L * 0.4));                         // the fuller, both faces
    P.push(K.box(o.guard, 0.026, 0.034, o.brass, 0, 0, -0.065));                                     // crossguard
    P.push(K.sph(0.02, o.brass, -o.guard / 2, 0, -0.065), K.sph(0.02, o.brass, o.guard / 2, 0, -0.065));
    P.push(K.cyl(0.019, 0.021, 0.18, o.grip, 0, 0, 0.035, Math.PI / 2, 0, 0));                       // grip
    for (let i = 0; i < 5; i++) P.push(K.torus(0.021, 0.0035, o.wrap, 0, 0, -0.035 + i * 0.035));
    P.push(K.sph(0.03, o.brass, 0, 0, 0.14, 1, 1, 1.2));                                             // pommel
    if (o.knuckle) K.seg([0.0, -0.02, -0.06], [0.0, -0.06, 0.06], 0.008, 0.008, o.brass, P);       // sabre knuckle bow
    return K.merge(P);
  },
  longsword() { return this._sword({ length: 0.74, width: 0.05, tip: 0.1, guard: 0.24, steel: 0xd9dee6, fuller: 0x8d96a4, brass: 0xc8a050, grip: 0x4a3020, wrap: 0x2a1a10 }); },
  sword() { return this._sword({ length: 0.66, width: 0.036, tip: 0.08, guard: 0.13, steel: 0xc9ced8, fuller: 0x8a919c, brass: 0x9a8040, grip: 0x3e2a1c, wrap: 0x25170e, knuckle: true }); },

  /** A recurve bow standing along y, grip at the origin, limbs curving back towards the archer (+z). */
  bow() {
    const K = BodyKit, P = [];
    P.push(K.cyl(0.024, 0.024, 0.26, 0x4a2e1a, 0, 0, 0));                                             // riser
    P.push(K.cyl(0.027, 0.027, 0.11, 0x2a1a10, 0, 0, 0));                                             // leather grip
    P.push(K.box(0.01, 0.03, 0.03, 0xc8b89a, 0.026, 0.065, 0));                                       // arrow rest
    for (const sy of [1, -1]) {
      let prev = [0, sy * 0.12, 0];
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, y = sy * (0.12 + 0.5 * t), z = 0.17 * t * t - (t > 0.8 ? (t - 0.8) * 0.5 : 0);
        const cur = [0, y, z];
        K.seg(prev, cur, 0.022 - 0.011 * (t - 1 / 8), 0.022 - 0.011 * t, i % 2 ? 0x8a5a30 : 0x7a4e28, P);
        prev = cur;
      }
      P.push(K.sph(0.014, 0xe8e0c8, 0, prev[1], prev[2]));                                            // horn tips
    }
    return K.merge(P);
  },
};

/** A bow with a live string and a nocked arrow: draw(0..1) pulls the string (and arrow) back. */
class BowRig {
  constructor(mat) {
    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(WeaponGeometry.get('bow'), mat));
    this.tipY = 0.62; this.tipZ = 0.17 - 0.1;                                                        // where the limbs end
    const strMat = new THREE.MeshBasicMaterial({ color: 0xe8e4d4 });
    this.strMat = strMat;
    const line = new THREE.CylinderGeometry(0.004, 0.004, 1, 4, 1);
    this.top = new THREE.Mesh(line, strMat); this.bot = new THREE.Mesh(line, strMat);
    this.arrow = new THREE.Mesh(Projectile.arrowGeometry(), mat);
    this.arrow.rotation.y = Math.PI;
    this.group.add(this.top, this.bot, this.arrow);
    this.lineGeo = line;
    this.set(0, true);
  }

  /** Pull the string back by `d` (0..1); `nocked` shows the arrow. Returns the nock point (bow space). */
  set(d, nocked) {
    const nz = this.tipZ + 0.42 * d, ny = 0.0;
    const span = (m, ty) => {
      const dy = ty - ny, dz = this.tipZ - nz, L = Math.hypot(dy, dz);
      m.position.set(0, (ty + ny) / 2, (this.tipZ + nz) / 2);
      m.scale.set(1, L, 1);
      m.rotation.set(Math.atan2(dz, dy), 0, 0);
    };
    span(this.top, this.tipY); span(this.bot, -this.tipY);
    this.arrow.visible = !!nocked;
    this.arrow.position.set(0.024, 0.0, nz - 0.39);
    this.nockZ = nz;
    return nz;
  }

  dispose() { this.lineGeo.dispose(); }
}

/** Sun and sky light for characters (the terrain has its own shader lighting). One rig per scene. */
const CharacterLights = {
  rigs: new Map(),
  install(scene) {
    if (this.rigs.has(scene)) return;
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x50443a, 0.9);
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(0.45, 1, 0.3);
    scene.add(hemi, sun);
    this.rigs.set(scene, { hemi, sun });
  },
  /** Follow the day/night light colour the terrain uses. */
  update(light) {
    const b = (light.r + light.g + light.b) / 3;
    for (const { hemi, sun } of this.rigs.values()) {
      hemi.color.copy(light);
      hemi.intensity = 0.3 + 0.62 * b;
      sun.color.copy(light);
      sun.intensity = 0.08 + 0.62 * b;
    }
  },
};

class CharacterModel {
  constructor(ch, scene) {
    const o = outfitFor(ch), S = BodyGeometry.get(o), R = RIG;
    if (scene) CharacterLights.install(scene);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.mats = [this.mat];
    const group = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const mesh = (geo, parent, mat) => { const m = new THREE.Mesh(geo, mat || this.mat); parent.add(m); return m; };

    this.root = new THREE.Group();
    this.body = group(this.root, 0, 0, 0);
    this.body.rotation.order = 'YXZ';
    // legs
    this.hips = group(this.body, 0, R.HIP_Y, 0);
    mesh(S.pelvis, this.hips);
    const leg = (side) => {
      const thigh = group(this.hips, side * R.HIP_X, 0, 0);
      mesh(S.thigh, thigh);
      const shin = group(thigh, 0, -R.THIGH, 0);
      mesh(S.shin, shin);
      const foot = group(shin, 0, -R.SHIN, 0);
      mesh(S.foot, foot);
      return { thigh, shin, foot };
    };
    this.legL = leg(-1); this.legR = leg(1);
    if (S.skirt) { this.skirt = group(this.hips, 0, 0.02, 0); mesh(S.skirt, this.skirt); }
    // torso, head, arms
    this.torso = group(this.body, 0, R.HIP_Y, 0);
    mesh(S.torso, this.torso);
    this.head = group(this.torso, 0, R.NECK - 0.07, 0);
    mesh(S.head, this.head);
    if (o.visor) {
      const glow = new THREE.MeshBasicMaterial({ color: o.visor });
      glow.userData.glow = true;
      this.mats.push(glow);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.03), glow); v.position.set(0, 0.18, -0.13); this.head.add(v);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), glow); c.position.set(0, 0.32, -0.145); this.torso.add(c);
      this.glowGeo = [v.geometry, c.geometry];
    }
    if (S.cape) { this.cape = group(this.torso, 0, R.SHOULDER_Y + 0.02, 0.13); mesh(S.cape, this.cape); }
    const arm = (side) => {
      const shoulder = group(this.torso, side * R.SHOULDER_X, R.SHOULDER_Y, 0);
      mesh(S.upper, shoulder);
      const elbow = group(shoulder, 0, -R.UPPER, 0);
      mesh(side < 0 ? S.foreL : S.foreR, elbow);
      const hand = group(elbow, 0, -R.FORE - 0.06, 0);
      return { shoulder, elbow, hand };
    };
    this.armL = arm(-1); this.armR = arm(1);

    // what the right hand can hold: a gun, a sword, the wrist blade (all built now, so the self-layer covers them)
    const steel = this._basic(0xd8dde4), dark = this._basic(0x3b3f4a);
    this.gun = new THREE.Group();
    const box = (w, h, d, m, x, y, z, parent) => { const b = new THREE.Mesh(ShadedBox.get(w, h, d), m); b.position.set(x, y, z); parent.add(b); return b; };
    box(0.1, 0.13, 0.6, dark, 0, 0.02, -0.18, this.gun);
    box(0.06, 0.15, 0.09, dark, 0, -0.08, 0.02, this.gun);
    this.gunAccent = box(0.11, 0.035, 0.3, this._basic(0xffffff), 0, 0.09, -0.2, this.gun);
    this.gun.rotation.x = -Math.PI / 2;
    this.armR.hand.add(this.gun);
    // swords: the Order's straight sword and the enforcers' sabre (proper blades, lit like the body)
    this.swords = { longsword: new THREE.Mesh(WeaponGeometry.get('longsword'), this.mat), sword: new THREE.Mesh(WeaponGeometry.get('sword'), this.mat) };
    for (const m of Object.values(this.swords)) { m.position.y = -0.02; this.armR.hand.add(m); }
    // the bow, in the left hand: upright when the arm points forward, string towards us
    this.bow = new BowRig(this.mat);
    this.bow.group.rotation.x = -Math.PI / 2;
    this.bow.group.position.y = -0.03;
    this.armL.hand.add(this.bow.group);
    this.bow.strMat.userData.base = new THREE.Color(0xe8e4d4);
    this.mats.push(this.bow.strMat);
    this.blade = box(0.02, 0.03, 0.3, steel, 0, 0.0, 0, this.armR.hand);
    this.blade.rotation.x = -Math.PI / 2;
    this.blade.position.set(0, -0.08, 0.02);

    this.walk = 0;
    this.speedS = 0;
  }

  _basic(hex) {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: hex });
    m.userData.base = new THREE.Color(hex);
    this.mats.push(m);
    return m;
  }

  update(ch, frameDt) {
    this.root.position.copy(ch.pos);
    const b = this.body;
    b.rotation.set(0, ch.yaw, 0);
    b.position.set(0, 0, 0);
    const speed = Math.hypot(ch.vel.x, ch.vel.z);
    this.speedS += (speed - this.speedS) * Math.min(1, frameDt * 10);
    const moving = this.speedS > 0.3 && (ch.onGround || ch.inWater);
    const run = Math.min(1, Math.max(0, (this.speedS - 4.5) / 2.5));
    this.walk += frameDt * (moving ? this.speedS * (ch.sneaking ? 3.4 : 2.1) : 0);
    const t = this.walk, amp = moving ? Math.min(1, this.speedS / 4.4) : 0;
    const now = performance.now() / 1000;
    const L = this.legL, Rr = this.legR, AL = this.armL, AR = this.armR;
    const set = (g, x, y, z) => g.rotation.set(x, y || 0, z || 0);
    // tip the whole body forward about the hips (dives, gliding)
    const tilt = (a) => {
      const h = RIG.HIP_Y, oy = h * (1 - Math.cos(a)), oz = -h * Math.sin(a);
      b.rotation.x = a;
      b.position.set(oz * Math.sin(ch.yaw), oy, oz * Math.cos(ch.yaw));
    };
    // ---- defaults: walk / run / stand
    const A = (0.5 + 0.35 * run) * amp, K = (0.65 + 0.6 * run) * amp;
    set(L.thigh, Math.sin(t) * A); set(Rr.thigh, -Math.sin(t) * A);
    set(L.shin, -Math.max(0, Math.cos(t)) * K - 0.05 * amp); set(Rr.shin, -Math.max(0, -Math.cos(t)) * K - 0.05 * amp);
    set(L.foot, 0); set(Rr.foot, 0);
    set(AL.shoulder, -Math.sin(t) * A * 0.9, 0, -0.06); set(AR.shoulder, Math.sin(t) * A * 0.9, 0, 0.06);
    set(AL.elbow, 0.2 + 0.5 * run * amp); set(AR.elbow, 0.2 + 0.5 * run * amp);
    let lean = -0.18 * run * amp + Math.sin(t * 2) * 0.02 * amp, drop = -Math.abs(Math.sin(t)) * 0.03 * amp;
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(ch.pitch * 0.7, 0, 0);
    if (!moving) this.torso.scale.y = 1 + Math.sin(now * 1.8 + (ch.id || 0)) * 0.006;                // breathing
    else this.torso.scale.y = 1;

    const held = ch.heldStack();
    const it = held && ITEMS[held.id];
    const hasBow = !!(it && it.bow);
    const hasGun = !!(it && it.kind === 'weapon' && !it.thrown && !hasBow);
    const hasSword = !!(it && it.kind === 'blade' && it.blade && it.blade.visible);
    this.gun.visible = hasGun;
    for (const k in this.swords) this.swords[k].visible = hasSword && it.id === k;
    this.bow.group.visible = hasBow;
    const draw = hasBow ? ch.draw || 0 : 0;
    if (hasBow) this.bow.set(draw, !ch.reload && held.data.mag > 0);
    set(AR.hand, 0); set(AL.hand, 0);
    const strike = ch.game ? Math.max(0, (ch.strikeUntil || 0) - ch.game.time) : 0;
    this.blade.visible = strike > 0 && !hasSword;
    this.blade.position.z = strike > 0 ? -0.12 : 0.02;

    if (!ch.alive && ch.corpse) {
      // lying face down where they fell
      b.rotation.x = -Math.PI / 2 + 0.05; b.position.y = 0.16;
      set(L.thigh, 0.1, 0, -0.1); set(Rr.thigh, -0.05, 0, 0.12); set(L.shin, -0.2); set(Rr.shin, -0.05);
      set(AL.shoulder, Math.PI * 0.85, 0, -0.4); set(AR.shoulder, 0.4, 0, 0.5); set(AL.elbow, 0.3); set(AR.elbow, 0.5);
      this.head.rotation.set(0.2, 0.6, 0);
      lean = 0; drop = 0;
    } else if (ch.leap) {
      // leap of faith: head first, arms spread wide
      tilt(-1.15); lean = -0.1;
      set(AL.shoulder, Math.PI * 0.55, 0, -1.25); set(AR.shoulder, Math.PI * 0.55, 0, 1.25);
      set(AL.elbow, 0.1); set(AR.elbow, 0.1);
      set(L.thigh, -0.25); set(Rr.thigh, -0.1); set(L.shin, -0.4); set(Rr.shin, -0.2);
    } else if (ch.gliding) {
      set(AL.shoulder, 0.3, 0, -1.3); set(AR.shoulder, 0.3, 0, 1.3);
      set(L.thigh, -0.3); set(Rr.thigh, -0.15); set(L.shin, -0.5); set(Rr.shin, -0.4);
      tilt(-0.45); lean = 0;
    } else if (ch.climbing) {
      const c = Math.sin(now * 7);
      set(AL.shoulder, Math.PI - 0.35 + c * 0.35, 0, -0.15); set(AR.shoulder, Math.PI - 0.35 - c * 0.35, 0, 0.15);
      set(AL.elbow, 0.6 - c * 0.4); set(AR.elbow, 0.6 + c * 0.4);
      set(L.thigh, 0.7 + c * 0.45); set(Rr.thigh, 0.7 - c * 0.45); set(L.shin, -1.1 - c * 0.3); set(Rr.shin, -1.1 + c * 0.3);
      lean = 0.08;
    } else if (ch.vehicle) {
      set(L.thigh, Math.PI / 2 - 0.1); set(Rr.thigh, Math.PI / 2 - 0.1); set(L.shin, -Math.PI / 2 + 0.1); set(Rr.shin, -Math.PI / 2 + 0.1);
      set(AL.shoulder, 0.9); set(AR.shoulder, 0.9); set(AL.elbow, 0.5); set(AR.elbow, 0.5);
      lean = 0; drop = 0;
    } else if (ch.sneaking) {
      // crouched, light steps
      const s = Math.sin(t) * 0.35 * amp;
      set(L.thigh, 0.85 + s); set(Rr.thigh, 0.85 - s);
      set(L.shin, -1.25 - Math.max(0, Math.cos(t)) * 0.3 * amp); set(Rr.shin, -1.25 - Math.max(0, -Math.cos(t)) * 0.3 * amp);
      set(L.foot, 0.4); set(Rr.foot, 0.4);
      set(AL.shoulder, 0.5 - s * 0.5, 0, -0.1); set(AR.shoulder, 0.5 + s * 0.5, 0, 0.1);
      set(AL.elbow, 0.9); set(AR.elbow, 0.9);
      lean = -0.45; drop = -0.18;
      this.head.rotation.x = ch.pitch * 0.7 + 0.35;
    } else if (!ch.onGround && !ch.inWater && ch.alive) {
      // in the air: knees up, arms out a little
      set(L.thigh, 0.55); set(Rr.thigh, -0.1); set(L.shin, -0.9); set(Rr.shin, -0.45);
      set(AL.shoulder, 0.4, 0, -0.5); set(AR.shoulder, 0.4, 0, 0.5);
    }

    // arms for what's in hand (not while climbing / leaping / lying down)
    const free = ch.alive && !ch.climbing && !ch.leap && !ch.gliding && !ch.vehicle;
    if (free && hasGun) {
      set(AR.shoulder, Math.PI / 2 + ch.pitch, 0, 0.05); set(AR.elbow, 0.15);
      set(AL.shoulder, Math.PI / 2 + ch.pitch + 0.1, 0, 0.45); set(AL.elbow, 0.55);
      this.gunAccent.material.userData.base.set(CONFIG.RARITY[held.data.rarity].color);
    } else if (free && hasBow) {
      // bow arm straight out, the draw hand pulling the string back to the cheek
      set(AL.shoulder, Math.PI / 2 + ch.pitch, 0, 0.12); set(AL.elbow, 0.05);
      set(AR.shoulder, Math.PI / 2 + ch.pitch - 0.15 * draw, 0, -0.45 + 0.1 * draw); set(AR.elbow, 0.5 + 1.8 * draw);
      if (!draw) { set(AL.shoulder, 0.5 + ch.pitch * 0.5, 0, 0.1); set(AL.elbow, 0.4); set(AR.shoulder, 0.25, 0, -0.1); set(AR.elbow, 0.5); }
    } else if (free && hasSword && ch.blocking) {
      // sword raised across the body
      set(AR.shoulder, 1.15, 0, -0.55); set(AR.elbow, 1.0); set(AR.hand, 0, -1.3, 0);
      set(AL.shoulder, 0.6, 0, 0.2); set(AL.elbow, 0.9);
    } else if (free && hasSword) {
      set(AR.shoulder, 0.55, 0, 0.12); set(AR.elbow, 0.9);
    }
    let twist = 0;
    if (ch.alive && strike > 0) {
      const k = Math.min(1, strike / 0.3), u = 1 - k;
      if (hasSword && strike > 0.3) { set(AR.shoulder, Math.PI - 0.25, 0, 0.3); set(AR.elbow, 1.3); lean += 0.1; }     // the wind-up: a counter chance
      else if (hasSword && (ch.combo === 0 || ch.combo === 1)) {
        // a sweeping cut: the body turns through it, the sword flat
        const dir = ch.combo === 0 ? 1 : -1, e = u * u * (3 - 2 * u);
        twist = dir * (0.9 - 1.8 * e);
        set(AR.shoulder, Math.PI / 2 - 0.15, 0, dir * (0.5 - 1.1 * e)); set(AR.elbow, 0.25); set(AR.hand, 0, dir * 1.3, 0);
        lean -= 0.12;
      } else if (hasSword) { set(AR.shoulder, 0.7 + k * 2.2, 0, 0.1); set(AR.elbow, 0.2 + k * 1.1); lean -= 0.15 * (1 - k); }
      else { set(AR.shoulder, Math.PI / 2 + ch.pitch * 0.5 - k * 0.6, 0, 0.05); set(AR.elbow, 0.05 + k * 0.5); lean -= 0.12; }
    }
    this.torso.rotation.x = lean;
    this.torso.rotation.y = twist;
    b.position.y += drop;
    // robes and capes trail behind when moving or falling
    const flap = Math.min(0.55, this.speedS * 0.07) + (ch.onGround || ch.climbing ? 0 : 0.25);
    if (this.skirt) this.skirt.rotation.x = ch.sneaking ? 0.5 : -flap * 0.6 + (moving ? Math.sin(t * 2) * 0.04 : 0);
    if (this.cape) this.cape.rotation.x = -flap - Math.max(0, -lean) * 0.5;
    // hit flash
    const hurt = ch.alive && ch.game && ch.game.time - ch.lastDamageTime < 0.12;
    this.mat.emissive.setRGB(hurt ? 0.55 : 0, hurt ? 0.12 : 0, hurt ? 0.1 : 0);
    if (this.light) for (const m of this.mats) if (m.userData.base && !m.userData.glow) m.color.copy(m.userData.base).multiply(this.light);
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const m of this.mats) m.dispose();
    if (this.glowGeo) for (const g of this.glowGeo) g.dispose();
    this.bow.dispose();
  }
}

/** main.js calls this once per frame with the terrain light colour: characters follow day and night. */
CharacterModel.setLight = function (game, light) {
  CharacterLights.update(light);
  for (const e of game.entities.values()) if (e.model) { if (!e.model.light) e.model.light = new THREE.Color(); e.model.light.copy(light); }
};
