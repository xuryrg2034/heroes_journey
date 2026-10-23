/**
 * Task 55в «Замок в походе» — the run layer (run/castle.ts, run/rtRun.ts section «Task 55в»; docs/realtime-slice.md, «Замок»).
 * Node only: `npm run test:realtime-castle-run`.
 *
 * Whole runs walked by the run's own commands (metaWalk.testkit.ts: enter, the arena fed back with an outcome as the view builds it,
 * every screen chosen) through the forest and the garrison, and what the player meets:
 * - with the flag `castle` the Castellan does not end the run — `level-cleared` 2, a relic 1 of 3 (the garrison's `talismans` stream),
 *   «Подножие» with HP at the maximum, «В замок»: the castle's map (10 rows, `c:` ids, «Бальный зал» on row 5, «Колдун» on row 10);
 *   its fights by the castle's pools in the order of novelties; the Warlock's victory wins the run (`wonLevel` 3, the carry cap 60);
 * - up to the Castellan a run with the flag is the run without it (300 seeds); without the flag the Castellan wins the run, the walks
 *   byte for byte as at 8d72788b (their digests);
 * - every state reads back from its save; malformed castle fields read as no run;
 * - the castle's row tables in its fights' loadout; the death cause, the run-end lines, the meta, the telemetry's level 3.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { generatedRunMap, generateForestMap } from '../forest/mapGenerator';
import { forestNodeSeed } from '../forest/nodeRolls';
import { CASTLE_FINAL_ARENA, CASTLE_HARD_ARENA, CASTLE_RUN_ARENAS, castleSeed, rtCastleNodeId, rtNodeLevel } from './castle';
import { garrisonSeed, rtGarrisonNodeId } from './garrison';
import { ok, seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { arenaSeed, createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtArenaRules, rtAvailableNodes, rtChooseTalisman, rtEnterCastle, rtEnterNode, rtLevel,
  rtMapNodes, rtNode, rtRunParams, rtRunWon, serializeRtRun, type RtRunState } from './rtRun';
import { rtTalisman } from './rtTalismans';
import { runRow } from './arenaPools';
import { rtApplyMeta, rtDeathCause, rtRunWonLevel, rtRunXp } from './rtMeta';
import { rtRunEndLines } from './rtRunEnd';
import { rtDailyClaim, rtDailyClaimText } from './rtDaily';
import { rtTrophiesImport } from './trophies';
import { rtChronicleMeet, isRtChronicleRef, parseRtChronicle } from './chronicle';
import { rtChronicleHint, rtChronicleView, type RtChronicleOn, type RtChronicleProfile } from './chroniclePages';
import type { RtMeta } from './rtMeta';
import { RT_OMEN_IDS } from './omens';
import { defaultParams } from '../sim/params';
import { MAX_TOUGH_HP } from '../sim/kit';
import { deathSection, fightLevel, type FightEntry } from '../telemetry/report';
import { checkRecord } from '../telemetry/schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** A walk of seed `k` with the garrison and the castle (`castle` false — without it); the knack screens refused (task 50). */
const walk = (k: number, castle: boolean, extra: Partial<WalkOptions> = {}) => walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, castle }, knack: () => null, ...extra });
const readsBack = (state: RtRunState): boolean => { const text = serializeRtRun(state), back = parseRtRun(text); return !!back && serializeRtRun(back) === text; };
const castellan = (state: RtRunState): boolean => state.pending?.kind === 'battle' && rtNodeLevel(state.pending.nodeId) === 2 && rtNode(state, state.pending.nodeId)?.type === 'boss';
const withoutFlag = (run: RtRunState): string => { const copy = structuredClone(run) as Partial<RtRunState>; delete copy.castle; return JSON.stringify(copy); };

