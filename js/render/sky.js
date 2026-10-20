/* ============================================================
 * Day / night cycle: sky colour, sun + moon discs, and the light
 * colour that the chunk shader multiplies terrain by.
 *
 * time is in [0,1): 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 0/1 = midnight.
 * ============================================================ */
class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.color = new THREE.Color();
    this.daylight = 1;
    const disc = (size, color) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color, fog: false, depthTest: false, depthWrite: false }));
      m.renderOrder = -10;               // drawn first; terrain then paints over it
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.sun = disc(12, 0xfff2b8);
    this.moon = disc(8, 0xdfe6f5);
    this._night = new THREE.Color(0.02, 0.03, 0.09);
    this._day = new THREE.Color(0.52, 0.76, 0.96);
    this._dusk = new THREE.Color(1.0, 0.56, 0.3);
    this._nightLight = new THREE.Color(0.17, 0.2, 0.34);
    this._dayLight = new THREE.Color(1, 1, 1);
    this._duskLight = new THREE.Color(1, 0.8, 0.62);
  }

  static smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  /** Updates colours, sun/moon placement, and the shared shader uniforms. */
  update(time, shared, underwater) {
    const ang = (time - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const day = Sky.smooth(-0.15, 0.3, elev);
    const duskAmt = Sky.smooth(0, 1, 1 - Math.abs(elev) / 0.32);     // peaks when the sun is on the horizon
    this.daylight = day;

    // sky / fog colour
    this.color.copy(this._night).lerp(this._day, day).lerp(this._dusk, duskAmt * 0.9);
    // terrain light colour
    const light = shared.uLight.value;
    light.copy(this._nightLight).lerp(this._dayLight, day).lerp(this._duskLight, duskAmt * 0.6);

    if (underwater) {
      this.color.setRGB(0.07, 0.2, 0.42).multiplyScalar(0.25 + 0.75 * day);
    }
    this.scene.background = this.color;
    shared.uFogColor.value.copy(this.color);

    // sun and moon sit on a circle around the camera, facing it
    const cam = this.camera.position, R = 50;
    const sx = Math.cos(ang) * R, sy = Math.sin(ang) * R, sz = -12;
    this.sun.position.set(cam.x + sx, cam.y + sy, cam.z + sz);
    this.moon.position.set(cam.x - sx, cam.y - sy, cam.z - sz);
    this.sun.quaternion.copy(this.camera.quaternion);
    this.moon.quaternion.copy(this.camera.quaternion);
    this.sun.visible = !underwater && elev > -0.12;
    this.moon.visible = !underwater && elev < 0.12;
  }
}
