/* Stage 5: vehicles - seats, driving, drift, collisions, ramps, boats, damage, fuel. */
const { SETUP } = require('./stage2.test.js');

const VEH = `(() => {
  T.vehicle = (kind, x, z, yaw = 0) => { const v = T.g.addEntity(new Vehicle(kind)); v.pos.set(x, 31, z); v.yaw = yaw; return v; };
  T.enter = (v) => { T.p.teleport(v.pos.x + 2.2, 31, v.pos.z); T.press({ interact: true }); return T.p.vehicleSeat; };
  T.fwdSpeed = (v) => { const f = v.fwd(new THREE.Vector3()); return v.vel.x * f.x + v.vel.z * f.z; };
  T.latSpeed = (v) => { const r = v.right(new THREE.Vector3()); return v.vel.x * r.x + v.vel.z * r.z; };
  return true;
})()`;

/** Arena plus a long flat runway along -z (x -6..6, z -120..14). */
async function setup(ctx) {
  const { page } = await ctx.open('autostart=1&seed=hello&rd=8');
  await page.evaluate(SETUP);
  await page.evaluate(VEH);
  await page.evaluate(() => T.waitReady(-14, -120, 14, 14));
  await page.evaluate(() => {
    T.arena();
    const list = [];
    for (let z = -120; z < -14; z++) for (let x = -6; x <= 6; x++) {
      for (let y = 28; y <= 30; y++) list.push([x, y, z, BLOCK.STONE]);
      for (let y = 31; y <= 45; y++) list.push([x, y, z, BLOCK.AIR]);
    }
    T.w.setBlocks(list);
    for (const e of [...T.g.entities.values()]) if (e !== T.p) T.g.removeEntity(e);
  });
  await page.evaluate(() => T.waitSettled());
  return page;
}

