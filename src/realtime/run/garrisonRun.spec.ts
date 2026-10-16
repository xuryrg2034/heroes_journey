/**
 * Task 38 «Гарнизон, шаг 1» — the run layer (run/garrison.ts, run/rtRun.ts section «Task 38»; docs/realtime-slice.md, «Гарнизон»).
 * Node only: `npm run test:realtime-garrison-run`.
 *
 * Whole runs walked by the run's own commands (enter, the arena fed back with an outcome as the view builds it, every screen chosen;
 * metaWalk.testkit.ts) and what the player meets:
 * - with the flag: the forest final does not end the run — `level-cleared`, a relic 1 of 3 (only relics), «Предместье» with HP at the
 *   maximum, «В гарнизон»: the garrison's map (10 rows, «Караульня» on row 5, «Кастелян» on row 10), its fights — «Плац» first, the
 *   checkpoint «Караульня», the boss «Двор кастеляна»; the victory over the Castellan wins the run;
 * - the garrison's maps differ across seeds, the same seed — the same map; the forest's map is the same as without the flag;
 * - up to the forest final a run with the flag is the run without it (the same states but the flag) on 300 seeds; without the flag
 *   the forest final wins the run, as before;
 * - every state of the walk is read back from its save (`parseRtRun`) unchanged; a malformed transition reads as no run;
 * - the garrison's row tables in the loadout of its fights; the forest final opens «Испытание» even if the garrison is lost.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { generateForestMap } from '../forest/mapGenerator';
import { forestNodeSeed } from '../forest/nodeRolls';
import { GARRISON_FINAL_ARENA, GARRISON_HARD_ARENA, GARRISON_RUN_ARENAS, garrisonSeed, rtGarrisonNodeId } from './garrison';
import { ok, seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { arenaSeed, createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtArenaRules, rtChooseTalisman, rtEnterGarrison, rtEnterNode, rtAvailableNodes, rtLevel,
  rtIsLocked, rtMapNodes, rtNode, rtRunParams, rtRunWon, serializeRtRun, type RtRunState } from './rtRun';
import { RT_TALISMANS, rtTalisman, rtTalismanEligible } from './rtTalismans';
import { runRow } from './arenaPools';
import { RT_META_LOCKABLE } from './metaCatalog';
import { rtApplyMeta, rtRunDepth, rtRunXp } from './rtMeta';
import { defaultParams } from '../sim/params';
import { deathSection, fightLevel, type FightEntry } from '../telemetry/report';
import { checkRecord } from '../telemetry/schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** A walk of seed `k` with the garrison (`garrison` false — without it); every state goes to `each`. */
const walk = (k: number, garrison: boolean, extra: Partial<WalkOptions> = {}) => walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison }, ...extra });
/** The run without its garrison flags (to compare with a run without the flag; task 40: `moat` comes only with `garrison`; task 43: `step2` only with `moat`). */
const withoutFlag = (run: RtRunState): string => { const copy = structuredClone(run) as Partial<RtRunState>; delete copy.garrison; delete copy.moat; delete copy.step2; return JSON.stringify(copy); };
const forestBoss = (run: RtRunState): boolean => run.visited.some(id => !rtGarrisonNodeId(id) && rtNode(run, id)?.type === 'boss');

