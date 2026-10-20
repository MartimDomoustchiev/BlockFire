/* ============================================================
 * Voxel raycast (Amanatides & Woo DDA).
 * Walks the grid cell by cell along the ray, so it never skips a
 * block no matter how thin the hit, and reports the face it entered
 * through (nx,ny,nz) - placing a block goes at (x+nx, y+ny, z+nz).
 * ============================================================ */

/**
 * @param world   World (getBlock)
 * @param o       origin {x,y,z}
 * @param d       direction {x,y,z} (need not be normalised)
 * @param maxDist maximum distance in blocks
 * @param opts    { liquids: false } - also stop at water when true
 *                { filter(id) } - custom "does this block stop the ray" test
 * @returns {x,y,z,block,nx,ny,nz,dist} or null. Starting inside a block
 *          returns that block with dist 0 and a zero normal.
 */
function raycastBlocks(world, o, d, maxDist, opts) {
  const len = Math.hypot(d.x, d.y, d.z);
  if (!(len > 0)) return null;
  const dx = d.x / len, dy = d.y / len, dz = d.z / len;
  const liquids = opts && opts.liquids;
  const filter = opts && opts.filter;

  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  // distance along the ray to cross one whole cell on each axis
  const tdx = stepX ? Math.abs(1 / dx) : Infinity;
  const tdy = stepY ? Math.abs(1 / dy) : Infinity;
  const tdz = stepZ ? Math.abs(1 / dz) : Infinity;
  // distance to the first cell boundary on each axis
  let tmx = stepX > 0 ? (x + 1 - o.x) * tdx : stepX < 0 ? (o.x - x) * tdx : Infinity;
  let tmy = stepY > 0 ? (y + 1 - o.y) * tdy : stepY < 0 ? (o.y - y) * tdy : Infinity;
  let tmz = stepZ > 0 ? (z + 1 - o.z) * tdz : stepZ < 0 ? (o.z - z) * tdz : Infinity;

  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let guard = 0; guard < 4096; guard++) {
    if (y < 0 && stepY <= 0) return null;                        // fell out of the world
    if (y >= CONFIG.CHUNK_HEIGHT && stepY >= 0) return null;     // left through the sky
    const b = world.getBlock(x, y, z);
    if (b === -1) return null;                                   // unloaded terrain
    if (b !== BLOCK.AIR) {
      const stops = filter ? filter(b) : (liquids || !BlockTables.liquid[b]);
      if (stops) return { x, y, z, block: b, nx, ny, nz, dist: t };
    }
    if (tmx < tmy && tmx < tmz) {
      t = tmx; tmx += tdx; x += stepX; nx = -stepX; ny = 0; nz = 0;
    } else if (tmy < tmz) {
      t = tmy; tmy += tdy; y += stepY; nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tmz; tmz += tdz; z += stepZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) return null;
  }
  return null;
}
