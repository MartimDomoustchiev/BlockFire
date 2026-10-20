/* ============================================================
 * Combat HUD (DOM): shield + health bars, ammo counter, dynamic
 * crosshair whose gap is the real spread cone projected to pixels,
 * hit markers (yellow = headshot, red = kill), floating damage
 * numbers (white health, blue shield, yellow headshot), kill feed,
 * sniper scope, consumable / reload progress, "E" prompts and the
 * death screen. Reads game state each frame and listens to events;
 * never changes the simulation.
 * ============================================================ */
class CombatHud {
  constructor(hudRoot) {
    const $ = (cls) => hudRoot.querySelector('.' + cls);
    this.el = {
      vitals: $('vitals'), shieldBar: $('shieldBar'), shieldNum: $('shieldNum'), healthBar: $('healthBar'), healthNum: $('healthNum'),
      ammo: $('ammo'), ammoName: $('ammoName'), ammoMag: $('ammoMag'), ammoReserve: $('ammoReserve'),
      cross: $('crosshair'), hit: $('hitmarker'), nums: $('dmgNumbers'), feed: $('killfeed'), scope: $('scope'),
      prog: $('progress'), progLabel: $('progressLabel'), progFill: $('progressFill'), prompt: $('prompt'),
      death: $('death'), deathBy: $('deathBy'), deathTimer: $('deathTimer'), hurt: $('hurt'),
      killfeedHost: $('killfeed'),
    };
    this.numbers = [];
    this.feed = [];
    this.hitT = 0;
    this.hitKind = '';
    this.hurtT = 0;
    this._v = new THREE.Vector3();
  }

  attach(game, ch) {
    if (this.unsub) this.unsub();
    this.game = game;
    this.ch = ch;
    this.el.nums.innerHTML = '';
    this.el.feed.innerHTML = '';
    this.numbers = [];
    this.feed = [];
    const offs = [
      game.events.on('damage', (e) => this.onDamage(e)),
      game.events.on('kill', (e) => this.onKill(e)),
    ];
    this.unsub = () => offs.forEach((f) => f());
  }

  showCrosshair(v) { this.el.cross.style.display = v ? '' : 'none'; }

  setVisible(v) {
    for (const k of ['vitals', 'ammo', 'feed', 'nums']) this.el[k].style.display = v ? '' : 'none';
    if (!v) { this.el.scope.style.display = 'none'; this.el.prompt.style.display = 'none'; this.el.prog.style.display = 'none'; this.el.death.style.display = 'none'; }
  }

  onDamage(e) {
    if (e.attacker === this.ch && e.target !== this.ch) {
      this.hitT = 0.16;
      this.hitKind = e.headshot ? 'head' : '';
      this.addNumber(e);
    }
    if (e.target === this.ch) this.hurtT = 0.5;
  }

  onKill(e) {
    if (e.killer === this.ch && e.victim !== this.ch) { this.hitT = 0.3; this.hitKind = 'kill'; }
    const weapon = e.kind === 'assassination' ? 'takedown' : e.cls && CONFIG.WEAPONS[e.cls] ? CONFIG.WEAPONS[e.cls].name
      : e.cls === 'blade' ? 'wrist blade' : e.cls === 'sword' ? 'sabre' : e.kind === 'explosion' ? 'explosion' : e.kind;
    const text = e.killer && e.killer !== e.victim
      ? `<b>${esc(e.killer.name)}</b> <i>[${esc(weapon)}${e.headshot ? ' ✶' : ''}]</i> <b>${esc(e.victim.name)}</b>`
      : e.kind === 'disconnect' ? `<b>${esc(e.victim.name)}</b> <i>left the game</i>`
      : `<b>${esc(e.victim.name)}</b> <i>[${esc(e.kind === 'storm' ? 'the storm' : e.kind === 'fall' ? 'a long fall' : 'self')}]</i>`;
    const div = document.createElement('div');
    div.innerHTML = text;
    if (e.killer === this.ch || e.victim === this.ch) div.className = 'mine';
    this.el.feed.prepend(div);
    this.feed.push({ div, t: 6 });
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
  }

  addNumber(e) {
    const div = document.createElement('div');
    div.className = 'num' + (e.headshot ? ' head' : e.shield > 0 && e.health <= 0 ? ' shield' : '');
    div.textContent = Math.round(e.amount);
    this.el.nums.appendChild(div);
    this.numbers.push({ div, x: e.x + (Math.random() - 0.5) * 0.4, y: e.y, z: e.z + (Math.random() - 0.5) * 0.4, t: 0 });
  }

