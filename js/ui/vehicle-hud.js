/* ============================================================
 * Vehicle HUD: speed, fuel gauge, vehicle health, seat list and
 * key hints while you sit in a vehicle.
 * ============================================================ */
class VehicleHud {
  constructor(hudRoot) {
    this.root = hudRoot.querySelector('.vehicleHud');
    this.root.innerHTML = '<div class="vname"></div><div class="vspeed"><b>0</b> km/h</div>' +
      '<div class="vrow">HULL<div class="bar"><i class="vhp"></i></div></div>' +
      '<div class="vrow">FUEL<div class="bar"><i class="vfuel"></i></div></div><div class="vseats"></div>' +
      '<div class="vkeys"><kbd>E</kbd> exit &nbsp; <kbd>F</kbd> switch seat</div>';
    this.name = this.root.querySelector('.vname');
    this.speed = this.root.querySelector('.vspeed b');
    this.hp = this.root.querySelector('.vhp');
    this.fuel = this.root.querySelector('.vfuel');
    this.seats = this.root.querySelector('.vseats');
  }

  update(ch, game) {
    const v = ch.vehicle;
    this.root.style.display = v ? '' : 'none';
    if (!v) return;
    this.name.textContent = v.spec.name + (ch.vehicleSeat === 'driver' ? '  -  DRIVER' : '  -  PASSENGER');
    this.speed.textContent = Math.round(v.speed * 3.6);
    this.hp.style.width = (100 * Math.max(0, v.hp) / v.spec.hp) + '%';
    this.fuel.style.width = (100 * v.fuel / v.spec.fuel) + '%';
    this.fuel.classList.toggle('low', v.fuel < v.spec.fuel * 0.2);
    let s = '';
    v.seats.forEach((id, i) => {
      const c = id && game.entities.get(id);
      s += '<span class="' + (c === ch ? 'me' : c ? 'taken' : '') + '">' + (i === 0 ? 'D' : i) + '</span>';
    });
    this.seats.innerHTML = s;
  }
}
