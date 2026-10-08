/**
 * The fixed-step runner of the real-time simulation (stage 1 of the transition, docs/realtime-prototype.md,
 * «Ядро реального времени»).
 *
 * - **Tick.** One tick is `SIM_DT` = 1/60 s of game time. Focus (×0.25) and the finisher slow-motion (×0.2) do not
 *   shorten the tick: a tick stands for more real seconds (`SIM_DT ÷ scale`), so fewer ticks run per real second. The
 *   hit-stop is a run of frozen ticks: no game time passes, each takes `SIM_DT` of real time off the hit-stop.
 *   Walking, the dash, knockbacks, spawning — everything moves inside ticks only.
 * - **Frames.** The browser frame only pays real time into an accumulator (`advance`): each tick is paid at its own
 *   price, as many whole ticks run as the frame pays for (at most `MAX_TICKS_PER_FRAME`); what is left is kept as a
 *   share of the next tick (`alpha`, 0…1 — for drawing between ticks), not as seconds: when the price changes (the end of
 *   focus or of the slow-motion) the remainder never turns into extra game time.
 * - **Commands.** Input reaches the world only as commands (commands.ts), applied at once between ticks and journalled
 *   with the number of the tick they come before. `replay(journal)` rebuilds the same world: same seed + same journal
 *   → the same hash (hash.ts) after the same ticks, in the browser and in Node.
 */
import { arenaTemplate, type ArenaTemplate } from './arenas';
import { stepHero, tickScale } from './chain';
import { applyCommand, type Command, type CommandResult } from './commands';
import { hashWorld } from './hash';
import { copyParams, type Params } from './params';
import type { Loadout } from './kit';
import { createWorld, update, type HeroStart, type World } from './world';

/** Game seconds per tick. */
export const SIM_DT = 1 / 60;
/** A frame runs at most this many ticks; a longer stall is dropped (no spiral of catch-up ticks). */
export const MAX_TICKS_PER_FRAME = 8;
/** A tick may start this much real time early: at 60 Hz the frame time jitters around `SIM_DT`, one tick per frame stays. */
const EARLY = 0.002;

export const JOURNAL_VERSION = 1;

/** A command and the tick it was applied before. */
export interface JournalEntry { tick: number; cmd: Command }

/**
 * Everything a replay needs: the seed, the arena, the values the run started with, the hero's starting HP (a run arena),
 * the commands and the tick count. `hero` is optional: journals of stage 1 replay unchanged (version 1).
 */
export interface Journal {
  version: number;
  seed: number;
  arena: string;
  params: Params;
  /** Ticks run when the journal was taken; a replay runs exactly as many. */
  ticks: number;
  commands: JournalEntry[];
  /**
   * HP the hero entered the arena with (an arena of a run, stage 2 of the transition: the run's HP and maximum). Absent —
   * the panel's `heroHp`, full (the sandbox and journals before stage 2).
   */
  hero?: HeroStart;
  /** Stage 2, step 3: what the arena started with (consumables, energy …; kit.ts). Absent — nothing (journals before). */
  loadout?: Loadout;
}

export interface SimulationOptions {
  arena: ArenaTemplate | string;
  params: Params;
  seed: number;
  /** HP and maximum HP of the hero at the start (a run arena); absent — the panel's `heroHp`, full. */
  hero?: HeroStart;
  /** Stage 2, step 3: the arena's loadout (a run's consumables and energy; the sandbox's consumables). */
  loadout?: Loadout;
  /** Keep a journal of the commands (the browser always does; a replay does not need one). */
  record?: boolean;
  /** Called before every tick (the view saves positions to draw between ticks). */
  beforeTick?: (world: World) => void;
}

/** Deep copy of a command for the journal (the caller may reuse its objects). */
const cloneCommand = (cmd: Command): Command => JSON.parse(JSON.stringify(cmd)) as Command;

export class Simulation {
  readonly world: World;
  readonly seed: number;
  private readonly journal: Journal | null;
  private readonly beforeTick?: (world: World) => void;
  /** Share of the next tick already paid for (0…1; slightly below 0 after a tick that started early). */
  private acc = 0;

