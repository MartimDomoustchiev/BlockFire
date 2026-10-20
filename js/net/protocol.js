/* ============================================================
 * Online play: wire format shared by NetHost and NetClient.
 *
 * Model: the host's browser runs the real Game. Clients run a
 * "replica" Game: the world is generated locally from the shared seed
 * (only block *edits* travel), their own player moves locally and
 * reports its position (so movement feels instant), and everything
 * else - other players, bots, vehicles, drops, projectiles, damage,
 * inventories, the storm - comes from host snapshots.
 *
 * Messages (JSON, field k = kind):
 *   client -> host   hello {name, v}           in {it:[intents], s:state, lag}
 *                    ui {op...}  (screens)     ping {t}
 *   host -> client   welcome {...}             snap {t, e, x, ed, pc, pcx, ev, me, m, tod}
 *                    results {r}  restart {}   pong {t}   deny {reason} (full / wrong version)
 * Entity records in snapshots are only sent when they changed
 * (per-client delta) and only near the receiving player.
 * ============================================================ */
const NET = {
  VERSION: 5,                  // bump whenever the wire format or world generation changes (2: story mode, 3: story fixes, 4: arms crates, 5: bow, sword, hideout chest)
  SNAP_HZ: 20,
  INPUT_HZ: 30,
  INTERP: 0.1,                 // seconds clients render others behind the newest snapshot
  MAX_LAG: 0.35,               // cap for lag compensation (s)
  HOLD_TICKS: 20,              // host keeps a remote player's held buttons this long without new input
  VIEW_RANGE: 170,             // entities farther than this from a client aren't sent
  DATA_RADIUS: 4,              // host loads terrain (no meshes) this many chunks around remote players
  CONNECT_TIMEOUT: 20,         // s before a join that never connects gives up
  PING_EVERY: 1,               // s between client keep-alive pings (sent even from background tabs)
  TIMEOUT: 12,                 // s of silence before either side treats the other as gone
  MAX_PLAYERS: 8,
  // events the host forwards to clients (for effects, sound, HUD and kill feed)
  EVENTS: ['shot', 'impact', 'explosion', 'damage', 'kill', 'blockBroken', 'blockPlaced', 'piecePlaced', 'pieceDestroyed',
    'reloadStart', 'reloaded', 'pickup', 'chestOpened', 'dryFire', 'used', 'useStart', 'crafted', 'landed', 'vehicleLanded',
    'blockSmashed', 'stormShrink', 'matchStart', 'matchEnd', 'respawn', 'toolBroke', 'vehicleEnter', 'vehicleExit',
    // story mode
    'strike', 'assassination', 'bark', 'storyLine', 'storyTitle', 'desync', 'storyMessage', 'storyScreen', 'storyAction',
    'synced', 'leap', 'hayLanding', 'alarm', 'notoriety', 'silver', 'cageOpened', 'travel', 'guardAlert', 'resupplied',
    'parry', 'blocked', 'swordKill', 'bowDraw'],
};

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];

