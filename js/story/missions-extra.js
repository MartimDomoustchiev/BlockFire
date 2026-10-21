/* ============================================================
 * More of the campaign: four chapters added between the five of
 * missions.js (the director puts them in order; missions-more.js adds nine
 * more), and two more kinds of contract. Same step format as missions.js,
 * plus "use" targets:
 *
 *   S.addUse(M, { at, text, time, run(S, M, ch) })
 *     a thing you press E on for `time` seconds (a strongbox, a bell rope,
 *     a grain sack, a brazier). It stands where the plan puts it, and is
 *     cleared with its step if that step is retried.
 * ============================================================ */
const STORY_NEW_CHAPTERS = {
  // ------------------------------------------------------------------ Toll Roads
  tollRoads: {
    key: 'toll', title: 'Toll Roads',
    intro: [
      ['Old Wren', 'Vale\'s tollmen stamp a ticket on every cart that crosses his roads. The tickets are how he counts what he takes.'],
      ['Old Wren', 'Each camp keeps a strongbox of them. Take one from every camp. Without the tickets, no cart on the island can prove what it owes.'],
    ],
    steps: [
      { text: 'Reach {C1}', marker: (S) => S.places.C1, check: (S) => S.near(S.places.C1, 40) },
      {
        text: 'Take a toll ticket from the strongbox in {C1}', hint: 'Walk up to the strongbox and hold still while you open it (E).',
        marker: (S) => S.places.C1.poi.strongbox,
        setup: (S, M) => S.addUse(M, { at: S.places.C1.poi.strongbox, text: 'Take a toll ticket', time: 2.2, run: (S, M, ch) => S.giveTo(ch, [['toll_ticket', 1]]) }),
        check: (S) => S.totalCount('toll_ticket') >= 1,
      },
      {
        text: 'Take a toll ticket from the strongbox in {C2}', hint: 'Camps two and three are farther in; the roads between them are patrolled.',
        marker: (S) => S.places.C2.poi.strongbox,
        setup: (S, M) => S.addUse(M, { at: S.places.C2.poi.strongbox, text: 'Take a toll ticket', time: 2.2, run: (S, M, ch) => S.giveTo(ch, [['toll_ticket', 1]]) }),
        check: (S) => S.totalCount('toll_ticket') >= 2,
      },
      {
        text: 'Take a toll ticket from the strongbox in {C3}', hint: 'The last camp has the most guards on its posts.',
        marker: (S) => S.places.C3.poi.strongbox,
        setup: (S, M) => S.addUse(M, { at: S.places.C3.poi.strongbox, text: 'Take a toll ticket', time: 2.2, run: (S, M, ch) => S.giveTo(ch, [['toll_ticket', 1]]) }),
        check: (S) => S.totalCount('toll_ticket') >= 3,
        done: (S) => { S.flags.tollsTaken = true; },
      },
      {
        text: 'Return the tickets to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor,
        check: (S, M) => M.talked === S.mentor && S.totalCount('toll_ticket') >= 3,
        done: (S) => S.takeItem('toll_ticket'),
      },
    ],
    outro: [
      ['Old Wren', 'Three tickets, three camps, and not one alarm. The tollmen will be hunting for a ledger that does not exist.'],
      ['Old Wren', 'Now the Order has the carts\' own route cards. A woman in {V3} says she can tell us who pays the Tollmen\'s wages. Hear her out.'],
    ],
    reward: (S) => { S.addSilver(60); S.giveAll([['arrow', 8], ['cloth_scrap', 3]]); },
  },

  // ------------------------------------------------------------------ The Granary
  granary: {
    key: 'granary', title: 'The Granary',
    intro: [
      ['Old Wren', 'The tollmen buy grain from the north farms at a tenth of its price and sell it back to the villages at ten times that.'],
      ['Old Wren', 'Their grain sits in the tall stalls on the square of {V4}. Spoil it. Quietly. A village that is not panicking does not need saving.'],
    ],
    steps: [
      { text: 'Reach {V4}', marker: (S) => S.places.V4, check: (S) => S.near(S.places.V4, 24) },
      {
        text: 'Spoil the three grain sacks in {V4}', hint: 'Open each sack with E and keep still for a moment. An alarm in the square ends the attempt.',
        marker: (S, M) => S.nearestUse(M),
        setup: (S, M) => {
          M.spoiled = 0;
          const fronts = S.places.V4.poi.stalls.length ? S.places.V4.poi.stalls.map((s) => s.front) : S.places.V4.poi.spots;
          for (let i = 0; i < 3; i++) {
            S.addUse(M, { at: fronts[i % fronts.length], text: 'Spoil the grain', time: 2.2, run: (S, M) => { M.spoiled++; } });
          }
        },
        check: (S, M) => M.spoiled >= 3,
        fail: (S) => (S.alarmUntil(S.places.V4.key) > S.game.time ? 'The square is on alert.' : null),
        checkpoint: (S) => S.places.V4.poi.spots[0],
        done: (S) => { if (!S.chapterAlarmed()) S.flags.granaryClean = true; },
      },
      {
        text: 'Get clear of {V4}', hint: 'Lose anyone chasing you, and get out of the village.',
        marker: (S) => S.places.V1.poi.well,
        check: (S, M) => { M.clear = S.anyCombat() || S.near(S.places.V4, 30) ? 0 : (M.clear || 0) + 0.1; return M.clear > 5; },
      },
      { text: 'Return to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor, check: (S, M) => M.talked === S.mentor },
    ],
    outro: [
      ['Old Wren', 'The sacks are split and the square is picking up the grain. Vale will be counting that loss tonight.'],
      ['Old Wren', 'And he will answer the way he always does: with arrests. Three of ours already sit in the camp cages.'],
    ],
    reward: (S) => { S.addSilver(80); S.giveAll([['cloth_scrap', 4], ['leather_strip', 2]]); },
  },

  // ------------------------------------------------------------------ Bells of Ironwood
  bells: {
    key: 'bells', title: 'Bells of Ironwood',
    intro: [
      ['Old Wren', 'Vale will send his raiders again, and next time they will not all come down one road. The villages must hear them coming.'],
      ['Old Wren', 'Ring the bells in {V2}, {V3} and {V4}. Every tower has a rope at the top. A village that hears its bell runs for the woods, and runs early.'],
    ],
    steps: [
      {
        text: 'Climb the bell tower of {V2}', hint: 'Climb the tower wall. The bell rope hangs at the top.',
        setup: (S, M) => { M.rung = new Set(); },
        marker: (S) => S.places.V2.poi.tower.top, check: (S) => S.near(S.places.V2.poi.tower.top, 3, 2),
      },
      {
        text: 'Ring the bell in {V2}', hint: 'Press E beside the rope and hold still.',
        marker: (S) => S.places.V2.poi.tower.top,
        setup: (S, M) => S.addUse(M, { at: S.places.V2.poi.tower.top, text: 'Ring the bell', time: 1.6, run: (S, M) => S.ringBell(M, 'V2') }),
        check: (S, M) => M.rung.has('V2'),
        checkpoint: (S) => S.places.V2.poi.tower.base,
      },
      {
        text: 'Ring the bell in {V3}', marker: (S) => S.places.V3.poi.tower.top,
        setup: (S, M) => S.addUse(M, { at: S.places.V3.poi.tower.top, text: 'Ring the bell', time: 1.6, run: (S, M) => S.ringBell(M, 'V3') }),
        check: (S, M) => M.rung.has('V3'),
        fail: (S) => (S.alarmUntil(S.places.V3.key) > S.game.time ? 'The square of {V3} is on alert.' : null),
        checkpoint: (S) => S.places.V3.poi.tower.base,
      },
      {
        text: 'Ring the bell in {V4}', marker: (S) => S.places.V4.poi.tower.top,
        setup: (S, M) => S.addUse(M, { at: S.places.V4.poi.tower.top, text: 'Ring the bell', time: 1.6, run: (S, M) => S.ringBell(M, 'V4') }),
        check: (S, M) => M.rung.has('V4'),
        fail: (S) => (S.alarmUntil(S.places.V4.key) > S.game.time ? 'The square of {V4} is on alert.' : null),
        checkpoint: (S) => S.places.V4.poi.tower.base,
        done: (S) => { if (!S.chapterAlarmed()) S.flags.bellsClean = true; },
      },
      {
        text: 'Get out of {V4} before the village wakes', hint: 'Anyone chasing you can wait. Get clear of the walls first.',
        marker: (S) => S.places.V1.poi.well,
        check: (S, M) => { M.clear = S.anyCombat() || S.near(S.places.V4, 30) ? 0 : (M.clear || 0) + 0.1; return M.clear > 4; },
      },
      { text: 'Return to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor, check: (S, M) => M.talked === S.mentor },
    ],
    outro: [
      ['Old Wren', 'Three bells, and the villages are awake. The tollmen will find empty houses at dawn.'],
      ['Old Wren', 'The ledger you stole has pages missing. Fitch tore them out and hid them before he ran. Ida thinks they name every wage Vale pays.'],
    ],
    reward: (S) => { S.addSilver(90); S.giveAll([['smoke_bomb', 2], ['bandage', 2]]); },
  },

  // ------------------------------------------------------------------ Night Watch
  nightWatch: {
    key: 'night', title: 'Night Watch',
    intro: [
      ['Old Wren', 'Vale\'s marksmen watch from the keep walls. Their signal braziers tell the Tollmen when to close the gates.'],
      ['Old Wren', 'Light the braziers yourself. Let the watch look at fire on their own walls, and not at the roads below.'],
    ],
    steps: [
      { text: 'Go to {keep}', marker: (S) => S.places.keep, check: (S) => S.near(S.places.keep, 45) },
      {
        text: 'Light the three signal braziers on the keep walls', hint: 'Climb the wall, or go up the stairs inside the gate. The braziers stand on the outer edge of the wall walk, on the three sides away from the gate. Each takes a moment.',
        marker: (S, M) => S.nearestUse(M),
        setup: (S, M) => {
          M.lit = 0;
          StoryKit.wallSpots(S, 3).forEach((p) => S.addUse(M, { at: p, text: 'Light the brazier', time: 2.0, run: (S, M) => { M.lit++; } }));
        },
        check: (S, M) => M.lit >= 3,
        fail: (S) => (S.alarmUntil(S.places.keep.key) > S.game.time ? 'The keep is on alert.' : null),
        checkpoint: (S) => S.places.keep.poi.gate.out,
      },
      {
        text: 'Get clear of {keep}', hint: 'Walk out of the walls\' shadow and lose anyone following you.',
        marker: (S) => S.places.V1.poi.well,
        check: (S, M) => { M.clear = S.anyCombat() || S.near(S.places.keep, 40) ? 0 : (M.clear || 0) + 0.1; return M.clear > 5; },
      },
      { text: 'Return to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor, check: (S, M) => M.talked === S.mentor },
    ],
    outro: [
      ['Old Wren', 'The braziers burn. Vale\'s marksmen are looking at their own walls now, and their captains are shouting.'],
      ['Old Wren', 'But the marksmen are still up there with their muskets, and they have to go before anyone goes in.'],
    ],
    reward: (S) => { S.addSilver(120); S.giveAll([['iron_ingot', 2], ['cloth_scrap', 2], ['leather_strip', 2]]); },
  },
};

/**
 * Two more contracts. Contracts.make calls these by kind (see missions.js).
 */
const STORY_NEW_CONTRACTS = {
  /** Three guards at a camp's posts: a bounty for the board. */
  bounty(S, board, rng) {
    const P = S.plan, pick = (a) => a[Math.floor(rng.next() * a.length)];
    const camp = pick(P.camps), home = board.kind === 'village' ? board : P.hideout;
    const dropPoint = board.kind === 'village' ? board.poi.board : P.hideout.poi.board;
    const reward = 110 + Math.floor(rng.next() * 30);
    return {
      kind: 'bounty', title: 'Contract: Three Tollmen', desc: `Take down three Tollmen at ${camp.name}, then report to the board in ${home.name}.`, reward, site: camp.key,
      steps: [{
        text: `Take down the three Tollmen at ${camp.name}`,
        setup: (S, M) => {
          const posts = camp.poi.posts.filter((p) => !p.marksman).slice(0, 3);
          M.targets = [];
          for (let i = 0; i < 3; i++) {
            const p = posts[i % posts.length];
            M.targets.push(S.temp(M, Npc.guard(S.game, camp.key, { pos: { x: p.x + i * 1.2, y: p.y, z: p.z + i * 0.8, yaw: p.yaw }, name: 'Tollman', tag: 'target' })));
          }
        },
        marker: (S, M) => M.targets.find((t) => t.alive) || camp.poi.strongbox,
        check: (S, M) => M.targets.every((t) => !t.alive),
      }, {
        text: `Report to the notice board in ${home.name}`, marker: () => dropPoint,
        check: (S) => { const p = S.nearestPlayer(dropPoint); return !!p && p.d < 6; },
      }],
    };
  },

  /** Two letters lost in a village: find them and bring them to the board. */
  collect(S, board, rng) {
    const P = S.plan, pick = (a) => a[Math.floor(rng.next() * a.length)];
    const village = pick(P.villages.filter((v) => v !== board)), home = board.kind === 'village' ? board : P.hideout;
    const dropPoint = board.kind === 'village' ? board.poi.board : P.hideout.poi.board;
    const reward = 70 + Math.floor(rng.next() * 20);
    return {
      kind: 'collect', title: 'Contract: Lost Letters', desc: `Find two letters the tollmen lost in ${village.name} and bring them to the board in ${home.name}.`, reward, site: village.key,
      steps: [{
        text: `Find two sealed letters in ${village.name}`, hint: 'They were dropped near the well and by the notice board.',
        setup: (S, M) => {
          const spots = [village.poi.spots[0], village.poi.board || village.poi.spots[Math.min(2, village.poi.spots.length - 1)]];
          for (const p of spots) S.temp(M, S.dropItem('letter', p));
        },
        marker: (S) => village.poi.spots[0],
        check: (S) => S.totalCount('letter') >= 2,
      }, {
        text: `Bring the letters to the board in ${home.name}`, marker: () => dropPoint,
        check: (S) => { const p = S.nearestPlayer(dropPoint); return !!p && p.d < 6 && S.totalCount('letter') >= 2; },
        done: (S) => S.takeItem('letter'),
      }],
    };
  },
};