check('with the flag the Castellan goes on: level-cleared 2 (no run-won), a relic 1 of 3 by the garrison\'s stream, «Подножие» with full HP, «В замок» — the castle\'s map of 10 rows', () => {
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let before: RtRunState | null = null;
    walk(k, true, { each: state => { if (!before && castellan(state)) before = state; } });
    assert(before, `seed ${k}: the walk reached the Castellan`);
    const at: RtRunState = before, pending = at.pending!;
    assert(pending.kind === 'battle' && at.garrisonLevel, 'the Castellan open');
    const won = resolveArena(at, { nodeId: pending.nodeId, won: true, hp: 2, kills: 40, damage: 13, time: 150 });
    assert(won.ok, `seed ${k}: resolve`);
    assert(won.events.some(e => e.type === 'level-cleared' && e.level === 2) && !won.events.some(e => e.type === 'run-won') && won.run.result === null, `seed ${k}: the run goes on (${JSON.stringify(won.events)})`);
    const offer = won.run.pending;
    assert(offer?.kind === 'talisman' && offer.source === 'level' && offer.nodeId === pending.nodeId && offer.options.length === 3, `seed ${k}: a relic screen 1 of 3 (${JSON.stringify(offer)})`);
    const relics = offer.options.filter(id => rtTalisman(id)?.rarity === 'relic');
    assert(JSON.stringify(offer.options.slice(0, relics.length)) === JSON.stringify(relics), `seed ${k}: the relics first, then rares (${offer.options})`);
    assert(won.run.garrisonLevel!.streams.talismans === at.garrisonLevel.streams.talismans + 1 && JSON.stringify(won.run.streams) === JSON.stringify(at.streams), `seed ${k}: the garrison's talismans stream drew it, the forest's untouched`);
    const pick = offer.options[k % offer.options.length], chosen = ok(rtChooseTalisman(won.run, pick), 'relic');
    assert(chosen.pending?.kind === 'foothill' && chosen.talismans.includes(pick), `seed ${k}: «Подножие» after the relic`);
    assert(chosen.hp === chosen.maxHp && chosen.hp > 2, `seed ${k}: HP full at «Подножие» (${chosen.hp} / ${chosen.maxHp})`);
    assert(!rtAvailableNodes(chosen).length && rtLevel(chosen) === 2 && chosen.castleLevel === undefined, 'no castle map yet');
    assert(!rtEnterCastle(won.run).ok && !rtEnterCastle(at).ok, 'no way into the castle before «Подножие»');
    const step = rtEnterCastle(chosen);
    assert(step.ok && step.events.some(e => e.type === 'castle-entered'), `seed ${k}: «В замок»`);
    const castle = step.run;
    assert(rtLevel(castle) === 3 && castle.pending === null && castle.castleLevel && JSON.stringify(castle.castleLevel.streams) === JSON.stringify(createRtRun(1).streams), 'the castle level, its streams from 0');
    const nodes = rtMapNodes(castle), rows = new Set(nodes.map(node => runRow(node.row)));
    assert(nodes.every(node => rtCastleNodeId(node.id)) && rows.size === 10 && Math.min(...rows) === 1 && Math.max(...rows) === 10, `seed ${k}: the castle's map of 10 rows (${[...rows]})`);
    const checkpoint = nodes.filter(node => runRow(node.row) === 5), bosses = nodes.filter(node => runRow(node.row) === 10);
    assert(checkpoint.length === 1 && checkpoint[0].type === 'checkpoint' && checkpoint[0].name === 'Бальный зал', `seed ${k}: «Бальный зал» on row 5`);
    assert(bosses.length === 2 && bosses.every(node => node.type === 'boss' && node.name === 'Колдун'), `seed ${k}: «Колдун» on row 10`);
    const events = generatedRunMap(castle.castleLevel.map).nodes.filter(node => node.type === 'event').map(node => `c:${node.id}`);
    assert(!nodes.some(node => node.type === 'event') && events.every(id => rtNode(castle, id)?.type === 'find' && rtNode(castle, id)?.name === 'Кладовая'), 'no event node: a find «Кладовая»');
    assert(nodes.filter(node => node.type === 'breakthrough').every(node => node.name === 'Прорыв к колдуну'), 'the breakthrough «Прорыв к колдуну»');
    const open = rtAvailableNodes(castle);
    assert(open.length > 0 && open.every(node => rtCastleNodeId(node.id) && runRow(node.row) === 1), `seed ${k}: its first row is open`);
    assert(!rtEnterCastle(castle).ok, 'the castle is entered once');
    for (const state of [won.run, chosen, castle]) assert(readsBack(state), `seed ${k}: the save reads back`);
  }
});

check('the castle\'s map: the forest\'s generator with the salt castle-map — different across 12 seeds, the same for one seed; not the forest\'s nor the garrison\'s', () => {
  const maps = new Set<string>();
  for (let k = 1; k <= 12; k++) {
    const seed = seedOf(k), castle = JSON.stringify(generateForestMap(castleSeed(seed)));
    assert(castle === JSON.stringify(generateForestMap(castleSeed(seed))), `seed ${k}: the same map`);
    assert(castle !== JSON.stringify(generateForestMap(seed)) && castle !== JSON.stringify(generateForestMap(garrisonSeed(seed))), `seed ${k}: its own map`);
    assert(JSON.stringify(createRtRun(seed, { garrison: true, castle: true }).map) === JSON.stringify(createRtRun(seed, { garrison: true, castle: false }).map), `seed ${k}: the forest's map is the same`);
    maps.add(castle);
  }
  assert(maps.size === 12, `12 different maps (${maps.size})`);
});

