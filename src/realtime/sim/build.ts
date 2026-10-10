/**
 * The build layer of phase B (docs/realtime-phase-b.md, section 9, «Д0»): getters of the numbers the player's build may
 * change, and a registry of build modules — the counter talismans (sim/talismansRt.ts), the hammers (sim/hammers.ts) and
 * the relics (sim/relics.ts) — with the hooks the chain, the dash and the world step call. A module is a file that calls
 * `registerBuildModule` (imported by sim/buildModules.ts, or by a test): chain.ts, world.ts and items.ts are not edited.
 *
 * Rules of the layer:
 * - **Nothing taken — nothing changes.** A module acts only while the arena's kit holds its id (a talisman or relic in
 *   `Kit.talismans`, or `Kit.hammer`). Without an active module every getter returns the old number, no hook runs, and the
 *   layer writes no state: worlds and journals before phase B hash as before.
 * - **The plan is the dash.** `linkPower`, `afterLinkPower` and `modify.*` are pure: they read the world and return a number;
 *   `planChain` (the highlight) and the dash call the same ones with the same link context. They must not change the world
 *   (no counters, no events, no random draws). Everything that changes the world happens in the `on*` hooks, which run only
 *   when the action really happens.
 * - **State.** Arena-long numbers — `Kit.counters` (`counterOf` / `setCounter` / `addCounter`); structures (fire points …) —
 *   `World.build[moduleId]` (`buildStateOf` / `setBuildState`); the layer's own count of a dash — `HeroMove.build`. All are
 *   in the world hash and absent while empty. Numbers of the items are constants of the module, never `Params` (they are
 *   hashed and a run computes them once per load).
 * - **Order.** Modules run in the order they registered (sim/buildModules.ts: talismans, hammers, relics; then tests).
 * - No transcendental `Math.*` (detMath.ts); no new random streams.
 */
import type { StrikeOutcome } from './chain';
import type { Vec } from './geometry';
import { MILLSTONE_STEP, NIMBLE_PAWS_DISCOUNT, hasTalisman } from './kit';
import type { ChainLink, Enemy, HeroMove, World } from './world';

/** A link of the chain as the power hooks see it (the same in the plan and in the dash). */
export interface LinkContext {
  /** Number of this chain among the chains released on the arena (1, 2, …); the drawn chain — the next number. */
  chain: number;
  /** Number of this enemy link among the chain's enemy links, from 1 (a fallen link passed by the dash counts). */
  index: number;
  /** The living enemy; null — a link that died on the way (the dash passes its point, `FallenLink`). */
  enemy: Enemy | null;
  id: number;
  elite: boolean;
  /** Elite enemy links before this one in the chain. */
  elitesBefore: number;
  /** Power carried to this link, before the bonuses of the modules and before its own +1. */
  power: number;
  /** True in `planChain` (the highlight), false in the dash. Pure hooks must return the same in both. */
  plan: boolean;
}

/** The last enemy link the dash reached: where it was, whether it died, whether it was an elite. */
export interface LastLink { id: number; x: number; y: number; killed: boolean; elite?: true }

/** The layer's count of one dash (`HeroMove.build`): present only when a module acts. */
export interface DashBuild {
  /** Number of this chain on the arena (`Kit.chains` at its release). */
  chain: number;
  /** Enemy links reached so far (struck or passed fallen). */
  links: number;
  /** Elite enemy links reached so far. */
  elites: number;
  /** Where the hero stood at the release (the start of the chain). */
  start: Vec;
  last?: LastLink;
}

/** What a finished dash did (`onChainEnd`, `modify.chainShield`). */
export interface ChainEnd {
  chain: number;
  /** Kills of this chain (`HeroMove.kills`: struck dead and credited fallen links). */
  kills: number;
  hits: number;
  /** Enemy links reached (struck or passed fallen). */
  links: number;
  elites: number;
  /** The last enemy link reached (decision 7: «последнее звено» is the last enemy link); null — the chain had none. */
  last: LastLink | null;
  /** Power left at the end of the dash. */
  power: number;
  start: Vec;
  /** Where the hero stands after the dash. */
  end: Vec;
}

/** A kill of the chain (`onChainKill`): an enemy struck dead by the dash, or a fallen credited link it passed. */
export interface ChainKill { id: number; x: number; y: number; elite: boolean; fallen: boolean; /** Kills of this chain so far. */ kills: number }

/** The hero's path in one tick of a dash or a return run (`onDashStep`): points in order, from where he stood. */
export interface DashStep { kind: HeroMove['kind']; path: Vec[]; move: HeroMove }

/** Progress of a counter for the HUD (track Д5): «3/5» or dots. */
export interface BuildProgress { value: number; max: number }

/**
 * Number modifiers: each takes the value so far and returns the new one (modules in registration order). The base is the
 * value before phase B (params and the old talismans).
 */
