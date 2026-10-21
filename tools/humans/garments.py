# ============================================================
# The garments of the island, made to fit one MakeHuman body (run by build_human.py inside Blender):
#
#   garment_tails   the Order's coat skirt: open at the front, split at the back, to the knee
#   garment_long    a closed robe to the ankle (the mentor, women)
#   garment_coat    a robe to the shin, open at the front (the magistrate, clerks)
#   garment_kilt    a pleated linen kilt (guards, labourers)
#   garment_belt    a belt over the join of the shirt and the skirt
#   garment_hood    a deep hood with a peak over the brow and a cowl over the shoulders
#   garment_scarf   a headcloth: the hood's shape without the peak, longer at the back
#   garment_cloak   a cloak down the back, hung from the shoulders (its own bone, `cloak`, so it can trail)
#   garment_beard   a full beard and moustache, grown from the jaw of the skin
#
# Each is a real mesh skinned to the skeleton, shaped by casting rays at the body (and the clothes on it): cloth
# drapes over the widest part above it (a running maximum down the body, then a convex hull round each ring), with
# folds that deepen towards the hem. Vertex colour R marks the trim (hems, the hood's rim), G the shade in the
# folds. All share one greyscale linen texture; the game tints them.
#
# The game straightens the legs of the bind pose (they stand apart) before it poses them, so the skirts are made
# round straight legs and then carried back into the bind pose through the inverse of that skinning.
# ============================================================
import bpy, math, random
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

ARM_BONES = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")


def _smooth(x, a, b):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def _bvh(objs, keep):
    """A BVH of the faces of objs whose vertices all pass keep(ob, vertex)."""
    verts, polys = [], []
    for ob in objs:
        base = len(verts)
        mw = ob.matrix_world
        ok = [keep(ob, v) for v in ob.data.vertices]
        verts += [mw @ v.co for v in ob.data.vertices]
        for p in ob.data.polygons:
            if all(ok[i] for i in p.vertices):
                polys.append([base + i for i in p.vertices])
    return BVHTree.FromPolygons(verts, polys)


def _weight(ob, v, names):
    """Total weight of vertex v of ob in the groups whose name contains any of names."""
    s = 0.0
    for g in v.groups:
        n = ob.vertex_groups[g.group].name
        if any(k in n for k in names):
            s += g.weight
    return s


def _hull_radius(points, center, dirs):
    """Radial function of the convex hull of 2D points about center, in each direction of dirs."""
    pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in points))
    if len(pts) < 3:
        return [0.0] * len(dirs)
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    out = []
    cx, cy = center
    for dx, dy in dirs:
        best = 0.0
        for i in range(len(hull)):
            ax, ay = hull[i][0] - cx, hull[i][1] - cy
            bx, by = hull[(i + 1) % len(hull)][0] - cx, hull[(i + 1) % len(hull)][1] - cy
            # ray t*(dx,dy) meets segment a + s*(b-a)
            ex, ey = bx - ax, by - ay
            den = dx * ey - dy * ex
            if abs(den) < 1e-12:
                continue
            t = (ax * ey - ay * ex) / den
            s = (ax * dy - ay * dx) / den
            if t > 0 and -1e-6 <= s <= 1 + 1e-6:
                best = max(best, t)
        out.append(best)
    return out