check('up to the Castellan a run with the flag is the run without it (300 seeds); without the flag the Castellan wins the run', () => {
  for (let k = 1; k <= 300; k++) {
    const states: string[] = [];
    const plain = walk(k, false, { each: state => states.push(withoutFlag(state)) });
    assert(plain.run.result !== null && !plain.run.castle && !('castleLevel' in plain.run), `seed ${k}: the plain run ended`);
    const plainWon = plain.run.result?.outcome === 'victory';
    if (plainWon) assert(rtGarrisonNodeId(plain.run.result!.nodeId) && rtNode(plain.run, plain.run.result!.nodeId)?.type === 'boss', `seed ${k}: the Castellan wins`);
    let n = 0, same = true, past = false;
    walk(k, true, { each: state => {
      past ||= state.visited.some(id => rtNodeLevel(id) === 2 && rtNode(state, id)?.type === 'boss');
      if (!past && n < states.length) { same &&= withoutFlag(state) === states[n]; n++; }
    } });
    assert(same && n === states.length - (plainWon ? 1 : 0), `seed ${k}: the same states up to the Castellan (${n} of ${states.length})`);
  }
});

check('without the flag the garrison walks are byte for byte those of 8d72788b (their digests; 6 seeds, seed 4 lost at the forest final)', () => {
  // Digests of `walkRun({ k, create: { gift, garrison: true }, knack: () => null })` at 8d72788b (before the castle), 23.10.2026; Колдун v1's
  // flag was off there (RT_WARLOCK_V1_ON on since 23.10.2026), so the walk passes `warlockV1: false`.
  const before: Record<number, number> = { 1: 1589059432, 2: 1602273783, 3: 1574596048, 4: 1197861252, 5: 2606597032, 6: 2534719147 };
  for (let k = 1; k <= 6; k++) {
    const lose = k % 4 === 0 ? { loseAt: (_run: RtRunState, type: string) => type === 'boss' } : {};
    const w = walk(k, false, { ...lose, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, castle: false, warlockV1: false } });
    assert(w.digest === before[k], `seed ${k}: the digest ${w.digest} (was ${before[k]})`);
    assert(w.run.castle === undefined && w.run.castleLevel === undefined, `seed ${k}: no castle field`);
  }
});

check('the castle walked to its end: every arena the castle\'s by its pools — «Прихожая» first, its second fight with the wardrobes, «Анфилада» only after the wardrobe; «Бальный зал» on the checkpoint and hard nodes, «Зал колдуна» on the boss; the Warlock wins the run; every state reads back', () => {
  const arenas = new Set<string>();
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const deep: [string, boolean][] = [];
    const result = walk(k, true, { each: state => {
      assert(readsBack(state), `seed ${k}: a state reads back`);
      const p = state.pending;
      if (p?.kind === 'battle' && rtCastleNodeId(p.nodeId)) deep.push([p.arena, rtArenaLoadout(state).deep === true]);
    } });
    const run = result.run;
    assert(run.result?.outcome === 'victory' && rtCastleNodeId(run.result.nodeId) && rtNode(run, run.result.nodeId)?.type === 'boss', `seed ${k}: the Warlock wins (${JSON.stringify(run.result)})`);
    const picks = run.picks.filter(pick => rtCastleNodeId(pick.nodeId) && pick.arena);
    assert(picks.length >= 4 && picks.every(pick => CASTLE_RUN_ARENAS.includes(pick.arena!)), `seed ${k}: the castle's arenas (${picks.map(p => p.arena)})`);
    const ordinary = picks.filter(pick => ['battle', 'breakthrough', 'event'].includes(rtNode(run, pick.nodeId)!.type)).map(pick => pick.arena!);
    assert(ordinary[0] === 'c-hall', `seed ${k}: the first ordinary fight is «Прихожая» (${ordinary})`);
    for (const pick of picks) {
      const node = rtNode(run, pick.nodeId)!, before = picks.slice(0, picks.indexOf(pick)).map(p => p.arena!);
      if (node.type === 'checkpoint' || node.type === 'hard') assert(pick.arena === CASTLE_HARD_ARENA, `seed ${k}: «Бальный зал» on ${node.id}`);
      if (node.type === 'boss') assert(pick.arena === CASTLE_FINAL_ARENA, `seed ${k}: «Зал колдуна» on ${node.id}`);
      if (pick.arena === 'c-enfilade') assert(before.filter(a => a === 'c-hall').length >= 2 || before.includes(CASTLE_HARD_ARENA), `seed ${k}: «Анфилада» after the wardrobe (${before})`);
      if (runRow(node.row) <= 2 && ['battle', 'breakthrough'].includes(node.type)) assert(pick.arena === 'c-hall', `seed ${k}: rows 1–2 play «Прихожая»`);
      assert(arenaSeed(run, pick.nodeId) === forestNodeSeed(castleSeed(run.seed), pick.nodeId.slice(2)), `seed ${k}: the castle's node seed`);
      arenas.add(pick.arena!);
    }
    // «Прихожая»: its first fight with the barrels, from its second the wardrobes (`castleDeep`).
    const halls = deep.filter(([arena]) => arena === 'c-hall');
    assert(halls.length >= 2 && !halls[0][1] && halls.slice(1).every(([, d]) => d), `seed ${k}: the hall deep from its second fight (${JSON.stringify(halls)})`);
    assert(rtRunWon(run) && rtRunWonLevel(run) === 3, 'the run is won, the castle passed');
  }
  assert(arenas.has('c-hall') && arenas.has('c-enfilade') && arenas.has(CASTLE_HARD_ARENA) && arenas.has(CASTLE_FINAL_ARENA), `the pools over 6 seeds (${[...arenas]})`);
});

