/* ============================================================
 * Healing items. Click once (fire) with one selected to start using
 * it; it finishes after its use time unless you switch slots.
 * Bandages can't heal above 75 HP; medkits heal to full; shield
 * tonics add shield up to 100. You can't start one that would do
 * nothing (already at its cap).
 * ============================================================ */
const Consumables = {
  canUse(ch, c) {
    if (c.health && ch.health < c.maxHealth) return true;
    if (c.shield && ch.shield < c.maxShield) return true;
    return false;
  },

  update(ch, it, dt, game) {
    const held = ch.heldStack();
    const c = held && ITEMS[held.id] ? ITEMS[held.id].consumable : null;
    if (ch.using && (ch.using.slot !== ch.selectedSlot || !held || held.id !== ch.using.id)) {
      ch.using = null;
      game.events.emit('useCancelled', { character: ch });
    }
    if (!c) return;
    if (!ch.using && it.firePressed) {
      if (this.canUse(ch, c)) {
        ch.using = { id: held.id, slot: ch.selectedSlot, t: 0, total: c.time };
        game.events.emit('useStart', { character: ch, item: held.id });
      } else game.events.emit('useRefused', { character: ch, item: held.id });
    }
    if (!ch.using) return;
    ch.using.t += dt;
    if (ch.using.t < ch.using.total - 1e-9) return;
    if (c.health) ch.health = Math.max(ch.health, Math.min(c.maxHealth, ch.health + c.health));
    if (c.shield) ch.shield = Math.max(ch.shield, Math.min(c.maxShield, ch.shield + c.shield));
    ch.inventory.takeFrom(ch.selectedSlot, 1);
    game.events.emit('used', { character: ch, item: ch.using.id });
    ch.using = null;
  },
};
