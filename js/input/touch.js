/* ============================================================
 * Touch controls for phones and tablets (Android, iPhone, iPad).
 *
 * The screen is an overlay on the game, drawn only while playing:
 *   STICK (bottom left)      move; push fully forward to sprint
 *   LOOK (drag anywhere else) turn the view
 *   FIRE (big, bottom right) hold: shoot, mine, draw the bow, strike;
 *                            tap: place a build piece, confirm
 *   AIM                      hold: aim down sights, block with the sword
 *   JUMP                     jump; climb when pushed against a wall
 *   RELOAD / USE / NEXT      reload, interact (E), next item
 *   CROUCH                   hold to sneak (story) or crouch
 *   top left, by mode        GEAR, MAP and JOURNAL (story); FLY (explore,
 *                            free build); BUILD (free build); INV elsewhere
 *   MENU (top right)         pause
 *
 * It does not change the game: every button presses a key or mouse
 * button on the Input object (or dispatches the same key event the
 * keyboard would), and the stick and the look drags feed the same
 * analogue move and mouse motion. Keyboard and gamepad keep working.
 * ============================================================ */
class TouchUI {
  constructor(input, settings, hooks) {
    this.input = input;
    this.settings = settings;
    this.hooks = hooks || {};         // { pause() }
    this.visible = false;
    this.mode = 'arena';
    this.stickId = null; this.lookId = null;
    this.stickC = { x: 0, y: 0 }; this.lookLast = { x: 0, y: 0 };
    this.root = document.createElement('div');
    this.root.id = 'touchUi';
    this.root.hidden = true;
    this.root.innerHTML =
      '<div class="tLook"></div>' +
      '<div class="tStick"><i></i></div>' +
      '<button class="tBtn tFire" data-b="0">FIRE</button>' +
      '<button class="tBtn tAim" data-b="2">AIM</button>' +
      '<button class="tBtn tJump" data-k="Space">JUMP</button>' +
      '<button class="tBtn tReload" data-p="KeyR">RELOAD</button>' +
      '<button class="tBtn tUse" data-p="KeyE">USE</button>' +
      '<button class="tBtn tCrouch" data-k="KeyC">CROUCH</button>' +
      '<button class="tBtn tNext" data-w="1">NEXT</button>' +
      '<button class="tBtn tGear" data-p="Tab" data-mode="story">GEAR</button>' +
      '<button class="tBtn tMap" data-p="KeyM" data-mode="story">MAP</button>' +
      '<button class="tBtn tJournal" data-p="KeyJ" data-mode="story">JOURNAL</button>' +
      '<button class="tBtn tFly" data-p="KeyF" data-mode="sandbox build">FLY</button>' +
      '<button class="tBtn tInv" data-p="Tab" data-mode="arena sandbox build">INV</button>' +
      '<button class="tBtn tBuild" data-p="KeyQ" data-mode="build">BUILD</button>' +
      '<button class="tBtn tMenu" data-menu="1">MENU</button>';
    document.body.appendChild(this.root);
    this.stick = this.root.querySelector('.tStick');
    this.stickKnob = this.stick.querySelector('i');
    this._wire();
    this.setMode(this.mode);
  }

  /** Touch screens: a coarse pointer (phones, tablets) or ?touch=1 (testing on a desktop). */
  static wanted() {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1') return true;
    if (q === '0') return false;
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
  }

  /** Which control groups show: 'story', 'build', 'sandbox' or 'arena' (battle and duel). */
  setMode(mode) {
    this.mode = mode;
    for (const el of this.root.querySelectorAll('[data-mode]')) el.hidden = !el.dataset.mode.split(' ').includes(mode);
  }

  /** Shown while playing with nothing else open. */
  setVisible(on) {
    on = !!on;
    if (on === this.visible) return;
    this.visible = on;
    this.root.hidden = !on;
    if (!on) this._release();
  }

  _wire() {
    // buttons: press = hold (keys, mouse buttons) or a tap (keys pressed once, wheel steps, menu)
    for (const el of this.root.querySelectorAll('.tBtn')) {
      const k = el.dataset.k, p = el.dataset.p, b = el.dataset.b, w = el.dataset.w, menu = el.dataset.menu;
      const down = (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('on');
        this._sound();
        if (k) this.input.touchKey(k, true);
        if (b !== undefined) this.input.touchButton(+b, true);
        if (p) { this._dispatch(p); }
        if (w) this.input.touchWheel(+w);
        if (menu && this.hooks.pause) this.hooks.pause();
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        el._pid = e.pointerId;
      };
      const up = (e) => {
        if (e && e.pointerId !== undefined && el._pid !== undefined && e.pointerId !== el._pid) return;
        el.classList.remove('on');
        if (k) this.input.touchKey(k, false);
        if (b !== undefined) this.input.touchButton(+b, false);
        el._pid = undefined;
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
    // stick
    this.stick.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.stickId = e.pointerId;
      this.stick.setPointerCapture && this.stick.setPointerCapture(e.pointerId);
      const r = this.stick.getBoundingClientRect();
      this.stickC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this._stickMove(e);
    });
    this.stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) { e.preventDefault(); this._stickMove(e); } });
    const stickEnd = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.move = null;
      this.stickKnob.style.transform = '';
    };
    this.stick.addEventListener('pointerup', stickEnd);
    this.stick.addEventListener('pointercancel', stickEnd);
    // look: any drag on the open part of the screen (the buttons sit above and take their own touches)
    const look = this.root.querySelector('.tLook');
    look.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY };
      look.setPointerCapture && look.setPointerCapture(e.pointerId);
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      e.preventDefault();
      const k = this._lookScale();
      this.input.touchLook((e.clientX - this.lookLast.x) * k, (e.clientY - this.lookLast.y) * k);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const lookEnd = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    look.addEventListener('pointerup', lookEnd);
    look.addEventListener('pointercancel', lookEnd);
    // the first touch of the game unlocks sound (iOS needs a touchend)
    window.addEventListener('touchend', () => { try { Sound.init(); } catch (e) { /* */ } }, { passive: true });
  }

  _stickMove(e) {
    const R = Math.max(40, this.stick.getBoundingClientRect().width / 2 - 14);
    let dx = (e.clientX - this.stickC.x) / R, dy = -(e.clientY - this.stickC.y) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const d = m < 0.12 ? { x: 0, y: 0 } : { x: dx, y: dy };
    this.input.move = d;
    this.stickKnob.style.transform = 'translate(' + (d.x * R) + 'px,' + (-d.y * R) + 'px)';
  }

  /** Pixels of a touch drag to mouse pixels: a finger is coarser than a mouse, so it turns a little faster. */
  _lookScale() { return 1.6 * (this.settings.touchLook || 1); }

  /** A UI key (Tab, M, E, ...) as the keyboard would send it: window listeners see it, and Input counts it. */
  _dispatch(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
    this.input.touchPressKey(code);
  }

  _sound() { /* a tap sound is not needed; haptics where the browser allows */ if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* */ } } }

  /** Lift everything (the overlay closed or the game paused). */
  _release() {
    this.input.move = null;
    this.stickId = null; this.lookId = null;
    this.stickKnob.style.transform = '';
    for (const el of this.root.querySelectorAll('.tBtn')) el.classList.remove('on');
    for (const k of ['Space', 'KeyC', 'ShiftLeft']) this.input.touchKey(k, false);
    this.input.touchButton(0, false); this.input.touchButton(2, false);
  }
}
