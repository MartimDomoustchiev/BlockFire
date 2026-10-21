/* ============================================================
 * Real people: a man and a woman built with MakeHuman (CC0 assets; tools/humans builds them) as skinned meshes
 * on a game-engine skeleton, posed every frame from CharacterModel's procedural rig.
 *
 *   HumanModels   loads js/assets/humans-data.js (the two GLBs, base64) in the background and prepares each
 *                 kind once: its bind pose, which bones follow which joint of the rig, and the masks the
 *                 materials use. Until it is ready (and on the Low preset) characters keep their drawn bodies.
 *   HumanBody     one person: a clone of a kind with its own materials. The skin, the eyes and the hair keep
 *                 their textures; the shirt and trousers are turned grey and tinted with the outfit's colours
 *                 (a tunic and trousers); the shoes, the hair, the brows take their colours the same way.
 *                 The skin under worn clothes is cut away (a vertex mask from the build), so it never shows
 *                 through; for a bare chest the shirt goes and the skin stays.
 *
 * Posing: the rig's joints (torso, head, shoulders, elbows, hands, thighs, shins, feet) rotate about axes of
 * the body with the limbs hanging straight down at rest. Each bone's rest rotation is first straightened the
 * same way (the arms of the bind pose are out to the sides), then turned by the rotation of its joint: so every
 * walk cycle, climb, cut and aim of CharacterModel drives the skeleton unchanged. The spine shares the torso's
 * turn over its three bones, the neck a little of the head's. Garments, weapons and the bow ride on holders
 * fixed to bones (attach).
 * ============================================================ */
const HUMAN_JOINTS = {
  spine_01: ['torso', 0.34], spine_02: ['torso', 0.67], spine_03: ['torso', 1], neck_01: ['neck', 1], head: ['head', 1],
  upperarm_l: ['shoulderL', 1], lowerarm_l: ['elbowL', 1], hand_l: ['handL', 1],
  upperarm_r: ['shoulderR', 1], lowerarm_r: ['elbowR', 1], hand_r: ['handR', 1],
  thigh_l: ['thighL', 1], calf_l: ['shinL', 1], foot_l: ['footL', 1],
  thigh_r: ['thighR', 1], calf_r: ['shinR', 1], foot_r: ['footR', 1],
  cloak: ['cape', 1],
};
// limb bones are straightened to point down, as the rig's limbs do at rest: towards this child
const HUMAN_STRAIGHT = { upperarm: 'lowerarm', lowerarm: 'hand', hand: 'middle_01', thigh: 'calf', calf: 'foot' };
// the meshes of a kind, by the MakeHuman asset they came from
const HUMAN_HAIR = { short: 'short02', buzz: 'short04', curly: 'afro01', long: 'long01', ponytail: 'ponytail01', bun: 'bob01', braid: 'braid01' };
// the garments made for the bodies (tools/humans/garments.py): skirts by robe kind, then the rest by name
const HUMAN_SKIRTS = { tails: 'garment_tails', long: 'garment_long', coat: 'garment_coat', kilt: 'garment_kilt' };

/** The part a mesh is, from its node name ("Human_export" is the body; "Humanshort02_export": the loader drops the dots). */
function humanPart(name) {
  const k = name.replace(/_export$/, '').replace(/^Human\.?/, '');
  return k === '' || k === 'base' ? 'body' : k;
}

