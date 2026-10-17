/**
 * Task 8c: the node card's lines (view/nodeCard.ts) — goal, enemies, elites, terrain — read from the arena templates of the run
 * and the run row's numbers. Node only: `npm run test:realtime-node-card`. The card on screen (real clicks on the map) is
 * tests/realtime-actionbar.spec.ts.
 */
import { arenaTemplate } from '../sim/arenas';
import { ARENA_POOLS, FINAL_ARENA, HARD_ARENA } from '../run/arenaPools';
import { RT_RANDOM_ELITE_ROW, rtElitePlates } from '../run/rtRun';
import { cardRules, eliteText, goalText, KIND_ONE, KIND_PLURAL, nodeDangers } from './nodeCard';
import { rtNodeEnemies } from '../run/nodeEnemies';
import { walkRun } from '../run/metaWalk.testkit';
import { arenaPreview, createRtRun, isArenaNode, resolveArena, rtArenaLoadout, rtAvailableNodes, rtEliteAffixes as affixesOf, rtElitePlates as platesOf, rtEnterNode, rtGentle, rtNode, rtRandomElites, type RtAshLevel, type RtRunState } from '../run/rtRun';
import { closeNode, ok, seedOf, takeGift } from '../run/runFight.testkit';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const text = (arena: string, row: number, extra: Partial<Parameters<typeof nodeDangers>[0]> = {}): Record<string, string> =>
  Object.fromEntries(nodeDangers({ arena, row, guaranteedElite: false, ...extra }).map(line => [line.id, line.text]));

check('the goal drops the arena name in front and starts with a capital', () => {
  assert(goalText('Поляна: убей цепью 20 врагов.') === 'Убей цепью 20 врагов.', goalText('Поляна: убей цепью 20 врагов.'));
  assert(goalText('Убей всех.') === 'Убей всех.', 'no name — as it is');
  for (const entry of ARENA_POOLS) {
    const goal = text(entry.arena, entry.rows[0]).goal, name = arenaTemplate(entry.arena).name;
    assert(goal && !goal.startsWith(`${name}:`), `${entry.arena}: ${goal}`);
  }
});

check('every run arena lists its lines in the design order: goal, enemies, elites, terrain; the ordinary enemies first', () => {
  const order = ['goal', 'enemies', 'elites', 'terrain'];
  for (const entry of [...ARENA_POOLS, { arena: HARD_ARENA, rows: [5, 5] as const }, { arena: FINAL_ARENA, rows: [10, 10] as const }]) {
    for (const row of entry.rows) {
      const ids = nodeDangers({ arena: entry.arena, row, guaranteedElite: false }).map(line => line.id);
      assert(ids[0] === 'goal' && ids[1] === 'enemies', `${entry.arena} row ${row}: ${ids}`);
      assert(ids.every((id, i) => i === 0 || order.indexOf(id) > order.indexOf(ids[i - 1])), `${entry.arena}: order ${ids}`);
      assert(text(entry.arena, row).enemies.startsWith('обычные'), `${entry.arena}: ${text(entry.arena, row).enemies}`);
    }
  }
});

check('enemies by kind (the template and the roster), terrain by zones and the pond', () => {
  assert(text('archers', 4).enemies === 'обычные, лучники', text('archers', 4).enemies);
  assert(text('thorns', 5).terrain === 'терновник', `thorns: ${text('thorns', 5).terrain}`);
  assert(text('ford', 6).terrain === 'река', `ford: ${text('ford', 6).terrain}`);
  assert(text('powder', 4).terrain === 'обрыв', `powder: ${text('powder', 4).terrain}`);
  assert(text('glade', 1).terrain === 'пруд', `glade: ${text('glade', 1).terrain}`);
  assert(text('shields', 3).terrain === undefined, 'no terrain — no line');
  assert(text('nope', 1).goal === undefined && nodeDangers({ arena: 'nope', row: 1, guaranteedElite: false }).length === 0, 'unknown arena — nothing');
});

