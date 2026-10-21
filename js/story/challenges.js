/* ============================================================
 * Challenges and collectibles (story mode).
 *
 * Challenges are optional goals across the whole campaign: kills, silent
 * takedowns, leaps, viewpoints, contracts, letters, the granary and the
 * bells, the informant, the key, the road, the marksmen, unseen chapters, forging gear. Each one pays silver and some
 * pay a piece of gear (the challenge gear only comes from here). Progress
 * is counted by Story (story.js reads S.stats, S.flags and S.synced) and
 * checked once a second; completions are saved with the story.
 *
 * Order letters are the collectibles: twelve sealed letters lie around
 * the island (two in each village, two at the hideout, two in the keep).
 * Walking over one picks it up and reads it: a line of the Order's story.
 * ============================================================ */

/** The twelve letters: where each lies (by plan point name) and what it says. */
const ORDER_LETTERS = [
  { at: ['V1', 'well'], text: 'Brindle: the tollmen took the goat again. Bread doubled at the mill. Burn this, Mara, and keep the boys off the roofs.' },
  { at: ['V1', 'spots', 2], text: 'Brindle: "Road tax" is the name for it now. Nobody on the road has seen a road tax, but everybody pays it.' },
  { at: ['V2', 'well'], text: 'Saltreach: my brother rowed to the north shore. He says the keep has a skylight over the hall. I hope he is wrong.' },
  { at: ['V2', 'spots', 2], text: 'Saltreach: the red-awning stall weighs with its thumb. Do not buy from it, and do not argue with the man who sells there.' },
  { at: ['V3', 'well'], text: 'Mossford: the marksmen on the camp posts count the carts by lamplight. They never count the people walking beside them.' },
  { at: ['V3', 'spots', 2], text: 'Mossford: Ida\'s bells are still hanging in the tower. Ring them when it is time, not before. Wren says so.' },
  { at: ['V4', 'well'], text: 'Harrowdale: we keep the children indoors while the walls have archers. Forgive us, it is the only shelter we have.' },
  { at: ['V4', 'spots', 2], text: 'Harrowdale: the grain is in the tall stalls by the square. Vale\'s men come on the first of every month and take a third.' },
  { at: ['hideout', 'entrance'], text: 'The Order: we were eleven when the Magistrate came. Sixteen names are carved in this door. Keep adding them, and keep faith.' },
  { at: ['hideout', 'bed'], text: 'The Order: Wren keeps a ledger of every trip out and back. Your name is in it already. That is how we know you are ours.' },
  { at: ['keep', 'throne'], text: 'Vale to his clerk: the villages pay in silver, the Order pays in blood. Count both. Balance nothing. Leave the balance to me.' },
  { at: ['keep', 'patrol', 0], text: 'Vale: a man who hides from a crowd is a man with something to hide. Find him. Then let the crowd find him.' },
];

/** Where a letter lies on the island, from the plan (falls back to a village square). */
function letterSpot(S, at) {
  const key = at[0], site = key === 'keep' ? S.places.keep : key === 'hideout' ? S.places.hideout : S.places[key];
  if (!site) return null;
  const poi = site.poi, spot = at[1];
  if (spot === 'well') return poi.spots[0];                 // by the well: the well's own block is water, nothing can be picked up there
  if (spot === 'entrance') return poi.entrance;
  if (spot === 'bed') return poi.bed;
  if (spot === 'throne') return poi.throne;
  if (spot === 'spots') return poi.spots[Math.min(at[2], poi.spots.length - 1)];
  if (spot === 'patrol') return poi.patrol[Math.min(at[2], poi.patrol.length - 1)];
  return site;
}

/**
 * The challenges. `check(S)` reads Story's counters (S.stats), named flags (S.flags), synced viewpoints (S.synced)
 * and the chapters done (S.chapter). `reward`: silver, and gear ids (CHALLENGE_GEAR or CONFIG.STORY.GEAR.PIECES).
 */
