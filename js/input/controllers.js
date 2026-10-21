/* ============================================================
 * Controllers turn "something" into Intents - the only thing the
 * simulation reads. Humans (keyboard+mouse now, gamepad in stage 7)
 * and bots (stage 6) all produce the same Intent shape, so the game
 * rules are identical for everyone (and network-ready: an Intent is
 * a small serialisable command per tick).
 * ============================================================ */

/** A neutral Intent. Field meanings: docs/ARCHITECTURE.md section 3. */
function makeIntent() {
  return {
    moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0,
    jump: false, sprint: false, crouch: false,
    fire: false, firePressed: false, aim: false, aimPressed: false,
    reload: false, interact: false, drop: false,
    slot: -1, slotDelta: 0,
    toggleInventory: false, toggleBuild: false, buildPiece: null, editMode: false,
    rampRush: false, boxUp: false,
    throttle: 0, steer: 0, handbrake: false, boost: false, switchSeat: false,
    toggleFly: false, skipTime: false,          // sandbox / debug only
  };
}

const NEUTRAL_INTENT = Object.freeze(makeIntent());

/** Replays a fixed intent (tests) or a function of (game, character) -> intent. */
class ScriptedController {
  constructor(source) { this.source = source; }
  getIntent(game, ch) {
    const it = typeof this.source === 'function' ? this.source(game, ch) : this.source;
    return Object.assign(makeIntent(), it);
  }
}

/*
 * Keyboard + mouse. poll() runs once per rendered frame and banks the
 * frame's edge events (key presses, clicks, wheel, mouse motion);
 * getIntent() runs once per sim tick and spends the bank. So a press
 * is delivered exactly once whether the frame runs 0, 1 or 5 ticks.
 */
class KeyboardMouseController {
  constructor(input, settings) {
    this.input = input;
    this.settings = settings;
    this.enabled = true;              // false while a UI screen owns the keyboard/mouse
    this.lookScale = 1;               // < 1 while zoomed in (aim-down-sights)
    this._keys = new Set();
    this._buttons = new Set();
    this._dx = 0; this._dy = 0; this._wheel = 0;
  }

  poll() {
    const f = this.input.takeFrame();
    if (!this.enabled) return;
    for (const k of f.pressedKeys) this._keys.add(k);
    for (const b of f.pressedButtons) this._buttons.add(b);
    this._dx += f.dx; this._dy += f.dy; this._wheel += f.wheel;
  }

  /** Drops anything banked (used when a UI screen opens/closes). */
  flush() { this._keys.clear(); this._buttons.clear(); this._dx = this._dy = this._wheel = 0; }

  getIntent(game, ch) {
    const it = makeIntent();
    if (!this.enabled) { this.flush(); return it; }
    const inp = this.input, held = (c) => inp.down(c), pressed = (c) => this._keys.has(c);
    it.moveZ = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
    it.moveX = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
    // touch stick: analog, and pushing it fully forward sprints (as the gamepad stick does)
    const mv = inp.move;
    if (mv) {
      it.moveX = Math.max(-1, Math.min(1, it.moveX + mv.x));
      it.moveZ = Math.max(-1, Math.min(1, it.moveZ + mv.y));
    }
    it.jump = held('Space');
    it.sprint = held('ShiftLeft') || held('ShiftRight');
    if (mv && mv.y > 0.7 && Math.hypot(mv.x, mv.y) > 0.95) it.sprint = true;
    it.crouch = held('KeyC');
    it.fire = inp.buttonDown(0);
    it.firePressed = this._buttons.has(0);
    it.aim = inp.buttonDown(2);
    it.aimPressed = this._buttons.has(2);
    it.reload = pressed('KeyR');
    it.interact = pressed('KeyE');
    it.toggleBuild = pressed('KeyQ');
    // Z/X/V jump straight into build mode; C is crouch / fly-down, so it only picks the ramp once building
    const building = !!(ch && ch.build && ch.build.active);
    it.buildPiece = pressed('KeyZ') ? 'wall' : pressed('KeyX') ? 'floor' : pressed('KeyV') ? 'roof' : (building && pressed('KeyC')) ? 'ramp' : null;
    it.editMode = pressed('KeyG');
    it.boxUp = pressed('KeyT');
    it.rampRush = held('KeyB');
    it.toggleFly = pressed('KeyF');
    it.switchSeat = pressed('KeyF');              // F switches seats while in a vehicle
    it.skipTime = pressed('KeyN');
    for (let i = 0; i < 9; i++) if (pressed('Digit' + (i + 1))) it.slot = i;
    it.slotDelta = this._wheel;
    const k = CONFIG.MOUSE_RAD_PER_PX * this.settings.sensitivity * this.lookScale;
    it.lookDX = -this._dx * k;
    it.lookDY = -this._dy * k;
    this.flush();
    return it;
  }
}

/** Training dummy: stands still or strafes left/right; deterministic from game time. */
class DummyController {
  constructor(strafe, phase) { this.strafe = !!strafe; this.phase = phase || 0; }
  getIntent(game) {
    const it = makeIntent();
    if (this.strafe) it.moveX = Math.sin(game.time * CONFIG.DUMMY.STRAFE_SPEED * Math.PI + this.phase) > 0 ? 1 : -1;
    return it;
  }
}
