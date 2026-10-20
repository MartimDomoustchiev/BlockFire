/* ============================================================
 * Wanted poster (story mode): pinned to village walls while the
 * Order is notorious. Tearing one down (E) lowers notoriety.
 * ============================================================ */
class Poster extends Entity {
  constructor(x, y, z, nx, nz) {
    super('poster');
    this.pos.set(x, y, z);
    this.nx = nx; this.nz = nz;
    this.mesh = null;
  }

  static texture() {
    if (Poster._tex) return Poster._tex;
    const c = document.createElement('canvas');
    c.width = 48; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#d9c9a0'; g.fillRect(0, 0, 48, 64);
    g.fillStyle = '#b9a67a'; for (let i = 0; i < 40; i++) g.fillRect((i * 37) % 48, (i * 53) % 64, 2, 1);
    g.fillStyle = '#3a2a1a'; g.font = 'bold 9px monospace'; g.textAlign = 'center';
    g.fillText('WANTED', 24, 11);
    // hooded figure
    g.fillStyle = '#2f3540';
    g.beginPath(); g.moveTo(24, 16); g.lineTo(36, 30); g.lineTo(34, 46); g.lineTo(14, 46); g.lineTo(12, 30); g.closePath(); g.fill();
    g.fillStyle = '#14161a'; g.fillRect(19, 26, 10, 7);
    g.fillStyle = '#3a2a1a'; g.font = '7px monospace';
    g.fillText('THE HOOD', 24, 55); g.fillText('500 SILVER', 24, 62);
    g.fillStyle = '#8a2a20'; g.fillRect(22, 1, 4, 3);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    Poster._tex = t;
    return t;
  }

  render(frameDt, game) {
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.0), new THREE.MeshBasicMaterial({ map: Poster.texture(), side: THREE.DoubleSide }));
      this.mesh.rotation.y = Math.atan2(this.nx, this.nz);
      game.scene.add(this.mesh);
    }
    this.mesh.position.copy(this.pos);
    if (game.lightColor) this.mesh.material.color.copy(game.lightColor);
  }

  dispose() {
    if (this.mesh) { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
  }
}
