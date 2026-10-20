/* ============================================================
 * Simulated projectiles: sniper bullets (fast, with gravity drop)
 * and rockets (slow, explode on impact). Each tick the projectile
 * sweeps the segment it travels against blocks and character
 * hitboxes, so even a 300 blocks/s bullet can't tunnel.
 *
 * Arrows (story mode) can be picked up again: one that hits the
 * ground or a wall drops where it landed, one that kills drops by
 * the body.
 * ============================================================ */
class Projectile extends Entity {
  constructor(owner, st, origin, dir) {
    super('projectile');
    this.owner = owner;
    this.st = st;
    this.pos.copy(origin);
    this.vel.copy(dir).multiplyScalar(st.projectile.speed);
    this.age = 0;
    this.travelled = 0;
    this.mesh = null;
    this.trail = 0;
  }

  update(dt, game) {
    const st = this.st;
    this.age += dt;
    if (this.age > CONFIG.COMBAT.PROJECTILE_LIFETIME || this.travelled > st.range) { this.removed = true; return; }
    this.vel.y -= st.projectile.gravity * dt;
    const seg = this.vel.length() * dt;
    const dir = Projectile._d.copy(this.vel).normalize();
    const hb = raycastBlocks(game.world, this.pos, dir, seg, { filter: BULLET_STOPS });
    let maxD = hb ? hb.dist : seg;
    const hp = Combat.rayProps(game, this.pos, dir, maxD, this.age < 0.2 ? this.owner : null);
    if (hp) maxD = hp.dist;
    const hc = Combat.rayCharacters(game, this.pos, dir, maxD, this.owner);
    if (st.smoke && (hc || hp || hb)) {
      // smoke bomb: bursts wherever it lands
      const d = hc ? hc.dist : hp && (!hb || hp.dist < hb.dist) ? hp.dist : hb.dist;
      const at = this.pos.clone().addScaledVector(dir, Math.max(0, d - 0.15));
      game.addEntity(new SmokeCloud(at.x, at.y, at.z, st.smoke, this.owner));
      this.removed = true;
      return;
    }
    if (!hc && hp) {
      const at = this.pos.clone().addScaledVector(dir, hp.dist);
      if (st.splash) this._explode(game, at.addScaledVector(dir, -0.1));
      else hp.target.damage(game, st.damage, this.owner, 'bullet');
      this.removed = true;
      return;
    }
    if (hc) {
      const at = this.pos.clone().addScaledVector(dir, hc.dist);
      if (st.splash) this._explode(game, at.addScaledVector(dir, -0.05));
      else {
        Combat.applyDamage(game, hc.target, st.damage * (hc.part === 'head' ? st.headMult : 1),
          { attacker: this.owner, headshot: hc.part === 'head', cls: st.cls });
        game.events.emit('bulletEnd', { x: at.x, y: at.y, z: at.z, id: this.id });
        if (st.arrow && !hc.target.alive) this._recover(game, hc.target.pos.x, hc.target.pos.y + 0.4, hc.target.pos.z);
      }
      this.removed = true;
      return;
    }
    if (hb) {
      const at = this.pos.clone().addScaledVector(dir, hb.dist);
      if (st.splash) this._explode(game, at.addScaledVector(dir, -0.08));
      else {
        Combat.hitBlock(game, hb, st.damage, this.owner, at);
        game.events.emit('bulletEnd', { x: at.x, y: at.y, z: at.z, id: this.id });
        if (st.arrow) { at.addScaledVector(dir, -0.3); this._recover(game, at.x, at.y, at.z); }
      }
      this.removed = true;
      return;
    }
    this.pos.addScaledVector(dir, seg);
    this.travelled += seg;
  }

  /** An arrow to pick up again (story mode, simulated side only). */
  _recover(game, x, y, z) {
    if (!game.rules.story || game.replica) return;
    const d = game.addEntity(new ItemDrop(makeStack('arrow', 1), x, y, z));
    d.pickupDelay = 0.3;
  }

  _explode(game, at) {
    Combat.explode(game, at.x, at.y, at.z, this.st, this.owner);
  }

  render(frameDt, game) {
    if (!this.mesh) {
      this.mesh = this.st.splash ? Projectile.rocketMesh() : this.st.arrow ? Projectile.arrowMesh() : Projectile.bulletMesh();
      game.scene.add(this.mesh);
    }
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(this.pos.x + this.vel.x, this.pos.y + this.vel.y, this.pos.z + this.vel.z);
    if (this.st.splash && typeof Effects !== 'undefined' && Effects.instance) {
      this.trail += frameDt;
      while (this.trail > 0.02) { this.trail -= 0.02; Effects.instance.smoke(this.pos); }
    }
  }

  dispose() { if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh); this.mesh = null; }

  /** Shared geometries / materials (created once) so firing never allocates GPU buffers. */
  static _parts() {
    if (!Projectile.P) {
      const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), mat = (c) => new THREE.MeshBasicMaterial({ color: c });
      Projectile.P = {
        body: box(0.16, 0.16, 0.6), tip: box(0.12, 0.12, 0.14), flame: box(0.12, 0.12, 0.2), bullet: box(0.05, 0.05, 1.2),
        grey: mat(0x8a929c), red: mat(0xd8432f), orange: mat(0xffb340), yellow: mat(0xfff1b0),
      };
    }
    return Projectile.P;
  }

  static rocketMesh() {
    const P = Projectile._parts(), g = new THREE.Group();
    const tip = new THREE.Mesh(P.tip, P.red); tip.position.z = 0.36;
    const flame = new THREE.Mesh(P.flame, P.orange); flame.position.z = -0.38;
    g.add(new THREE.Mesh(P.body, P.grey), tip, flame);
    return g;
  }

  /** A wooden shaft, iron head and white fletching, pointing along +z (lookAt aims +z along the flight). */
  static arrowGeometry() {
    if (!Projectile.A) {
      const K = BodyKit;
      Projectile.A = {
        geo: K.merge([
          K.cyl(0.009, 0.009, 0.78, 0x9a7a4e, 0, 0, 0, Math.PI / 2, 0, 0),
          K.cone(0.022, 0.08, 0x6a6e78, 0, 0, 0.43, Math.PI / 2, 0, 0),
          K.box(0.003, 0.05, 0.13, 0xeeeeee, 0, 0.022, -0.31), K.box(0.003, 0.05, 0.13, 0xeeeeee, 0, -0.022, -0.31),
          K.box(0.05, 0.003, 0.13, 0xc83a2a, 0, 0, -0.31),
        ]),
        mat: new THREE.MeshLambertMaterial({ vertexColors: true }),
      };
    }
    return Projectile.A.geo;
  }

  static arrowMesh() {
    Projectile.arrowGeometry();
    return new THREE.Mesh(Projectile.A.geo, Projectile.A.mat);
  }

  static bulletMesh() {
    const P = Projectile._parts();
    return new THREE.Mesh(P.bullet, P.yellow);
  }
}
Projectile._d = new THREE.Vector3();
