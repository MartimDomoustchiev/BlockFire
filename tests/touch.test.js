/* Touch controls: a phone (emulated with touch input) plays: stick, look drags, FIRE held, story buttons. */

/** A finger on the screen, through the browser's own touch input (CDP), like a real touch. */
async function finger(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  return {
    down: (x, y, id = 1) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] }),
    move: (x, y, id = 1) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id }] }),
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  };
}

const TOUCH_TESTS = {
  'touch: on a phone the controls appear while playing; the stick walks, a look drag turns, FIRE is held': async (ctx) => {
    await ctx.open('', { waitReady: false });       // launches the browser for this run
    const browser = ctx.browser;
    const phoneCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await phoneCtx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const H = require('./harness');
    await page.goto(H.GAME_URL + '?autostart=1&mode=sandbox&seed=touch&rd=4');
    await page.waitForFunction(() => window.__game && window.__game.world.stats().meshed >= 20 && document.body.classList.contains('touch'), null, { timeout: 120000 });
    await page.waitForTimeout(400);
    const ui = await page.evaluate(() => ({ shown: !document.getElementById('touchUi').hidden, playing: document.body.classList.contains('playing'),
      pad: ['.tStick', '.tFire', '.tAim', '.tJump'].every((s) => !!document.querySelector('#touchUi ' + s)) }));
    ctx.assert(ui.shown && ui.playing && ui.pad, 'controls are shown while playing: ' + JSON.stringify(ui));
    const f = await finger(phoneCtx, page);
    const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    // walk forward on the stick
    const st = await rect('#touchUi .tStick'), p0 = await page.evaluate(() => [__game.player.pos.x, __game.player.pos.z]);
    await f.down(st.x, st.y);
    for (let i = 1; i <= 20; i++) await f.move(st.x, st.y - i * 4);
    await page.waitForTimeout(900);
    const walking = await page.evaluate(() => __game.player.intent.moveZ);
    await f.up();
    const p1 = await page.evaluate(() => [__game.player.pos.x, __game.player.pos.z]);
    const walked = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    ctx.assert(walking > 0.9 && walked > 3, 'the stick walks the player forward: moveZ ' + walking + ', walked ' + walked.toFixed(1));
    // a drag on the open screen turns the view
    const yaw0 = await page.evaluate(() => __game.player.yaw);
    await f.down(600, 200, 2);
    for (let i = 1; i <= 10; i++) await f.move(600 + i * 8, 200, 2);
    await f.up();
    await page.waitForTimeout(150);
    const yaw1 = await page.evaluate(() => __game.player.yaw);
    ctx.assert(Math.abs(yaw1 - yaw0) > 0.05, 'a look drag turns the view: ' + (yaw1 - yaw0).toFixed(3));
    // FIRE held: the intent says fire while the finger is down
    const fire = await rect('#touchUi .tFire');
    await f.down(fire.x, fire.y, 3);
    await page.waitForTimeout(120);
    const firing = await page.evaluate(() => __game.player.intent.fire);
    await f.up();
    ctx.assert(firing === true, 'holding FIRE fires');
    ctx.assert(errors.length === 0, 'no page errors: ' + JSON.stringify(errors.slice(0, 3)));
    await phoneCtx.close();
  },

  'touch: story has GEAR and MAP buttons; GEAR opens the Order\'s gear': async (ctx) => {
    const H = require('./harness');
    await ctx.open('', { waitReady: false });       // launches the browser for this run
    const phoneCtx = await ctx.browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await phoneCtx.newPage();
    await page.goto(H.GAME_URL + '?autostart=1&mode=story&rd=4');
    await page.waitForFunction(() => window.__game && window.__game.story && document.getElementById('loading').style.display === 'none', null, { timeout: 120000 });
    await page.evaluate(() => { __game.paused = false; });
    await page.waitForTimeout(500);
    const vis = await page.evaluate(() => ({ gear: !document.querySelector('#touchUi .tGear').hidden, map: !document.querySelector('#touchUi .tMap').hidden, inv: document.querySelector('#touchUi .tInv').hidden }));
    ctx.assert(vis.gear && vis.map && vis.inv, 'story shows GEAR and MAP (INV is for the arena): ' + JSON.stringify(vis));
    const g = await page.evaluate(() => { const r = document.querySelector('#touchUi .tGear').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const f = await finger(phoneCtx, page);
    await f.down(g.x, g.y, 4); await f.up();
    await page.waitForFunction(() => window.__screens && window.__screens.isOpen && window.__screens.kind === 'gear', null, { timeout: 5000 });
    await phoneCtx.close();
  },

  'touch: a desktop without a touch screen shows no touch controls': async (ctx) => {
    const { page } = await ctx.open('autostart=1&mode=sandbox&seed=touch&rd=4', { waitReady: true });
    const hidden = await page.evaluate(() => { const el = document.getElementById('touchUi'); return !el || el.hidden; });
    ctx.assert(hidden, 'no touch overlay on a desktop');
  },
};

module.exports = { tests: TOUCH_TESTS };
