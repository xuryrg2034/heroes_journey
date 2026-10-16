/**
 * Casino stage 1, item 2 — «Ставка клятвы» (sim/oath.ts, run/rtRun.ts; docs/realtime-casino.md, «Ставка клятвы»; research
 * 2.3 K8 and 8.5). Node only: `npm run test:realtime-oath`.
 *
 * The fights play journalled commands (place, crystal, begin / drag, release, jump, energy, goals, teleport, walk, clear …)
 * and read what the player gets: the oath's flag in the world (the tick of the event), the HUD line, the door's multiplier
 * and the payout:
 * - every oath of the catalogue kept and broken through real actions: chains of 2 vs 3 enemy links after the first, a
 *   jump, a touch after the goals, a crystal taken by a chain, damage 2 vs 3, an armoured elite killed in its window, a
 *   dash reaching 6 enemy links (calibration 12.10.2026: «Цепь 6+ хотя бы раз»; a dash stopped by a survivor, 5 links,
 *   a plate taken counts as П4 counts it); П4's «потолок» waits for it;
 * - a «never» oath breaks in the tick of the event, the fight goes on; an «at least once» oath is checked at the door;
 * - the payout ×2 / ×0.5 through `purseResources` (the cap 6 / 1; without an oath 3);
 * - the run: offers only on oath nodes (run row 2+, not the Jailer, not bosses, not events), «Элита в окне» only where the
 *   guaranteed elite comes; offers vary over seeds; a reload re-rolls nothing (the preview, the offer, the oath in the
 *   loadout); a version 6 save loads into version 7; a forged offer is no run; since 12.10.2026 the run offers
 *   «Цепь 6+ хотя бы раз» where it offered «Без прыжков» and never «Без прыжков»; a save of df42809 with an open battle
 *   under «Без прыжков» loads and plays as before (fixture `rt-run-save-before-chain6.json`);
 * - off by default: a journal without the value plays the same world (everything but the params); every fight replays;
 * - task 5 (12.10.2026): the run offers no oaths — no node card shows them, an oath is refused on entering, the counter of
 *   the oath stream still moves one per entered oath node (old and new saves check the same); a save with an oath already
 *   sworn (fixture) loads and its arena plays without the oath. The run-layer checks above turn the stake on explicitly.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { rtChooseKnack } from '../run/rtRun';
import { registerArena } from './arenas';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { oathLine, oathMark, OATH_IDS, OATHS, type OathId, type OathState } from './oath';
import { defaultParams, type Params } from './params';
import { doorPayout, greedLine, purseResources } from './purse';
import { Simulation, replay } from './simulation';
import { killEnemy, type WorldEvent } from './world';
import {
  arenaPreview, createRtRun, migrateRun, parseRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick,
  rtChooseHammer, rtChooseTalisman, rtEnterNode, rtEventView, rtGiftView, rtGuaranteedElite, rtNode, rtOathNode, rtOathOffer, rtOathPreview, rtOathText, rtRestHeal, rtRunParams, rtShopLeave,
  serializeRtRun, RT_OATH_IDS, RT_OATH_IDS_BEFORE, RT_RUN_FORCED, RT_RUN_VERSION, type RtRunState, type RtRunStep,
} from '../run/rtRun';
import saveBeforeChain6 from '../../../tests/fixtures/rt-run-save-before-chain6.json';
import { runRow } from '../run/arenaPools';
import { createRtRunStore, RT_RUN_STORAGE_KEY, RT_RUN_STORAGE_KEY_V6, type RunStorage } from '../run/rtRunStorage';
import { createFightObserver } from '../telemetry/observe';
import { stepChoices } from '../telemetry/recorder';
import { OATH_STAKE_SOURCE, withSummaryDefaults } from '../telemetry/schema';
import type { Journal } from './simulation';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/**
 * Task 5 (12.10.2026): the run offers no oaths (`RT_RUN_FORCED.oathStake` off) and plays no cauldron. The run layer's oath
 * code stays (a future return, the saves of before): its checks below turn the stake on explicitly — the node card
 * (`previewOn`, `enterOn`) and the arena (`runOn`: the run's values with the cauldron and the stake on). What the run does
 * now is the check «task 5: the run offers no oaths».
 */
const previewOn = (run: RtRunState, node: Parameters<typeof rtOathPreview>[1]): OathId[] | null => rtOathPreview(run, node, true);
const enterOn = (run: RtRunState, nodeId: string, oath: OathId | null = null): RtRunStep => rtEnterNode(run, nodeId, oath, { oathStake: true });
const runOn = (): Params => ({ ...rtRunParams(quiet()), purse: true, oathStake: true });

