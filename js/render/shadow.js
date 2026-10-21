/* ============================================================
 * Sun shadows for story mode: one depth map of the ground around the camera, seen from the sun.
 *
 * Everything that casts a shadow (chunk meshes, props, characters) is also on layer SHADOW_LAYER (layer 0 stays for the
 * views; 1 to 4 are the players' outlines and bodies). Each frame the scene's SHADOW_LAYER
 * objects are drawn once from the sun into a depth texture (an orthographic camera that follows the viewer, snapped to
 * whole texels so shadows do not shimmer as you move); the story shaders (render/story-materials.js) look a point up in
 * that map to know whether the sun reaches it. Only the sun term is shadowed; the sky's ambient light is not.
 * Quality presets decide the map size (0 = no shadows; phones) and how far it reaches (Ultra: twice as far, as sharp).
 * ============================================================ */
const SHADOW_LAYER = 6;                  // the render layer of the things that cast sun shadows (see the header)

class SunShadow {
  constructor(size, extent = 46) {
    this.size = size;
    this.extent = extent;                               // blocks from the centre to the edge of the map
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, stencilBuffer: false });
    this.rt.depthTexture = new THREE.DepthTexture(size, size);
    this.rt.depthTexture.minFilter = THREE.NearestFilter;
    this.rt.depthTexture.magFilter = THREE.NearestFilter;
    const e = this.extent;
    this.cam = new THREE.OrthographicCamera(-e, e, e, -e, 1, 260);
    this.cam.layers.set(SHADOW_LAYER);
    this.cam.layers.enable(3); this.cam.layers.enable(4);           // the players' own bodies (LAYER_SELF): they cast too; the map is depth only, nothing of them reaches the screen
    this.mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this._focus = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    // the map is only drawn again when the view has moved a few blocks, the sun has turned, or it is simply old: the world
    // is nearly still from one frame to the next, and a shadow pass costs about as much as the rest of the frame
    this._valid = false; this._age = 0; this._at = new THREE.Vector3(); this._sun = new THREE.Vector3();
  }

  /** Puts the shadow uniforms of `shared` right: the map, its matrix, and how strongly the sun's shadows show right now. */
  bind(shared) {
    shared.uShadowMap.value = this.rt.depthTexture;
    shared.uShadowTexel.value = 1 / this.size;
  }

  /**
   * Draws the shadow map for this frame. `shared` is the story material's uniform set (sun direction in uSunDir),
   * `camera` the viewer's camera: the map is centred a little ahead of it.
   */
  render(renderer, scene, shared, camera) {
    const sun = shared.uSunDir.value, e = this.extent;
    // low sun: shadows would stretch far outside the map; fade them out and stop drawing the pass
    const strength = Math.max(0, Math.min(1, (sun.y - 0.1) / 0.14));
    shared.uShadowOn.value = strength;
    if (strength <= 0.001) { this._valid = false; return; }
    camera.getWorldDirection(this._dir);
    this._dir.y = 0;
    if (this._dir.lengthSq() > 1e-6) this._dir.normalize();
    this._focus.copy(camera.position).addScaledVector(this._dir, e * 0.4);
    const moved = this._focus.distanceTo(this._at), turned = 1 - sun.dot(this._sun);
    this._age++;
    if (this._valid && moved < 3 && turned < 0.0004 && this._age < 15) return;     // the map from the last pass still fits
    this._valid = true; this._age = 0; this._at.copy(this._focus); this._sun.copy(sun);
    const cam = this.cam;
    cam.position.copy(this._focus).addScaledVector(sun, 130);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._focus);
    cam.updateMatrixWorld();
    // snap the camera to whole texels in its own right / up directions
    const texel = 2 * e / this.size;
    this._right.setFromMatrixColumn(cam.matrixWorld, 0);
    this._up.setFromMatrixColumn(cam.matrixWorld, 1);
    const px = cam.position.dot(this._right), py = cam.position.dot(this._up);
    cam.position.addScaledVector(this._right, Math.round(px / texel) * texel - px).addScaledVector(this._up, Math.round(py / texel) * texel - py);
    cam.updateMatrixWorld();
    shared.uShadowMatrix.value.multiplyMatrices(cam.projectionMatrix, this._m.copy(cam.matrixWorld).invert());

    const prevTarget = renderer.getRenderTarget(), prevBg = scene.background, prevOverride = scene.overrideMaterial, prevScissor = renderer.getScissorTest();
    scene.background = null;
    scene.overrideMaterial = this.mat;
    renderer.setScissorTest(false);
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setScissorTest(prevScissor);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
  }

  dispose() { this.rt.depthTexture.dispose(); this.rt.dispose(); this.mat.dispose(); }
}
