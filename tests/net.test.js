/* Online play: host + client in two pages joined by the test bridge transport (no internet needed). */

/** Opens a host page and a client page wired together; returns { host, client } pages once the client is in. */
async function pair(ctx, hostQuery, opts = {}) {
  const pages = {};
  const deliver = async (json) => {
    const m = JSON.parse(json);
    const target = m.to === 'host' ? pages.host : pages.client;
    if (target) await target.evaluate((j) => window.__netIn && window.__netIn(j), json).catch(() => {});
  };
  // pages register before they load: the client starts joining while its page is still loading
  const h = await ctx.open(hostQuery, { waitReady: false, beforeGoto: (p) => { pages.host = p; return p.exposeFunction('__netOut', deliver); } });
  await pages.host.waitForFunction(() => window.__game && window.__game.net, null, { timeout: 60000 });
  const c = await ctx.open('autostart=1&net=bridge&join=TEST&name=Bob&rd=4', {
    waitReady: false,
    beforeGoto: async (p) => { pages.client = p; await p.exposeFunction('__netOut', deliver); await p.addInitScript(() => { window.__netId = 'c1'; }); },
  });
  await pages.client.waitForFunction(() => window.__game && window.__game.net && window.__game.net.tpAck > 0 && window.__game.player.netPredicted,
    null, { timeout: opts.timeout || 120000 })
    .catch(async () => {
      const cs = await pages.client.evaluate(() => ({ status: document.getElementById('netStatus').textContent, game: !!window.__game, tp: window.__game && window.__game.net && window.__game.net.tpAck }));
      const hs = await pages.host.evaluate(() => ({ status: document.getElementById('netStatus').textContent, peers: Array.from(__game.net.peers.values()).map((p) => p.id + ':' + p.name + ':' + !!p.ch) }));
      throw new Error('client never joined: client ' + JSON.stringify(cs) + ' host ' + JSON.stringify(hs) + ' errors ' + JSON.stringify(c.errors.concat(h.errors).slice(0, 4)));
    });
  return pages;
}

const DRIVE = `(f) => {
  const g = window.__game, me = g.player;
  window.__drive = f;
  me.controller = new RecordingController(new ScriptedController(() => { const o = window.__drive || {}; window.__driveOnce = null; return Object.assign({}, o, window.__once || {}, (window.__once = null) || {}); }), (it) => g.net.queueIntent(it));
}`;

