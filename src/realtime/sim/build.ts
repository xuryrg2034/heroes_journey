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
import type { FusionRelease, ReturnPreview, StrikeOutcome } from './chain';
import type { Vec } from './geometry';
import { COLOR_RULE_RANK, COUNTER_TALISMANS, HAMMER_IDS, OATH_HUNGER, RELIC_IDS } from './buildIds';
import { MILLSTONE_STEP, NIMBLE_PAWS_DISCOUNT, WITCH_PATH_ITEMS, hasTalisman, witchOn } from './kit';
export { WITCH_PATH_ITEMS, witchOn } from './kit';
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
  /**
   * Task 29 («Призма» with `counterWindow`): crystal links of this chain before this link — the plan counts the crystal links
   * drawn before it, the dash the crystals it broke (`HeroMove.broken`). Absent — 0.
   */
  crystalsBefore?: number;
  /**
   * Task 33 (design 15.10.2026, one rule of «Смена цвета»): colourless enemy links before this one (chain.ts `colorlessLink`, the
   * Jailer's core) — «Призма» does not count them, as `colorSegments` does not. Absent — 0.
   */
  colorlessBefore?: number;
  /**
   * Task 50 («Длинная рука» II): the plan's link is taken beyond the ordinary R (chain.ts `farLinkIds`; the release fixes the same
   * ids, the dash reads them from the module's state). Absent — not far, or no rank II of «Длинная рука».
   */
  far?: true;
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
  /** Task 33: colourless enemy links reached so far (absent while none: older dashes hash as before). */
  colorless?: number;
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
  /**
   * Task 29, the rank of the field «Конец» (buildIds.ts `END_RANK`): the form of a higher rank that acted on this chain — its
   * seal struck, or its pierce ran. Present only while the kit holds «Печать» or «Прямая» as a form (chain.ts `endRankOn`).
   */
  endForm?: 'seal' | 'pierce';
}

/** The end of a planned dash (`endShadow`): the enemy links it reaches (`ChainEnd.links`) and where the hero stands after it. */
export interface ChainEndShadow {
  links: number; at: Vec;
  /** Task 50 («Ударная волна» II): where the hero stood at the release (the chain's start; the dash's `ChainEnd.start`). */
  start?: Vec;
}

/**
 * What one module's `endShadow` does: the shadow list after it and the bodies it strikes (`struck`, in the order of its hits;
 * empty — it goes off and strikes nobody).
 */
export interface EndShadowHit {
  enemies: Enemy[]; struck: number[];
  /** Task 50 («Ударная волна» II): the bodies of its second hit (the wave round the chain's start), after the first; absent — none. */
  second?: number[];
}

/**
 * Task 50: what the release of a chain fixes for the counters' rank II (chain.ts `planChain` → `HonedPlan`): the far links of «Длинная
 * рука» II, the survivor's neighbour of «Иней на клинке» II.
 */