const HumanModels = {
  ready: false, failed: false, loading: false, enabled: true,
  tier: 0,                   // how finely people are drawn: 0 Medium, 1 High (fine relief), 2 Ultra / Epic (physical materials)
  generation: 0,             // changes when people become available or are switched on or off: models built before it rebuild
  kinds: {},
  listeners: [],

  /** On every preset but Low (main.js); a change makes existing characters rebuild their models. */
  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.generation++;
  },

  /** Starts loading in the background (a script tag: works from file:// too). */
  load() {
    if (this.loading || this.ready || typeof THREE.GLTFLoader === 'undefined') return;
    this.loading = true;
    const s = document.createElement('script');
    s.src = 'js/assets/humans-data.js';
    s.async = true;
    s.onload = () => this._parseAll().catch((e) => { this.failed = true; console.warn('humans:', e && e.message); });
    s.onerror = () => { this.failed = true; };
    document.head.appendChild(s);
  },

  /** Calls fn once the people are ready (now, if they are). */
  onReady(fn) { if (this.ready) fn(); else this.listeners.push(fn); },

  /** The preset's level of detail for people (setTier(2) on Ultra and Epic); a change rebuilds them. */
  setTier(t) {
    t = t | 0;
    if (t === this.tier) return;
    this.tier = t;
    this.generation++;
  },

  /** True when a character should be drawn as a real person. */
  available() { return this.ready && this.enabled; },

  /** True while real people are wanted but not here yet (so a drawn body would only be swapped a moment later). */
  pending() { return this.enabled && this.loading && !this.ready && !this.failed; },

  async _parseAll() {
    const data = window.HUMAN_GLB || {};
    for (const name of ['male', 'female']) {
      if (!data[name]) continue;
      const bin = Uint8Array.from(atob(data[name]), (c) => c.charCodeAt(0));
      const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(bin.buffer, '', res, rej));
      this.kinds[name] = this._prepare(gltf.scene);
    }
    window.HUMAN_GLB = null;              // the strings are no longer needed
    this.ready = !!this.kinds.male;
    if (this.ready) { this.generation++; for (const fn of this.listeners.splice(0)) fn(); }
  },

  /** One kind: its meshes by asset, its bones in parent-first order, their bind pose in the body's frame. */
  _prepare(scene) {
    const meshes = {};
    scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      meshes[humanPart(o.name)] = o;
    });
    const body = meshes.body;
    const bones = body.skeleton.bones;
    // the body frame: the model faces +z as exported; the rig faces -z
    const frame = new THREE.Group();
    frame.rotation.y = Math.PI;
    frame.add(scene);
    frame.updateMatrixWorld(true);
    const byName = {}, rest = {};
    for (const b of bones) {
      byName[b.name] = b;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      b.matrixWorld.decompose(p, q, s);
      rest[b.name] = { p, q, s: s.x, local: b.quaternion.clone() };
      // a top bone hangs from the armature's node, which may carry a turn of its own: keep that node's rotation
      if (!b.parent || !b.parent.isBone) rest[b.name].parentQ = q.clone().multiply(b.quaternion.clone().invert());
    }
    // parent-first order (bones listed as they hang in the scene)
    const order = [];
    scene.traverse((o) => { if (o.isBone) order.push(o.name); });
    // the rotation each mapped bone has when its joint is at rest
    const down = new THREE.Vector3(0, -1, 0), aligned = {};
    for (const name of order) {
      const r = rest[name], base = name.replace(/_[lr]$/, ''), side = name.slice(-2);
      let q = r.q.clone();
      const child = HUMAN_STRAIGHT[base] && rest[HUMAN_STRAIGHT[base] + side];
      if (child) {
        const dir = child.p.clone().sub(r.p).normalize();
        q = new THREE.Quaternion().setFromUnitVectors(dir, down).multiply(q);
      }
      aligned[name] = q;
    }
    // fingers curl about the line across the knuckles (index to little finger): that axis in each finger bone's frame
    const curl = {};
    for (const name of order) {
      const m = /^(index|middle|ring|pinky)_0[123]_([lr])$/.exec(name);
      if (!m || !rest['index_01_' + m[2]] || !rest['pinky_01_' + m[2]]) continue;
      const across = rest['pinky_01_' + m[2]].p.clone().sub(rest['index_01_' + m[2]].p).normalize();
      curl[name] = { axis: across.applyQuaternion(rest[name].q.clone().invert()), side: m[2] };
    }
    // masks for the materials, from the bind pose: 'top' above the belt, 'under' where clothes cover the skin
    const belt = rest.pelvis.p.y + 0.08, v = new THREE.Vector3();
    const markTop = (m) => {
      const P = m.geometry.attributes.position, top = new Float32Array(P.count);
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); top[i] = v.y > belt ? 1 : 0; }
      m.geometry.setAttribute('top', new THREE.BufferAttribute(top, 1));
    };
    markTop(body);
    const C = body.geometry.attributes.color, under = new Float32Array(body.geometry.attributes.position.count);
    if (C) for (let i = 0; i < under.length; i++) under[i] = C.getX(i) > 0.5 ? 1 : 0;
    body.geometry.setAttribute('under', new THREE.BufferAttribute(under, 1));
    body.geometry.deleteAttribute('color');
    for (const key of Object.keys(meshes)) {
      const m = meshes[key];
      if (m !== body) markTop(m);
      if (/^garment_/.test(key) && m.geometry.attributes.color) {
        // garments: vertex colour R marks the trim, G the shade in the folds (an attribute of their own, not a colour)
        const Cg = m.geometry.attributes.color, g = new Float32Array(Cg.count * 2);
        for (let i = 0; i < Cg.count; i++) { g[i * 2] = Cg.getX(i); g[i * 2 + 1] = Cg.getY(i); }
        m.geometry.setAttribute('garb', new THREE.BufferAttribute(g, 2));
        m.geometry.deleteAttribute('color');
      }
      if (/casualsuit/.test(key)) m.geometry.setAttribute('under', new THREE.BufferAttribute(new Float32Array(m.geometry.attributes.position.count).fill(1), 1));
      // the pose moves limbs outside the bind pose's bounds: keep culling, with room to spare
      m.geometry.computeBoundingSphere();
      m.geometry.boundingSphere.radius *= 1.35;
    }
    frame.remove(scene);
    return { scene, order, rest, aligned, belt, curl, garments: !!meshes.garment_hood };
  },
};

