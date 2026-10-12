/**
 * Casino stage 1, item 2 — «Ставка клятвы» (K8; docs/realtime-casino.md, «Ставка клятвы»; docs/realtime-casino-research.md,
 * 2.3 K8 and 8.5). Before a battle of the run the player may swear one oath. The stake is only the cauldron of that battle:
 * kept — the door pays it ×2, broken — ×0.5 (`purseOath`, purse.ts). HP, resources and the run are never at stake.
 *
 * The catalogue of stage 1 holds only conditions the world already sees as events:
 * - «Цепи 3+» — every released chain except the first has at least 3 enemy links;
 * - «Без прыжков» — no jump;
 * - «Без урона после целей» — no HP lost after the goals;
 * - «Кристалл в цепи» — a dash breaks a crystal at least once (with «Смена цвета» on, a colour shift the dash reaches counts too);
 * - «Не больше 2 урона за бой» — at most 2 HP lost in the fight;
 * - «Элита в окне» — the player kills an armoured elite in its open window at least once (offered only where the battle
 *   brings its guaranteed elite: run/rtRun.ts `rtOathOffer`);
 * - «Цепь 6+ хотя бы раз» (calibration 12.10.2026, docs/realtime-casino.md, «Калибровка экономики») — at least once a dash
 *   reaches 6 enemy links (struck, a plate taken, passed fallen — the links П4 counts, purse.ts `GREED_LINKS`); met in the
 *   tick of the 6th link. It took the place of «Без прыжков» in the run's offers (run/rtRun.ts `RT_OATH_IDS`): people jump
 *   about once a run, the bot never — that oath was free. «Без прыжков» stays in the catalogue: old journals and saves
 *   with it play as before; the sandbox's panel still offers it.
 * A «never» oath breaks in the tick of the event (`OathState.broken` — that tick, hashed); the fight goes on. An «at least
 * once» oath is met in the tick of the event (`met`) and checked at the door: not met by then — broken in the door's tick.
 *
 * Off by default (`Params.oathStake`); journals without the value play as before: no `world.oath`, no event, no change of
 * the door's record. The run turns it on (`RT_RUN_FORCED`) and passes the chosen oath in the loadout (`Loadout.oath`); the
 * sandbox — the debug panel's choice (the journalled command `{ t: 'oath' }`). No randomness here: which oaths a node
 * offers is the run's own stream (`rt-oath`, run/rtRun.ts).
 *
 * Type-only imports from world.ts: world.ts and chain.ts call this module at run time.
 */
import type { World } from './world';

export type OathId = 'chains3' | 'no-jump' | 'clean-after-goals' | 'crystal-chain' | 'damage2' | 'elite-window' | 'chain6';

/** One oath of the catalogue: `name` — the node card, `short` — the HUD line («Клятва: без прыжков ✓»), `rule` — the card's text. */
export interface OathDef {
  id: OathId;
  name: string;
  short: string;
  rule: string;
  /** «At least once»: met by an event, checked at the door. Otherwise — «never»: broken by an event. */
  once: boolean;
}

/** Баланс (research 2.3 K8, 8.5): enemy links every chain after the first must have («Цепи 3+»). */
export const OATH_CHAIN_LINKS = 3;
/** Баланс (calibration 12.10.2026): enemy links one dash must reach for «Цепь 6+ хотя бы раз». */
export const OATH_LONG_CHAIN_LINKS = 6;
/** Баланс: HP the hero may lose in the fight under «Не больше 2 урона за бой». */
export const OATH_DAMAGE_MAX = 2;
/** The stake (research 8.5): the cauldron of the battle ×2 for a kept oath, ×0.5 for a broken one. */
export const OATH_KEPT_MULT = 2;
export const OATH_BROKEN_MULT = 0.5;

/**
 * The catalogue: stage 1 in the order of the research (8.5), then «Цепь 6+ хотя бы раз» (12.10.2026). Which ones a run node
 * offers — run/rtRun.ts `RT_OATH_IDS` (not «Без прыжков» since 12.10.2026). «Уйти не раньше ×2 раздува» is not done.
 */