class Fit:
    """The body to dress: rays at the torso and legs (no arms), at the head, and the bones' rest positions."""

    def __init__(self, root, body):
        self.root, self.body = root, body
        self.clothes = [c for c in root.children if c.type == "MESH" and ("casualsuit" in c.name)]
        no_arms = lambda ob, v: _weight(ob, v, ARM_BONES) < 0.35
        self.torso = _bvh([body] + self.clothes, no_arms)
        self.skin = _bvh([body], lambda ob, v: True)
        self.head = _bvh([body], lambda ob, v: _weight(ob, v, ("head", "neck")) > 0.4)
        mw = root.matrix_world
        self.bone = {b.name: (mw @ b.head_local, mw @ b.tail_local) for b in root.data.bones}
        hv = [body.matrix_world @ v.co for v in body.data.vertices if _weight(body, v, ("head",)) > 0.9]
        lo = Vector((min(p.x for p in hv), min(p.y for p in hv), min(p.z for p in hv)))
        hi = Vector((max(p.x for p in hv), max(p.y for p in hv), max(p.z for p in hv)))
        self.head_lo, self.head_hi = lo, hi
        self.head_c = (lo + hi) / 2
        # the game's rest pose straightens each thigh (towards its knee) to point straight down
        self.straight = {}
        for s in ("l", "r"):
            h, k = self.bone["thigh_" + s][0], self.bone["calf_" + s][0]
            q = (k - h).normalized().rotation_difference(Vector((0, 0, -1)))
            self.straight["thigh_" + s] = (q.to_matrix(), h)
        print("FIT head", tuple(round(c, 3) for c in lo), tuple(round(c, 3) for c in hi))

    def ray_in(self, bvh, origin, target):
        """First hit going from origin towards target."""
        d = target - origin
        hit = bvh.ray_cast(origin, d.normalized(), d.length)
        return hit[0]

    def ring(self, z, cx, cy, dirs, bvh=None, reach=0.7):
        """Distance from the axis (cx, cy) to the outside of the body at height z, in each direction."""
        out = []
        for dx, dy in dirs:
            o = Vector((cx + dx * reach, cy + dy * reach, z))
            p = self.ray_in(bvh or self.torso, o, Vector((cx, cy, z)))
            out.append((p - Vector((cx, cy, z))).length if p else 0.0)
        return out

    def to_bind(self, p, w):
        """Where a point made for the game's rest pose (straight legs) sits in the bind pose, for weights w."""
        A = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
        b = Vector((0, 0, 0))
        for name, wt in w.items():
            if wt <= 0:
                continue
            if name in self.straight:
                R, h = self.straight[name]
                A += R * wt
                b += (h - R @ h) * wt
            else:
                A += Matrix.Identity(3) * wt
        return A.inverted() @ (p - b)


class Sheet:
    """A grid of vertices (rows x cols, optionally wrapping round) with weights, uv, trim and shade, made into a mesh."""

    def __init__(self, rows, cols, wrap):
        self.rows, self.cols, self.wrap = rows, cols, wrap
        self.P = [[None] * cols for _ in range(rows)]
        self.W = [[None] * cols for _ in range(rows)]
        self.UV = [[(0, 0)] * cols for _ in range(rows)]
        self.trim = [[0.0] * cols for _ in range(rows)]
        self.shade = [[1.0] * cols for _ in range(rows)]
        self.keep = None             # keep(i, j): whether the quad from (i, j) is made

    def build(self, name, root, mat, extra=None):
        verts, idx = [], {}
        for i in range(self.rows):
            for j in range(self.cols):
                if self.P[i][j] is not None:
                    idx[(i, j)] = len(verts)
                    verts.append((i, j))
        faces = []
        cmax = self.cols if self.wrap else self.cols - 1
        for i in range(self.rows - 1):
            for j in range(cmax):
                j1 = (j + 1) % self.cols
                q = [(i, j), (i + 1, j), (i + 1, j1), (i, j1)]
                if all(k in idx for k in q) and (self.keep is None or self.keep(i, j)):
                    faces.append(q)
        extra_v, extra_f = extra if extra else ([], [])
        me = bpy.data.meshes.new(name)
        co = [self.P[i][j] for (i, j) in verts] + [e["p"] for e in extra_v]
        fl = [[idx[k] for k in f] for f in faces] + [[len(verts) + k for k in f] for f in extra_f]
        me.from_pydata([tuple(c) for c in co], [], fl)
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        # outward normals: the grid runs round the body anticlockwise seen from above, top to bottom
        me.flip_normals() if getattr(self, "flip", False) else None
        uv = me.uv_layers.new(name="UVMap")
        col = me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="POINT")
        allw = [self.W[i][j] for (i, j) in verts] + [e["w"] for e in extra_v]
        alluv = [self.UV[i][j] for (i, j) in verts] + [e["uv"] for e in extra_v]
        allc = [(self.trim[i][j], self.shade[i][j]) for (i, j) in verts] + [(e.get("trim", 0), e.get("shade", 1)) for e in extra_v]
        for k, (t, s) in enumerate(allc):
            col.data[k].color = (t, s, 0.0, 1.0)
        me.color_attributes.active_color = col
        for poly in me.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv = alluv[me.loops[li].vertex_index]
        groups = {}
        for k, w in enumerate(allw):
            for bn, wt in w.items():
                if wt <= 1e-4:
                    continue
                g = groups.get(bn) or ob.vertex_groups.new(name=bn)
                groups[bn] = g
                g.add([k], wt, "REPLACE")
        ob.data.materials.append(mat)
        for p in me.polygons:
            p.use_smooth = True
        ob.parent = root
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = root
        return ob


