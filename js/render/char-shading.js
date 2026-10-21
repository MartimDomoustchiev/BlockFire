/* ============================================================
 * How people and what they hold are lit, so in story mode they stand in the same light as the land:
 *
 *   sun & sky   CharacterLights follows the story's sun (its direction and colour, the moon at night) and its sky and
 *               ground light (render/models.js); the land's day colour is no longer multiplied in on top.
 *   shadow      the sun's shadow map (render/shadow.js) darkens the sun on them: a person in the shade of a wall is in
 *               the shade. A few taps of the same map the land reads; the sky light stays.
 *   tone        the land's filmic curve (story-materials.js `tone`), so skin and cloth match the stone next to them.
 *   env         a small sky made from the story's colours (sky, horizon, sand, the sun) as an environment light: metal
 *               reflects the sky and the sand, skin and cloth pick up its tint. Redrawn when the light has changed.
 *   detail      (High and up) fine relief made in the shader: pores on skin, the weave of cloth, hammer marks on metal.
 *
 * Every material that takes part calls CharShading.inject(shader, opts) from its onBeforeCompile; main.js calls sync()
 * once a frame with the story's shared uniforms (or null outside story mode).
 * ============================================================ */
const CharShading = {
  U: {
    uCSMap: { value: null },
    uCSMatrix: { value: new THREE.Matrix4() },
    uCSOn: { value: 0 },
    uCSTexel: { value: 1 / 2048 },
    uCSTone: { value: 0 },
    uCSDetail: { value: 0 },
  },
  env: null,                   // the environment texture (a PMREM target's texture: the same object every time it is redrawn)
  _rt: null, _pmrem: null, _key: '', _age: 1e9, _src: null,

  /** Once, with the renderer: the white 1x1 map used while no shadow map is bound, and the environment target. */
  init(renderer) {
    this.renderer = renderer;
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    this.U.uCSMap.value = t;
    try {
      this._pmrem = new THREE.PMREMGenerator(renderer);
      this._drawEnv(new THREE.Color(0.46, 0.55, 0.7), new THREE.Color(0.8, 0.78, 0.74), new THREE.Color(0.42, 0.34, 0.24), new THREE.Color(1, 0.9, 0.72), new THREE.Vector3(0.4, 0.8, 0.3));
    } catch (e) { this._pmrem = null; }
  },

  /** Each frame: the story's shared uniforms (or null) and the detail level (0 off, 1 on). */
  sync(shared, detail) {
    const U = this.U;
    U.uCSDetail.value = detail ? 1 : 0;
    if (!shared || !shared.uShadowMap) { U.uCSOn.value = 0; U.uCSTone.value = 0; return; }
    U.uCSMap.value = shared.uShadowMap.value || U.uCSMap.value;
    U.uCSMatrix.value.copy(shared.uShadowMatrix.value);
    U.uCSOn.value = shared.uShadowOn.value;
    U.uCSTexel.value = shared.uShadowTexel.value;
    U.uCSTone.value = 1;
    // the environment: redrawn when the sky's colours or the sun have moved on (or every few seconds anyway)
    if (!this._pmrem) return;
    const s = shared.uSkyAmb.value, f = shared.uFogColor.value, g = shared.uGndAmb.value, c = shared.uSunColor.value, d = shared.uSunDir.value;
    const key = [s.r, s.g, s.b, f.r, f.g, c.r, c.g, d.x, d.y, d.z].map((v) => Math.round(v * 40)).join(',');
    this._age++;
    if (key === this._key && this._age < 600) return;
    this._key = key; this._age = 0;
    this._drawEnv(s, f, g, c, d);
  },

  /** A small equirectangular sky: sky colour overhead, the haze at the horizon, warm sand below, a bright sun. */
  _drawEnv(sky, haze, ground, sun, dir) {
    const W = 64, H = 32, data = this._src ? this._src.image.data : new Float32Array(W * H * 4);
    const sd = new THREE.Vector3().copy(dir).normalize(), v = new THREE.Vector3();
    for (let y = 0; y < H; y++) {
      const el = (0.5 - (y + 0.5) / H) * Math.PI;              // +pi/2 at the top row
      for (let x = 0; x < W; x++) {
        const az = ((x + 0.5) / W) * Math.PI * 2;
        v.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
        const down = Math.max(0, -v.y);
        let r, gg, b;
        const hz = Math.exp(-Math.abs(v.y) * 5);
        r = (sky.r * 1.5 * (1 - hz) + haze.r * hz) * (1 - down) + ground.r * 1.6 * down;
        gg = (sky.g * 1.5 * (1 - hz) + haze.g * hz) * (1 - down) + ground.g * 1.6 * down;
        b = (sky.b * 1.5 * (1 - hz) + haze.b * hz) * (1 - down) + ground.b * 1.6 * down;
        const k = Math.pow(Math.max(0, v.dot(sd)), 64) * 14 + Math.pow(Math.max(0, v.dot(sd)), 6) * 0.6;
        r += sun.r * k; gg += sun.g * k; b += sun.b * k;
        const o = (y * W + x) * 4;
        data[o] = r; data[o + 1] = gg; data[o + 2] = b; data[o + 3] = 1;
      }
    }
    if (!this._src) {
      this._src = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
      this._src.mapping = THREE.EquirectangularReflectionMapping;
      this._src.flipY = false;
    }
    this._src.needsUpdate = true;
    const prev = this.renderer.getRenderTarget();
    this._rt = this._pmrem.fromEquirectangular(this._src, this._rt);
    this.renderer.setRenderTarget(prev);
    this.env = this._rt.texture;
  },

  /**
   * Into a material's shader (from its onBeforeCompile): the sun's shadow on its direct light, the land's tone curve,
   * and with `opts.detail` ('skin', 'cloth', 'metal', 'wood') a fine relief on its normal. `opts.shadow: false` for things
   * drawn outside the world's space (the first-person view). Needs a lit material (Standard, Physical, Phong, Lambert).
   */
  inject(sh, opts = {}) {
    Object.assign(sh.uniforms, this.U);
    sh.vertexShader = 'varying vec3 vCSWorld;\n' + sh.vertexShader.replace('#include <skinning_vertex>',
      '#include <skinning_vertex>\n  vCSWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    const detail = opts.detail || '';
    const scale = opts.detailScale || 1;
    // the relief's finest frequency (cycles per uv unit) and strength, by kind of surface
    // (the slope it makes is about strength x frequency per metre: pores and weave stay near 0.1-0.15, metal finer still)
    const F = { skin: [610, 0.0005], cloth: [300, 0.0008], wood: [260, 0.0008], metal: [400, 0.00015] }[detail] || [1, 0];
    const relief = !detail ? '' : `
      // fine relief from a height made in the shader, bent into the normal by its screen-space slope; it fades out where it
      // would be finer than a pixel (no shimmer, no moire far away)
      if ( uCSDetail > 0.5 ) {
        vec2 duv = vCSUv * ${(+scale).toFixed(3)};
        float aa = 1.0 - smoothstep( 0.2, 0.55, length( fwidth( duv ) ) * ${F[0].toFixed(1)} );
        float h = ${detail === 'skin' ? 'csNoise( duv * 260.0 ) * 0.6 + csNoise( duv * 610.0 ) * 0.4'
          : detail === 'cloth' ? 'csNoise( duv * vec2( 300.0, 90.0 ) ) * 0.5 + csNoise( duv * 120.0 ) * 0.5'
          : detail === 'wood' ? 'csNoise( vec2( duv.x * 12.0, duv.y * 260.0 ) )'
          : 'csNoise( duv * 90.0 ) * 0.7 + csNoise( duv * 400.0 ) * 0.3'};
        vec2 dh = vec2( dFdx( h ), dFdy( h ) ) * ${F[1].toFixed(5)} * aa;
        vec3 vSigmaX = dFdx( -vViewPosition ), vSigmaY = dFdy( -vViewPosition );
        vec3 R1 = cross( vSigmaY, normal ), R2 = cross( normal, vSigmaX );
        float fDet = dot( vSigmaX, R1 ) * faceDirection;
        vec3 vGrad = sign( fDet ) * ( dh.x * R1 + dh.y * R2 );
        normal = normalize( abs( fDet ) * normal - vGrad );
      }`;
    sh.vertexShader = (detail ? 'varying vec2 vCSUv;\n' : '') + sh.vertexShader;
    if (detail) sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vCSUv = uv;');      // three declares uv for every program
    const head = `
      uniform sampler2D uCSMap; uniform mat4 uCSMatrix; uniform float uCSOn; uniform float uCSTexel; uniform float uCSTone; uniform float uCSDetail;
      varying vec3 vCSWorld;
      ${detail ? 'varying vec2 vCSUv;' : ''}
      float csHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
      float csNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( csHash( i ), csHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( csHash( i + vec2( 0.0, 1.0 ) ), csHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
      float csShadow( vec3 w, vec3 nw ) {
        if ( uCSOn < 0.01 ) return 1.0;
        vec4 sp = uCSMatrix * vec4( w + nw * 0.06, 1.0 );
        vec3 sc = sp.xyz * 0.5 + 0.5;
        if ( sc.z > 1.0 || sc.z < 0.0 || sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 ) return 1.0;
        vec2 e2 = min( sc.xy, 1.0 - sc.xy );
        float edge = smoothstep( 0.0, 0.1, min( e2.x, e2.y ) ), z = sc.z - 0.0015, rot = csHash( gl_FragCoord.xy ) * 6.2832, lit = 0.0;
        for ( int i = 0; i < 8; i ++ ) {
          float fi = float( i ), a = fi * 2.39996 + rot, r = sqrt( ( fi + 0.5 ) / 8.0 ) * uCSTexel * 2.2;
          lit += step( z, texture2D( uCSMap, sc.xy + vec2( cos( a ), sin( a ) ) * r ).r );
        }
        return mix( 1.0, lit / 8.0, edge * uCSOn );
      }
      vec3 csTone( vec3 c ) {
        c *= 1.12;
        vec3 t = clamp( ( c * ( 2.51 * c + 0.03 ) ) / ( c * ( 2.43 * c + 0.59 ) + 0.14 ), 0.0, 1.0 );
        float l = dot( t, vec3( 0.299, 0.587, 0.114 ) );
        t = clamp( mix( vec3( l ), t, 1.06 ), 0.0, 1.0 );
        float hi = smoothstep( 0.55, 1.0, l ), lo = 1.0 - smoothstep( 0.0, 0.35, l );
        t = t * ( 1.0 + hi * vec3( 0.03, 0.01, -0.03 ) ) * ( 1.0 + lo * vec3( -0.02, -0.005, 0.04 ) );
        return clamp( t, 0.0, 1.0 );
      }
    `;
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, geometry, directLight );',
      'getDirectionalLightInfo( directionalLight, geometry, directLight );\n\t\tdirectLight.color *= csSun;');
    sh.fragmentShader = head + sh.fragmentShader
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + relief)
      .replace('#include <lights_fragment_begin>', (opts.shadow === false ? 'float csSun = 1.0;\n'          // the first-person view: not in the world's space
        : 'float csSun = csShadow( vCSWorld, inverseTransformDirection( normal, viewMatrix ) );\n') + lights)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + (opts.warm
        // skin: light that went in comes out warmer and softer (a little subsurface glow, more where the sun is)
        ? '\n\treflectedLight.indirectDiffuse += diffuseColor.rgb * vec3( 0.07, 0.025, 0.012 ) * ( 0.4 + 0.6 * csSun );' : ''))
      .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\n\tif ( uCSTone > 0.5 ) gl_FragColor.rgb = csTone( gl_FragColor.rgb );');
  },
};
