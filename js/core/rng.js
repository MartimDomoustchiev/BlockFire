/* ============================================================
 * Seeded random numbers for simulation code.
 * Sim code must never call Math.random(): replays, bots and future
 * netcode depend on every client rolling the same numbers.
 * ============================================================ */
class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 0x9E3779B9; }

  /** Uniform float in [0, 1). (mulberry32) */
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  /** Integer in [a, b] inclusive. */
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
}

/** Hashes a string seed (or numeric string) to a 32-bit int. */
function hashSeed(str) {
  str = String(str);
  if (/^-?\d+$/.test(str)) return parseInt(str, 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}
