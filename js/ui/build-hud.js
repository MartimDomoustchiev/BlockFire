/* ============================================================
 * Build HUD: piece selector (wall / floor / ramp / roof with their
 * keys), material selector with live counts, a hint line for edit
 * mode / missing materials, and the HP bar of the piece you aim at.
 * ============================================================ */
class BuildHud {
  constructor(hudRoot) {
    this.root = hudRoot.querySelector('.buildbar');
    this.hint = hudRoot.querySelector('.buildHint');
    this.hp = hudRoot.querySelector('.pieceHp');
    this.hpFill = hudRoot.querySelector('.pieceHpFill');
    this.hpText = hudRoot.querySelector('.pieceHpText');
    const KEYS = { wall: 'Z', floor: 'X', ramp: 'C', roof: 'V' };
    this.pieceEls = {};
    for (const p of PIECE_TYPES) {
      const d = document.createElement('div');
      d.className = 'bpiece ' + p;
      d.innerHTML = '<i></i><b>' + KEYS[p] + '</b>';
      d.title = p;
      this.root.appendChild(d);
      this.pieceEls[p] = d;
    }
    this.mats = hudRoot.querySelector('.mats');
    this.matEls = {};
    for (const m of BUILD_MATERIALS) {
      const d = document.createElement('div');
      d.className = 'bmat';
      d.innerHTML = '<img draggable="false"><span></span>';
      d.querySelector('img').src = Icons.url(CONFIG.BUILD.MATERIALS[m].item);
      this.mats.appendChild(d);
      this.matEls[m] = d;
    }
  }

  update(ch, game, visible) {
    const b = ch.build, show = visible && ch.alive && !game.rules.noBuilding;
    // the piece bar shows in build mode; material counts are always visible (your building budget)
    this.root.style.display = show && (b.active || b.edit) ? '' : 'none';
    this.mats.style.display = show ? '' : 'none';
    this.mats.classList.toggle('active', show && (b.active || !!b.edit));
    for (const p of PIECE_TYPES) this.pieceEls[p].classList.toggle('sel', b.active && b.piece === p);
    for (const m of BUILD_MATERIALS) {
      const el = this.matEls[m], M = CONFIG.BUILD.MATERIALS[m];
      const n = Building.materialCount(ch, m);
      el.querySelector('span').textContent = n;
      el.classList.toggle('sel', b.material === m);
      el.classList.toggle('low', n < M.cost && !game.rules.infiniteBlocks);
    }
    let hint = '';
    if (show && b.edit) hint = 'EDIT  click tiles to cut a door / window  -  G to confirm';
    else if (show && b.active && b.target && !b.target.ok) {
      hint = b.target.reason === 'materials' ? 'Not enough ' + ITEMS[CONFIG.BUILD.MATERIALS[b.material].item].name + ' (' + CONFIG.BUILD.MATERIALS[b.material].cost + ' per piece)'
        : b.target.reason === 'occupied' ? 'Already built there' : 'No room';
    } else if (show && b.active) hint = 'Left click build  -  Right click material  -  Q exit';
    this.hint.textContent = hint;
    this.hint.style.display = hint ? '' : 'none';

    // HP of the piece under the crosshair
    const t = ch.target, piece = show && t ? Building.pieceAtBlock(game, t.x, t.y, t.z) : null;
    this.hp.style.display = piece ? '' : 'none';
    if (piece) {
      this.hpFill.style.width = (100 * Math.max(0, piece.hp) / piece.maxHp) + '%';
      this.hpText.textContent = Math.ceil(piece.hp) + ' / ' + piece.maxHp + (piece.building ? '  building' : '');
    }
  }
}
