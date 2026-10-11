/**
 * Test kit (Node only) for run features read from a finished fight: П10 «Личный рекорд» (record.spec.ts), П5 «Журнал удачи»
 * (luck.spec.ts). A run node's arena is played as a real fight — journalled commands on a quiet test field with the run's
 * params and loadout — and the outcome is read from the finished world as main.ts `recordRunArena` reads it; the fight's
 * chance is read from every tick's events as main.ts reads them every frame (`observeFightLuck`). The run goes on by its
 * own commands.
 */
import { registerArena } from '../sim/arenas';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, replay } from '../sim/simulation';
import type { World, WorldEvent } from '../sim/world';
import { goblinOf, leverOf } from '../sim/slot';
import { observeFightLuck, type RtLuckTally } from './rtLuck';
import {
  rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtChooseTalisman, rtDieChoose,
  rtEnterNode, rtEventView, rtGiftView, rtNode, rtRestHeal, rtRunParams, rtShopLeave, type RtArenaOutcome, type RtRunState, type RtRunStep,
} from './rtRun';

export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

registerArena({
  id: 'run-fight-field', name: 'Поле похода', summary: 'Тест боя похода', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
/** B6 К7 (chestRun.spec.ts): the same field with a cursed chest point, as «Застава» has one — below the hero, off the chains' row. */
export const RUN_CHEST_FIELD = 'run-chest-field';
export const RUN_CHEST_POINT = { x: 4.5, y: 9.5 };
registerArena({
  id: RUN_CHEST_FIELD, name: 'Поле похода с сундуком', summary: 'Тест проклятого сундука в походе', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999, chest: RUN_CHEST_POINT,
});

/** A quiet fight: no newcomers, nobody walks or touches, no hit-stop. The run's params go on top (`rtRunParams`). */
export function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}

/** Ticks while the world plays (at most `n`), handing every tick's events to `seen` before they go. */
export function ticks(sim: Simulation, n: number, seen?: (w: World) => void, until: (w: World) => boolean = () => false): void {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); seen?.(sim.world); sim.world.events.length = 0; }
}

/** A chain of `n` weak enemies laid in a row from the hero (journalled commands), drawn and released; ticks until the dash ends. */
export function chainOf(sim: Simulation, n: number, seen?: (w: World) => void): void {
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const points = Array.from({ length: n }, (_, i) => ({ x: 4.5 + 1.4 * (i + 1), y: 6 }));
  for (const p of points) sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(sim.world.chain.length === n, `the chain took ${sim.world.chain.length} of ${n} links`);
  sim.command({ t: 'release' });
  seen?.(sim.world); sim.world.events.length = 0;
  ticks(sim, 900, seen, w => !w.move);
}

export interface FightPlan {
  /** Chains drawn in order (kills each). */
  chains: readonly number[];
  /** Lose the fight: a ring of touching enemies takes the hero's HP. Else the goals and the walk into the door. */
  lose?: boolean;
  /** The fight's seed index (`seedOf`). */
  k?: number;
  /** The test field the fight plays on (B6 К7: `RUN_CHEST_FIELD`); absent — `run-fight-field`. */
  arena?: string;
  /** Journalled play before the chains (B6 К7: take the chest). */
  start?: (sim: Simulation, seen: (w: World) => void) => void;
  /** More journalled play after the chains (before the end). */
  play?: (sim: Simulation, seen: (w: World) => void) => void;
  /** Every tick's events, as the view's frame sees them. */
  seen?: (w: World) => void;
}

/** The finished world read as main.ts `recordRunArena` reads it (П10: `bestChain`; П5: the fight's `luck`, none — absent). */
export function outcomeOf(run: RtRunState, w: World, luck: RtLuckTally = {}): RtArenaOutcome {
  const pending = run.pending;
  assert(pending?.kind === 'battle', 'an open battle');
  return { nodeId: pending.nodeId, won: w.status === 'victory', hp: w.status === 'victory' ? Math.min(run.maxHp, w.hero.hp) : 0, kills: w.stats.kills, bestChain: w.stats.bestChain,
    ...Object.keys(luck).length ? { luck } : {}, damage: w.stats.damageTaken, time: w.endTime ?? w.time, ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials }, wardUsed: w.kit.wardUsed } : {},
    ...w.purse?.door ? { purse: JSON.parse(JSON.stringify(w.purse.door)) } : {}, ...w.params.doorDie ? { doorDie: true } : {}, ...w.curse ? { chest: true } : {} };
}