check('elites: none before the random row, «могут прийти» from it, start elites and the guaranteed one counted; plates and traits of the row', () => {
  assert(text('glade', 1).elites === undefined, 'row 1: no elites');
  assert(text('lynx-den', RT_RANDOM_ELITE_ROW - 1).elites === undefined, 'row before the random elites');
  assert(text('shields', RT_RANDOM_ELITE_ROW).elites === `могут прийти · броня ${rtElitePlates(RT_RANDOM_ELITE_ROW)}`, `${text('shields', 3).elites}`);
  assert(text('shields', 3, { guaranteedElite: true }).elites === '1, могут прийти ещё · броня 2', `${text('shields', 3, { guaranteedElite: true }).elites}`);
  assert(text(HARD_ARENA, 5).elites === '2, могут прийти ещё · броня 3 · особое свойство', `outpost: ${text(HARD_ARENA, 5).elites}`);
  assert(text(FINAL_ARENA, 10, { startElite: true }).elites === '3, могут прийти ещё · броня 4 · 2 особых свойства', `final: ${text(FINAL_ARENA, 10, { startElite: true }).elites}`);
  assert(eliteText(1, false, 2, 0) === '1 · броня 2', eliteText(1, false, 2, 0)!);
  assert(eliteText(0, false, 2, 0) === null, 'none');
  assert(eliteText(0, true, 3, 5) === 'могут прийти · броня 3 · 5 особых свойств', eliteText(0, true, 3, 5)!);
});

check('the new kinds of the viewer are marked on the enemies line', () => {
  const line = nodeDangers({ arena: 'archers', row: 4, guaranteedElite: false, newKinds: ['archer'] }).find(l => l.id === 'enemies')!;
  assert(line.newKinds?.join() === 'archer', `${line.newKinds}`);
  const none = nodeDangers({ arena: 'archers', row: 4, guaranteedElite: false }).find(l => l.id === 'enemies')!;
  assert(none.newKinds === undefined, 'nothing new — no mark');
});

/**
 * Design 15.10.2026 (after task 26): the terrain line gets «✦» when the arena's terrain (the schedule's elements: river → water,
 * cliff, thorns) is not among the met ones; a small pond (r < 2, «Поляна») never does; no `met` — no sign.
 */
check('the terrain line is marked new while the schedule history has not met that terrain (a small pond — never)', () => {
  const terrain = (arena: string, met?: string[]) => nodeDangers({ arena, row: 4, guaranteedElite: false, ...met ? { met: new Set(met) } : {} }).find(l => l.id === 'terrain')!;
  assert(terrain('thorns', []).newTerrain?.join() === 'thorns', `thorns, nothing met: ${terrain('thorns', []).newTerrain}`);
  assert(terrain('thorns', ['thorns', 'buttons']).newTerrain === undefined, 'thorns met — no mark');
  assert(terrain('ford', ['cliff']).newTerrain?.join() === 'water', `the river is water: ${terrain('ford', ['cliff']).newTerrain}`);
  assert(terrain('ford', ['water']).newTerrain === undefined, 'water met — no mark');
  assert(terrain('p-cliff', ['water', 'thorns']).newTerrain?.join() === 'cliff', `the cliff: ${terrain('p-cliff', ['water', 'thorns']).newTerrain}`);
  assert(terrain('glade', []).newTerrain === undefined, 'a small pond is not the schedule water: no mark');
  assert(terrain('thorns').newTerrain === undefined, 'no history given (no schedule, the toggle off) — no mark');
});

/**
 * Task 17 (core review 14.10.2026, «подсказка ≠ исполнение»): a gentle run's node card said the old tables — row 3 «1 элита ·
 * броня 2», row 5 «броня 3 · особое свойство» — while the fight played none and 2 plates. Every available battle node of a run,
 * walked by its own commands on 12 seeds: the card's rules (`cardRules`) are the rules `rtArenaLoadout` gives the fight once the
 * node is entered (random and guaranteed elites, plates, traits, the first elite row's kinds, the final without the porcupine),
 * and the card's elites line says those numbers. A run without the flag keeps the old card.
 */
function walk(run: RtRunState, seen: (run: RtRunState, nodeId: string) => void): void {
  for (let step = 0; step < 400 && !run.result; step++) {
    if (run.pending?.kind === 'battle') {
      const kinds = run.pending.battle === 'final' ? ['basic'] : ['basic', 'wolf'];
      run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds }), 'win');
      continue;
    }
    if (run.pending) { run = closeNode(run); continue; }
    const nodes = rtAvailableNodes(run);
    for (const node of nodes) if (isArenaNode(node)) seen(run, node.id);
    run = ok(rtEnterNode(run, nodes[0].id), 'enter');
  }
}

