/* ============================================================
 * The campaign and the contracts, as data plus small functions.
 *
 * A mission is a list of steps. Each step may:
 *   text / hint      what the objective panel says (string or fn)
 *   marker(S, M)     a point (or a character) to mark on screen
 *   lines            dialogue played when the step begins
 *   setup(S, M)      spawn what the step needs (re-run on retry)
 *   check(S, M)      true once the step is done
 *   fail(S, M)       a reason string when the step is failed
 *   checkpoint(S, M) where players restart after a failure
 *   talk(S, M)       an NPC the players can talk to (E) - sets M.talked
 *   cage(S, M)       a cage whose door the players can open (E)
 * S is the Story (helpers), M the mission's own scratch state.
 * Places (V1..V4, C1..C3, keep, hideout) are chosen from the map:
 * V1 is the village nearest the hideout, and so on.
 * ============================================================ */
const STORY_CHAPTERS = [
  // ------------------------------------------------------------------ I
  {
    key: 'ch1', title: 'The Quiet Order',
    intro: [
      ['Old Wren', 'So. You are the one who came looking for the Order.'],
      ['Old Wren', 'Magistrate Corvin Vale bleeds this island dry, and his Tollmen enforce every word of it.'],
      ['Old Wren', 'Before you fight them, learn to see what we see. Go to {V1} and climb its watchtower.'],
    ],
    steps: [
      {
        text: 'Climb the watchtower in {V1}', hint: 'Hold W and SPACE (or SHIFT) against any wall to climb.',
        marker: (S) => S.places.V1.poi.tower.top,
        check: (S) => S.near(S.places.V1.poi.tower.top, 3, 2),
      },
      {
        text: 'Synchronize the viewpoint', hint: 'Press E at the top of the tower.',
        marker: (S) => S.places.V1.poi.tower.top,
        check: (S) => S.isSynced(S.viewpointOf(S.places.V1)),
      },
      {
        text: 'Take the leap of faith into the hay', hint: 'Walk off the end of the wooden perch. The hay breaks your fall.',
        marker: (S) => S.places.V1.poi.tower.perch,
        lines: [['Old Wren', 'Now trust the hay. Step off the perch.']],
        check: (S, M) => S.landedInHayNear(S.places.V1.poi.tower.hay, M.stepStart),
      },
      {
        text: 'Take down the Tollman bullying the baker', hint: 'Come at him from behind while he is busy, then click to strike with your wrist blade.',
        lines: [['Old Wren', 'A Tollman is shaking down the baker in the square. Take him down before he sees you coming.']],
        setup: (S, M) => {
          const v = S.places.V1, stall = v.poi.stalls[0] || { front: v.poi.well, vendor: v.poi.well };
          const f = stall.front, w = stall.vendor;
          const yaw = Math.atan2(-(w.x - f.x), -(w.z - f.z));
          M.bully = S.temp(M, Npc.guard(S.game, v.key, { pos: { x: f.x, y: f.y, z: f.z, yaw }, name: 'Sergeant Mott', look: 'captain', health: 100, tag: 'target' }));
          M.bully.controller.homeState = 'idle';
        },
        marker: (S, M) => M.bully,
        check: (S, M) => M.bully && !M.bully.alive,
        fail: (S, M) => M.bully && M.bully.alive && M.bully.controller.state === 'combat' ? 'Sergeant Mott saw you coming.' : null,
        checkpoint: (S) => S.places.V1.poi.tower.base,
      },
      {
        text: 'Return to Old Wren at the hideout', marker: (S) => S.mentor,
        talk: (S) => S.mentor,
        check: (S, M) => M.talked === S.mentor,
      },
    ],
    outro: [
      ['Old Wren', 'Clean work. The baker will remember that someone stood up for him.'],
      ['Old Wren', 'Take this bow. Quiet, like you. Draw, breathe, loose. And pick your arrows up after.'],
    ],
    reward: (S) => { S.addSilver(50); S.giveAll([['w_bow', 1], ['arrow', 12]]); },
  },
  // ------------------------------------------------------------------ II
  {
    key: 'ch2', title: 'The Ledger',
    intro: [
      ['Old Wren', 'Vale\'s tax collector, Fitch, keeps a ledger of every coin he squeezes out of {V2}.'],
      ['Old Wren', 'They say it records more than taxes. Follow him. Do not let him see you.'],
    ],
    steps: [
      {
        text: 'Go to {V2}', marker: (S) => S.places.V2.poi.well || S.places.V2,
        check: (S) => S.near(S.places.V2, 22),
      },
      {
        text: 'Find Fitch the tax collector in the square', hint: 'Spot him from a distance - don\'t walk up to him.',
        setup: (S, M) => {
          const v = S.places.V2, at = v.poi.spots[0];
          M.fitch = S.keep(M, Npc.ally(S.game, { name: 'Fitch', look: 'clerk', role: 'villager', team: 3, pos: Object.assign({}, at, { yaw: 0 }), tag: 'target', health: 60 }));
        },
        marker: (S, M) => M.fitch,
        check: (S, M) => S.near(M.fitch.pos, 25),
        fail: (S, M) => !M.fitch.alive ? 'Fitch is dead. The ledger\'s trail died with him.' : null,
      },
      {
        text: (S, M) => 'Tail Fitch. Stay close, stay unseen' + (M.lostFor > 0 ? ' - you\'re losing him!' : M.sus > 0.5 ? ' - he\'s getting suspicious!' : ''),
        hint: 'Keep within 45 blocks. He glances back now and then: get behind a wall or a tree, hide, blend into a crowd or keep your distance.',
        lines: [['Fitch', 'Right. Off to the camp before that lot spends my money...']],
        setup: (S, M) => {
          const route = S.routeBetween(S.places.V2, S.places.C1);
          M.fitch.controller = new AllyController(M.fitch.id * 7 + 1, { mode: 'route', points: route, pace: 0.55, glances: true });
          M.lostFor = 0; M.sus = 0; M.barked = false;
          M.fitch.suspicion = 0;
        },
        marker: (S, M) => M.fitch,
        check: (S, M) => M.fitch.controller.done,
        fail: (S, M) => {
          if (!M.fitch.alive) return 'Fitch is dead. The ledger\'s trail died with him.';
          const n = S.nearestPlayer(M.fitch.pos);
          M.lostFor = n && n.d < 45 ? 0 : M.lostFor + 0.1;
          if (M.lostFor > 6) return 'You lost Fitch.';
          // his suspicion fills while he can see you (meter over his head) and drains when he can't
          const r = S.suspicionRate(M.fitch, 16);
          M.sus = Math.max(0, Math.min(1, M.sus + (r > 0 ? r : -0.3) * 0.1));
          M.fitch.suspicion = M.sus;
          if (M.sus >= 1) return 'Fitch spotted you following him.';
          if (M.sus > 0.45 && !M.barked) { M.barked = true; S.game.events.emit('bark', { character: M.fitch, text: 'Hm? Is someone following me?' }); }
          if (M.sus < 0.1) M.barked = false;
          return null;
        },
        done: (S, M) => { M.fitch.suspicion = 0; },
        retry: 1,
        checkpoint: (S) => S.places.V2.poi.well,
      },
      {
        text: 'Steal the ledger from the strongbox in {C1}', hint: 'The ledger lies in the big tent. Walk over it to take it.',
        lines: [['Fitch', 'Ledger\'s in the box, Sergeant. Same as always.']],
        setup: (S, M) => {
          M.fitch.controller = new AllyController(M.fitch.id * 7 + 2, { mode: 'stand', post: Object.assign({}, M.fitch.pos) });
          M.ledger = S.keep(M, S.dropItem('ledger', S.places.C1.poi.strongbox));
        },
        marker: (S, M) => S.places.C1.poi.strongbox,
        check: (S) => S.anyHas('ledger'),
        checkpoint: (S) => S.places.V2.poi.well,
      },
      {
        text: 'Get clear of {C1}', hint: 'Get 50 blocks away with nobody chasing you.',
        marker: (S) => S.places.V2.poi.well,
        check: (S) => { const c = S.places.C1, p = S.holder('ledger'); return !!p && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) > 50 && !S.anyCombat(); },
      },
      {
        text: 'Bring the ledger to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor,
        check: (S, M) => M.talked === S.mentor && S.anyHas('ledger'),
        done: (S) => S.takeItem('ledger'),
      },
    ],
    outro: [
      ['Old Wren', 'Let me see... "Chains: two hundred. Ironwood, for the smith."'],
      ['Old Wren', 'Ida Marrow. The best smith on the island. They are forcing her to forge chains, for us, I would wager.'],
      ['Old Wren', 'Take these. Smoke bombs. Blind them, then vanish.'],
    ],
    reward: (S) => { S.addSilver(80); S.giveAll([['w_smoke', 1], ['smoke_bomb', 3], ['arrow', 8]]); },
  },
  // ------------------------------------------------------------------ III
  {
    key: 'ch3', title: 'The Smith of Ironwood',
    intro: [
      ['Old Wren', 'Ida Marrow is caged in {C2}. Get her out alive.'],
      ['Old Wren', 'Take her to {V3}. She has friends there who will hide her.'],
    ],
    steps: [
      {
        text: 'Reach {C2}', marker: (S) => S.places.C2,
        setup: (S, M) => {
          const c = S.places.C2.poi.cage;
          S.setCageDoor(S.places.C2, true);
          M.ida = S.keep(M, Npc.ally(S.game, { name: 'Ida Marrow', look: 'smith', pos: Object.assign({}, c.inside, { yaw: Math.atan2(-(c.front.x - c.inside.x), -(c.front.z - c.inside.z)) }), tag: 'escort', health: 200 }));
        },
        check: (S) => S.near(S.places.C2, 32),
      },
      {
        text: 'Free Ida from her cage', hint: 'Press E at the cage door, then keep still while you pick the lock.',
        marker: (S) => S.places.C2.poi.cage.front,
        cage: (S) => S.places.C2,
        check: (S) => S.cageOpen(S.places.C2),
        fail: (S, M) => !M.ida.alive ? 'Ida Marrow was killed.' : null,
        retry: 0,
      },
      {
        text: 'Escort Ida to {V3}', hint: 'She follows you. Guards will go for her too: keep her alive.',
        lines: [['Ida Marrow', 'About time! Lead the way. I will be right behind you.']],
        setup: (S, M) => {
          M.ida.controller = new AllyController(M.ida.id * 5 + 3, { mode: 'follow', leader: S.nearestPlayer(M.ida.pos).ch });
          M.ida.fugitive = true;
        },
        marker: (S) => S.places.V3.poi.well,
        check: (S, M) => Math.hypot(M.ida.pos.x - S.places.V3.x, M.ida.pos.z - S.places.V3.z) < 10,
        fail: (S, M) => {
          if (!M.ida.alive) return 'Ida Marrow was killed.';
          const n = S.nearestPlayer(M.ida.pos);
          if (n && n.ch !== M.ida.controller.leader && n.d < 6) M.ida.controller.leader = n.ch;
          return null;
        },
        retry: 0,
        checkpoint: (S) => S.places.C2.poi.gates[0].out,
      },
      {
        text: 'Talk to Ida', marker: (S, M) => M.ida, talk: (S, M) => M.ida,
        setup: (S, M) => { M.ida.fugitive = false; M.ida.controller = new AllyController(M.ida.id * 5 + 4, { mode: 'stand', post: Object.assign({}, M.ida.pos) }); },
        check: (S, M) => M.talked === M.ida,
      },
    ],
    outro: [
      ['Ida Marrow', 'Ten months in that cage. I owe you my life.'],
      ['Ida Marrow', 'I will set up shop at your hideout. Knives, smoke, medicine, whatever you need. Bring silver.'],
    ],
    reward: (S, M) => { S.addSilver(100); S.unlockShop(); },
  },
  // ------------------------------------------------------------------ IV
  {
    key: 'ch4', title: 'The Captain',
    intro: [
      ['Old Wren', 'Captain Brask Hollen commands the Tollmen. He inspects {C3} himself, with two bodyguards at his heels.'],
      ['Old Wren', 'Without Brask, Vale\'s men lose their teeth. Take him down, quietly if you can.'],
    ],
    steps: [
      { text: 'Go to {C3}', marker: (S) => S.places.C3, check: (S) => S.near(S.places.C3, 40) },
      {
        text: 'Assassinate Captain Brask Hollen', hint: 'Smoke stuns his guards. A takedown from behind or from above kills him outright.',
        setup: (S, M) => {
          const c = S.places.C3, route = c.poi.patrol;
          M.brask = S.temp(M, Npc.guard(S.game, c.key, { pos: route[0], route, name: 'Captain Brask Hollen', look: 'captain', health: CONFIG.STORY.GUARD.CAPTAIN_HEALTH, tag: 'target' }));
          for (let i = 1; i <= 2; i++) S.temp(M, Npc.guard(S.game, c.key, { pos: { x: route[0].x + i, y: route[0].y, z: route[0].z }, route, name: 'Bodyguard' }));
        },
        marker: (S, M) => M.brask,
        check: (S, M) => !M.brask.alive,
        checkpoint: (S) => S.places.C3.poi.gates[0].out,
      },
      {
        text: 'Lose your pursuers', hint: 'Break line of sight and hide until nobody is hunting you.',
        lines: [['Old Wren', 'Brask is down. Now get out of there.']],
        check: (S, M) => { M.clear = S.anyCombat() ? 0 : (M.clear || 0) + 0.1; return M.clear > 5; },
      },
      { text: 'Return to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor, check: (S, M) => M.talked === S.mentor },
    ],
    outro: [
      ['Old Wren', 'Brask is dead. Vale will be frightened now, and frightened men make mistakes.'],
      ['Old Wren', 'He has ordered the villages burned at dawn. Tonight, we end this.'],
    ],
    reward: (S) => { S.addSilver(120); S.giveAll([['arrow', 12], ['smoke_bomb', 2]]); },
  },
  // ------------------------------------------------------------------ V
  {
    key: 'ch5', title: 'The Magistrate',
    intro: [
      ['Old Wren', 'Corvin Vale hides behind the walls of {keep}. The walls are high. You climb higher.'],
      ['Old Wren', 'Get inside, find him in his hall, and end this.'],
    ],
    steps: [
      {
        text: 'Get inside the walls of {keep}', hint: 'Climb the walls, or slip through the gate when nobody is looking.',
        marker: (S) => S.places.keep,
        setup: (S, M) => {
          const t = S.places.keep.poi.throne;
          M.vale = S.keep(M, Npc.guard(S.game, S.places.keep.key, { pos: Object.assign({}, t, { yaw: S.places.keep.poi.posts[3] ? S.places.keep.poi.posts[3].yaw : 0 }), name: 'Magistrate Corvin Vale', look: 'magistrate', health: 160, tag: 'target' }));
        },
        check: (S) => S.players().some((p) => p.alive && Stealth.restricted(S.game, p.pos.x, p.pos.z) && Math.hypot(p.pos.x - S.places.keep.x, p.pos.z - S.places.keep.z) < 24),
      },
      {
        text: 'Assassinate Magistrate Corvin Vale', marker: (S, M) => M.vale,
        hint: 'He faces the door. There is a skylight in the hall roof right above his throne: drop on him from there.',
        check: (S, M) => !M.vale.alive,
        done: (S) => S.lines([['Corvin Vale', 'You think... killing me frees them? Someone will always... collect.']]),
        checkpoint: (S) => S.places.keep.poi.gate.out,
      },
      {
        text: 'Escape {keep}', hint: 'Get clear of the walls and lose anyone chasing you.',
        marker: (S) => S.places.V1.poi.well,
        check: (S, M) => { const k = S.places.keep; M.clear = S.anyCombat() || S.near(k, 45) ? 0 : (M.clear || 0) + 0.1; return M.clear > 3; },
      },
      { text: 'Return to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor, check: (S, M) => M.talked === S.mentor },
    ],
    outro: [
      ['Old Wren', 'It is done, then. Without their master the Tollmen will scatter.'],
      ['Old Wren', 'The island breathes again. But our work is never finished. The notice boards will still need you.'],
    ],
    reward: (S) => { S.addSilver(200); S.finish(); },
  },
];

/* ============================================================
 * Contracts: side jobs from the notice boards, generated from the
 * map. Same step format as the chapters.
 * ============================================================ */
const Contracts = {
  KINDS: ['assassinate', 'steal', 'rescue', 'courier'],
  TARGETS: ['Sergeant Kell', 'Toll-Master Orrin', 'Sergeant Vasko', 'Quartermaster Pell', 'Sergeant Dunmore', 'Bailiff Crane'],

  /** Three offers for the board at `site`. */
  offers(S, site, rng) {
    const out = [];
    const kinds = this.KINDS.slice();
    for (let i = 0; i < 3; i++) {
      const kind = kinds.splice(Math.floor(rng.next() * kinds.length), 1)[0];
      out.push(this.make(S, kind, site, rng));
    }
    return out;
  },

  make(S, kind, board, rng) {
    const P = S.plan, pick = (a) => a[Math.floor(rng.next() * a.length)];
    const home = board.kind === 'village' ? board : P.hideout;
    const dropPoint = board.kind === 'village' ? board.poi.board : P.hideout.poi.board;
    if (kind === 'assassinate') {
      const site = pick(P.camps.concat(P.villages.filter((v) => v !== board)));
      const name = pick(this.TARGETS), post = pick(site.poi.posts.filter((p) => !p.marksman));
      return {
        kind, title: 'Contract: ' + name, desc: `Kill ${name} at ${site.name}.`, reward: 70 + Math.floor(rng.next() * 40), site: site.key,
        steps: [{
          text: `Assassinate ${name} at ${site.name}`,
          setup: (S, M) => {
            M.t = S.temp(M, Npc.guard(S.game, site.key, { pos: { x: post.x + 1.5, y: post.y, z: post.z + 1.5, yaw: post.yaw }, name, look: 'captain', health: 130, tag: 'target' }));
            S.temp(M, Npc.guard(S.game, site.key, { pos: { x: post.x - 1.5, y: post.y, z: post.z - 1.5, yaw: post.yaw } }));
          },
          marker: (S, M) => M.t, check: (S, M) => !M.t.alive,
        }],
      };
    }
    if (kind === 'steal') {
      const camp = pick(P.camps);
      return {
        kind, title: 'Contract: A Heavy Box', desc: `Steal a strongbox from ${camp.name} and bring it to the board in ${home.name}.`, reward: 80, site: camp.key,
        steps: [
          { text: `Steal the strongbox from ${camp.name}`, setup: (S, M) => { M.box = S.temp(M, S.dropItem('strongbox', camp.poi.strongbox)); }, marker: () => camp.poi.strongbox, check: (S) => S.anyHas('strongbox') },
          { text: `Bring the strongbox to the notice board in ${home.name}`, marker: () => dropPoint, check: (S) => { const p = S.holder('strongbox'); return !!p && Math.hypot(p.pos.x - dropPoint.x, p.pos.z - dropPoint.z) < 4; }, done: (S) => S.takeItem('strongbox') },
        ],
      };
    }
    if (kind === 'rescue') {
      const camp = pick(P.camps);
      const name = pick(Npc.FIRST);
      return {
        kind, title: 'Contract: The Prisoner', desc: `Free ${name} from ${camp.name} and bring them to ${home.name}.`, reward: 90, site: camp.key,
        steps: [
          {
            text: `Free ${name} from the cage in ${camp.name}`, cage: () => camp,
            setup: (S, M) => {
              const c = camp.poi.cage;
              S.setCageDoor(camp, true);
              M.pr = S.temp(M, Npc.ally(S.game, { name, look: 'villager', pos: Object.assign({}, c.inside), tag: 'escort', health: 80 }));
            },
            marker: () => camp.poi.cage.front, check: (S) => S.cageOpen(camp), fail: (S, M) => !M.pr.alive ? `${name} was killed.` : null,
          },
          {
            text: `Escort ${name} to ${home.name}`,
            setup: (S, M) => { M.pr.controller = new AllyController(M.pr.id * 3 + 1, { mode: 'follow', leader: S.nearestPlayer(M.pr.pos).ch }); M.pr.fugitive = true; },
            marker: () => dropPoint,
            check: (S, M) => Math.hypot(M.pr.pos.x - dropPoint.x, M.pr.pos.z - dropPoint.z) < 8,
            fail: (S, M) => !M.pr.alive ? `${name} was killed.` : null,
            done: (S, M) => { M.pr.fugitive = false; M.pr.controller = new AllyController(1, { mode: 'stand', post: Object.assign({}, M.pr.pos) }); },
          },
        ],
      };
    }
    // courier: a sealed letter to someone in another village, against the clock
    const to = pick(P.villages.filter((v) => v !== board)), name = pick(Npc.FIRST), door = pick(to.poi.doors);
    const dist = Math.hypot(to.x - home.x, to.z - home.z), limit = Math.round(40 + dist / 3.2);
    return {
      kind, title: 'Contract: Swift Delivery', desc: `Deliver a sealed letter to ${name} in ${to.name} within ${limit} seconds.`, reward: 50 + Math.round(dist / 6), site: to.key,
      steps: [{
        text: `Deliver the letter to ${name} in ${to.name}`, hint: 'Rooftops are faster than roads.',
        setup: (S, M) => {
          if (!S.anyHas('letter')) S.giveFirst([['letter', 1]]);
          M.r = S.temp(M, Npc.ally(S.game, { name, look: 'villager', role: 'villager', team: 3, pos: Object.assign({}, door) }));
          M.deadline = S.game.time + limit;
        },
        marker: (S, M) => M.r, talk: (S, M) => M.r,
        timer: (S, M) => M.deadline - S.game.time,
        check: (S, M) => M.talked === M.r && S.anyHas('letter'),
        fail: (S, M) => S.game.time > M.deadline ? 'Too slow: the letter is worthless now.' : !M.r.alive ? 'The recipient is dead.' : null,
        done: (S) => S.takeItem('letter'),
      }],
    };
  },
};
