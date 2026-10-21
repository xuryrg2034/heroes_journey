/**
 * Т1. Counter talismans of the real-time run (docs/realtime-phase-b.md, sections 3 and 8, decisions 7–14; track Д1). Ids —
 * buildIds.ts `COUNTER_TALISMANS`; the rules register here through `registerBuildModule` (build.ts), in the order of the ids.
 *
 * - Everything that changes power, R, the jump cost or the after-chain shield is a pure hook (`linkPower`, `afterLinkPower`,
 *   `modify.*`): the highlight (`planChain`) and the dash read the same numbers.
 * - Counters live in `Kit.counters` (build.ts `counterOf` / `setCounter`): the kit is made anew for every arena, so every
 *   counter starts from 0 on each arena. Chains are counted by the layer (`Kit.chains`: released chains, cancelled ones
 *   not counted).
 * - Every trigger pushes `talismanFired {id}` (build.ts `talismanFired`) — the view flashes the icon.
 * - `progress` (HUD, track Д5): `{ value, max }`; `value === max` means «armed / firing now» (the drawn chain gets the bonus,
 *   a charge waits). Null — nothing to show (the talisman is not a counter, or no chain is drawn).
 * - Numbers are constants here, not `Params` — except the wave's chain threshold with the chain window
 *   (`Params.shockwaveLinks`, `shockwaveLinksOf`). No random draws, no transcendental `Math.*`.
 * - Task 29 (design 15.10.2026, «Переделка восьми счётчиков»): with `Params.counterWindow` every counter counts within one
 *   chain (`counterWindowOn`; the same ids, the rules below each module). Off, or a journal without the key — the old windows.
 */
import { addCounter, buildStateOf, chainEnemyLinks, chainShieldMinKillsOf, colorShiftOf, counterOf, chainShieldOf, honedFired, nextChainNo, registerBuildModule, secondKey, setBuildState, setCounter, talismanFired, type BuildProgress, type LinkContext } from './build';
import { BUILD_SOURCES, COUNTER_TALISMANS, FUSIONS, RELICS } from './buildIds';
import { kindOf } from './enemies/kinds';
import { TROLL, trollWindowOn } from './enemies/troll';
import { frostWaveCold } from './fusions';
import { buildHitAll, enemiesInCircle, shadowHitAll } from './buildHits';
import { platesOf } from './elites';
import { dist, type Vec } from './geometry';
import type { Params } from './params';
import type { ChainLink, Enemy, World } from './world';

// ---- Numbers (баланс, docs/realtime-phase-b.md, section 3; start values, tuned after the playtest) ----

/** «Пятое звено»: every this-many-th enemy link of a chain … */
export const FIFTH_LINK_EVERY = 5;
/** … gets this much power before its hit. */
export const FIFTH_LINK_POWER = 2;
/** «Третья цепь»: every this-many-th chain of the arena that killed at least one … */
export const THIRD_CHAIN_EVERY = 3;
/** … makes the next jump free within this many game seconds (one jump; free jumps never stack). */
export const THIRD_CHAIN_WINDOW = 5;
/** «Ударная волна»: a dash that reached at least this many enemy links … */
export const SHOCKWAVE_LINKS = 8;
/** … sends a wave of this radius around the hero at its end (touching the body) … */
export const SHOCKWAVE_RADIUS = 2;
/** … that hits every enemy in it for this much (credited, source `wave`). */
export const SHOCKWAVE_DAMAGE = 1;
/** «Призма»: energy for every crystal the dash breaks and every colour shift it reaches (up to the energy cap). */
export const PRISM_ENERGY = 1;
/** Energy cap (chain.ts `ENERGY_MAX`, as in the main game; kept here so this module needs chain.ts for nothing). */
const ENERGY_CAP = 7;
/** «Добивание»: the after-chain invulnerability ×this when the last enemy link died. */
export const FINISHER_FACTOR = 2;
/** «Охотник на элит»: power added once after every elite link (the rest of the chain carries it, as a brazier). */
export const ELITE_HUNTER_POWER = 3;
/** «Длинная рука»: every this-many-th released chain of the arena … */
export const LONG_ARM_EVERY = 4;
/** … has the link radius R ×this for the whole chain (with «Широкий круг» the factors multiply). */
export const LONG_ARM_FACTOR = 1.5;
/** «Иней на клинке»: every this-many-th released chain of the arena … */
export const FROST_EDGE_EVERY = 4;
/** … freezes its surviving last enemy link for this many game seconds (no ×2 brittleness of the cold consumable). */
export const FROST_EDGE_TIME = 2;