  update(frameDt, camera, viewH) {
    const ch = this.ch, g = this.game;
    if (!ch || !g) return;
    const H = CONFIG.HEALTH;
    // vitals
    this.el.shieldBar.style.width = (100 * ch.shield / H.SHIELD_MAX) + '%';
    this.el.healthBar.style.width = (100 * ch.health / H.MAX) + '%';
    this.el.shieldNum.textContent = Math.ceil(ch.shield);
    this.el.healthNum.textContent = Math.ceil(ch.health);
    // the health bar glows while health is coming back (healing items, story-mode regeneration)
    if (ch.alive && this.lastHealth !== undefined && ch.health > this.lastHealth + 1e-3) this.healT = 0.5;
    this.lastHealth = ch.health;
    this.healT = Math.max(0, (this.healT || 0) - frameDt);
    this.el.healthBar.classList.toggle('healing', this.healT > 0);
    this.hurtT = Math.max(0, this.hurtT - frameDt);
    const low = ch.alive && ch.health < 35 ? 0.35 + 0.15 * Math.sin(performance.now() / 180) : 0;
    this.el.hurt.style.opacity = Math.max(low, this.hurtT);

    // ammo / weapon
    const held = ch.heldStack();
    const st = Weapons.of(held);
    if (st) {
      this.el.ammo.style.display = '';
      this.el.ammoName.textContent = CONFIG.RARITY[st.rarity].name + ' ' + st.name;
      this.el.ammoName.style.color = CONFIG.RARITY[st.rarity].color;
      this.el.ammoMag.textContent = held.data.mag;
      this.el.ammoMag.classList.toggle('empty', held.data.mag === 0);
      const res = Weapons.reserve(g, ch, st);
      this.el.ammoReserve.textContent = res === Infinity ? '∞' : res;
    } else this.el.ammo.style.display = 'none';

    // crosshair: gap = spread cone projected to screen pixels
    const fovHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const pxPerRad = (viewH / 2) / Math.tan(fovHalf);
    const scoped = st && st.scope && ch.adsT > 0.85;
    let gap = 4;
    if (st) gap = Math.max(3, Math.tan(Weapons.spread(ch, st) + (st.pellets > 1 ? st.pelletSpread : 0)) * pxPerRad);
    this.el.cross.style.setProperty('--gap', Math.min(140, gap).toFixed(1) + 'px');
    this.el.cross.classList.toggle('gun', !!st);
    this.el.cross.style.visibility = scoped || !ch.alive ? 'hidden' : '';
    this.el.scope.style.display = scoped ? 'block' : 'none';

    // hit marker
    this.hitT = Math.max(0, this.hitT - frameDt);
    this.el.hit.style.opacity = this.hitT > 0 ? 1 : 0;
    this.el.hit.classList.toggle('head', this.hitKind === 'head');
    this.el.hit.classList.toggle('kill', this.hitKind === 'kill');

    // damage numbers: rise and fade, projected each frame
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += frameDt;
      if (n.t > 0.9) { n.div.remove(); this.numbers.splice(i, 1); continue; }
      const p = this._v.set(n.x, n.y + n.t * 0.9, n.z).project(camera);
      if (p.z > 1) { n.div.style.display = 'none'; continue; }
      n.div.style.display = '';
      n.div.style.left = ((p.x + 1) / 2 * 100) + '%';
      n.div.style.top = ((1 - p.y) / 2 * 100) + '%';
      n.div.style.opacity = Math.min(1, (0.9 - n.t) * 4);
    }
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t -= frameDt;
      if (f.t <= 0) { f.div.remove(); this.feed.splice(i, 1); }
      else if (f.t < 1) f.div.style.opacity = f.t;
    }

    // progress: consumable use or reload
    let label = null, frac = 0;
    if (ch.using) { label = ITEMS[ch.using.id].name + '  ' + Math.max(0, ch.using.total - ch.using.t).toFixed(1) + 's'; frac = ch.using.t / ch.using.total; }
    else if (ch.reload) { label = 'Reloading'; frac = 1 - ch.reload.t / ch.reload.total; }
    this.el.prog.style.display = label ? '' : 'none';
    if (label) { this.el.progLabel.textContent = label; this.el.progFill.style.width = (100 * Math.min(1, frac)) + '%'; }

    // interaction prompt
    let prompt = null;
    if (ch.alive) {
      const t = ch.target;
      if (t && t.block === BLOCK.CHEST) prompt = 'Open chest';
      else if (t && t.block === BLOCK.CRAFTING_TABLE) prompt = 'Use crafting table';
      else if (t && t.block === BLOCK.FURNACE) prompt = 'Use furnace';
      else if (!ch.vehicle && Vehicles.nearest(g, ch, CONFIG.VEHICLE.ENTER_RANGE) && !Loot.nearestManualDrop(g, ch)) {
        const v = Vehicles.nearest(g, ch, CONFIG.VEHICLE.ENTER_RANGE);
        prompt = 'Enter ' + esc(v.spec.name) + (v.seats[0] === null ? ' (drive)' : ' (ride)') + '  -  fuel ' + Math.round(100 * v.fuel / v.spec.fuel) + '%';
      } else if (!ch.vehicle) {
        const d = Loot.nearestManualDrop(g, ch);
        if (d) {
          const atCap = ch.inventory.spaceFor(d.stack) === 0;
          const swap = atCap && ch.heldKind() === 'weapon';
          prompt = (swap ? 'Swap for ' : atCap ? 'Weapons full - hold a weapon to swap for ' : 'Pick up ') +
            '<span style="color:' + CONFIG.RARITY[d.stack.data.rarity].color + '">' + esc(stackLabel(d.stack)) + '</span>';
        }
      }
    }
    this.el.prompt.style.display = prompt ? '' : 'none';
    if (prompt) this.el.prompt.innerHTML = '<kbd>E</kbd> ' + prompt;

    // death screen
    if (!ch.alive) {
      this.el.death.style.display = 'flex';
      const by = ch.lastDamagedBy && ch.lastDamagedBy !== ch ? 'by ' + ch.lastDamagedBy.name : '';
      this.el.deathBy.textContent = by;
      this.el.deathTimer.textContent = ch.respawnAt !== null ? 'Respawning in ' + Math.max(0, ch.respawnAt - g.time).toFixed(1) + 's' : '';
    } else this.el.death.style.display = 'none';
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
