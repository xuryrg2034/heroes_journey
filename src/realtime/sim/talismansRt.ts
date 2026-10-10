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
 * - Numbers are constants here, not `Params`. No random draws, no transcendental `Math.*`.
 */
import { addCounter, counterOf, chainShieldOf, nextChainNo, registerBuildModule, setCounter, talismanFired, type BuildProgress } from './build';
import { BUILD_SOURCES, COUNTER_TALISMANS, RELICS } from './buildIds';
import { buildHitAll, enemiesInCircle } from './buildHits';
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
/** «Призма»: energy for every crystal the dash breaks (up to the energy cap). */
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

/** Enemy links of the chain now: the dash's reached links, or the drawn chain's living enemy links; null — no chain. */
function chainLinks(world: World): number | null {
  if (world.move) return world.move.kind === 'dash' && world.move.build ? world.move.build.links : null;
  if (!world.chain.length) return null;
  return world.chain.filter(l => l.kind === 'enemy' && world.enemies.some(e => e.id === l.id)).length;
}

/** The released chain number `chain` is a «every N-th» one. */
const nth = (chain: number, every: number): boolean => chain > 0 && chain % every === 0;

/** The cycle of «every N-th released chain» for the HUD: chains released in this cycle; `max` — the drawn chain is the N-th. */
function chainCycle(world: World, every: number, armed = false): BuildProgress {
  if (armed || nth(nextChainNo(world), every)) return { value: every, max: every };
  return { value: (world.kit?.chains ?? 0) % every, max: every };
}

// ---- «Пятое звено»: every 5th enemy link (fallen ones count) +2 power before its hit ----

registerBuildModule({
  id: COUNTER_TALISMANS.fifthLink,
  linkPower: (_w, link) => (nth(link.index, FIFTH_LINK_EVERY) ? FIFTH_LINK_POWER : 0),
  onLink: (w, link) => { if (nth(link.index, FIFTH_LINK_EVERY)) talismanFired(w, COUNTER_TALISMANS.fifthLink); },
  progress: w => {
    const links = chainLinks(w);
    if (links === null) return null;
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
    if (end.kills < 1) return;
    if (!nth(addCounter(w, KEY.thirdChains, 1), THIRD_CHAIN_EVERY)) return;
    // A new free jump replaces a waiting one (they never stack): the window starts again.
    setCounter(w, KEY.thirdChainUntil, w.time + THIRD_CHAIN_WINDOW);
    talismanFired(w, COUNTER_TALISMANS.thirdChain);
  },
  onJump: w => { if (freeJumpOpen(w)) setCounter(w, KEY.thirdChainUntil, 0); },
  onUpdate: w => { const until = counterOf(w, KEY.thirdChainUntil); if (until > 0 && until <= w.time) setCounter(w, KEY.thirdChainUntil, 0); },
  progress: w => (freeJumpOpen(w)
    ? { value: THIRD_CHAIN_EVERY, max: THIRD_CHAIN_EVERY }
    : { value: counterOf(w, KEY.thirdChains) % THIRD_CHAIN_EVERY, max: THIRD_CHAIN_EVERY }),
});

// ---- «Ударная волна»: a dash of 8+ enemy links — a wave of 2 around the hero at its end, 1 to every enemy, credited ----

registerBuildModule({
  id: COUNTER_TALISMANS.shockwave,
  onChainEnd: (w, end) => {
    if (end.links < SHOCKWAVE_LINKS) return;
    const at = { x: w.hero.x, y: w.hero.y };
    w.events.push({ type: 'wave', x: at.x, y: at.y, r: SHOCKWAVE_RADIUS });
    talismanFired(w, COUNTER_TALISMANS.shockwave);
    // Touching the body, not the reaper, no ×2 on a frozen one (buildHits.ts); every kill is the player's (`wave`).
    buildHitAll(w, enemiesInCircle(w, at, SHOCKWAVE_RADIUS), SHOCKWAVE_DAMAGE, BUILD_SOURCES.wave);
  },
  progress: w => {
    const links = chainLinks(w);
    return links === null ? null : { value: Math.min(links, SHOCKWAVE_LINKS), max: SHOCKWAVE_LINKS };
  },
});