  constructor(options: SimulationOptions) {
    const arena = typeof options.arena === 'string' ? arenaTemplate(options.arena) : options.arena;
    this.seed = options.seed >>> 0;
    this.world = createWorld(arena, options.params, this.seed, options.hero, options.loadout);
    this.beforeTick = options.beforeTick;
    this.journal = options.record
      ? { version: JOURNAL_VERSION, seed: this.seed, arena: arena.id, params: copyParams(options.params), ticks: 0, commands: [], ...options.hero ? { hero: { ...options.hero } } : {}, ...options.loadout ? { loadout: JSON.parse(JSON.stringify(options.loadout)) as Loadout } : {} }
      : null;
  }

  /**
   * Applies a command now (between ticks) and journals it with the number of the next tick. `onlyIfChanged` — journal
   * it only when the check says the world changed (the held still pointer re-checked every frame: an append that took
   * nothing changes nothing, so leaving it out of the journal replays the same).
   */
  command(cmd: Command, options: { onlyIfChanged?: () => boolean } = {}): CommandResult {
    const entry: JournalEntry = { tick: this.world.tick, cmd: cloneCommand(cmd) };
    const result = applyCommand(this.world, cmd);
    if (this.journal && (!options.onlyIfChanged || options.onlyIfChanged())) this.journal.commands.push(entry);
    return result;
  }

  /** Real seconds the next tick costs: `SIM_DT ÷ scale` (a frozen hit-stop tick — `SIM_DT`). */
  nextTickCost(): number {
    return this.world.hitstop > 0 ? SIM_DT : SIM_DT / tickScale(this.world);
  }

  /** One fixed tick. */
  tick(): void {
    const world = this.world;
    this.beforeTick?.(world);
    if (world.hitstop > 0) {
      // Hit-stop (prototype stage C): the whole simulation waits; the tick only spends real time.
      world.hitstop = Math.max(0, world.hitstop - SIM_DT);
    } else {
      const realDt = SIM_DT / tickScale(world);
      stepHero(world, realDt);
      update(world, SIM_DT, realDt);
    }
    world.tick++;
  }

  /**
   * A frame: pays `realDt` real seconds for ticks, each at its own price (`nextTickCost` at the moment it runs).
   * The rest stays as a share of the next tick. Returns the number of ticks run.
   */
  advance(realDt: number, maxTicks = MAX_TICKS_PER_FRAME): number {
    let left = Math.max(0, realDt), ran = 0;
    while (ran < maxTicks) {
      const cost = this.nextTickCost(), need = (1 - this.acc) * cost;
      if (left < need - EARLY) { this.acc += left / cost; left = 0; break; }
      left -= need;
      this.acc = 0;
      this.tick();
      ran++;
      // Started early: the borrowed time is owed by the next tick, at its price.
      if (left < 0) { this.acc = left / this.nextTickCost(); left = 0; }
    }
    // A long stall is not caught up: what one frame cannot pay for is dropped.
    return ran;
  }

  /** How far the paid time is into the next tick, 0…1 (drawing between ticks). */
  get alpha(): number { return Math.max(0, Math.min(1, this.acc)); }

  /** Drops the paid time (pause, menu: the world waits). */
  resetClock(): void { this.acc = 0; }

  hash(): string { return hashWorld(this.world); }

  /** The journal so far (a copy), with the number of ticks run. Null when the simulation does not record. */
  exportJournal(): Journal | null {
    if (!this.journal) return null;
    return JSON.parse(JSON.stringify({ ...this.journal, ticks: this.world.tick })) as Journal;
  }
}

/**
 * Rebuilds a run from its journal: a fresh simulation with the journal's seed, arena and starting values; before every
 * tick the commands stamped with it are applied, then the tick runs; commands stamped after the last tick are applied
 * at the end. `onTick` sees the world after each tick (checkpoints).
 */
export function replay(journal: Journal, onTick?: (sim: Simulation) => void): Simulation {
  if (journal.version !== JOURNAL_VERSION) throw new Error(`journal version ${journal.version}, expected ${JOURNAL_VERSION}`);
  const sim = new Simulation({ arena: journal.arena, params: copyParams(journal.params), seed: journal.seed, ...journal.hero ? { hero: { ...journal.hero } } : {}, ...journal.loadout ? { loadout: JSON.parse(JSON.stringify(journal.loadout)) as Loadout } : {} });
  let next = 0;
  const applyUpTo = (tick: number): void => {
    while (next < journal.commands.length && journal.commands[next].tick <= tick) sim.command(journal.commands[next++].cmd);
  };
  for (let tick = 0; tick < journal.ticks; tick++) {
    applyUpTo(tick);
    sim.tick();
    onTick?.(sim);
  }
  applyUpTo(journal.ticks);
  return sim;
}
