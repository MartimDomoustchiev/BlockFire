/* ============================================================
 * The Ultra preset's picture: the frame is drawn into an off-screen image first, then finished here.
 *
 *   scene    every view draws into one target: 4x MSAA (smooth edges) and, on ordinary screens, 1.5x the
 *            canvas resolution (smooth shading and thin lines; the final pass filters it down).
 *   bloom    the brightest parts (the sun, the sky around it, glints on the water) glow: a soft threshold, then a
 *            chain of half-size blurs added back up (dual Kawase filter).
 *   rays     story mode: shafts of sunlight. The sky dome writes alpha 0 (clouds a little more), so the open sky
 *            is a mask; each pixel marches towards the sun on screen and gathers the bright sky it passes,
 *            so anything between you and the sun casts a shadow through the haze.
 *   final    filter down to the canvas with a light sharpen (contrast-adaptive: never brighter or darker than the
 *            pixels around), add bloom and rays, a warm film grade with cool shadows, a vignette, and a dither
 *            so the sky's gradients do not band.
 *
 * GpuTier tells what the 'auto' quality setting stands for: Ultra on a desktop-class graphics card.
 * ============================================================ */
const GpuTier = {
  /** The graphics card as the browser names it ('' when it will not say). */
  name(renderer) {
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    } catch (e) { return ''; }
  },

  /** The preset for 'auto': ultra for a desktop-class card, medium on a touch screen, high otherwise. */
  pick(name, touch) {
    if (touch) return 'medium';
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'high';
    if (/radeon\s*(\(tm\)\s*)?(rx|pro\s*w)\s*\d{3,4}|geforce\s*(rtx|gtx\s*(10[6-8]0|16[5-6]0))|\brtx\s*a?\d{4}|quadro\s*rtx|\barc\s*[ab]\d{3}/i.test(name)) return 'ultra';
    return 'high';
  },
};

