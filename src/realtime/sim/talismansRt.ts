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
import { addCounter, buildStateOf, chainEnemyLinks, colorShiftOf, counterOf, chainShieldOf, nextChainNo, registerBuildModule, setBuildState, setCounter, talismanFired, type BuildProgress, type LinkContext } from './build';
import { BUILD_SOURCES, COUNTER_TALISMANS, FUSIONS, RELICS } from './buildIds';
import { kindOf } from './enemies/kinds';
import { frostWaveCold } from './fusions';
import { buildHitAll, enemiesInCircle, shadowHitAll } from './buildHits';
import type { Params } from './params';
import type { World } from './world';

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
} as const;

const holds = (world: World, id: string): boolean => !!world.kit?.talismans.includes(id);

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

/** «Пятое звено» fires on the `index`-th enemy link of the dash (1, 2, …) — the view's highlight reads the same rule (task 35, С4). */
export const fifthLinkFiresAt = (w: World, index: number): boolean => (counterWindowOn(w) ? index === EDGE_LINK : nth(index, FIFTH_LINK_EVERY));
const fifthLinkFires = (w: World, link: LinkContext): boolean => fifthLinkFiresAt(w, link.index);

registerBuildModule({
  id: COUNTER_TALISMANS.fifthLink,
  linkPower: (w, link) => (fifthLinkFires(w, link) ? (counterWindowOn(w) ? EDGE_POWER : FIFTH_LINK_POWER) : 0),
  onLink: (w, link) => { if (fifthLinkFires(w, link)) talismanFired(w, COUNTER_TALISMANS.fifthLink); },
  progress: w => {
    const links = chainLinks(w);
    if (links === null) return null;
    if (counterWindowOn(w)) return { value: Math.min(links, EDGE_LINK), max: EDGE_LINK };
    return { value: links > 0 && nth(links, FIFTH_LINK_EVERY) ? FIFTH_LINK_EVERY : links % FIFTH_LINK_EVERY, max: FIFTH_LINK_EVERY };
  },
});

// ---- «Третья цепь»: every 3rd chain of the arena that killed — the next jump within 5 s is free ----

/** The free jump waits (game time). */
const freeJumpOpen = (world: World): boolean => counterOf(world, KEY.thirdChainUntil) > world.time;