// ---- Task 29: the chain window (`Params.counterWindow`; design 15.10.2026, the report's table) ----

/** The counters count within one chain (`Params.counterWindow`; a journal without the key — off, the old windows). */
export const counterWindowOn = (world: World): boolean => !!world.params.counterWindow;
/** «Острие»: this enemy link of the chain (fallen ones count) … */
export const EDGE_LINK = 3;
/** … gets this much power before its hit. */
export const EDGE_POWER = 2;
/** «Улов»: a chain that killed at least this many makes the next jump free (`THIRD_CHAIN_WINDOW` game seconds). */
export const CATCH_KILLS = 3;
/** «Призма»: power before the hit of every enemy link after a crystal or a colour shift of the chain. */
export const PRISM_POWER = 1;
/** «Ударная волна»: the old window's threshold (8) is a constant; the chain window's is the panel's (`shockwaveLinks`, 4). */
export const SHOCKWAVE_WINDOW_LINKS = 4;
/** «Длинная рука»: from this link of the drawn chain (any link: enemy or object) R ×`LONG_ARM_FACTOR` to its end. */
export const LONG_ARM_FROM = 3;
/** «Иней на клинке»: a chain of at least this many enemy links reached, ended on a survivor, freezes it (`FROST_EDGE_TIME`). */
export const FROST_EDGE_LINKS = 3;

// ---- Task 50 «Сноровка»: the counters' rank II (`Kit.honed`; design 16.10.2026, docs/design-notes/task-50-levels-archetype.md, 3.3) ----

/**
 * Defaults of the rank II numbers (`Params.hone*`; also the values of a world whose params lack them). Every rule of rank II adds to the
 * rule of rank I and acts only with the chain window (`counterWindow`): a run's forms play it, `Kit.honed` comes only from such a run.
 */
export const HONE = { edgeEvery: 3, catchPower: 2, prismEnergy: 1, waveStart: 2, finisherKills: 1, hunterPlates: 1, armPower: 1, frostNear: 1.5, frostTime: 2 } as const;

/** Task 50: the counter `id` acts on rank II in this world — the chain window, the kit holds it and names it in `Kit.honed`. */
export const honedOn = (world: World, id: string): boolean => counterWindowOn(world) && holds(world, id) && !!world.kit?.honed?.includes(id);
const whole = (value: number | undefined, fallback: number, min = 0): number => Math.max(min, Math.floor(value ?? fallback));
/** «Ударная волна» II: the radius of the second wave (round the chain's start). */
export const honeWaveStartOf = (world: World): number => Math.max(0, world.params.honeWaveStart ?? HONE.waveStart);

/** «Ударная волна»: enemy links of the dash that send the wave — 8 (old window), the panel's 4 with the chain window. */
export function shockwaveLinksOf(params: Params): number {
  return params.counterWindow ? params.shockwaveLinks ?? SHOCKWAVE_WINDOW_LINKS : SHOCKWAVE_LINKS;
}

/**
 * «Призма» with the chain window: the link comes after a crystal of this chain (`LinkContext.crystalsBefore`), or after the
 * link that freed the colour («Смена цвета», chain.ts `colorShiftIds`: the `colorShiftOf`-th enemy link of the first colour
 * segment — a later shift comes after a crystal or after this one). The plan and the dash read the same link context.
 */
export function afterPrismShift(world: World, link: LinkContext): boolean {
  if ((link.crystalsBefore ?? 0) > 0) return true;
  const every = colorShiftOf(world);
  // Task 33 (design 15.10.2026): a colourless link (the Jailer's core) is not counted, as chain.ts `colorSegments` does not.
  return every > 0 && link.index - 1 - (link.colorlessBefore ?? 0) >= every;
}

/** A tough link (HP above 0, as the view's pale ring) — by the outcome of its hit; a fallen link — unknown, not tough. */
const toughLink = (link: LinkContext, outcome: { hpBefore: number } | null): boolean => (outcome ? outcome.hpBefore > 0 : !!link.enemy && link.enemy.hp > 0);

/**
 * Talismans that never act together with a relic (decision 14): «Добивание» does nothing while «Быстрые ноги» are taken (they
 * take the after-chain invulnerability away). The run's catalogue (track Д4) keeps them out of one build; this rule makes the
 * arena agree if they meet anyway.
 */