def _linen():
    """A tileable greyscale linen weave with slubs, 256 px."""
    N = 256
    img = bpy.data.images.new("garment_linen", N, N)
    rnd = random.Random(7)
    slub_r = [rnd.random() for _ in range(N)]
    slub_c = [rnd.random() for _ in range(N)]
    px = []
    for y in range(N):
        for x in range(N):
            warp = 0.5 + 0.5 * math.cos(x * math.pi * 2 / 4)          # threads 4 px apart
            weft = 0.5 + 0.5 * math.cos(y * math.pi * 2 / 4)
            over = (x // 4 + y // 4) % 2
            v = 0.78 + 0.07 * (warp if over else weft) + 0.06 * (slub_r[y] - 0.5) + 0.05 * (slub_c[x] - 0.5)
            v += 0.03 * math.sin((x + y * 0.3) * 0.11) * math.sin(y * 0.07)
            v = max(0.0, min(1.0, v))
            px += [v, v, v, 1.0]
    img.pixels = px
    img.pack()
    return img


def _material(img):
    mat = bpy.data.materials.new("garment_linen")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs[0], bsdf.inputs["Base Color"])
    return mat


def _fold(theta, z, seed, count, amp):
    """Folds round a ring: a few sines of irregular count, phase drifting down the body (0 at the top)."""
    a = math.sin(theta * count + seed + z * 3.1) * 0.6 + math.sin(theta * (count * 0.53) + seed * 1.7 - z * 4.3) * 0.4
    return amp * a


def _panels(splits, f, C):
    """Angles round the body for one ring: two panels between two splits (centre angle, half width at depth f).
    A split of width 0 closes (the panels meet there)."""
    (c0, w0), (c1, w1) = splits
    a0, a1 = c0 + w0(f), c1 - w1(f)
    b0, b1 = c1 + w1(f), c0 + 2 * math.pi - w0(f)
    return [a0 + (a1 - a0) * k / (C - 1) for k in range(C)] + [b0 + (b1 - b0) * k / (C - 1) for k in range(C)]


