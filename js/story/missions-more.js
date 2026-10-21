/* ============================================================
 * Nine more chapters, so the campaign has eighteen. The director
 * (story.js) puts them in order between the chapters of missions.js
 * and missions-extra.js. Same step format as missions.js; the
 * "use" targets come from missions-extra.js (S.addUse).
 *
 *   IV    Iron for the Forge   crates in village houses, light Ida's forge
 *   VI    The Informant        overhear two Tollmen from the hay
 *   VIII  The Prisoners        three cages, three freed villagers walk home
 *   X     The Pickpocket       lift a key from Quartermaster Pell
 *   XI    Vale's Answer        break three columns of Tollmen on the road
 *   XIII  The Missing Pages    a paper chase through bushes and hay
 *   XV    Marksmen of the Keep three musketeers on the walls
 *   XVI   Rally the Villages   four elders, four small favours
 *   XVII  The Seal             the Magistrate's seal, and a forged order
 * ============================================================ */

/** Small builders and point finders the nine chapters share. */
const StoryKit = {
  /** The inside of the n-th house of a village (a floor point; falls back to the square). */
  houseOf(S, key, n) { const p = S.places[key].poi; return p.inside[n] || p.inside[0] || p.spots[0]; },
  /** Yaw that looks from `from` towards `to`. */
  face(from, to) { return Math.atan2(-(to.x - from.x), -(to.z - from.z)); },
  at(p, yaw) { return Object.assign({}, p, { yaw }); },

  /** A step: get away from a site and shake off anyone chasing you. */
  clear(siteOf, r, secs, text, hint) {
    return {
      text, hint: hint || 'Lose anyone chasing you and get out of sight of the walls.',
      marker: (S) => S.plan.hideout.poi.entrance,
      setup: (S, M) => { M.clear = 0; },
      check: (S, M) => { M.clear = S.anyCombat() || S.near(siteOf(S), r) ? 0 : (M.clear || 0) + 0.1; return M.clear > secs; },
    };
  },
  /** The usual last step: back to Old Wren. */
  report(text, extra) {
    return Object.assign({ text: text || 'Return to Old Wren', marker: (S) => S.mentor, talk: (S) => S.mentor, check: (S, M) => M.talked === S.mentor }, extra || {});
  },
  /** A road point about `dist` blocks out from site `to` on the way from site `from`. */
  roadPoint(S, from, to, dist) {
    const pts = S.routeBetween(from, to);
    for (const p of pts) if (Math.hypot(p.x - to.x, p.z - to.z) <= dist) return p;
    return pts[pts.length - 1];
  },
  /**
   * `n` places on the keep's wall walk, on the outer layer (off the guards' patrol line, never in a merlon), on the sides
   * farthest from the gate: where the braziers burn and the marksmen stand. Each is { x, y, z, yaw } (yaw looks outwards).
   */
  wallSpots(S, n) {
    const k = S.places.keep, P = k.poi, g = P.gate.out;
    const mids = P.walls.map((run) => ({ x: (run[0].x + run[1].x) / 2, y: run[0].y, z: (run[0].z + run[1].z) / 2 }))
      .sort((a, b) => Math.hypot(b.x - g.x, b.z - g.z) - Math.hypot(a.x - g.x, a.z - g.z));
    return mids.slice(0, n).map((m) => {
      const dx = m.x - k.x, dz = m.z - k.z, ox = Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) : 0, oz = ox ? 0 : Math.sign(dz);
      let x = Math.floor(m.x + ox), z = Math.floor(m.z + oz);
      if ((x + z) % 2 === 0) { x += oz ? 1 : 0; z += ox ? 1 : 0; }              // a merlon stands there: the next block along the wall is open
      return { x: x + 0.5, y: m.y, z: z + 0.5, yaw: Math.atan2(-ox, -oz) };
    });
  },
  /** A village elder: someone to talk to (not an innocent: nothing is lost if the Order's own hand hurts them). */
  elder(S, M, site, name, at) {
    return S.keep(M, Npc.ally(S.game, { name, look: 'clerk', role: 'villager', team: 3, tag: 'elder', pos: StoryKit.at(at, StoryKit.face(at, S.places[site])), health: 80 }));
  },
};

