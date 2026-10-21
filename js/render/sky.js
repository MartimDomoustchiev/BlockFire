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
    // story mode's dome: a gradient with a warm haze at the horizon, a round sun with a glow, a moon and stars
    const P = (r, g, b) => new THREE.Color(r, g, b);
    this._story = {
      zenithDay: P(0.16, 0.42, 0.8), horizonDay: P(0.88, 0.8, 0.64), zenithDusk: P(0.26, 0.28, 0.52), horizonDusk: P(1.0, 0.56, 0.3),
      zenithNight: P(0.015, 0.025, 0.08), horizonNight: P(0.06, 0.07, 0.15),
      sunDay: P(1.0, 0.93, 0.78), sunDusk: P(1.0, 0.6, 0.34), moon: P(0.34, 0.42, 0.68),
      ambDay: P(0.5, 0.62, 0.8), ambDusk: P(0.66, 0.5, 0.46), ambNight: P(0.1, 0.13, 0.26),
      gndDay: P(0.5, 0.4, 0.28), gndDusk: P(0.42, 0.28, 0.2), gndNight: P(0.06, 0.06, 0.09),
    };
    this.dome = null;
    this.clouds = 0;                     // cumulus on the story dome (the Ultra preset)
  }

  /** Story mode's sun for the sun rays (render/post.js): { dir, col, vis }, or null when the dome is not drawn. */
  sunForRays() {
    if (!this.dome || !this.dome.visible) return null;
    const u = this.dome.material.uniforms;
    return { dir: u.uSunDir.value, col: u.uSunCol.value, vis: u.uSunVis.value };
  }

  _makeDome() {
    const u = { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uSunVis: { value: 1 }, uNight: { value: 0 }, uTime: { value: 0 },
      uClouds: { value: 0 } };
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uMoonDir; uniform float uSunVis; uniform float uNight; uniform float uTime;
        uniform float uClouds;
        varying vec3 vDir;
        float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = h21(i), b = h21(i + vec2(1.0, 0.0)), c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
          col = mix(col, uHorizon, 1.0 - smoothstep(-0.12, 0.02, d.y));
          float sd = max(dot(d, uSunDir), 0.0);
          float glow = pow(sd, 40.0) * 0.55 + pow(sd, 5.0) * 0.16;
          float disc = smoothstep(0.99935, 0.99975, sd);
          // a warm band along the horizon towards the sun, the haze that makes a desert sunset
          float band = pow(sd, 6.0) * 0.22 * (1.0 - smoothstep(0.0, 0.3, d.y));
          col += uSunCol * (glow + disc * 3.0 + band) * uSunVis * smoothstep(-0.2, 0.05, d.y + 0.1);
          // thin cirrus streaks high in the sky, drifting slowly
          if (d.y > 0.04) {
            vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float streak = vn(vec2(cp.x * 0.6, cp.y * 3.0)) * 0.6 + vn(vec2(cp.x * 1.7, cp.y * 6.0)) * 0.4;
            float cir = smoothstep(0.55, 0.85, streak) * smoothstep(0.04, 0.3, d.y) * 0.5;
            col = mix(col, mix(uHorizon, vec3(1.0), 0.75) * (0.85 + 0.15 * uSunVis), cir * 0.55 * (0.4 + 0.6 * uSunVis));
          }
          // Ultra: drifting cumulus, lit from the sun's side (their thin edges catch the light, a gold rim towards the sun)
          float cover = 0.0;
          if (uClouds > 0.0 && d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.1) * 0.75 + vec2(uTime * 0.005, uTime * 0.0018);
            float dens = smoothstep(0.5, 0.78, fbm(cp));
            float lee = smoothstep(0.5, 0.78, fbm(cp + uSunDir.xz * 0.08));          // the cloud a little towards the sun
            float lit = clamp(0.85 + (dens - lee) * 1.2, 0.68, 1.15);
            vec3 cc = mix(uHorizon, vec3(1.0, 0.98, 0.95), 0.7) * lit * (0.25 + 0.75 * uSunVis) + uSunCol * pow(sd, 10.0) * 0.4 * uSunVis;
            cover = dens * smoothstep(0.0, 0.2, d.y) * 0.9 * uClouds;
            col = mix(col, cc, cover);
          }
          float md = max(dot(d, uMoonDir), 0.0);
          col += vec3(0.8, 0.86, 1.0) * smoothstep(0.9993, 0.9997, md) * uNight * 0.9 + vec3(0.3, 0.38, 0.6) * pow(md, 60.0) * uNight * 0.25;
          if (uNight > 0.01) {
            vec3 g = floor(d * 380.0);
            float star = step(0.9965, h31(g)) * uNight * smoothstep(0.02, 0.25, d.y);
            col += vec3(star) * (0.6 + 0.4 * h31(g + 7.0));
          }
          // alpha marks the open sky (0) for the sun rays (render/post.js); a cloud hides some of it. The canvas has no alpha.
          gl_FragColor = vec4(col, cover * 0.8);
        }`,
    }));
    m.renderOrder = -20;
    m.frustumCulled = false;
    this.scene.add(m);
    return m;
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

    if (shared.uSunDir) this._updateStory(ang, elev, day, duskAmt, shared, underwater);
    if (this.dome) this.dome.visible = !!shared.uSunDir && !underwater;
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
    this.sun.visible = !underwater && elev > -0.12 && !shared.uSunDir;      // story mode draws its sun on the dome
    this.moon.visible = !underwater && elev < 0.12 && !shared.uSunDir;
  }

  /** Story mode: sky colours, the dome, and the sun / ambient the landscape is lit with. */
  _updateStory(ang, elev, day, duskAmt, shared, underwater) {
    const S = this._story, night = 1 - Sky.smooth(-0.2, 0.15, elev), lerp3 = (a, b, t, out) => out.copy(a).lerp(b, t);
    if (!this.dome) this.dome = this._makeDome();
    const u = this.dome.material.uniforms, cam = this.camera.position;
    const zen = u.uZenith.value, hor = u.uHorizon.value;
    lerp3(S.zenithNight, S.zenithDay, day, zen).lerp(S.zenithDusk, duskAmt * 0.7);
    lerp3(S.horizonNight, S.horizonDay, day, hor).lerp(S.horizonDusk, duskAmt * 0.85);
    this.color.copy(hor);                                                   // the haze the distance fades into
    const sx = Math.cos(ang) * 0.82, sy = Math.sin(ang), sz = -0.38, len = Math.hypot(sx, sy, sz);
    u.uSunDir.value.set(sx / len, sy / len, sz / len);
    u.uMoonDir.value.set(-sx / len, -sy / len, -sz / len);
    lerp3(S.sunDusk, S.sunDay, Sky.smooth(0.05, 0.5, elev), u.uSunCol.value);
    u.uSunVis.value = Sky.smooth(-0.1, 0.08, elev);
    u.uNight.value = night;
    this.dome.material.uniforms.uTime.value = shared.uTime ? shared.uTime.value : 0;
    u.uClouds.value = this.clouds;
    this.dome.position.copy(cam);
    this.dome.scale.setScalar(Math.max(60, (this.camera.far || 200) * 0.9));
    // light for the landscape: the sun by day, the moon by night
    const sun = elev >= 0 ? u.uSunDir.value : u.uMoonDir.value;
    shared.uSunDir.value.copy(sun);
    const sc = shared.uSunColor.value;
    if (elev >= 0) sc.copy(u.uSunCol.value).multiplyScalar(1.12 * Sky.smooth(-0.02, 0.22, elev));
    else sc.copy(S.moon).multiplyScalar(0.55 * Sky.smooth(0.0, -0.25, elev));
    lerp3(S.ambNight, S.ambDay, day, shared.uSkyAmb.value).lerp(S.ambDusk, duskAmt * 0.55).multiplyScalar(0.62);
    lerp3(S.gndNight, S.gndDay, day, shared.uGndAmb.value).lerp(S.gndDusk, duskAmt * 0.5).multiplyScalar(0.55);
  }
}