check('with the flag the forest final goes on: level-cleared (no run-won), a relic 1 of 3 (only relics), «Предместье» with full HP, «В гарнизон» — the garrison\'s map', () => {
  let full = 0;
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let before: RtRunState | null = null;
    // Stop at the forest final's victory: the walk loses no fight; the boss fight fed back with HP 3.
    walk(k, true, { each: state => { if (!before && state.pending?.kind === 'battle' && rtNode(state, state.pending.nodeId)?.type === 'boss') before = state; } });
    assert(before, `seed ${k}: the walk reached the forest final`);
    const atBoss: RtRunState = before;
    const pending = atBoss.pending!;
    assert(pending.kind === 'battle', 'the final open');
    const won = resolveArena(atBoss, { nodeId: pending.nodeId, won: true, hp: 3, kills: 40, damage: 12, time: 120 });
    assert(won.ok, `seed ${k}: resolve`);
    assert(won.events.some(e => e.type === 'level-cleared') && !won.events.some(e => e.type === 'run-won') && won.run.result === null, `seed ${k}: the run goes on`);
    const offer = won.run.pending;
    const left = RT_TALISMANS.filter(entry => entry.rarity === 'relic' && rtTalismanEligible(entry.id, { taken: won.run.talismans, gone: won.run.talismansGone })).length;
    assert(offer?.kind === 'talisman' && offer.source === 'level' && offer.options.length === Math.min(3, left) && offer.options.every(id => rtTalisman(id)?.rarity === 'relic'), `seed ${k}: a relic 1 of 3 (of ${left} left: ${JSON.stringify(offer)})`);
    full += offer.options.length === 3 ? 1 : 0;
    assert(won.run.hp === 3, 'HP as the fight left it');
    const pickRelic = offer.options.length ? offer.options[k % offer.options.length] : null, chosen = ok(rtChooseTalisman(won.run, pickRelic), 'relic');
    assert(chosen.pending?.kind === 'outskirts' && (pickRelic === null || chosen.talismans.includes(pickRelic)), `seed ${k}: «Предместье» after the relic`);
    assert(chosen.hp === chosen.maxHp, `seed ${k}: HP full in «Предместье» (${chosen.hp} / ${chosen.maxHp})`);
    assert(!rtAvailableNodes(chosen).length && rtLevel(chosen) === 1 && chosen.garrisonLevel === undefined, 'no map yet');
    const garrison = ok(rtEnterGarrison(chosen), 'garrison');
    assert(rtLevel(garrison) === 2 && garrison.pending === null, 'the garrison level');
    const nodes = rtMapNodes(garrison), rows = new Set(nodes.map(node => node.row));
    assert(nodes.every(node => rtGarrisonNodeId(node.id)) && rows.size === 10, `seed ${k}: the garrison's map of 10 rows (${[...rows]})`);
    const checkpoint = nodes.filter(node => runRow(node.row) === 5), bosses = nodes.filter(node => runRow(node.row) === 10);
    assert(checkpoint.length === 1 && checkpoint[0].type === 'checkpoint' && checkpoint[0].name === 'Караульня', `seed ${k}: «Караульня» on row 5`);
    assert(bosses.length === 2 && bosses.every(node => node.type === 'boss' && node.name === 'Кастелян'), `seed ${k}: «Кастелян» on row 10`);
    assert(!nodes.some(node => node.type === 'event'), 'no event node: a find instead');
    const open = rtAvailableNodes(garrison);
    assert(open.length > 0 && open.every(node => rtGarrisonNodeId(node.id) && runRow(node.row) === 1), `seed ${k}: its first row is open`);
    // A reload shows each screen as it was.
    for (const state of [won.run, chosen, garrison]) assert(serializeRtRun(parseRtRun(serializeRtRun(state))!) === serializeRtRun(state), `seed ${k}: the save reads back`);
  }
  assert(full > 0, 'some forest final offers three relics (the pool was not emptied by the Jailer\'s screen)');
});

check('the garrison\'s map: the forest\'s generator with the salt garrison-map — different across 12 seeds, the same for one seed; the forest\'s map as without the flag', () => {
  const maps = new Set<string>();
  for (let k = 1; k <= 12; k++) {
    const garrison = JSON.stringify(generateForestMap(garrisonSeed(seedOf(k))));
    assert(garrison === JSON.stringify(generateForestMap(garrisonSeed(seedOf(k)))), `seed ${k}: the same map`);
    maps.add(garrison);
    assert(JSON.stringify(createRtRun(seedOf(k), { garrison: true }).map) === JSON.stringify(createRtRun(seedOf(k), { garrison: false }).map), `seed ${k}: the forest's map is the same`);
    assert(garrison !== JSON.stringify(generateForestMap(seedOf(k))), `seed ${k}: the garrison's map is not the forest's`);
  }
  assert(maps.size === 12, `12 different maps (${maps.size})`);
});

check('up to the forest final a run with the flag is the run without it (300 seeds); without the flag the final wins the run', () => {
  for (let k = 1; k <= 300; k++) {
    const states: string[] = [];
    const plain = walk(k, false, { each: state => states.push(withoutFlag(state)) });
    assert(plain.run.result !== null && !plain.run.garrison && !('garrisonLevel' in plain.run), `seed ${k}: the plain run ended`);
    if (plain.run.result?.outcome === 'victory') assert(rtNode(plain.run, plain.run.result.nodeId)?.type === 'boss' && !rtGarrisonNodeId(plain.run.result.nodeId), `seed ${k}: the forest final wins`);
    let n = 0, same = true;
    walk(k, true, { each: state => { if (!forestBoss(state) && n < states.length) { same &&= withoutFlag(state) === states[n]; n++; } } });
    assert(same && n === states.length - (plain.run.result?.outcome === 'victory' ? 1 : 0), `seed ${k}: the same states up to the final (${n} of ${states.length})`);
  }
});