check('the castle\'s fights: the row tables in the loadout (spec 4.4), basic elites, the bag from row 1, no second wind; the grace 0.5 s, the tough touch, no gentle row; the Warlock plays v1 only with the run\'s flag', () => {
  let seen = 0, warlock = 0;
  for (const k of [1, 2, 3]) {
    for (const v1 of [false, true]) {
      walk(k, true, { create: { gift: k % 2 ? 'full' : 'mini', garrison: true, castle: true, warlockV1: v1 }, each: state => {
        const pending = state.pending;
        if (pending?.kind !== 'battle' || !rtCastleNodeId(pending.nodeId)) return;
        const node = rtNode(state, pending.nodeId)!, row = Math.min(9, runRow(node.row)), kit = rtArenaLoadout(state);
        assert(kit.eliteAffixes === (row >= 7 ? 2 : 1) && kit.elitePlates === (row >= 6 ? 5 : 4) && kit.toughHp === Math.min(MAX_TOUGH_HP, row >= 6 ? 5 : 4), `seed ${k}, ${node.id}: the row table (${JSON.stringify(kit)})`);
        assert(JSON.stringify(kit.eliteKinds) === '["basic"]' && !kit.secondWind && kit.randomElites === (pending.battle !== 'final' && row >= 2), `seed ${k}, ${node.id}: basic elites from row 2, no second wind`);
        assert(!!kit.guaranteedElite === ((pending.battle === 'battle' || pending.battle === 'event') && node.type !== 'checkpoint' && row >= 3), `seed ${k}, ${node.id}: the guaranteed elite from row 3`);
        assert(!!kit.noBag === (node.type === 'checkpoint' || node.type === 'boss'), `seed ${k}, ${node.id}: the bag from row 1`);
        const params = rtArenaParams(rtArenaRules(state), rtRunParams(defaultParams()));
        assert(params.invulnerability === 0.5 && params.toughTouch && rtArenaRules(state).gentleRow === undefined, `seed ${k}, ${node.id}: the grace, the tough touch, no gentle row`);
        if (node.type === 'boss') { warlock++; assert(v1 ? params.warlockV1 === true : !('warlockV1' in params), `seed ${k}: the Warlock v1 only with the flag`); }
        seen++;
      } });
    }
  }
  assert(seen > 20 && warlock === 6, `castle fights seen (${seen}, the Warlock ${warlock})`);
});

check('a run with the omens: the castle\'s level omen rolled on «В замок» by the castle\'s seed; its fights\' omens; every state reads back', () => {
  let levels = 0;
  for (const k of [1, 2, 3, 4]) {
    const result = walk(k, true, { create: { gift: 'mini', garrison: true, castle: true, omens: [...RT_OMEN_IDS] }, each: state => assert(readsBack(state), `seed ${k}: a state reads back`) });
    const run = result.run;
    assert(run.castleLevel && run.omens, `seed ${k}: the castle with omens`);
    if (run.omens.level?.[3]) levels++;
  }
  assert(levels > 0, `some castle has its level omen (${levels} of 4)`);
});