registerBuildModule({
  id: COUNTER_TALISMANS.thirdChain,
  modify: { jumpCost: (w, v) => (freeJumpOpen(w) ? 0 : v) },
  onChainEnd: (w, end) => {
    // With the chain window — «Улов»: this chain killed 3+ (no count between chains).
    if (counterWindowOn(w) ? end.kills < CATCH_KILLS : end.kills < 1) return;
    if (!counterWindowOn(w) && !nth(addCounter(w, KEY.thirdChains, 1), THIRD_CHAIN_EVERY)) return;
    // A new free jump replaces a waiting one (they never stack): the window starts again.
    setCounter(w, KEY.thirdChainUntil, w.time + THIRD_CHAIN_WINDOW);
    talismanFired(w, COUNTER_TALISMANS.thirdChain);
  },
  onJump: w => { if (freeJumpOpen(w)) setCounter(w, KEY.thirdChainUntil, 0); },
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
interface WaveState { fixed: number[] }

registerBuildModule({
  id: COUNTER_TALISMANS.shockwave,
  // Task 29: the shadow of «Возврат» sees the wave (the same threshold, circle and hit, on the planned end).
  endShadow: (w, end, enemies) => {
    if (end.links < shockwaveLinksOf(w.params)) return null;
    const targets = enemiesInCircle({ ...w, enemies: [...enemies] }, end.at, SHOCKWAVE_RADIUS);
    return { enemies: shadowHitAll(enemies, targets, SHOCKWAVE_DAMAGE, BUILD_SOURCES.wave), struck: targets.map(e => e.id) };
  },
  // `returnWaveFixed`: the release fixes the wave's bodies of the highlight. `release.back` is there only with «Возврат» and
  // `returnFixed` (chain.ts `releaseChain`), its `ends` only with `returnShadowEnd` and a wave in the plan; no plan — the old wave.
  onRelease: (w, release) => {
    if (!w.params.returnWaveFixed) return;
    const fixed = release.back?.ends?.[COUNTER_TALISMANS.shockwave];
    setBuildState(w, COUNTER_TALISMANS.shockwave, fixed ? { fixed: [...fixed] } satisfies WaveState : undefined);
  },
  onChainEnd: (w, end) => {
    const state = buildStateOf<WaveState>(w, COUNTER_TALISMANS.shockwave);
    if (state) setBuildState(w, COUNTER_TALISMANS.shockwave, undefined);
    // Task 46 «Ледяная волна»: the wave's bodies the release fixed from the highlight (absent without the fusion).
    const ice = buildStateOf<WaveState>(w, FUSIONS.frostWave);
    if (ice) setBuildState(w, FUSIONS.frostWave, undefined);
    if (end.links < shockwaveLinksOf(w.params)) return;
    const at = { x: w.hero.x, y: w.hero.y };
    w.events.push({ type: 'wave', x: at.x, y: at.y, r: SHOCKWAVE_RADIUS });
    talismanFired(w, COUNTER_TALISMANS.shockwave);
    // Touching the body, not the reaper, no ×2 on a frozen one (buildHits.ts); every kill is the player's (`wave`). Fixed at
    // the release: those bodies still on the arena, wherever they stand now (one that walked in is not struck).
    const fixed = ice ?? state;
    const targets = fixed ? fixed.fixed.flatMap(id => w.enemies.filter(e => e.id === id)) : enemiesInCircle(w, at, SHOCKWAVE_RADIUS);
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
  onColorShift: prismFires,
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

function finisherHolds(w: World, end: { chain: number; last: { id: number; killed: boolean } | null } | null): boolean {
  if (!end || !lastLinkDied(end)) return false;
  if (!counterWindowOn(w)) return true;
  const state = buildStateOf<FinisherState>(w, COUNTER_TALISMANS.finisher);
  return !!state && state.chain === end.chain && state.top.includes(end.last!.id);
}

registerBuildModule({
  id: COUNTER_TALISMANS.finisher,
  active: w => holds(w, COUNTER_TALISMANS.finisher) && !TALISMAN_CONFLICTS[COUNTER_TALISMANS.finisher].some(id => holds(w, id)),
  modify: { chainShield: (w, v, end) => (finisherHolds(w, end) ? v * FINISHER_FACTOR : v) },
  onRelease: (w, release) => {
    if (!counterWindowOn(w)) return;
    const hp = release.links.flatMap(l => { const e = l.kind === 'enemy' ? w.enemies.find(x => x.id === l.id) : undefined; return e ? [{ id: e.id, hp: e.hp }] : []; });
    const max = hp.reduce((m, h) => Math.max(m, h.hp), -Infinity);
    setBuildState(w, COUNTER_TALISMANS.finisher, hp.length ? { chain: release.chain, top: hp.filter(h => h.hp === max).map(h => h.id) } satisfies FinisherState : undefined);
  },
  onChainEnd: (w, end) => {
    // The flash only when the longer invulnerability was really given (chain.ts `finishMove`: a chain that killed enough).
    if (finisherHolds(w, end) && end.kills >= Math.max(1, w.params.chainShieldMinKills) && chainShieldOf(w, end) > 0) talismanFired(w, COUNTER_TALISMANS.finisher);
    if (counterWindowOn(w)) setBuildState(w, COUNTER_TALISMANS.finisher, undefined);
  },
});

// ---- «Охотник на элит»: after every elite link the chain carries +3 power (once per elite, as a brazier) ----

// With the chain window: after an elite or a tough link (HP above 0 before its hit, `toughLink`) — still +3 once per link.

const hunterLink = (w: World, link: LinkContext, outcome: { hpBefore: number } | null): boolean => link.elite || (counterWindowOn(w) && toughLink(link, outcome));

registerBuildModule({
  id: COUNTER_TALISMANS.eliteHunter,
  afterLinkPower: (w, link, outcome) => (hunterLink(w, link, outcome) ? ELITE_HUNTER_POWER : 0),
  // The package: a plate pass counts as the elite's link (the chain goes on through it).
  onLink: (w, link, outcome) => { if (hunterLink(w, link, outcome) && (outcome === null || outcome.killed || outcome.plate)) talismanFired(w, COUNTER_TALISMANS.eliteHunter); },
});

// ---- «Длинная рука»: every 4th released chain of the arena — R ×1.5 for the whole chain ----

// With the chain window: the drawn chain holds 2 links or more — its 3rd and every next link (the closing edge of a loop too)
// is taken with R ×1.5 (`world.chain`; no chain or a dash — the usual R).

/** «Длинная рука» with the chain window: the next link of the drawn chain is its 3rd or later. */
const longArmReach = (w: World): boolean => w.chain.length >= LONG_ARM_FROM - 1;

registerBuildModule({
  id: COUNTER_TALISMANS.longArm,
  // The drawn chain is the next released one (`nextChainNo`): a cancelled chain keeps the number, so it is not counted.
  modify: { linkRadius: (w, v) => ((counterWindowOn(w) ? longArmReach(w) : nth(nextChainNo(w), LONG_ARM_EVERY)) ? v * LONG_ARM_FACTOR : v) },
  onRelease: (w, release) => {
    if (counterWindowOn(w) ? release.links.length >= LONG_ARM_FROM : nth(release.chain, LONG_ARM_EVERY)) talismanFired(w, COUNTER_TALISMANS.longArm);
  },
  progress: w => {
    if (!counterWindowOn(w)) return chainCycle(w, LONG_ARM_EVERY);
    // Links of the drawn chain up to 2: at 2 the long reach is on.
    return w.chain.length && !w.move ? { value: Math.min(w.chain.length, LONG_ARM_FROM - 1), max: LONG_ARM_FROM - 1 } : null;
  },
});

// ---- «Иней на клинке»: every 4th released chain — its surviving last enemy link freezes for 2 s; no survivor — the charge waits ----

// With the chain window: a chain of 3+ enemy links reached (the survivor counts) that ended on a survivor freezes it for 2 s
// (no charge, no count between chains).

registerBuildModule({
  id: COUNTER_TALISMANS.frostEdge,
  onChainEnd: (w, end) => {
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
  },
  progress: w => {
    if (!counterWindowOn(w)) return chainCycle(w, FROST_EDGE_EVERY, counterOf(w, KEY.frostCharge) > 0);
    const links = chainLinks(w);
    return links === null ? null : { value: Math.min(links, FROST_EDGE_LINKS), max: FROST_EDGE_LINKS };
  },
});