export interface HonedRelease { far?: number[]; frost?: { survivor: number; near: number } }
/** Task 50: the key of a module's second hit in `endShadowOf`'s `struck` (and `ReturnPreview.ends`). */
export const secondKey = (id: string): string => `${id}:2`;

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
  /** Enemy links of one colour segment before the chain is free («Смена цвета», `colorShiftOf`). */
  colorShift?(world: World, value: number): number;
  /** Power every enemy link adds before its hit (`linkGainOf`, base 1). */
  linkGain?(world: World, value: number): number;
  /** Seconds of the after-chain invulnerability (`chainShieldOf`); `end` — the dash that gives it (null without the layer's count). */
  chainShield?(world: World, value: number, end: ChainEnd | null): number;
  /** Task 50 («Добивание» II): the kills a chain needs for the after-chain shield (`chainShieldMinKillsOf`, base `chainShieldMinKills`). */
  chainShieldMinKills?(world: World, value: number, end: ChainEnd | null): number;
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
  onRelease?(world: World, release: { chain: number; links: readonly ChainLink[]; start: Vec; back?: ReturnPreview; /** Task 46: the fusions' end the release fixes (chain.ts `planChain`). */ fusion?: FusionRelease; /** Task 50: what the counters' rank II fix. */ honed?: HonedRelease }): void;
  /**
   * Task 50 («Охотник на элит» II) — pure: plates the link loses before its hit (the plan strikes the rest, the dash strips them first);
   * the caller caps the sum at the link's plates.
   */
  platesBefore?(world: World, link: LinkContext): number;
  /** Task 50 — pure: the module's rank II acts on this link (the highlight's mark, `LinkPlan.honed`; the dash's `talismanFired` rank 2). */
  rank2Link?(world: World, link: LinkContext): boolean;
  /** The dash struck an enemy link (after the hit: HP, power, kill applied; `outcome` null — a fallen link passed). */
  onLink?(world: World, link: LinkContext, outcome: StrikeOutcome | null): void;
  /** The chain killed (after `onLink` of that link). */
  onChainKill?(world: World, kill: ChainKill): void;
  /** The dash broke a crystal. */
  onCrystal?(world: World, crystal: { id: number; x: number; y: number }): void;
  /**
   * «Смена цвета» (`colorShiftLinks`): the dash reached the link that freed the chain's colour — the last link of a colour
   * segment (chain.ts `colorShiftIds`), struck or passed fallen.
   */
  onColorShift?(world: World, link: { id: number; x: number; y: number }): void;
  /**
   * The hero's path in this tick of a dash or a return run, after the tick's hits (and before `onChainEnd` on the tick the
   * dash ends). Kill only non-links here or accept that a killed link becomes a fallen one.
   */
  onDashStep?(world: World, step: DashStep): void;
  /** The dash ended (after the chain score, the `chainEnd` event and the after-chain invulnerability). */
  onChainEnd?(world: World, end: ChainEnd): void;
  /**
   * Task 29 — pure: what this module's `onChainEnd` does to the enemies, played on a shadow list (`enemies`, the world as the
   * planned dash leaves it) — the shadow of «Возврат» (chain.ts `planReturn`, `Params.returnShadowEnd`) reads it, so the run's
   * marks see a wave of the same chain. Returns the list after it and the bodies it strikes; null — it does nothing at this end
   * (the release fixes the bodies with `Params.returnWaveFixed`, `ReturnPreview.ends`). The world is not touched, no random draws.
   */
  endShadow?(world: World, end: ChainEndShadow, enemies: readonly Enemy[]): EndShadowHit | null;
  /** A jump started; `cost` — the energy it took. */
  onJump?(world: World, cost: number): void;
  /** Every game tick of the world step (after burning, before thorns; not during the hit-stop). */
  onUpdate?(world: World, dt: number): void;
  /** A move other than a dash or a jump ended (a return run, `startReturnRun`). */
  onMoveEnd?(world: World, move: HeroMove): void;
  /**
   * Task 29, field «Звено» — pure: the points the next link may be taken from (`anchorsOf`). `value` — the anchors so far (the
   * default: the last link, and the hero with «Якорь у героя»), `chain` — every link of the drawn chain still on the arena, in
   * order. Never asked before the first link (the hero alone).
   */
  anchors?(world: World, value: readonly ChainAnchor[], chain: readonly ChainAnchor[]): ChainAnchor[];
  /** Task 29, field «Звено» — pure: the colour rule of the chain; one rule acts (`colorRuleOf`, `COLOR_RULE_RANK`). */
  color?: ChainColorRule;
}

const MODULES: BuildModule[] = [];

/**
 * Rank of a module in the registry, whatever file is imported first (review 10.10.2026: the order of the hooks — e.g. the
 * wave before the frost, the hammers after the talismans — is part of the fight and its hash): the counter talismans, then
 * the hammers, then the relics and «Клятва голода», then any other module (a test's) — each group in its own order of
 * registration.
 */