registerArena({
  id: 'oath-field', name: 'Поле клятвы', summary: 'Тест клятвы', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

registerArena({
  id: 'oath-buttons', name: 'Кнопка клятвы', summary: 'Тест клятвы', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [{ x: 7.3, y: 6 }], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

/** A quiet fight with the cauldron and the oath stake on: no newcomers, nobody walks or touches, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.purse = true; p.oathStake = true;
  return Object.assign(p, extra);
}
/** A fight on the field under `oath` (through the loadout, as the run passes it). */
function field(oath: OathId | null, params: Params = quiet(), k = 1, extra: Loadout = {}): Simulation {
  const loadout: Loadout = { ...extra, ...oath ? { oath } : {} };
  const sim = new Simulation({ arena: 'oath-field', params, seed: seedOf(k), record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  return sim;
}
type Pt = { x: number; y: number };
/** A row of links from the hero along y = 6, 1.4 apart: a number — an enemy of that HP, `crystal`, `elite` (armoured, HP 0). */
function lay(sim: Simulation, spec: readonly (number | 'crystal' | 'elite')[], from = sim.world.hero.x, y = 6): Pt[] {
  return spec.map((s, i) => {
    const x = from + 1.4 * (i + 1);
    if (s === 'crystal') { sim.command({ t: 'crystal', x, y, value: 6 }); return { x, y }; }
    sim.command({ t: 'place', x, y, color: 0, hp: s === 'elite' ? 0 : s, kind: 'basic', ...s === 'elite' ? { elite: true } : {} });
    return { x, y };
  });
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
/** Ticks until the hero stands again (at least one), collecting the events. */
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/**
 * The hero (put back at the start) draws a chain through `spec` and releases it; returns the tick of the release and the
 * events of the dash (the release's own events included).
 */
function chain(sim: Simulation, spec: readonly (number | 'crystal' | 'elite')[], links = spec.length): { tick: number; events: WorldEvent[] } {
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const points = lay(sim, spec);
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(sim.world.chain.length === links, `the chain took ${sim.world.chain.length} links, wanted ${links}`);
  const tick = sim.world.tick, events: WorldEvent[] = [...sim.world.events];
  sim.world.events.length = 0;
  sim.command({ t: 'release' });
  events.push(...sim.world.events);
  sim.world.events.length = 0;
  settle(sim, events);
  return { tick, events };
}
/** The goals (if not yet), then the hero walks into the open door. Returns the events of the exit. */
function exitDoor(sim: Simulation): WorldEvent[] {
  const w = sim.world, out: WorldEvent[] = [];
  if (w.stage !== 'greed') sim.command({ t: 'goals' });
  out.push(...w.events); w.events.length = 0;
  sim.command({ t: 'teleport', x: 16.5, y: 6 });
  sim.command({ t: 'walk', x: 1, y: 0 });
  ticks(sim, 600, out);
  assert(w.status === 'victory', `the hero walked into the door (${w.status})`);
  return out;
}
/** A basic enemy at the hero touches until the hero has lost `total` HP in the fight; then it is gone. Returns the hit ticks. */
function hurtTo(sim: Simulation, total: number): number[] {
  const w = sim.world, at: number[] = [];
  sim.command({ t: 'place', x: w.hero.x + 0.4, y: w.hero.y, color: 1, hp: 3, kind: 'basic' });
  for (let i = 0; i < 2000 && w.stats.damageTaken < total && w.status === 'playing'; i++) {
    sim.tick();
    if (of(w.events, 'hit').length) at.push(w.tick - 1);
    w.events.length = 0;
  }
  assert(w.stats.damageTaken === total, `the hero lost ${w.stats.damageTaken}, wanted ${total}`);
  sim.command({ t: 'clear', keepMarked: false });
  return at;
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** The door's `oath` event of the exit. */
function doorOath(events: readonly WorldEvent[]): Ev<'oath'> {
  const door = of(events, 'oath').filter(e => e.action === 'door');
  assert(door.length === 1, `one door settlement: ${door.length}`);
  return door[0];
}

// ---- The catalogue: kept and broken through real actions ----

check('the catalogue: the six of stage 1 and «Цепь 6+ хотя бы раз» (12.10.2026); «at least once» — the crystal, the elite, the long chain; the run offers all but «Без прыжков»', () => {
  assert(same(OATH_IDS, ['chains3', 'no-jump', 'clean-after-goals', 'crystal-chain', 'damage2', 'elite-window', 'chain6']), `ids ${OATH_IDS}`);
  assert(same(OATHS.filter(def => def.once).map(def => def.id), ['crystal-chain', 'elite-window', 'chain6']), 'the «at least once» oaths');
  assert(same(RT_OATH_IDS, ['chains3', 'chain6', 'clean-after-goals', 'crystal-chain', 'damage2', 'elite-window']), `the run's offers ${RT_OATH_IDS}`);
  assert(same(RT_OATH_IDS_BEFORE, ['chains3', 'no-jump', 'clean-after-goals', 'crystal-chain', 'damage2', 'elite-window']), 'the run\'s offers of df42809');
  assert(rtOathText('chain6') === 'Цепь 6+ хотя бы раз — Хотя бы раз рывок цепи бьёт 6+ врагов.', `the card: ${rtOathText('chain6')}`);
});

check('«Цепи 3+»: the first chain is free; 3 enemy links after it keep the oath, 2 break it in the release\'s tick; the fight goes on', () => {
  const kept = field('chains3');
  chain(kept, [0]);
  chain(kept, [0, 0, 0]);
  chain(kept, [0, 'crystal', 0, 0], 4);
  assert(kept.world.oath!.broken === undefined && oathMark(kept.world)!.mark === 'holds', 'kept so far');
  assert(oathLine(kept.world) === 'Клятва: цепи 3+ ✓', `the line: ${oathLine(kept.world)}`);
  const door = doorOath(exitDoor(kept));
  assert(door.kept === true && door.mult === 2 && kept.world.purse!.door!.oath === 2, 'kept at the door: ×2');

  const broken = field('chains3');
  chain(broken, [0]);
  chain(broken, [0, 0, 0]);
  const { tick, events } = chain(broken, [0, 0]);
  const flag = of(events, 'oath');
  assert(flag.length === 1 && flag[0].action === 'broken' && flag[0].tick === tick && broken.world.oath!.broken === tick, `broken in the release's tick ${tick}: ${JSON.stringify(flag)}`);
  assert(broken.world.status === 'playing' && oathLine(broken.world) === 'Клятва: цепи 3+ ×0,5', `the fight goes on, the line dims: ${oathLine(broken.world)}`);
  chain(broken, [0, 0, 0, 0]);
  assert(broken.world.oath!.broken === tick, 'a later good chain does not mend it');
  const end = doorOath(exitDoor(broken));
  assert(end.kept === false && end.mult === 0.5 && broken.world.purse!.door!.oath === 0.5, 'broken at the door: ×0.5');
  assert(replays(kept) && replays(broken), 'replay');
});

check('«Без прыжков»: a jump breaks it in the jump\'s tick; without a jump it is kept', () => {
  const kept = field('no-jump');
  chain(kept, [0, 0]);
  assert(doorOath(exitDoor(kept)).kept === true, 'no jump — kept');
  const broken = field('no-jump'), w = broken.world;
  broken.command({ t: 'energy', value: 7 });
  const tick = w.tick;
  assert(broken.command({ t: 'jump', x: 8, y: 6 }) === true, 'the jump started');
  assert(w.oath!.broken === tick && of(w.events, 'oath')[0]?.action === 'broken', 'broken in the jump\'s tick');
  settle(broken);
  assert(w.status === 'playing' && oathMark(w)!.mark === 'broken', 'the fight goes on');
  assert(doorOath(exitDoor(broken)).mult === 0.5, '×0.5 at the door');
  assert(replays(kept) && replays(broken), 'replay');
});

check('«Без урона после целей»: a touch before the goals keeps it, a touch after the goals breaks it in the hit\'s tick', () => {
  const params = quiet({ contactDamage: 1 });
  const kept = field('clean-after-goals', params);
  hurtTo(kept, 2);
  assert(kept.world.oath!.broken === undefined, 'damage before the goals does not count');
  assert(doorOath(exitDoor(kept)).kept === true, 'kept');
  const broken = field('clean-after-goals', params);
  broken.command({ t: 'goals' });
  const [hit] = hurtTo(broken, 1);
  assert(broken.world.oath!.broken === hit, `broken in the hit's tick ${hit}: ${broken.world.oath!.broken}`);
  assert(broken.world.status === 'playing' && doorOath(exitDoor(broken)).mult === 0.5, 'the fight goes on; ×0.5');
  assert(replays(kept) && replays(broken), 'replay');
});

check('«Не больше 2 урона»: 2 HP lost keep it, the 3rd breaks it in that hit\'s tick', () => {
  const params = quiet({ contactDamage: 1 });
  const kept = field('damage2', params);
  hurtTo(kept, 2);
  assert(kept.world.oath!.broken === undefined && oathMark(kept.world)!.mark === 'holds', 'two HP — kept');
  assert(doorOath(exitDoor(kept)).kept === true, 'kept at the door');
  const broken = field('damage2', params);
  const hits = hurtTo(broken, 3);
  assert(hits.length === 3 && broken.world.oath!.broken === hits[2], `broken by the 3rd hit (${hits}): ${broken.world.oath!.broken}`);
  assert(doorOath(exitDoor(broken)).mult === 0.5, '×0.5');
  assert(replays(kept) && replays(broken), 'replay');
});

check('«Кристалл в цепи» (at least once): met in the dash\'s tick when a chain breaks a crystal; not met — broken at the door\'s tick', () => {
  const kept = field('crystal-chain');
  assert(oathMark(kept.world)!.mark === 'waits' && oathLine(kept.world) === 'Клятва: кристалл в цепи', 'waits: no ✓ yet');
  const { events } = chain(kept, [0, 'crystal', 0]);
  const met = of(events, 'oath');
  assert(met.length === 1 && met[0].action === 'met' && kept.world.oath!.met === met[0].tick, `met in the dash: ${JSON.stringify(met)}`);
  assert(oathLine(kept.world) === 'Клятва: кристалл в цепи ✓', 'now ✓');
  assert(doorOath(exitDoor(kept)).kept === true, 'kept');
  const broken = field('crystal-chain');
  chain(broken, [0, 0, 0]);
  assert(broken.world.oath!.broken === undefined, 'not broken during the fight');
  broken.command({ t: 'goals' });
  broken.command({ t: 'teleport', x: 16.5, y: 6 });
  broken.command({ t: 'walk', x: 1, y: 0 });
  let doorTick = -1;
  for (let i = 0; i < 600 && broken.world.status === 'playing'; i++) { broken.tick(); if (of(broken.world.events, 'victory').length) doorTick = broken.world.tick - 1; broken.world.events.length = 0; }
  assert(broken.world.status === 'victory' && broken.world.oath!.broken === doorTick && broken.world.purse!.door!.oath === 0.5, `broken in the door's tick ${doorTick}: ${broken.world.oath!.broken}`);
  assert(replays(kept) && replays(broken), 'replay');
});

check('«Элита в окне» (at least once): an armoured elite killed in its window meets it; no such kill — broken at the door', () => {
  const params = quiet({ eliteArmor: true, elitePlates: 1 });
  const kept = field('elite-window', params);
  chain(kept, ['elite']);
  assert(kept.world.oath!.met === undefined, 'a plate taken does not meet it');
  const { events } = chain(kept, ['elite']);
  assert(of(events, 'eliteDown')[0]?.inWindow === true && kept.world.oath!.met !== undefined, 'the kill in the window meets it');
  assert(doorOath(exitDoor(kept)).kept === true, 'kept');
  const broken = field('elite-window', params);
  chain(broken, ['elite']);
  assert(doorOath(exitDoor(broken)).kept === false && broken.world.purse!.door!.oath === 0.5, 'only the plate — broken at the door');
  assert(replays(kept) && replays(broken), 'replay');
});

check('«Цепь 6+ хотя бы раз» (at least once): met in the tick the dash reaches its 6th enemy link; links the dash did not reach do not count', () => {
  const kept = field('chain6');
  assert(oathMark(kept.world)!.mark === 'waits' && oathLine(kept.world) === 'Клятва: цепь 6+', `waits, no ✓: ${oathLine(kept.world)}`);
  chain(kept, [0, 0, 0, 0, 0]);
  assert(kept.world.oath!.met === undefined && kept.world.oath!.links === undefined, '5 links: not met, the count ends with the dash');
  // 6 drawn, the dash stops on the 3rd (a shaman's empowering while the dash runs, stood in by raising its HP — as the
  // button check below): it reaches 3 links of 6.
  const stopped = field('chain6'), w = stopped.world;
  const points = lay(stopped, [0, 0, 0, 0, 0, 0]);
  stopped.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) stopped.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === 6, 'six drawn');
  const third = w.enemies.find(e => e.id === w.chain[2].id)!;
  stopped.command({ t: 'release' });
  third.hp = 5;
  settle(stopped);
  assert(w.enemies.includes(third) && w.oath!.met === undefined && w.oath!.links === undefined, 'a dash stopped by a survivor after 3 links does not meet it');
  // A crystal is no enemy link: 6 enemies around a crystal meet it, in the tick of the 6th link's hit.
  const { events } = chain(kept, [0, 0, 'crystal', 0, 0, 0, 0]);
  const hits = events.flatMap((e, i) => e.type === 'chainHit' ? [i] : []), met = events.findIndex(e => e.type === 'oath' && e.action === 'met');
  // The flag comes with the 6th link's hit (its event just before the hit's own `chainHit`), not earlier.
  assert(hits.length === 6 && met > hits[4] && met < hits[5] && events.slice(met, hits[5]).every(e => e.type !== 'chainHit'), `met with the 6th link (hits at ${hits}, met at ${met})`);
  assert(kept.world.oath!.met === (events[met] as Ev<'oath'>).tick && kept.world.oath!.links === undefined, 'the flag in the tick of the event');
  assert(oathLine(kept.world) === 'Клятва: цепь 6+ ✓', `now ✓: ${oathLine(kept.world)}`);
  const door = doorOath(exitDoor(kept));
  assert(door.kept === true && door.mult === 2 && kept.world.purse!.door!.oath === 2, 'kept at the door: ×2');
  // Not met: chains of 5 only — broken in the door's tick, ×0.5.
  const broken = field('chain6');
  chain(broken, [0, 0, 0, 0, 0]);
  chain(broken, [0, 0, 0, 0, 0]);
  assert(broken.world.oath!.broken === undefined, 'not broken during the fight');
  const end = exitDoor(broken), brokenAt = of(end, 'oath').find(e => e.action === 'broken');
  assert(brokenAt && broken.world.oath!.broken === brokenAt.tick && doorOath(end).kept === false && broken.world.purse!.door!.oath === 0.5, 'broken at the door: ×0.5');
  assert(oathLine(broken.world) === 'Клятва: цепь 6+ ×0,5', `the line dims: ${oathLine(broken.world)}`);
  assert(replays(kept) && replays(broken), 'replay');
});

check('«Цепь 6+ хотя бы раз»: the links П4 counts — a plate taken off an armoured elite is a link; a link that fell before the dash too', () => {
  const plates = field('chain6', quiet({ eliteArmor: true, elitePlates: 2 }));
  chain(plates, [0, 0, 0, 0, 0, 'elite']);
  assert(plates.world.oath!.met !== undefined && plates.world.enemies.some(e => e.elite), '5 kills and a plate taken (the elite stands): met');
  assert(replays(plates), 'replay');
  // A link killed ahead of the dash (a sapper's blast, stood in by `killEnemy` as the button check above stands in a shaman)
  // is passed fallen: it counts.
  const fallen = field('chain6'), w = fallen.world;
  fallen.command({ t: 'teleport', x: 4.5, y: 6 });
  const points = lay(fallen, [0, 0, 0, 0, 0, 0]);
  fallen.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) fallen.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  const last = w.enemies.find(e => e.id === w.chain[5].id)!;
  fallen.command({ t: 'release' });
  killEnemy(w, last, { source: 'blast', credited: true });
  settle(fallen);
  assert(w.move === null && w.oath!.met !== undefined && w.stats.kills === 6, `5 struck and 1 fallen: met ${w.oath!.met}`);
});

check('П4 «потолок» waits for «Цепь 6+ хотя бы раз»: no cap on the goal line while it waits; met — the cap 6 of the kept oath', () => {
  const sim = field('chain6', quiet({ greedByDeeds: true }));
  fill(sim, 600);
  sim.command({ t: 'goals' });
  assert(oathMark(sim.world)!.mark === 'waits' && !greedLine(sim.world)!.includes('потолок'), `waits: no cap (${greedLine(sim.world)})`);
  chain(sim, [0, 0, 0, 0, 0, 0]);
  assert(oathMark(sim.world)!.mark === 'holds' && greedLine(sim.world)!.endsWith('потолок 6'), `met: the cap 6 (${greedLine(sim.world)})`);
});

// ---- The payout ----

/** Chains of 5 weak links until the cauldron holds `target`. */
function fill(sim: Simulation, target: number): void { while ((sim.world.purse?.cauldron ?? 0) < target) chain(sim, [0, 0, 0, 0, 0]); }

check('the payout: a kept oath ×2 up to 6 resources, a broken one ×0.5 down to the cap 1, none — 3 (purseResources, doorPayout)', () => {
  const run = (oath: OathId | null, jump: boolean): { cauldron: number; m: number; paid: number } => {
    const sim = field(oath);
    fill(sim, 200);
    if (jump) { sim.command({ t: 'energy', value: 7 }); sim.command({ t: 'jump', x: 6, y: 8 }); settle(sim); }
    exitDoor(sim);
    const door = sim.world.purse!.door!;
    assert(doorPayout(door).length === purseResources(door.cauldron, door.oath, 1, door.rate), 'the run pays the function');
    assert(replays(sim), 'replay');
    return { cauldron: door.cauldron, m: door.oath, paid: doorPayout(door).length };
  };
  const kept = run('no-jump', false), broken = run('no-jump', true), none = run(null, false);
  assert(kept.m === 2 && kept.paid === 6, `kept: ${JSON.stringify(kept)}`);
  assert(broken.m === 0.5 && broken.paid === 1, `broken: ${JSON.stringify(broken)}`);
  assert(none.m === 1 && none.paid === 3, `no oath: ${JSON.stringify(none)}`);
  // A small cauldron: ×2 doubles it, ×0.5 halves it (⌊котёл × M ÷ 60⌋).
  assert(purseResources(90, 2) === 3 && purseResources(90, 0.5) === 0 && purseResources(90) === 1, 'the multiplier inside the floor');
});

// ---- The sandbox command, off by default ----

check('the sandbox command: an oath from now (journalled), none again; nothing while `oathStake` is off', () => {
  const sim = field(null, quiet({ oathStake: false })), cur = (): OathState | undefined => sim.world.oath;
  assert(sim.command({ t: 'oath', id: 'no-jump' }) === false && !cur(), 'off: no oath');
  sim.command({ t: 'param', key: 'oathStake', value: true });
  assert(sim.command({ t: 'oath', id: 'no-jump' }) === true && cur()?.id === 'no-jump', 'on: the oath from now');
  assert(sim.command({ t: 'oath', id: 'no-such-oath' }) === false && cur()?.id === 'no-jump', 'an unknown id is ignored');
  sim.command({ t: 'energy', value: 7 });
  sim.command({ t: 'jump', x: 7, y: 6 });
  settle(sim);
  assert(cur()?.broken !== undefined, 'the jump broke it');
  assert(sim.command({ t: 'oath', id: 'damage2' }) === true && cur()!.broken === undefined, 'a new oath starts fresh');
  assert(sim.command({ t: 'oath', id: null }) === true && !cur(), 'none again');
  assert(replays(sim), 'the sandbox fight replays');
});

check('off by default: a journal without the value plays the same world; the loadout\'s oath does nothing; no `world.oath`', () => {
  assert(defaultParams().oathStake === false && RT_RUN_FORCED.oathStake === false && rtRunParams({ ...defaultParams(), oathStake: true }).oathStake === false, 'off in the sandbox by default, off in the run (task 5)');
  for (let k = 1; k <= 3; k++) {
    const old = quiet({ oathStake: false, contactDamage: 1 }) as Partial<Params>;
    delete old.oathStake;
    const a = field('no-jump', quiet({ oathStake: false, contactDamage: 1 }), k), b = field('no-jump', old as Params, k);
    for (const sim of [a, b]) {
      chain(sim, [0, 'crystal', 0]);
      sim.command({ t: 'energy', value: 7 });
      sim.command({ t: 'jump', x: 7, y: 7 });
      settle(sim);
      hurtTo(sim, 1);
      const events = exitDoor(sim);
      assert(!sim.world.oath && !of(events, 'oath').length && sim.world.purse!.door!.oath === 1, 'no oath, the door ×1');
    }
    const strip = (sim: Simulation) => { const s = worldState(sim.world) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    assert(strip(a) === strip(b), `seed ${k}: the same world without the key`);
    assert(!('oath' in (worldState(a.world) as Record<string, unknown>)), 'no oath field in the hash');
    const journal = b.exportJournal()!;
    assert(!('oathStake' in journal.params), 'the journal has no key');
    assert(replay(JSON.parse(JSON.stringify(journal)) as Journal).hash() === b.hash(), 'the old journal replays');
  }
});

check('the logs: the fight summary keeps the oath, its broken tick, kept or not and the multiplier; an old summary reads as no oath', () => {
  const sim = field('no-jump');
  sim.command({ t: 'energy', value: 7 });
  const tick = sim.world.tick;
  sim.command({ t: 'jump', x: 7, y: 6 });
  settle(sim);
  exitDoor(sim);
  const journal = sim.exportJournal()!;
  const replayed = new Simulation({ arena: journal.arena, params: JSON.parse(JSON.stringify(journal.params)) as Params, seed: journal.seed, ...journal.loadout ? { loadout: journal.loadout } : {} });
  const observer = createFightObserver(replayed.world);
  let next = 0;
  const upTo = (t: number) => { while (next < journal.commands.length && journal.commands[next].tick <= t) { const c = journal.commands[next++].cmd; replayed.command(c); observer.command(c, replayed.world); } };
  for (let t = 0; t < journal.ticks; t++) { upTo(t); replayed.tick(); observer.tick(replayed.world); replayed.world.events.length = 0; }
  upTo(journal.ticks);
  const oath = observer.summary().oath;
  assert(same(oath, { id: 'no-jump', kept: false, brokenTick: tick, metTick: null, mult: 0.5 }), `summary ${JSON.stringify(oath)}`);
  assert(same(withSummaryDefaults({}).oath, { id: null, kept: null, brokenTick: null, metTick: null, mult: null }), 'an old record: no oath');
});

// ---- The run ----

function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}
function takeGift(run: RtRunState): RtRunState {
  const view = rtGiftView(run)!, first = view.options.find(entry => entry.available);
  let next = ok(rtChooseGift(run, first ? first.index : null), 'gift');
  const open = rtGiftView(next);
  if (open && open.chosen !== null) next = ok(rtChooseGiftPick(next, open.picks[0]), 'gift pick');
  return next;
}
/** Closes the open non-battle screen with a simple choice (a fake win for a battle). */
function closeNode(run: RtRunState): RtRunState {
  const pending = run.pending;
  if (pending?.kind === 'battle') return ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'fake win');
  if (pending?.kind === 'find') return ok(rtChooseFind(run, pending.options.find(item => !rtItemRefusal(run, item)) ?? pending.options[0]), 'find');
  if (pending?.kind === 'rest') return ok(rtRestHeal(run), 'rest');
  if (pending?.kind === 'shop') return ok(rtShopLeave(run), 'shop');
  if (pending?.kind === 'talisman') return ok(rtChooseTalisman(run, null), 'talisman');
  if (pending?.kind === 'hammer') return ok(rtChooseHammer(run, null), 'hammer');
  // Task 50: the knack screen (RT_KNACKS_ON) is passed over.
  if (pending?.kind === 'knack') return ok(rtChooseKnack(run, null), 'knack');
  if (pending?.kind === 'event') { const safe = rtEventView(run)!.options.find(option => option.safe && option.available)!; return ok(rtChooseEventOption(run, safe.id), 'event'); }
  if (pending?.kind === 'gift') return takeGift(run);
  return run;
}
interface Seen { nodeId: string; type: string; row: number; offer: OathId[] | null; elite: boolean }
/**
 * A whole run by the run's commands: at every available node the preview is read (and must survive a save), the node is
 * entered under the first offered oath when `swear` (else «Без клятвы»), the save loads back.
 */
function walk(seed: number, pickNode: (nodes: number) => number, swear: boolean): { seen: Seen[]; run: RtRunState } {
  let run = createRtRun(seed, { gift: 'mini' });
  const seen: Seen[] = [];
  for (let step = 0; step < 200 && !run.result; step++) {
    if (run.pending) { run = closeNode(run); continue; }
    const nodes = rtAvailableNodes(run), node = nodes[pickNode(nodes.length) % nodes.length];
    const preview = previewOn(run, node), loaded = parseRtRun(serializeRtRun(run))!;
    assert(same(previewOn(loaded, node), preview), 'a reload shows the same offer');
    const oath = swear && preview ? preview[0] : null;
    run = ok(enterOn(run, node.id, oath), 'enter');
    const pending = run.pending;
    const offer = pending?.kind === 'battle' ? pending.oathOffer ?? null : null;
    assert(same(offer, preview), `${node.id} (${node.type}): the offer is the preview`);
    seen.push({ nodeId: node.id, type: node.type, row: runRow(node.row), offer, elite: pending?.kind === 'battle' && !!rtArenaLoadout(run).guaranteedElite });
    if (pending?.kind === 'battle') {
      assert(rtArenaLoadout(run).oath === (oath ?? undefined), 'the oath goes into the loadout');
      const back = parseRtRun(serializeRtRun(run));
      assert(back && same(back, run) && rtArenaLoadout(back).oath === rtArenaLoadout(run).oath, 'the open battle loads back with its oath');
    }
  }
  return { seen, run };
}

check('the run: oaths only on battle nodes from run row 2 (not the Jailer, not bosses, not events); two different ones; «Элита в окне» only where the guaranteed elite comes', () => {
  let offered = 0, eliteOffered = 0, eliteNodes = 0;
  for (let k = 1; k <= 40; k++) {
    const { seen } = walk(seedOf(k), n => k % n, k % 2 === 0);
    for (const s of seen) {
      const eligible = ['battle', 'hard', 'breakthrough'].includes(s.type) && s.row >= 2;
      assert(!!s.offer === eligible, `${s.nodeId} ${s.type} row ${s.row}: offer ${JSON.stringify(s.offer)}`);
      if (!s.offer) continue;
      offered++;
      assert(s.offer.length === 2 && new Set(s.offer).size === 2, `two different: ${s.offer}`);
      if (s.elite) eliteNodes++;
      if (s.offer.includes('elite-window')) { eliteOffered++; assert(s.elite, `${s.nodeId}: «Элита в окне» without the guaranteed elite`); }
    }
  }
  assert(offered >= 100 && eliteNodes >= 40 && eliteOffered >= 5, `offered ${offered}, elite nodes ${eliteNodes}, «Элита в окне» ${eliteOffered}`);
  // The rule by node: the checkpoint, the boss, an event never; a row-1 battle never; «Застава» has no guaranteed elite.
  assert(!rtOathNode({ type: 'checkpoint', row: 9 }) && !rtOathNode({ type: 'boss', row: 14 }) && !rtOathNode({ type: 'event', row: 9 }) && !rtOathNode({ type: 'battle', row: 5 }), 'not eligible');
  assert(rtOathNode({ type: 'battle', row: 6 }) && rtOathNode({ type: 'hard', row: 8 }) && rtOathNode({ type: 'breakthrough', row: 13 }), 'eligible');
  assert(!rtGuaranteedElite({ type: 'hard', row: 8 }, 'hard') && rtGuaranteedElite({ type: 'battle', row: 7 }, 'battle') && !rtGuaranteedElite({ type: 'battle', row: 6 }, 'battle'), 'the guaranteed elite');
});

check('the offers vary over seeds and nodes; the stream is the run\'s own (one draw per oath node, the forest streams untouched)', () => {
  const pairs = new Set<string>();
  for (let k = 1; k <= 20; k++) {
    const { seen, run } = walk(seedOf(k + 100), () => 0, false);
    for (const s of seen) if (s.offer) pairs.add([...s.offer].sort().join('+'));
    assert(run.oathDraws === seen.filter(s => s.offer).length, `seed ${k}: one draw per oath node`);
    // The forest streams count what they counted before the oaths: the pool one draw per arena.
    assert(run.streams.pool === run.picks.filter(pick => pick.arena !== undefined).length, 'the pool stream as before');
  }
  assert(pairs.size >= 10, `pairs seen: ${pairs.size}`);
});

check('since 12.10.2026 the run offers «Цепь 6+ хотя бы раз» where it offered «Без прыжков», never «Без прыжков»; every other offer is as before', () => {
  let chain6 = 0, same6 = 0, offers = 0;
  for (let k = 1; k <= 30; k++) {
    const { seen, run } = walk(seedOf(k + 1200), n => k % n, k % 3 === 0);
    let n = 0;
    for (const s of seen) {
      if (!s.offer) continue;
      offers++;
      assert(!s.offer.includes('no-jump'), `${s.nodeId}: «Без прыжков» offered ${s.offer}`);
      // The draw of the list of df42809 for the same node and draw, «Без прыжков» read as «Цепь 6+».
      const before = rtOathOffer(run.seed, n++, rtNode(run, s.nodeId)!, RT_OATH_IDS_BEFORE, !!run.gentleEntry).map(id => id === 'no-jump' ? 'chain6' : id);
      assert(same(before, s.offer), `${s.nodeId}: ${s.offer} — before ${before}`);
      if (s.offer.includes('chain6')) chain6++; else same6++;
    }
  }
  assert(offers >= 100 && chain6 >= 15 && same6 >= 50, `offers ${offers}: with «Цепь 6+» ${chain6}, unchanged ${same6}`);
  // «Без прыжков» is refused at a node card now.
  let run = takeGift(createRtRun(seedOf(1250), { gift: 'mini' }));
  for (let step = 0; step < 80; step++) {
    if (run.pending) { run = closeNode(run); continue; }
    const node = rtAvailableNodes(run).find(entry => previewOn(run, entry));
    if (!node) { run = ok(enterOn(run, rtAvailableNodes(run)[0].id), 'enter'); continue; }
    assert(!enterOn(run, node.id, 'no-jump').ok, '«Без прыжков» is no offer');
    return;
  }
  throw new Error('no oath node met');
});

check('a save of df42809 with an open battle sworn «Без прыжков» (fixture) loads byte for byte and plays as before: a jump breaks it, no jump keeps it; the next node offers the new list', () => {
  const text = saveBeforeChain6.save, run = parseRtRun(text)!;
  assert(run && serializeRtRun(run) === text, 'loads, saves back byte for byte');
  const pending = run.pending;
  assert(pending?.kind === 'battle' && same(pending.oathOffer, ['no-jump', 'elite-window']) && pending.oath === 'no-jump', `the open battle: ${JSON.stringify(pending)}`);
  assert(rtArenaLoadout(run).oath === 'no-jump', 'the arena plays under «Без прыжков»');
  // A forged twin: the same save with «Цепь 6+» sworn though «Без прыжков» was offered — no run.
  assert(parseRtRun(text.replace('"oath":"no-jump"', '"oath":"chain6"')) === null, 'an oath outside the old offer is no run');
  const play = (jump: boolean) => {
    const sim = field(null, runOn(), 1, rtArenaLoadout(run));
    assert(sim.world.oath?.id === 'no-jump', 'under the oath');
    fill(sim, 400);
    if (jump) { sim.command({ t: 'energy', value: 7 }); sim.command({ t: 'jump', x: 6, y: 8 }); settle(sim); }
    exitDoor(sim);
    assert(replays(sim), 'replay');
    return sim.world.purse!.door!;
  };
  const kept = play(false), broken = play(true);
  assert(kept.oath === 2 && doorPayout(kept).length === 6 && broken.oath === 0.5 && doorPayout(broken).length === 1, `kept ${kept.oath}, broken ${broken.oath}`);
  let next = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1, purse: kept }), 'resolve');
  let seen = 0;
  for (let step = 0; step < 60 && !next.result && seen < 3; step++) {
    if (next.pending) { next = closeNode(next); continue; }
    const nodes = rtAvailableNodes(next);
    for (const node of nodes) { const offer = previewOn(next, node); if (offer) { seen++; assert(offer.every(id => RT_OATH_IDS.includes(id)), `the new list: ${offer}`); } }
    next = ok(enterOn(next, nodes[0].id), 'enter');
  }
  assert(seen >= 1, `offers after the old battle: ${seen}`);
});

check('a reload re-rolls nothing: the preview, the offer on entering and the oath in the arena\'s loadout are the same after save → load', () => {
  let checked = 0;
  for (let k = 1; k <= 10; k++) {
    let run = takeGift(createRtRun(seedOf(k + 300), { gift: 'mini' }));
    for (let step = 0; step < 80 && !run.result; step++) {
      if (run.pending) { run = closeNode(run); continue; }
      const node = rtAvailableNodes(run).find(entry => previewOn(run, entry));
      if (!node) { run = ok(enterOn(run, rtAvailableNodes(run)[0].id), 'enter'); continue; }
      const offer = previewOn(run, node)!;
      const loaded = parseRtRun(serializeRtRun(run))!;
      const a = ok(enterOn(run, node.id, offer[1]), 'enter'), b = ok(enterOn(loaded, node.id, offer[1]), 'enter after a reload');
      assert(same(a, b), 'the same run after a reload');
      const loadout = rtArenaLoadout(parseRtRun(serializeRtRun(a))!);
      assert(loadout.oath === offer[1] && same(arenaPreview(run, node), arenaPreview(loaded, node)), 'the arena\'s oath after a reload');
      assert(!enterOn(run, node.id, OATH_IDS.find(id => !offer.includes(id))!).ok, 'an oath not offered is refused');
      checked++;
      break;
    }
  }
  assert(checked === 10, `checked ${checked}`);
});

check('the save: version 7 with the counter; a version 6 save loads into version 7 (migrated, under the old key too); a forged offer or oath is no run', () => {
  assert(RT_RUN_VERSION === 7 && RT_RUN_STORAGE_KEY === 'ashen-oath-rt-run-v7' && RT_RUN_STORAGE_KEY_V6 === 'ashen-oath-rt-run-v6', 'version and keys');
  let migrated = 0, forged = 0;
  for (let k = 1; k <= 12; k++) {
    const { run } = walk(seedOf(k + 500), n => k % n, true);
    // Back to the moment of an open oath battle: walk again and stop there.
    let at = createRtRun(seedOf(k + 500), { gift: 'mini' });
    for (let step = 0; step < 200 && !at.result; step++) {
      if (at.pending?.kind === 'battle' && at.pending.oathOffer && at.visited.length >= 2) break;
      if (at.pending) { at = closeNode(at); continue; }
      const nodes = rtAvailableNodes(at), node = nodes[k % nodes.length], preview = previewOn(at, node);
      at = ok(enterOn(at, node.id, preview ? preview[0] : null), 'enter');
    }
    for (const state of [run, at]) {
      // The phase B save of the same run: no counter, no offer, version 6.
      const v6 = JSON.parse(serializeRtRun(state)) as Record<string, unknown> & { pending: Record<string, unknown> | null };
      delete v6.oathDraws; v6.version = 6;
      if (v6.pending) { delete v6.pending.oathOffer; delete v6.pending.oath; }
      const storage = memoryStorage({ [RT_RUN_STORAGE_KEY_V6]: JSON.stringify(v6) });
      const store = createRtRunStore(storage), loaded = store.load();
      assert(loaded && loaded.version === 7 && loaded.oathDraws === state.oathDraws, `seed ${k}: migrated (${loaded?.oathDraws} / ${state.oathDraws})`);
      assert(same(migrateRun(v6), JSON.parse(JSON.stringify(loaded))), 'the migration is the load');
      // It plays on: the next node enters; the save goes under the new key.
      let next = loaded;
      if (next.pending) next = closeNode(next);
      if (!next.result && rtAvailableNodes(next).length) next = ok(enterOn(next, rtAvailableNodes(next)[0].id), 'enter after the migration');
      assert(store.save(next) && storage.getItem(RT_RUN_STORAGE_KEY) !== null && same(store.load(), next), 'saved under -v7');
      store.clear();
      assert(storage.getItem(RT_RUN_STORAGE_KEY_V6) === null && store.load() === null, 'clear removes both');
      migrated++;
    }
    if (at.pending?.kind === 'battle' && at.pending.oathOffer) {
      // An oath of the run's list outside the offer (not «Без прыжков»: an offer with it in place of «Цепь 6+» is an older save's).
      const offer = at.pending.oathOffer, other = RT_OATH_IDS.find(id => !offer.includes(id))!;
      const edit = (change: (copy: RtRunState & { pending: Record<string, unknown> }) => void): string => { const copy = structuredClone(at) as RtRunState & { pending: Record<string, unknown> }; change(copy); return serializeRtRun(copy); };
      for (const bad of [
        edit(copy => { copy.pending.oath = other; }),
        edit(copy => { copy.pending.oathOffer = [offer[1], offer[0]]; }),
        edit(copy => { copy.pending.oathOffer = [offer[0], other]; copy.pending.oath = offer[0]; }),
        edit(copy => { copy.oathDraws += 1; }),
        edit(copy => { delete (copy as Partial<RtRunState>).oathDraws; }),
      ]) { assert(parseRtRun(bad) === null, `seed ${k}: a forged save accepted`); forged++; }
    }
  }
  assert(migrated === 24 && forged >= 40, `migrated ${migrated}, forged ${forged}`);
});

check('the logs of the run: the node card\'s choice is a run choice `oath-stake` (offered, taken, refused)', () => {
  let run = takeGift(createRtRun(seedOf(900), { gift: 'mini' }));
  for (let step = 0; step < 80; step++) {
    if (run.pending) { run = closeNode(run); continue; }
    const node = rtAvailableNodes(run).find(entry => previewOn(run, entry));
    if (!node) { run = ok(enterOn(run, rtAvailableNodes(run)[0].id), 'enter'); continue; }
    const offer = previewOn(run, node)!, step1 = enterOn(run, node.id, offer[0]), step2 = enterOn(run, node.id, null);
    assert(step1.ok && step2.ok, 'entered');
    const taken = stepChoices(run, step1), refused = stepChoices(run, step2);
    assert(same(taken, [{ nodeId: node.id, source: OATH_STAKE_SOURCE, offered: offer, taken: [offer[0]], refused: [offer[1]] }]), `taken ${JSON.stringify(taken)}`);
    assert(same(refused, [{ nodeId: node.id, source: OATH_STAKE_SOURCE, offered: offer, taken: [], refused: offer }]), `«Без клятвы» ${JSON.stringify(refused)}`);
    return;
  }
  throw new Error('no oath node met');
});

check('«Цепи 3+»: a chain ending on an unpressed button never breaks it — a button is pressed only by a chain (design answer 11.10.2026)', () => {
  const sim = new Simulation({ arena: 'oath-buttons', params: quiet(), seed: seedOf(3), record: true, loadout: { oath: 'chains3' } });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const one = (): void => { sim.command({ t: 'teleport', x: 4.5, y: 6 }); const id = sim.command({ t: 'place', x: 5.9, y: 6, color: 0, hp: 0, kind: 'basic' }) as number; const e = sim.world.enemies.find(x => x.id === id)!; sim.command({ t: 'begin', x: e.x, y: e.y }); };
  one(); sim.command({ t: 'release' }); settle(sim);
  one(); sim.command({ t: 'drag', x: 7.3, y: 6, mode: 'full' });
  assert(sim.world.chain.length === 2 && sim.world.chain[1].kind === 'object', 'one enemy and the button');
  sim.command({ t: 'release' }); settle(sim);
  assert(sim.world.objects.some(o => o.kind === 'button' && o.pressed) && sim.world.oath!.broken === undefined, 'the button is pressed, the oath holds');
  one(); sim.command({ t: 'release' }); settle(sim);
  assert(sim.world.oath!.broken !== undefined, 'a short chain without a button breaks it');
  assert(replays(sim), 'replay');
});

check('«Цепи 3+»: a short chain to a button whose dash stops before it (a survivor) breaks the oath at the dash\'s end (review 11.10.2026)', () => {
  const sim = new Simulation({ arena: 'oath-buttons', params: quiet(), seed: seedOf(4), record: true, loadout: { oath: 'chains3' } });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const one = (): void => { sim.command({ t: 'teleport', x: 4.5, y: 6 }); const id = sim.command({ t: 'place', x: 5.9, y: 6, color: 0, hp: 0, kind: 'basic' }) as number; const e = sim.world.enemies.find(x => x.id === id)!; sim.command({ t: 'begin', x: e.x, y: e.y }); };
  one(); sim.command({ t: 'release' }); settle(sim);
  one(); sim.command({ t: 'drag', x: 7.3, y: 6, mode: 'full' });
  const link = sim.world.enemies.find(e => e.id === sim.world.chain[0].id)!;
  sim.command({ t: 'release' });
  // A shaman's empowering while the dash runs (`shamanEmpowerHp`), stood in by raising the link's HP: the dash stops on it.
  link.hp = 5;
  assert(sim.world.oath!.broken === undefined && sim.world.oath!.button === true, 'decided later, not at the release');
  settle(sim);
  assert(!sim.world.objects.some(o => o.kind === 'button' && o.pressed), 'the button is not pressed');
  assert(sim.world.oath!.broken !== undefined && sim.world.oath!.button === undefined, 'broken at the dash\'s end');
});

check('every available node offers its own pair (the node id is mixed in): the path decides the stake; a pair is two different oaths', () => {
  let differs = 0, nodes = 0;
  for (let k = 1; k <= 12; k++) {
    let run = takeGift(createRtRun(seedOf(k + 900), { gift: 'mini' }));
    for (let step = 0; step < 30; step++) {
      if (run.pending) { run = closeNode(run); continue; }
      const offers = rtAvailableNodes(run).map(n => previewOn(run, n)).filter((o): o is NonNullable<typeof o> => !!o);
      for (const o of offers) { nodes++; assert(o.length === 2 && o[0] !== o[1], `two different oaths: ${o}`); }
      if (new Set(offers.map(o => o.join())).size > 1) { differs++; break; }
      const next = rtAvailableNodes(run)[0]; if (!next) break;
      run = ok(enterOn(run, next.id), 'enter');
    }
  }
  assert(nodes > 0 && differs >= 6, `nodes with offers ${nodes}; runs where available nodes differ ${differs} of 12`);
});

check('a run arena under an oath (the stake and the cauldron turned on over the run\'s values — the run itself has neither since task 5): the arena of the node plays it, the door records it, the run layer pays', () => {
  let done = 0;
  for (let k = 1; k <= 8; k++) {
    let run = takeGift(createRtRun(seedOf(k + 700), { gift: 'mini' }));
    for (let step = 0; step < 80 && !done; step++) {
      if (run.pending) { run = closeNode(run); continue; }
      const node = rtAvailableNodes(run).find(entry => previewOn(run, entry)?.includes('chain6'));
      if (!node) { const next = rtAvailableNodes(run)[0]; if (!next) break; run = ok(enterOn(run, next.id), 'enter'); continue; }
      run = ok(enterOn(run, node.id, 'chain6'), 'enter under «Цепь 6+ хотя бы раз»');
      const pending = run.pending!;
      assert(pending.kind === 'battle', 'a battle');
      // The run's params and loadout on the quiet field (the run reads the finished world as main.ts does).
      const sim = field(null, runOn(), k, rtArenaLoadout(run));
      assert(sim.world.oath?.id === 'chain6', 'the arena is under the oath');
      chain(sim, [0, 0, 0, 0, 0, 0]);
      assert(sim.world.oath?.met !== undefined, 'a chain of 6 met it');
      // The run's rate is 120 (12.10.2026): a cauldron of 400 × 2 pays the cap 6.
      fill(sim, 400);
      exitDoor(sim);
      const door = sim.world.purse!.door!;
      assert(door.oath === 2 && door.rate === 120, 'kept: ×2, the run\'s rate');
      const before = Object.values(run.materials).reduce((a, b) => a + b, 0);
      const after = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: sim.world.hero.hp, kills: 0, damage: 0, time: 1, purse: door }), 'resolve');
      assert(Object.values(after.materials).reduce((a, b) => a + b, 0) - before === doorPayout(door).length && doorPayout(door).length === 6, 'the run gets 6');
      assert(replays(sim), 'the run fight replays');
      done++;
    }
    if (done) break;
  }
  assert(done === 1, 'a run arena under «Цепь 6+ хотя бы раз» played');
});