export const TALISMAN_CONFLICTS: Readonly<Record<string, readonly string[]>> = {
  [COUNTER_TALISMANS.finisher]: [RELICS.swiftFeet],
};

/** Keys of `Kit.counters` (arena-long; absent while 0). */
const KEY = {
  /** «Третья цепь»: chains of the arena that killed at least one. */
  thirdChains: 'third-chain',
  /** «Третья цепь»: game time until which the next jump is free (absent — no free jump). */
  thirdChainUntil: 'third-chain-until',
  /** «Иней на клинке»: 1 — a charge waits for a chain that ends on a survivor. */
  frostCharge: 'frost-edge-charge',
  /** Task 50, «Улов» II: the number of the chain the free jump charged (absent — none). */
  catchChain: 'third-chain-charged',
} as const;

function holds(world: World, id: string): boolean { return !!world.kit?.talismans.includes(id); }

/** Enemy links of the chain now (build.ts `chainEnemyLinks`). */
const chainLinks = chainEnemyLinks;

/** The released chain number `chain` is a «every N-th» one. */
const nth = (chain: number, every: number): boolean => chain > 0 && chain % every === 0;

/** The cycle of «every N-th released chain» for the HUD: chains released in this cycle; `max` — the drawn chain is the N-th. */
function chainCycle(world: World, every: number, armed = false): BuildProgress {
  if (armed || nth(nextChainNo(world), every)) return { value: every, max: every };
  return { value: (world.kit?.chains ?? 0) % every, max: every };
}

// ---- «Пятое звено»: every 5th enemy link (fallen ones count) +2 power before its hit ----

// With the chain window — «Острие»: the 3rd enemy link of the chain +2 power before its hit (only the 3rd).

// Task 50, «Острие» II: every `honeEdgeEvery`-th enemy link (3, 6, 9…) +2 too — the 3rd as on rank I.

/** «Острие» II: the period of its links (whole, at least 1). */
const edgeEvery = (w: World): number => whole(w.params.honeEdgeEvery, HONE.edgeEvery, 1);
/** «Острие» II fires on the `index`-th enemy link beyond the rank I's 3rd. */
const edgeHonedAt = (w: World, index: number): boolean => index !== EDGE_LINK && index % edgeEvery(w) === 0 && honedOn(w, COUNTER_TALISMANS.fifthLink);
/** «Пятое звено» fires on the `index`-th enemy link of the dash (1, 2, …) — the view's highlight reads the same rule (task 35, С4). */
export const fifthLinkFiresAt = (w: World, index: number): boolean => (counterWindowOn(w) ? index === EDGE_LINK || edgeHonedAt(w, index) : nth(index, FIFTH_LINK_EVERY));
const fifthLinkFires = (w: World, link: LinkContext): boolean => fifthLinkFiresAt(w, link.index);

registerBuildModule({
  id: COUNTER_TALISMANS.fifthLink,
  linkPower: (w, link) => (fifthLinkFires(w, link) ? (counterWindowOn(w) ? EDGE_POWER : FIFTH_LINK_POWER) : 0),
  // Rank II's own links fire as rank II (chain.ts: `rank2Link` → `honedFired`).
  onLink: (w, link) => { if (fifthLinkFires(w, link) && !edgeHonedAt(w, link.index)) talismanFired(w, COUNTER_TALISMANS.fifthLink); },
  rank2Link: (w, link) => edgeHonedAt(w, link.index),
  progress: w => {
    const links = chainLinks(w);
    if (links === null) return null;
    if (honedOn(w, COUNTER_TALISMANS.fifthLink)) { const every = edgeEvery(w); return { value: links > 0 && links % every === 0 ? every : links % every, max: every }; }
    if (counterWindowOn(w)) return { value: Math.min(links, EDGE_LINK), max: EDGE_LINK };
    return { value: links > 0 && nth(links, FIFTH_LINK_EVERY) ? FIFTH_LINK_EVERY : links % FIFTH_LINK_EVERY, max: FIFTH_LINK_EVERY };
  },
});

// ---- «Третья цепь»: every 3rd chain of the arena that killed — the next jump within 5 s is free ----

