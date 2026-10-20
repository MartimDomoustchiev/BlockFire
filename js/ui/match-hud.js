/* ============================================================
 * Match HUD: minimap (north-up island map rendered once from the
 * world data, storm shading + next-circle outline, vehicle and
 * player markers), compass strip, alive / kills / storm timer,
 * spectator label and the end-of-match results screen.
 * ============================================================ */
class MatchHud {
  constructor(hudRoot) {
    const $ = (cls) => hudRoot.querySelector('.' + cls);
    this.el = {
      mapWrap: $('minimap'), map: $('minimapCanvas'), compass: $('compass'), info: $('matchInfo'),
      storm: $('stormInfo'), tint: $('stormTint'), spect: $('spectating'), results: document.getElementById('results'),
    };
    this.ctx = this.el.map.getContext('2d');
    this.mapImg = null;
    this.SCALE = 2;                       // blocks per map pixel
    // compass ticks
    const strip = document.createElement('div');
    strip.className = 'strip';
    for (let deg = -360; deg <= 720; deg += 15) {
      const t = document.createElement('span');
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[((deg % 360) + 360) % 360];
      t.textContent = label || (deg % 45 === 0 ? ((deg % 360) + 360) % 360 : '|');
      if (label) t.className = 'cardinal';
      t.style.left = (deg * 3) + 'px';
      strip.appendChild(t);
    }
    this.el.compass.appendChild(strip);
    this.strip = strip;
    this.onPlayAgain = null;
    this.onMenu = null;
  }

  /** Paints the island map from the world's column tops (call once the island is loaded). */
  buildMap(game, tileColors) {
    const R = (game.islandRadius || CONFIG.ISLAND.RADIUS) + 20, S = this.SCALE, n = Math.ceil(R * 2 / S);
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d'), img = ctx.createImageData(n, n), w = game.world;
    for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
      const x = Math.floor(-R + px * S), z = Math.floor(-R + py * S);
      let col = [0.12, 0.3, 0.55], y = 0;
      for (y = CONFIG.CHUNK_HEIGHT - 1; y >= 0; y--) {
        const b = w.getBlock(x, y, z);
        if (b <= 0) continue;
        if (b === BLOCK.WATER) { col = [0.16, 0.38, 0.7]; break; }
        const t = BlockTables.faceTiles[b * 6 + 2];
        col = t >= 0 ? tileColors[t] : [0.5, 0.5, 0.5];
        break;
      }
      const shade = 0.75 + Math.max(0, Math.min(1, (y - CONFIG.SEA_LEVEL) / 30)) * 0.4;
      const o = (py * n + px) * 4;
      img.data[o] = Math.min(255, col[0] * 255 * shade); img.data[o + 1] = Math.min(255, col[1] * 255 * shade);
      img.data[o + 2] = Math.min(255, col[2] * 255 * shade); img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapImg = c;
    this.mapR = R;
  }

  setVisible(v, hasMatch) {
    const story = !!(this.game && this.game.story);
    this.el.mapWrap.style.display = v && hasMatch ? 'block' : 'none';
    this.el.compass.style.display = v ? 'block' : 'none';
    this.el.info.style.display = v && hasMatch && !story ? 'block' : 'none';
    this.el.storm.style.display = v && hasMatch && !story ? 'block' : 'none';
    if (!v) { this.el.tint.style.opacity = 0; this.el.spect.style.display = 'none'; }
  }

  /** viewer: the character whose view is shown (the local player or who we spectate). */
  update(game, me, viewer, camera) {
    // compass: north is -z; 3 px per degree, the current heading sits under the centre marker
    const e = camera.matrixWorld.elements, dx = -e[8], dz = -e[10];
    const heading = ((THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) % 360) + 360) % 360;
    this.strip.style.transform = 'translateX(' + (-heading * 3) + 'px)';