check('task 5 (12.10.2026): the run offers no oaths — no node card, an oath refused on entering, the counter still one per entered oath node (the save loads back); an old save with an oath sworn loads and its arena plays without it', () => {
  let oathNodes = 0;
  for (let k = 1; k <= 12; k++) {
    let run = createRtRun(seedOf(k + 1900), { gift: 'mini' });
    for (let step = 0; step < 200 && !run.result; step++) {
      if (run.pending) { run = closeNode(run); continue; }
      const nodes = rtAvailableNodes(run), node = nodes[k % nodes.length];
      assert(nodes.every(n => rtOathPreview(run, n) === null), `seed ${k}: no node card offers an oath`);
      if (rtOathNode(node)) {
        oathNodes++;
        // What the card would have offered with the stake on: refused now, the node enters without it.
        const would = rtOathPreview(run, node, true)!;
        assert(would.length === 2 && !rtEnterNode(run, node.id, would[0]).ok, `seed ${k}: an oath is refused`);
      }
      const before = run.oathDraws;
      run = ok(rtEnterNode(run, node.id), 'enter');
      assert(run.oathDraws === before + (rtOathNode(node) ? 1 : 0), `seed ${k}: the counter moves one per oath node`);
      const pending = run.pending;
      if (pending?.kind === 'battle') assert(pending.oathOffer === undefined && pending.oath === undefined && rtArenaLoadout(run).oath === undefined, 'no offer, no oath');
      const back = parseRtRun(serializeRtRun(run));
      assert(back && same(back, run), `seed ${k}: the save loads back`);
    }
    assert(run.streams.pool === run.picks.filter(pick => pick.arena !== undefined).length, 'the pool stream as before');
  }
  assert(oathNodes >= 40, `oath nodes entered: ${oathNodes}`);
  // The save of df42809 (an open battle sworn «Без прыжков»): it loads; the loadout keeps the oath, the run's arena does not play it.
  const old = parseRtRun(saveBeforeChain6.save)!;
  assert(old && old.pending?.kind === 'battle' && old.pending.oath === 'no-jump' && rtArenaLoadout(old).oath === 'no-jump', 'the old save loads with its oath');
  const sim = field(null, rtRunParams(quiet()), 1, rtArenaLoadout(old));
  assert(sim.world.oath === undefined && !sim.world.params.oathStake && !sim.world.params.purse, 'the run arena: no oath, no cauldron');
  chain(sim, [0, 0, 0]);
  sim.command({ t: 'energy', value: 7 }); sim.command({ t: 'jump', x: 6, y: 8 }); settle(sim);
  const events = exitDoor(sim);
  assert(sim.world.status === 'victory' && !of(events, 'oath').length && sim.world.purse === undefined, 'won without an oath or a door record');
  assert(replays(sim), 'replay');
  const next = ok(resolveArena(old, { nodeId: old.pending.nodeId, won: true, hp: old.hp, kills: 0, damage: 0, time: 1 }), 'resolve');
  assert(rtAvailableNodes(next).every(n => rtOathPreview(next, n) === null), 'the next nodes offer nothing');
});

function memoryStorage(initial: Record<string, string> = {}): RunStorage {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

console.log(`realtime-oath: ${checks} checks passed`);