def skirt(fit, root, mat, name, top, hem, kind):
    """Robes and kilts from the waist down, as two panels round the body. kind: tails | long | coat | kilt."""
    C = 34                                                  # columns per panel
    pel = fit.bone["pelvis"][0]
    cx, cy = 0.0, pel.y + 0.01
    crotch = fit.bone["thigh_l"][0].z - 0.11
    A = 96                                                  # rays round the body for the drape
    rdirs = [(math.sin(2 * math.pi * k / A), -math.cos(2 * math.pi * k / A)) for k in range(A)]   # 0: the front (-y)
    step = 0.02
    rows = int(round((top - hem) / step)) + 1
    gap = {"kilt": 0.01, "tails": 0.012, "coat": 0.014, "long": 0.016}[kind]
    flare = {"kilt": 0.12, "tails": 0.16, "coat": 0.14, "long": 0.17}[kind]
    folds = {"kilt": (26, 0.0055), "tails": (8, 0.02), "coat": (8, 0.02), "long": (9, 0.024)}[kind]
    leg = {"kilt": 0.85, "tails": 0.9, "coat": 0.72, "long": 0.6}[kind]
    split_z = crotch + 0.14
    def deep(fz):
        return lambda f: fz(f)
    zero = lambda f: 0.0
    if kind == "tails":
        sf = lambda f: 0.0 if top - f * (top - hem) > split_z else 0.05 + 0.85 * _smooth(f, 0.25, 1.0)
        sb = lambda f: 0.0 if top - f * (top - hem) > crotch - 0.04 else 0.02 + 0.16 * _smooth(f, 0.45, 1.0)
        splits = [(0.0, sf), (math.pi, sb)]
    elif kind == "coat":
        splits = [(0.0, lambda f: 0.08 + 0.32 * _smooth(f, 0.05, 1.0)), (math.pi, zero)]
    elif kind == "long":
        sl = lambda f: 0.0 if top - f * (top - hem) > 0.42 else 0.015 + 0.06 * _smooth(top - f * (top - hem), 0.42, 0.1)
        splits = [(math.pi / 2, sl), (3 * math.pi / 2, sl)]
    else:
        splits = [(0.55, zero), (math.pi + 0.55, zero)]
    S = Sheet(rows, 2 * C, False)
    S.keep = lambda i, j: j != C - 1                         # no quad between the two panels
    run = [0.0] * A
    rnd = random.Random(len(kind) * 31 + 7)
    seed = rnd.random() * 6
    for i in range(rows):
        z = top - i * step
        f = i / (rows - 1)
        if z > crotch:
            ring = fit.ring(z, cx, cy, rdirs)
            run = [max(a, b) for a, b in zip(run, ring)]
        pts = [(cx + d[0] * (r + gap), cy + d[1] * (r + gap)) for d, r in zip(rdirs, run)]
        hull = _hull_radius(pts, (cx, cy), rdirs)
        below = max(0.0, crotch + 0.02 - z)
        angs = _panels(splits, f, C)
        for j, th in enumerate(angs):
            k = th / (2 * math.pi) * A
            k0 = int(math.floor(k)) % A
            t = k - math.floor(k)
            base = hull[k0] * (1 - t) + hull[(k0 + 1) % A] * t
            amp = folds[1] * (0.1 + 0.9 * _smooth(f, 0.0, 1.0))
            fold = _fold(th, z, seed, folds[0], amp)
            r = base + flare * below ** 1.1 + fold
            d = (math.sin(th), -math.cos(th))
            hz = z + (0.006 * math.sin(th * 3 + seed) if i == rows - 1 else 0)
            p = Vector((cx + d[0] * r, cy + d[1] * r, hz))
            side = d[0]                                       # +1 at the left hip (+x), -1 at the right
            L = leg * (_smooth(f, 0.1, 0.8) if kind != "long" else _smooth(f, 0.08, 0.65))
            sharp = 0.2 if kind in ("tails", "coat") else 0.5
            wl = _smooth(side, -sharp, sharp)
            if kind == "tails" and z < split_z:                # each front tail follows its own leg
                wl = 1.0 if j < C else 0.0
            w = {"pelvis": 1 - L, "thigh_l": L * wl, "thigh_r": L * (1 - wl)}
            if i == 0:
                w = {"pelvis": 0.6, "spine_01": 0.4}
            S.P[i][j] = fit.to_bind(p, w)
            S.W[i][j] = w
            S.UV[i][j] = (th * 0.2 / 0.08, -(top - z) / 0.08)
            ph = 0.5 + 0.5 * math.sin(th * folds[0] + seed + z * 3.1)
            S.shade[i][j] = (0.72 + 0.28 * ph) if kind != "kilt" else (0.84 + 0.16 * ph)
            edge = j in (0, C - 1, C, 2 * C - 1) and kind in ("tails", "coat") and (z < split_z or kind == "coat")
            S.trim[i][j] = 1.0 if (i >= rows - 2 or edge) else 0.0
            if kind == "kilt" and j in (0, 1, 2 * C - 1):
                S.trim[i][j] = 1.0                          # the wrapped edge of the kilt, down the front
    return S.build(name, root, mat)


def belt(fit, root, mat, z0, z1):
    C = 48
    pel = fit.bone["pelvis"][0]
    cx, cy = 0.0, pel.y + 0.01
    dirs = [(math.sin(2 * math.pi * j / C), -math.cos(2 * math.pi * j / C)) for j in range(C)]
    rows = 4
    S = Sheet(rows, C + 1, False)
    for i in range(rows):
        z = z0 + (z1 - z0) * i / (rows - 1)
        ring = fit.ring(z, cx, cy, dirs)
        pts = [(cx + d[0] * (r + 0.014), cy + d[1] * (r + 0.014)) for d, r in zip(dirs, ring)]
        hull = _hull_radius(pts, (cx, cy), dirs)
        for j in range(C + 1):
            d = dirs[j % C]
            r = hull[j % C] + (0.004 if 0 < i < rows - 1 else 0)
            S.P[rows - 1 - i][j] = Vector((cx + d[0] * r, cy + d[1] * r, z))
            S.W[rows - 1 - i][j] = {"pelvis": 0.5, "spine_01": 0.5}
            S.UV[rows - 1 - i][j] = (j / C * 6, i / rows * 0.3)
            S.trim[rows - 1 - i][j] = 1.0
            S.shade[rows - 1 - i][j] = 0.9 if 0 < i < rows - 1 else 0.7
    return S.build("garment_belt", root, mat)