export interface BuildModifiers {
  /** Link radius R (`linkRadiusOf`). «Широкий круг» ×1.25, «Длинная рука» ×1.5 on its chain — they multiply. */
  linkRadius?(world: World, value: number): number;
  /** Focus reserve (`focusMaxOf`). */
  focusMax?(world: World, value: number): number;
  /** Hero walking speed (`heroSpeedOf`). */
  heroSpeed?(world: World, value: number): number;
  /** Multiplier of the enemies' walk (`enemyWalkFactorOf`, base 1): walking only, not the reaper, not charges or leaps. */
  enemyWalk?(world: World, value: number): number;
  /** HP the healing consumable restores (`itemHealOf`). */
  itemHeal?(world: World, value: number): number;
  /** Energy the jump costs (`jumpCostOf`). */
  jumpCost?(world: World, value: number): number;
  /** Kills of one chain per crystal (`crystalEveryOf`). */
  crystalEvery?(world: World, value: number): number;
  /** Power every enemy link adds before its hit (`linkGainOf`, base 1). */
  linkGain?(world: World, value: number): number;
  /** Seconds of the after-chain invulnerability (`chainShieldOf`); `end` — the dash that gives it (null without the layer's count). */
  chainShield?(world: World, value: number, end: ChainEnd | null): number;
}
export type BuildStat = keyof BuildModifiers;

export interface BuildModule {
  /** The item's id (buildIds.ts); the kit holding it makes the module act (unless `active` says otherwise). */
  id: string;
  /** Acts in this world; default — `Kit.talismans` holds `id` or `Kit.hammer` is `id`. */
  active?(world: World): boolean;
  /** Pure number modifiers (getters below). */
  modify?: BuildModifiers;
  /** Pure: power added to an enemy link before its hit (the plan and the dash; a fallen link — before its +gain). */
  linkPower?(world: World, link: LinkContext): number;
  /** Pure: power added after the link, when the chain goes on past it (it died or it was a fallen link). */
  afterLinkPower?(world: World, link: LinkContext, outcome: StrikeOutcome | null): number;
  /** Pure: the counter shown in the HUD; null — nothing to show now. */
  progress?(world: World): BuildProgress | null;
  /** The arena started (end of `createWorld`: the kit, the start enemies are there). */
  onArenaStart?(world: World): void;
  /** A chain was released (the dash starts); `chain` — its number on the arena; cancelled chains are not counted. */
  onRelease?(world: World, release: { chain: number; links: readonly ChainLink[]; start: Vec }): void;
  /** The dash struck an enemy link (after the hit: HP, power, kill applied; `outcome` null — a fallen link passed). */
  onLink?(world: World, link: LinkContext, outcome: StrikeOutcome | null): void;
  /** The chain killed (after `onLink` of that link). */
  onChainKill?(world: World, kill: ChainKill): void;
  /** The dash broke a crystal. */
  onCrystal?(world: World, crystal: { id: number; x: number; y: number }): void;
  /**
   * The hero's path in this tick of a dash or a return run, after the tick's hits (and before `onChainEnd` on the tick the
   * dash ends). Kill only non-links here or accept that a killed link becomes a fallen one.
   */
  onDashStep?(world: World, step: DashStep): void;
  /** The dash ended (after the chain score, the `chainEnd` event and the after-chain invulnerability). */
  onChainEnd?(world: World, end: ChainEnd): void;
  /** A jump started; `cost` — the energy it took. */
  onJump?(world: World, cost: number): void;
  /** Every game tick of the world step (after burning, before thorns; not during the hit-stop). */
  onUpdate?(world: World, dt: number): void;
  /** A move other than a dash or a jump ended (a return run, `startReturnRun`). */
  onMoveEnd?(world: World, move: HeroMove): void;
}

const MODULES: BuildModule[] = [];

/** Registers a build module (once per id; a second one with the same id is an error). */
export function registerBuildModule(module: BuildModule): BuildModule {
  if (MODULES.some(m => m.id === module.id)) throw new Error(`build module ${module.id} is already registered`);
  MODULES.push(module);
  return module;
}

/** Registered modules in their order. */
export const buildModules = (): readonly BuildModule[] => MODULES;

/** The module acts in this world. */
export function moduleActive(world: World, module: BuildModule): boolean {
  const kit = world.kit;
  if (!kit) return false;
  return module.active ? module.active(world) : kit.talismans.includes(module.id) || kit.hammer === module.id;
}

/** Some module acts in this world: the layer counts chains and dashes only then. */
export function buildActive(world: World): boolean {
  if (!world.kit) return false;
  for (const m of MODULES) if (moduleActive(world, m)) return true;
  return false;
}

/** Active modules that have the hook (in registration order). */
function withHook<K extends keyof BuildModule>(world: World, key: K): BuildModule[] {
  if (!world.kit) return [];
  return MODULES.filter(m => m[key] !== undefined && moduleActive(world, m));
}

/**
 * Calls `call` for every active module that has the hook `key`, in registration order (helper of chain.ts / world.ts):
 * `runHook(world, 'onCrystal', m => m.onCrystal!(world, crystal))`.
 */
export function runHook(world: World, key: keyof BuildModule, call: (module: BuildModule) => void): void {
  for (const m of withHook(world, key)) call(m);
}

