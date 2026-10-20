/* ============================================================
 * Cosmetic effects driven purely by game events (never by the sim):
 * bullet tracers, impact debris tinted with the struck block's
 * colour, block-break crumbs, explosion flash + fire + smoke, rocket
 * trails and hit sparks. Particles live in two InstancedMeshes (one
 * lit "debris", one additive "glow"), so thousands cost two draw
 * calls. Math.random is fine here: nothing feeds back into the sim.
 * ============================================================ */
class ParticleSystem {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.d = new Float32Array(max * 14);     // x y z vx vy vz life maxLife size r g b grav drag
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: additive, depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 4 : 1;
    this.additive = additive;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, grav, drag) {
    if (this.n >= this.max) return;
    const o = this.n++ * 14, d = this.d;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = life; d[o + 7] = life; d[o + 8] = size; d[o + 9] = r; d[o + 10] = g; d[o + 11] = b;
    d[o + 12] = grav; d[o + 13] = drag;
  }

  update(dt, world) {
    const d = this.d;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 14;
      d[o + 6] -= dt;
      if (d[o + 6] <= 0) continue;
      const drag = Math.max(0, 1 - d[o + 13] * dt);
      d[o + 3] *= drag; d[o + 5] *= drag; d[o + 4] = d[o + 4] * drag - d[o + 12] * dt;
      d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
      if (d[o + 12] > 0 && world && world.isSolid(Math.floor(d[o]), Math.floor(d[o + 1]), Math.floor(d[o + 2]))) {
        d[o + 1] = Math.floor(d[o + 1]) + 1.001; d[o + 4] = 0; d[o + 3] *= 0.5; d[o + 5] *= 0.5;
      }
      if (w !== i) d.copyWithin(w * 14, o, o + 14);
      w++;
    }
    this.n = w;
    for (let i = 0; i < this.n; i++) {
      const o = i * 14;
      const t = d[o + 6] / d[o + 7];
      const s = d[o + 8] * (this.additive ? (0.4 + t) : Math.min(1, t * 3));
      this._p.set(d[o], d[o + 1], d[o + 2]);
      this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      const k = this.additive ? t : 1;
      this._c.setRGB(d[o + 9] * k, d[o + 10] * k, d[o + 11] * k);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}

