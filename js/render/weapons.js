/* ============================================================
 * The swords, the bow, the scabbard and the quiver as real objects: each a few meshes lofted from cross-sections,
 * in metal, leather, wood and horn that take the sun, the sky (CharShading's environment) and the sun's shadow.
 *
 *   longsword  the Order's arming sword: a diamond-section blade with a fuller, tapering in width and thickness to an
 *              ogival point; a crossguard that bows towards the blade and flares at its ends; a grip of leather wound
 *              in a spiral; a wheel pommel and brass rings.
 *   sword      the enforcers' khopesh, the sickle sword of the river: a bronze shaft running into a hooked blade
 *              sharpened on its outer curve, a wooden grip with bronze collars.
 *   bow        a composite recurve: a wooden riser with a leather grip, limbs that taper and recurve, horn tips.
 *   scabbard   leather over wood with a brass throat, a band and a chape; `hilt` is the sheathed sword's hilt above it.
 *   quiver     a leather tube with a strap and a rim, arrows with fletching standing out of it.
 *
 * Model space as before (render/models.js): a sword's grip at the origin with the blade along -z, its width along x;
 * the bow upright along y, the grip at the origin, limbs bending back towards +z and the string's ends at
 * (0, +-0.62, 0.07). WeaponModels.make(kind, { fp }) returns a new group (geometry and materials are shared);
 * `fp` is for the first-person view (no world shadow there).
 * ============================================================ */