/** The free jump waits (game time). */
const freeJumpOpen = (world: World): boolean => counterOf(world, KEY.thirdChainUntil) > world.time;
/**
 * Task 50, «Улов» II: the free jump charged the chain of this number (`Kit.counters`, set at the jump to the next released chain's number,
 * removed at its end) — its first enemy link +`honeCatchPower`. No time in the condition: the plan and the dash read the same number.
 */
const catchCharged = (w: World, link: LinkContext): boolean => link.index === 1 && counterOf(w, KEY.catchChain) === link.chain && honedOn(w, COUNTER_TALISMANS.thirdChain);

registerBuildModule({
  id: COUNTER_TALISMANS.thirdChain,
  modify: { jumpCost: (w, v) => (freeJumpOpen(w) ? 0 : v) },
  linkPower: (w, link) => (catchCharged(w, link) ? whole(w.params.honeCatchPower, HONE.catchPower) : 0),
  rank2Link: catchCharged,
  onChainEnd: (w, end) => {
    if (counterOf(w, KEY.catchChain) === end.chain) setCounter(w, KEY.catchChain, 0);
    // With the chain window — «Улов»: this chain killed 3+ (no count between chains).
    if (counterWindowOn(w) ? end.kills < CATCH_KILLS : end.kills < 1) return;
    if (!counterWindowOn(w) && !nth(addCounter(w, KEY.thirdChains, 1), THIRD_CHAIN_EVERY)) return;
    // A new free jump replaces a waiting one (they never stack): the window starts again.
    setCounter(w, KEY.thirdChainUntil, w.time + THIRD_CHAIN_WINDOW);
    talismanFired(w, COUNTER_TALISMANS.thirdChain);
  },
  onJump: w => {
    if (!freeJumpOpen(w)) return;
    // Task 50, «Улов» II: the free jump charges the next released chain.
    if (honedOn(w, COUNTER_TALISMANS.thirdChain)) setCounter(w, KEY.catchChain, nextChainNo(w));
    setCounter(w, KEY.thirdChainUntil, 0);
  },
  onUpdate: w => { const until = counterOf(w, KEY.thirdChainUntil); if (until > 0 && until <= w.time) setCounter(w, KEY.thirdChainUntil, 0); },
  progress: w => {
    if (counterWindowOn(w)) {
      // «Улов»: armed while the free jump waits; during a dash — its kills up to 3; nothing to show otherwise.
      if (freeJumpOpen(w)) return { value: CATCH_KILLS, max: CATCH_KILLS };
      return w.move?.kind === 'dash' ? { value: Math.min(w.move.kills, CATCH_KILLS), max: CATCH_KILLS } : null;
    }
    return freeJumpOpen(w)
      ? { value: THIRD_CHAIN_EVERY, max: THIRD_CHAIN_EVERY }
      : { value: counterOf(w, KEY.thirdChains) % THIRD_CHAIN_EVERY, max: THIRD_CHAIN_EVERY };
  },
});

// ---- «Ударная волна»: a dash of 8+ enemy links — a wave of 2 around the hero at its end, 1 to every enemy, credited ----
// With the chain window — from `shockwaveLinks` (4) enemy links.

/**
 * `World.build['shockwave']` (`Params.returnWaveFixed`, design 15.10.2026): the bodies of the wave the release fixed from the
 * shadow of «Возврат» (`ReturnPreview.ends`) — set at the release, removed at the chain's end. Absent otherwise.
 */
interface WaveState {
  fixed: number[];
  /** Task 50, «Ударная волна» II: the bodies of the second wave (round the chain's start), fixed the same way; absent — not fixed. */
  start?: number[];
}

/**
 * One wave at the end of the dash (`rank2` — the second one of «Ударная волна» II, round the chain's start): the event, the flash, the
 * hit of `ids` (fixed at the release: those still on the arena, wherever they stand now) or of those in the circle now; «Ледяная волна»
 * freezes the survivors.
 */
