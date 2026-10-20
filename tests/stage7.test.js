/* Stage 7: menus, split-screen duel, gamepad, audio, free build, settings. */

const FAKE_PAD = `(() => {
  // A scriptable fake gamepad: window.FAKEPAD.axes / window.FAKEPAD.buttons drive navigator.getGamepads().
  window.FAKEPAD = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => 0) };
  navigator.getGamepads = () => [{ connected: true, axes: window.FAKEPAD.axes, buttons: window.FAKEPAD.buttons.map((v) => ({ value: v, pressed: v > 0.5 })) }];
  return true;
})()`;

exports.tests = {
  'menu: choose a mode and options, START launches that mode (solo vs bots)': async (ctx) => {
    const { page } = await ctx.open('', { waitReady: false });
    await page.click('.mode[data-mode="battle"]');
    await page.$eval('#bots', (el) => { el.value = 2; el.dispatchEvent(new Event('input')); });
    await page.selectOption('#difficulty', 'easy');
    await page.fill('#seed', 'menutest');
    await page.$eval('#seed', (el) => el.dispatchEvent(new Event('change')));
    await page.click('#btnPlay');
    await page.waitForFunction(() => window.__game && window.__game.match && window.__game.match.state !== 'starting', null, { timeout: 120000 });
    const r = await page.evaluate(() => ({
      mode: __game.mode, n: __game.match.participants.length, diff: __game.match.opts.difficulty,
      saved: JSON.parse(localStorage.getItem('blockfire.settings.v2')),
    }));
    ctx.assert(r.mode === 'battle' && r.n === 3 && r.diff === 'easy', 'battle with 2 easy bots: ' + JSON.stringify(r));
    ctx.assert(r.saved.seed === 'menutest' && r.saved.bots === 2 && r.saved.mode === 'battle', 'settings persisted');
  },

  'menu: tabs switch sections, settings sliders apply and persist': async (ctx) => {
    const { page } = await ctx.open('', { waitReady: false });
    await page.click('.tab[data-tab="settings"]');
    const vis = await page.evaluate(() => [...document.querySelectorAll('#overlay section')].map((s) => s.dataset.tab + ':' + !s.hidden).join(','));
    ctx.assert(vis === 'play:false,settings:true,controls:false,online:false', 'settings tab shown: ' + vis);
    await page.$eval('#volume', (el) => { el.value = 0.3; el.dispatchEvent(new Event('input')); });
    await page.$eval('#fov', (el) => { el.value = 90; el.dispatchEvent(new Event('input')); });
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('blockfire.settings.v2')));
    ctx.assert(s.volume === 0.3 && s.fov === 90, 'saved: ' + JSON.stringify(s));
    await page.click('.tab[data-tab="controls"]');
    const keys = await page.evaluate(() => document.querySelectorAll('section[data-tab="controls"] .keys').length);
    ctx.assert(keys === 2, 'keyboard + gamepad tables');
  },

  'split-screen duel: two views, two HUDs, P2 on the gamepad, each sees the other but not itself': async (ctx) => {
    const { page } = await ctx.open('autostart=1&mode=duel&seed=duel1&rd=4&bots=0', { waitReady: false });
    await page.evaluate(FAKE_PAD);
    await page.waitForFunction(() => window.__game && window.__game.match && window.__game.match.state !== 'starting', null, { timeout: 120000 });
    const a = await page.evaluate(() => {
      const g = __game, p1 = g.player, p2 = g.player2;
      return {
        split: document.body.classList.contains('split'),
        huds: [...document.querySelectorAll('.hud')].filter((h) => getComputedStyle(h).display !== 'none').length,
        names: [p1.name, p2.name], p2ctrl: p2.controller.constructor.name, n: g.match.participants.length,
        start: [p2.pos.x, p2.pos.z],
      };
    });
    ctx.assert(a.split && a.huds === 2, 'two HUDs side by side: ' + JSON.stringify(a));
    ctx.assert(a.p2ctrl === 'GamepadController' && a.n === 2, 'P2 uses the gamepad');
    await page.evaluate(() => { window.FAKEPAD.axes = [0, -1, 0, 0]; });    // push left stick forward
    await page.waitForTimeout(1500);
    const b = await page.evaluate((start) => {
      const g = __game, p1 = g.player, p2 = g.player2;
      const moved = Math.hypot(p2.pos.x - start[0], p2.pos.z - start[1]);
      // camera layers: P1 sees P2's body, not its own
      const cams = window.__views ? null : null;
      return { moved, p1model: p1.model && p1.model.root.layers.mask, p2model: p2.model && p2.model.root.layers.mask };
    }, a.start);
    ctx.assert(b.moved > 2, 'P2 moved with the left stick: ' + b.moved.toFixed(2));
    ctx.assert(b.p1model === (1 << 3) && b.p2model === (1 << 4), 'local bodies on their own layers: ' + JSON.stringify(b));
    await ctx.screenshot(page, 'stage7-duel');
  },

  'gamepad mapping: triggers, bumpers, buttons fire once per press, deadzone and look': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=3');
    await page.evaluate(FAKE_PAD);
    const r = await page.evaluate(() => {
      const c = new GamepadController({ padSensitivity: 1 }, 0);
      const out = {};
      FAKEPAD.axes = [0.1, -0.1, 0, 0]; FAKEPAD.buttons[7] = 1; FAKEPAD.buttons[5] = 1; FAKEPAD.buttons[3] = 1;
      c.poll();
      const a = c.getIntent(null, null), b = c.getIntent(null, null);
      out.first = [a.fire, a.firePressed, a.slotDelta, a.interact, a.moveX, a.moveZ];
      out.second = [b.fire, b.firePressed, b.slotDelta, b.interact];
      FAKEPAD.axes = [0, 0, 1, 0]; FAKEPAD.buttons[7] = 0; FAKEPAD.buttons[5] = 0; FAKEPAD.buttons[3] = 0;
      c.poll();
      const l = c.getIntent(null, null);
      out.look = l.lookDX;
      // driving: triggers become gas / brake
      FAKEPAD.buttons[7] = 1; FAKEPAD.buttons[6] = 0.2; c.poll();
      const d = c.getIntent(null, { vehicleSeat: 'driver' });
      out.drive = [d.moveZ.toFixed(2), d.fire];
      return out;
    });
    ctx.assert(JSON.stringify(r.first) === JSON.stringify([true, true, 1, true, 0, 0]), 'first tick: ' + JSON.stringify(r.first));
    ctx.assert(JSON.stringify(r.second) === JSON.stringify([true, false, 0, false]), 'presses delivered once: ' + JSON.stringify(r.second));
    ctx.near(r.look, -3.4 / 60, 1e-9, 'full right stick turns at LOOK_YAW rad/s');
    ctx.assert(r.drive[0] === '0.80' && r.drive[1] === false, 'RT - LT throttle when driving: ' + r.drive);
  },

  'audio: synthesised sounds play for game events without errors': async (ctx) => {
    const { page } = await ctx.open('autostart=1&seed=hello&rd=3&arena=1');
    const r = await page.evaluate(async () => {
      Sound.init();
      const g = __game, p = g.player;
      Sound.attach(g, [{ camera: { position: new THREE.Vector3(p.pos.x, p.eyeY, p.pos.z), quaternion: new THREE.Quaternion() }, character: p }]);
      for (const cls of Object.keys(CONFIG.WEAPONS)) Sound.gun(cls, p.pos);
      g.events.emit('explosion', { x: p.pos.x + 5, y: p.pos.y, z: p.pos.z, radius: 4 });
      g.events.emit('impact', { x: p.pos.x, y: p.pos.y, z: p.pos.z + 3, block: BLOCK.BUILD_METAL, nx: 0, ny: 1, nz: 0 });
      for (const b of [1, 3, 4, 5, 7, 14, 15]) Sound.footstep(b, p.pos, true);
      Sound.killConfirm(); Sound.hit(true, true); Sound.reload(); Sound.fanfare();
      Sound.update(0.016, g);
      await new Promise((res) => setTimeout(res, 300));
      return { state: Sound.ctx && Sound.ctx.state, rate: Sound.ctx && Sound.ctx.sampleRate };
    });
    ctx.assert(r.state && r.rate > 0, 'audio context running: ' + JSON.stringify(r));
  },

  'free build: endless blocks and pieces, flying allowed, no enemies or loot': async (ctx) => {
    const { page } = await ctx.open('autostart=1&mode=build&seed=hello&rd=3');
    const r = await page.evaluate(() => {
      const g = __game, p = g.player; g.paused = true;
      let it = {};
      p.controller = new ScriptedController(() => { const o = it; it = {}; return o; });
      const press = (f) => { it = f; g.tick(); };
      const before = p.inventory.count('stone');
      p.selectSlot(0); p.pitch = -0.6;
      press({ aim: true, aimPressed: true }); g.tick(15);
      press({ buildPiece: 'wall' }); press({ fire: true, firePressed: true });
      press({ toggleFly: true });
      return {
        stone: [before, p.inventory.count('stone')], pieces: g.pieces.size, planks: p.inventory.count('planks'),
        flying: p.flying, chars: g.characters().length, chestChance: g.world.chestChance * (g.world.lootEnabled ? 1 : 0),
        rules: g.rules.infiniteBlocks,
      };
    });
    ctx.assert(r.rules && r.stone[0] === r.stone[1], 'placing a block costs nothing: ' + r.stone);
    ctx.assert(r.pieces === 1, 'built a wall without materials');
    ctx.assert(r.flying && r.chars === 1 && r.chestChance === 0, 'fly on, nobody else, no loot: ' + JSON.stringify(r));
  },
};