exports.tests = {
  'online co-op (free build): join, see each other, movement and block edits replicate both ways': async (ctx) => {
    const { host, client } = await pair(ctx, 'autostart=1&net=bridge&host=1&mode=build&seed=nettest&rd=4');
    const a = await host.evaluate(() => {
      const g = __game, remote = g.characters().find((c) => c.netRemote);
      return { chars: g.characters().length, remoteName: remote && remote.name, kit: remote && remote.inventory.count('stone') };
    });
    ctx.assert(a.chars === 2 && a.remoteName === 'Bob' && a.kit === 64, 'host sees Bob with a build kit: ' + JSON.stringify(a));
    await client.waitForFunction(() => __game.characters().some((c) => c.netProxy), null, { timeout: 10000 });
    // host builds a clean stone pad in the sky and teleports Bob onto it (tests host->client teleports too);
    // first make sure the host's terrain there has finished generating (edits to missing chunks are dropped)
    await host.waitForFunction(() => {
      const g = __game, p = g.player.pos, cx = Math.floor(p.x), cz = Math.floor(p.z);
      return [[-6, -6], [6, -6], [-6, 6], [6, 6]].every(([dx, dz]) => g.world.getBlock(cx + dx, 52, cz + dz) !== -1);
    }, null, { timeout: 20000 });
    await host.evaluate(() => {
      const g = __game, bob = g.characters().find((c) => c.netRemote), p = g.player.pos;
      const cx = Math.floor(p.x), cz = Math.floor(p.z), list = [];
      for (let x = cx - 6; x <= cx + 6; x++) for (let z = cz - 6; z <= cz + 6; z++) { list.push([x, 52, z, BLOCK.STONE]); for (let y = 53; y <= 57; y++) list.push([x, y, z, BLOCK.AIR]); }
      g.world.setBlocks(list);
      bob.teleport(cx + 0.5, 53.01, cz + 0.5);
      window.__pad = [cx, cz];
    });
    const pad = await host.evaluate(() => window.__pad);
    await client.waitForFunction((pd) => Math.abs(__game.player.pos.y - 53) < 0.1 && Math.abs(__game.player.pos.x - pd[0] - 0.5) < 0.1, pad, { timeout: 5000 });
    // client walks forward for 1.5 s
    const start = await client.evaluate(() => { __game.player.yaw = 0; return __game.player.pos.toArray(); });
    await client.evaluate(`(${DRIVE})({ moveZ: 1 })`);
    await client.waitForTimeout(1500);
    await client.evaluate(() => { window.__drive = {}; __game.player.yaw = 0; });
    await client.waitForTimeout(400);
    const moved = await Promise.all([
      client.evaluate(() => __game.player.pos.toArray()),
      host.evaluate(() => __game.characters().find((c) => c.netRemote).pos.toArray()),
    ]);
    const dist = Math.hypot(moved[0][0] - start[0], moved[0][2] - start[2]);
    const sync = Math.hypot(moved[0][0] - moved[1][0], moved[0][2] - moved[1][2]);
    ctx.assert(dist > 1.5, 'client walked: ' + dist.toFixed(2));
    ctx.assert(sync < 0.5, 'host has the same position: off by ' + sync.toFixed(2));
    // host places a block: it appears on the client
    const spot = await host.evaluate(() => { const p = __game.player.pos; const x = Math.floor(p.x) + 3, z = Math.floor(p.z), y = Math.floor(p.y) + 3; __game.world.setBlock(x, y, z, BLOCK.BRICK); return [x, y, z]; });
    await client.waitForFunction((s) => __game.world.getBlock(s[0], s[1], s[2]) === 8, spot, { timeout: 5000 })
      .catch(async () => { throw new Error('host edit never reached the client: ' + JSON.stringify(await client.evaluate((s) => [__game.world.getBlock(s[0], s[1], s[2]), __game.world.pendingEdits.size], spot))); });
    // client places a block through the host: aim at the pad 3 blocks east, right click
    const placed = await client.evaluate(async () => {
      const me = __game.player; me.selectSlot(0);
      const gx = Math.floor(me.pos.x) + 3, gy = 52, gz = Math.floor(me.pos.z);
      const ex = gx + 0.5 - me.pos.x, ey = gy + 1 - me.eyeY, ez = gz + 0.5 - me.pos.z;
      me.yaw = Math.atan2(-ex, -ez); me.pitch = Math.atan2(ey, Math.hypot(ex, ez));
      await new Promise((r) => setTimeout(r, 300));
      window.__once = { aim: true, aimPressed: true };
      await new Promise((r) => setTimeout(r, 300));
      return [gx, 53, gz];
    });
    ctx.assert(placed, 'client had a target');
    await host.waitForFunction((s) => __game.world.getBlock(s[0], s[1], s[2]) === BLOCK.STONE, placed, { timeout: 5000 })
      .catch(async () => { throw new Error('client placement not on host: ' + JSON.stringify(placed) + ' ' + JSON.stringify(await host.evaluate((s) => {
        const b = __game.characters().find((c) => c.netRemote);
        const o = b.eyePos(new THREE.Vector3()), d = b.lookDir(new THREE.Vector3());
        const hit = raycastBlocks(__game.world, o, d, 8);
        return { block: __game.world.getBlock(s[0], s[1], s[2]), below: __game.world.getBlock(s[0], s[1] - 1, s[2]), held: b.heldStack(), sel: b.selectedSlot, yaw: b.yaw, pitch: b.pitch, target: b.target, pos: b.pos.toArray(), hit: hit && [hit.x, hit.y, hit.z, hit.block, +hit.dist.toFixed(2)], placeCd: b.placeCooldown, q: b.controller.queue.length, st: b.controller.state };
      }, placed))); });
    await client.waitForFunction((s) => __game.world.getBlock(s[0], s[1], s[2]) === BLOCK.STONE, placed, { timeout: 5000 });
    await ctx.screenshot(client, 'net-client');
  },

  'online inventory: the client opens its inventory and crafts through the host': async (ctx) => {
    const { host, client } = await pair(ctx, 'autostart=1&net=bridge&host=1&mode=sandbox&seed=nettest2&rd=4');
    await host.evaluate(() => { const b = __game.characters().find((c) => c.netRemote); b.inventory.clear(); b.inventory.add(makeStack('log', 2)); });
    await client.waitForFunction(() => __game.player.inventory.count('log') === 2, null, { timeout: 5000 });
    await client.evaluate(() => __ui.open(__game.player, 'inventory'));
    await client.waitForFunction(() => __ui.isOpen && __ui.kind === 'inventory', null, { timeout: 5000 });
    const S = await client.$$('#screen .slot');      // 4 grid, output, 27 main, 9 hotbar
    await S[32].click();                                // pick up the logs (hotbar 0)
    await client.waitForFunction(() => __ui.cursor && __ui.cursor.id === 'log', null, { timeout: 5000 });
    await S[0].click({ button: 'right' });             // one log into the grid
    await client.waitForFunction(() => __ui.grid && __ui.grid[0] && __ui.grid[0].id === 'log', null, { timeout: 5000 });
    await S[5].click();                                 // drop the remaining log into the main inventory
    await client.waitForTimeout(300);
    await S[4].click({ modifiers: ['Shift'] });         // shift-craft planks into the inventory
    await client.waitForFunction(() => __game.player.inventory.count('planks') === 4, null, { timeout: 5000 });
    await client.keyboard.press('Tab');                 // close
    await host.waitForFunction(() => { const b = __game.characters().find((c) => c.netRemote); return b.inventory.count('planks') === 4 && b.inventory.count('log') === 1; }, null, { timeout: 5000 });
  },

  'online battle: lobby, the host starts, everyone drops in, damage and kills replicate': async (ctx) => {
    const { host, client } = await pair(ctx, 'autostart=1&net=bridge&host=1&mode=battle&bots=1&seed=netbattle&rd=4', { timeout: 150000 });
    await client.waitForFunction(() => __game.match && __game.match.lobby, null, { timeout: 30000 });
    await host.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' })));
    await host.waitForFunction(() => __game.match && __game.match.state === 'playing', null, { timeout: 10000 });
    await client.waitForFunction(() => __game.match && __game.match.state === 'playing' && __game.match.participants.length === 3 && __game.player.gliding, null, { timeout: 10000 });
    // host shoots the client: client sees its health drop and the damage event
    const r = await host.evaluate(() => {
      const g = __game, bob = g.characters().find((c) => c.netRemote);
      Combat.applyDamage(g, bob, 40, { attacker: g.player, cls: 'ar' });
      return bob.health;
    });
    await client.waitForFunction((hp) => __game.player.health === hp, r, { timeout: 5000 });
    const killed = await host.evaluate(() => { const g = __game, bob = g.characters().find((c) => c.netRemote); Combat.applyDamage(g, bob, 999, { attacker: g.player, cls: 'ar' }); return !bob.alive; });
    ctx.assert(killed, 'host killed the client');
    await client.waitForFunction(() => !__game.player.alive, null, { timeout: 5000 });
    // eliminated with no respawn: the client gets its results
    await client.waitForFunction(() => getComputedStyle(document.getElementById('results')).display !== 'none', null, { timeout: 10000 });
    const res = await client.evaluate(() => document.getElementById('results').innerText.replace(/\s+/g, ' '));
    ctx.assert(/#\d+ OF 3/.test(res) || /WINS/.test(res), 'results shown: ' + res);
    await ctx.screenshot(client, 'net-battle-client');
  },

  'online robustness: far-away friend, stale inputs, wrong version, host in a background tab, refused join': async (ctx) => {
    const { host, client } = await pair(ctx, 'autostart=1&net=bridge&host=1&mode=build&seed=netrobust&rd=4');
    // a friend far beyond the host's view distance: the host loads terrain there (data only, no meshes)
    const far = await host.evaluate(() => {
      const b = __game.characters().find((c) => c.netRemote), p = __game.player.pos;
      b.teleport(Math.floor(p.x) + 400.5, 62, Math.floor(p.z) + 0.5);
      return [Math.floor(p.x) + 400, Math.floor(p.z)];
    });
    await host.waitForFunction((f) => { const ch = __game.world.chunks.get(World.key(f[0] >> 4, f[1] >> 4)); return ch && ch.data; }, far, { timeout: 15000 });
    const farChunk = await host.evaluate((f) => {
      const ch = __game.world.chunks.get(World.key(f[0] >> 4, f[1] >> 4));
      return { block: __game.world.getBlock(f[0], 5, f[1]), meshed: !!ch.meshRequested };
    }, far);
    ctx.assert(farChunk.block > 0 && !farChunk.meshed, 'terrain around the far friend, unmeshed: ' + JSON.stringify(farChunk));

    // inputs stop arriving (their tab went to the background): held buttons are let go
    const held = await host.evaluate(() => {
      const rc = new RemoteController(), ch = { alive: true, netTpSeq: 0 }, out = [];
      rc.push([{ fire: true, moveZ: 1 }], null);
      for (let i = 0; i < 30; i++) out.push(rc.getIntent(__game, ch).fire);
      return [out[0], out[NET.HOLD_TICKS], out[NET.HOLD_TICKS + 1], out[29]];
    });
    ctx.assert(JSON.stringify(held) === '[true,true,false,false]', 'held fire released after a stall: ' + JSON.stringify(held));

    // a copy of the game with another protocol version is refused with a reason
    const old = await host.evaluate(() => {
      const t = __game.net.t, orig = t.send, sent = [];
      t.send = (id, m) => { if (id === 'zz') sent.push(m); else orig.call(t, id, m); };
      __game.net._onMessage('zz', { k: 'hello', name: 'Old', v: NET.VERSION - 1 });
      t.send = orig;
      __game.net.peers.delete('zz');
      return { sent, players: __game.net.playerCount() };
    });
    ctx.assert(old.sent.length === 1 && old.sent[0].k === 'deny' && /version/.test(old.sent[0].reason) && old.players === 2, 'old version denied: ' + JSON.stringify(old));

    // the host's tab goes to the background (no animation frames): the game keeps running for the client
    await client.evaluate(() => {
      const n = __game.net, orig = n._snap.bind(n);
      n._snap = (m) => { window.__lastSnapT = m.t; orig(m); };
    });
    await client.waitForFunction(() => window.__lastSnapT > 0, null, { timeout: 5000 })
      .catch(async () => { throw new Error('no snapshots: ' + JSON.stringify(await client.evaluate(() => ({ net: !!__game.net, tp: __game.net && __game.net.tpAck })))); });
    const t0 = await Promise.all([host.evaluate(() => __game.time), client.evaluate(() => window.__lastSnapT)]);
    await host.evaluate(() => { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { window.__heldFrame = f; return 0; }; });
    await host.waitForTimeout(2000);
    const t1 = await Promise.all([host.evaluate(() => __game.time), client.evaluate(() => window.__lastSnapT)]);
    await host.evaluate(() => { window.requestAnimationFrame = window.__raf; requestAnimationFrame(window.__heldFrame); });
    ctx.assert(t1[0] - t0[0] > 1.2 && t1[1] - t0[1] > 1.2, 'host simulated and sent snapshots without frames: host +' + (t1[0] - t0[0]).toFixed(2) + ' s, client saw +' + (t1[1] - t0[1]).toFixed(2) + ' s');

    // the host refuses the client: it returns to the menu with the reason, and the host drops its player
    await client.evaluate(() => __game.net._onMessage({ k: 'deny', reason: 'Testing a refusal.' }));
    await client.waitForFunction(() => document.getElementById('netStatus').textContent === 'Testing a refusal.' &&
      !document.getElementById('overlay').classList.contains('hidden'), null, { timeout: 5000 })
      .catch(async () => { throw new Error('client did not return to the menu: ' + JSON.stringify(await client.evaluate(() => [document.getElementById('netStatus').textContent, document.getElementById('overlay').className]))); });
    await host.waitForFunction(() => __game.net.playerCount() === 1 && !__game.characters().some((c) => c.netRemote && !c.removed), null, { timeout: 5000 })
      .catch(async () => { throw new Error('host kept the player: ' + JSON.stringify(await host.evaluate(() => [__game.net.playerCount(), __game.characters().map((c) => c.name + ':' + !!c.removed)]))); });
  },

  'online keep-alive: a friend whose browser goes silent is dropped, and the friend notices too': async (ctx) => {
    const { host, client } = await pair(ctx, 'autostart=1&net=bridge&host=1&mode=sandbox&seed=netsilent&rd=4');
    // pings keep an idle-but-alive connection open
    await host.evaluate(() => { NET.TIMEOUT = 2; });
    await client.evaluate(() => { NET.TIMEOUT = 2; });
    await host.waitForTimeout(3000);
    ctx.assert(await host.evaluate(() => __game.net.playerCount() === 2), 'live friend kept');
    // the friend's browser stops sending anything at all (crashed, laptop closed)
    await client.evaluate(() => { __game.net.t.send = () => {}; });
    await host.waitForFunction(() => __game.net.playerCount() === 1, null, { timeout: 6000 });
    const feed = await host.evaluate(() => document.querySelector('.hud[data-player="0"]').innerText);
    ctx.assert(/left the game/.test(feed), 'kill feed says they left');
    await client.waitForFunction(() => document.getElementById('netStatus').textContent === 'Lost the connection to the host.' && !window.__game, null, { timeout: 6000 });
  },
};
