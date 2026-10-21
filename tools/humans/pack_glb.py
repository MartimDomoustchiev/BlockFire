# ============================================================
# Shrinks a GLB from build_human.py: opaque textures (skin, clothes, shoes, eyes) become JPEG, and textures with
# transparency (hair, brows, lashes) become 256-colour PNG. Rewrites the binary chunk with the new images.
#
#   python3 tools/humans/pack_glb.py <in.glb> <out.glb>
# ============================================================
import io, json, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
jlen = struct.unpack("<I", data[12:16])[0]
j = json.loads(data[20:20 + jlen])
boff = 20 + jlen
blen = struct.unpack("<I", data[boff:boff + 4])[0]
bin_ = data[boff + 8:boff + 8 + blen]
views = j["bufferViews"]
image_views = {img["bufferView"]: k for k, img in enumerate(j["images"])}

SIZES = {"skin": 1024, "diffuse_body": 1024}
def recode(img_json, raw):
    im = Image.open(io.BytesIO(raw))
    name = (img_json.get("name") or "").lower()
    alpha = im.mode in ("RGBA", "LA", "P") and im.convert("RGBA").getextrema()[3][0] < 250
    limit = 1024 if ("casualsuit" in name or "skinned" in name) else 512 if not ("eye" in name and "brow" not in name and "lash" not in name) else 256
    if im.width > limit:
        im = im.resize((limit, limit * im.height // im.width), Image.LANCZOS)
    out = io.BytesIO()
    if alpha:
        im.convert("RGBA").quantize(256, method=Image.Quantize.FASTOCTREE).save(out, "PNG", optimize=True)
        img_json["mimeType"] = "image/png"
    else:
        im.convert("RGB").save(out, "JPEG", quality=82, optimize=True)
        img_json["mimeType"] = "image/jpeg"
    return out.getvalue()

parts, off = [], 0
for i, v in enumerate(views):
    raw = bin_[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
    if i in image_views:
        raw = recode(j["images"][image_views[i]], raw)
    pad = (-off) % 4
    if pad:
        parts.append(b"\0" * pad); off += pad
    v["byteOffset"] = off; v["byteLength"] = len(raw)
    parts.append(raw); off += len(raw)
newbin = b"".join(parts)
newbin += b"\0" * ((-len(newbin)) % 4)
j["buffers"][0]["byteLength"] = len(newbin)
js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * ((-len(js)) % 4)
total = 12 + 8 + len(js) + 8 + len(newbin)
with open(dst, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack("<II", len(newbin), 0x004E4942)); f.write(newbin)
print("packed", src, "->", dst, round(total / 1e6, 2), "MB")