check('the meta of a castle run: its fights ×3, «Бальный зал» 60, the Warlock 75, the victory +25 only at the castle\'s end; the record `wonLevel` 3 and level 3; the carry cap 60', () => {
  for (const k of [1, 2, 3]) {
    const won = walk(k, true).run;
    const lost = walk(k, true, { loseAt: run => rtLevel(run) === 3 && run.picks.filter(pick => rtCastleNodeId(pick.nodeId)).length >= 3 }).run;
    for (const run of [won, lost]) {
      const xp = rtRunXp(run), part = (id: string) => xp.parts.find(p => p.id === id)?.xp ?? 0;
      const want: Record<string, number> = { battles: 0, elite: 0, ballroom: 0, warlock: 0, castellan: 0 };
      for (const record of run.battles.filter(b => b.won)) {
        const type = rtNode(run, record.nodeId)!.type, level = rtNodeLevel(record.nodeId), f = level === 3 ? 3 : level === 2 ? 2 : 1;
        if (type === 'hard' || type === 'breakthrough') want.elite += 10 * f;
        else if (type === 'checkpoint') want.ballroom += level === 3 ? 60 : 0;
        else if (type === 'boss') { if (level === 3) want.warlock += 75; if (level === 2) want.castellan += 50; }
        else want.battles += 5 * f;
      }
      for (const id of Object.keys(want)) assert(part(id) === want[id], `seed ${k}: ${id} ${part(id)} / ${want[id]} (${JSON.stringify(xp.parts)})`);
      const end = rtApplyMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 10, won: true, xp: 100, level: 2, wonLevel: 2 } } } }, run).end;
      assert(end.record.after.level === 3 && end.record.after.wonLevel === (run === won ? 3 : 2) && end.carry.cap === 60, `seed ${k}: the castle's record and cap (${JSON.stringify(end.record)}, ${end.carry.cap})`);
      // A record of the castle beats a record that passed the garrison; the profile reads it back (`level` 3, `wonLevel` 3).
      assert(end.record.beaten, `seed ${k}: the castle beats «Гарнизон пройден»`);
    }
    assert(won.result?.outcome === 'victory' && rtRunXp(won).parts.some(p => p.id === 'victory' && p.xp === 25) && rtRunXp(won).parts.find(p => p.id === 'warlock')?.xp === 75, `seed ${k}: the Warlock +75 on his line, the victory +25`);
    assert(lost.result?.outcome === 'defeat' && !rtRunXp(lost).parts.some(p => p.id === 'victory') && rtRunWonLevel(lost) === 2, `seed ${k}: a run lost in the castle passed the garrison, no victory`);
  }
});

check('a death in the castle: the cause `warlock` at his fight, the common rules elsewhere (not the Jailer at «Бальный зал»); the run-end lines «Замок, ряд N», «Колдун не пройден», the killer', () => {
  const death = { source: 'touch', enemy: 'rook' };
  for (const k of [1, 2]) {
    const atWarlock = walk(k, true, { loseAt: (run, type) => rtLevel(run) === 3 && type === 'boss' }).run;
    assert(atWarlock.result?.outcome === 'defeat' && rtDeathCause(atWarlock) === 'warlock', `seed ${k}: the Warlock's cause (${rtDeathCause(atWarlock)})`);
    const lines = rtRunEndLines(atWarlock);
    assert(lines.length === 1 && lines[0].id === 'row' && lines[0].text === 'Замок, ряд 10 · Колдун не пройден', `seed ${k}: ${JSON.stringify(lines)}`);
    const atBall = walk(k, true, { loseAt: (run, type) => rtLevel(run) === 3 && type === 'checkpoint' }).run;
    assert(atBall.result?.outcome === 'defeat' && rtNode(atBall, atBall.result.nodeId)?.type === 'checkpoint' && rtDeathCause(atBall) === 'other', `seed ${k}: «Бальный зал» by the common rules (${rtDeathCause(atBall)})`);
    // A loss with its killing blow (the outcome as the view builds it): «Сразил: ладья», then the row.
    const touched = walk(k, true, { fight: run => {
      const p = run.pending!;
      if (p.kind !== 'battle' || !rtCastleNodeId(p.nodeId) || rtNode(run, p.nodeId)?.type === 'checkpoint' || run.picks.filter(pick => rtCastleNodeId(pick.nodeId)).length < 2) return null;
      return { nodeId: p.nodeId, won: false, hp: 0, kills: 5, damage: 15, time: 30, death };
    } }).run;
    const row = runRow(rtNode(touched, touched.result!.nodeId)!.row);
    assert(rtDeathCause(touched) === 'crowd' && JSON.stringify(rtRunEndLines(touched)) === JSON.stringify([{ id: 'killer', text: 'Сразил: ладья' }, { id: 'row', text: `Замок, ряд ${row}` }]), `seed ${k}: ${JSON.stringify(rtRunEndLines(touched))}`);
    const won = walk(k, true).run;
    assert(JSON.stringify(rtRunEndLines(won)) === JSON.stringify([{ id: 'row', text: 'Замок, ряд 10 · Колдун пройден' }]), `seed ${k}: the victory's line`);
  }
});

