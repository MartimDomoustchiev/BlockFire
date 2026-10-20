/* ============================================================
 * Smoke bomb cloud (story mode). Guards caught in it are stunned
 * for a few seconds (coughing, can't fight, easy takedowns), and
 * nobody can see into, out of or through it.
 * ============================================================ */
class SmokeCloud extends Entity {
  constructor(x, y, z, radius, owner) {
    super('smoke');
    this.pos.set(x, y, z);
    this.radius = radius;
    this.owner = owner || null;
    this.age = 0;
    this.life = CONFIG.STORY.SMOKE.TIME;
    this.stunned = new Set();
    this.mesh = null;
  }

  update(dt, game) {
    this.age += dt;
    if (this.age > this.life) { this.removed = true; return; }
    for (const c of game.characters()) {
      if (!c.alive || c.npcRole !== 'guard' || this.stunned.has(c.id) || !this.contains(c.pos)) continue;
      this.stunned.add(c.id);
      c.stunnedUntil = game.time + CONFIG.STORY.SMOKE.STUN;
      game.events.emit('bark', { character: c, text: '*cough* I can\'t see!' });
    }
  }

  /** Is a character standing at p inside the cloud? */
  contains(p) {
    if (this.age > this.life - 0.5) return false;
    const dy = p.y - this.pos.y;
    return dy > -2 && dy < this.radius && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < this.radius;
  }

  /** Does the sight line a -> b pass through the cloud? */
  blocks(a, b) {
    if (this.age > this.life - 0.5) return false;
    const cx = this.pos.x, cy = this.pos.y + 1, cz = this.pos.z;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy + (cz - a.z) * dz) / L2)) : 0;
    return Math.hypot(a.x + dx * t - cx, a.y + dy * t - cy, a.z + dz * t - cz) < this.radius * 0.9;
  }

  render(frameDt, game) {
    if (this.netProxy) this.age += frameDt;              // online copy: the host decides when it's gone
    if (!this.mesh) {
      this.mesh = new THREE.Group();
      this.puffs = [];
      const geo = SmokeCloud.geo || (SmokeCloud.geo = new THREE.BoxGeometry(1, 1, 1));
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xb8bcc4, transparent: true, opacity: 0.7, depthWrite: false }));
        const a = (i / 14) * Math.PI * 2, r = this.radius * (0.25 + (i % 3) * 0.25);
        m.userData = { a, r, y: (i % 4) * 0.8, s: 1.6 + (i % 3) * 0.7, spin: 0.2 + (i % 5) * 0.05 };
        this.mesh.add(m);
        this.puffs.push(m);
      }
      this.mesh.renderOrder = 6;
      game.scene.add(this.mesh);
    }
    this.mesh.position.copy(this.pos);
    const grow = Math.min(1, this.age / 0.6), fade = Math.min(1, (this.life - this.age) / 2);
    for (const m of this.puffs) {
      const u = m.userData, a = u.a + this.age * u.spin;
      m.position.set(Math.cos(a) * u.r * grow, u.y + 0.5 + this.age * 0.08, Math.sin(a) * u.r * grow);
      m.scale.setScalar(u.s * (0.4 + 0.6 * grow) * (1 + this.age * 0.04));
      m.rotation.set(a, a * 0.7, 0);
      m.material.opacity = 0.62 * fade;
    }
  }

  dispose() {
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      for (const m of this.puffs) m.material.dispose();
      this.mesh = null;
    }
  }
}
