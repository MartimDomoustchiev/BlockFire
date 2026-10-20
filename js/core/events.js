/* ============================================================
 * Tiny synchronous event bus.
 * The simulation announces side effects (blockBroken, pickup, ...)
 * here; presentation layers (HUD, audio, particles) subscribe.
 * Listeners must never change sim state in response.
 * ============================================================ */
class EventBus {
  constructor() { this.map = new Map(); }

  /** Subscribes; returns an unsubscribe function. */
  on(name, fn) {
    let list = this.map.get(name);
    if (!list) { list = []; this.map.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const list = this.map.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(name, payload) {
    const list = this.map.get(name);
    if (!list) return;
    for (const fn of list.slice()) {
      try { fn(payload); } catch (e) { console.error('event listener for "' + name + '" failed', e); }
    }
  }

  clear() { this.map.clear(); }
}