check('a malformed castle reads as no run: the flag without the garrison, the castle level without the flag or before the Castellan, «Подножие» without the flag, a castle node\'s arena that was not drawn', () => {
  let foothill: RtRunState | null = null, inCastle: RtRunState | null = null, fight: RtRunState | null = null;
  walk(2, true, { each: state => {
    if (!foothill && state.pending?.kind === 'foothill') foothill = state;
    if (!inCastle && rtLevel(state) === 3 && !state.pending) inCastle = state;
    if (!fight && state.pending?.kind === 'battle' && rtCastleNodeId(state.pending.nodeId) && state.picks.some(pick => rtCastleNodeId(pick.nodeId) && pick.nodeId !== (state.pending as { nodeId: string }).nodeId)) fight = state;
  } });
  assert(foothill && inCastle && fight, 'the walk passed the castle');
  const atFoot: RtRunState = foothill, castleRun: RtRunState = inCastle, open: RtRunState = fight;
  const mangle = (state: RtRunState, change: (copy: Record<string, unknown>) => void): RtRunState | null => { const copy = JSON.parse(serializeRtRun(state)); change(copy); return parseRtRun(JSON.stringify(copy)); };
  assert(parseRtRun(serializeRtRun(castleRun)) !== null, 'the castle reads');
  assert(mangle(createRtRun(seedOf(3), { garrison: false }), c => { c.castle = true; }) === null, 'the flag without the garrison');
  assert(mangle(castleRun, c => { delete c.castle; }) === null, 'the castle level without the flag');
  assert(mangle(castleRun, c => { c.castle = 1; }) === null, 'a flag of another value');
  assert(mangle(atFoot, c => { delete c.castle; }) === null, '«Подножие» without the flag');
  assert(mangle(atFoot, c => { c.pending = { kind: 'outskirts' }; }) === null, '«Предместье» after the Castellan');
  assert(mangle(castleRun, c => { delete c.castleLevel; }) === null, 'a castle path without its map');
  assert(mangle(castleRun, c => { (c.castleLevel as { streams: { pool: number } }).streams.pool++; }) === null, 'a castle pool count that was not drawn');
  const before = JSON.parse(serializeRtRun(atFoot)) as Record<string, unknown>;
  assert(mangle(atFoot, c => { c.castleLevel = JSON.parse(serializeRtRun(castleRun)).castleLevel; c.pending = null; c.visited = (before.visited as string[]).filter(id => !(id.startsWith('g:') && rtNode(atFoot, id)?.type === 'boss')); c.currentNodeId = (c.visited as string[]).at(-1); }) === null, 'the castle before the Castellan');
  const pickAt = (open.pending as { nodeId: string }).nodeId;
  assert(mangle(open, c => { const pick = (c.picks as { nodeId: string; arena: string }[]).find(p => p.nodeId === pickAt)!; const other = pick.arena === 'c-hall' ? 'c-enfilade' : 'c-hall'; pick.arena = other; (c.pending as { arena: string }).arena = other; }) === null, 'a castle arena that was not drawn');
  assert(mangle(open, c => { const pick = (c.picks as { nodeId: string; arena: string }[]).find(p => p.nodeId === pickAt)!; pick.arena = 'g-yard'; (c.pending as { arena: string }).arena = 'g-yard'; }) === null, 'a garrison arena at a castle node');
  // Entering a castle node from «Подножие» (no «В замок») is refused.
  assert(!rtEnterNode(atFoot, rtAvailableNodes(castleRun)[0].id).ok, 'no castle node before «В замок»');
});

