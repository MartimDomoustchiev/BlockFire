# ============================================================
# Builds one BLOCKFIRE human with MakeHuman's Blender extension (MPFB 2), from the CC0 MakeHuman system assets,
# and exports it as a GLB the game loads (js/render/humans.js). Dev tool; see tools/humans/README.md.
#
#   Blender -b --python tools/humans/build_human.py -- <out.glb> <male|female>
#
# The human: a young adult, the game_engine rig, a skin, eyes, brows and lashes, every hair style the look
# editor offers (one mesh each; the game shows one), a long-sleeved shirt with trousers (the game greys and
# tints them into a tunic and trousers) and shoes. Before export the body gets a vertex colour: red where the
# shirt and trousers cover it (the game hides that part of the skin under clothes, and shows it for bare
# chests). Textures are scaled to 1024 px and written as JPEG to keep the file small.
# ============================================================
import bpy, sys, importlib


def di(package, key):
    """MPFB is an extension: its modules live under a package name only known at run time."""
    for name in list(sys.modules):
        if name.endswith(package):
            return getattr(importlib.import_module(name), key)
    raise ValueError(package)


HumanService = di("mpfb.services.humanservice", "HumanService")
AssetService = di("mpfb.services.assetservice", "AssetService")
ExportService = di("mpfb.services.exportservice", "ExportService")
ObjectService = di("mpfb.services.objectservice", "ObjectService")
TargetService = di("mpfb.services.targetservice", "TargetService")
HumanObjectProperties = di("mpfb.entities.objectproperties", "HumanObjectProperties")

args = sys.argv[sys.argv.index("--") + 1:]
OUT, SEX = args[0], args[1]
MALE = SEX == "male"

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

basemesh = HumanService.create_human()
macros = dict(gender=1.0 if MALE else 0.0, age=0.5,                    # MakeHuman: gender 1 is male, 0 female muscle=0.62 if MALE else 0.5, weight=0.5, height=0.5,
              proportions=0.62, african=0.34, asian=0.22, caucasian=0.44)
for k, v in macros.items():
    HumanObjectProperties.set_value(k, v, entity_reference=basemesh)
TargetService.reapply_macro_details(basemesh)

skin = AssetService.find_asset_absolute_path(("young_caucasian_male" if MALE else "young_caucasian_female") + ".mhmat", asset_subdir="skins")
HumanService.set_character_skin(skin, basemesh, skin_type="GAMEENGINE")
HumanService.add_builtin_rig(basemesh, "game_engine")

HAIR = ["short02", "short04", "afro01", "long01", "ponytail01", "bob01", "braid01"]
assets = [("eyes", "low-poly.mhclo", "Eyes"), ("eyebrows", "eyebrow001.mhclo", "Eyebrows"), ("eyelashes", "eyelashes01.mhclo", "Eyelashes")]
assets += [("hair", h + ".mhclo", "Hair") for h in HAIR]
assets += [("clothes", "male_casualsuit01.mhclo", "Clothes"), ("clothes", "shoes02.mhclo", "Clothes")]
for subdir, fname, atype in assets:
    path = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
    if path is None:
        print("MISSING", fname)
        continue
    HumanService.add_mhclo_asset(path, basemesh, asset_type=atype, material_type="GAMEENGINE")

print("MODIFIERS", [(m.type, m.name, getattr(m, "vertex_group", None), getattr(m, "invert_vertex_group", None)) for m in basemesh.modifiers])

# the skin under the clothes: the clothes' "Delete.*" masks (inverted: their vertices are hidden), into a vertex colour
masks = [m for m in basemesh.modifiers if m.type == "MASK" and m.vertex_group and m.invert_vertex_group]
under = set()
for m in masks:
    vg = basemesh.vertex_groups.get(m.vertex_group)
    if not vg:
        continue
    for v in basemesh.data.vertices:
        for g in v.groups:
            if g.group == vg.index and g.weight > 0.5:
                under.add(v.index)
print("UNDER", len(under), "of", len(basemesh.data.vertices), [m.vertex_group for m in masks], [m.invert_vertex_group for m in masks])
# put it on the body itself, before the copy: it travels through the copy, the removal of the helpers and the bake
attr = basemesh.data.color_attributes.new(name="Col", type="BYTE_COLOR", domain="POINT")
for i in range(len(basemesh.data.vertices)):
    attr.data[i].color = (1.0 if i in under else 0.0, 0.0, 0.0, 1.0)
basemesh.data.color_attributes.active_color = attr

root = ExportService.create_character_copy(basemesh, name_suffix="_export")
body = ObjectService.find_object_of_type_amongst_nearest_relatives(root, "Basemesh")
for m in list(body.modifiers):
    if m.type == "MASK":
        body.modifiers.remove(m)
ExportService.bake_modifiers_remove_helpers(body, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True)
# the body's shape (gender, muscle, proportions) lives in shape keys, which the exporter would leave out: bake them, so the
# body matches the hair, eyes and clothes that were fitted to it
TargetService.bake_targets(body)
col = body.data.color_attributes.get("Col")
print("BODY VERTS AFTER", len(body.data.vertices), "shape keys", body.data.shape_keys, "under on the copy",
      sum(1 for d in col.data if d.color[0] > 0.5) if col else None)
if col:
    body.data.color_attributes.active_color = col

# only the colour textures go into the game (its lighting is its own): unlink normal, roughness and occlusion maps,
# and keep the colour images small - 1024 px for the skin and the clothes, 512 for hair and the small pieces
kept = set()
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    for link in list(nt.links):
        if link.to_socket.name in ("Normal", "Roughness", "Metallic", "Specular", "Specular IOR Level", "Coat Normal") or link.to_node.type in ("NORMAL_MAP", "BUMP"):
            nt.links.remove(link)
    for node in nt.nodes:
        if node.type == "TEX_IMAGE" and node.image and any(l.to_socket.name in ("Base Color", "Alpha") for l in node.outputs[0].links):
            kept.add((node.image.name, mat.name))
big = ("body", "casualsuit", "shoes")
for img in bpy.data.images:
    users = [m for (i, m) in kept if i == img.name]
    if not users:
        continue
    limit = 1024 if any(b in u.lower() for u in users for b in big) else 512
    if img.size[0] > limit:
        img.scale(limit, limit * img.size[1] // img.size[0])
print("TEXTURES", sorted(kept))

# the garments the game dresses people in (robes, the kilt, hoods, the cloak, the beard): made to fit this body
if len(args) > 2:
    bpy.ops.wm.save_as_mainfile(filepath=args[2])         # dev: the fitted body, to work on the garments (garments.py)
import os
exec(compile(open(os.path.join(os.path.dirname(__file__), "garments.py")).read(), "garments.py", "exec"))
make_garments(root, body, MALE)

# export the copy: the armature and its meshes
bpy.ops.object.select_all(action="DESELECT")
objs = [root] + [c for c in root.children_recursive]
for ob in objs:
    ob.select_set(True)
    if ob.type == "MESH":
        print("MESH", ob.name, len(ob.data.vertices), [s.material.name if s.material else None for s in ob.material_slots])
bpy.context.view_layer.objects.active = root
if root.type == "ARMATURE":
    print("BONES", [b.name for b in root.data.bones])
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_skins=True, export_animations=False,
                          export_image_format="JPEG", export_jpeg_quality=82, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_morph=False, export_apply=False)
print("EXPORTED", OUT)
