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
 * The buttons show drawn icons (TOUCH_ICONS, 24x24 line art) with the
 * name as their title; FIRE shows a blade in story mode, a sight elsewhere.
 * ============================================================ */
const TOUCH_ICONS = {
  gun: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle class="f" cx="12" cy="12" r="1.4"/>',
  blade: '<path d="M12 2.5l2.2 3.2v9.8H9.8V5.7z"/><path d="M7 15.5h10M12 15.5v4.5M10.4 21.5h3.2"/>',
  aim: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  jump: '<path d="M6 13l6-6 6 6"/><path d="M6 19l6-6 6 6"/>',
  reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v4.6h-4.6"/>',
  use: '<path d="M8.5 12.5V5.8a1.5 1.5 0 0 1 3 0V11"/><path d="M11.5 10.5V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14.5 10.8V6.3a1.5 1.5 0 0 1 3 0v7.2c0 4-2.6 7-6.4 7-2.6 0-4.1-1.4-5.4-3.4L3.7 13.3a1.5 1.5 0 0 1 2.4-1.7l2.4 2.8"/>',
  crouch: '<path d="M6 6l6 6 6-6"/><path d="M5 18.5h14"/>',
  next: '<path d="M4 8.5h13.5M14 5l3.5 3.5L14 12"/><path d="M20 15.5H6.5M10 12l-3.5 3.5L10 19"/>',
  gear: '<path d="M12 2.8l7.5 2.8v5.6c0 4.8-3.2 8.3-7.5 10-4.3-1.7-7.5-5.2-7.5-10V5.6z"/><path d="M12 7v9"/>',
  map: '<path d="M3.5 6.2l5.5-2.2 6 2.2 5.5-2.2v13.8L15 20l-6-2.2-5.5 2.2z"/><path d="M9 4v13.8M15 6.2V20"/>',
  journal: '<path d="M12 6.5c-2.2-1.6-5.2-2-8.5-1.5v13c3.3-.5 6.3-.1 8.5 1.5 2.2-1.6 5.2-2 8.5-1.5V5c-3.3-.5-6.3-.1-8.5 1.5z"/><path d="M12 6.5v13"/>',
  fly: '<path d="M12 19V6M7 10.5L12 5.5l5 5"/><path d="M3 15c3-.2 5.2.8 6.5 2.5M21 15c-3-.2-5.2.8-6.5 2.5"/>',
  inv: '<rect x="4.5" y="7.5" width="15" height="12.5" rx="2"/><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M4.5 12.5h15M11 12.5v2h2v-2"/>',
  build: '<path d="M4 20h16M6 20v-5h5v5M11 15V9h5v11M13 9V4h5v5"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
};
const touchIcon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true" class="i-' + name + '">' + TOUCH_ICONS[name] + '</svg>';

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
      '<button class="tBtn tFire" data-b="0" title="Fire / strike">' + touchIcon('gun') + touchIcon('blade') + '</button>' +
      '<button class="tBtn tAim" data-b="2" title="Aim / block">' + touchIcon('aim') + '</button>' +
      '<button class="tBtn tJump" data-k="Space" title="Jump / climb">' + touchIcon('jump') + '</button>' +
      '<button class="tBtn tReload" data-p="KeyR" title="Reload">' + touchIcon('reload') + '</button>' +
      '<button class="tBtn tUse" data-p="KeyE" title="Use">' + touchIcon('use') + '</button>' +
      '<button class="tBtn tCrouch" data-k="KeyC" title="Crouch / sneak">' + touchIcon('crouch') + '</button>' +
      '<button class="tBtn tNext" data-w="1" title="Next item">' + touchIcon('next') + '</button>' +
      '<button class="tBtn tGear" data-p="Tab" data-mode="story" title="Gear">' + touchIcon('gear') + '</button>' +
      '<button class="tBtn tMap" data-p="KeyM" data-mode="story" title="Map">' + touchIcon('map') + '</button>' +
      '<button class="tBtn tJournal" data-p="KeyJ" data-mode="story" title="Journal">' + touchIcon('journal') + '</button>' +
      '<button class="tBtn tFly" data-p="KeyF" data-mode="sandbox build" title="Fly">' + touchIcon('fly') + '</button>' +
      '<button class="tBtn tInv" data-p="Tab" data-mode="arena sandbox build" title="Inventory">' + touchIcon('inv') + '</button>' +
      '<button class="tBtn tBuild" data-p="KeyQ" data-mode="build" title="Build">' + touchIcon('build') + '</button>' +
      '<button class="tBtn tMenu" data-menu="1" title="Menu">' + touchIcon('menu') + '</button>';
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
    this.root.classList.toggle('m-story', mode === 'story');           // FIRE's icon: a blade in story, a sight elsewhere
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
      // no click after the finger lifts: GEAR or MAP opens a screen under the finger, and that click would close it again
      el.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
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