class Effects {
  constructor(scene, atlasCanvas) {
    Effects.instance = this;
    this.scene = scene;
    this.debris = new ParticleSystem(scene, 1500, false);
    this.glow = new ParticleSystem(scene, 900, true);
    this.tileColors = Effects.averageTileColors(atlasCanvas);
    // tracers: pooled line segments with per-vertex colour fading to black (additive)
    this.MAXT = 96;
    this.tracerPos = new Float32Array(this.MAXT * 6);
    this.tracerCol = new Float32Array(this.MAXT * 6);
    this.tracerLife = new Float32Array(this.MAXT);
    this.tracerBase = new Float32Array(this.MAXT * 3);
    this.tracerNext = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.tracers.renderOrder = 5;
    scene.add(this.tracers);
    // explosion flashes
    this.flashes = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; m.userData.t = 0; m.renderOrder = 5;
      scene.add(m);
      this.flashes.push(m);
    }
    this.light = new THREE.Color(1, 1, 1);
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
  }

  static averageTileColors(canvas) {
    const ctx = canvas.getContext('2d'), N = CONFIG.ATLAS_TILES, T = CONFIG.TILE_PX, out = [];
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let t = 0; t < N * N; t++) {
      let r = 0, g = 0, b = 0, n = 0;
      const ox = (t % N) * T, oy = Math.floor(t / N) * T;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const o = ((oy + y) * canvas.width + ox + x) * 4;
        if (img[o + 3] < 128) continue;
        r += img[o]; g += img[o + 1]; b += img[o + 2]; n++;
      }
      out.push(n ? [r / n / 255, g / n / 255, b / n / 255] : [0.6, 0.6, 0.6]);
    }
    return out;
  }

  blockColor(id) {
    const tile = BlockTables.faceTiles[id * 6 + 2];
    return tile >= 0 ? this.tileColors[tile] : [0.6, 0.6, 0.6];
  }

  attach(game, localCh) {
    if (this.unsub) this.unsub();
    this.game = game;
    this.local = localCh;
    this.debris.clear(); this.glow.clear();
    this.tracerLife.fill(0);
    const ev = game.events, offs = [];
    offs.push(ev.on('shot', (e) => this.onShot(e)));
    offs.push(ev.on('impact', (e) => this.onImpact(e)));
    offs.push(ev.on('explosion', (e) => this.onExplosion(e)));
    offs.push(ev.on('blockBroken', (e) => this.onBlockBroken(e)));
    offs.push(ev.on('damage', (e) => this.onDamage(e)));
    this.unsub = () => offs.forEach((f) => f());
  }

  /** Where tracers start: the viewmodel muzzle for the local player, near the hands for others. */
  muzzle(ch, out) {
    if (ch === this.local) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camQuat);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camQuat);
      const ads = ch.adsT;
      return out.copy(this.camPos).addScaledVector(right, 0.22 * (1 - ads)).addScaledVector(up, -0.14 - 0.0 * ads).addScaledVector(fwd, 0.7);
    }
    const d = ch.lookDir(new THREE.Vector3());
    return out.set(ch.pos.x + d.x * 0.6 - Math.cos(ch.yaw) * -0.2, ch.eyeY - 0.3 + d.y * 0.6, ch.pos.z + d.z * 0.6 + Math.sin(ch.yaw) * -0.2);
  }

  onShot(e) {
    if (!e.ends || !e.ends.length) return;
    const start = this.muzzle(e.character, new THREE.Vector3());
    const col = e.cls === 'shotgun' ? [0.9, 0.7, 0.35] : [1.0, 0.86, 0.5];
    for (const end of e.ends) this.tracer(start, end, col, e.cls === 'shotgun' ? 0.06 : 0.09);
  }

  tracer(a, b, col, life) {
    const i = this.tracerNext; this.tracerNext = (i + 1) % this.MAXT;
    const p = this.tracerPos;
    // only draw the far 85% so the line doesn't cover the crosshair
    p[i * 6] = a.x + (b.x - a.x) * 0.06; p[i * 6 + 1] = a.y + (b.y - a.y) * 0.06; p[i * 6 + 2] = a.z + (b.z - a.z) * 0.06;
    p[i * 6 + 3] = b.x; p[i * 6 + 4] = b.y; p[i * 6 + 5] = b.z;
    this.tracerLife[i] = life;
    this.tracerBase.set(col, i * 3);
  }

  onImpact(e) {
    const c = this.blockColor(e.block);
    for (let i = 0; i < 6; i++) {
      this.debris.emit(e.x + e.nx * 0.05, e.y + e.ny * 0.05, e.z + e.nz * 0.05,
        e.nx * 2 + (Math.random() - 0.5) * 3, e.ny * 2 + Math.random() * 2.5, e.nz * 2 + (Math.random() - 0.5) * 3,
        0.4 + Math.random() * 0.4, 0.06 + Math.random() * 0.05, c[0], c[1], c[2], 14, 1.5);
    }
    this.glow.emit(e.x, e.y, e.z, 0, 0, 0, 0.08, 0.12, 1, 0.85, 0.5, 0, 0);
  }

  onBlockBroken(e) {
    const c = this.blockColor(e.block);
    for (let i = 0; i < 14; i++) {
      this.debris.emit(e.x + Math.random(), e.y + Math.random(), e.z + Math.random(),
        (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3,
        0.5 + Math.random() * 0.5, 0.08 + Math.random() * 0.07, c[0] * 0.9, c[1] * 0.9, c[2] * 0.9, 16, 1);
    }
  }

  onDamage(e) {
    const shield = e.shield > 0;
    for (let i = 0; i < 5; i++) {
      this.glow.emit(e.x, e.y, e.z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4,
        0.25, 0.07, shield ? 0.3 : 1, shield ? 0.7 : 0.35, shield ? 1 : 0.3, 10, 2);
    }
  }

  onExplosion(e) {
    const f = this.flashes.find((m) => !m.visible) || this.flashes[0];
    f.visible = true; f.userData.t = 0; f.userData.r = e.radius; f.position.set(e.x, e.y, e.z);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = 4 + Math.random() * 9;
      const k = Math.sqrt(1 - u * u);
      this.glow.emit(e.x, e.y, e.z, Math.cos(a) * k * s, u * s + 2, Math.sin(a) * k * s,
        0.35 + Math.random() * 0.4, 0.25 + Math.random() * 0.25, 1, 0.45 + Math.random() * 0.4, 0.1, 4, 3);
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      const g = 0.25 + Math.random() * 0.2;
      this.debris.emit(e.x + (Math.random() - 0.5), e.y + (Math.random() - 0.5), e.z + (Math.random() - 0.5),
        Math.cos(a) * s, 1 + Math.random() * 2.5, Math.sin(a) * s, 1.2 + Math.random() * 1.2, 0.35 + Math.random() * 0.35, g, g, g, -0.6, 1.2);
    }
  }

  smoke(p) {
    const g = 0.55 + Math.random() * 0.2;
    this.debris.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4, 0.7, 0.18, g, g, g, -0.3, 0.5);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, 0.08, 0.16, 1, 0.6, 0.2, 0, 0);
  }

  update(frameDt, camera, light) {
    this.camPos.copy(camera.position);
    this.camQuat.copy(camera.quaternion);
    this.debris.mesh.material.color.copy(light);
    this.debris.update(frameDt, this.game ? this.game.world : null);
    this.glow.update(frameDt, null);
    for (let i = 0; i < this.MAXT; i++) {
      const l = this.tracerLife[i] = Math.max(0, this.tracerLife[i] - frameDt);
      const k = l > 0 ? Math.min(1, l * 14) : 0;
      for (let v = 0; v < 2; v++) {
        const o = i * 6 + v * 3;
        this.tracerCol[o] = this.tracerBase[i * 3] * k * (v ? 1 : 0.35);
        this.tracerCol[o + 1] = this.tracerBase[i * 3 + 1] * k * (v ? 1 : 0.35);
        this.tracerCol[o + 2] = this.tracerBase[i * 3 + 2] * k * (v ? 1 : 0.35);
      }
    }
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.tracers.geometry.attributes.color.needsUpdate = true;
    for (const f of this.flashes) {
      if (!f.visible) continue;
      f.userData.t += frameDt;
      const t = f.userData.t / 0.35;
      if (t >= 1) { f.visible = false; continue; }
      f.scale.setScalar(f.userData.r * (0.3 + 0.8 * t));
      f.material.opacity = 0.85 * (1 - t);
    }
  }
}