check('the garrison walked to its end: «Плац» first, every arena the garrison\'s, the checkpoint «Караульня», the boss «Двор кастеляна»; the Castellan wins the run; every state reads back from its save', () => {
  const arenas = new Set<string>();
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const result = walk(k, true, { each: state => assert(serializeRtRun(parseRtRun(serializeRtRun(state))!) === serializeRtRun(state), `seed ${k}: a state reads back`) });
    const run = result.run;
    assert(run.result?.outcome === 'victory' && rtGarrisonNodeId(run.result.nodeId) && rtNode(run, run.result.nodeId)?.type === 'boss', `seed ${k}: the Castellan wins (${JSON.stringify(run.result)})`);
    const picks = run.picks.filter(pick => rtGarrisonNodeId(pick.nodeId) && pick.arena);
    assert(picks.length > 0 && picks.every(pick => GARRISON_RUN_ARENAS.includes(pick.arena!)), `seed ${k}: the garrison's arenas (${picks.map(p => p.arena)})`);
    assert(picks[0].arena === 'g-yard' || runRow(rtNode(run, picks[0].nodeId)!.row) > 1, `seed ${k}: row 1 plays «Плац» (${picks[0].arena})`);
    for (const pick of picks) {
      const node = rtNode(run, pick.nodeId)!;
      if (node.type === 'checkpoint' || node.type === 'hard') assert(pick.arena === GARRISON_HARD_ARENA, `seed ${k}: «Караульня» on ${node.id}`);
      if (node.type === 'boss') assert(pick.arena === GARRISON_FINAL_ARENA, `seed ${k}: «Двор кастеляна» on ${node.id}`);
      arenas.add(pick.arena!);
    }
    assert(run.picks.some(pick => rtNode(run, pick.nodeId)?.type === 'checkpoint' && rtGarrisonNodeId(pick.nodeId)), `seed ${k}: the run passed «Караульня»`);
    assert(rtRunWon(run), 'the run is won');
  }
  assert(arenas.has('g-kennel') && arenas.has('g-yard'), `the pools over 6 seeds (${[...arenas]})`);
});

check('the garrison\'s fights: the row tables in the loadout (row 1: an affix, 3 plates, tough HP 3, the bag, no second wind); the grace 0.5 s and the tough touch from row 1', () => {
  let seen = 0;
  for (const k of [1, 2, 3]) {
    walk(k, true, { each: state => {
      const pending = state.pending;
      if (pending?.kind !== 'battle' || !rtGarrisonNodeId(pending.nodeId)) return;
      const node = rtNode(state, pending.nodeId)!, row = runRow(node.row), kit = rtArenaLoadout(state);
      assert(kit.eliteAffixes === (row >= 9 ? 2 : 1) && kit.elitePlates === (row >= 6 ? 4 : 3) && kit.toughHp === (row >= 6 ? 4 : 3), `seed ${k}, ${node.id}: the row table (${JSON.stringify(kit)})`);
      assert(!kit.secondWind && kit.randomElites === (pending.battle !== 'final' && row >= 3), `seed ${k}, ${node.id}: no second wind, elites from row 3`);
      assert(!!kit.noBag === (node.type === 'checkpoint' || node.type === 'boss'), `seed ${k}, ${node.id}: the bag from row 1`);
      const params = rtArenaParams(rtArenaRules(state), rtRunParams(defaultParams()));
      assert(params.invulnerability === 0.5 && params.toughTouch && params.tethers && params.guardFormation, `seed ${k}, ${node.id}: the grace, the tough touch, the laws`);
      seen++;
    } });
  }
  assert(seen > 10, `garrison fights seen (${seen})`);
});

