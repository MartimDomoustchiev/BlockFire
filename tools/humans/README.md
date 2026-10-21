# The game's people (MakeHuman, CC0)

`js/assets/humans-data.js` holds the two people the game draws on the Medium, High and Ultra presets (render/humans.js):
a man and a woman, built with MakeHuman's Blender extension (MPFB 2) from the **makehuman_system_assets** pack. Every
asset used is CC0 (public domain), so the game may ship them.

## Rebuild

```
./tools/humans/build.sh
```

Needs, once:

1. Blender 4.2 or newer (`brew install --cask blender` on a Mac).
2. The MPFB extension:
   `Blender --online-mode --command extension sync` then `Blender --online-mode --command extension install mpfb --enable`.
3. The system assets, unpacked into MPFB's user data folder (on a Mac:
   `~/Library/Application Support/Blender/<version>/extensions/.user/blender_org/mpfb/data`), from
   https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
4. python3 with Pillow.

## What it does

- `build_human.py` (run inside Blender): a young adult (shape set by MakeHuman's macros), the `game_engine` rig, a skin,
  eyes, eyebrows, eyelashes, seven hair styles (one mesh each), a long-sleeved shirt with trousers and shoes. The skin
  under the clothes is marked in a vertex colour (red) so the game can hide it under worn clothes and show it for a bare
  chest. The shape keys are baked; only colour textures are kept.
- `garments.py` (run by `build_human.py`): the garments made for each body - coat skirt, long robe, coat, kilt, belt,
  hood, headcloth, cloak (with its own `cloak` bone), broad collar and, for the man, a beard - shaped by rays cast at the
  body and skinned to the skeleton. `Blender -b --python build_human.py -- out.glb male fitted.blend` also saves the fitted
  body before the garments, to work on them.
- `pack_glb.py`: opaque textures to JPEG, textures with transparency (hair, brows, lashes) to 256-colour PNG.
- `build.sh`: both people, packed, written as base64 into `js/assets/humans-data.js` (a script, so it loads from
  `file://` too). About 4.9 MB per person.