const WeaponModels = {
  geo: new Map(),
  mats: new Map(),

  /** A shared material: metal / leather / wood / horn ... (fp: the first-person variant). */
  mat(name, fp) {
    const key = name + (fp ? ':fp' : '');
    let m = this.mats.get(key);
    if (m) return m;
    const D = {
      steel:   { color: 0xdde2e9, metalness: 1, roughness: 0.2, env: 1.25, detail: 'metal' },
      darksteel: { color: 0x9aa2ad, metalness: 1, roughness: 0.35, env: 1.0, detail: 'metal' },
      brass:   { color: 0xd6a650, metalness: 1, roughness: 0.3, env: 1.1, detail: 'metal' },
      bronze:  { color: 0xc8904a, metalness: 1, roughness: 0.34, env: 1.0, detail: 'metal' },
      leather: { color: 0x3c2617, metalness: 0, roughness: 0.68, env: 0.35, detail: 'wood' },
      leather2: { color: 0x5a3820, metalness: 0, roughness: 0.62, env: 0.35, detail: 'wood' },
      wood:    { color: 0x7a4c2a, metalness: 0, roughness: 0.55, env: 0.3, detail: 'wood' },
      darkwood: { color: 0x4a2e1a, metalness: 0, roughness: 0.5, env: 0.3, detail: 'wood' },
      horn:    { color: 0xe4d8bf, metalness: 0, roughness: 0.38, env: 0.45, detail: 'metal' },
      fletch:  { color: 0xe9e2d2, metalness: 0, roughness: 0.8, env: 0.2, detail: '', double: true },
      sinew:   { color: 0xb08a58, metalness: 0, roughness: 0.6, env: 0.3, detail: 'wood' },
    }[name];
    m = new THREE.MeshStandardMaterial({ color: D.color, metalness: D.metalness, roughness: D.roughness, side: D.double ? THREE.DoubleSide : THREE.FrontSide });
    m.envMap = CharShading.env; m.envMapIntensity = D.env;
    m.onBeforeCompile = (sh) => CharShading.inject(sh, { detail: D.detail, shadow: !fp });
    m.customProgramCacheKey = () => 'weapon-' + D.detail + (fp ? '-fp' : '');
    this.mats.set(key, m);
    return m;
  },

  /** A new group for `kind` ('longsword', 'sword', 'bow', 'scabbard', 'hilt', 'quiver'). */
  make(kind, opts = {}) {
    let parts = this.geo.get(kind);
    if (!parts) { parts = this['_' + kind](); this.geo.set(kind, parts); }
    const g = new THREE.Group();
    for (const [geom, matName] of parts) {
      const mesh = new THREE.Mesh(geom, this.mat(matName, opts.fp));
      if (!opts.fp) mesh.layers.enable(SHADOW_LAYER);
      g.add(mesh);
    }
    return g;
  },

  // ---- building blocks -------------------------------------------------------------------------------------------

  /**
   * A loft: rings of cross-section points along a path. stations: [{ p, n, b, pts: [[x, y]...] }] (centre, the two
   * axes of the section, its points round it). smooth: normals shared round the ring (round things) or per face
   * (edged things). caps: close the ends.
   */
  loft(stations, smooth, caps) {
    const pos = [], nor = [], uv = [], idx = [];
    const P = stations.map((s) => s.pts.map(([x, y]) => new THREE.Vector3().copy(s.p).addScaledVector(s.n, x).addScaledVector(s.b, y)));
    const K = P[0].length, S = P.length;
    const along = (i, k) => P[Math.min(S - 1, i + 1)][k].clone().sub(P[Math.max(0, i - 1)][k]);
    let dist = [0];
    for (let i = 1; i < S; i++) dist.push(dist[i - 1] + stations[i].p.distanceTo(stations[i - 1].p));
    const push = (v, n, u, w) => { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(u, w); return pos.length / 3 - 1; };
    const out = (i, k, n) => { const c = stations[i].p; if (n.dot(P[i][k].clone().sub(c)) < 0) n.negate(); return n; };
    if (smooth) {
      const base = [];
      for (let i = 0; i < S; i++) {
        base.push(pos.length / 3);
        for (let k = 0; k <= K; k++) {
          const kk = k % K, a = along(i, kk), across = P[i][(kk + 1) % K].clone().sub(P[i][(kk - 1 + K) % K]);
          const n = out(i, kk, new THREE.Vector3().crossVectors(a, across).normalize());
          push(P[i][kk], n, k / K, dist[i]);
        }
      }
      for (let i = 0; i < S - 1; i++) for (let k = 0; k < K; k++) {
        const a = base[i] + k, b = base[i] + k + 1, c = base[i + 1] + k, d = base[i + 1] + k + 1;
        idx.push(a, c, b, b, c, d);
      }
    } else {
      for (let k = 0; k < K; k++) {
        const k2 = (k + 1) % K, first = pos.length / 3;
        for (let i = 0; i < S; i++) {
          const a = along(i, k).add(along(i, k2)), across = P[i][k2].clone().sub(P[i][k]);
          const n = new THREE.Vector3().crossVectors(a, across).normalize();
          const mid = P[i][k].clone().add(P[i][k2]).multiplyScalar(0.5).sub(stations[i].p);
          if (n.dot(mid) < 0) n.negate();
          push(P[i][k], n, k / K, dist[i]); push(P[i][k2], n, (k + 1) / K, dist[i]);
        }
        for (let i = 0; i < S - 1; i++) {
          const a = first + i * 2, b = a + 1, c = a + 2, d = a + 3;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
    if (caps) {
      for (const i of [0, S - 1]) {
        const c = stations[i].p, dir = (i === 0 ? stations[0].p.clone().sub(stations[1].p) : stations[S - 1].p.clone().sub(stations[S - 2].p)).normalize();
        const ci = push(c, dir, 0.5, dist[i]), ring = P[i].map((v) => push(v, dir, 0.5, dist[i]));
        for (let k = 0; k < K; k++) { if (i === 0) idx.push(ci, ring[(k + 1) % K], ring[k]); else idx.push(ci, ring[k], ring[(k + 1) % K]); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // the winding: make every triangle face along its vertices' normals
    const ia = g.index.array, pa = pos, na = nor;
    for (let t = 0; t < ia.length; t += 3) {
      const A = ia[t] * 3, B = ia[t + 1] * 3, C = ia[t + 2] * 3;
      const ux = pa[B] - pa[A], uy = pa[B + 1] - pa[A + 1], uz = pa[B + 2] - pa[A + 2], vx = pa[C] - pa[A], vy = pa[C + 1] - pa[A + 1], vz = pa[C + 2] - pa[A + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (fx * (na[A] + na[B] + na[C]) + fy * (na[A + 1] + na[B + 1] + na[C + 1]) + fz * (na[A + 2] + na[B + 2] + na[C + 2]) < 0) { const tmp = ia[t + 1]; ia[t + 1] = ia[t + 2]; ia[t + 2] = tmp; }
    }
    g.computeBoundingSphere();
    return g;
  },

  /** A ring of n points round an ellipse (rx, ry), optionally rounded-square (sq > 0). */
  ring(n, rx, ry, sq = 0, wob = null) {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const e = sq > 0 ? 1 / Math.pow(Math.pow(Math.abs(c), 2 + sq) + Math.pow(Math.abs(s), 2 + sq), 1 / (2 + sq)) : 1;
      const w = wob ? wob(a) : 1;
      pts.push([c * rx * e * w, s * ry * e * w]);
    }
    return pts;
  },

  /** A lathe along z (from z0 to z1) with radius profile r(t), t 0..1. */
  latheZ(z0, z1, r, n = 14, steps = 10, wob = null) {
    const st = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, z = z0 + (z1 - z0) * t, rr = Math.max(1e-4, r(t));
      st.push({ p: new THREE.Vector3(0, 0, z), n: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 1, 0), pts: this.ring(n, rr, rr, 0, wob ? (a) => wob(a, t) : null) });
    }
    return this.loft(st, true, true);
  },

  /**
   * Stations along a path of points with the section's x axis kept near `side`; or, for a flat curve, with its y axis
   * fixed (`fixedB`, the curve's plane normal) and x in the plane.
   */
  along(path, side, section, fixedB) {
    const st = [], s = side ? new THREE.Vector3().copy(side) : null;
    for (let i = 0; i < path.length; i++) {
      const t = path[Math.min(path.length - 1, i + 1)].clone().sub(path[Math.max(0, i - 1)]).normalize();
      let b, n;
      if (fixedB) { b = fixedB.clone(); n = new THREE.Vector3().crossVectors(b, t).normalize(); }
      else { b = new THREE.Vector3().crossVectors(t, s).normalize(); n = new THREE.Vector3().crossVectors(b, t).normalize(); }
      st.push({ p: path[i], n, b, pts: section(i / (path.length - 1), i) });
    }
    return st;
  },

  // ---- the weapons ----------------------------------------------------------------------------------------------

  _longsword() {
    const parts = [], L = 0.78, z0 = -0.072, W = 0.026, T = 0.0075;
    // the blade: stations from the guard to the point; diamond section with a fuller on both faces for 70% of it
    const st = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const s = i / N, z = z0 - s * L;
      const tipStart = 0.86, tp = s < tipStart ? 0 : (s - tipStart) / (1 - tipStart);
      const w = Math.max(0.0008, W * (1 - 0.22 * s) * Math.sqrt(Math.max(0, 1 - tp * tp)));
      const t = Math.max(0.0006, T * (1 - 0.45 * s) * (1 - 0.7 * tp));
      const f = s < 0.72 ? Math.min(1, s / 0.04, (0.72 - s) / 0.06) : 0;          // the fuller fades in and out
      const tf = t * (1 - 0.55 * f), fw = 0.34;
      st.push({ p: new THREE.Vector3(0, 0, z), n: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 1, 0),
        pts: [[w, 0], [w * 0.64, t * 0.72], [w * fw, t], [w * fw * 0.5, tf], [0, tf], [-w * fw * 0.5, tf], [-w * fw, t], [-w * 0.64, t * 0.72],
          [-w, 0], [-w * 0.64, -t * 0.72], [-w * fw, -t], [-w * fw * 0.5, -tf], [0, -tf], [w * fw * 0.5, -tf], [w * fw, -t], [w * 0.64, -t * 0.72]] });
    }
    parts.push([this.loft(st, false, true), 'steel']);
    // the crossguard: bowed towards the blade, flaring and rounding at its ends
    const gp = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16 * 2 - 1; gp.push(new THREE.Vector3(t * 0.115, 0, -0.058 - 0.014 * t * t)); }
    parts.push([this.loft(this.along(gp, new THREE.Vector3(0, 0, 1), (t) => { const e = Math.abs(t * 2 - 1); const r = 0.0085 + 0.006 * Math.pow(e, 3); return this.ring(10, r * 1.15, r * 1.35, 1.2); }), true, true), 'brass']);
    parts.push([this.latheZ(-0.074, -0.046, (t) => 0.019 - 0.004 * Math.abs(t - 0.5), 14, 4), 'brass']);       // the guard's block over the tang
    // the grip: swelling a little in the middle, leather wound round it in a spiral
    parts.push([this.latheZ(-0.046, 0.108, (t) => 0.0155 + 0.003 * Math.sin(Math.PI * t), 16, 24, (a, t) => 1 + 0.06 * Math.abs(Math.sin(a * 0.5 + t * 34))), 'leather']);
    parts.push([this.latheZ(0.104, 0.118, () => 0.0175, 14, 2), 'brass']);                                          // ferrule
    // the wheel pommel: a disc with a raised rim and a boss
    parts.push([this.latheZ(0.116, 0.162, (t) => 0.012 + 0.024 * Math.sin(Math.PI * t) - (t > 0.35 && t < 0.65 ? 0.004 : 0), 20, 12), 'brass']);
    parts.push([this.latheZ(0.16, 0.172, (t) => 0.008 * (1 - t * 0.7), 12, 3), 'brass']);
    return parts;
  },

  _sword() {
    // the khopesh: grip, a bronze shaft, then a crescent blade hooking forward; its edge on the outer curve
    const parts = [];
    parts.push([this.latheZ(-0.045, 0.11, (t) => 0.016 + 0.002 * Math.sin(Math.PI * t), 14, 10, (a, t) => 1 + 0.04 * Math.abs(Math.sin(a * 0.5 + t * 20))), 'darkwood']);
    parts.push([this.latheZ(0.104, 0.13, (t) => 0.019 - 0.004 * t, 14, 3), 'bronze']);
    parts.push([this.latheZ(-0.068, -0.042, (t) => 0.02 - 0.003 * t, 14, 3), 'bronze']);
    const path = [], R = 0.15, zS = -0.27;       // the shaft to zS, then an arc about (-R, 0, zS)
    for (let i = 0; i <= 10; i++) path.push(new THREE.Vector3(0, 0, -0.068 + (zS + 0.068) * i / 10));
    for (let i = 1; i <= 22; i++) { const a = (i / 22) * 2.35; path.push(new THREE.Vector3(-R * (1 - Math.cos(a)), 0, zS - R * Math.sin(a))); }
    parts.push([this.loft(this.along(path, null, (t, i) => {
      const inBlade = i > 10, bt = inBlade ? (i - 10) / 22 : 0;
      // the width grows into the blade and narrows to the hook's point; the outer side is the edge
      const w = inBlade ? 0.012 + 0.03 * Math.sin(Math.PI * Math.min(1, bt * 1.1)) * (1 - bt * 0.4) + 0.002 : 0.009;
      const th = inBlade ? 0.0055 * (1 - 0.6 * bt) + 0.0012 : 0.0085;
      const off = inBlade ? w * 0.45 : 0;
      // section in (n: across the curve, b: thickness); n points away from the curve's centre at the edge
      return [[w + off, 0], [w * 0.55 + off, th * 0.8], [-w * 0.6 + off, th], [-w + off, th * 0.6], [-w - 0.001 + off, 0], [-w + off, -th * 0.6], [-w * 0.6 + off, -th], [w * 0.55 + off, -th * 0.8]];
    }, new THREE.Vector3(0, -1, 0)), false, true), 'bronze']);       // x across the curve (the edge outwards), y the thickness
    return parts;
  },

  _bow() {
    const parts = [];
    // the riser and the grip
    const riser = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, y = -0.14 + 0.28 * t; riser.push(new THREE.Vector3(0, y, 0.004 * Math.sin(Math.PI * t))); }
    parts.push([this.loft(this.along(riser, new THREE.Vector3(1, 0, 0), (t) => this.ring(10, 0.017 + 0.004 * Math.sin(Math.PI * t), 0.022 + 0.004 * Math.sin(Math.PI * t), 0.6)), true, true), 'darkwood']);
    const grip = [];
    for (let i = 0; i <= 8; i++) grip.push(new THREE.Vector3(0, -0.058 + 0.116 * i / 8, 0.004));
    parts.push([this.loft(this.along(grip, new THREE.Vector3(1, 0, 0), (t, i) => this.ring(12, 0.0235 + 0.0012 * (i % 2), 0.0285 + 0.0012 * (i % 2), 0.5)), true, true), 'leather']);
    // the limbs: tapering, bending back and recurving at the tips (the string's ends at y = +-0.62, z = 0.07)
    for (const sy of [1, -1]) {
      const p = [];
      for (let i = 0; i <= 26; i++) { const t = i / 26, y = sy * (0.12 + 0.5 * t), z = 0.17 * t * t - (t > 0.8 ? (t - 0.8) * 0.5 : 0); p.push(new THREE.Vector3(0, y, z)); }
      parts.push([this.loft(this.along(p, new THREE.Vector3(1, 0, 0), (t) => this.ring(10, 0.016 - 0.008 * t, 0.009 - 0.0035 * t, 0.8)), true, true), 'wood']);
      // the belly in a lighter horn strip, the back in sinew
      const back = p.map((v, i) => v.clone().add(new THREE.Vector3(0, 0, -0.006 * (1 - i / 26))));
      parts.push([this.loft(this.along(back.slice(2, 22), new THREE.Vector3(1, 0, 0), (t) => this.ring(8, 0.012 - 0.005 * t, 0.003, 0.8)), true, true), 'sinew']);
      const tip = p.slice(21).map((v) => v.clone());
      parts.push([this.loft(this.along(tip, new THREE.Vector3(1, 0, 0), (t) => this.ring(8, 0.0095 - 0.003 * t, 0.0075 - 0.002 * t, 0.5)), true, true), 'horn']);
    }
    return parts;
  },

  _scabbard() {
    // hangs along -y from the throat at the origin, edge forward; the sheathed sword's hilt stands out of it upwards
    const parts = [], p = [];
    for (let i = 0; i <= 14; i++) p.push(new THREE.Vector3(0, -0.8 * i / 14, 0.004 * Math.sin(Math.PI * i / 14)));
    parts.push([this.loft(this.along(p, new THREE.Vector3(0, 0, 1), (t) => this.ring(12, 0.024 * (1 - 0.3 * t) + 0.003, 0.0105 * (1 - 0.2 * t) + 0.002, 0.7)), true, true), 'leather2']);
    const ring = (y0, y1, r) => { const q = [new THREE.Vector3(0, y0, 0), new THREE.Vector3(0, (y0 + y1) / 2, 0), new THREE.Vector3(0, y1, 0)]; return this.loft(this.along(q, new THREE.Vector3(0, 0, 1), () => this.ring(12, r[0], r[1], 0.7)), true, true); };
    parts.push([ring(0.005, -0.045, [0.03, 0.0145]), 'brass']);             // the throat
    parts.push([ring(-0.3, -0.322, [0.0262, 0.013]), 'brass']);            // a band
    parts.push([ring(-0.72, -0.81, [0.022, 0.0115]), 'brass']);            // the chape
    return parts;
  },

  /** The hilt of the sword in the scabbard, standing out of its throat (the scabbard's frame). */
  _hilt() {
    return this._longsword().slice(1).map(([g, m]) => [g.clone().rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.06, 0), m]);
  },

  _quiver() {
    // a leather tube along +y from its foot at the origin, with arrows standing out of the top
    const parts = [], p = [];
    for (let i = 0; i <= 10; i++) p.push(new THREE.Vector3(0, 0.62 * i / 10, 0));
    parts.push([this.loft(this.along(p, new THREE.Vector3(1, 0, 0), (t) => this.ring(14, 0.05 + 0.008 * t, 0.042 + 0.006 * t)), true, true), 'leather2']);
    const band = (y, r) => { const q = [new THREE.Vector3(0, y - 0.012, 0), new THREE.Vector3(0, y, 0), new THREE.Vector3(0, y + 0.012, 0)]; return this.loft(this.along(q, new THREE.Vector3(1, 0, 0), () => this.ring(14, r[0], r[1])), true, true); };
    parts.push([band(0.6, [0.061, 0.051]), 'leather']);
    parts.push([band(0.2, [0.055, 0.046]), 'leather']);
    parts.push([band(0.012, [0.052, 0.044]), 'brass']);
    // arrows: shafts and fletching
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4, r = 0.025 * Math.sqrt((k + 0.5) / 7), x = Math.cos(a) * r, z = Math.sin(a) * r, top = 0.74 + (k % 3) * 0.02;
      const shaft = [new THREE.Vector3(x, 0.4, z), new THREE.Vector3(x, top, z)];
      parts.push([this.loft(this.along(shaft, new THREE.Vector3(1, 0, 0), () => this.ring(6, 0.004, 0.004)), true, true), 'wood']);
      for (let f = 0; f < 3; f++) {
        const fa = f * 2.094 + k, fx = Math.cos(fa), fz = Math.sin(fa);
        const g = new THREE.BufferGeometry();
        const v = [x, top - 0.13, z, x + fx * 0.016, top - 0.1, z + fz * 0.016, x + fx * 0.014, top - 0.02, z + fz * 0.014, x, top - 0.01, z];
        g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        parts.push([g, 'fletch']);
      }
    }
    return parts;
  },
};