check('task 17, task 18: every battle node card of a run equals its fight\'s loadout (gentle and old runs, 12 seeds; «Испытание» 0–V, 4 seeds each)', () => {
  let cards = 0, gentleRow3 = 0, gentleRow5 = 0, firstEliteRow = 0, finals = 0, ashTwoTraits = 0;
  const runs: { k: number; gentleEntry: boolean; ash: RtAshLevel }[] = [
    ...[true, false].flatMap(gentleEntry => Array.from({ length: 12 }, (_, i) => ({ k: i + 1, gentleEntry, ash: 0 as RtAshLevel }))),
    ...([1, 2, 3, 4, 5] as const).flatMap(ash => Array.from({ length: 4 }, (_, i) => ({ k: 20 + i, gentleEntry: true, ash }))),
  ];
  for (const { k, gentleEntry: asked, ash } of runs) {
    {
      // The level decides the gentle flags (III and above: none; II: the tables off).
      const start = takeGift(createRtRun(seedOf(k), { gift: 'mini', gentleEntry: asked, ash })), gentleEntry = rtGentle(start);
      walk(start, (run, nodeId) => {
        const node = rtNode(run, nodeId)!, pick = arenaPreview(run, node)!, rules = cardRules(run, node);
        const entered = ok(rtEnterNode(run, nodeId), 'enter for the loadout');
        if (entered.pending?.kind !== 'battle') return;
        const fight = rtArenaLoadout(entered), where = `seed ${k} ${gentleEntry ? 'gentle' : 'old'} ash ${ash} ${nodeId} row ${rules.row}`;
        assert(entered.pending.arena === pick.arena, `${where}: the card's arena ${pick.arena}, the fight's ${entered.pending.arena}`);
        assert(!!rules.gentle === gentleEntry, `${where}: gentle`);
        assert(rtRandomElites(rules.row, rules.gentle) === fight.randomElites, `${where}: random elites`);
        assert(platesOf(rules.row, rules.gentle) === fight.elitePlates, `${where}: plates`);
        assert((rules.ash ?? 0) === ash, `${where}: the level ${rules.ash}`);
        assert(affixesOf(rules.row, rules.gentle, rules.ash) === (fight.eliteAffixes ?? 0), `${where}: traits`);
        assert(rules.guaranteedElite === !!fight.guaranteedElite, `${where}: guaranteed elite`);
        assert(JSON.stringify(rules.eliteKinds ?? null) === JSON.stringify(fight.eliteKinds ?? null), `${where}: elite kinds ${rules.eliteKinds} / ${fight.eliteKinds}`);
        assert(JSON.stringify(rules.withoutKinds ?? null) === JSON.stringify(fight.withoutKinds ?? null), `${where}: without ${rules.withoutKinds} / ${fight.withoutKinds}`);
        const lines = Object.fromEntries(nodeDangers({ arena: pick.arena, roster: pick.roster, ...rules }).map(line => [line.id, line.text]));
        if (lines.elites) assert(lines.elites.includes(`броня ${fight.elitePlates}`), `${where}: ${lines.elites}`);
        if (fight.withoutKinds?.length) { finals++; assert(!lines.enemies.includes('дикобраз'), `${where}: ${lines.enemies}`); }
        if (gentleEntry && rules.row === 3) { gentleRow3++; assert(!lines.elites || !rules.guaranteedElite, `${where}: no guaranteed elite on row 3`); }
        if (gentleEntry && rules.row === 5) { gentleRow5++; assert(!lines.elites || (lines.elites.includes('броня 2') && !lines.elites.includes('свойств')), `${where}: ${lines.elites}`); }
        if (gentleEntry && rules.eliteKinds) firstEliteRow++;
        // Task 18 IV: the elites line says the fight's two traits on rows 6–8 (it said one before the level reached the card).
        if (lines.elites && (fight.eliteAffixes ?? 0) === 2) { assert(lines.elites.includes('2 особых свойства'), `${where}: ${lines.elites}`); if (rules.row < 9) ashTwoTraits++; }
        else if (lines.elites && (fight.eliteAffixes ?? 0) === 1) assert(lines.elites.includes('особое свойство'), `${where}: ${lines.elites}`);
        cards++;
      });
    }
  }
  assert(cards > 100 && gentleRow3 > 0 && gentleRow5 > 0 && firstEliteRow > 0 && finals > 0 && ashTwoTraits > 0, `cards ${cards}, row 3 ${gentleRow3}, row 5 ${gentleRow5}, row 4 kinds ${firstEliteRow}, finals without the porcupine ${finals}, IV two traits on rows 6–8 ${ashTwoTraits}`);
  console.log(`  ${cards} cards; gentle row 3: ${gentleRow3}, row 5: ${gentleRow5}, row-4 kinds: ${firstEliteRow}, finals without the porcupine: ${finals}, IV two traits on rows 6–8: ${ashTwoTraits}`);
});