const STORY_CHALLENGES = [
  { id: 'first', title: 'First Blood', text: 'Take down your first enemy.', check: (S) => S.stats.kills >= 1, reward: { silver: 20 } },
  { id: 'hunter', title: 'Hunter', text: 'Take down twenty enemies.', check: (S) => S.stats.kills >= 20, reward: { silver: 80 } },
  { id: 'silent5', title: 'Silent Blade', text: 'Five silent takedowns.', check: (S) => S.stats.silent >= 5, reward: { silver: 40 } },
  { id: 'silent15', title: 'Shadow Hand', text: 'Fifteen silent takedowns.', check: (S) => S.stats.silent >= 15, reward: { silver: 100, gear: ['gear_veil'] } },
  { id: 'archer', title: 'Archer', text: 'Ten kills with the bow.', check: (S) => S.stats.arrows >= 10, reward: { silver: 40 } },
  { id: 'parry', title: 'Iron Parry', text: 'Parry five sabre blows.', check: (S) => S.stats.parries >= 5, reward: { silver: 60 } },
  { id: 'leap10', title: 'Hay Keeper', text: 'Ten leaps of faith.', check: (S) => S.stats.leaps >= 10, reward: { silver: 30 } },
  { id: 'sync6', title: 'Eagle Eye', text: 'Synchronize six viewpoints.', check: (S) => S.synced.size >= 6, reward: { silver: 40 } },
  { id: 'travel3', title: 'Swift Travel', text: 'Travel by synchronized viewpoints three times.', check: (S) => S.stats.travels >= 3, reward: { silver: 25 } },
  { id: 'walk', title: 'Long Road', text: 'Walk two thousand blocks on the island.', check: (S) => S.stats.distance >= 2000, reward: { silver: 50 } },
  { id: 'pathfinder', title: 'Pathfinder', text: 'Set foot in every village, camp, the keep and the hideout.', check: (S) => S.visited.size >= S.plan.sites.length, reward: { silver: 80 } },
  { id: 'contract3', title: 'Silver Tongue', text: 'Finish three contracts.', check: (S) => S.stats.contracts >= 3, reward: { silver: 60 } },
  { id: 'contract8', title: 'Contract Hunter', text: 'Finish eight contracts.', check: (S) => S.stats.contracts >= 8, reward: { silver: 120, gear: ['gear_harrow'] } },
  { id: 'buy5', title: 'Ida\'s Favourite', text: 'Buy five things from Ida.', check: (S) => S.stats.purchases >= 5, reward: { silver: 30 } },
  { id: 'letters8', title: 'Map Reader', text: 'Find eight Order letters.', check: (S) => S.letters.size >= 8, reward: { silver: 60, gear: ['gear_silent'] } },
  { id: 'letters12', title: 'The Whole Story', text: 'Find all twelve Order letters.', check: (S) => S.letters.size >= ORDER_LETTERS.length, reward: { silver: 150 } },
  { id: 'ghost3', title: 'Ghost of the Order', text: 'Finish three chapters without being spotted.', check: (S) => S.stats.chapterClean >= 3, reward: { silver: 100 } },
  { id: 'cleanhands', title: 'Clean Hands', text: 'Finish a chapter without an innocent death.', check: (S) => S.stats.chapterCleanHands >= 1, reward: { silver: 40 } },
  { id: 'unhurt', title: 'Untouchable', text: 'Finish a chapter without taking a blow.', check: (S) => S.stats.chapterUnhurt >= 1, reward: { silver: 60 } },
  { id: 'nightowl', title: 'Night Owl', text: 'Finish a chapter at night.', check: (S) => S.stats.nightChapters >= 1, reward: { silver: 30 } },
  { id: 'notorious', title: 'Notorious', text: 'Let notoriety reach its third pip.', check: (S) => S.stats.notorietyMax >= 3, reward: { silver: 10 } },
  { id: 'poster', title: 'Clean Slate', text: 'Tear down a wanted poster.', check: (S) => S.stats.posters >= 1, reward: { silver: 20 } },
  { id: 'remedy5', title: 'Field Surgeon', text: 'Use five healing items.', check: (S) => S.stats.consumed >= 5, reward: { silver: 30 } },
  { id: 'smoke5', title: 'Smoke and Mirrors', text: 'Throw five smoke bombs.', check: (S) => S.stats.smokeThrown >= 5, reward: { silver: 30 } },
  { id: 'granary', title: 'Granary Ghost', text: 'Spoil the grain in Harrowdale without an alarm.', check: (S) => !!S.flags.granaryClean, reward: { silver: 60 } },
  { id: 'bells', title: 'Quiet Bells', text: 'Ring the three bells without an alarm.', check: (S) => !!S.flags.bellsClean, reward: { silver: 60 } },
  { id: 'tollbreaker', title: 'Tollbreaker', text: 'Take the toll tickets from all three camps.', check: (S) => !!S.flags.tollsTaken, reward: { silver: 60 } },
  { id: 'quietears', title: 'Quiet Ears', text: 'Overhear the Tollmen in Mossford without being spotted.', check: (S) => !!S.flags.informantClean, reward: { silver: 60 } },
  { id: 'cages3', title: 'Open Cages', text: 'Free all three prisoners and see them home alive.', check: (S) => (S.flags.prisonersFreed | 0) >= 3, reward: { silver: 80 } },
  { id: 'lightfingers', title: 'Light Fingers', text: 'Lift Pell\'s key without raising an alarm.', check: (S) => !!S.flags.pellClean, reward: { silver: 60 } },
  { id: 'holdroad', title: 'Untouched Road', text: 'Break all three columns without taking a blow.', check: (S) => !!S.flags.columnsUnhurt, reward: { silver: 70 } },
  { id: 'outrange', title: 'Out of Range', text: 'Take down the wall marksmen without taking a blow.', check: (S) => !!S.flags.marksmenUnhurt, reward: { silver: 70 } },
  { id: 'forgery', title: 'Forged Orders', text: 'Take the Magistrate\'s seal from his hall.', check: (S) => !!S.flags.sealed, reward: { silver: 80 } },
  { id: 'ghost9', title: 'Ghost of Kestrel Isle', text: 'Finish nine chapters without being spotted.', check: (S) => S.stats.chapterClean >= 9, reward: { silver: 150 } },
  { id: 'forged', title: 'Forged in Ironwood', text: 'Upgrade a piece of gear at Ida\'s forge.', check: (S) => S.stats.upgrades >= 1, reward: { silver: 40 } },
  { id: 'master', title: 'Master Forger', text: 'Bring a piece of gear to its highest level.', check: (S) => S.stats.maxedGear >= 1, reward: { silver: 90 } },
  { id: 'magistrate', title: 'The Magistrate Falls', text: 'Finish the campaign.', check: (S) => S.finished, reward: { silver: 200, gear: ['gear_ghost'] } },
];