// ---- «Призма»: every crystal the dash breaks +1 energy (up to the cap) ----

registerBuildModule({
  id: COUNTER_TALISMANS.prism,
  onCrystal: w => {
    w.energy = Math.min(ENERGY_CAP, w.energy + PRISM_ENERGY);
    talismanFired(w, COUNTER_TALISMANS.prism);
  },
});

// ---- «Добивание»: the last enemy link died — the after-chain invulnerability ×2; not with «Быстрые ноги» ----

const lastLinkDied = (end: { last: { killed: boolean } | null } | null): boolean => !!end?.last?.killed;

registerBuildModule({
  id: COUNTER_TALISMANS.finisher,
  active: w => holds(w, COUNTER_TALISMANS.finisher) && !TALISMAN_CONFLICTS[COUNTER_TALISMANS.finisher].some(id => holds(w, id)),
  modify: { chainShield: (_w, v, end) => (lastLinkDied(end) ? v * FINISHER_FACTOR : v) },
  onChainEnd: (w, end) => {
    // The flash only when the longer invulnerability was really given (chain.ts `finishMove`: a chain that killed enough).
    if (lastLinkDied(end) && end.kills >= Math.max(1, w.params.chainShieldMinKills) && chainShieldOf(w, end) > 0) talismanFired(w, COUNTER_TALISMANS.finisher);
  },
});

// ---- «Охотник на элит»: after every elite link the chain carries +3 power (once per elite, as a brazier) ----

registerBuildModule({
  id: COUNTER_TALISMANS.eliteHunter,
  afterLinkPower: (_w, link) => (link.elite ? ELITE_HUNTER_POWER : 0),
  onLink: (w, link, outcome) => { if (link.elite && (outcome === null || outcome.killed)) talismanFired(w, COUNTER_TALISMANS.eliteHunter); },
});

// ---- «Длинная рука»: every 4th released chain of the arena — R ×1.5 for the whole chain ----

registerBuildModule({
  id: COUNTER_TALISMANS.longArm,
  // The drawn chain is the next released one (`nextChainNo`): a cancelled chain keeps the number, so it is not counted.
  modify: { linkRadius: (w, v) => (nth(nextChainNo(w), LONG_ARM_EVERY) ? v * LONG_ARM_FACTOR : v) },
  onRelease: (w, release) => { if (nth(release.chain, LONG_ARM_EVERY)) talismanFired(w, COUNTER_TALISMANS.longArm); },
  progress: w => chainCycle(w, LONG_ARM_EVERY),
});

// ---- «Иней на клинке»: every 4th released chain — its surviving last enemy link freezes for 2 s; no survivor — the charge waits ----

registerBuildModule({
  id: COUNTER_TALISMANS.frostEdge,
  onChainEnd: (w, end) => {
    if (nth(end.chain, FROST_EDGE_EVERY)) setCounter(w, KEY.frostCharge, 1);
    if (!counterOf(w, KEY.frostCharge) || !end.last || end.last.killed) return;
    const survivor = w.enemies.find(e => e.id === end.last!.id);
    // A survivor the wave finished is no survivor: the charge keeps waiting.
    if (!survivor) return;
    // The common cold state (stands, no touch, its mechanic off), without the consumable's brittleness (decision 12).
    survivor.chill = Math.max(survivor.chill ?? 0, FROST_EDGE_TIME);
    setCounter(w, KEY.frostCharge, 0);
    talismanFired(w, COUNTER_TALISMANS.frostEdge);
  },
  progress: w => chainCycle(w, FROST_EDGE_EVERY, counterOf(w, KEY.frostCharge) > 0),
});
