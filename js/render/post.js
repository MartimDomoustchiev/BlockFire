/* ============================================================
 * The Ultra preset's picture: the frame is drawn into an off-screen image first, then finished here.
 *
 *   scene    every view draws into one target: 4x MSAA (smooth edges) and, on ordinary screens, 1.5x the
 *            canvas resolution (smooth shading and thin lines; the final pass filters it down).
 *   bloom    the brightest parts (the sun, the sky around it, glints on the water) glow: a soft threshold, then a
 *            chain of half-size blurs added back up (dual Kawase filter).
 *   ao       Epic: ambient occlusion. Right after each view draws the world (before the hands), its depth is read back
 *            into positions; each pixel looks for nearby surfaces round its normal (16 taps in a spiral, a few
 *            decimetres across) and darkens with what closes it in: corners, the foot of a wall, under a ledge, where
 *            people stand. Half resolution, then a blur that does not cross depth edges; fades out with distance.
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

  /** The preset for 'auto': epic for the newest desktop cards, ultra for other desktop-class cards, medium on a touch screen, high otherwise. */
  pick(name, touch) {
    if (touch) return 'medium';
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'high';
    // the newest cards: Radeon RX 6600 and up (RDNA 2 to 4), any GeForce RTX, Arc B-series and A7xx
    if (/radeon\s*(\(tm\)\s*)?rx\s*(6[6-9]\d\d|[79]\d{3})|\brtx\s*a?\d{4}|geforce\s*rtx|\barc\s*(b\d{3}|a7\d\d)/i.test(name)) return 'epic';
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
    this.ao = target(); this.aoBlur = target();                  // ambient occlusion: r = light let in, g = view depth
    this.fp = [];                                                // views whose hands were drawn over the world (no AO on them)

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
    this.mAO = mat({ tDepth: tex(), uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uRect: { value: new THREE.Vector4() },
      uTexel: v2(), uRadius: { value: 0.9 } }, `
      uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uProjInv; uniform vec4 uRect; uniform vec2 uTexel; uniform float uRadius;
      varying vec2 vUv;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec3 posAt(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        vec2 lv = (uv - uRect.xy) / uRect.zw;
        vec4 p = uProjInv * vec4(lv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return p.xyz / p.w;
      }
      void main() {
        vec2 uv = uRect.xy + vUv * uRect.zw;
        float d = texture2D(tDepth, uv).r;
        if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
        vec3 P = posAt(uv);
        // the normal from the neighbours, on whichever side the surface continues
        vec3 pr = posAt(uv + vec2(uTexel.x, 0.0)) - P, pl = P - posAt(uv - vec2(uTexel.x, 0.0));
        vec3 pu = posAt(uv + vec2(0.0, uTexel.y)) - P, pd = P - posAt(uv - vec2(0.0, uTexel.y));
        vec3 dx = abs(pr.z) < abs(pl.z) ? pr : pl, dy = abs(pu.z) < abs(pd.z) ? pu : pd;
        vec3 N = normalize(cross(dx, dy));
        if (dot(N, P) > 0.0) N = -N;
        float z = -P.z;
        vec2 R = vec2(0.5 * uProj[0][0] * uRect.z, 0.5 * uProj[1][1] * uRect.w) * uRadius / z;
        R = min(R, vec2(0.12));
        float rot = h21(gl_FragCoord.xy) * 6.2832, occ = 0.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i), t = (fi + 0.5) / 16.0, a = fi * 2.39996 + rot;
          vec3 v = posAt(uv + vec2(cos(a), sin(a)) * R * t) - P;
          float l = length(v);
          float w = 1.0 - smoothstep(uRadius * 0.55, uRadius * 1.1, l);
          occ += max(0.0, dot(N, v / max(l, 1e-4)) - 0.16 - z * 0.0015) * w;
        }
        float ao = clamp(1.0 - occ / 16.0 * 3.4, 0.0, 1.0);
        ao = ao * ao * (3.0 - 2.0 * ao) * 0.35 + ao * 0.65;
        ao = mix(1.0, ao, 1.0 - smoothstep(45.0, 110.0, z));
        gl_FragColor = vec4(ao, z, 0.0, 1.0);
      }`);
    this.mAOBlur = mat({ tSrc: tex(), uDir: v2() }, `
      uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main() {
        vec2 c = texture2D(tSrc, vUv).rg;
        float sum = c.r, wsum = 1.0;
        for (int i = 1; i <= 4; i++) {
          float fi = float(i), g = exp(-fi * fi / 8.0);
          for (int s = -1; s <= 1; s += 2) {
            vec2 q = texture2D(tSrc, vUv + uDir * fi * float(s)).rg;
            float w = g * exp(-abs(q.g - c.g) / (0.03 * c.g + 0.05));
            sum += q.r * w; wsum += w;
          }
        }
        gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
      }`);
    this.mFinal = mat({
      tScene: tex(), tBloom: tex(), tRays: tex(), uOut: v2(), uBloom: { value: 0 }, uSharpen: { value: 0 }, uGrade: { value: 0 },
      uVignette: { value: 0 }, uSplit: { value: 0 },
      tAO: tex(), tDepth: tex(), uAO: { value: 0 }, uFp0: { value: new THREE.Vector4() }, uFp1: { value: new THREE.Vector4() },
    }, `
      uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays; uniform vec2 uOut;
      uniform float uBloom; uniform float uSharpen; uniform float uGrade; uniform float uVignette; uniform float uSplit;
      uniform sampler2D tAO; uniform sampler2D tDepth; uniform float uAO; uniform vec4 uFp0; uniform vec4 uFp1;
      bool inRect(vec2 p, vec4 r) { return r.z > 0.0 && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.z && p.y <= r.y + r.w; }
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
        if (uAO > 0.0) {
          float ao = texture2D(tAO, vUv).r;
          // the first-person hands were drawn over the world after the occlusion was taken: none on them
          if ((inRect(vUv, uFp0) || inRect(vUv, uFp1)) && texture2D(tDepth, vUv).r < 0.99999) ao = 1.0;
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col *= mix(1.0, ao, uAO * (1.0 - 0.35 * smoothstep(0.6, 1.0, l)));     // a little less in the brightest sun
          if (uAO > 5.0) col = vec3(ao);                                            // debugging: the occlusion alone
        }
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
    // ambient occlusion reads the scene's depth: a depth texture the multisampled depth is resolved into
    const wantDepth = this.gl2 && opts.ao > 0;
    if (wantDepth && !this.scene.depthTexture) {
      this.scene.dispose();
      this.scene.depthTexture = new THREE.DepthTexture(Math.max(1, this.scene.width), Math.max(1, this.scene.height), THREE.UnsignedIntType);
    } else if (!wantDepth && this.scene.depthTexture) {
      this.scene.dispose(); this.scene.depthTexture.dispose(); this.scene.depthTexture = null;
    }
  }

  /**
   * Called by a view right after it drew the world, before its hands: the ambient occlusion of its rectangle, from the
   * depth just drawn. Leaves the scene target bound to the view again. `hands`: whether the hands are drawn next.
   */
  afterWorld(view, hands) {
    const o = this.opts;
    if (!(o && o.ao > 0 && this.scene.depthTexture)) return;
    const rect = view.rect, cssW = this.scene.width / this.ratio, cssH = this.scene.height / this.ratioY, cam = view.camera;
    const rx = rect.x / cssW, ry = rect.y / cssH, rw = rect.w / cssW, rh = rect.h / cssH;
    const sx = this.ao.width / cssW, sy = this.ao.height / cssH;
    this.mAO.uniforms.uProj.value.copy(cam.projectionMatrix);
    this.mAO.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    this._pass(this.mAO, this.ao, {
      tDepth: this.scene.depthTexture, uRect: [rx, ry, rw, rh], uTexel: [2 / this.scene.width, 2 / this.scene.height],
    }, [Math.round(rect.x * sx), Math.round(rect.y * sy), Math.round(rect.w * sx), Math.round(rect.h * sy)]);
    if (hands) this.fp.push([rx, ry, rw, rh]);
    this.bindView(rect);
  }

  /** Starts a frame: the scene target at `ratio` pixels per CSS pixel, cleared and bound. */
  begin(cssW, cssH, ratio) {
    this.fp.length = 0;
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

    // the ambient occlusion, blurred across and down without crossing depth edges
    const aoOn = o.ao > 0 && !!this.scene.depthTexture;
    if (aoOn) {
      this._pass(this.mAOBlur, this.aoBlur, { tSrc: this.ao.texture, uDir: [1 / this.ao.width, 0] });
      this._pass(this.mAOBlur, this.ao, { tSrc: this.aoBlur.texture, uDir: [0, 1 / this.ao.height] });
    }

    // the finished picture
    r.getDrawingBufferSize(this._out);
    const u = this.mFinal.uniforms;
    u.uAO.value = aoOn ? o.ao : 0; u.tAO.value = this.ao.texture; u.tDepth.value = aoOn ? this.scene.depthTexture : null;
    const fp0 = this.fp[0] || [0, 0, 0, 0], fp1 = this.fp[1] || [0, 0, 0, 0];
    u.uFp0.value.fromArray(fp0); u.uFp1.value.fromArray(fp1);
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
    this.ao.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
    this.aoBlur.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
  }

  static get MAX_PIXELS() { return 3840 * 2160 * 2; }

  static smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  dispose() {
    for (const t of [this.scene, this.bright, this.rays, this.ao, this.aoBlur, ...this.down, ...this.up]) t.dispose();
    if (this.scene.depthTexture) this.scene.depthTexture.dispose();
    for (const m of [this.mPre, this.mDown, this.mUp, this.mRays, this.mAO, this.mAOBlur, this.mFinal]) m.dispose();
    this.quad.geometry.dispose();
  }
}