class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.gl2 = renderer.capabilities.isWebGL2;
    this.opts = null;                     // the preset's post options (configure)
    this.ratio = 1; this.ratioY = 1;      // scene pixels per CSS pixel
    const target = (o) => new THREE.WebGLRenderTarget(1, 1, Object.assign({
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    }, o));
    this.scene = target({ depthBuffer: true });
    this.bright = target();
    this.down = [target(), target(), target(), target()];        // 1/4 .. 1/32
    this.up = [target(), target(), target()];                     // the blur added back up, 1/4 .. 1/16
    this.rays = target();

    const vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const mat = (uniforms, fs) => new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, depthTest: false, depthWrite: false });
    const tex = () => ({ value: null }), v2 = () => ({ value: new THREE.Vector2() });
    // the threshold sits above the desert's haze and pale sand, so only the sun, glints and real highlights glow
    this.mPre = mat({ tSrc: tex(), uTexel: v2(), uThreshold: { value: 0.86 }, uKnee: { value: 0.12 } }, `
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;
      void main() {
        vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb +
                  texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
        float br = dot(c, vec3(0.2126, 0.7152, 0.0722));            // luminance: a deep blue sky is not bright, the sun is
        gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + uKnee, br), 1.0);
      }`);
    this.mDown = mat({ tSrc: tex(), uTexel: v2() }, `
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
        c += texture2D(tSrc, vUv - uTexel).rgb + texture2D(tSrc, vUv + uTexel).rgb;
        c += texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0);
      }`);
    this.mUp = mat({ tSrc: tex(), tAdd: tex(), uTexel: v2() }, `
      uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec2 h = uTexel;
        vec3 c = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb +
                 texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
        c += (texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb + texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb +
              texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb + texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb) * 2.0;
        gl_FragColor = vec4(c / 12.0 + texture2D(tAdd, vUv).rgb, 1.0);
      }`);
    this.mRays = mat({ tSrc: tex(), uSun: v2(), uRect: { value: new THREE.Vector4() }, uColor: { value: new THREE.Color() }, uAspect: { value: 1 } }, `
      uniform sampler2D tSrc; uniform vec2 uSun; uniform vec4 uRect; uniform vec3 uColor; uniform float uAspect; varying vec2 vUv;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main() {
        vec2 uv = uRect.xy + vUv * uRect.zw;                       // this pixel in the whole target
        vec2 stp = (uSun - uv) / 48.0;
        vec2 p = uv + stp * h21(gl_FragCoord.xy);                  // a random start hides the steps
        vec2 lo = uRect.xy, hi = uRect.xy + uRect.zw;
        float sum = 0.0, w = 1.0;
        for (int i = 0; i < 48; i++) {
          vec4 s = texture2D(tSrc, clamp(p, lo, hi));
          float l = max(s.r, max(s.g, s.b));
          float near = exp(-length((p - uSun) / uRect.zw * vec2(uAspect, 1.0)) * 3.2);   // the sky close to the sun
          sum += (1.0 - s.a) * smoothstep(0.5, 1.0, l) * near * w;                      // open sky only
          w *= 0.962;
          p += stp;
        }
        gl_FragColor = vec4(uColor * sum / 22.0, 1.0);             // 22: the sum of the weights, so a ray is at most uColor
      }`);
    this.mFinal = mat({
      tScene: tex(), tBloom: tex(), tRays: tex(), uOut: v2(), uBloom: { value: 0 }, uSharpen: { value: 0 }, uGrade: { value: 0 },
      uVignette: { value: 0 }, uSplit: { value: 0 },
    }, `
      uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays; uniform vec2 uOut;
      uniform float uBloom; uniform float uSharpen; uniform float uGrade; uniform float uVignette; uniform float uSplit;
      varying vec2 vUv;
      vec3 S(vec2 uv) { return texture2D(tScene, uv).rgb; }
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec3 grade(vec3 c) {
        vec3 g = mix(c, c * c * (3.0 - 2.0 * c), 0.22);                       // a gentle S-curve: deeper shadows, brighter highlights
        float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
        float hi = smoothstep(0.45, 1.0, l), lo = 1.0 - smoothstep(0.0, 0.4, l);
        g += hi * vec3(0.035, 0.016, -0.028) + lo * vec3(-0.012, 0.004, 0.022);   // golden light, teal shade
        float l2 = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g = mix(vec3(l2), g, 1.07);
        return mix(c, clamp(g, 0.0, 1.0), uGrade);
      }
      void main() {
        vec2 o = uOut;
        // one output pixel's worth of the bigger scene image, then a sharpen that stays inside its neighbours' range
        vec3 c = (S(vUv + o * vec2(-0.25, -0.25)) + S(vUv + o * vec2(0.25, -0.25)) + S(vUv + o * vec2(-0.25, 0.25)) + S(vUv + o * vec2(0.25, 0.25))) * 0.25;
        vec3 n = S(vUv + vec2(0.0, o.y)), s = S(vUv - vec2(0.0, o.y)), e = S(vUv + vec2(o.x, 0.0)), w = S(vUv - vec2(o.x, 0.0));
        vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
        vec3 col = clamp(c + (c - (n + s + e + w) * 0.25) * uSharpen, mn, mx);
        col += texture2D(tBloom, vUv).rgb * uBloom + texture2D(tRays, vUv).rgb;
        col = grade(clamp(col, 0.0, 1.0));
        vec2 lv = vec2(uSplit > 0.5 ? fract(vUv.x * 2.0) : vUv.x, vUv.y) - 0.5;
        col *= 1.0 - uVignette * smoothstep(0.38, 0.85, length(lv * vec2(1.0, 0.85)));
        col += (h21(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }`);

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mFinal);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._clear = new THREE.Color();
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._out = new THREE.Vector2();
  }

  /** The preset's options ({ msaa, bloom, rays, grade, sharpen, vignette }). */
  configure(opts) {
    this.opts = opts;
    const samples = this.gl2 ? opts.msaa || 0 : 0;
    if (this.scene.samples !== samples) { this.scene.dispose(); this.scene.samples = samples; }
  }

  /** Starts a frame: the scene target at `ratio` pixels per CSS pixel, cleared and bound. */
  begin(cssW, cssH, ratio) {
    const px = cssW * cssH * ratio * ratio;
    if (px > PostFX.MAX_PIXELS) ratio *= Math.sqrt(PostFX.MAX_PIXELS / px);     // a 4K screen: no bigger than twice 4K
    const W = Math.max(1, Math.round(cssW * ratio)), H = Math.max(1, Math.round(cssH * ratio));
    if (this.scene.width !== W || this.scene.height !== H) this._resize(W, H);
    this.ratio = W / cssW; this.ratioY = H / cssH;
    const t = this.scene;
    t.viewport.set(0, 0, W, H); t.scissorTest = false;
    this.renderer.setRenderTarget(t);
    this.renderer.clear();
  }

  /** Points the renderer at one view's rectangle (CSS pixels, like PlayerView.rect) in the scene target. */
  bindView(rect) {
    const t = this.scene;
    t.viewport.set(Math.round(rect.x * this.ratio), Math.round(rect.y * this.ratioY), Math.round(rect.w * this.ratio), Math.round(rect.h * this.ratioY));
    t.scissor.copy(t.viewport); t.scissorTest = true;
    this.renderer.setRenderTarget(t);
  }

  /**
   * Finishes the frame onto the canvas. `views` are the active PlayerViews, `sun` the story sky's sun ({ dir, col, vis })
   * or null, `story` whether the full film grade applies.
   */
  end(cssW, cssH, views, sun, story) {
    const r = this.renderer, o = this.opts, W = this.scene.width, H = this.scene.height;
    r.getClearColor(this._clear);
    const clearAlpha = r.getClearAlpha();

    // bloom: the bright parts, blurred down to 1/32 and added back up
    let src = this.bright;
    this._pass(this.mPre, this.bright, { tSrc: this.scene.texture, uTexel: [1 / W, 1 / H] });
    for (const d of this.down) { this._pass(this.mDown, d, { tSrc: src.texture, uTexel: [1 / src.width, 1 / src.height] }); src = d; }
    for (let i = this.up.length - 1; i >= 0; i--) {
      this._pass(this.mUp, this.up[i], { tSrc: src.texture, tAdd: this.down[i].texture, uTexel: [1 / src.width, 1 / src.height] });
      src = this.up[i];
    }

    // sun rays, view by view (each has its own sun on screen)
    r.setRenderTarget(this.rays);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    if (sun && o.rays > 0 && sun.vis > 0.01) {
      const sx = this.rays.width / cssW, sy = this.rays.height / cssH;
      for (const v of views) {
        const cam = v.camera, rect = v.rect;
        cam.getWorldDirection(this._f);
        const facing = this._f.dot(sun.dir);
        if (facing <= 0.05) continue;
        this._v.copy(sun.dir).multiplyScalar(100).add(cam.position).project(cam);
        const off = Math.max(Math.abs(this._v.x), Math.abs(this._v.y));
        const k = o.rays * sun.vis * PostFX.smooth(0.05, 0.35, facing) * (1 - PostFX.smooth(0.8, 1.7, off));
        if (k < 0.002) continue;
        const rx = rect.x / cssW, ry = rect.y / cssH, rw = rect.w / cssW, rh = rect.h / cssH;
        this._pass(this.mRays, this.rays, {
          tSrc: this.scene.texture, uSun: [rx + (this._v.x * 0.5 + 0.5) * rw, ry + (this._v.y * 0.5 + 0.5) * rh],
          uRect: [rx, ry, rw, rh], uColor: [sun.col.r * k, sun.col.g * k, sun.col.b * k], uAspect: rect.w / Math.max(1, rect.h),
        }, [Math.round(rect.x * sx), Math.round(rect.y * sy), Math.round(rect.w * sx), Math.round(rect.h * sy)]);
      }
    }
    r.setClearColor(this._clear, clearAlpha);

    // the finished picture
    r.getDrawingBufferSize(this._out);
    const u = this.mFinal.uniforms;
    u.tScene.value = this.scene.texture; u.tBloom.value = this.up[0].texture; u.tRays.value = this.rays.texture;
    u.uOut.value.set(1 / this._out.x, 1 / this._out.y);
    u.uBloom.value = o.bloom; u.uSharpen.value = o.sharpen; u.uGrade.value = story ? o.grade : o.grade * 0.5;
    u.uVignette.value = o.vignette; u.uSplit.value = views.length === 2 ? 1 : 0;
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setViewport(0, 0, cssW, cssH);
    this.quad.material = this.mFinal;
    r.render(this.qscene, this.qcam);
  }

  _pass(mat, target, uniforms, vp) {
    for (const k in uniforms) {
      const u = mat.uniforms[k], val = uniforms[k];
      if (Array.isArray(val)) u.value.fromArray(val); else u.value = val;
    }
    if (vp) target.viewport.set(vp[0], vp[1], vp[2], vp[3]); else target.viewport.set(0, 0, target.width, target.height);
    target.scissor.copy(target.viewport);
    target.scissorTest = !!vp;
    this.renderer.setRenderTarget(target);
    this.quad.material = mat;
    this.renderer.render(this.qscene, this.qcam);
  }

  _resize(W, H) {
    this.scene.setSize(W, H);
    this.bright.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
    this.down.forEach((d, i) => d.setSize(Math.max(1, Math.ceil(W / (4 << i))), Math.max(1, Math.ceil(H / (4 << i)))));
    this.up.forEach((u, i) => u.setSize(this.down[i].width, this.down[i].height));
    this.rays.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
  }

  static get MAX_PIXELS() { return 3840 * 2160 * 2; }

  static smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  dispose() {
    for (const t of [this.scene, this.bright, this.rays, ...this.down, ...this.up]) t.dispose();
    for (const m of [this.mPre, this.mDown, this.mUp, this.mRays, this.mFinal]) m.dispose();
    this.quad.geometry.dispose();
  }
}
