/* ============================================================
 * Base class for everything that lives in Game.entities.
 * update() is simulation (fixed 60 Hz, deterministic inputs only);
 * render() is presentation (once per drawn frame, may read the
 * camera, allocate meshes, use Math.random for cosmetics).
 * ============================================================ */
class Entity {
  constructor(type) {
    this.id = 0;                       // assigned by Game.addEntity
    this.type = type;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.alive = true;
    this.removed = false;              // set true to have the Game drop it after this tick
    this.game = null;
  }
  onAdd(game) { this.game = game; }
  update(dt, game) {}
  render(frameDt, game) {}
  dispose() {}
  serialize() {
    return { id: this.id, type: this.type, pos: this.pos.toArray(), vel: this.vel.toArray(), yaw: this.yaw, alive: this.alive };
  }
}