function moduleRank(id: string): number {
  if ((Object.values(COUNTER_TALISMANS) as string[]).includes(id)) return 0;
  if ((HAMMER_IDS as readonly string[]).includes(id)) return 1;
  if ((RELIC_IDS as readonly string[]).includes(id) || id === OATH_HUNGER) return 2;
  return 3;
}

/** Registers a build module (once per id; a second one with the same id is an error), in its rank (`moduleRank`). */
export function registerBuildModule(module: BuildModule): BuildModule {
  if (MODULES.some(m => m.id === module.id)) throw new Error(`build module ${module.id} is already registered`);
  const rank = moduleRank(module.id), at = MODULES.findIndex(m => moduleRank(m.id) > rank);
  if (at < 0) MODULES.push(module); else MODULES.splice(at, 0, module);
  return module;
}

/** Registered modules in their order. */
export const buildModules = (): readonly BuildModule[] => MODULES;

/** The module acts in this world. */
export function moduleActive(world: World, module: BuildModule): boolean {
  const kit = world.kit;
  if (!kit) return false;
  // Task 62: the items of the dash's path do nothing for Ведунья v2 (no dash; stage A, design 20.10.2026).
  if (WITCH_PATH_ITEMS.includes(module.id) && witchOn(world)) return false;
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

/**
 * The active modules' `endShadow` on `enemies`, in the order their `onChainEnd` runs (pure): the list after them and, by module
 * id, the bodies each strikes (only the modules that act at this end).
 */
export function endShadowOf(world: World, end: ChainEndShadow, enemies: readonly Enemy[]): { enemies: Enemy[]; struck: Record<string, number[]> } {
  let out: Enemy[] = [...enemies];
  const struck: Record<string, number[]> = {};
  for (const m of withHook(world, 'endShadow')) {
    const hit = m.endShadow!(world, end, out);
    if (!hit) continue;
    out = hit.enemies;
    struck[m.id] = hit.struck;
    if (hit.second) struck[secondKey(m.id)] = hit.second;
  }
  return { enemies: out, struck };
}

/** Some active module has the hook (skip work the hook would need: e.g. collecting the dash path). */
export const hasHook = (world: World, key: keyof BuildModule): boolean => withHook(world, key).length > 0;

function modded(world: World, stat: BuildStat, base: number, end: ChainEnd | null = null, skip?: string): number {
  if (!world.kit) return base;
  let value = base;
  for (const m of MODULES) {
    const f = m.modify?.[stat];
    if (f && m.id !== skip && moduleActive(world, m)) value = (f as (w: World, v: number, e: ChainEnd | null) => number)(world, value, end);
  }
  return value;
}

// ---- Getters: the numbers the build may change (without an active module — the old ones) ----

/** Link radius R (chain.ts `reachRefusal`; the view draws the circle with it). */
export const linkRadiusOf = (world: World): number => modded(world, 'linkRadius', world.params.linkRadius);
/** Task 62 (Ведунья v2): R of the build without «Длинная рука» — the circle of casting is fixed, the ×1.5 of a far link does not grow it. */
export const linkRadiusBaseOf = (world: World): number => modded(world, 'linkRadius', world.params.linkRadius, null, COUNTER_TALISMANS.longArm);
/** Focus reserve (chain.ts focus, world.ts start focus; the view's focus bar). */
export const focusMaxOf = (world: World): number => {
  // Task 45 «Испытание VI»: the run's factor after the build's (`Kit.focusScale`; absent — the reserve as before).
  const max = modded(world, 'focusMax', world.params.focusMax), k = world.kit?.focusScale;
  return k === undefined ? max : max * k;
};
/** Hero walking speed (world.ts `stepHeroWalk`). */
export const heroSpeedOf = (world: World): number => modded(world, 'heroSpeed', world.params.heroSpeed);
/** Multiplier of the enemies' walk (world.ts `enemySpeed`; the reaper is left out there). */
export const enemyWalkFactorOf = (world: World): number => {
  // Task 45 «Испытание VII»: the run's factor with the build's (`Kit.walkScale`; absent — the walk as before).
  const walk = modded(world, 'enemyWalk', 1), k = world.kit?.walkScale;
  return k === undefined ? walk : walk * k;
};
/** HP the healing consumable restores (items.ts), not below 0. */
export const itemHealOf = (world: World): number => Math.max(0, modded(world, 'itemHeal', Math.max(0, world.params.itemHeal)));
/** Power every enemy link adds before its hit (chain.ts `strike`; a fallen link adds it too). */
export const linkGainOf = (world: World): number => modded(world, 'linkGain', 1);
/** Seconds of the after-chain invulnerability (chain.ts `finishMove`). */
export const chainShieldOf = (world: World, end: ChainEnd | null = null): number => modded(world, 'chainShield', world.params.chainShield, end);
/** Task 50: the kills a chain needs for the after-chain shield (chain.ts `finishMove`): the panel's, «Добивание» II fewer; at least 1. */
export const chainShieldMinKillsOf = (world: World, end: ChainEnd | null = null): number => Math.max(1, modded(world, 'chainShieldMinKills', world.params.chainShieldMinKills, end));

/** Energy the jump costs now: the panel's `jumpCost`, one less with «Ловкие лапы» (stage 2, step 3); then the modules. */
export function jumpCostOf(world: World): number {
  const base = hasTalisman(world, 'nimble-paws') ? Math.max(0, world.params.jumpCost - NIMBLE_PAWS_DISCOUNT) : world.params.jumpCost;
  return modded(world, 'jumpCost', base);
}

/**
 * A crystal for every N kills of one chain: the panel's N, one fewer with «Осколок жернова» (stage 2, step 3), at least 2; then
 * the modules. With «Смена цвета» on (`colorShiftLinks` > 0) the millstone items act on the shift instead (`colorShiftOf`):
 * the crystal step is the panel's.
 */
export function crystalEveryOf(world: World): number {
  const every = world.params.crystalEvery;
  if (colorShiftOn(world)) return every;
  return modded(world, 'crystalEvery', hasTalisman(world, 'millstone-shard') ? Math.max(2, every - MILLSTONE_STEP) : every);
}

/** «Смена цвета» is on: `colorShiftLinks` > 0 (no key — off, the old path). */
export const colorShiftOn = (world: World): boolean => world.params.colorShiftLinks > 0;

/** The floor of the millstone items on the shift: never below 2, a step already at 2 or less stays (as `millstoneEvery`). */
export const COLOR_SHIFT_MIN = 2;

/**
 * «Смена цвета» (design 12.10.2026): enemy links of one colour segment after which the drawn chain is free — the panel's
 * `colorShiftLinks`, one fewer with «Осколок жернова», then the modules («Жернов» two fewer), never below `COLOR_SHIFT_MIN`
 * (a step already at it or lower stays). 0 — off. The rule (chain.ts `chainColor`), the dash (`colorShiftIds`) and the view
 * («до смены N») read this one number.
 */
export function colorShiftOf(world: World): number {
  const base = world.params.colorShiftLinks;
  if (!(base > 0)) return 0;
  // Task 33: «Близнецы» turn the shift off (`Params.twinsNoShift`).
  if (colorRuleOf(world)?.noShift?.(world)) return 0;
  const talisman = hasTalisman(world, 'millstone-shard') && base > COLOR_SHIFT_MIN ? Math.max(COLOR_SHIFT_MIN, base - MILLSTONE_STEP) : base;
  return modded(world, 'colorShift', talisman);
}

/** Power the active modules add to the link before its hit. */
export function linkPowerOf(world: World, link: LinkContext): number {
  let sum = 0;
  for (const m of withHook(world, 'linkPower')) sum += m.linkPower!(world, link);
  return sum;
}

/** Task 50: plates the link loses before its hit (the active modules' `platesBefore`), at most `plates`. */
export function platesBeforeOf(world: World, link: LinkContext, plates: number): number {
  if (plates <= 0) return 0;
  let sum = 0;
  for (const m of withHook(world, 'platesBefore')) sum += m.platesBefore!(world, link);
  return Math.max(0, Math.min(plates, Math.floor(sum)));
}

/** Task 50: the modules whose rank II acts on this link (`rank2Link`), in their order; empty — none. */
export function rank2LinksOf(world: World, link: LinkContext): string[] {
  return withHook(world, 'rank2Link').filter(m => m.rank2Link!(world, link)).map(m => m.id);
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
/**
 * Enemy links of the chain now, for the pure `progress` hooks: the dash's reached links (struck or passed fallen, the
 * survivor at the end included), or the drawn chain's living enemy links; null — no chain.
 */
export function chainEnemyLinks(world: World): number | null {
  if (world.move) return world.move.kind === 'dash' && world.move.build ? world.move.build.links : null;
  if (!world.chain.length) return null;
  return world.chain.filter(l => l.kind === 'enemy' && world.enemies.some(e => e.id === l.id)).length;
}

export const buildStateOf = <T>(world: World, id: string): T | undefined => world.build?.[id] as T | undefined;

/** Sets a module's structure; undefined removes it (an empty `World.build` leaves the world). */
export function setBuildState(world: World, id: string, state: unknown): void {
  if (state !== undefined) { (world.build ??= {})[id] = state; return; }
  if (!world.build) return;
  delete world.build[id];
  if (!Object.keys(world.build).length) delete world.build;
}

/** The view's signal that an item triggered (a flash of its icon, a short text at the hero; track Д5). */
export function talismanFired(world: World, id: string, bodies?: number): void { world.events.push({ type: 'talismanFired', id, ...bodies !== undefined ? { bodies } : {} }); }
/** Task 50: the rank II of a counter acted (the view's flash; telemetry counts it as `<id>:2`). */
export function honedFired(world: World, id: string, bodies?: number): void { world.events.push({ type: 'talismanFired', id, rank: 2, ...bodies !== undefined ? { bodies } : {} }); }

// ---- Task 29, field «Звено»: anchors and colour (pure hooks; without a form — the old rule, nothing computed) ----

/** A point the next link may be taken from: a link of the drawn chain (`link`) or the hero (no `link`). */
export interface ChainAnchor { x: number; y: number; link?: ChainLink }

/** The colour rule of a chain (chain.ts `colorSegments`, `colorJoin`). Absent members — the old rule. */
export interface ChainColorRule {
  /** Colours with the same key count as one colour («Близнецы»: the pair); default — the colour itself. */
  key?(color: number): number;
  /** Enemy links of another colour one chain may take («Чужак»: 1); default 0. */
  foreign?: number;
  /** Task 33 «Близнецы»: the pair's colours alternate once the chain took the second one (chain.ts `colorSegments`). */
  alternate?(world: World): boolean;
  /** Task 33 «Близнецы»: «Смена цвета» does not act (`colorShiftOf` 0). */
  noShift?(world: World): boolean;
}

/** The anchors the modules make of `value` (chain.ts `chainAnchors`); `chain` is asked only when a module has the hook. */
export function anchorsOf(world: World, value: readonly ChainAnchor[], chain: () => readonly ChainAnchor[]): readonly ChainAnchor[] {
  const modules = withHook(world, 'anchors');
  if (!modules.length) return value;
  const links = chain();
  let out = value;
  for (const m of modules) out = m.anchors!(world, out, links);
  return out;
}

/** The one colour rule acting in this world: the active module of the best `COLOR_RULE_RANK` (null — the old rule). */
export function colorRuleOf(world: World): ChainColorRule | null {
  const modules = withHook(world, 'color');
  if (!modules.length) return null;
  const rank = (id: string): number => { const i = COLOR_RULE_RANK.indexOf(id); return i < 0 ? COLOR_RULE_RANK.length : i; };
  return modules.reduce((best, m) => (rank(m.id) < rank(best.id) ? m : best)).color!;
}
