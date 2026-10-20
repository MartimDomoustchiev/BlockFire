/* ============================================================
 * Network transports. A transport moves JSON messages between the
 * host and its clients; the game code never touches WebRTC.
 *
 *  PeerTransport   real online play: WebRTC data channels via PeerJS
 *                  (vendor/peerjs.min.js). The host registers the
 *                  peer id "blockfire-<ROOMCODE>" on the free PeerJS
 *                  signalling server; clients connect to it. Traffic
 *                  then flows peer-to-peer (or through PeerJS's TURN
 *                  relays when routers don't allow a direct link).
 *  BridgeTransport  tests: two browser pages connected through hooks
 *                  the test harness installs (no internet needed).
 *
 * Interface (both sides):
 *   onOpen(fn)            ready (host: room registered; client: connected)
 *   onPeer(fn(peerId))    host: a client connected
 *   onMessage(fn(peerId, msg))
 *   onClose(fn(peerId))   a connection dropped (client: peerId = 'host')
 *   onError(fn(text))
 *   send(peerId, msg)     host -> one client ('host' from a client)
 *   disconnect(peerId)    host: hang up on one client
 *   close()
 * ============================================================ */
const NET_ID_PREFIX = 'blockfire-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I

function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}

function normalizeRoomCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

class TransportBase {
  constructor() { this.h = { open: [], peer: [], message: [], close: [], error: [] }; }
  onOpen(f) { this.h.open.push(f); }
  onPeer(f) { this.h.peer.push(f); }
  onMessage(f) { this.h.message.push(f); }
  onClose(f) { this.h.close.push(f); }
  onError(f) { this.h.error.push(f); }
  _emit(name, ...args) { for (const f of this.h[name]) { try { f(...args); } catch (e) { console.error('net handler', name, e); } } }
  disconnect(peerId) { /* host: hang up on one client */ }
}

class PeerTransport extends TransportBase {
  /** role: 'host' | 'client'. code: room code. */
  constructor(role, code) {
    super();
    this.role = role;
    this.code = normalizeRoomCode(code);
    this.conns = new Map();
    if (typeof Peer === 'undefined') { setTimeout(() => this._emit('error', 'Networking library missing (vendor/peerjs.min.js).'), 0); return; }
    if (role === 'host') this._host(); else this._client();
  }

  _host() {
    this.peer = new Peer(NET_ID_PREFIX + this.code, { debug: 0 });
    this.peer.on('open', () => this._emit('open'));
    this.peer.on('connection', (conn) => this._wire(conn));
    this.peer.on('error', (e) => this._emit('error', e.type === 'unavailable-id' ? 'room-taken' : this._explain(e)));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) { /* closing */ } });
  }

  _client() {
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => {
      const conn = this.peer.connect(NET_ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
      this._wire(conn, 'host');
      conn.on('open', () => { clearTimeout(this.timer); this._emit('open'); });
    });
    // the room exists but the direct link never comes up: a network is blocking peer-to-peer traffic
    this.timer = setTimeout(() => {
      if (this.conns.has('host')) return;
      this._emit('error', !this.peer.open ? 'Could not reach the matchmaking server - are you online?'
        : 'Could not connect to the host. A strict network (school or work Wi-Fi, a firewall) may be blocking online games - try another network, such as a phone hotspot.');
    }, NET.CONNECT_TIMEOUT * 1000);
    this.peer.on('error', (e) => this._emit('error', e.type === 'peer-unavailable' ? 'No game found with room code ' + this.code + '.' : this._explain(e)));
  }

  _explain(e) {
    if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') return 'Could not reach the matchmaking server - are you online?';
    if (e.type === 'browser-incompatible') return 'This browser does not support WebRTC.';
    return 'Network error: ' + (e.type || e.message || e);
  }

  _wire(conn, forcedId) {
    const id = forcedId || conn.peer;
    conn.on('open', () => { this.conns.set(id, conn); if (this.role === 'host') this._emit('peer', id); });
    conn.on('data', (m) => this._emit('message', id, m));
    conn.on('close', () => { this.conns.delete(id); this._emit('close', id); });
    conn.on('error', () => { this.conns.delete(id); this._emit('close', id); });
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) { try { c.send(msg); } catch (e) { /* dropped */ } }
  }

  disconnect(id) {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (c) { try { c.close(); } catch (e) { /* */ } }
  }

  close() {
    clearTimeout(this.timer);
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* */ } }
    this.conns.clear();
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* */ } }
  }
}

/*
 * Test transport: the Playwright harness exposes window.__netOut(json) on
 * each page and calls window.__netIn(json) to deliver. Messages are
 * JSON-encoded exactly like the real thing.
 */
class BridgeTransport extends TransportBase {
  constructor(role, code) {
    super();
    this.role = role;
    this.code = code;
    this.peers = new Set();
    window.__netIn = (json) => {
      const m = JSON.parse(json);
      if (m.k === 'hello-bridge' && role === 'host') { this.peers.add(m.from); this._emit('peer', m.from); return; }
      if (m.k === 'bye') { this.peers.delete(m.from); this._emit('close', role === 'host' ? m.from : 'host'); return; }
      this._emit('message', role === 'host' ? m.from : 'host', m.d);
    };
    setTimeout(() => {
      if (role === 'client') window.__netOut(JSON.stringify({ k: 'hello-bridge', from: this.id(), to: 'host' }));
      this._emit('open');
    }, 0);
  }
  id() { return window.__netId || 'client'; }
  send(id, msg) { window.__netOut(JSON.stringify({ k: 'msg', from: this.role === 'host' ? 'host' : this.id(), to: id, d: msg })); }
  close() {
    const host = this.role === 'host';
    try { window.__netOut(JSON.stringify({ k: 'bye', from: host ? 'host' : this.id(), to: host ? '*' : 'host' })); } catch (e) { /* */ }
  }
}

function createTransport(role, code) {
  const p = new URLSearchParams(location.search);
  if (p.get('net') === 'bridge') return new BridgeTransport(role, code);
  return new PeerTransport(role, code);
}
