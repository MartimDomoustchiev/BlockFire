/* ============================================================
 * Gamepad controller (Gamepad API, "standard" button mapping).
 * Same contract as KeyboardMouseController: poll() once per frame
 * banks button presses, getIntent() once per sim tick spends them,
 * so a press is never lost or doubled.
 *
 *   left stick move (click = sprint)     right stick look (click = crouch)
 *   RT shoot / gas   LT aim / brake      A jump / handbrake
 *   X reload         Y interact          B build mode (RT build, LT material)
 *   LB / RB slot (build: piece)          D-pad: up edit, left box-up,
 *   right ramp rush, down switch seat    Start pause (handled by main.js)
 * ============================================================ */
const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
  DEADZONE: 0.18,
  LOOK_YAW: 3.4,          // rad/s at full right-stick deflection (x settings.padSensitivity)
  LOOK_PITCH: 2.4,
  CURVE: 1.7,             // response curve exponent for finer aim near the centre
};

class GamepadController {
  constructor(settings, preferIndex) {
    this.settings = settings;
    this.preferIndex = preferIndex;
    this.index = -1;              // navigator.getGamepads() slot in use
    this.enabled = true;
    this.lookScale = 1;
    this.prev = [];
    this.held = [];
    this.analog = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
    this._pressed = new Set();
    this.connected = false;
  }

  /** Picks a pad: the preferred slot if connected, else any connected one. */
  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.index >= 0 && pads[this.index] && pads[this.index].connected) return pads[this.index];
    const order = [this.preferIndex, 0, 1, 2, 3].filter((i) => i !== undefined && i !== null);
    for (const i of order) if (pads[i] && pads[i].connected) { this.index = i; return pads[i]; }
    this.index = -1;
    return null;
  }

  static axis(v) {
    const a = Math.abs(v);
    if (a < PAD.DEADZONE) return 0;
    return Math.sign(v) * ((a - PAD.DEADZONE) / (1 - PAD.DEADZONE));
  }

  poll() {
    const p = this._pad();
    this.connected = !!p;
    if (!p) { this.held = []; return; }
    const b = p.buttons.map((x) => (typeof x === 'object' ? x.value : x));
    for (let i = 0; i < b.length; i++) {
      const down = b[i] > 0.4, was = (this.prev[i] || 0) > 0.4;
      if (down && !was && this.enabled) this._pressed.add(i);
    }
    this.prev = b;
    this.held = b;
    const a = p.axes;
    this.analog.lx = GamepadController.axis(a[0] || 0);
    this.analog.ly = GamepadController.axis(a[1] || 0);
    this.analog.rx = GamepadController.axis(a[2] || 0);
    this.analog.ry = GamepadController.axis(a[3] || 0);
    this.analog.lt = b[PAD.LT] || 0;
    this.analog.rt = b[PAD.RT] || 0;
  }

  /** True if Start was pressed since the last call (pause menu). */
  takeStart() { const s = this._pressed.has(PAD.START); this._pressed.delete(PAD.START); return s; }

  flush() { this._pressed.clear(); }

  getIntent(game, ch) {
    const it = makeIntent();
    if (!this.enabled || !this.connected) { this.flush(); return it; }
    const held = (i) => (this.held[i] || 0) > 0.4, pressed = (i) => this._pressed.has(i);
    const A = this.analog;
    it.moveX = A.lx;
    it.moveZ = -A.ly;
    const driving = ch && ch.vehicleSeat === 'driver';
    if (driving) {
      it.moveZ = Math.max(-1, Math.min(1, A.rt - A.lt + it.moveZ));    // triggers = gas / brake
    } else {
      it.fire = A.rt > 0.4; it.firePressed = pressed(PAD.RT);
      it.aim = A.lt > 0.4; it.aimPressed = pressed(PAD.LT);
    }
    it.jump = held(PAD.A);
    it.sprint = held(PAD.LS) || (Math.hypot(A.lx, A.ly) > 0.95 && -A.ly > 0.7);
    it.crouch = held(PAD.RS);
    it.reload = pressed(PAD.X);
    it.interact = pressed(PAD.Y);
    it.toggleBuild = pressed(PAD.B);
    it.editMode = pressed(PAD.UP);
    it.boxUp = pressed(PAD.LEFT);
    it.rampRush = held(PAD.RIGHT);
    it.switchSeat = pressed(PAD.DOWN);
    it.slotDelta = (pressed(PAD.RB) ? 1 : 0) - (pressed(PAD.LB) ? 1 : 0);
    const k = this.settings.padSensitivity * this.lookScale / CONFIG.SIM_HZ;
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), PAD.CURVE);
    it.lookDX = -curve(A.rx) * PAD.LOOK_YAW * k;
    it.lookDY = -curve(A.ry) * PAD.LOOK_PITCH * k;
    for (const i of Array.from(this._pressed)) if (i !== PAD.START) this._pressed.delete(i);
    return it;
  }
}