check('the garrison\'s node seeds are its own (not the forest\'s of the same generator id); the forest final opens «Испытание» even when the garrison is lost', () => {
  const lost = walk(5, true, { loseAt: run => rtLevel(run) === 2 && run.picks.filter(pick => rtGarrisonNodeId(pick.nodeId)).length >= 2 });
  assert(lost.run.result?.outcome === 'defeat' && rtGarrisonNodeId(lost.run.result.nodeId), 'lost in the garrison');
  assert(rtRunWon(lost.run), 'the forest final counts for «Испытание»');
  const garrisonPick = lost.run.picks.find(pick => rtGarrisonNodeId(pick.nodeId))!;
  const battle = lost.run.battles.find(record => record.nodeId === garrisonPick.nodeId)!;
  assert(battle, 'a garrison fight recorded');
  const bare = garrisonPick.nodeId.slice(2);
  assert(arenaSeed(lost.run, garrisonPick.nodeId) === forestNodeSeed(garrisonSeed(lost.run.seed), bare) && arenaSeed(lost.run, garrisonPick.nodeId) !== arenaSeed(lost.run, bare), 'the arena seed of a garrison node is the garrison seed one');
  const plainLoss = walk(5, false, { loseAt: (_run, type) => type === 'checkpoint' });
  assert(!rtRunWon(plainLoss.run), 'a run lost in the forest has not won');
});

check('a malformed transition reads as no run: the garrison level without the flag, a relic offer that was not drawn, the garrison\'s map without «В гарнизон»', () => {
  let atOffer: RtRunState | null = null, inGarrison: RtRunState | null = null;
  walk(2, true, { each: state => {
    if (!atOffer && state.pending?.kind === 'talisman' && state.pending.source === 'level') atOffer = state;
    if (!inGarrison && rtLevel(state) === 2 && !state.pending) inGarrison = state;
  } });
  assert(atOffer && inGarrison, 'the walk passed the transition');
  const offer = JSON.parse(serializeRtRun(atOffer)) as RtRunState;
  assert(parseRtRun(JSON.stringify(offer)) !== null, 'the offer reads');
  (offer.pending as { options: string[] }).options = ['heavy-blade', 'heavy-blade'];
  assert(parseRtRun(JSON.stringify(offer)) === null, 'a changed offer reads as no run');
  const flagless = JSON.parse(serializeRtRun(inGarrison)) as Partial<RtRunState>;
  delete flagless.garrison;
  assert(parseRtRun(JSON.stringify(flagless)) === null, 'the garrison level without the flag reads as no run');
  const noLevel = JSON.parse(serializeRtRun(inGarrison)) as Partial<RtRunState>;
  delete noLevel.garrisonLevel;
  assert(parseRtRun(JSON.stringify(noLevel)) === null, 'a garrison path without its map reads as no run');
  // Entering a garrison node straight after the relic (no «Предместье») is refused.
  const step = rtEnterNode(atOffer, rtAvailableNodes(inGarrison)[0].id);
  assert(!step.ok, 'no garrison node before «В гарнизон»');
});

check('a meta run\'s locked relics never come at the forest final (fewer offered when the lock leaves fewer); the save reads back', () => {
  let offers = 0;
  for (const k of [1, 2, 3, 4, 5, 6]) {
    walkRun({ k, create: { gift: 'mini', garrison: true, locked: [...RT_META_LOCKABLE] }, each: state => {
      const p = state.pending;
      if (p?.kind !== 'talisman' || p.source !== 'level') return;
      offers++;
      const left = RT_TALISMANS.filter(entry => entry.rarity === 'relic' && !RT_META_LOCKABLE.includes(entry.id) && rtTalismanEligible(entry.id, { taken: state.talismans, gone: state.talismansGone })).length;
      assert(p.options.every(id => !rtIsLocked(state, id)) && p.options.length === Math.min(3, left), `seed ${k}: ${p.options} (of ${left} unlocked)`);
      assert(serializeRtRun(parseRtRun(serializeRtRun(state))!) === serializeRtRun(state), `seed ${k}: the save reads back`);
    } });
  }
  assert(offers === 6, `every walk reached the forest final's relic (${offers})`);
});