export const OATHS: readonly OathDef[] = [
  { id: 'chains3', name: 'Цепи 3+', short: 'цепи 3+', rule: `Каждая цепь, кроме первой, — из ${OATH_CHAIN_LINKS}+ врагов.`, once: false },
  { id: 'no-jump', name: 'Без прыжков', short: 'без прыжков', rule: 'Ни одного прыжка.', once: false },
  { id: 'clean-after-goals', name: 'Без урона после целей', short: 'без урона после целей', rule: 'После целей герой не теряет HP.', once: false },
  { id: 'crystal-chain', name: 'Кристалл в цепи', short: 'кристалл в цепи', rule: 'Хотя бы раз разбить кристалл цепью или сменить ей цвет.', once: true },
  { id: 'damage2', name: `Не больше ${OATH_DAMAGE_MAX} урона`, short: `не больше ${OATH_DAMAGE_MAX} урона`, rule: `За бой герой теряет не больше ${OATH_DAMAGE_MAX} HP.`, once: false },
  { id: 'elite-window', name: 'Элита в окне', short: 'элита в окне', rule: 'Хотя бы раз убить элиту в окне (без пластин).', once: true },
  { id: 'chain6', name: `Цепь ${OATH_LONG_CHAIN_LINKS}+ хотя бы раз`, short: `цепь ${OATH_LONG_CHAIN_LINKS}+`, rule: `Хотя бы раз рывок цепи бьёт ${OATH_LONG_CHAIN_LINKS}+ врагов.`, once: true },
];
export const OATH_IDS: readonly OathId[] = OATHS.map(def => def.id);
const BY_ID = new Map<string, OathDef>(OATHS.map(def => [def.id, def]));
export const isOathId = (value: unknown): value is OathId => typeof value === 'string' && BY_ID.has(value);
export const oathDef = (id: OathId): OathDef => BY_ID.get(id)!;

/**
 * The oath of the fight (`World.oath`, hashed; absent without an oath — worlds without it hash as before). `chains` — chains
 * released so far (only under «Цепи 3+»); `met` — the tick an «at least once» oath was met; `broken` — the tick it broke.
 */
export interface OathState { id: OathId; chains?: number; met?: number; broken?: number;
  /** «Цепи 3+»: the running dash is a short chain to a button — it holds only if the dash presses the button (absent otherwise). */
  button?: true;
  /** «Цепь 6+ хотя бы раз»: enemy links the running dash reached so far (from its release until it ends or meets the oath). */
  links?: number }

/** What the HUD line shows: `holds` — a «never» oath not broken yet or an «at least once» one met; `waits` — not met yet. */
export type OathMark = 'holds' | 'waits' | 'broken';

/** The oath the world is under (null — none, or the rule is off). */
function active(world: World): OathState | null { return world.params.oathStake && world.oath ? world.oath : null; }

/** The fight starts under `id` (createWorld with `Loadout.oath`; the sandbox command). Only while the rule is on. */
export function startOath(world: World, id: unknown): boolean {
  if (!world.params.oathStake || !isOathId(id)) return false;
  world.oath = { id };
  return true;
}

/**
 * The sandbox's choice (the command `{ t: 'oath' }`): a new oath from now (a fresh state), or none (`null`). Not after the
 * fight ended.
 */
export function chooseOath(world: World, id: OathId | null): boolean {
  if (!world.params.oathStake || world.status !== 'playing') return false;
  if (id === null) { delete world.oath; return true; }
  return startOath(world, id);
}

function breakOath(world: World, oath: OathState): void {
  if (oath.broken !== undefined) return;
  oath.broken = world.tick;
  world.events.push({ type: 'oath', action: 'broken', id: oath.id, tick: world.tick });
}

function meetOath(world: World, oath: OathState): void {
  if (oath.met !== undefined || oath.broken !== undefined) return;
  oath.met = world.tick;
  world.events.push({ type: 'oath', action: 'met', id: oath.id, tick: world.tick });
}

/**
 * A chain was released with `enemyLinks` enemy links (chain.ts `releaseChain`): «Цепи 3+» counts it. `onButton` — it ends on
 * an unpressed button: a button is pressed only by a chain (never by walking), so such a chain never breaks the oath (design
 * answer 11.10.2026: no stake without a safe way — «Двор кнопок»). The door and the goblin's lever count: the door can be
 * walked into, the lever is greed.
 */
export function oathRelease(world: World, enemyLinks: number, onButton = false): void {
  const oath = active(world);
  // «Цепь 6+ хотя бы раз»: the dash counts the links it really reaches (`oathLink`), not the drawn ones.
  if (oath?.id === 'chain6' && oath.met === undefined && oath.broken === undefined) oath.links = 0;
  if (oath?.id !== 'chains3') return;
  oath.chains = (oath.chains ?? 0) + 1;
  if (oath.chains <= 1 || enemyLinks >= OATH_CHAIN_LINKS) return;
  // A short chain to a button holds only if its dash really presses the button (a survivor may stop it first — review
  // 11.10.2026): decided at the press (`oathButton`) or at the dash's end (`oathDashEnd`).
  if (onButton) oath.button = true;
  else breakOath(world, oath);
}