check('telemetry: a castle fight\'s record keeps level 3 (a `c:` node only); the report\'s deaths by row tell the castle\'s rows («з N») after the garrison\'s', () => {
  const entry = (nodeId: string, row: number, level?: 2 | 3): FightEntry => ({
    record: { kind: 'fight', run: 'R1', fight: `f-${nodeId}`, nodeId, arena: 'c-hall', row, ...level ? { level } : {}, outcome: 'defeat', summary: {} },
    run: null, notes: [], journal: null, error: null, analysis: null, summaryDiff: [],
  } as unknown as FightEntry);
  const text = deathSection([entry('r7c1', 3), entry('g:r7c1', 3, 2), entry('c:r7c1', 3, 3), entry('c:r8c0', 4)]);
  const rows = text.split('### Смерти по рядам')[1].split('### Смерти по аренам')[0];
  assert(/\| г 3 \| 1 \|/.test(rows) && /\| з 3 \| 1 \|/.test(rows) && /\| з 4 \| 1 \|/.test(rows), rows);
  assert(rows.indexOf('| г 3 |') < rows.indexOf('| з 3 |') && rows.indexOf('| з 3 |') < rows.indexOf('| з 4 |'), 'the garrison first, then the castle');
  assert(fightLevel({ nodeId: 'c:r5c0' }) === 3 && fightLevel({ level: 3 }) === 3 && fightLevel({ nodeId: 'g:r5c0' }) === 2, 'the level');
  assert(checkRecord({ kind: 'fight', level: 3, nodeId: 'g:r5c0' }) !== null && checkRecord({ kind: 'fight', level: 2, nodeId: 'c:r5c0' }) !== null, 'a level only with its own nodes');
});

check("a profile whose record passed the castle has passed the garrison: the trophies' retro gives the Castellan's banner; «Поход дня» in the castle before its first node claims the garrison's depth, not «Замок, ряд 0» (3 seeds)", () => {
  for (const k of [1, 2, 3]) {
    let entered: RtRunState | null = null, first: RtRunState | null = null;
    const won = walk(k, true, { each: state => {
      if (!entered && rtLevel(state) === 3 && !state.pending) entered = state;
      if (!first && state.pending?.kind === 'battle' && rtCastleNodeId(state.pending.nodeId)) first = state;
    } }).run;
    assert(entered && first, `seed ${k}: the walk entered the castle`);
    const at: RtRunState = entered, open: RtRunState = first;
    const claim = rtDailyClaim(at);
    assert(claim.level === 2 && claim.row === 10 && claim.wonLevel === 2 && !rtDailyClaimText(claim).includes('ряд 0'), `seed ${k}: ${JSON.stringify(claim)} «${rtDailyClaimText(claim)}»`);
    const inCastle = rtDailyClaim(open);
    assert(inCastle.level === 3 && inCastle.row === runRow(rtNode(open, (open.pending as { nodeId: string }).nodeId)!.row) && rtDailyClaimText(inCastle).startsWith('Замок, ряд '), `seed ${k}: in the castle ${JSON.stringify(inCastle)}`);
    assert(rtDailyClaimText(rtDailyClaim(won)).startsWith('Замок пройден'), `seed ${k}: the castle passed`);
    const meta = rtApplyMeta(undefined, won).meta;
    delete meta.trophies; delete meta.trophiesSince;
    assert(meta.heroes.cat?.record?.wonLevel === 3, `seed ${k}: the record passed the castle`);
    assert(rtTrophiesImport(meta, 1).trophies?.some(t => t.id === 'castellan'), `seed ${k}: the Castellan's banner from a castle record`);
  }
});

