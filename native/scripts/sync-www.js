// ============================================================
// Copies the game into native/www, the folder the Android and
// iPhone apps load. Run by `npm run sync` (and by the build scripts).
//
// The same files as the Mac app (mac/build.sh), except sw.js: the
// app is installed with its files, so a cached copy in the phone's
// web view could only ever be a stale one. The copied index.html
// also gets window.__phoneApp, which the game reads to hide the
// browser-only controls (see js/ui/app-shell.js).
// ============================================================
const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'www');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of ['index.html', 'three.min.js']) fs.copyFileSync(path.join(GAME, f), path.join(OUT, f));
for (const d of ['js', 'vendor', 'icons']) fs.cpSync(path.join(GAME, d), path.join(OUT, d), { recursive: true });

const indexPath = path.join(OUT, 'index.html');
const marker = '<meta charset="utf-8">';
const html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes(marker)) throw new Error('index.html has no ' + marker + ' line to hang the phone flag on');
fs.writeFileSync(indexPath, html.replace(marker, marker + '\n<script>window.__phoneApp = true;</script>'));

console.log('Synced the game to ' + OUT);
