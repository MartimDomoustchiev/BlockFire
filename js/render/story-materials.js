/* ============================================================
 * Story mode's materials: the world drawn as a lit landscape, not as cubes.
 *
 *   ground   the smooth ground skin (worker/mesher.js, SMOOTH): vertex colours blended from column to column,
 *            procedural grain and ripples in world space, bare rock on steep slopes.
 *   opaque   what is built (walls, floors, roofs, trunks) and the cliffs: atlas tiles with mip-maps, lit from the
 *            face normal.
 *   water    the rivers and the sea: moving ripples, a sun glint, a depth tint.
 *
 * All three share one lighting model: the sun (direction, colour from the sky's clock), a sky/ground hemisphere
 * ambient, and haze towards the sky colour. The uniforms live in `shared`; Sky.update fills them in.
 * ============================================================ */
function createStoryMaterials(atlas) {
  const shared = {
    uAtlas: { value: atlas },
    uTiles: { value: CONFIG.ATLAS_TILES },
    uTilePx: { value: atlas.userData && atlas.userData.tilePx || CONFIG.TILE_PX },
    uAniso: { value: 1 },                                   // the atlas's anisotropic filtering (the quality preset's aniso)
    uFogColor: { value: new THREE.Color(0.8, 0.72, 0.58) },
    uFogNear: { value: 40 },
    uFogFar: { value: 100 },
    uLight: { value: new THREE.Color(1, 1, 1) },          // what entities (characters, items) are lit with
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.9, 0.72) },
    uSkyAmb: { value: new THREE.Color(0.46, 0.55, 0.7) },
    uGndAmb: { value: new THREE.Color(0.42, 0.34, 0.24) },
    uTime: { value: 0 },
    // sun shadows (render/shadow.js): a 1x1 white map and "off" until a SunShadow is bound
    uShadowMap: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })() },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowTexel: { value: 1 / 2048 },
  };

  const common = `
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyAmb;
    uniform vec3 uGndAmb;
    uniform float uTime;
    uniform sampler2D uShadowMap;
    uniform mat4 uShadowMatrix;
    uniform float uShadowOn;
    uniform float uShadowTexel;
    float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    /** 1 where the sun reaches this point, 0 in a shadow: 12 jittered taps over a disc a few texels wide, so the edges are soft; fades at the map's edge */
    float shadowAt(vec3 world, vec3 n) {
      if (uShadowOn < 0.01) return 1.0;
      vec4 sp = uShadowMatrix * vec4(world + n * 0.12, 1.0);
      vec3 sc = sp.xyz * 0.5 + 0.5;
      if (sc.z > 1.0 || sc.z < 0.0) return 1.0;
      vec2 e2 = min(sc.xy, 1.0 - sc.xy);
      float edge = smoothstep(0.0, 0.1, min(e2.x, e2.y));
      float rot = hash21(gl_FragCoord.xy) * 6.2832;
      float rad = uShadowTexel * 2.6, z = sc.z - 0.0008;
      float lit = 0.0;
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float a = fi * 2.39996 + rot, r = sqrt((fi + 0.5) / 12.0) * rad;
        lit += step(z, texture2D(uShadowMap, sc.xy + vec2(cos(a), sin(a)) * r).r);
      }
      return mix(1.0, lit / 12.0, edge * uShadowOn);
    }
    /** sun on the surface (less where shadowed) plus the sky above and the warm bounce from the ground below */
    vec3 lightAt(vec3 n, float occlusion, float sh) {
      float ndl = max(dot(n, uSunDir), 0.0);
      float hemi = n.y * 0.5 + 0.5;
      return uSunColor * ndl * sh * mix(1.0, occlusion, 0.6) + mix(uGndAmb, uSkyAmb, hemi) * occlusion;
    }
    /** distance haze: the fog proper near the end of the view, a thin aerial haze long before it, and both glow with the
        sun's colour when you look towards it */
    vec3 haze(vec3 rgb, float depth, vec3 world) {
      vec3 V = normalize(world - cameraPosition);
      float toSun = pow(max(dot(V, uSunDir), 0.0), 6.0);
      vec3 fogc = uFogColor + uSunColor * toSun * 0.3;
      float f = max(smoothstep(uFogNear, uFogFar, depth), (1.0 - exp(-depth * 0.0045)) * 0.3);
      return mix(rgb, fogc, f);
    }
    /** filmic curve (ACES fit): highlights roll off instead of clipping, midtones keep their colour; a touch of saturation,
        warm light and cool shadows (the grade of a sunlit desert) */
    vec3 tone(vec3 c) {
      c *= 1.12;
      vec3 t = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
      float l = dot(t, vec3(0.299, 0.587, 0.114));
      t = clamp(mix(vec3(l), t, 1.06), 0.0, 1.0);
      float hi = smoothstep(0.55, 1.0, l), lo = 1.0 - smoothstep(0.0, 0.35, l);
      t = t * (1.0 + hi * vec3(0.03, 0.01, -0.03)) * (1.0 + lo * vec3(-0.02, -0.005, 0.04));
      return clamp(t, 0.0, 1.0);
    }
  `;

  const voxelVertex = `
    attribute float tile;
    attribute float shade;
    varying vec2 vUv;
    varying float vTile;
    varying float vShade;
    varying float vDepth;
    varying vec3 vN;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vTile = tile;
      vShade = shade;
      vN = normal;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vDepth = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;

  const voxelFragment = `
    uniform sampler2D uAtlas;
    uniform float uTiles;
    uniform float uTilePx;
    uniform float uAniso;
    uniform float uAlpha;
    uniform float uAlphaTest;
    varying vec2 vUv;
    varying float vTile;
    varying float vShade;
    varying float vDepth;
    varying vec3 vN;
    varying vec3 vWorld;
    ${common}
    void main() {
      float t = floor(vTile + 0.5);
      float row = floor(t / uTiles);
      float col = t - row * uTiles;
      vec2 f = fract(vUv);
      // keep half a texel inside the tile; the filtering follows the unwrapped uv so block edges never show a seam.
      // The pixel's footprint (in texels) is scaled so the mip level stays at 2.5 or finer, or neighbouring tiles would
      // bleed in; anisotropic filtering keeps faces seen at a grazing angle sharp instead of blurring them.
      float inset = 0.6 / uTilePx;
      f = clamp(f, inset, 1.0 - inset);
      vec2 auv = vec2((col + f.x) / uTiles, (row + 1.0 - f.y) / uTiles);
      vec2 gx = dFdx(vUv) * uTilePx, gy = dFdy(vUv) * uTilePx;
      float lx = length(gx), ly = length(gy);
      float k = min(1.0, min(5.6 / max(min(lx, ly), 1e-4), 5.6 * uAniso / max(max(lx, ly), 1e-4)));
      vec2 toAtlas = vec2(1.0, -1.0) / (uTilePx * uTiles);
      vec4 c = textureGrad(uAtlas, auv, gx * k * toAtlas, gy * k * toAtlas);
      if (c.a < uAlphaTest) discard;
      vec3 n = normalize(vN);
      // a faint, world-space mottling so repeated blocks do not read as a grid
      float mott = 0.93 + 0.07 * sin(vWorld.x * 0.31 + vWorld.z * 0.27) + 0.07 * sin(vWorld.z * 0.23 - vWorld.y * 0.41);
      vec3 rgb = c.rgb * mott * lightAt(n, vShade, shadowAt(vWorld, n));
      rgb = haze(tone(rgb), vDepth, vWorld);
      gl_FragColor = vec4(rgb, uAlpha);
    }`;

  const groundVertex = `
    attribute vec3 color;
    varying vec3 vColor;
    varying vec3 vN;
    varying vec3 vWorld;
    varying float vDepth;
    void main() {
      vColor = color;
      vN = normal;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vDepth = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;

  const groundFragment = `
    varying vec3 vColor;
    varying vec3 vN;
    varying vec3 vWorld;
    varying float vDepth;
    ${common}
    void main() {
      vec3 n0 = normalize(vN);
      vec2 p = vWorld.xz;
      // the surface itself: a little height from several scales of noise, and the ripples of wind-blown sand; their slope
      // bends the normal, so the sun lights every dune and ridge instead of a flat colour
      float e = 0.06;
      float hA = vnoise(p * 0.085) * 1.0 + vnoise(p * 0.42) * 0.22 + vnoise(p * 2.1) * 0.05;
      float hX = vnoise((p + vec2(e, 0.0)) * 0.085) * 1.0 + vnoise((p + vec2(e, 0.0)) * 0.42) * 0.22 + vnoise((p + vec2(e, 0.0)) * 2.1) * 0.05;
      float hZ = vnoise((p + vec2(0.0, e)) * 0.085) * 1.0 + vnoise((p + vec2(0.0, e)) * 0.42) * 0.22 + vnoise((p + vec2(0.0, e)) * 2.1) * 0.05;
      float dsl = (hX - hA) / e, dsz = (hZ - hA) / e;
      float ripple = sin(dot(p, vec2(0.93, 0.36)) * 3.1 + hA * 6.0);
      vec3 n = normalize(vec3(n0.x - dsl * 0.22 + ripple * 0.04 * n0.y, n0.y, n0.z - dsz * 0.22));
      vec2 q = p;
      float n1 = vnoise(q * 0.11), n2 = vnoise(q * 0.7 + 17.0);
      vec3 base = vColor;
      base *= 0.9 + 0.2 * n1;
      base *= 0.95 + 0.1 * n2;
      if (vDepth < 46.0) base *= 0.96 + 0.05 * vnoise(q * 3.1 + 41.0) + 0.03 * vnoise(q * 9.0);   // grain: only close enough to see it
      // wet sand by the water is darker and richer; dry sand and dry grass on the high ground are pale and bleached
      float wet = 1.0 - smoothstep(21.0, 27.0, vWorld.y);      // sea level is 20: the shore strip is wet
      base = mix(base, base * vec3(0.7, 0.6, 0.5) + vec3(0.0, 0.0, 0.01), wet * 0.55);
      float dry = smoothstep(0.35, 0.8, n1) * (1.0 - wet);
      base = mix(base, base * vec3(1.06, 1.02, 0.9), dry * 0.4);
      // the grass is sun-dried: less green, more olive and straw, and it fades where the sand takes over
      float lum = dot(base, vec3(0.299, 0.587, 0.114));
      float grassy = clamp((base.g - base.r) * 4.0 + 0.2, 0.0, 1.0) * (1.0 - wet * 0.5);
      base = mix(base, vec3(lum * 1.02, lum * 0.98, lum * 0.78) * vec3(1.0, 1.0, 1.0), grassy * 0.45);
      // slopes too steep to hold sand show the limestone under it
      float rock = smoothstep(0.8, 0.56, n.y);
      if (rock > 0.01) {
        vec3 rockCol = vec3(0.62, 0.55, 0.45) * (0.8 + 0.3 * vnoise(q * 0.5 + vWorld.y * 0.9)) * (0.92 + 0.16 * vnoise(vec2(q.x * 2.0, vWorld.y * 3.0)));
        base = mix(base, rockCol, rock);
      }
      float occl = 0.8 + 0.2 * n.y;
      vec3 rgb = base * lightAt(n, occl, shadowAt(vWorld, n));
      gl_FragColor = vec4(haze(tone(rgb), vDepth, vWorld), 1.0);
    }`;

  const propVertex = `
    uniform float uTime;
    attribute vec3 color;
    attribute float sway;
    varying vec3 vColor;
    varying vec3 vN;
    varying vec3 vWorld;
    varying float vDepth;
    void main() {
      vColor = color;
      vN = normal;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      // wind: a slow swell across the land and a quicker flutter, stronger the further a vertex is out along its leaf or stalk
      float w = sin(uTime * 1.3 + wp.x * 0.23 + wp.z * 0.19) * 0.6 + sin(uTime * 2.7 + wp.x * 0.9 + wp.z * 0.6) * 0.25;
      wp.xz += vec2(0.8, 0.45) * w * sway * 0.22;
      wp.y -= abs(w) * sway * 0.05;
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vDepth = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;

  const propFragment = `
    varying vec3 vColor;
    varying vec3 vN;
    varying vec3 vWorld;
    varying float vDepth;
    ${common}
    void main() {
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      vec3 base = vColor;
      // thin leaves glow when the sun is behind them
      float back = max(dot(-n, uSunDir), 0.0);
      vec3 rgb = base * lightAt(n, 0.9, shadowAt(vWorld, n)) + base * uSunColor * back * 0.35;
      gl_FragColor = vec4(haze(tone(rgb), vDepth, vWorld), 1.0);
    }`;

  const waterVertex = `
    attribute float tile;
    attribute float shade;
    varying vec3 vWorld;
    varying float vDepth;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vDepth = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;

  const waterFragment = `
    uniform float uAlpha;
    varying vec3 vWorld;
    varying float vDepth;
    ${common}
    void main() {
      vec2 p = vWorld.xz;
      float t = uTime;
      // two sets of slow ripples give the surface its normal
      float a = vnoise(p * 0.55 + vec2(t * 0.35, t * 0.12)), b = vnoise(p * 1.3 - vec2(t * 0.21, t * 0.4));
      float ax = vnoise(p * 0.55 + vec2(t * 0.35 + 0.7, t * 0.12)) - a, az = vnoise(p * 0.55 + vec2(t * 0.35, t * 0.12 + 0.7)) - a;
      float bx = vnoise(p * 1.3 - vec2(t * 0.21 - 0.5, t * 0.4)) - b, bz = vnoise(p * 1.3 - vec2(t * 0.21, t * 0.4 - 0.5)) - b;
      vec3 n = normalize(vec3(-(ax + bx * 0.6) * 1.8, 1.0, -(az + bz * 0.6) * 1.8));
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      vec3 shallow = vec3(0.16, 0.46, 0.5), deep = vec3(0.04, 0.2, 0.32);
      vec3 body = mix(shallow, deep, 0.35 + 0.35 * a);
      vec3 sky = mix(uSkyAmb, uFogColor, 0.5) * 1.4;
      vec3 rgb = mix(body * lightAt(n, 1.0, 1.0), sky, 0.25 + 0.55 * fres);
      vec3 H = normalize(uSunDir + V);
      rgb += uSunColor * pow(max(dot(n, H), 0.0), 90.0) * 1.4;
      gl_FragColor = vec4(haze(tone(rgb), vDepth, vWorld), mix(uAlpha, 0.96, fres));
    }`;

  const make = (vs, fs, extra, o) => new THREE.ShaderMaterial(Object.assign({
    uniforms: Object.assign({}, extra, shared),
    vertexShader: vs, fragmentShader: fs, side: THREE.FrontSide,
  }, o));

  return {
    shared,
    story: true,
    opaque: make(voxelVertex, voxelFragment, { uAlpha: { value: 1.0 }, uAlphaTest: { value: 0.5 } }, { transparent: false, depthWrite: true }),
    ground: make(groundVertex, groundFragment, {}, { transparent: false, depthWrite: true }),
    prop: make(propVertex, propFragment, {}, { transparent: false, depthWrite: true, side: THREE.DoubleSide }),
    water: make(waterVertex, waterFragment, { uAlpha: { value: 0.72 } }, { transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  };
}