/**
 * A material for one part of a person: the texture as it is (`plain`) or turned grey and tinted (lo below the belt, hi
 * above). opts: rough, alphaTest, double, eye, garment, and the kind of surface for the finer presets: skin, cloth,
 * leather, hair (a soft sheen of the right colour, pores or weave in the relief; render/char-shading.js).
 */
function humanMaterial(map, plain, opts = {}) {
  // the game works in display colours (no sRGB decode / encode anywhere): read the texture as it is
  if (map && map.encoding !== THREE.LinearEncoding) { map.encoding = THREE.LinearEncoding; map.needsUpdate = true; }
  const tier = HumanModels.tier, phys = tier >= 2;
  const params = { map, roughness: opts.rough || 0.8, metalness: 0, alphaTest: opts.alphaTest || 0, side: opts.double ? THREE.DoubleSide : THREE.FrontSide };
  const m = phys ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  if (phys) {
    // skin: light scatters under it and glows red at the edges; cloth and hair: a soft sheen; eyes: wet
    if (opts.skin) { m.sheen = 0.3; m.sheenRoughness = 0.55; m.sheenColor.setRGB(0.55, 0.18, 0.12); m.specularIntensity = 0.5; m.roughness = 0.52; m.userData.warm = true; }
    if (opts.cloth || opts.garment) { m.sheen = 0.22; m.sheenRoughness = 0.8; m.sheenColor.setRGB(0.3, 0.3, 0.3); m.userData.sheenTint = true; }
    if (opts.leather) { m.roughness = 0.55; m.specularIntensity = 0.7; }
    if (opts.hair) { m.sheen = 0.5; m.sheenRoughness = 0.3; m.sheenColor.setRGB(0.6, 0.55, 0.5); m.userData.sheenTint = true; m.roughness = 0.42; }
    if (opts.eye) { m.clearcoat = 1; m.clearcoatRoughness = 0.04; m.roughness = 0.2; }
    if (opts.alphaTest) m.alphaToCoverage = true;           // smooth hair and lash edges through the multisampling
  }
  m.envMap = CharShading.env; m.envMapIntensity = opts.eye ? 0.9 : opts.leather ? 0.4 : opts.skin ? 0.14 : 0.2;
  const detail = tier >= 1 ? (opts.skin ? 'skin' : opts.leather ? 'metal' : (opts.cloth || opts.garment) ? 'cloth' : '') : '';
  const detailScale = opts.garment ? 0.06 : 1;
  const u = m.userData.u = { uLo: { value: new THREE.Color(1, 1, 1) }, uHi: { value: new THREE.Color(1, 1, 1) }, uCut: { value: new THREE.Vector2() } };
  m.userData.lo = new THREE.Color(1, 1, 1); m.userData.hi = new THREE.Color(1, 1, 1);
  const G = !!opts.garment;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float top;\nattribute float under;\nvarying float vTop;\nvarying float vUnder;\n' +
      (G ? 'attribute vec2 garb;\nvarying vec2 vGarb;\n' : '') +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTop = top; vUnder = under;' + (G ? ' vGarb = garb;' : ''));
    sh.fragmentShader = 'uniform vec3 uLo;\nuniform vec3 uHi;\nuniform vec2 uCut;\nvarying float vTop;\nvarying float vUnder;\n' +
      (G ? 'varying vec2 vGarb;\n' : '') +
      sh.fragmentShader.replace('#include <map_fragment>', `
        vec4 texelColor = texture2D( map, vUv );
        ${G ? `// a garment: its colour, the trim where marked, darker in the folds and on the inside (the hood round the face)
        vec3 tint = mix( uLo, uHi, smoothstep( 0.35, 0.65, vGarb.x ) ) * ( 0.55 + 0.45 * vGarb.y ) * ( gl_FrontFacing ? 1.0 : 0.42 );`
        : 'vec3 tint = mix( uLo, uHi, step( 0.5, vTop ) );'}
        ${plain ? 'diffuseColor.rgb *= texelColor.rgb * tint;' : G ? 'diffuseColor.rgb *= tint * ( 0.3 + 0.85 * dot( texelColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );'
          : 'diffuseColor.rgb *= tint * ( 0.25 + 1.15 * dot( texelColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );'}
        ${opts.eye ? `{ // the iris: from the texture's red-orange to a dark, natural brown (the white of the eye stays)
          vec3 c = texelColor.rgb; float iris = smoothstep( 0.06, 0.24, c.r - c.b );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.36, 0.25, 0.17 ) * ( 0.35 + 1.4 * dot( c, vec3( 0.299, 0.587, 0.114 ) ) ), iris );
        }` : ''}
        diffuseColor.a *= texelColor.a;
        if ( vUnder > 0.5 && ( vTop > 0.5 ? uCut.y : uCut.x ) > 0.5 ) discard;`);
    CharShading.inject(sh, { detail, detailScale, warm: !!m.userData.warm });
  };
  m.customProgramCacheKey = () => (plain ? 'human-plain' : 'human-tint') + (opts.eye ? '-eye' : '') + (G ? '-garment' : '') + '-' + detail + detailScale;
  return m;
}