const NetProto = {
  stack(s) { return s ? (s.data ? [s.id, s.count, s.data] : [s.id, s.count]) : 0; },
  unstack(a) { if (!a) return null; const s = { id: a[0], count: a[1] }; if (a[2]) s.data = Object.assign({}, a[2]); return s; },

  /** Snapshot record for an entity (or null if it isn't replicated). */
  record(e) {
    switch (e.type) {
      case 'character': {
        const h = e.heldStack();
        return {
          t: 'c', id: e.id, n: e.name, tm: e.team, p: v3(e.pos), v: v3(e.vel), y: r3(e.yaw), pi: r3(e.pitch),
          a: e.alive ? 1 : 0, hp: Math.ceil(e.health), sh: Math.ceil(e.shield), h: h ? NetProto.stack(h) : 0,
          g: e.gliding ? 1 : 0, gr: e.onGround ? 1 : 0, w: e.inWater ? 1 : 0, vs: e.vehicle ? e.vehicle.id : 0,
          si: e.seatIndex, m: e.mining ? r2(e.mining.progress) : 0, bot: e.isBot ? 1 : 0,
          // story mode: model style and pose
          lk: e.look || 0, cr: e.sneaking ? 1 : 0, cl: e.climbing ? 1 : 0, lp: e.leap ? 1 : 0, cp: e.corpse ? 1 : 0,
          nr: e.npcRole || 0, hu: e.isHuman ? 1 : 0, su: e.suspicion ? r2(e.suspicion) : 0,
        };
      }
      case 'vehicle':
        return { t: 'v', id: e.id, k: e.kind, p: v3(e.pos), v: v3(e.vel), y: r3(e.yaw), hp: Math.ceil(e.hp), fu: Math.round(e.fuel), s: e.seats.slice(), gr: e.onGround ? 1 : 0, wa: e.onWater ? 1 : 0, vy: r2(e.vy), a: e.alive ? 1 : 0 };
      case 'drop':
        return { t: 'd', id: e.id, s: NetProto.stack(e.stack), p: v3(e.pos) };
      case 'projectile':
        return { t: 'p', id: e.id, c: e.st.cls, r: e.st.rarity, p: v3(e.pos), v: v3(e.vel), o: e.owner ? e.owner.id : 0 };
      case 'barrel':
        return { t: 'b', id: e.id, p: v3(e.pos), a: e.alive ? 1 : 0 };
      case 'poster':
        return { t: 'w', id: e.id, p: v3(e.pos), n: [e.nx, e.nz] };
      case 'smoke':
        return { t: 's', id: e.id, p: v3(e.pos), r: e.radius };
    }
    return null;
  },

  piece(p) {
    return { id: p.id, type: p.type, material: p.material, hp: Math.ceil(p.hp), maxHp: p.maxHp, building: p.building ? 1 : 0, slot: p.slot, cells: p.cells.map((c) => c.slice(0, 5)), removedTiles: p.removedTiles };
  },

  /** Event payload -> plain JSON (entities become {$e:id}, vectors {$v:[...]}, pieces a light copy). */
  packEvent(name, payload) {
    const pack = (v) => {
      if (v === null || v === undefined) return v;
      if (typeof v !== 'object') return v;
      if (v.isVector3) return { $v: v3(v) };
      if (Array.isArray(v)) return v.map(pack);
      if (v instanceof Entity) return { $e: v.id };
      if (v.cells && v.material) return { $pc: { id: v.id, type: v.type, material: v.material, cells: v.cells.slice(0, 1) } };
      const o = {};
      for (const k of Object.keys(v)) o[k] = pack(v[k]);
      return o;
    };
    return [name, pack(payload)];
  },

  unpackEvent(packed, game) {
    const un = (v) => {
      if (v === null || v === undefined || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(un);
      if (v.$v) return new THREE.Vector3(v.$v[0], v.$v[1], v.$v[2]);
      if (v.$e !== undefined) return game.entities.get(v.$e) || null;
      if (v.$pc) return v.$pc;
      const o = {};
      for (const k of Object.keys(v)) o[k] = un(v[k]);
      return o;
    };
    return [packed[0], un(packed[1])];
  },

  /** Intent -> only the fields that differ from neutral (small on the wire). */
  packIntent(it) {
    const o = {};
    for (const k of Object.keys(NEUTRAL_INTENT)) {
      const v = it[k];
      if (v !== NEUTRAL_INTENT[k]) o[k] = typeof v === 'number' ? r3(v) : v;
    }
    return o;
  },

  /** A client's own player state, reported with its inputs. */
  packState(ch, tpAck) {
    return { p: v3(ch.pos), v: v3(ch.vel), y: r3(ch.yaw), pi: r3(ch.pitch), gr: ch.onGround ? 1 : 0, f: ch.flying ? 1 : 0, g: ch.gliding ? 1 : 0, cl: ch.climbing ? 1 : 0, lp: ch.leap ? 1 : 0, tpa: tpAck };
  },
};

/** Host-side controller for a remote player: replays the inputs it sent, one per tick. */
class RemoteController {
  constructor() { this.queue = []; this.state = null; this.last = makeIntent(); this.starved = 0; }

  push(intents, state) {
    for (const i of intents) this.queue.push(i);
    if (state) this.state = state;
    // fell far behind (lag spike): squash the backlog but keep every press
    while (this.queue.length > 8) {
      const a = this.queue.shift(), b = this.queue[0];
      for (const k of Object.keys(a)) if (a[k] === true && !(k in b)) b[k] = true;
    }
  }

  getIntent(game, ch) {
    const s = this.state;
    // the player moves itself: take its reported position unless we teleported it and it hasn't caught up
    if (s && s.tpa === ch.netTpSeq && ch.alive && !ch.vehicle && Number.isFinite(s.p[0])) {
      ch.pos.set(s.p[0], s.p[1], s.p[2]);
      ch.vel.set(s.v[0], s.v[1], s.v[2]);
      ch.onGround = !!s.gr;
      ch.gliding = !!s.g && ch.gliding;          // the client may end a glide, never start one
      ch.flying = !!s.f && game.rules.allowFly;
      ch.climbing = !!s.cl && !!game.rules.climb;
      ch.leap = s.lp ? (ch.leap || true) : null;
    }
    if (s) { ch.yaw = s.y; ch.pitch = s.pi; }
    let it = this.queue.shift();
    if (!it) {
      // no fresh input this tick: keep holding what was held, but never repeat a press -
      // and let go entirely once inputs stop (their tab went to the background, or the link stalled)
      it = {};
      if (++this.starved <= NET.HOLD_TICKS) {
        for (const k of ['moveX', 'moveZ', 'jump', 'sprint', 'crouch', 'fire', 'aim', 'rampRush']) if (this.last[k] !== undefined) it[k] = this.last[k];
      }
    } else { this.last = it; this.starved = 0; }
    return Object.assign(makeIntent(), it);
  }
}

/** Client-side wrapper: passes the keyboard/mouse intent through and records it for the host. */
class RecordingController {
  constructor(inner, record) { this.inner = inner; this.record = record; }
  get enabled() { return this.inner.enabled; }
  set enabled(v) { this.inner.enabled = v; }
  get lookScale() { return this.inner.lookScale; }
  set lookScale(v) { this.inner.lookScale = v; }
  flush() { this.inner.flush(); }
  poll() { this.inner.poll(); }
  getIntent(game, ch) {
    const it = this.inner.getIntent(game, ch);
    this.record(it);
    return it;
  }
}