/** Some active module has the hook (skip work the hook would need: e.g. collecting the dash path). */
export const hasHook = (world: World, key: keyof BuildModule): boolean => withHook(world, key).length > 0;

function modded(world: World, stat: BuildStat, base: number, end: ChainEnd | null = null): number {
  if (!world.kit) return base;
  let value = base;
  for (const m of MODULES) {
    const f = m.modify?.[stat];
    if (f && moduleActive(world, m)) value = (f as (w: World, v: number, e: ChainEnd | null) => number)(world, value, end);
  }
  return value;
}

// ---- Getters: the numbers the build may change (without an active module — the old ones) ----

/** Link radius R (chain.ts `reachRefusal`; the view draws the circle with it). */
export const linkRadiusOf = (world: World): number => modded(world, 'linkRadius', world.params.linkRadius);
/** Focus reserve (chain.ts focus, world.ts start focus; the view's focus bar). */
export const focusMaxOf = (world: World): number => modded(world, 'focusMax', world.params.focusMax);
/** Hero walking speed (world.ts `stepHeroWalk`). */
export const heroSpeedOf = (world: World): number => modded(world, 'heroSpeed', world.params.heroSpeed);
/** Multiplier of the enemies' walk (world.ts `enemySpeed`; the reaper is left out there). */
export const enemyWalkFactorOf = (world: World): number => modded(world, 'enemyWalk', 1);
/** HP the healing consumable restores (items.ts), not below 0. */
export const itemHealOf = (world: World): number => Math.max(0, modded(world, 'itemHeal', Math.max(0, world.params.itemHeal)));
/** Power every enemy link adds before its hit (chain.ts `strike`; a fallen link adds it too). */
export const linkGainOf = (world: World): number => modded(world, 'linkGain', 1);
/** Seconds of the after-chain invulnerability (chain.ts `finishMove`). */
export const chainShieldOf = (world: World, end: ChainEnd | null = null): number => modded(world, 'chainShield', world.params.chainShield, end);

/** Energy the jump costs now: the panel's `jumpCost`, one less with «Ловкие лапы» (stage 2, step 3); then the modules. */
export function jumpCostOf(world: World): number {
  const base = hasTalisman(world, 'nimble-paws') ? Math.max(0, world.params.jumpCost - NIMBLE_PAWS_DISCOUNT) : world.params.jumpCost;
  return modded(world, 'jumpCost', base);
}

/** A crystal for every N kills of one chain: the panel's N, one fewer with «Осколок жернова» (stage 2, step 3), at least 2; then the modules. */
export function crystalEveryOf(world: World): number {
  const every = world.params.crystalEvery;
  return modded(world, 'crystalEvery', hasTalisman(world, 'millstone-shard') ? Math.max(2, every - MILLSTONE_STEP) : every);
}

/** Power the active modules add to the link before its hit. */
export function linkPowerOf(world: World, link: LinkContext): number {
  let sum = 0;
  for (const m of withHook(world, 'linkPower')) sum += m.linkPower!(world, link);
  return sum;
}

/** Power the active modules add after the link, when the chain goes on past it. */
export function afterLinkPowerOf(world: World, link: LinkContext, outcome: StrikeOutcome | null): number {
  let sum = 0;
  for (const m of withHook(world, 'afterLinkPower')) sum += m.afterLinkPower!(world, link, outcome);
  return sum;
}

/** Number the next released chain of the arena gets (the drawn chain's number in the plan). */
export const nextChainNo = (world: World): number => (world.kit?.chains ?? 0) + 1;

// ---- State helpers for the modules ----

/** An arena-long counter of the kit (0 when absent). */
export const counterOf = (world: World, key: string): number => world.kit?.counters?.[key] ?? 0;

/** Sets a counter; 0 removes it (an empty `counters` leaves the kit, the hash is as without it). */
export function setCounter(world: World, key: string, value: number): void {
  const kit = world.kit;
  if (!kit) return;
  if (value !== 0) { (kit.counters ??= {})[key] = value; return; }
  if (!kit.counters) return;
  delete kit.counters[key];
  if (!Object.keys(kit.counters).length) delete kit.counters;
}

/** Adds to a counter and returns the new value. */
export function addCounter(world: World, key: string, delta: number): number {
  const value = counterOf(world, key) + delta;
  setCounter(world, key, value);
  return value;
}

/** A module's structure on the arena (JSON values only: it is hashed); undefined — none. */
export const buildStateOf = <T>(world: World, id: string): T | undefined => world.build?.[id] as T | undefined;

/** Sets a module's structure; undefined removes it (an empty `World.build` leaves the world). */
export function setBuildState(world: World, id: string, state: unknown): void {
  if (state !== undefined) { (world.build ??= {})[id] = state; return; }
  if (!world.build) return;
  delete world.build[id];
  if (!Object.keys(world.build).length) delete world.build;
}

/** The view's signal that an item triggered (a flash of its icon, a short text at the hero; track Д5). */
export function talismanFired(world: World, id: string): void { world.events.push({ type: 'talismanFired', id }); }