check('«Летопись», the chapter «Замок» (task 58 rule 1): hidden until a hero\'s record reached the castle — then «Шкаф», «Ладья» and the boss «Колдун» (won in its run), the ref chapter:castle; the garrison\'s profile shows one blank «…» after it; without the castle in the build the book as before (3 seeds)', () => {
  const on = (castle?: boolean): RtChronicleOn => ({ gambler: false, monk: false, ...castle !== undefined ? { castle } : {} });
  const book = (meta: RtMeta, runs: number, castle?: boolean) => rtChronicleView({ meta, runs } as RtChronicleProfile, 'cat', on(castle));
  const chapters = (view: ReturnType<typeof book>, page: string) => view.pages.find(p => p.id === page)!.chapters.map(c => `${c.id}:${c.state}`);
  for (const k of [1, 2, 3]) {
    // A run of the garrison only (the Castellan ends it), then a run into the castle and through it — the meta written by their ends.
    const garrisonRun = walk(k, false).run, castleRun = walk(k, true).run;
    const afterGarrison = rtApplyMeta(undefined, garrisonRun, { viewerRun: 1, chronicle: true }).meta;
    // Without the castle in the build: the book is the build's of before (the default flag is off; the option off is the same).
    assert(JSON.stringify(book(afterGarrison, 1)) === JSON.stringify(book(afterGarrison, 1, false)), `seed ${k}: no castle in the build — the book as before`);
    assert(!chapters(book(afterGarrison, 1, false), 'bestiary').some(c => c.startsWith('castle') || c.startsWith('blank')), `seed ${k}: no castle chapter, no blank (${chapters(book(afterGarrison, 1, false), 'bestiary')})`);
    // With the castle: the garrison's profile has one blank chapter for the next level (no name, no entries, no count).
    const blank = book(afterGarrison, 1, true);
    assert(JSON.stringify(chapters(blank, 'bestiary').slice(-1)) === '["blank-3:blank"]' && JSON.stringify(chapters(blank, 'bosses').slice(-1)) === '["blank-3:blank"]', `seed ${k}: «…» after the garrison (${chapters(blank, 'bestiary')})`);
    assert(JSON.stringify(blank.total) === JSON.stringify(book(afterGarrison, 1, false).total), `seed ${k}: the blank adds no count`);
    // The castle run: its end opens the chapter (ref chapter:castle), the Warlock won in its run; the view's meeting writes the rook.
    const end = rtApplyMeta(afterGarrison, castleRun, { viewerRun: 2, chronicle: true });
    assert(end.end.chronicle?.added.includes('chapter:castle') && end.end.chronicle.added.includes('boss:warlock') && end.end.chronicle.added.every(isRtChronicleRef), `seed ${k}: ${end.end.chronicle?.added}`);
    const meta = { ...end.meta, chronicle: rtChronicleMeet(end.meta.chronicle, { kinds: ['rook', 'barrel'], affixes: [] }).chronicle };
    const back = parseRtChronicle(JSON.parse(JSON.stringify(meta.chronicle)));
    assert(back?.kinds?.includes('rook') && !back.kinds.includes('barrel') && back.bosses?.warlock?.won === 2 && back.unread?.includes('chapter:castle') && back.unread.includes('kind:rook'), `seed ${k}: the chronicle reads back (${JSON.stringify(back)})`);
    const view = book(meta, 2, true), bestiary = view.pages.find(p => p.id === 'bestiary')!, bosses = view.pages.find(p => p.id === 'bosses')!;
    const castle = bestiary.chapters.find(c => c.id === 'castle')!, warlock = bosses.chapters.find(c => c.id === 'castle')!;
    assert(castle.level === 3 && JSON.stringify(castle.entries) === JSON.stringify([{ id: 'wardrobe', state: 'unknown' }, { id: 'rook', state: 'seen' }]), `seed ${k}: «Шкаф», «Ладья» (${JSON.stringify(castle)})`);
    assert(JSON.stringify(warlock.entries) === JSON.stringify([{ id: 'warlock', state: 'won', run: 2 }]), `seed ${k}: «Колдун» won in run 2 (${JSON.stringify(warlock)})`);
    assert(!chapters(view, 'bestiary').some(c => c.startsWith('blank')), `seed ${k}: no blank after the last level`);
    const before = book(meta, 2, false).pages.find(p => p.id === 'bestiary')!;
    assert(bestiary.known === before.known + 2 && bosses.known === book(meta, 2, false).pages.find(p => p.id === 'bosses')!.known + 1, `seed ${k}: the counts grow by the chapter (${bestiary.known} / ${before.known})`);
    // The owl's hint may name the castle (a place, not the kind): `hint_castle` for the wardrobe not met.
    const hints = Array.from({ length: 40 }, (_, runs) => rtChronicleHint({ meta, runs } as RtChronicleProfile, 'cat', on(true))).filter(h => h?.key === 'hint_castle');
    assert(hints.length && hints.every(h => h!.target === 'kind:wardrobe'), `seed ${k}: the castle's hint (${JSON.stringify(hints[0])})`);
    assert(!Array.from({ length: 40 }, (_, runs) => rtChronicleHint({ meta: afterGarrison, runs } as RtChronicleProfile, 'cat', on(true))).some(h => h?.key === 'hint_castle' || h?.target === 'boss:warlock'), `seed ${k}: no castle hint before the castle`);
  }
});

console.log(`castle run: ${checks} checks passed`);