def hood(fit, root, mat, name, peak, cape):
    """A hood: rays from the middle of the head out to the skin with room behind, a soft peak over the brow, the face
    left open (the rows run round from one side of the face to the other); below the jaw it becomes a capelet laid
    over the shoulders, longer at the chest and back than over the arms."""
    c = fit.head_c.copy()
    c.z -= 0.01
    C = 64
    neck = fit.bone["neck_01"][0]
    sz = fit.bone["clavicle_l"][1].z
    s = Vector((0, neck.y + 0.02, sz - 0.07))                # the capelet's centre, in the upper chest
    lo = fit.head_lo
    el_brow = math.degrees(math.atan2((c.z + 0.055) - c.z, c.y - lo.y))
    el_chin = -62.0
    head_els = [90 - 4 * k for k in range(0, 38)]            # from the crown down to -58
    cape_rows = 12
    rows = len(head_els) + cape_rows
    S = Sheet(rows, C, False)
    S.keep = None
    def face_half(el):
        """Half the opening's angle at elevation el (0 above the brow and below the chin)."""
        if el >= el_brow or el <= el_chin:
            return 0.0
        t = (el - (el_brow + el_chin) / 2) / ((el_brow - el_chin) / 2)
        return math.radians(58) * math.sqrt(max(0.0, 1 - t ** 4)) ** 0.8
    for i in range(rows):
        if i < len(head_els):
            el = head_els[i]
            h = face_half(el)
            angs = [h + (2 * math.pi - 2 * h) * k / (C - 1) for k in range(C)]
        else:
            angs = [2 * math.pi * k / (C - 1) for k in range(C)]
        for j, th in enumerate(angs):
            dx, dy = math.sin(th), -math.cos(th)              # th 0: the front (-y)
            if i < len(head_els):
                er = math.radians(el)
                d = Vector((dx * math.cos(er), dy * math.cos(er), math.sin(er)))
                hit = fit.ray_in(fit.head, c + d * 0.35, c)
                r = (hit - c).length if hit else 0.1
                g = 0.03 + 0.06 * max(0.0, dy) ** 1.2 * _smooth(el, -50, 10) + 0.022 * max(0.0, math.sin(er))
                # round the opening the cloth stands off the cheeks and frames the face
                g += 0.012 * _smooth(-dy, 0.3, 0.9)
                p = c + d * (r + g)
                if peak and dy < 0:
                    near = math.exp(-(dx / 0.5) ** 2) * math.exp(-((el - (el_brow + 4)) / 22) ** 2)
                    p += Vector((0, -1, 0)) * peak * near
                    p.z -= peak * 0.35 * near
                hw = _smooth(el, -50, -10)
                w = {"head": hw, "neck_01": 1 - hw}
            else:
                k = (i - len(head_els) + 1) / cape_rows
                fb = abs(dy)                                  # 1 at the chest and the back, 0 over the arms
                el_end = -6 - (16 * fb ** 3 + 10 * max(0.0, dy) ** 2) * (1 if cape else 0.5)
                er = math.radians(55 + (el_end - 55) * k)
                d = Vector((dx * math.cos(er), dy * math.cos(er), math.sin(er)))
                hit = fit.ray_in(fit.torso, s + d * 0.6, s)
                r = (hit - s).length if hit else 0.16
                p = s + d * (r + 0.024 + 0.012 * k)
                w = {"neck_01": max(0.0, 0.5 - k), "spine_03": 0.5 + min(0.5, k)}
                if abs(dx) > 0.4:
                    sd = "l" if dx > 0 else "r"
                    cw = 0.5 * _smooth(abs(dx), 0.4, 0.95) * _smooth(k, 0.2, 0.8)
                    w = {kk: vv * (1 - cw) for kk, vv in w.items()}
                    w["clavicle_" + sd] = cw
            S.P[i][j] = p
            S.W[i][j] = w
            S.UV[i][j] = (th * 0.13 / 0.08, -i * 0.018 / 0.08)
            S.shade[i][j] = 1.0
            edge = i < len(head_els) and face_half(head_els[i]) > 0 and j in (0, C - 1)
            S.trim[i][j] = 1.0 if (peak and (edge or i == rows - 1)) else 0.0
            S.shade[i][j] = 0.8 if edge else 1.0
    # smooth the grid (rays meet ears, the jaw and the collar bones) and join the hood to the capelet
    closed = [i >= len(head_els) or face_half(head_els[i]) == 0 for i in range(rows)]
    # the cloth falls: down the back of the head it never comes closer to the neck than the row above
    ax = Vector((0, c.y, 0))
    for i in range(1, len(head_els)):
        if head_els[i] > 0:
            continue
        for j in range(C):
            p, q = S.P[i][j], S.P[i - 1][j]
            hp, hq = Vector((p.x, p.y - c.y, 0)), Vector((q.x, q.y - c.y, 0))
            if hp.dot(Vector((0, 1, 0))) > 0 and hp.length < hq.length:
                hp = hp.normalized() * (hp.length * 0.3 + hq.length * 0.7)
                S.P[i][j] = Vector((hp.x, hp.y + c.y, p.z))
    for it in range(6):
        NP = [[S.P[i][j].copy() for j in range(C)] for i in range(rows)]
        for i in range(1, rows - 1):
            for j in range(C):
                nb = [S.P[i - 1][j], S.P[i + 1][j]]
                if 0 < j < C - 1:
                    nb += [S.P[i][j - 1], S.P[i][j + 1]]
                elif closed[i]:                               # the seam at the front of a closed row: its neighbours across it
                    nb += [S.P[i][1], S.P[i][C - 2]]
                avg = sum(nb, Vector()) / len(nb)
                NP[i][j] = S.P[i][j].lerp(avg, 0.4)
            if closed[i]:
                m = (NP[i][0] + NP[i][C - 1]) / 2
                NP[i][0], NP[i][C - 1] = m, m.copy()
        S.P = NP
    top = sum((S.P[0][j] for j in range(C)), Vector()) / C          # the crown closes in one point
    for j in range(C):
        S.P[0][j] = top.copy()
    for i in range(rows):
        for j in range(C):
            p = S.P[i][j]
            loc, nrm, _, dist = fit.skin.find_nearest(p)
            if loc is not None and dist < 0.012:
                v = p - loc
                S.P[i][j] = loc + (v.normalized() if v.length > 1e-6 else nrm) * 0.012
    return S.build(name, root, mat)