/** The dash pressed a button (chain.ts `reachObject`): a short chain to it holds. */
export function oathButton(world: World): void {
  const oath = active(world);
  if (oath?.button) delete oath.button;
}

/**
 * The dash reached an enemy link (chain.ts `hitEnemy` — struck, a survivor, a plate taken; `passFallen` — a link that fell
 * before it): «Цепь 6+ хотя бы раз» is met in the tick of the 6th. The same links П4 counts (`cheque.links`).
 */
export function oathLink(world: World): void {
  const oath = active(world);
  if (oath?.id !== 'chain6' || oath.links === undefined) return;
  oath.links++;
  if (oath.links < OATH_LONG_CHAIN_LINKS) return;
  delete oath.links;
  meetOath(world, oath);
}

/** The dash ended (chain.ts `finishMove`): a short chain to a button that was not pressed breaks «Цепи 3+» now. */
export function oathDashEnd(world: World): void {
  const oath = active(world);
  // «Цепь 6+ хотя бы раз»: the dash's count ends with it.
  if (oath?.links !== undefined) delete oath.links;
  if (!oath?.button) return;
  delete oath.button;
  breakOath(world, oath);
}

/** The hero jumped (chain.ts `jump`). */
export function oathJump(world: World): void {
  const oath = active(world);
  if (oath?.id === 'no-jump') breakOath(world, oath);
}

/** The hero lost HP (world.ts `hurtHero`, after the stats counted it). */
export function oathHurt(world: World): void {
  const oath = active(world);
  if (oath?.id === 'clean-after-goals' && world.stage === 'greed') breakOath(world, oath);
  if (oath?.id === 'damage2' && world.stats.damageTaken > OATH_DAMAGE_MAX) breakOath(world, oath);
}

/** П9 «Второе дыхание» (world.ts): the hero survived a lethal hit — the oath of the fight counts as broken, whatever it is. */
export function oathForfeit(world: World): void {
  const oath = active(world);
  if (oath) breakOath(world, oath);
}

/** A dash broke a crystal (chain.ts `breakCrystal`), or reached a colour shift («Смена цвета», chain.ts `reachShift`). */
export function oathCrystal(world: World): void {
  const oath = active(world);
  if (oath?.id === 'crystal-chain') meetOath(world, oath);
}

/** An armoured elite died (elites.ts `eliteDeath`): the player's kill in its open window meets «Элита в окне». */
export function oathEliteDown(world: World, inWindow: boolean, credited: boolean): void {
  const oath = active(world);
  if (oath?.id === 'elite-window' && inWindow && credited) meetOath(world, oath);
}

/**
 * The exit into the door (world.ts `win`, before the cauldron's record): an «at least once» oath not met by now breaks in
 * this tick. Event `oath` `door` with the outcome and the cauldron's multiplier.
 */
export function oathDoor(world: World): void {
  const oath = active(world);
  if (!oath) return;
  if (oathDef(oath.id).once && oath.met === undefined) breakOath(world, oath);
  world.events.push({ type: 'oath', action: 'door', id: oath.id, tick: world.tick, kept: oath.broken === undefined, mult: oathMult(world) });
}

/** The cauldron's multiplier of the oath (purse.ts `purseOath`): none — 1, broken — ×0.5, otherwise ×2 (read at the door). */
export function oathMult(world: World): number {
  const oath = active(world);
  if (!oath) return 1;
  return oath.broken !== undefined ? OATH_BROKEN_MULT : OATH_KEPT_MULT;
}

/** The HUD line's state (null — no oath). */
export function oathMark(world: World): { def: OathDef; mark: OathMark } | null {
  const oath = active(world);
  if (!oath) return null;
  const def = oathDef(oath.id);
  return { def, mark: oath.broken !== undefined ? 'broken' : def.once && oath.met === undefined ? 'waits' : 'holds' };
}

/** «Клятва: без прыжков ✓» / «Клятва: кристалл в цепи» (not met yet) / «Клятва: без прыжков ×0,5» (broken). */
export function oathLine(world: World): string | null {
  const state = oathMark(world);
  if (!state) return null;
  const tail = state.mark === 'broken' ? ' ×0,5' : state.mark === 'holds' ? ' ✓' : '';
  return `Клятва: ${state.def.short}${tail}`;
}