function strikeWave(w: World, at: Vec, radius: number, ids: readonly number[] | null, rank2: boolean): void {
  w.events.push({ type: 'wave', x: at.x, y: at.y, r: radius });
  if (rank2) honedFired(w, COUNTER_TALISMANS.shockwave); else talismanFired(w, COUNTER_TALISMANS.shockwave);
  // Touching the body, not the reaper, no ×2 on a frozen one (buildHits.ts); every kill is the player's (`wave`).
  const targets = ids ? ids.flatMap(id => w.enemies.filter(e => e.id === id)) : enemiesInCircle(w, at, radius);
  buildHitAll(w, targets, SHOCKWAVE_DAMAGE, BUILD_SOURCES.wave);
  // Task 46 «Ледяная волна»: the survivors freeze as from the cold consumable — max(their cold, 3 s), brittle (not the Reaper).
  const cold = frostWaveCold(w);
  if (!cold || cold.time <= 0) return;
  let frozen = 0;
  for (const e of targets) {
    if (!w.enemies.includes(e) || kindOf(e).immune) continue;
    e.chill = Math.max(e.chill ?? 0, cold.time);
    if (cold.brittle) e.brittle = true;
    frozen++;
  }
  if (frozen) talismanFired(w, FUSIONS.frostWave, frozen);
}

registerBuildModule({
  id: COUNTER_TALISMANS.shockwave,
  // Task 29: the shadow of «Возврат» sees the wave (the same threshold, circle and hit, on the planned end). Task 50: with rank II
  // the second wave round the chain's start (`end.start`) strikes the list after the first.
  endShadow: (w, end, enemies) => {
    if (end.links < shockwaveLinksOf(w.params)) return null;
    const targets = enemiesInCircle({ ...w, enemies: [...enemies] }, end.at, SHOCKWAVE_RADIUS);
    const after = shadowHitAll(enemies, targets, SHOCKWAVE_DAMAGE, BUILD_SOURCES.wave), struck = targets.map(e => e.id);
    if (!end.start || !honedOn(w, COUNTER_TALISMANS.shockwave)) return { enemies: after, struck };
    // «Дыры ядра боссов» (`trollShadowOnce`): the Troll's core the first wave struck in its window is not the second's (one hit a window).
    const spent = w.params.trollShadowOnce && trollWindowOn(w) ? new Set(targets.filter(e => e.kind === TROLL).map(e => e.id)) : null;
    const second = enemiesInCircle({ ...w, enemies: [...after] }, end.start, honeWaveStartOf(w)).filter(e => !spent?.has(e.id));
    return { enemies: shadowHitAll(after, second, SHOCKWAVE_DAMAGE, BUILD_SOURCES.wave), struck, second: second.map(e => e.id) };
  },
  // `returnWaveFixed`: the release fixes the wave's bodies of the highlight. `release.back` is there only with «Возврат» and
  // `returnFixed` (chain.ts `releaseChain`), its `ends` only with `returnShadowEnd` and a wave in the plan; no plan — the old wave.
  onRelease: (w, release) => {
    if (!w.params.returnWaveFixed) return;
    const ends = release.back?.ends, fixed = ends?.[COUNTER_TALISMANS.shockwave], second = ends?.[secondKey(COUNTER_TALISMANS.shockwave)];
    setBuildState(w, COUNTER_TALISMANS.shockwave, fixed ? { fixed: [...fixed], ...second ? { start: [...second] } : {} } satisfies WaveState : undefined);
  },
  onChainEnd: (w, end) => {
    const state = buildStateOf<WaveState>(w, COUNTER_TALISMANS.shockwave);
    if (state) setBuildState(w, COUNTER_TALISMANS.shockwave, undefined);
    // Task 46 «Ледяная волна»: the wave's bodies the release fixed from the highlight (absent without the fusion).
    const ice = buildStateOf<WaveState>(w, FUSIONS.frostWave);
    if (ice) setBuildState(w, FUSIONS.frostWave, undefined);
    if (end.links < shockwaveLinksOf(w.params)) return;
    const fixed = ice ?? state;
    strikeWave(w, { x: w.hero.x, y: w.hero.y }, SHOCKWAVE_RADIUS, fixed ? fixed.fixed : null, false);
    // Task 50, «Ударная волна» II: the second wave round the chain's start, in the same tick.
    if (!honedOn(w, COUNTER_TALISMANS.shockwave) || w.status !== 'playing') return;
    strikeWave(w, end.start, honeWaveStartOf(w), fixed?.start ?? null, true);
  },
  progress: w => {
    const links = chainLinks(w), max = shockwaveLinksOf(w.params);
    return links === null ? null : { value: Math.min(links, max), max };
  },
});

// ---- «Призма»: every crystal the dash breaks +1 energy (up to the cap); with «Смена цвета» (`colorShiftLinks` > 0) also every
// colour shift the dash reaches (the link that freed the colour, chain.ts `reachShift`) — a shift is the run's crystal ----

