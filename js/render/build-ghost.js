/* ============================================================
 * Build preview: translucent cubes where the next piece would go
 * (blue = can place, red = blocked / not enough materials), and the
 * tile highlights of a wall being edited (red = will be cut out,
 * white = tile under the crosshair).
 * ============================================================ */
class BuildGhost {
  constructor(scene) {
    this.max = 64;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 1.02, 1.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false }), this.max);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this.OK = new THREE.Color(0x4aa8ff);
    this.BAD = new THREE.Color(0xff4a3a);
    this.HOVER = new THREE.Color(0xffffff);
    this.KEEP = new THREE.Color(0x2c5a88);
  }

  update(ch, game) {
    let n = 0;
    const put = (x, y, z, col) => {
      if (n >= this.max) return;
      this._m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n, col);
      n++;
    };
    const b = ch && ch.alive ? ch.build : null;
    if (b && b.edit) {
      const piece = game.pieces.get(b.edit.pieceId);
      if (piece) {
        for (const v of Building.voxels(piece.slot)) {
          const tile = Building.tileOf(v[3], v[4]);
          const col = b.edit.selected.includes(tile) ? this.BAD : tile === b.edit.hover ? this.HOVER : this.KEEP;
          put(v[0], v[1], v[2], col);
        }
      }
    } else if (b && b.active && b.target) {
      const col = b.target.ok ? this.OK : this.BAD;
      for (const v of b.target.cells) put(v[0], v[1], v[2], col);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
