/* ============================================================
 * Chunk materials.
 *
 * Greedy-meshed quads are bigger than one block, so a plain atlas UV
 * would stretch. Instead each vertex carries (a) UVs in *block units*
 * and (b) the atlas tile index; the fragment shader wraps the UVs with
 * fract() and looks up the tile. Fog, day/night lighting and the baked
 * per-vertex AO/face shade are all applied here, so one shared uniform
 * set drives both the opaque and the water material.
 * ============================================================ */
function createChunkMaterials(atlas) {
  const shared = {
    uAtlas: { value: atlas },
    uTiles: { value: CONFIG.ATLAS_TILES },
    uFogColor: { value: new THREE.Color(0.6, 0.8, 0.95) },
    uFogNear: { value: 40 },
    uFogFar: { value: 100 },
    uLight: { value: new THREE.Color(1, 1, 1) },
  };

  const vertexShader = `
    attribute float tile;
    attribute float shade;
    varying vec2 vUv;
    varying float vTile;
    varying float vShade;
    varying float vDepth;
    void main() {
      vUv = uv;
      vTile = tile;
      vShade = shade;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDepth = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;

  const fragmentShader = `
    uniform sampler2D uAtlas;
    uniform float uTiles;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform vec3 uLight;
    uniform float uAlpha;
    uniform float uAlphaTest;
    varying vec2 vUv;
    varying float vTile;
    varying float vShade;
    varying float vDepth;
    void main() {
      float t = floor(vTile + 0.5);
      float row = floor(t / uTiles);
      float col = t - row * uTiles;
      vec2 f = clamp(fract(vUv), 0.001, 0.999);
      vec2 auv = vec2((col + f.x) / uTiles, (row + 1.0 - f.y) / uTiles);
      vec4 c = texture2D(uAtlas, auv);
      if (c.a < uAlphaTest) discard;
      vec3 rgb = c.rgb * vShade * uLight;
      rgb = mix(rgb, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
      gl_FragColor = vec4(rgb, uAlpha);
    }`;

  const make = (alpha, alphaTest, transparent) => new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uAlpha: { value: alpha }, uAlphaTest: { value: alphaTest },
    }, shared),
    vertexShader, fragmentShader,
    transparent,
    depthWrite: !transparent,
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
  });

  return {
    shared,
    opaque: make(1.0, 0.5, false),   // solid blocks + alpha-tested leaves/glass
    water: make(0.68, 0.0, true),
  };
}
