/* ============================================================
 * Box-built vehicle models (original designs) + fuel barrel.
 * Front of every model is local -z (three.js forward for rotation.y
 * = yaw). Wheels spin with speed, the body pitches with climbing /
 * falling and rolls a little when drifting, lights glow, and a badly
 * damaged vehicle smokes.
 * ============================================================ */
class VehicleModel {
  constructor(kind) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.mats = [];
    this.wheels = [];
    this.visPitch = 0;
    this.visRoll = 0;
    const S = CONFIG.VEHICLES[kind];
    const [L, W] = S.size;
    const paint = this.mat(S.color), dark = this.mat(0x24272e), glass = this.mat(0x3a5f86), trim = this.mat(0xb8bec8);
    const tyre = this.mat(0x1b1d22), head = this.mat(0xfff3b0, true), tail = this.mat(0xff3a2a, true);
    const B = (w, h, d, m, x, y, z, parent) => {
      const mesh = new THREE.Mesh(ShadedBox.get(w, h, d), m);
      mesh.position.set(x, y, z);
      (parent || this.body).add(mesh);
      return mesh;
    };
    const wheel = (r, wdt, x, y, z) => {
      const g = new THREE.Group(); g.position.set(x, y, z);
      B(wdt, r * 2, r * 2, tyre, 0, 0, 0, g);
      B(wdt + 0.02, r * 0.9, r * 0.9, trim, 0, 0, 0, g);
      this.body.add(g); this.wheels.push(g);
    };
    switch (kind) {
      case 'car':
        B(W, 0.55, L, paint, 0, 0.55, 0);
        B(W * 0.9, 0.55, L * 0.48, glass, 0, 1.1, 0.25);
        B(W * 0.92, 0.08, L * 0.5, paint, 0, 1.41, 0.25);
        B(W + 0.04, 0.16, 0.2, dark, 0, 0.42, -L / 2);           // bumpers
        B(W + 0.04, 0.16, 0.2, dark, 0, 0.42, L / 2);
        B(0.3, 0.14, 0.06, head, -W / 2 + 0.3, 0.68, -L / 2 - 0.02); B(0.3, 0.14, 0.06, head, W / 2 - 0.3, 0.68, -L / 2 - 0.02);
        B(0.3, 0.12, 0.06, tail, -W / 2 + 0.3, 0.68, L / 2 + 0.02); B(0.3, 0.12, 0.06, tail, W / 2 - 0.3, 0.68, L / 2 + 0.02);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) wheel(0.32, 0.3, x * (W / 2 - 0.05), 0.32, z * L * 0.32);
        break;
      case 'sports':
        B(W, 0.4, L, paint, 0, 0.42, 0);
        B(W * 0.8, 0.38, L * 0.36, glass, 0, 0.8, 0.2);
        B(W * 0.98, 0.1, L * 0.3, paint, 0, 0.66, -L * 0.3);       // hood
        B(W * 0.9, 0.06, 0.32, dark, 0, 0.95, L / 2 - 0.12);        // spoiler
        B(0.08, 0.32, 0.08, dark, -W * 0.35, 0.78, L / 2 - 0.12); B(0.08, 0.32, 0.08, dark, W * 0.35, 0.78, L / 2 - 0.12);
        B(W * 0.6, 0.06, 0.04, this.mat(0xffffff), 0, 0.64, -L / 2 - 0.01);   // stripe
        B(0.34, 0.1, 0.06, head, -W / 2 + 0.3, 0.5, -L / 2 - 0.02); B(0.34, 0.1, 0.06, head, W / 2 - 0.3, 0.5, -L / 2 - 0.02);
        B(0.5, 0.08, 0.06, tail, 0, 0.52, L / 2 + 0.02);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) wheel(0.3, 0.32, x * (W / 2 - 0.04), 0.3, z * L * 0.33);
        break;
      case 'truck':
        B(W, 0.7, L, paint, 0, 0.95, 0);
        B(W * 0.92, 0.7, L * 0.38, glass, 0, 1.6, -0.2);
        B(W * 0.94, 0.08, L * 0.4, paint, 0, 1.98, -0.2);
        B(W, 0.3, 0.1, dark, 0, 1.45, L / 2 - 0.05);                // bed tailgate
        B(0.1, 0.5, 0.1, dark, -W / 2 + 0.1, 1.55, 0.6); B(0.1, 0.5, 0.1, dark, W / 2 - 0.1, 1.55, 0.6);   // roll bar
        B(W * 0.9, 0.1, 0.1, dark, 0, 1.8, 0.6);
        B(W + 0.1, 0.25, 0.25, dark, 0, 0.75, -L / 2);
        B(0.32, 0.18, 0.06, head, -W / 2 + 0.32, 1.1, -L / 2 - 0.02); B(0.32, 0.18, 0.06, head, W / 2 - 0.32, 1.1, -L / 2 - 0.02);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) wheel(0.5, 0.42, x * (W / 2 + 0.02), 0.5, z * L * 0.32);
        break;
      case 'boat':
        B(W, 0.45, L * 0.75, paint, 0, 0.3, 0.3);
        B(W * 0.7, 0.45, L * 0.2, paint, 0, 0.3, -L * 0.38);
        B(W * 0.4, 0.4, 0.3, paint, 0, 0.32, -L / 2 + 0.05);
        B(W + 0.02, 0.1, L * 0.75, this.mat(0x2f7fd8), 0, 0.2, 0.3);   // stripe
        B(W * 0.8, 0.12, L * 0.5, this.mat(0x8a5c36), 0, 0.5, 0.35);   // deck
        B(0.4, 0.6, 0.35, dark, 0, 0.75, L / 2);                      // motor
        B(W * 0.6, 0.35, 0.06, glass, 0, 0.75, -0.55);                // windshield
        break;
    }
    this.light = new THREE.Color(1, 1, 1);
  }

  mat(hex, glow) {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: hex });
    m.userData.base = new THREE.Color(hex);
    m.userData.glow = !!glow;
    this.mats.push(m);
    return m;
  }

  update(v, frameDt, game) {
    this.root.position.copy(v.pos);
    this.root.rotation.y = v.yaw;
    const f0 = Vehicle._f, r0 = Vehicle._r;
    v.fwd(f0); v.right(r0);
    const fwdSpeed = v.vel.x * f0.x + v.vel.z * f0.z, lat = v.vel.x * r0.x + v.vel.z * r0.z;
    const k = Math.min(1, frameDt * 8);
    const targetPitch = v.onWater ? Math.sin(performance.now() / 500 + v.id) * 0.03 : Math.atan2(v.vy, Math.max(4, Math.abs(fwdSpeed))) * 0.8;
    this.visPitch += (targetPitch - this.visPitch) * k;
    this.visRoll += (Math.max(-0.12, Math.min(0.12, -lat * 0.02)) - this.visRoll) * k;
    this.body.rotation.set(this.visPitch, 0, this.visRoll);
    if (v.onWater) this.body.position.y = Math.sin(performance.now() / 400 + v.id) * 0.04;
    for (const w of this.wheels) w.rotation.x -= fwdSpeed * frameDt / 0.35;
    const light = game.lightColor || this.light;
    for (const m of this.mats) {
      if (m.userData.glow) continue;
      m.color.copy(m.userData.base).multiply(light);
    }
    if (v.hp < v.spec.hp * 0.3 && Effects.instance && Math.random() < frameDt * 12) {
      Effects.instance.smoke(v.local(0, v.spec.size[2] * 0.6, v.spec.size[0] * 0.35, new THREE.Vector3()));
    }
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const m of this.mats) m.dispose();
  }

  static barrel() {
    const g = new THREE.Group();
    const red = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xc8321f });
    const band = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xf2c230 });
    const m1 = new THREE.Mesh(ShadedBox.get(0.8, 1.2, 0.8), red); m1.position.y = 0.6;
    const m2 = new THREE.Mesh(ShadedBox.get(0.84, 0.12, 0.84), band); m2.position.y = 0.4;
    const m3 = new THREE.Mesh(ShadedBox.get(0.84, 0.12, 0.84), band); m3.position.y = 0.85;
    g.add(m1, m2, m3);
    return g;
  }
}
