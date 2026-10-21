/*
 * Draws the BLOCKFIRE icon (a stone block on fire, pixel style) and writes:
 *   mac/AppIcon.icns                    the Mac app icon (via sips + iconutil)
 *   icons/icon-192.png, icon-512.png    for the installable web app / favicon
 *   icons/icon-maskable-512.png         same, with safe padding for round masks
 *   native/resources/icon.png           1024px, full bleed, for the Android and iPhone apps (npx @capacitor/assets generate)
 * Dev tool: needs the test harness's Playwright (node mac/make-icons.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('../tests/harness.js');

const ROOT = path.join(__dirname, '..');

function drawIcon({ size, maskable }) {
  /* runs in the page */
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const k = size / 1024;
  g.scale(k, k);
  // background tile: a rounded square (full bleed when maskable)
  const inset = maskable ? 0 : 100, R = maskable ? 0 : 185, W = 1024 - inset * 2;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  if (!maskable) { g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 40; g.shadowOffsetY = 14; rr(inset, inset, W, W, R); g.fillStyle = '#0d131d'; g.fill(); g.restore(); }
  rr(inset, inset, W, W, R);
  g.save();
  g.clip();
  const bg = g.createLinearGradient(0, inset, 0, inset + W);
  bg.addColorStop(0, '#1d2b45'); bg.addColorStop(1, '#090d15');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 1024);
  const glow = g.createRadialGradient(512, 430, 40, 512, 430, 520);
  glow.addColorStop(0, 'rgba(255,140,50,0.55)'); glow.addColorStop(0.5, 'rgba(255,90,30,0.14)'); glow.addColorStop(1, 'rgba(255,90,30,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 1024, 1024);
  // embers drifting up
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(255,${150 + rnd() * 80 | 0},60,${0.35 + rnd() * 0.5})`; const s = 8 + rnd() * 10; g.fillRect(200 + rnd() * 620, 130 + rnd() * 330, s, s); }

  // the block: an isometric cube, textured in pixels
  const s = maskable ? 0.86 : 1, cx = 512, ty = maskable ? 330 : 300;
  const a = 230 * s, h = 133 * s, d = 265 * s;
  const top = [[cx, ty], [cx + a, ty + h], [cx, ty + 2 * h], [cx - a, ty + h]];
  const left = [[cx - a, ty + h], [cx, ty + 2 * h], [cx, ty + 2 * h + d], [cx - a, ty + h + d]];
  const right = [[cx, ty + 2 * h], [cx + a, ty + h], [cx + a, ty + h + d], [cx, ty + 2 * h + d]];
  const face = (P, n, colour) => {
    // bilinear map of an n x n grid of cells onto the quad P
    const at = (u, v) => [P[0][0] + (P[1][0] - P[0][0]) * u + (P[3][0] - P[0][0]) * v, P[0][1] + (P[1][1] - P[0][1]) * u + (P[3][1] - P[0][1]) * v];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = [at(i / n, j / n), at((i + 1) / n, j / n), at((i + 1) / n, (j + 1) / n), at(i / n, (j + 1) / n)];
      g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let q = 1; q < 4; q++) g.lineTo(p[q][0], p[q][1]); g.closePath();
      g.fillStyle = colour(i, j, rnd()); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 1.5; g.stroke();
    }
  };
  const stone = (shade) => (i, j, r) => { const v = (118 + (r - 0.5) * 34 + ((i * 7 + j * 3) % 5 === 0 ? -26 : 0)) * shade; return `rgb(${v | 0},${v | 0},${(v + 6) | 0})`; };
  face(left, 8, stone(0.72));
  face(right, 8, stone(0.52));
  // top: glowing embers
  face(top, 8, (i, j, r) => {
    const hot = r < 0.35 ? [255, 214, 92] : r < 0.7 ? [255, 132, 40] : [190, 52, 28];
    return `rgb(${hot[0]},${hot[1]},${hot[2]})`;
  });
  // edges
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 8; g.lineJoin = 'round';
  for (const P of [top, left, right]) { g.beginPath(); g.moveTo(P[0][0], P[0][1]); for (let q = 1; q < 4; q++) g.lineTo(P[q][0], P[q][1]); g.closePath(); g.stroke(); }

  // pixel flames rising from the top face
  const heights = [2, 4, 7, 5, 9, 12, 8, 11, 13, 10, 7, 9, 6, 4, 3, 1];
  const cell = 22 * s, x0 = cx - heights.length * cell / 2, base = ty + h + cell * 1.2;
  heights.forEach((hc, col) => {
    for (let r = 0; r < hc; r++) {
      const t = r / hc;
      g.fillStyle = t < 0.3 ? '#fff4b8' : t < 0.58 ? '#ffc23a' : t < 0.84 ? '#ff7a2f' : '#d8341e';
      g.fillRect(x0 + col * cell, base - (r + 1) * cell, cell + 0.5, cell + 0.5);
    }
  });
  g.restore();
  return c.toDataURL('image/png');
}

(async () => {
  const browser = await H.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  const write = async (file, size, maskable) => {
    const url = await page.evaluate(drawIcon, { size, maskable });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  };
  // the 1024px master and the icon set are scratch files: they live in a temp folder
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blockfire-icon-'));
  const master = path.join(tmp, 'icon-1024.png');
  await write(master, 1024, false);
  await write(path.join(ROOT, 'icons', 'icon-512.png'), 512, false);
  await write(path.join(ROOT, 'icons', 'icon-192.png'), 192, false);
  await write(path.join(ROOT, 'icons', 'icon-maskable-512.png'), 512, true);
  // phones round or square the corners themselves: the source is the full-bleed square
  await write(path.join(ROOT, 'native', 'resources', 'icon.png'), 1024, true);
  await browser.close();

  // the Mac icon set: every size macOS wants, then one .icns
  const set = path.join(tmp, 'AppIcon.iconset');
  fs.mkdirSync(set);
  for (const sz of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(sz), String(sz), master, '--out', path.join(set, `icon_${sz}x${sz}.png`)], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(sz * 2), String(sz * 2), master, '--out', path.join(set, `icon_${sz}x${sz}@2x.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(ROOT, 'mac', 'AppIcon.icns')]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('icons written');
})();
