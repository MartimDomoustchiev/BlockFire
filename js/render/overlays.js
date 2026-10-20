/* ============================================================
 * Block targeting visuals: the wireframe around the block you're
 * looking at and the crack overlay that grows while mining it.
 * The 10 crack stages are drawn procedurally: each stage adds more
 * random-walk fractures from the centre outward.
 * ============================================================ */
class BlockOverlays {
  constructor(scene) {
    this.scene = scene;

    const box = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.outline.visible = false;
    scene.add(this.outline);

    this.crackTextures = BlockOverlays.makeCrackTextures(10);
    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0], transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 2;
    scene.add(this.crack);
  }

  static makeCrackTextures(stages) {
    // One deterministic set of fracture paths; stage k shows the first k/stages of them.
    let s = 1337;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const paths = [];
    for (let p = 0; p < 14; p++) {
      const pts = [];
      let x = 7.5 + (rnd() - 0.5) * 3, y = 7.5 + (rnd() - 0.5) * 3;
      const ang = rnd() * Math.PI * 2;
      for (let k = 0; k < 9; k++) {
        pts.push([Math.floor(x), Math.floor(y)]);
        x += Math.cos(ang + (rnd() - 0.5) * 1.4) * 1.1;
        y += Math.sin(ang + (rnd() - 0.5) * 1.4) * 1.1;
      }
      paths.push(pts);
    }
    const out = [];
    for (let st = 1; st <= stages; st++) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const ctx = c.getContext('2d');
      const frac = st / stages;
      const nPaths = Math.ceil(paths.length * frac);
      const len = Math.max(2, Math.ceil(9 * Math.min(1, frac * 1.6)));
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      for (let p = 0; p < nPaths; p++) {
        for (let k = 0; k < len; k++) {
          const [x, y] = paths[p][k];
          if (x >= 0 && x < 16 && y >= 0 && y < 16) ctx.fillRect(x, y, 1, 1);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      out.push(t);
    }
    return out;
  }

  /** target: {x,y,z} or null; progress: 0..1 mining progress (0 hides the cracks). */
  update(target, progress) {
    if (!target) { this.outline.visible = false; this.crack.visible = false; return; }
    this.outline.visible = true;
    this.outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    if (progress > 0) {
      const stage = Math.min(this.crackTextures.length - 1, Math.floor(progress * this.crackTextures.length));
      if (this.crackMat.map !== this.crackTextures[stage]) { this.crackMat.map = this.crackTextures[stage]; this.crackMat.needsUpdate = true; }
      this.crack.position.copy(this.outline.position);
      this.crack.visible = true;
    } else {
      this.crack.visible = false;
    }
  }

  dispose() {
    this.scene.remove(this.outline, this.crack);
    this.crackTextures.forEach((t) => t.dispose());
  }
}