// With the chain window (design answer 5): no energy; every enemy link after a crystal or a colour shift of this chain +1
// power before its hit (`afterPrismShift`; the plan shows it).

const prismFires = (w: World): void => {
  if (counterWindowOn(w)) return;
  w.energy = Math.min(ENERGY_CAP, w.energy + PRISM_ENERGY);
  talismanFired(w, COUNTER_TALISMANS.prism);
};

registerBuildModule({
  id: COUNTER_TALISMANS.prism,
  onCrystal: prismFires,
  // Task 50, «Призма» II (with the chain window): +`honePrismEnergy` energy for every colour shift the dash reaches (up to the cap).
  onColorShift: w => {
    if (!counterWindowOn(w)) { prismFires(w); return; }
    if (!honedOn(w, COUNTER_TALISMANS.prism)) return;
    w.energy = Math.min(ENERGY_CAP, w.energy + whole(w.params.honePrismEnergy, HONE.prismEnergy));
    honedFired(w, COUNTER_TALISMANS.prism);
  },
  linkPower: (w, link) => (counterWindowOn(w) && afterPrismShift(w, link) ? PRISM_POWER : 0),
  onLink: (w, link) => { if (counterWindowOn(w) && afterPrismShift(w, link)) talismanFired(w, COUNTER_TALISMANS.prism); },
});

// ---- «Добивание»: the last enemy link died — the after-chain invulnerability ×2; not with «Быстрые ноги» ----

// With the chain window: the last enemy link is the toughest of the chain (no enemy link of the release had more HP; ties
// count) and died. The release notes the toughest links (`World.build['finishing-blow']`, only with the window; removed at the
// chain's end).

/** `World.build['finishing-blow']` with the chain window: the chain's number and its enemy links with the most HP at the release. */
interface FinisherState { chain: number; top: number[] }

const lastLinkDied = (end: { last: { killed: boolean } | null } | null): boolean => !!end?.last?.killed;

/** «Добивание» with the chain window: the enemy links of `links` on the arena with the most HP now (the release's `top`; the plan's). */
export function finisherTopIds(w: World, links: readonly ChainLink[]): number[] {
  const hp = links.flatMap(l => { const e = l.kind === 'enemy' ? w.enemies.find(x => x.id === l.id) : undefined; return e ? [{ id: e.id, hp: e.hp }] : []; });
  const max = hp.reduce((m, h) => Math.max(m, h.hp), -Infinity);
  return hp.filter(h => h.hp === max).map(h => h.id);
}
/** «Добивание» acts (not with «Быстрые ноги»). */
const finisherActive = (w: World): boolean => holds(w, COUNTER_TALISMANS.finisher) && !TALISMAN_CONFLICTS[COUNTER_TALISMANS.finisher].some(id => holds(w, id));
/** Task 50: «Добивание» II acts — its kills for the shield (`honeFinisherKills`); null — not on rank II here. */
export const finisherHonedKills = (w: World): number | null => (finisherActive(w) && honedOn(w, COUNTER_TALISMANS.finisher) ? whole(w.params.honeFinisherKills, HONE.finisherKills, 1) : null);

function finisherHolds(w: World, end: { chain: number; last: { id: number; killed: boolean } | null } | null): boolean {
  if (!end || !lastLinkDied(end)) return false;
  if (!counterWindowOn(w)) return true;
  const state = buildStateOf<FinisherState>(w, COUNTER_TALISMANS.finisher);
  return !!state && state.chain === end.chain && state.top.includes(end.last!.id);
}

registerBuildModule({
  id: COUNTER_TALISMANS.finisher,
  active: finisherActive,
  // Task 50, «Добивание» II: the shield (×2) for a chain of `honeFinisherKills` kills too, when the rule holds.
  modify: {
    chainShield: (w, v, end) => (finisherHolds(w, end) ? v * FINISHER_FACTOR : v),
    chainShieldMinKills: (w, v, end) => { const k = finisherHonedKills(w); return k !== null && finisherHolds(w, end) ? Math.min(v, k) : v; },
  },
  onRelease: (w, release) => {
    if (!counterWindowOn(w)) return;
    const top = finisherTopIds(w, release.links);
    setBuildState(w, COUNTER_TALISMANS.finisher, top.length ? { chain: release.chain, top } satisfies FinisherState : undefined);
  },
  onChainEnd: (w, end) => {
    // The flash only when the longer invulnerability was really given (chain.ts `finishMove`: a chain that killed enough); rank II's
    // own shield (fewer kills than the panel's) flashes as rank II.
    if (finisherHolds(w, end) && end.kills >= chainShieldMinKillsOf(w, end) && chainShieldOf(w, end) > 0) {
      if (end.kills < Math.max(1, w.params.chainShieldMinKills)) honedFired(w, COUNTER_TALISMANS.finisher); else talismanFired(w, COUNTER_TALISMANS.finisher);
    }
    if (counterWindowOn(w)) setBuildState(w, COUNTER_TALISMANS.finisher, undefined);
  },
});

