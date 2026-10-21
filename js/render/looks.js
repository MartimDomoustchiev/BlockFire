/* ============================================================
 * Looks: the palettes a player picks from in the lobby, and the
 * small serialisable spec that travels with a character (to the
 * story, the arena, and to online friends). Presentation only:
 * hitboxes and gameplay never depend on it.
 *
 * A spec is { skin, style, hair, top, bottom, accent, facial, hood, cloak }
 * with palette indices (see normalizeLook) and two flags.
 * ============================================================ */
const SKIN_TONES = [0xf3cfae, 0xe0b48c, 0xc8956a, 0x9c6a44, 0x7a4e30, 0x4e3222];

/** Hair colours (the names are for the lobby swatches). */
const LOOK_HAIR = [
  { name: 'Black', color: 0x1f1a18 }, { name: 'Brown', color: 0x5a3a22 }, { name: 'Auburn', color: 0x8a3a1a },
  { name: 'Blonde', color: 0xd8b86a }, { name: 'Silver', color: 0xb9bcc4 }, { name: 'Copper', color: 0xc4642a },
  { name: 'Ice', color: 0xdfe8f2 }, { name: 'Violet', color: 0x7a3ad0 },
];
/** Hair styles, all built from the same head (see BodyGeometry in models.js). */
const LOOK_STYLES = ['short', 'long', 'bun', 'ponytail', 'curly', 'buzz', 'bald'];
/** Garment colours: tops, bottoms and accents (trim, hoods, cloaks). */
const LOOK_TOPS = [0x3c4a5c, 0xb5482a, 0x4f7a3a, 0x2f6aa8, 0xc8b07a, 0x6a2f6e, 0x8a8f98, 0x2a8c84, 0x8c2e24, 0xe3dccb];
const LOOK_BOTTOMS = [0x262c35, 0x4a4038, 0x2e3a4a, 0x3a3a3a, 0x5a4a3a, 0x1f2a1f];
const LOOK_ACCENTS = [0xc8a040, 0x2a1f18, 0x6a2f6e, 0x2a8c84, 0xd64a4a, 0xf0ece0, 0x3a7bd5, 0x7a8794, 0x8c2e24, 0x4caf50];
const LOOK_FACIAL = ['None', 'Stubble', 'Beard'];

/** The starting look for a new player: a practical traveller in charcoal and gold. */
const LOOK_DEFAULT = { skin: 1, style: 0, hair: 1, top: 0, bottom: 0, accent: 0, facial: 0, hood: false, cloak: false };

const PLAYER_LOOK = {
  DEFAULT: LOOK_DEFAULT,
  SKINS: SKIN_TONES, HAIR: LOOK_HAIR, STYLES: LOOK_STYLES, TOPS: LOOK_TOPS,
  BOTTOMS: LOOK_BOTTOMS, ACCENTS: LOOK_ACCENTS, FACIAL: LOOK_FACIAL,

  /** Any input (settings, a network message) becomes a valid spec: bad values fall back to the default. */
  normalize(s) {
    const o = Object.assign({}, LOOK_DEFAULT, s && typeof s === 'object' ? s : {});
    const idx = (v, n, d) => (Number.isInteger(v) && v >= 0 && v < n ? v : d);
    return {
      skin: idx(o.skin, SKIN_TONES.length, LOOK_DEFAULT.skin),
      style: idx(o.style, LOOK_STYLES.length, LOOK_DEFAULT.style),
      hair: idx(o.hair, LOOK_HAIR.length, LOOK_DEFAULT.hair),
      top: idx(o.top, LOOK_TOPS.length, LOOK_DEFAULT.top),
      bottom: idx(o.bottom, LOOK_BOTTOMS.length, LOOK_DEFAULT.bottom),
      accent: idx(o.accent, LOOK_ACCENTS.length, LOOK_DEFAULT.accent),
      facial: idx(o.facial, LOOK_FACIAL.length, LOOK_DEFAULT.facial),
      hood: !!o.hood, cloak: !!o.cloak,
    };
  },

  /** A random valid look (cosmetic only, so Math.random is fine here). */
  random() {
    const r = (n) => Math.floor(Math.random() * n);
    return this.normalize({
      skin: r(SKIN_TONES.length), style: r(LOOK_STYLES.length), hair: r(LOOK_HAIR.length), top: r(LOOK_TOPS.length),
      bottom: r(LOOK_BOTTOMS.length), accent: r(LOOK_ACCENTS.length), facial: Math.random() < 0.3 ? 1 + r(2) : 0,
      hood: Math.random() < 0.35, cloak: Math.random() < 0.35,
    });
  },

  /** A short description for the lobby card, e.g. "Charcoal coat, auburn curls". */
  describe(s) {
    const n = this.normalize(s);
    return LOOK_HAIR[n.hair].name.toLowerCase() + ' ' + LOOK_STYLES[n.style] + ' hair, ' + (n.hood ? 'hooded' : 'open collar') + (n.cloak ? ', cloak' : '');
  },
};