check('the meta of a garrison run: its fights ×2 (Караульня 40), the Castellan +50, the victory +25 only at the garrison\'s end; the record keeps the level; the carry cap 40', () => {
  for (const k of [1, 2, 3]) {
    const won = walk(k, true).run, lost = walk(k, true, { loseAt: run => rtLevel(run) === 2 && run.picks.filter(pick => rtGarrisonNodeId(pick.nodeId)).length >= 3 }).run;
    for (const run of [won, lost]) {
      const xp = rtRunXp(run), part = (id: string) => xp.parts.find(p => p.id === id)?.xp ?? 0;
      let want = { battles: 0, elite: 0, jailer: 0, final: 0, guardroom: 0, castellan: 0 };
      for (const record of run.battles.filter(b => b.won)) {
        const type = rtNode(run, record.nodeId)!.type, g = rtGarrisonNodeId(record.nodeId) ? 2 : 1;
        if (type === 'hard' || type === 'breakthrough') want.elite += 10 * g;
        else if (type === 'checkpoint') { if (g === 2) want.guardroom += 40; else want.jailer += 30; }
        else if (type === 'boss') { if (g === 2) want.castellan += 50; else want.final += 50; }
        else want.battles += 5 * g;
      }
      want = { ...want };
      assert(part('battles') === want.battles && part('elite') === want.elite && part('jailer') === want.jailer && part('final') === want.final && part('guardroom') === want.guardroom && part('castellan') === want.castellan, `seed ${k}: ${JSON.stringify(xp.parts)} / ${JSON.stringify(want)}`);
      const end = rtApplyMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 10, won: true, xp: 100 } } } }, run).end;
      assert(end.record.after.level === 2 && end.record.beaten && end.record.before?.level === undefined, `seed ${k}: the garrison's record beats the forest's (${JSON.stringify(end.record)})`);
      assert(end.carry.cap === 40, `seed ${k}: the cap 40 (${end.carry.cap})`);
    }
    assert(won.result?.outcome === 'victory' && rtRunXp(won).parts.some(p => p.id === 'victory' && p.xp === 25) && rtRunXp(won).parts.find(p => p.id === 'final')?.xp === 50 && rtRunXp(won).parts.find(p => p.id === 'castellan')?.xp === 50, `seed ${k}: the forest final and the Castellan +50 each on their own lines (D1), the victory +25`);
    assert(lost.result?.outcome === 'defeat' && !rtRunXp(lost).parts.some(p => p.id === 'victory'), `seed ${k}: no victory bonus for a run lost in the garrison`);
    // A garrison record row 2 is beyond a forest record row 10; a later garrison row 1 is not.
    const again = rtApplyMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 9, won: true, xp: 100, level: 2 } } } }, lost).end;
    assert(again.record.beaten === (rtRunDepth(lost) > 9) && again.record.after.level === 2, `seed ${k}: same level — by the row (${JSON.stringify(again.record)})`);
  }
  // A forest run: the record and the cap as before (no level).
  const forest = walk(4, false).run, end = rtApplyMeta(undefined, forest).end;
  assert(end.record.after.level === undefined && end.carry.cap === 20, 'a forest run keeps the old record and cap');
});

check('telemetry: a garrison fight\'s record keeps its level; the report\'s deaths by row tell the garrison\'s rows («г N») after the forest\'s', () => {
  const entry = (nodeId: string, row: number, level?: 2): FightEntry => ({
    record: { kind: 'fight', run: 'R1', fight: `f-${nodeId}`, nodeId, arena: 'g-yard', row, ...level ? { level } : {}, outcome: 'defeat', summary: {} },
    run: null, notes: [], journal: null, error: null, analysis: null, summaryDiff: [],
  } as unknown as FightEntry);
  const text = deathSection([entry('r7c1', 3), entry('g:r7c1', 3, 2), entry('g:r8c0', 4)]);
  const rows = text.split('### Смерти по рядам')[1].split('### Смерти по аренам')[0];
  assert(/\| 3 \| 1 \|/.test(rows) && /\| г 3 \| 1 \|/.test(rows) && /\| г 4 \| 1 \|/.test(rows), rows);
  assert(rows.indexOf('| 3 |') < rows.indexOf('| г 3 |') && rows.indexOf('| г 3 |') < rows.indexOf('| г 4 |'), 'the forest first, then the garrison');
  assert(fightLevel({ nodeId: 'g:r5c0' }) === 2 && fightLevel({ nodeId: 'r5c0' }) === 1 && fightLevel({ level: 2 }) === 2, 'the level');
  assert(checkRecord({ kind: 'fight', level: 2, nodeId: 'r5c0' }) !== null, 'a forest node never carries level 2');
});

console.log(`garrison run: ${checks} checks passed`);