class HumanBody {
  /**
   * `kind`: a prepared kind (HumanModels.kinds). `dress`: { skin, shirt, trousers, shoes, hair, hairStyle,
   * bareTop, bareLegs, noHair }. The body hangs from `parent` (CharacterModel's body group).
   */
  constructor(kind, dress, parent) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.rotation.y = Math.PI;
    this.root.scale.setScalar(HumanBody.SCALE);            // MakeHuman's adult is ~1.7 m; the game's people are ~1.8
    this.scene = THREE.SkeletonUtils.clone(kind.scene);
    this.root.add(this.scene);
    parent.add(this.root);
    this.meshes = {};
    this.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      this.meshes[humanPart(o.name)] = o;
    });
    this.bones = {};
    this.scene.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.mats = [];
    const M = this.meshes, d = dress;
    const mat = (mesh, plain, opts) => { if (!mesh) return null; const m = humanMaterial(mesh.material.map, plain, opts); mesh.material = m; this.mats.push(m); return m; };
    const set = (m, lo, hi) => {
      if (!m) return;
      m.userData.lo.set(lo); m.userData.hi.set(hi === undefined ? lo : hi);
      if (m.userData.sheenTint) m.sheenColor.copy(m.userData.lo).multiplyScalar(0.55);     // the sheen in the cloth's own colour
    };
    // the skin texture is a light one: tint it towards the character's tone (the second lightest tone is the texture as it is)
    const tone = new THREE.Color(d.skin), ref = new THREE.Color(0xe0b48c);
    const skinTint = new THREE.Color(Math.min(1.25, tone.r / ref.r), Math.min(1.25, tone.g / ref.g), Math.min(1.25, tone.b / ref.b));
    const skin = mat(M.body, true, { rough: 0.62, skin: true });
    skin.userData.lo.copy(skinTint); skin.userData.hi.copy(skinTint);
    const suitKey = Object.keys(M).find((k) => /casualsuit/.test(k)), shoeKey = Object.keys(M).find((k) => /^shoes/.test(k));
    const suit = mat(M[suitKey], false, { rough: 0.92, cloth: true });
    set(suit, d.trousers, d.shirt);
    // what of the suit is worn: no shirt for a bare chest, no trousers under a kilt; the skin beneath shows instead
    suit.userData.u.uCut.value.set(d.bareLegs ? 1 : 0, d.bareTop ? 1 : 0);
    skin.userData.u.uCut.value.set(d.bareLegs ? 0 : 1, d.bareTop ? 0 : 1);
    set(mat(M[shoeKey], false, { rough: 0.7, leather: true }), d.shoes);
    for (const k of ['low-poly']) mat(M[k], true, { rough: 0.25, eye: true });
    for (const k of ['eyebrow001', 'eyelashes01']) set(mat(M[k], false, { alphaTest: 0.4, double: true, hair: true }), d.hair);
    const style = HUMAN_HAIR[d.hairStyle] || null;
    for (const h of Object.values(HUMAN_HAIR)) {
      const mesh = M[h];
      if (!mesh) continue;
      mesh.visible = !d.noHair && h === style;
      if (mesh.visible) set(mat(mesh, false, { alphaTest: 0.45, double: true, rough: 0.55, hair: true }), d.hair);
    }
    // the garments: one skirt, the belt over it, a hood or a headcloth, a cloak, a beard (all hidden unless worn)
    const W = d.wear || {};
    const wear = (key, color, trim) => {
      const mesh = M[key];
      if (!mesh) return;
      mesh.visible = color !== undefined && color !== null;
      const leather = /boots|bracers|kit|belt/.test(key);
      if (mesh.visible) set(mat(mesh, false, leather ? { garment: true, double: true, rough: 0.6, leather: true } : { garment: true, double: true, rough: 0.95 }), color, trim === undefined ? color : trim);
    };
    for (const k of Object.keys(M)) if (/^garment_/.test(k)) M[k].visible = false;
    if (W.robe) wear(HUMAN_SKIRTS[W.robe], W.robeColor, W.trim);
    if (W.robe && W.robe !== 'kilt' || W.belt) wear('garment_belt', W.belt || 0x4a3622);
    if (W.hood !== undefined) wear('garment_hood', W.hood, W.trim);
    else if (W.scarf !== undefined) wear('garment_scarf', W.scarf);
    if (W.cloak !== undefined) wear('garment_cloak', W.cloak, W.trim);
    if (W.collar !== undefined) wear('garment_collar', W.collar, W.collarStripe);
    if (W.sash !== undefined) wear('garment_sash', W.sash);
    // the accents (High and up): boots, bracers, the buckle and pouches on the belt
    if (W.boots !== undefined) wear('garment_boots', W.boots, W.bootsTrim);
    if (W.bracers !== undefined) wear('garment_bracers', W.bracers, W.bracersTrim);
    if (W.kit !== undefined) wear('garment_kit', W.kit, 0xc89a48);
    if (W.beard !== undefined && M.garment_beard) {
      const hairMap = M.short02 && M.short02.material.map;
      M.garment_beard.visible = true;
      const bm = humanMaterial(hairMap || M.garment_beard.material.map, false, { alphaTest: 0.35, double: true, rough: 0.6, hair: true });
      M.garment_beard.material = bm; this.mats.push(bm); set(bm, W.beard);
    }
    for (const mesh of Object.values(M)) mesh.layers.enable(SHADOW_LAYER);
    this.holders = [];
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._W = {};
    this._jq = {};
    this.setLight(new THREE.Color(1, 1, 1));
  }

  /** Something that moves with a bone: the holder turns with joint `joint` of the rig, `off` (in the joint's frame) from the bone. */
  attach(boneName, joint, obj, off) {
    const bone = this.bones[boneName];
    if (!bone) return null;
    const h = new THREE.Group();
    h.add(obj);
    h.scale.setScalar(1 / (this.kind.rest[boneName].s || 1));          // bones may carry the armature's scale
    bone.add(h);
    this.holders.push({ h, bone: boneName, joint, off: off ? off.clone() : new THREE.Vector3() });
    return h;
  }

  /** Where a point (body frame, at rest) sits relative to a bone: the offset for attach(). */
  restOffset(boneName, pivot) {
    const r = this.kind.rest[boneName];
    return r ? new THREE.Vector3(pivot[0], pivot[1], pivot[2]).sub(r.p) : new THREE.Vector3();
  }

  /** A bone's position at rest, in the body's frame. */
  restAt(boneName) { const r = this.kind.rest[boneName]; return r ? r.p : new THREE.Vector3(); }

  /** Follow the rig (a CharacterModel): its joints' rotations, composed down their chains, become the bones' rotations. */
  pose(rig) {
    const J = this._jq, I = HumanBody._I;
    const q = (k) => J[k] || (J[k] = new THREE.Quaternion());
    const t = rig.torso.quaternion, hd = rig.head.quaternion;
    q('torso').copy(t);
    q('hips').copy(rig.hips.quaternion);
    q('neck').copy(t).multiply(q('_h').copy(I).slerp(hd, 0.4));
    q('head').copy(t).multiply(hd);
    q('cape').copy(t);
    if (rig.cape) q('cape').multiply(rig.cape.quaternion);
    for (const [s, A] of [['L', rig.armL], ['R', rig.armR]]) {
      q('shoulder' + s).copy(t).multiply(A.shoulder.quaternion);
      q('elbow' + s).copy(q('shoulder' + s)).multiply(A.elbow.quaternion);
      q('hand' + s).copy(q('elbow' + s)).multiply(A.hand.quaternion);
    }
    for (const [s, L] of [['L', rig.legL], ['R', rig.legR]]) {
      q('thigh' + s).copy(rig.hips.quaternion).multiply(L.thigh.quaternion);
      q('shin' + s).copy(q('thigh' + s)).multiply(L.shin.quaternion);
      q('foot' + s).copy(q('shin' + s)).multiply(L.foot.quaternion);
    }
    const K = this.kind, W = this._W;
    for (const name of K.order) {
      const bone = this.bones[name];
      if (!bone) continue;
      const parentW = bone.parent && bone.parent.isBone ? W[bone.parent.name] : K.rest[name].parentQ;
      const w = W[name] || (W[name] = new THREE.Quaternion());
      const map = HUMAN_JOINTS[name];
      if (map) {
        const jq = map[1] === 1 ? q(map[0]) : q('_p').copy(I).slerp(q(map[0]), map[1]);
        w.copy(jq).multiply(K.aligned[name]);
        bone.quaternion.copy(parentW).invert().multiply(w);
      } else {
        bone.quaternion.copy(K.rest[name].local);
        const c = K.curl[name];
        if (c) {           // relaxed, or closed round what the hand holds (rig.grip: [left, right])
          const grip = rig.grip && rig.grip[c.side === 'l' ? 0 : 1];
          bone.quaternion.multiply(q('_c').setFromAxisAngle(c.axis, HumanBody.CURL_SIGN * (grip ? 1.25 : 0.28)));
        }
        w.copy(parentW).multiply(bone.quaternion);
      }
    }
    // holders: turned like their joint, placed `off` from their bone (both in the body's frame, then into the bone's)
    for (const H of this.holders) {
      const w = W[H.bone], inv = this._q.copy(w).invert(), s = K.rest[H.bone].s || 1;
      // a joint by name, or a group of the rig hanging from one ({ base, group }: the robe's skirt, the cloak)
      const jq = typeof H.joint === 'string' ? q(H.joint) : q('_g').copy(q(H.joint.base)).multiply(H.joint.group.quaternion);
      H.h.quaternion.copy(inv).multiply(jq);
      H.h.position.copy(H.off).applyQuaternion(jq).applyQuaternion(inv).divideScalar(s);
    }
  }

  /** The day's light on the tints (like the drawn bodies' colours). */
  setLight(light) {
    for (const m of this.mats) { m.userData.u.uLo.value.copy(m.userData.lo).multiply(light); m.userData.u.uHi.value.copy(m.userData.hi).multiply(light); }
  }

  /** The hit flash. */
  flash(on) { for (const m of this.mats) m.emissive.setRGB(on ? 0.55 : 0, on ? 0.12 : 0, on ? 0.1 : 0); }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const m of this.mats) m.dispose();
  }
}
HumanBody._I = new THREE.Quaternion();
HumanBody.SCALE = 1.05;
HumanBody.CURL_SIGN = 1;                 // which way round the knuckle line closes a hand
