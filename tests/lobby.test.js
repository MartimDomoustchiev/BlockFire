/* The start screen (lobby): your character on the stage, a mode card to pick, START drops you into it. */

const LOBBY_TESTS = {
  'lobby: the start screen shows your character and mode cards; START begins the mode picked': async (ctx) => {
    const { page, errors } = await ctx.open('', { waitReady: false });
    await page.waitForFunction(() => !!window.__lobby && !!document.querySelector('#modeCards .mode'), null, { timeout: 60000 });
    const shown = await page.evaluate(() => ({
      overlay: !document.getElementById('overlay').classList.contains('hidden'),
      cards: document.querySelectorAll('#modeCards .mode').length,
      look: !!document.getElementById('lookGrid').querySelector('.swatch'),
      start: document.getElementById('btnPlay').textContent,
    }));
    ctx.assert(shown.overlay && shown.cards === 5 && shown.look, 'lobby with five mode cards and the look editor: ' + JSON.stringify(shown));
    await page.click('.mode[data-mode="sandbox"]');
    const label = await page.evaluate(() => document.getElementById('btnPlay').textContent);
    ctx.assert(label === 'EXPLORE', 'the START button names the mode: ' + label);
    // pick a skin swatch: the stage's character takes it (the look is kept in the settings)
    await page.click('#lookGrid .swatch >> nth=3');
    const look = await page.evaluate(() => JSON.parse(localStorage.getItem('blockfire.settings.v2')).look);
    ctx.assert(look && look.skin === 3, 'the chosen look is saved: ' + JSON.stringify(look));
    await page.click('#btnPlay');
    await page.waitForFunction(() => window.__game && window.__game.mode === 'sandbox' && window.__game.world.stats().meshed >= 5, null, { timeout: 120000 });
    const playing = await page.evaluate(() => ({ mode: __game.mode, look: __game.player.lookSpec && __game.player.lookSpec.skin, overlay: document.getElementById('overlay').classList.contains('hidden') }));
    ctx.assert(playing.mode === 'sandbox' && playing.look === 3 && playing.overlay, 'START drops you into the mode with your look: ' + JSON.stringify(playing));
    ctx.assert(errors.length === 0 || errors.every((e) => /GPU|GL Driver/.test(e)), 'no page errors');
  },
};

module.exports = { tests: LOBBY_TESTS };