def collar(fit, root, mat):
    """A broad collar (the usekh): a band laid round the neck over the collar bones and the top of the chest and back,
    in rows of beads (the trim mask alternates: the game colours them in two colours)."""
    neck = fit.bone["neck_01"][0]
    sz = fit.bone["clavicle_l"][1].z
    s = Vector((0, neck.y + 0.02, sz - 0.07))
    C, rows = 64, 9
    S = Sheet(rows, C, False)
    for i in range(rows):
        k = i / (rows - 1)
        for j in range(C):
            th = 2 * math.pi * j / (C - 1)
            dx, dy = math.sin(th), -math.cos(th)
            el_end = 22 - 18 * max(0.0, -dy) ** 2              # deeper over the chest
            el_top = 58 - 30 * max(0.0, -dy) ** 1.5                 # lower at the front: clear of the chin
            er = math.radians(el_top + (el_end - el_top) * k)
            d = Vector((dx * math.cos(er), dy * math.cos(er), math.sin(er)))
            hit = fit.ray_in(fit.torso, s + d * 0.6, s)
            r = (hit - s).length if hit else 0.16
            S.P[i][j] = s + d * (r + 0.008 + 0.004 * k)
            w = {"neck_01": max(0.0, 0.3 - k), "spine_03": 0.7 + min(0.3, k)}
            if abs(dx) > 0.5:
                sd = "l" if dx > 0 else "r"
                cw = 0.4 * _smooth(abs(dx), 0.5, 0.95) * k
                w = {kk: vv * (1 - cw) for kk, vv in w.items()}
                w["clavicle_" + sd] = cw
            S.W[i][j] = w
            S.UV[i][j] = (th * 0.13 / 0.05, -k * 0.1 / 0.05)
            S.trim[i][j] = 1.0 if i in (2, 3, 6) else 0.0
            S.shade[i][j] = 0.85 + 0.15 * math.cos(j * 2.1) if i not in (2, 3, 6) else 1.0
    # even out the rays' bumps (the shirt's folds), rows and columns, keeping it off the body
    for _ in range(3):
        NP = [[S.P[i][j].copy() for j in range(C)] for i in range(rows)]
        for i in range(rows):
            for j in range(C):
                jl, jr = (j - 1) % (C - 1), (j + 1) % (C - 1)
                nb = [S.P[i][jl], S.P[i][jr]] + ([S.P[i - 1][j]] if i > 0 else []) + ([S.P[i + 1][j]] if i < rows - 1 else [])
                NP[i][j] = S.P[i][j].lerp(sum(nb, Vector()) / len(nb), 0.5)
        S.P = NP
    for i in range(rows):
        for j in range(C):
            p = S.P[i][j]
            loc, nrm, _, dist = fit.skin.find_nearest(p)
            if loc is not None and dist < 0.01:
                v = p - loc
                S.P[i][j] = loc + (v.normalized() if v.length > 1e-6 else nrm) * 0.01
    return S.build("garment_collar", root, mat)