// ---- «Охотник на элит»: after every elite link the chain carries +3 power (once per elite, as a brazier) ----

// With the chain window: after an elite or a tough link (HP above 0 before its hit, `toughLink`) — still +3 once per link.

const hunterLink = (w: World, link: LinkContext, outcome: { hpBefore: number } | null): boolean => link.elite || (counterWindowOn(w) && toughLink(link, outcome));

/** Task 50, «Охотник на элит» II: plates an elite link loses before its hit (`honeHunterPlates`); 0 — not on rank II, not an elite. */
const hunterPlates = (w: World, link: LinkContext): number => (link.elite && honedOn(w, COUNTER_TALISMANS.eliteHunter) ? whole(w.params.honeHunterPlates, HONE.hunterPlates) : 0);

registerBuildModule({
  id: COUNTER_TALISMANS.eliteHunter,
  afterLinkPower: (w, link, outcome) => (hunterLink(w, link, outcome) ? ELITE_HUNTER_POWER : 0),
  platesBefore: hunterPlates,
  rank2Link: (w, link) => hunterPlates(w, link) > 0 && !!link.enemy && platesOf(link.enemy) > 0,
  // The package: a plate pass counts as the elite's link (the chain goes on through it).
  onLink: (w, link, outcome) => { if (hunterLink(w, link, outcome) && (outcome === null || outcome.killed || outcome.plate)) talismanFired(w, COUNTER_TALISMANS.eliteHunter); },
});

// ---- «Длинная рука»: every 4th released chain of the arena — R ×1.5 for the whole chain ----

// With the chain window: the drawn chain holds 2 links or more — its 3rd and every next link (the closing edge of a loop too)
// is taken with R ×1.5 (`world.chain`; no chain or a dash — the usual R).

/** «Длинная рука» with the chain window: the next link of the drawn chain is its 3rd or later. */
const longArmReach = (w: World): boolean => w.chain.length >= LONG_ARM_FROM - 1;

/**
 * Task 50, «Длинная рука» II: `World.build['long-arm']` — the enemy links of the released chain taken beyond the ordinary R (chain.ts
 * `farLinkIds`: no anchor within R without ×1,5), fixed at the release from the highlight, removed at the chain's end.
 */
interface ArmState { chain: number; far: number[] }
/** «Длинная рука» II acts on this link: the plan's `far`, the dash's fixed ids. */
function armFar(w: World, link: LinkContext): boolean {
  if (!honedOn(w, COUNTER_TALISMANS.longArm)) return false;
  if (link.plan) return !!link.far;
  const state = buildStateOf<ArmState>(w, COUNTER_TALISMANS.longArm);
  return !!state && state.chain === link.chain && state.far.includes(link.id);
}

registerBuildModule({
  id: COUNTER_TALISMANS.longArm,
  // The drawn chain is the next released one (`nextChainNo`): a cancelled chain keeps the number, so it is not counted.
  modify: { linkRadius: (w, v) => ((counterWindowOn(w) ? longArmReach(w) : nth(nextChainNo(w), LONG_ARM_EVERY)) ? v * LONG_ARM_FACTOR : v) },
  linkPower: (w, link) => (armFar(w, link) ? whole(w.params.honeArmPower, HONE.armPower) : 0),
  rank2Link: armFar,
  onRelease: (w, release) => {
    if (counterWindowOn(w) ? release.links.length >= LONG_ARM_FROM : nth(release.chain, LONG_ARM_EVERY)) talismanFired(w, COUNTER_TALISMANS.longArm);
    // Task 50: rank II fixes the far links of the highlight (none — no state).
    if (!honedOn(w, COUNTER_TALISMANS.longArm)) return;
    const far = release.honed?.far;
    setBuildState(w, COUNTER_TALISMANS.longArm, far?.length ? { chain: release.chain, far: [...far] } satisfies ArmState : undefined);
  },
  onChainEnd: w => { if (buildStateOf<ArmState>(w, COUNTER_TALISMANS.longArm)) setBuildState(w, COUNTER_TALISMANS.longArm, undefined); },
  progress: w => {
    if (!counterWindowOn(w)) return chainCycle(w, LONG_ARM_EVERY);
    // Links of the drawn chain up to 2: at 2 the long reach is on.
    return w.chain.length && !w.move ? { value: Math.min(w.chain.length, LONG_ARM_FROM - 1), max: LONG_ARM_FROM - 1 } : null;
  },
});