exports.tests = {
  'seats: enter as driver, switch seats, exit to a free spot; drivers cannot shoot, passengers can': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const v = T.vehicle('car', 0.5, 6.5);
      T.p.inventory.clear(); T.p.inventory.set(0, makeWeapon('pistol', 0)); T.p.inventory.add(makeStack('ammo_light', 50)); T.p.selectSlot(0);
      out.seat = T.enter(v);
      out.seats = v.seats.slice();
      const shots0 = T.count ? 0 : 0;
      let shots = 0; T.g.events.on('shot', () => shots++);
      T.p.pitch = 0.3; T.press({ fire: true, firePressed: true }); T.tick(10);
      out.driverShots = shots;
      T.press({ switchSeat: true });
      out.after = [T.p.vehicleSeat, v.seats.indexOf(T.p.id)];
      T.tick(15); T.press({ fire: true, firePressed: true });
      out.passengerShots = shots;
      out.followsSeat = T.p.pos.distanceTo(v.local(...CONFIG.VEHICLES.car.seats[1], new THREE.Vector3())) < 1e-6;
      T.press({ interact: true });
      out.exited = [T.p.vehicle === null, v.seats.every((s) => s === null), Vehicles.fits(T.g, T.p.pos)];
      return out;
    });
    ctx.assert(r.seat === 'driver' && r.seats[0] !== null, 'entered as driver');
    ctx.assert(r.driverShots === 0, 'driver cannot shoot');
    ctx.assert(r.after[0] === 'passenger' && r.after[1] === 1, 'switched to seat 1');
    ctx.assert(r.passengerShots === 1, 'passenger shoots');
    ctx.assert(r.followsSeat, 'occupant rides at the seat');
    ctx.assert(r.exited.every(Boolean), 'exit leaves the seat and lands in free space: ' + r.exited);
  },

  'engine: accelerates to top speed, boost is faster and burns more fuel, no fuel = no throttle': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const v = T.vehicle('car', 0.5, 10.5);
      T.enter(v);
      const f0 = v.fuel;
      T.it = { moveZ: 1 }; T.sim(3); T.it = {};
      out.top = T.fwdSpeed(v); out.burn = f0 - v.fuel;
      v.pos.set(0.5, 31, 10.5); v.vel.set(0, 0, 0); v.yaw = 0;
      const f1 = v.fuel;
      T.it = { moveZ: 1, sprint: true }; T.sim(3); T.it = {};
      out.boostTop = T.fwdSpeed(v); out.boostBurn = f1 - v.fuel;
      // coast to a stop, then try with an empty tank
      T.sim(8);
      v.pos.set(0.5, 31, 10.5); v.vel.set(0, 0, 0); v.fuel = 0;
      T.it = { moveZ: 1 }; T.sim(2); T.it = {};
      out.noFuel = T.fwdSpeed(v);
      return out;
    });
    ctx.near(r.top, 22, 0.3, 'car reaches max speed');
    ctx.assert(r.boostTop > r.top * 1.3, 'boost is faster: ' + r.boostTop);
    ctx.assert(r.boostBurn > r.burn * 2, 'boost burns fuel faster');
    ctx.assert(Math.abs(r.noFuel) < 0.01, 'no fuel, no movement');
  },

  'handling: steering turns with speed, the handbrake makes it drift': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const v = T.vehicle('car', 0.5, 10.5);
      T.enter(v);
      T.it = { moveX: -1 }; T.sim(1); T.it = {};
      out.parkedYaw = v.yaw;
      const run = (handbrake) => {
        v.pos.set(0.5, 31, 0.5); v.yaw = 0; v.vel.set(0, 0, -18);
        T.it = { moveZ: 1, moveX: -1, jump: handbrake }; T.sim(0.6); T.it = {};
        return Math.abs(T.latSpeed(v));
      };
      out.gripSlide = run(false);
      out.driftSlide = run(true);
      return out;
    });
    ctx.assert(Math.abs(r.parkedYaw) < 1e-9, 'a parked car does not turn');
    ctx.assert(r.driftSlide > r.gripSlide * 2, 'handbrake drift slides much more: ' + r.gripSlide.toFixed(2) + ' vs ' + r.driftSlide.toFixed(2));
  },

  'collisions: walls stop and damage, leaves and glass get smashed, build pieces get rammed': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const wall = [];
      for (let x = -6; x <= 6; x++) for (let y = 31; y <= 34; y++) wall.push([x, y, -60, BLOCK.STONE]);
      for (let x = -6; x <= 6; x++) for (let y = 31; y <= 33; y++) wall.push([x, y, -30, BLOCK.LEAVES], [x, y, -40, BLOCK.GLASS]);
      T.w.setBlocks(wall);
      const v = T.vehicle('car', 0.5, 0.5);
      T.enter(v);
      T.it = { moveZ: 1, sprint: true }; T.sim(6); T.it = {};
      out.z = v.pos.z; out.hp = v.hp; out.speed = v.speed;
      out.leaves = T.w.getBlock(0, 31, -30); out.glass = T.w.getBlock(0, 31, -40);
      // ram a wooden wall piece
      T.press({ interact: true });
      T.p.inventory.add(makeStack('planks', 50));
      T.stand(0.5, -66.5, Math.PI, 0);
      T.press({ buildPiece: 'wall' }); T.press({ fire: true, firePressed: true }); T.press({ toggleBuild: true });
      const piece = [...T.g.pieces.values()][0];
      piece.hp = piece.maxHp; piece.building = false;
      const v2 = T.vehicle('truck', 0.5, -90.5, Math.PI);
      v2.yaw = Math.PI;                                      // facing +z, towards the wall
      T.enter(v2);
      T.it = { moveZ: 1, sprint: true }; T.sim(4); T.it = {};
      out.piece = T.g.pieces.size;
      return out;
    });
    ctx.assert(r.z > -60 + 1 && r.z < -55, 'stopped at the stone wall: z=' + r.z.toFixed(2));
    ctx.assert(r.hp < 600, 'crash damaged the car: ' + r.hp);
    ctx.assert(r.leaves === 0 && r.glass === 0, 'drove through leaves and glass');
    ctx.assert(r.piece === 0, 'truck smashed through a wooden wall piece');
  },

  'ramps launch vehicles; boats float and land vehicles crawl in water': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      T.p.inventory.add(makeStack('planks', 50));
      T.stand(0.5, -20.5, 0, 0);
      T.press({ buildPiece: 'ramp' }); T.press({ fire: true, firePressed: true }); T.press({ toggleBuild: true });
      const v = T.vehicle('sports', 2.0, 0.5);              // centred on the ramp (cell x 0..3)
      T.enter(v);
      let maxY = 31, air = 0;
      T.it = { moveZ: 1 };
      for (let i = 0; i < 240; i++) { T.tick(); maxY = Math.max(maxY, v.pos.y); if (!v.onGround) air++; }
      T.it = {};
      out.maxY = maxY; out.air = air; out.landed = v.onGround;
      T.press({ interact: true });
      // a pool for the boat
      const pool = [];
      for (let x = -6; x <= 6; x++) for (let z = -110; z <= -80; z++) { pool.push([x, 28, z, BLOCK.WATER], [x, 29, z, BLOCK.WATER], [x, 30, z, BLOCK.WATER]); }
      T.w.setBlocks(pool);
      const b = T.g.addEntity(new Vehicle('boat')); b.pos.set(0.5, 30.85, -85.5); b.yaw = 0;
      T.p.teleport(3, 31, -85.5); T.press({ interact: true });
      out.boatSeat = T.p.vehicleSeat;
      T.it = { moveZ: 1 }; T.sim(1.5); T.it = {};
      out.boat = [b.onWater, b.pos.y, b.speed];
      T.press({ interact: true });
      const car = T.vehicle('car', 0.5, -78.5);
      T.enter(car);
      T.it = { moveZ: 1 }; T.sim(3); T.it = {};
      out.carInWater = [car.submerged, car.speed];
      return out;
    });
    ctx.assert(r.maxY >= 35 && r.air > 10 && r.landed, 'launched off the ramp and landed: ' + JSON.stringify(r));
    ctx.assert(r.boatSeat === 'driver' && r.boat[0] && Math.abs(r.boat[1] - 30.85) < 0.05 && r.boat[2] > 8, 'boat floats and moves: ' + r.boat);
    ctx.assert(r.carInWater[0] && r.carInWater[1] < 22 * 0.3, 'car crawls in deep water: ' + r.carInWater);
  },

  'damage: bullets and explosions hurt vehicles; at 0 HP they explode and throw occupants out': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const v = T.vehicle('sports', 0.5, -10.5);
      const d = new Character({ name: 'Rider', controller: new DummyController(false) });
      T.g.addEntity(d); d.teleport(v.pos.x + 2, 31, v.pos.z);
      Vehicles.enter(T.g, d, v);
      T.tick(2);
      // shoot the car from outside: the occupant is protected by the hull
      T.stand(0.5, 0.5, 0, 0);
      T.p.inventory.clear(); T.p.inventory.set(0, makeWeapon('ar', 0)); T.p.selectSlot(0);
      const hpBefore = v.hp, riderBefore = d.health;
      T.p.lookDir = T.p.lookDir;
      const dx = v.pos.x - T.p.pos.x, dy = v.pos.y + 0.6 - T.p.eyeY, dz = v.pos.z - T.p.pos.z;
      T.p.yaw = Math.atan2(-dx, -dz); T.p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      T.press({ fire: true, firePressed: true });
      out.bullet = [hpBefore - v.hp, riderBefore - d.health];
      Combat.explode(T.g, v.pos.x, v.pos.y + 1, v.pos.z + 3, Weapons.stats('rocket', 0), T.p);
      out.afterRocket = v.hp;
      v.damage(T.g, 10000, T.p);
      T.tick(1);
      out.exploded = [v.alive, T.g.entities.has(v.id), d.vehicle === null, d.health < 100 || !d.alive];
      return out;
    });
    ctx.near(r.bullet[0], 30, 1e-6, 'rifle bullet damaged the hull');
    ctx.assert(r.bullet[1] === 0, 'occupant protected by the hull');
    ctx.assert(r.afterRocket < 450 - 30, 'rocket splash damaged it');
    ctx.assert(!r.exploded[0] && !r.exploded[1] && r.exploded[2] && r.exploded[3], 'exploded, removed, rider thrown out and hurt: ' + r.exploded);
  },

  'running characters over hurts them; barrels refuel and explode when shot': async (ctx) => {
    const page = await setup(ctx);
    const r = await page.evaluate(() => {
      const out = {};
      const d = new Character({ name: 'Walker', controller: new DummyController(false) });
      T.g.addEntity(d); d.teleport(0.5, 31, -25.5);
      const v = T.vehicle('car', 0.5, 0.5);
      T.enter(v);
      T.it = { moveZ: 1 }; T.sim(2.5); T.it = {};
      out.walker = d.health;
      T.press({ interact: true });
      v.vel.set(0, 0, 0);                                   // parked (it would coast on otherwise)
      // barrel refuel
      const b = T.g.addEntity(new FuelBarrel()); b.pos.set(v.pos.x + 2.5, 31, v.pos.z);
      v.fuel = 10;
      T.sim(2);
      out.fuel = v.fuel;
      // shoot from the far side so the parked car isn't in the way
      Combat.hitscan(T.g, T.p, new THREE.Vector3(b.pos.x, 40, b.pos.z), new THREE.Vector3(0, -1, 0), Weapons.stats('sniper', 0));
      T.tick(1);
      out.barrel = [b.alive, T.g.entities.has(b.id)];
      return out;
    });
    ctx.assert(r.walker < 100, 'ran over: ' + r.walker);
    ctx.near(r.fuel, 10 + 14 * 2, 1, 'refuelled near the barrel');
    ctx.assert(!r.barrel[0] && !r.barrel[1], 'barrel exploded');
  },
};