def cloak(fit, root, mat, length):
    """A cloak down the back, from the shoulders. Its top follows the upper back; below it hangs from the `cloak` bone."""
    C = 30
    sp3 = fit.bone["spine_03"]
    top = fit.bone["clavicle_l"][1].z + 0.035
    cx, cy = 0.0, sp3[0].y - 0.03
    span = math.radians(64)
    dirs = []
    for j in range(C):
        a = math.pi + (-span + 2 * span * j / (C - 1))           # round the back (+y)
        dirs.append((math.sin(a), -math.cos(a)))
    step = 0.03
    rows = int(length / step) + 1
    S = Sheet(rows, C, False)
    run = [0.0] * C
    rnd = random.Random(5)
    seed = rnd.random() * 6
    crotch = fit.bone["thigh_l"][0].z - 0.11
    for i in range(rows):
        z = top - i * step
        f = i / (rows - 1)
        if z > crotch - 0.05:
            ring = fit.ring(z, cx, cy, dirs)
            run = [max(a, b) for a, b in zip(run, ring)]
        # a cloak is one sheet: even out the ring (no dip at the spine), never closer than above
        sm = [(run[max(0, j - 1)] + 2 * run[j] + run[min(C - 1, j + 1)]) / 4 for j in range(C)]
        for j in range(C):
            a = -span + 2 * span * j / (C - 1)
            edge = abs(a) / span
            r = sm[j] + 0.012 + 0.045 * f + _fold(a, z, seed, 5, 0.032 * _smooth(f, 0.0, 0.6)) + 0.09 * f * edge ** 2
            d = dirs[j]
            p = Vector((cx + d[0] * r, cy + d[1] * r, z))
            # top rows lie over the shoulders
            if i == 0:
                p.z += 0.01
            hang = _smooth(f, 0.05, 0.45)
            s = "l" if d[0] > 0 else "r"
            w = {"spine_03": 1 - hang, "cloak": hang}
            if edge > 0.55 and f < 0.2:
                cw = 0.5 * _smooth(edge, 0.55, 1.0) * (1 - f / 0.2)
                w = {k: v * (1 - cw) for k, v in w.items()}
                w["clavicle_" + s] = cw
            S.P[i][j] = p
            S.W[i][j] = w
            S.UV[i][j] = (j / C * 2.0, -i * step / 0.25)
            S.trim[i][j] = 1.0 if (i >= rows - 2 or j in (0, C - 1)) else 0.0
            S.shade[i][j] = 0.74 + 0.26 * (0.5 + 0.5 * math.sin(a * 5 + seed + z * 3.1))
    S.flip = False
    return S.build("garment_cloak", root, mat)


def add_cloak_bone(root):
    """A bone for the cloak to hang from: at the top of the back, a child of spine_03 (the game drives it)."""
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.mode_set(mode="EDIT")
    eb = root.data.edit_bones
    sp3 = eb["spine_03"]
    b = eb.new("cloak")
    b.head = Vector((0, sp3.tail.y + 0.1, sp3.tail.z + 0.11))
    b.tail = b.head + Vector((0, 0.02, -0.25))
    b.parent = sp3
    bpy.ops.object.mode_set(mode="OBJECT")