// ---- «Иней на клинке»: every 4th released chain — its surviving last enemy link freezes for 2 s; no survivor — the charge waits ----

// With the chain window: a chain of 3+ enemy links reached (the survivor counts) that ended on a survivor freezes it for 2 s
// (no charge, no count between chains).

/**
 * Task 50, «Иней на клинке» II: `World.build['frost-edge']` — the survivor's neighbour the release fixed from the highlight (chain.ts
 * `planChain` → `HonedPlan.frost`), removed at the chain's end. The neighbour freezes when the rule freezes the survivor.
 */
interface FrostState { chain: number; near: number }
/** «Иней на клинке» II: the radius of the neighbour round the survivor (plus its body). */
export const honeFrostNearOf = (w: World): number => Math.max(0, w.params.honeFrostNear ?? HONE.frostNear);
/**
 * «Иней на клинке» II: the neighbour of `survivor` — the nearest of `enemies` (the shadow after the dash and the wave) other than it whose
 * body touches the circle of `honeFrostNear` round it, not the Reaper; the first in the arena's order on a tie. Null — none.
 */
export function frostNeighbour(w: World, survivor: Vec & { id: number }, enemies: readonly Enemy[]): number | null {
  let best: Enemy | null = null, bestD = Infinity;
  for (const e of enemiesInCircle({ ...w, enemies: [...enemies] }, survivor, honeFrostNearOf(w))) {
    if (e.id === survivor.id) continue;
    const d = dist(e, survivor);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best ? best.id : null;
}

registerBuildModule({
  id: COUNTER_TALISMANS.frostEdge,
  onRelease: (w, release) => {
    if (!honedOn(w, COUNTER_TALISMANS.frostEdge)) return;
    const frost = release.honed?.frost;
    setBuildState(w, COUNTER_TALISMANS.frostEdge, frost ? { chain: release.chain, near: frost.near } satisfies FrostState : undefined);
  },
  onChainEnd: (w, end) => {
    const near = buildStateOf<FrostState>(w, COUNTER_TALISMANS.frostEdge);
    if (near) setBuildState(w, COUNTER_TALISMANS.frostEdge, undefined);
    const window = counterWindowOn(w);
    if (window) { if (end.links < FROST_EDGE_LINKS) return; } else if (nth(end.chain, FROST_EDGE_EVERY)) setCounter(w, KEY.frostCharge, 1);
    if ((!window && !counterOf(w, KEY.frostCharge)) || !end.last || end.last.killed) return;
    const survivor = w.enemies.find(e => e.id === end.last!.id);
    // A survivor the wave finished is no survivor: the charge keeps waiting.
    if (!survivor) return;
    // The common cold state (stands, no touch, its mechanic off), without the consumable's brittleness (decision 12).
    survivor.chill = Math.max(survivor.chill ?? 0, FROST_EDGE_TIME);
    if (!window) setCounter(w, KEY.frostCharge, 0);
    talismanFired(w, COUNTER_TALISMANS.frostEdge);
    // Task 50, «Иней на клинке» II: the neighbour fixed at the release freezes too (still on the arena, wherever it stands now).
    const other = near && near.chain === end.chain && window ? w.enemies.find(e => e.id === near.near) : undefined;
    if (!other || kindOf(other).immune) return;
    other.chill = Math.max(other.chill ?? 0, Math.max(0, w.params.honeFrostTime ?? HONE.frostTime));
    honedFired(w, COUNTER_TALISMANS.frostEdge);
  },
  progress: w => {
    if (!counterWindowOn(w)) return chainCycle(w, FROST_EDGE_EVERY, counterOf(w, KEY.frostCharge) > 0);
    const links = chainLinks(w);
    return links === null ? null : { value: Math.min(links, FROST_EDGE_LINKS), max: FROST_EDGE_LINKS };
  },
});
