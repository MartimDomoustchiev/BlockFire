/* ============================================================
 * Raw keyboard / mouse input with pointer lock.
 * This layer only records what the hardware did. Controllers
 * (controllers.js) turn it into per-tick Intents for the sim.
 * Mouse buttons, wheel and mouse movement only count while the
 * pointer is locked, so clicking UI never fires a weapon.
 *
 * Touch (phones, tablets): js/input/touch.js drives this same object
 * through the touch* methods below, so the game sees ordinary keys,
 * buttons and mouse motion, and there is no pointer lock to wait for.
 * ============================================================ */
class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();            // held key codes
    this.buttons = new Set();         // held mouse buttons (0 left, 2 right)
    this.pressedKeys = new Set();     // went down since the last takeFrame()
    this.pressedButtons = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.locked = false;
    this.touch = false;               // touch controls are in use: 'locked' means 'playing', no pointer lock
    this.move = null;                 // touch stick: { x, y } in -1..1 (y forward), or null

    const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'KeyQ']);
    this._on(window, 'keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!e.repeat) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      if (GAME_KEYS.has(e.code) && (this.locked || e.code === 'Tab' || e.code === 'F3')) e.preventDefault();
    });
    this._on(window, 'keyup', (e) => this.keys.delete(e.code));
    this._on(window, 'blur', () => { this.keys.clear(); this.buttons.clear(); });
    this._on(document, 'mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.pressedButtons.add(e.button);
    });
    this._on(window, 'mouseup', (e) => this.buttons.delete(e.button));
    this._on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    this._on(window, 'wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    this._on(canvas, 'contextmenu', (e) => e.preventDefault());
    this._on(document, 'pointerlockchange', () => {
      if (this.touch) return;
      this.locked = document.pointerLockElement === canvas;
      this.buttons.clear();
    });
    this._on(document, 'pointerlockerror', () => console.warn('Pointer lock request was refused'));
  }

  _on(target, name, fn, opts) { target.addEventListener(name, fn, opts); }

  lock() {
    if (this.touch) { this.locked = true; this.buttons.clear(); return; }
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
  unlock() {
    if (this.touch) { this.locked = false; this.buttons.clear(); this.keys.clear(); this.move = null; return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- touch: the touch layer presses keys and buttons and moves the view through these
  touchKey(code, down) { if (down) this.keys.add(code); else this.keys.delete(code); if (down) this.pressedKeys.add(code); }
  touchPressKey(code) { this.pressedKeys.add(code); }
  touchButton(b, down) { if (down) { this.buttons.add(b); this.pressedButtons.add(b); } else this.buttons.delete(b); }
  touchLook(dx, dy) { this.mouseDX += dx; this.mouseDY += dy; }
  touchWheel(d) { this.wheel += d; }

  down(code) { return this.keys.has(code); }
  buttonDown(b) { return this.buttons.has(b); }

  /** Returns and clears everything that happened since the previous call (once per rendered frame). */
  takeFrame() {
    const f = {
      pressedKeys: this.pressedKeys, pressedButtons: this.pressedButtons,
      dx: this.mouseDX, dy: this.mouseDY, wheel: this.wheel,
    };
    this.pressedKeys = new Set();
    this.pressedButtons = new Set();
    this.mouseDX = this.mouseDY = this.wheel = 0;
    return f;
  }
}