def beard(fit, root, body, mat):
    """A beard and a moustache: the skin of the jaw, chin and upper lip, copied and lifted off the face."""
    c = fit.head_c
    lo = fit.head_lo
    mw = body.matrix_world
    pts = [mw @ v.co for v in body.data.vertices]
    head_w = [_weight(body, v, ("head",)) for v in body.data.vertices]
    # the face's profile: the nose tip is the most forward point of the head
    cand = [k for k, p in enumerate(pts) if head_w[k] > 0.5 and abs(p.x) < 0.01]
    nose = min((pts[k] for k in cand), key=lambda p: p.y)
    mouth_z = nose.z - 0.034
    chin_z = lo.z
    print("BEARD nose", tuple(round(x, 3) for x in nose), "chin", round(chin_z, 3))
    def region(p):
        if p.y > c.y + 0.0:                                    # in front of the ears only
            return 0.0
        if p.z > nose.z - 0.012:
            return 0.0
        if p.z < chin_z - 0.035:
            return 0.0
        # the lips stay clear
        if abs(p.x) < 0.026 and mouth_z - 0.011 < p.z < mouth_z + 0.008:
            return 0.0
        # under the jaw, not down the throat
        if p.z < chin_z + 0.01 and p.y > nose.y + 0.075:
            return 0.0
        # upper lip: only the moustache, under the nose
        if p.z > mouth_z + 0.008 and abs(p.x) > 0.03:
            return 0.0
        side = p.y > nose.y + 0.06 and p.z > mouth_z + 0.02    # the cheeks above the jawline stay bare
        return 0.0 if side else 1.0
    keep = [region(p) > 0.5 and head_w[k] > 0.3 for k, p in enumerate(pts)]
    me = body.data
    polys = [p for p in me.polygons if all(keep[i] for i in p.vertices)]
    used = sorted({i for p in polys for i in p.vertices})
    remap = {i: k for k, i in enumerate(used)}
    normals = {i: (mw.to_3x3() @ me.vertices[i].normal).normalized() for i in used}
    verts = []
    for i in used:
        p = pts[i]
        t = 0.006 + 0.01 * _smooth(-(p.z - mouth_z), 0.0, 0.05)
        verts.append(p + normals[i] * t)
    nm = bpy.data.meshes.new("garment_beard")
    nm.from_pydata([tuple(v) for v in verts], [], [[remap[i] for i in p.vertices] for p in polys])
    nm.update()
    ob = bpy.data.objects.new("garment_beard", nm)
    bpy.context.scene.collection.objects.link(ob)
    uv = nm.uv_layers.new(name="UVMap")
    for poly in nm.polygons:
        for li in poly.loop_indices:
            v = verts[nm.loops[li].vertex_index]
            uv.data[li].uv = (v.x * 9 + 0.5, v.z * 9)
    col = nm.color_attributes.new(name="Col", type="BYTE_COLOR", domain="POINT")
    for k in range(len(verts)):
        col.data[k].color = (0.0, 1.0, 0.0, 1.0)
    nm.color_attributes.active_color = col
    for g in body.vertex_groups:
        ng = ob.vertex_groups.new(name=g.name)
    for k, i in enumerate(used):
        for g in me.vertices[i].groups:
            ob.vertex_groups[body.vertex_groups[g.group].name].add([k], g.weight, "REPLACE")
    for p in nm.polygons:
        p.use_smooth = True
    ob.data.materials.append(mat)
    ob.parent = root
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = root
    print("BEARD faces", len(polys))
    return ob


def make_garments(root, body, male):
    fit = Fit(root, body)
    img = _linen()
    mat = _material(img)
    add_cloak_bone(root)
    waist = fit.bone["pelvis"][0].z + 0.085
    made = [
        skirt(fit, root, mat, "garment_tails", waist + 0.01, 0.44, "tails"),
        skirt(fit, root, mat, "garment_long", waist + 0.01, 0.1, "long"),
        skirt(fit, root, mat, "garment_coat", waist + 0.01, 0.3, "coat"),
        skirt(fit, root, mat, "garment_kilt", waist + 0.01, 0.6, "kilt"),
        belt(fit, root, mat, waist - 0.025, waist + 0.03),
        hood(fit, root, mat, "garment_hood", 0.03, True),
        hood(fit, root, mat, "garment_scarf", 0.0, False),
        cloak(fit, root, mat, 0.98),
        collar(fit, root, mat),
    ]
    if male:
        made.append(beard(fit, root, body, mat))
    for ob in made:
        print("GARMENT", ob.name, len(ob.data.vertices), "verts", len(ob.data.polygons), "faces")
    return made