    this.game = game;
    const m = game.match;
    if (!m) { if (game.story) this.storyMap(game, me, viewer); return; }
    const storm = m.storm;
    const alive = m.participants.filter((c) => c.alive).length;
    this.el.info.innerHTML = '<b>' + alive + '</b> ALIVE &nbsp; <b>' + me.stats.kills + '</b> KILLS';
    if (storm) {
      const mm = Math.floor(Math.max(0, storm.timer) / 60), ss = Math.floor(Math.max(0, storm.timer) % 60);
      const t = mm + ':' + String(ss).padStart(2, '0');
      this.el.storm.textContent = storm.state === 'final' ? 'FINAL CIRCLE' : storm.state === 'waiting'
        ? 'Storm phase ' + (storm.phase + 1) + ' in ' + t : 'STORM CLOSING ' + t;
      this.el.storm.classList.toggle('closing', storm.state === 'shrinking');
      const out = storm.outside(viewer.pos.x, viewer.pos.z);
      this.el.tint.style.opacity = out > 0 && viewer.alive ? 0.35 : 0;
    }

    // minimap
    const ctx = this.ctx, W = this.el.map.width, H = this.el.map.height;
    ctx.fillStyle = '#183457';
    ctx.fillRect(0, 0, W, H);
    const VIEW = 110;                                    // blocks from centre to edge
    const k = W / (VIEW * 2);
    const toMap = (x, z) => [W / 2 + (x - viewer.pos.x) * k, H / 2 + (z - viewer.pos.z) * k];
    if (this.mapImg) {
      const [mx, my] = toMap(-this.mapR, -this.mapR);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.mapImg, mx, my, this.mapR * 2 * k, this.mapR * 2 * k);
    }
    if (storm) {
      const [cx, cy] = toMap(storm.cur.x, storm.cur.z);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, storm.cur.r * k, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(150,40,220,0.45)'; ctx.fill('evenodd');
      ctx.restore();
      if (storm.state !== 'final') {
        const [nx, ny] = toMap(storm.to.x, storm.to.z);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(nx, ny, storm.to.r * k, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const e of game.entities.values()) {
      if (e.type === 'vehicle' && e.alive) {
        const [x, y] = toMap(e.pos.x, e.pos.z);
        ctx.fillStyle = '#ffd34a'; ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }
    // local players (and, in duels, the other local player) as arrows
    for (const c of game.characters()) {
      if (!c.alive || !(c.isLocal || c === viewer)) continue;
      const [x, y] = toMap(c.pos.x, c.pos.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-c.yaw);
      ctx.fillStyle = c === me ? '#ffffff' : '#ff7a2f';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }

    // spectating
    this.el.spect.style.display = viewer !== me ? '' : 'none';
    if (viewer !== me) this.el.spect.textContent = 'SPECTATING ' + viewer.name.toUpperCase();
  }

  /** Story mode minimap: the island under the fog of war, viewpoints, the objective, players. */
  storyMap(game, me, viewer) {
    const st = game.story, ctx = this.ctx, W = this.el.map.width, H = this.el.map.height;
    ctx.fillStyle = '#183457';
    ctx.fillRect(0, 0, W, H);
    const VIEW = 90, k = W / (VIEW * 2);
    const toMap = (x, z) => [W / 2 + (x - viewer.pos.x) * k, H / 2 + (z - viewer.pos.z) * k];
    if (this.mapImg) {
      const [mx, my] = toMap(-this.mapR, -this.mapR);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.mapImg, mx, my, this.mapR * 2 * k, this.mapR * 2 * k);
      // fog of war
      if (!this.fog || this.fogN !== st.explored.length) {
        const c = this.fog || document.createElement('canvas'), R = this.mapR;
        c.width = c.height = 256;
        const g = c.getContext('2d'), s = c.width / (2 * R);
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, 256, 256); g.fillStyle = 'rgba(8,11,16,0.85)'; g.fillRect(0, 0, 256, 256);
        g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
        for (const [x, z, r] of st.explored) { g.beginPath(); g.arc((x + R) * s, (z + R) * s, r * s, 0, Math.PI * 2); g.fill(); }
        this.fog = c; this.fogN = st.explored.length;
      }
      ctx.drawImage(this.fog, mx, my, this.mapR * 2 * k, this.mapR * 2 * k);
    }
    for (const vp of st.plan.viewpoints) {
      const [x, y] = toMap(vp.top.x, vp.top.z);
      ctx.fillStyle = st.isSyncedId(vp.id) ? '#ffd34a' : '#8a94a2';
      ctx.beginPath(); ctx.ellipse(x, y, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    // arms crates and the hideout's supply chest: small brown boxes
    for (const site of st.plan.sites) {
      const a = site.poi.armory;
      if (!a) continue;
      const [x, y] = toMap(a.x, a.z);
      ctx.fillStyle = '#1a120a'; ctx.fillRect(x - 3.5, y - 3, 7, 6);
      ctx.fillStyle = '#9a6634'; ctx.fillRect(x - 2.5, y - 2, 5, 4);
    }
    // guards hunting you show up as red dots
    for (const c of game.characters()) {
      if (c.alive && c.npcRole === 'guard' && st.hunting(c, me)) { const [x, y] = toMap(c.pos.x, c.pos.z); ctx.fillStyle = '#ff3b2f'; ctx.fillRect(x - 2, y - 2, 4, 4); }
    }
    const o = st.objective(), mk = o && o.marker;
    if (mk) {
      const p = mk.type === 'character' ? mk.pos : mk;
      let [x, y] = toMap(p.x, p.z);
      x = Math.max(6, Math.min(W - 6, x)); y = Math.max(6, Math.min(H - 6, y));
      ctx.fillStyle = '#ff7a2f'; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (const c of game.characters()) {
      if (!c.alive || !(c.isHuman || c === me)) continue;
      const [x, y] = toMap(c.pos.x, c.pos.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-c.yaw);
      ctx.fillStyle = c === me ? '#ffffff' : '#7fd0ff';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    this.el.spect.style.display = 'none';
  }

  showResults(r, game) {
    const el = this.el.results;
    const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const row = (x, who) => '<div class="stats">' + (who ? '<div class="who">' + who + '</div>' : '') +
      '<div><b>#' + x.placement + '</b><span>place</span></div><div><b>' + x.kills + '</b><span>kills</span></div>' +
      '<div><b>' + x.damage + '</b><span>damage dealt</span></div><div><b>' + fmt(x.survival) + '</b><span>survived</span></div></div>';
    const title = r.title || (r.won ? 'LAST ONE STANDING' : '#' + r.placement + ' OF ' + r.players);
    el.innerHTML = '<div class="panel">' +
      '<h1 class="' + (r.won || r.title ? 'win' : '') + '">' + title + '</h1>' +
      '<p class="sub">' + (r.versus ? 'Split-screen duel' : r.won ? 'You won the match' : 'Eliminated') + '</p>' +
      (r.versus ? row(r, 'P1') + row(r.versus, 'P2') : row(r)) +
      '<div class="row"><button id="btnAgain">PLAY AGAIN</button><button id="btnMenu" class="alt">MAIN MENU</button></div></div>';
    el.style.display = 'flex';
    el.querySelector('#btnAgain').onclick = () => this.onPlayAgain && this.onPlayAgain();
    el.querySelector('#btnMenu').onclick = () => this.onMenu && this.onMenu();
  }

  hideResults() { this.el.results.style.display = 'none'; this.el.results.innerHTML = ''; }
}

/** The storm wall: a translucent purple cylinder around the safe circle. */
class StormVisual {
  constructor(scene) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
    g.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xa040ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(game) {
    const s = game && game.match && game.match.storm;
    this.mesh.visible = !!s;
    if (!s) return;
    this.mesh.position.set(s.cur.x, 0, s.cur.z);
    this.mesh.scale.set(Math.max(0.5, s.cur.r), 90, Math.max(0.5, s.cur.r));
  }
}
