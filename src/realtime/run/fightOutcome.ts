/**
 * Task 51з «Поход дня» (docs/design-notes/task-51-camp-l3.md, 6.3): the outcome of a run fight (`RtArenaOutcome`) as a pure function of
 * the finished world and what was read from its ticks — moved out of the view (main.ts `recordRunArena`), so the proof's check replays a
 * fight's journal in Node and gets the same outcome the view fed to the run. No DOM, no rule of its own.
 *
 * - `RtFightWatch` — what a fight is read for while it plays: the enemies seen before each tick (`seen`, the killing blow's map of
 *   rtRunEnd.ts `RtDeathWatch`) and each tick's (or frame's) events (`read`: the luck tally, the killing blow, the boss's parts severed,
 *   the consumables used). The view reads the events of a frame (several ticks), the check those of each tick: the same events in the
 *   same order.
 * - `rtFightOutcome` — the outcome from the world at its end and the watch; `itemHint` — whether the arena's start showed the item hint
 *   (the run decides it: `rtItemHintDue` of the run before the fight).
 */
import { bagPayout } from '../sim/bag';
import { featOutcome } from '../sim/feat';
import type { World, WorldEvent } from '../sim/world';
import { observeFightLuck, type RtLuckTally } from './rtLuck';
import { RtDeathWatch } from './rtRunEnd';
import { rtShackleCuts, type RtArenaOutcome } from './rtRun';

/** What a run fight is read for while it plays (see the file's comment). */
export class RtFightWatch {
  /** The luck of the fight (rtLuck.ts `observeFightLuck`): the goblin's pulls, the armoured elites' loot. */
  luck: RtLuckTally = {};
  /** Task 28: the Jailer's weight severed (a `partSevered` event). */
  severed = false;
  /** Task 48: the boss's parts severed (`partSevered` events). */
  parts = 0;
  /** Iteration 2.1: the consumables used (`item` events). */
  itemsUsed = 0;
  /** Task 51г: the keymaster's shackles the dash cut (`tether` `cut` events of kind `shackle`) — `RtArenaOutcome.cuts`. */
  cuts = 0;
  /** `death` — the view's own watch may be shared (main.ts reads it for the end screen too). */
  constructor(readonly death: RtDeathWatch = new RtDeathWatch()) {}
  reset(): void { this.luck = {}; this.severed = false; this.parts = 0; this.itemsUsed = 0; this.cuts = 0; this.death.reset(); }
  /** Before every tick: the enemies on the arena (the killing blow's striker). */
  seen(world: World): void { this.death.seen(world); }
  /** After the ticks of a frame (the view) or of each tick (the check): their events. */
  read(world: World, events: readonly WorldEvent[]): void {
    observeFightLuck(this.luck, events);
    this.death.read(world, events);
    const severed = events.filter(e => e.type === 'partSevered').length;
    if (severed) this.severed = true;
    this.parts += severed;
    this.itemsUsed += events.filter(e => e.type === 'item').length;
    this.cuts += rtShackleCuts(events);
  }
}

/** The outcome of the finished fight `w` read by `watch` (the run puts the node id; main.ts `RunView.recordArena`). */
export function rtFightOutcome(w: World, watch: RtFightWatch, itemHint: boolean): Omit<RtArenaOutcome, 'nodeId'> {
  const death = watch.death;
  return {
    won: w.status === 'victory', hp: w.hero.hp, kills: w.stats.kills, bestChain: w.stats.bestChain, ...Object.keys(watch.luck).length ? { luck: watch.luck } : {},
    damage: w.stats.damageTaken, time: w.endTime ?? w.time,
    ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials }, wardUsed: w.kit.wardUsed, openItems: [...w.kit.openItems] } : {},
    ...w.secondWind ? { secondWind: true } : {}, kinds: death.kinds(w), ...death.elite(w) ? { elite: true } : {}, ...death.affixes(w).length ? { affixes: death.affixes(w) } : {},
    itemsUsed: watch.itemsUsed, itemHint, ...w.purse?.door ? { purse: JSON.parse(JSON.stringify(w.purse.door)) } : {}, ...w.params.doorDie ? { doorDie: true } : {}, ...w.curse ? { chest: true } : {},
    // Task 14 «Котомка у двери»: what the door paid for the bag's filled steps (the run adds it to its materials).
    ...bagPayout(w) ? { bag: bagPayout(w)! } : {},
    // Task 16 «Подвиги»: whether the fight did its feat (the run pays it on a victory; the record keeps it).
    ...featOutcome(w),
    // Task 28: the weight severed (the run keeps it only on a Jailer arena; a won fight offers 1 of 4).
    ...watch.severed ? { severed: true } : {},
    // Task 48: the Troll's parts severed (all three — the relic 1 of 4).
    ...watch.parts ? { parts: watch.parts } : {},
    // Task 51г: the shackles cut (Евлампий's arrival and quest); absent at 0.
    ...watch.cuts ? { cuts: watch.cuts } : {},
    ...w.status === 'defeat' && death.death ? { death: death.death } : {},
  };
}