check('task 17: the gentle tables on the card — row 3 no elites, row 4 they come, row 5 armour 2 without a trait, row 6 armour 3 and a trait; an old run keeps the old ones', () => {
  assert(text('shields', 3, { gentle: true, guaranteedElite: false }).elites === undefined, `gentle row 3: ${text('shields', 3, { gentle: true }).elites}`);
  assert(text('shields', 3).elites === 'могут прийти · броня 2', `old row 3: ${text('shields', 3).elites}`);
  assert(text('shields', 4, { gentle: true, guaranteedElite: true }).elites === '1, могут прийти ещё · броня 2', `${text('shields', 4, { gentle: true, guaranteedElite: true }).elites}`);
  assert(text('shields', 5, { gentle: true }).elites === 'могут прийти · броня 2', `${text('shields', 5, { gentle: true }).elites}`);
  assert(text('shields', 5).elites === 'могут прийти · броня 3 · особое свойство', `old row 5: ${text('shields', 5).elites}`);
  assert(text('shields', 6, { gentle: true }).elites === 'могут прийти · броня 3 · особое свойство', `${text('shields', 6, { gentle: true }).elites}`);
  // Е2: an elite only of the kinds allowed; none of them in the arena — no elite but the template's own.
  assert(text('shields', 4, { gentle: true, guaranteedElite: true, eliteKinds: ['lynx'] }).elites === undefined, 'no allowed kind here');
  // The final without the porcupine: the enemies line leaves it out.
  assert(!text(FINAL_ARENA, 10, { gentle: true, withoutKinds: ['porcupine'] }).enemies.includes('дикобраз'), text(FINAL_ARENA, 10, { withoutKinds: ['porcupine'] }).enemies);
});

check(`task 43 Г: a garrison node's card counts its own fight's start (every kind named, «×N» for more than one), names the newcomers, and has the line «Усиление» exactly when the node has additions (knights, crossbowmen, the deep keymaster); forest nodes keep their line`, () => {
  let cards = 0, extras = 0, knights = 0, bolts = 0, deep = 0, forest = 0;
  for (let k = 1; k <= 10; k++) {
    walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true }, each: state => {
      for (const node of rtAvailableNodes(state)) {
        if (!isArenaNode(node)) continue;
        const g = rtNodeEnemies(state, node), pick = arenaPreview(state, node);
        if (!pick) continue;
        const lines = Object.fromEntries(nodeDangers({ arena: pick.arena, roster: pick.roster, ...g ? { garrison: g } : {}, ...cardRules(state, node) }).map(line => [line.id, line.text]));
        if (!g) { forest++; assert(!lines.extras && !(lines.enemies ?? '').includes('подходят'), `forest ${pick.arena}: ${lines.enemies}`); continue; }
        cards++;
        for (const s of g.start) {
          const word = s.count === 1 ? KIND_ONE[s.kind] : `${KIND_PLURAL[s.kind]} ×${s.count}`;
          assert(word && lines.enemies.includes(word), `${pick.arena}: «${s.kind}» ×${s.count} not in «${lines.enemies}»`);
        }
        assert(lines.enemies.includes('подходят: обычные'), lines.enemies);
        const want = g.knights > 0 || g.bolts || g.deep;
        assert(!!lines.extras === want, `${pick.arena}: additions ${JSON.stringify({ k: g.knights, b: g.bolts, d: g.deep })}, line «${lines.extras}»`);
        if (want) extras++;
        if (g.knights) { knights++; assert(lines.extras.includes('в строю'), lines.extras); }
        if (g.bolts) { bolts++; assert(lines.extras.includes('арбалетчики сзади'), lines.extras); }
        if (g.deep) { deep++; assert(lines.extras.includes('ключник в глубине'), lines.extras); }
      }
    } });
  }
  assert(cards > 20 && extras > 0 && knights > 0 && bolts > 0 && forest > 0, `garrison cards ${cards}, with additions ${extras} (knights ${knights}, bolts ${bolts}, deep ${deep}), forest ${forest}`);
  console.log(`  garrison cards ${cards}, with additions ${extras} (knights ${knights}, bolts ${bolts}, deep ${deep}); forest cards ${forest}`);
});