/** The open battle of `run` played on the quiet field by `plan`; it replays from its journal to the same hash. */
export function playFight(run: RtRunState, plan: FightPlan): { sim: Simulation; outcome: RtArenaOutcome; events: WorldEvent[] } {
  const sim = new Simulation({ arena: plan.arena ?? 'run-fight-field', params: rtRunParams(quiet()), seed: seedOf(plan.k ?? 1), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
  const luck: RtLuckTally = {}, events: WorldEvent[] = [];
  const seen = (w: World): void => { observeFightLuck(luck, w.events); events.push(...w.events); plan.seen?.(w); };
  sim.command({ t: 'clear', keepMarked: false });
  plan.start?.(sim, seen);
  for (const n of plan.chains) chainOf(sim, n, seen);
  plan.play?.(sim, seen);
  if (plan.lose) {
    // The quiet field's enemies stand and do not touch: the ring walks in and touches with the default numbers.
    sim.command({ t: 'param', key: 'contactDamage', value: defaultParams().contactDamage });
    sim.command({ t: 'param', key: 'enemySpeed', value: defaultParams().enemySpeed });
    const hero = sim.world.hero;
    for (let k = 0; k < 8; k++) sim.command({ t: 'place', x: hero.x + Math.cos(k * Math.PI / 4) * 0.6, y: hero.y + Math.sin(k * Math.PI / 4) * 0.6, color: k % 4, hp: 2, kind: 'basic' });
    ticks(sim, 60 * 60, seen);
    assert(sim.world.status === 'defeat', `the hero fell (${sim.world.status})`);
  } else {
    sim.command({ t: 'goals' });
    sim.command({ t: 'teleport', x: 16.5, y: 6 });
    sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(sim, 600, seen);
    assert(sim.world.status === 'victory', `the hero walked into the door (${sim.world.status})`);
  }
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'the fight replays from its journal');
  return { sim, outcome: outcomeOf(run, sim.world, luck), events };
}

/** «Однорукий гоблин» by the debug command (journalled; the run's params have the slot on) near the hero. */
export function summonGoblin(sim: Simulation): void {
  assert(sim.command({ t: 'slot' }) === true, 'the goblin stands');
}
/**
 * A bare pull (a chain of just the lever, no struck links): waits for the lever (its marker or cooldown, the spin), the
 * hero next to it, the dash; then the reels stop. Returns the pull's events.
 */
export function pullBare(sim: Simulation, seen: (w: World) => void): Extract<WorldEvent, { type: 'slot' }> {
  const w = sim.world, out: WorldEvent[] = [];
  const watch = (world: World): void => { out.push(...world.events); seen(world); };
  ticks(sim, 60 * 30, watch, world => { const g = goblinOf(world); return !!g && !g.spin && world.time + 1e-6 >= g.ready; });
  const lever = leverOf(w)!, dx = w.arena.width / 2 - lever.x, dy = w.arena.height / 2 - lever.y, d = Math.hypot(dx, dy) || 1;
  sim.command({ t: 'teleport', x: lever.x + dx / d * 1.2, y: lever.y + dy / d * 1.2 });
  assert(sim.command({ t: 'begin', x: lever.x, y: lever.y }) === true && w.chain.length === 1, 'a chain of just the lever');
  sim.command({ t: 'release' });
  watch(w); w.events.length = 0;
  ticks(sim, 900, watch, world => !world.move && !goblinOf(world)?.spin);
  const pull = out.find((ev): ev is Extract<WorldEvent, { type: 'slot' }> => ev.type === 'slot' && ev.action === 'pull');
  assert(pull, 'the dash pulled the lever');
  return pull;
}

export function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}
export function takeGift(run: RtRunState): RtRunState {
  const view = rtGiftView(run)!, first = view.options.find(entry => entry.available);
  let next = ok(rtChooseGift(run, first ? first.index : null), 'gift');
  const open = rtGiftView(next);
  if (open && open.chosen !== null) next = ok(rtChooseGiftPick(next, open.picks[0]), 'gift pick');
  return next;
}
/** Closes the open non-battle screen with a simple choice (the die — `roll`, «Забрать» by default). */
export function closeNode(run: RtRunState, roll = false): RtRunState {
  const pending = run.pending;
  if (pending?.kind === 'die') return ok(rtDieChoose(run, roll), roll ? 'roll' : 'take');
  if (pending?.kind === 'find') return ok(rtChooseFind(run, pending.options[0]), 'find');
  if (pending?.kind === 'rest') return ok(rtRestHeal(run), 'rest');
  if (pending?.kind === 'shop') return ok(rtShopLeave(run), 'shop');
  if (pending?.kind === 'talisman') return ok(rtChooseTalisman(run, null), 'talisman');
  if (pending?.kind === 'hammer') return ok(rtChooseHammer(run, null), 'hammer');
  if (pending?.kind === 'event') { const safe = rtEventView(run)!.options.find(option => option.safe && option.available)!; return ok(rtChooseEventOption(run, safe.id), 'event'); }
  if (pending?.kind === 'gift') return takeGift(run);
  return run;
}
/** The run walks (the first available node, screens closed by `closeNode`) until a battle is open. */
export function toBattle(run: RtRunState, roll = false): RtRunState {
  for (let step = 0; step < 300 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') return run;
    if (pending) { run = closeNode(run, roll); continue; }
    run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  }
  throw new Error(`no battle (node ${run.currentNodeId}, ${rtNode(run, run.currentNodeId ?? '')?.type})`);
}
