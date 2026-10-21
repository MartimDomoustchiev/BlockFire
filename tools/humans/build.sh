#!/bin/bash
# ============================================================
# Builds the game's two people (js/assets/humans-data.js) from MakeHuman's CC0 system assets.
#
#   ./tools/humans/build.sh
#
# Needs Blender 4.2+ with the MPFB extension and the makehuman_system_assets pack installed (see README.md here),
# and python3 with Pillow. Takes a minute or two.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
WORK="$(mktemp -d)"
for sex in male female; do
  "$BLENDER" -b --python tools/humans/build_human.py -- "$WORK/$sex.glb" "$sex" > "$WORK/$sex.log" 2>&1 || { tail -30 "$WORK/$sex.log"; exit 1; }
  grep -E "UNDER|BODY VERTS" "$WORK/$sex.log" || true
  python3 tools/humans/pack_glb.py "$WORK/$sex.glb" "$WORK/$sex.packed.glb"
done
mkdir -p js/assets
python3 - "$WORK/male.packed.glb" "$WORK/female.packed.glb" js/assets/humans-data.js <<'PY'
import base64, sys
male, female, out = sys.argv[1:4]
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
with open(out, 'w') as f:
    f.write('/* The game\'s two people, built by tools/humans/build.sh from MakeHuman\'s CC0 system assets (GLB, base64).\n')
    f.write('   Loaded in the background by HumanModels (js/render/humans.js). Generated: do not edit. */\n')
    f.write('window.HUMAN_GLB = {\n  male: "' + b64(male) + '",\n  female: "' + b64(female) + '",\n};\n')
print('wrote', out)
PY
rm -rf "$WORK"