const STORY_MORE_CHAPTERS = (() => {
  const K = StoryKit;

  /** One of the three columns of Vale's Answer: Tollmen spawn on the road to Brindle once a player is near, and march on the village. */
  const column = (n, count, text, opts) => ({
    text: (S, M) => text + ' (' + (M['col' + n] ? M['col' + n].filter((c) => c.alive).length : count) + ' left)',
    hint: 'They march down the road from the keep. Meet them in the open, or fight them at the well. Smoke breaks up a charge.',
    lines: opts.lines,
    setup: (S, M) => { M['col' + n] = null; M.colAt = K.roadPoint(S, S.places.keep, S.places.V1, 36); },
    marker: (S, M) => (M['col' + n] ? M['col' + n].find((c) => c.alive) || S.places.V1 : M.colAt),
    check: (S, M) => {
      let col = M['col' + n];
      if (!col) {
        if (!S.near(M.colAt, 64)) return false;            // the column appears when somebody can see the road
        const V = S.places.V1, p = M.colAt, goal = V.poi.spots[0];
        col = M['col' + n] = [];
        for (let i = 0; i < count; i++) {
          const a = i / count * Math.PI * 2, captain = !!opts.captain && i === 0;
          const c = S.temp(M, Npc.guard(S.game, V.key, {
            pos: { x: p.x + Math.cos(a) * 1.6, y: p.y, z: p.z + Math.sin(a) * 1.6, yaw: K.face(p, V) },
            name: captain ? 'Raid Captain' : 'Tollman Raider', look: captain ? 'captain' : 'guard', health: captain ? CONFIG.STORY.GUARD.CAPTAIN_HEALTH : 95,
          }));
          c.controller.startSearch(S.game, c, new THREE.Vector3(goal.x, goal.y, goal.z), 90);
          col.push(c);
        }
      }
      return col.every((c) => !c.alive);
    },
    checkpoint: (S) => S.places.V1.poi.spots[0],
    done: opts.done,
  });

  return {
    // ------------------------------------------------------------------ IV Iron for the Forge
    iron: {
      key: 'iron', title: 'Iron for the Forge',
      intro: [
        ['Old Wren', 'Ida is back at her forge, and the forge is cold. The Tollmen carried every bar of iron off the island.'],
        ['Old Wren', 'Speak to her, then fetch what she asks for. Your gear will be the better for it.'],
      ],
      steps: [
        { text: 'Speak to Ida at her forge', hint: 'She works at the table at the back of the hideout.', marker: (S) => S.shopkeeper, talk: (S) => S.shopkeeper, check: (S, M) => M.talked === S.shopkeeper },
        ...['V1', 'V2', 'V3'].map((k, i) => ({
          text: 'Find the confiscated iron in {' + k + '}', hint: 'The Tollmen stacked it inside a house. Go in by the door that faces the square and press E at the crate.',
          lines: i === 0 ? [['Ida Marrow', 'Three crates of iron bars, stacked in the houses of {V1}, {V2} and {V3}. The Tollmen call it "confiscated". Bring it all to me.']] : [],
          marker: (S) => K.houseOf(S, k, 0),
          setup: (S, M) => S.addUse(M, { at: K.houseOf(S, k, 0), text: 'Haul out the iron', time: 2.4, run: (S, M, ch) => S.giveTo(ch, [['iron_crate', 1]]) }),
          check: (S) => S.totalCount('iron_crate') >= i + 1,
          checkpoint: (S) => S.places[k].poi.spots[0],
        })),
        {
          text: 'Bring the three crates to Ida', marker: (S) => S.shopkeeper, talk: (S) => S.shopkeeper,
          check: (S, M) => M.talked === S.shopkeeper && S.totalCount('iron_crate') >= 3,
          done: (S) => S.takeItem('iron_crate'),
        },
        {
          text: 'Light the forge', hint: 'Press E at the forge and hold still while the coals catch.',
          lines: [['Ida Marrow', 'Good iron. Now light the forge for me. I never could abide a cold hearth.']],
          marker: (S) => S.plan.hideout.poi.quartermaster,
          setup: (S, M) => { M.lit = false; S.addUse(M, { at: S.plan.hideout.poi.quartermaster, text: 'Light Ida\'s forge', time: 2.4, run: (S, M) => { M.lit = true; } }); },
          check: (S, M) => M.lit,
        },
        K.report(),
      ],
      outro: [
        ['Ida Marrow', 'Fire and iron. Bring me silver and scraps and I will make that gear of yours better than it ever was.'],
        ['Old Wren', 'Good. Now the road tolls. Vale\'s tickets will tell us where the money goes.'],
      ],
      reward: (S) => { S.addSilver(60); S.giveAll([['iron_ingot', 4], ['leather_strip', 2], ['cloth_scrap', 2]]); },
    },

    // ------------------------------------------------------------------ VI The Informant
    informant: {
      key: 'informant', title: 'The Informant',
      intro: [
        ['Old Wren', 'A woman in {V3} named Edda keeps the baker\'s books, and the Tollmen\'s too. She says she can tell us who pays their wages.'],
        ['Old Wren', 'She will not say it in the open. Find her, then find a quiet place to listen.'],
      ],
      steps: [
        { text: 'Go to {V3}', marker: (S) => S.places.V3, check: (S) => S.near(S.places.V3, 24) },
        {
          text: 'Speak to Edda in the square', hint: 'She waits by the ring of stones round the well. Walk up to her and press E.',
          setup: (S, M) => {
            const v = S.places.V3, at = v.poi.spots[1];
            M.edda = S.keep(M, Npc.ally(S.game, { name: 'Edda', look: 'villager', role: 'villager', team: 3, tag: 'target', pos: K.at(at, K.face(at, v)), health: 60 }));
          },
          marker: (S, M) => M.edda, talk: (S, M) => M.edda, check: (S, M) => M.talked === M.edda,
          fail: (S, M) => (!M.edda.alive ? 'Edda is dead.' : null),
        },
        {
          text: (S, M) => 'Hide in the hay behind the houses and listen' + (M.heard > 0.5 ? ' (' + Math.min(10, Math.floor(M.heard)) + '/10)' : ''),
          hint: 'Go round behind the houses, jump into the hay and stay hidden. If either of them sees you, the meeting is over.',
          lines: [['Edda', 'The Sergeant meets his paymaster on the square every evening. Get into the hay behind the houses. Keep still, and keep quiet.']],
          setup: (S, M) => {
            const v = S.places.V3, hides = v.poi.hides, hay = hides[hides.length - 1];     // the last hides of a village are its hay piles
            M.hay = hay; M.heard = 0; M.said = 0;
            const ring = v.poi.spots.slice().sort((a, b) => Math.hypot(a.x - hay.x, a.z - hay.z) - Math.hypot(b.x - hay.x, b.z - hay.z));
            const a = ring[0], b = ring[1];
            M.talkers = [
              S.temp(M, Npc.guard(S.game, v.key, { pos: K.at(a, K.face(a, b)), name: 'Sergeant Orrin', look: 'captain', health: 110 })),
              S.temp(M, Npc.guard(S.game, v.key, { pos: K.at(b, K.face(b, a)), name: 'Paymaster Quill', look: 'clerk', health: 80 })),
            ];
          },
          marker: (S, M) => M.hay,
          check: (S, M) => {
            const hid = S.players().some((p) => p.alive && p.hidden && Math.hypot(p.pos.x - M.hay.x, p.pos.z - M.hay.z) < 3.5);
            M.heard = hid ? M.heard + 0.1 : Math.max(0, M.heard - 0.05);
            if (M.heard >= 3 && M.said < 1) { M.said = 1; S.lines([['Sergeant Orrin', 'Another grain wagon short. The Magistrate counts every sack twice.'], ['Paymaster Quill', 'He pays you in grain because grain does not ask questions.']]); }
            if (M.heard >= 6 && M.said < 2) { M.said = 2; S.lines([['Paymaster Quill', 'The wall marksmen are paid by the head, and the braziers on the keep walls tell the gates when to close.'], ['Sergeant Orrin', 'And Brask?'], ['Paymaster Quill', 'Brask answers to the Magistrate alone. Nobody else knows where he sleeps.']]); }
            if (M.heard >= 9 && M.said < 3) { M.said = 3; S.lines([['Sergeant Orrin', 'Right. Back to the posts, before somebody wonders.']]); }
            return M.heard >= 10;
          },
          fail: (S, M) => {
            if (M.talkers.some((c) => !c.alive || ['combat', 'search', 'investigate'].includes(c.controller.state))) return 'The Tollmen noticed someone listening.';
            return S.alarmUntil(S.places.V3.key) > S.game.time ? 'The square is on alert.' : null;
          },
          checkpoint: (S) => S.places.V3.poi.spots[0],
          done: (S) => { if (!S.chap.spotted) S.flags.informantClean = true; },
        },
        {
          text: 'Tell Edda what you heard', marker: (S, M) => M.edda, talk: (S, M) => M.edda, check: (S, M) => M.talked === M.edda,
          done: (S) => S.lines([['Edda', 'Then it is true. I will keep the baker\'s books honest, and keep my ears open. Go safely.']]),
        },
        K.report(),
      ],
      outro: [
        ['Old Wren', 'Vale pays his Tollmen in grain as much as in silver. Spoil his grain and half his men go hungry.'],
      ],
      reward: (S) => { S.addSilver(70); S.giveAll([['arrow', 10], ['smoke_bomb', 2]]); },
    },

    // ------------------------------------------------------------------ VIII The Prisoners
    prisoners: {
      key: 'prisoners', title: 'The Prisoners',
      intro: [
        ['Old Wren', 'Vale answers every loss the same way: arrests. Tom, Nell and Hob are in the camp cages, held for the spoiled grain.'],
        ['Old Wren', 'Pick the locks and they will make for the hideout on their own. Any guard who sees them will not be kind.'],
      ],
      steps: [
        ...[['C1', 'Tom'], ['C2', 'Nell'], ['C3', 'Hob']].map(([k, name], i) => ({
          text: 'Free ' + name + ' from the cage in {' + k + '}', hint: 'Press E at the cage door and keep still while you pick the lock. The guard at the cage is the one to watch.',
          marker: (S) => S.places[k].poi.cage.front,
          setup: (S, M) => {
            const site = S.places[k], c = site.poi.cage;
            S.setCageDoor(site, true);
            M.pr = M.pr || [];
            M.pr[i] = S.keep(M, Npc.ally(S.game, { name, look: 'villager', role: 'villager', team: 3, tag: 'escort', pos: K.at(c.inside, K.face(c.inside, c.front)), health: 80 }));
          },
          cage: (S) => S.places[k],
          check: (S) => S.cageOpen(S.places[k]),
          fail: (S, M) => (M.pr[i] && !M.pr[i].alive ? name + ' was killed.' : null),
          checkpoint: (S) => S.places[k].poi.gates[0].out,
          done: (S, M) => {
            const p = M.pr[i];
            p.fugitive = true;                                // the guards will go for a runaway
            p.controller = new AllyController(p.id * 5 + 7, { mode: 'route', points: S.routeBetween(S.places[k], S.places.hideout), pace: 0.8 });
            S.lines([[name, 'Thank you! I will run for the Lantern Ruin and not look back.']]);
          },
        })),
        {
          text: (S, M) => 'Watch the roads: the freed villagers are walking to the hideout (' + M.pr.filter((p) => p.alive && p.controller.done).length + '/3 home)',
          hint: 'Wait at the hideout, or go and clear the road ahead of them. Guards will cut them down if they see them.',
          marker: (S) => S.plan.hideout.poi.entrance,
          check: (S, M) => M.pr.every((p) => !p.alive || p.controller.done),
          fail: (S, M) => (M.pr.every((p) => !p.alive) ? 'None of the prisoners made it home.' : null),
          retry: 0,
          done: (S, M) => {
            const home = M.pr.filter((p) => p.alive);
            S.flags.prisonersFreed = home.length;
            for (const p of home) { p.fugitive = false; p.controller = new AllyController(p.id * 5 + 8, { mode: 'stand', post: Object.assign({}, p.pos) }); }
          },
        },
        K.report(),
      ],
      outro: [
        ['Old Wren', 'They are home, and they will talk. Every village will know who opened the cages.'],
        ['Old Wren', 'The cage keys all came from one man: Captain Brask Hollen. Without him, the cages stay empty.'],
      ],
      reward: (S) => { S.addSilver(40 + 30 * (S.flags.prisonersFreed | 0)); S.giveAll([['bandage', 3]]); },
    },

    // ------------------------------------------------------------------ X The Pickpocket
    pickpocket: {
      key: 'pickpocket', title: 'The Pickpocket',
      intro: [
        ['Old Wren', 'Quartermaster Pell carries the keys to every lockbox Vale owns. He is in {V2} today, counting the market tolls.'],
        ['Old Wren', 'Do not kill him: a dead quartermaster means a changed lock. Walk up behind him, relieve him of the key, and walk away.'],
      ],
      steps: [
        { text: 'Go to {V2}', marker: (S) => S.places.V2, check: (S) => S.near(S.places.V2, 24) },
        {
          text: 'Find Quartermaster Pell in the square', hint: 'He stands by the stones at the edge of the square, in a green coat, with his back to the crowd.',
          setup: (S, M) => {
            const v = S.places.V2, at = v.poi.spots[3];
            M.pell = S.keep(M, Npc.guard(S.game, v.key, { pos: K.at(at, K.face(at, v)), name: 'Quartermaster Pell', look: 'clerk', health: 90 }));
          },
          marker: (S, M) => M.pell, check: (S, M) => S.near(M.pell.pos, 22),
        },
        {
          text: 'Lift the key from Pell\'s belt', hint: 'Sneak up behind him (hold C), press E when you are close and keep still. If he sees you, the lock is changed.',
          setup: (S, M) => { const pell = M.pell; S.addUse(M, { get at() { return pell.pos; }, text: 'Lift the key', time: 2.8, run: (S, M, ch) => S.giveTo(ch, [['pell_key', 1]]) }); },
          marker: (S, M) => M.pell,
          check: (S) => S.totalCount('pell_key') >= 1,
          fail: (S, M) => {
            if (!M.pell.alive) return 'Pell is dead: the locks will be changed.';
            if (['combat', 'search', 'investigate'].includes(M.pell.controller.state)) return 'Pell saw you.';
            return S.alarmUntil(S.places.V2.key) > S.game.time ? 'The square is on alert.' : null;
          },
          checkpoint: (S) => S.places.V2.poi.spots[0],
          done: (S) => { if (!S.chapterAlarmed()) S.flags.pellClean = true; },
        },
        K.clear((S) => S.places.V2, 30, 4, 'Slip away from {V2} unseen'),
        K.report(),
      ],
      outro: [
        ['Old Wren', 'The key to every lockbox Vale owns, and not a mark on Pell. Keep it close.'],
        ['Old Wren', 'And now trouble: a rider from {V1} says Vale has sent his reserve out of the keep.'],
      ],
      reward: (S) => { S.addSilver(80); S.giveAll([['smoke_bomb', 2], ['bandage', 2]]); },
    },

    // ------------------------------------------------------------------ XI Vale's Answer
    answer: {
      key: 'answer', title: 'Vale\'s Answer',
      intro: [
        ['Old Wren', 'Vale\'s answer to the Captain\'s death is his reserve: three columns of Tollmen marching on {V1}, the village nearest our door.'],
        ['Old Wren', 'If they dig in there, the Order is cut off from the island. Meet them on the road and break them one column at a time.'],
      ],
      steps: [
        column(1, 3, 'Break the first column on the road to {V1}', { lines: [] }),
        column(2, 4, 'Break the second column', { lines: [['Old Wren', 'A second column on the same road! Do not let them reach the square.']] }),
        column(3, 5, 'Break the last column and its captain', {
          lines: [['Old Wren', 'The Raid Captain leads the third. Take him down and the rest will scatter.']], captain: true,
          done: (S) => { if (!S.chap.hurt) S.flags.columnsUnhurt = true; },
        }),
        K.report(),
      ],
      outro: [
        ['Old Wren', 'Three columns broken on one road. Vale will think twice before garrisoning anything.'],
        ['Old Wren', 'But he will keep trying, and the villages cannot see his men coming. Tonight they will hear them: we ring the bells.'],
      ],
      reward: (S) => { S.addSilver(120); S.giveAll([['bandage', 3], ['arrow', 12], ['smoke_bomb', 2]]); },
    },

    // ------------------------------------------------------------------ XIII The Missing Pages
    pages: {
      key: 'pages', title: 'The Missing Pages',
      intro: [
        ['Ida Marrow', 'I have been reading the ledger you stole. Three pages are torn out, and they are the ones that matter.'],
        ['Old Wren', 'Fitch hid them before he ran, where no Tollman would put his hand: in the bushes outside {C1}, behind a house in {V2} and behind one in {V3}.'],
      ],
      steps: [
        ...[['V2', 0, 'behind the houses of {V2}', 'Fitch always did his sums behind the houses.'],
          ['C1', 1, 'in the bushes outside the palisade of {C1}', 'Walk round the palisade. The bushes are outside the walls.'],
          ['V3', 0, 'behind a house in {V3}', 'A bush against a house wall. Walk into it.']].map(([k, h, where, tip], i) => ({
          text: 'Find the torn page ' + where, hint: tip + ' Walk into the bush to pick the page up.',
          marker: (S) => S.places[k].poi.hides[Math.min(h, S.places[k].poi.hides.length - 1)],
          setup: (S, M) => { const hs = S.places[k].poi.hides; S.keep(M, S.dropItem('ledger_page', hs[Math.min(h, hs.length - 1)])); },
          check: (S) => S.totalCount('ledger_page') >= i + 1,
          checkpoint: (S) => (k === 'C1' ? S.places.C1.poi.gates[0].out : S.places[k].poi.spots[0]),
          done: (S) => S.lines([['Old Wren', ['"Brask: two hundred in chains, forged by the smith." Page one.', '"The Magistrate pays the wall marksmen by the head." Page two.', '"Signal braziers on the walls: light at dusk, douse at dawn." Page three.'][i]]]),
        })),
        {
          text: 'Show the pages to Ida', marker: (S) => S.shopkeeper, talk: (S) => S.shopkeeper,
          check: (S, M) => M.talked === S.shopkeeper && S.totalCount('ledger_page') >= 3,
          done: (S) => S.takeItem('ledger_page'),
        },
        K.report('Return to Old Wren', { lines: [['Ida Marrow', 'Names, dates, sums. Every wage Vale pays, and every wall marksman who draws it. And the braziers on the keep walls, here, in his own hand.']] }),
      ],
      outro: [
        ['Old Wren', 'Then we start with the braziers. A watch that looks at its own walls does not look at the roads below.'],
      ],
      reward: (S) => { S.addSilver(100); S.giveAll([['cloth_scrap', 3], ['leather_strip', 2], ['iron_ingot', 1]]); },
    },

    // ------------------------------------------------------------------ XV Marksmen of the Keep
    marksmen: {
      key: 'marksmen', title: 'Marksmen of the Keep',
      intro: [
        ['Old Wren', 'The braziers burn, but the marksmen are still on the walls, and a musket carries a long way.'],
        ['Old Wren', 'Before anyone goes in, they have to go. Use the bow, use the high ground, and use the smoke.'],
      ],
      steps: [
        { text: 'Go to {keep}', marker: (S) => S.places.keep, check: (S) => S.near(S.places.keep, 55) },
        {
          text: (S, M) => 'Take down the marksmen on the walls of {keep} (' + M.marks.filter((c) => c.alive).length + ' left)',
          hint: 'They stand by the signal braziers on three sides of the wall, away from the gate. An arrow from behind cover, or a blade from behind them.',
          setup: (S, M) => {
            const k = S.places.keep;
            M.marks = K.wallSpots(S, 3).map((p) => S.temp(M, Npc.guard(S.game, k.key, { pos: p, marksman: true, name: 'Wall Marksman', health: 90 })));
          },
          marker: (S, M) => M.marks.find((c) => c.alive) || S.places.keep,
          check: (S, M) => M.marks.every((c) => !c.alive),
          checkpoint: (S) => S.places.keep.poi.gate.out,
          done: (S) => { if (!S.chap.hurt) S.flags.marksmenUnhurt = true; },
        },
        K.clear((S) => S.places.keep, 42, 5, 'Get clear of {keep}', 'The shots will have been heard inside. Lose anyone chasing you.'),
        K.report(),
      ],
      outro: [
        ['Old Wren', 'Three marksmen down and the walls are quiet. Vale will wonder who is next.'],
        ['Old Wren', 'Now the villages. When the Order moves on the keep, they must not stand in the way.'],
      ],
      reward: (S) => { S.addSilver(130); S.giveAll([['arrow', 16], ['smoke_bomb', 2], ['iron_ingot', 1]]); },
    },

    // ------------------------------------------------------------------ XVI Rally the Villages
    rally: {
      key: 'rally', title: 'Rally the Villages',
      intro: [
        ['Old Wren', 'An assault on the keep is not the work of one blade. The villages must bar their doors, light their lamps and stand behind us.'],
        ['Old Wren', 'Speak to the elder of each village. They will each ask a favour; do it, and do it quietly.'],
      ],
      steps: [
        {
          text: 'Speak to Elder Maro of {V1}', hint: 'He waits by the stones round the well.',
          setup: (S, M) => { M.elders = {}; M.elders.V1 = K.elder(S, M, 'V1', 'Elder Maro', S.places.V1.poi.spots[1]); },
          marker: (S, M) => M.elders.V1, talk: (S, M) => M.elders.V1, check: (S, M) => M.talked === M.elders.V1,
          done: (S) => S.lines([['Elder Maro', 'Brindle will bar its doors and keep its lamps lit when the signal comes. Tell Wren we are with her.']]),
        },
        {
          text: 'Find Elder Pia of {V2}', hint: 'A Tollman was asking after her. She is hiding in one of the houses: go in by the door and speak to her.',
          setup: (S, M) => { M.elders.V2 = K.elder(S, M, 'V2', 'Elder Pia', K.houseOf(S, 'V2', 0)); },
          marker: (S, M) => M.elders.V2, talk: (S, M) => M.elders.V2, check: (S, M) => M.talked === M.elders.V2,
          done: (S) => S.lines([['Elder Pia', 'You found me, so a Tollman could. Saltreach will stand with you. Quietly, mind.']]),
        },
        {
          text: 'Speak to Elder Bram of {V3}', hint: 'He is in the square, looking up at the tower.',
          setup: (S, M) => { M.elders.V3 = K.elder(S, M, 'V3', 'Elder Bram', S.places.V3.poi.spots[2]); },
          marker: (S, M) => M.elders.V3, talk: (S, M) => M.elders.V3, check: (S, M) => M.talked === M.elders.V3,
          done: (S) => S.lines([['Elder Bram', 'Mossford will stand with you, if you light our beacon. When the other villages see it, they will know we have chosen.']]),
        },
        {
          text: 'Light the beacon on the tower of {V3}', hint: 'Climb the watchtower and press E at the top.',
          marker: (S) => S.places.V3.poi.tower.top,
          setup: (S, M) => { M.beacon = false; S.addUse(M, { at: S.places.V3.poi.tower.top, text: 'Light the beacon', time: 2.0, run: (S, M) => { M.beacon = true; } }); },
          check: (S, M) => M.beacon,
          checkpoint: (S) => S.places.V3.poi.tower.base,
        },
        {
          text: 'Speak to Elder Ansel of {V4}', hint: 'He is in the square, with one eye on the Sergeant.',
          setup: (S, M) => { M.elders.V4 = K.elder(S, M, 'V4', 'Elder Ansel', S.places.V4.poi.spots[3]); },
          marker: (S, M) => M.elders.V4, talk: (S, M) => M.elders.V4, check: (S, M) => M.talked === M.elders.V4,
          done: (S) => S.lines([['Elder Ansel', 'Sergeant Vasko takes a third of everything we grow. While he stands on that square, nobody will dare. Deal with him, and Harrowdale is yours.']]),
        },
        {
          text: 'Take down Sergeant Vasko in {V4}', hint: 'Come at him from behind while he is busy at the stall. A quiet blade, and nobody will mourn him.',
          setup: (S, M) => {
            const v = S.places.V4, st = v.poi.stalls[0], f = st ? st.front : v.poi.spots[0], w = st ? st.vendor : v;
            M.vasko = S.temp(M, Npc.guard(S.game, v.key, { pos: K.at(f, K.face(f, w)), name: 'Sergeant Vasko', look: 'captain', health: 110, tag: 'target' }));
            M.vasko.controller.homeState = 'idle';
          },
          marker: (S, M) => M.vasko, check: (S, M) => !M.vasko.alive,
          checkpoint: (S) => S.places.V4.poi.spots[0],
        },
        {
          text: 'Tell Elder Ansel it is done', marker: (S, M) => M.elders.V4, talk: (S, M) => M.elders.V4, check: (S, M) => M.talked === M.elders.V4,
          done: (S) => S.lines([['Elder Ansel', 'Then Harrowdale is with you. All four of us.']]),
        },
        K.report(),
      ],
      outro: [
        ['Old Wren', 'Four villages with their doors barred and their lamps lit. When the Order moves, the island moves with us.'],
        ['Old Wren', 'Vale signs every order with his seal. Let us take it from him.'],
      ],
      reward: (S) => { S.addSilver(150); S.giveAll([['bandage', 3], ['smoke_bomb', 3], ['arrow', 12]]); },
    },

    // ------------------------------------------------------------------ XVII The Seal
    seal: {
      key: 'seal', title: 'The Seal',
      intro: [
        ['Old Wren', 'Vale seals every order with his signet, and the signet lives in a lockbox in his hall. A forged order with that seal on it will draw the patrols off his walls.'],
        ['Old Wren', 'If you took Pell\'s key, the lockbox opens in a breath. If not, you will be picking a lock in the Magistrate\'s own hall.'],
      ],
      steps: [
        {
          text: 'Get inside the walls of {keep}', hint: 'Climb the walls, or slip through the gate when nobody is looking.',
          marker: (S) => S.places.keep,
          check: (S) => S.players().some((p) => p.alive && Stealth.restricted(S.game, p.pos.x, p.pos.z) && Math.hypot(p.pos.x - S.places.keep.x, p.pos.z - S.places.keep.z) < 24),
        },
        {
          text: 'Take the seal from the lockbox in the hall', hint: 'The hall is at the back of the courtyard. The lockbox stands in the middle of the floor; Vale\'s guards stand at the throne. Press E at the lockbox.',
          marker: (S) => S.places.keep.poi.hall.inside,
          setup: (S, M) => {
            S.addUse(M, {
              at: S.places.keep.poi.hall.inside,
              get text() { return S.anyHas('pell_key') ? 'Unlock the Magistrate\'s lockbox' : 'Pick the Magistrate\'s lockbox (Pell\'s key would be faster)'; },
              get time() { return S.anyHas('pell_key') ? 1.6 : 6; },
              run: (S, M, ch) => S.giveTo(ch, [['magistrate_seal', 1]]),
            });
          },
          check: (S) => S.anyHas('magistrate_seal'),
          checkpoint: (S) => S.places.keep.poi.gate.out,
        },
        K.clear((S) => S.places.keep, 45, 3, 'Escape {keep} with the seal', 'Get clear of the walls and lose anyone chasing you.'),
        K.report('Bring the seal to Old Wren', {
          check: (S, M) => M.talked === S.mentor && S.anyHas('magistrate_seal'),
          done: (S) => { S.takeItem('magistrate_seal'); S.recallKeepPatrols(); },
        }),
      ],
      outro: [
        ['Old Wren', 'A forged order and a real seal. The wall patrols are marching to Saltreach as we speak, and they will not be back.'],
        ['Old Wren', 'That leaves only the man himself. Corvin Vale, in the hall under the skylight. Tomorrow, we go in.'],
      ],
      reward: (S) => { S.addSilver(150); S.giveAll([['arrow', 12], ['smoke_bomb', 3], ['bandage', 3]]); },
    },
  };
})();
