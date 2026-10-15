/**
 * Test «меняет стиль» (task 29, item 7; report docs/design-notes/reports/Талисманы меняющие стиль игры.md, «Тест: после
 * предмета лучшая цепь хотя бы иногда другая»): for every item of the build, how often the best chain with the item is
 * another chain than the best chain without it, at the same moments of the same fights. Read only, a heuristic for the
 * design, not a test: `npm run realtime:style-change` (`--seeds N`, default 20; `--secs S`, default 40; `--sample S` —
 * seconds between the moments, default 5; `--budget B` — chain states one search may expand, default 1000; `--links a,b` —
 * the caps of enemy links of a chain, default 3,6; `--top K`, default 8; `--row R`, default 5; `--items a,b` — only these
 * rows (keys of `ITEMS`); `--by-arena` — a table by arena).
 *
 * - **Fights.** The bot of the field measures (scripts/loopBot.ts, as `npm run realtime:measure-loops`): the run's params,
 *   harmless; the 12 arenas of the run, endless; the hero stands; a greedy chain every 2.5 s; the goals at 20 s. The fights
 *   play the loadout of the run's row `--row` (elites, affixes, plates, tough HP; `--row 0` — none, as measure-loops). The bot
 *   holds no item: one fight per arena and seed serves every item. Seeds `Math.imul(700 + k, 2654435761) >>> 0`, as there.
 * - **Moments.** Every `--sample` seconds of game time (the first one at the start), just before the bot draws its chain.
 * - **The item.** A shadow of the world whose kit holds it (a talisman, a relic or a form in `Kit.talismans`, a hammer in
 *   `Kit.hammer`) as if it had been taken at the arena's start: the kit counts the bot's chains released so far (`Kit.chains`),
 *   «Точильный камень» gives power 1 only before the first chain; a counter row plays `Params.counterWindow` off (the old
 *   window, as the run) or on (task 29). The world is never changed: the shadows have their own chain and kit (checked: the
 *   world hashes the same after every moment).
 * - **Chains.** A search over the game's own rules (as `--pierce` of measure-loops and sim/linkDepth.ts): from the empty chain,
 *   every enemy `canLink` allows and every passable object (crystal, loot, burning brazier, chest; buttons, the door and the
 *   lever end a chain and are skipped), nearest to the anchor first, up to the cap of enemy links, at most `--budget` chain
 *   states (a cut search is counted). With the loop on (`loopCandidates`) every closing it allows is a chain too. Every state is
 *   a chain the player could release. Two caps: 3 links (the people of v17: median 1–2) and 6 (a strong player). An item that
 *   may change which chains the rules allow (R, anchors, colour, the loop, power that keeps a link alive) gets its own search;
 *   both sets are pooled and every chain of the pool is valued in both worlds (a chain the rules of one world refuse is not in
 *   its choice), so a cut of one search is never the item's doing.
 * - **Value — one for every item.** Kills of the release first, then HP removed (a plate stripped counts 1, a killed enemy its
 *   HP before the hit). Read from the highlight (`planChain`: the links, the pierce's bodies, the return run's hits, the seal's
 *   strike on those inside) — the highlight is what the dash does (AGENTS.md). Items whose damage the highlight does not show
 *   (the fire, the end blast, the cut, the wave) add the difference of a real release: the world is copied, the chain released
 *   and played to the end of the dash and the return run plus 0.5 s, credited kills and HP removed are counted with the item
 *   and without; the difference is added to the highlight's value. Only the chain without the item and the `--top` best by
 *   the highlight are released (cost); the others keep the highlight's value.
 * - **The chain without the item** — the best by the value; of equal ones the first the search draws (nearest first), as a
 *   player who draws the nearest of equal links. **Different** — that chain is not among the best with the item: another
 *   chain (another set of links, another order or another closing) is now strictly better. Ties do not count as a change.
 *   Of the changes: «новой цепью» — the new best is a chain the plain rules refuse; «больше убийств» — it kills more than the
 *   chain without the item would with it (the rest win on HP removed). A fight counts once if any of its moments changed.
 * - **What the value does not see.** Invulnerability, energy, a free jump, HP, speed, the cold and the hold of a frozen enemy:
 *   an item whose payoff is only these never changes the best chain here, whatever it does to the game. Its row says so.
 *
 * Prints the date and HEAD. Seeds and the bot are fixed: the same HEAD gives the same numbers.
 */
import { execSync } from 'node:child_process';
import { arenaTemplate } from '../src/realtime/sim/arenas';
import '../src/realtime/sim/arenasStage3';
import '../src/realtime/sim/arenasCamera';
import { OBJECT_RADIUS, canLink, canLinkObject, chainAnchors, findEnemy, loopCandidates, planChain, reachOf, releaseChain, stepHero, tickScale, type ChainPlan, type StrikeOutcome } from '../src/realtime/sim/chain';
import { COUNTER_TALISMANS as CT, FORMS, FROST_PASS, HAMMERS, OATH_HUNGER, RELICS, type HammerId } from '../src/realtime/sim/buildIds';
import { platesOf } from '../src/realtime/sim/elites';
import { enemyArtRadius } from '../src/realtime/sim/enemies/kinds';
import { FlowField, dist } from '../src/realtime/sim/geometry';
import { hashWorld } from '../src/realtime/sim/hash';
import { emptyKit, type Kit, type Loadout } from '../src/realtime/sim/kit';
import { RngStreams } from '../src/realtime/sim/rng';
import { SIM_DT, Simulation } from '../src/realtime/sim/simulation';
import { update, type ChainLink, type Enemy, type LoopKind, type World } from '../src/realtime/sim/world';
import { arenaTitle } from '../src/realtime/run/arenaPools';
import { rtEliteAffixes, rtElitePlates, rtRandomElites, rtToughHp } from '../src/realtime/run/rtRun';
import { RUN_ARENAS, endless, harmlessRunParams, playChain, seedOf } from './loopBot';

const arg = (name: string, fallback: number): number => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const list = (name: string): string[] | null => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1].split(',') : null; };
const SEEDS = arg('--seeds', 20), SECS = arg('--secs', 40), BASE_S = Math.min(20, SECS / 2);
/** Game seconds between the bot's chains (v17: one in 2.5 s, as measure-loops). */
const EVERY = Math.max(1, Math.round(arg('--every', 2.5) * 60));
/** A moment every this many bot turns (`--sample` seconds). */
const SAMPLE_TURNS = Math.max(1, Math.round(arg('--sample', 5) * 60 / EVERY));
const BUDGET = arg('--budget', 1000), TOP = arg('--top', 8);
/** Caps of enemy links: 3 — the people of v17 (median 1–2, `docs/realtime-phase-b.md`, section 10), 6 — a strong player. */
const CAPS = (list('--links') ?? ['3', '6']).map(Number);
/** Ticks a release is played after the dash and the return run end (0.5 s: the fire's burn on those it was laid on). */
const SETTLE = 30;
const ONLY = list('--items');
/**
 * The run's row the fights play (`--row`, default 5 — the hammer's row): elites among the newcomers, their affixes and plates,
 * the tough HP, a guaranteed elite (run/rtRun.ts, by the row); `--row 0` — the fights of measure-loops (no loadout).
 */
const ROW = arg('--row', 5);
const LOADOUT: Loadout | undefined = ROW > 0 ? {
  randomElites: rtRandomElites(ROW), eliteAffixes: rtEliteAffixes(ROW), elitePlates: rtElitePlates(ROW),
  ...rtToughHp(ROW) > 2 ? { toughHp: rtToughHp(ROW) } : {}, ...ROW >= 3 ? { guaranteedElite: true } : {},
} : undefined;

// ---- Items ----

type Estimate = 'часто' | 'иногда' | 'редко' | 'нет' | '—';
interface Item {
  /** Row key (`--items`). */
  key: string;
  /** Kit id. */
  id: string;
  title: string;
  /** A hammer (`Kit.hammer`), else `Kit.talismans`. */
  hammer?: true;
  /** `Params.counterWindow` of the row (absent — the run's: off). */
  window?: boolean;
  /** The report's estimate (table «Оценка всех 26 предметов»); a counter with the window — the report's expectation; a form — none. */
  estimate: Estimate;
  /** The item may change which chains the rules allow (R, anchors, colour, loop, power that keeps a link alive): its own search. */
  search?: true;
  /** The highlight does not change with the item (no pure hook of power, R, anchors, colour, loop, pierce, return): its values are the plain ones (checked on the first moment of every arena). */
  same?: true;
  /** Its damage is outside the highlight: the best chains are released (the fire, the blast, the cut, the wave). */
  release?: true;
  /** Its payoff is outside the value (shield, energy, jump, HP, speed, cold). */
  blind?: string;
}

const ITEMS: Item[] = [
  { key: 'whetstone', id: 'whetstone', title: 'Точильный камень', estimate: 'редко', search: true },
  { key: 'dew-flask', id: 'dew-flask', title: 'Фляга росы', estimate: 'нет', same: true, blind: 'привал' },
  { key: 'tough-hide', id: 'tough-hide', title: 'Крепкая шкура', estimate: 'нет', same: true, blind: 'HP' },
  { key: 'millstone-shard', id: 'millstone-shard', title: 'Осколок жернова', estimate: 'редко', search: true },
  { key: 'hourglass', id: 'hourglass', title: 'Песочные часы', estimate: 'нет', same: true, blind: 'фазы' },
  { key: 'nimble-paws', id: 'nimble-paws', title: 'Ловкие лапы', estimate: 'нет', same: true, blind: 'прыжок' },
  { key: 'ash-ward', id: 'ash-ward', title: 'Пепельный оберег', estimate: 'нет', same: true, blind: 'HP' },
  { key: 'hero-anchor', id: 'hero-anchor', title: 'Якорь у героя', estimate: 'часто', search: true },
  { key: 'oath-hunger', id: OATH_HUNGER, title: 'Клятва голода', estimate: 'нет', same: true, blind: 'HP' },
  { key: 'fifth-link', id: CT.fifthLink, title: 'Пятое звено', estimate: 'редко', window: false, search: true },
  { key: 'third-chain', id: CT.thirdChain, title: 'Третья цепь', estimate: 'редко', window: false, same: true, blind: 'прыжок' },
  { key: 'prism', id: CT.prism, title: 'Призма', estimate: 'редко', window: false, same: true, blind: 'энергия' },
  { key: 'shockwave', id: CT.shockwave, title: 'Ударная волна', estimate: 'нет', window: false, same: true, release: true },
  { key: 'finishing-blow', id: CT.finisher, title: 'Добивание', estimate: 'редко', window: false, same: true, blind: 'неуязвимость' },
  { key: 'elite-hunter', id: CT.eliteHunter, title: 'Охотник на элит', estimate: 'иногда', window: false, search: true },
  { key: 'long-arm', id: CT.longArm, title: 'Длинная рука', estimate: 'иногда', window: false, search: true },
  { key: 'frost-edge', id: CT.frostEdge, title: 'Иней на клинке', estimate: 'иногда', window: false, same: true, blind: 'холод' },
  { key: 'relic-millstone', id: RELICS.millstone, title: 'Жернов', estimate: 'иногда', search: true },
  { key: 'relic-heavy-blade', id: RELICS.heavyBlade, title: 'Тяжёлый клинок', estimate: 'иногда', search: true },
  { key: 'relic-swift-feet', id: RELICS.swiftFeet, title: 'Быстрые ноги', estimate: 'нет', same: true, blind: 'скорость, неуязвимость' },
  { key: 'relic-wide-circle', id: RELICS.wideCircle, title: 'Широкий круг', estimate: 'иногда', search: true },
  { key: 'relic-blood-oath', id: RELICS.bloodOath, title: 'Кровавая клятва', estimate: 'нет', same: true, blind: 'энергия' },
  { key: 'fire-pass', id: HAMMERS.fire, title: 'Огненный проход', estimate: 'часто', hammer: true, same: true, release: true },
  { key: 'end-blast', id: HAMMERS.blast, title: 'Взрыв на конце', estimate: 'часто', hammer: true, same: true, release: true },
  { key: 'cutting-pass', id: HAMMERS.cut, title: 'Режущий проход', estimate: 'часто', hammer: true, same: true, release: true },
  { key: 'return-pass', id: HAMMERS.return, title: 'Возврат', estimate: 'часто', hammer: true },
  // Counters with the chain window (task 29): the report expects «Острие», «Улов», «Добивание», «Иней» as «иногда».
  { key: 'fifth-link+w', id: CT.fifthLink, title: 'Острие (окно)', estimate: 'иногда', window: true, search: true },
  { key: 'third-chain+w', id: CT.thirdChain, title: 'Улов (окно)', estimate: 'иногда', window: true, same: true, blind: 'прыжок' },
  { key: 'prism+w', id: CT.prism, title: 'Призма (окно)', estimate: '—', window: true, search: true },
  { key: 'shockwave+w', id: CT.shockwave, title: 'Ударная волна (окно, 4+)', estimate: '—', window: true, same: true, release: true },
  { key: 'finishing-blow+w', id: CT.finisher, title: 'Добивание (окно)', estimate: 'иногда', window: true, same: true, blind: 'неуязвимость' },
  { key: 'elite-hunter+w', id: CT.eliteHunter, title: 'Охотник на элит (окно)', estimate: '—', window: true, search: true },
  { key: 'long-arm+w', id: CT.longArm, title: 'Длинная рука (окно)', estimate: '—', window: true, search: true },
  { key: 'frost-edge+w', id: CT.frostEdge, title: 'Иней на клинке (окно)', estimate: 'иногда', window: true, same: true, blind: 'холод' },
  // Forms of task 29 (sandbox): the report's concepts; no estimate in its table.
  { key: 'form-seal', id: FORMS.seal, title: 'Печать', estimate: '—', search: true },
  { key: 'form-pierce', id: FORMS.pierce, title: 'Прямая', estimate: '—' },
  { key: 'form-fork', id: FORMS.fork, title: 'Развилка', estimate: '—', search: true },
  { key: 'form-alien', id: FORMS.alien, title: 'Чужак', estimate: '—', search: true },
  { key: 'form-twins', id: FORMS.twins, title: 'Близнецы', estimate: '—', search: true },
  { key: 'frost-pass', id: FROST_PASS, title: 'Наледь', estimate: '—', same: true, blind: 'холод' },
];
const ACTIVE = ONLY ? ITEMS.filter(i => ONLY.includes(i.key)) : ITEMS;

// ---- The world with the item ----

/** What the moment knows of the fight: chains the bot released so far. */
interface MomentInfo { chains: number }

/** A shadow of `w` with its own empty chain, and with `item` in its kit (as if taken at the arena's start). */
function shadowOf(w: World, item: Item | null, info: MomentInfo): World {
  const shadow: World = { ...w, chain: [] };
  delete shadow.chainClosed;
  if (!item) return shadow;
  const base: Kit = w.kit ?? emptyKit(), kit: Kit = { ...base, talismans: [...base.talismans] };
  if (item.hammer) kit.hammer = item.id as HammerId; else if (!kit.talismans.includes(item.id)) kit.talismans.push(item.id);
  // The layer counts the released chains while a module acts: the item would have counted the bot's.
  kit.chains = info.chains;
  // «Точильный камень»: power 1 for the first chain of the arena only.
  if (item.id === 'whetstone' && info.chains === 0) kit.firstPower += 1;
  shadow.kit = kit;
  if (item.window !== undefined) shadow.params = { ...w.params, counterWindow: item.window };
  return shadow;
}

// ---- Value ----

/** Kills, then HP removed (a plate counts 1). */
interface Value { kills: number; hp: number }
const cmp = (a: Value, b: Value): number => a.kills - b.kills || a.hp - b.hp;
const addHit = (v: Value, o: StrikeOutcome): void => { if (o.killed) v.kills++; v.hp += o.plate ? 1 : o.hpBefore - o.hpAfter; };

/** The value the highlight `plan` of the drawn chain of `w` shows. */
function planValue(w: World, plan: ChainPlan): Value {
  const v: Value = { kills: 0, hp: 0 };
  let survivor = false;
  for (const l of plan.links) { if (!l.outcome || survivor) continue; addHit(v, l.outcome); if (!l.outcome.killed && !l.outcome.plate) survivor = true; }
  for (const b of plan.pierce?.bodies ?? []) addHit(v, b.outcome);
  for (const h of plan.back?.hits ?? []) addHit(v, h.outcome);
  // The seal's strike (seal.ts `strikeSeal`: `damageEnemy` on those inside — a plate first, no ×2 of the cold).
  if (plan.seal) for (const id of plan.seal.inside) {
    const e = findEnemy(w, id);
    if (!e) continue;
    if (platesOf(e) > 0) v.hp++;
    else if (plan.seal.damage >= e.hp) { v.kills++; v.hp += e.hp; } else v.hp += plan.seal.damage;
  }
  return v;
}

// ---- Chains ----

interface Chain { key: string; links: ChainLink[]; closed?: LoopKind }
const keyOf = (links: readonly ChainLink[], closed?: LoopKind): string => links.map(l => `${l.kind === 'enemy' ? 'e' : 'o'}${l.id}`).join(',') + (closed ? `|${closed}` : '');
const PASS_KINDS: ReadonlySet<string> = new Set(['crystal', 'loot', 'brazier', 'chest']);

/** The chains the rules of `w` (a shadow) allow, found within the budget (nearest to the anchor first), with their values. */
function searchChains(w: World, cap: number): { chains: Chain[]; values: Map<string, Value>; cut: boolean } {
  const chains: Chain[] = [], values = new Map<string, Value>();
  let left = BUDGET, cut = false;
  const visit = (enemyLinks: number): void => {
    const plan = planChain(w);
    if (enemyLinks > 0) {
      const key = keyOf(w.chain);
      chains.push({ key, links: [...w.chain] });
      values.set(key, planValue(w, plan));
      for (const kind of loopCandidates(w)) {
        const closed = keyOf(w.chain, kind);
        w.chainClosed = kind;
        chains.push({ key: closed, links: [...w.chain], closed: kind });
        values.set(closed, planValue(w, planChain(w)));
        delete w.chainClosed;
      }
    }
    if (enemyLinks >= cap || plan.endsOnSurvivor || plan.endsOnObject) return;
    if (left <= 0) { cut = true; return; }
    left--;
    const anchors = chainAnchors(w), from = anchors[0] ?? w.hero;
    const near = (at: { x: number; y: number }, reach: number): boolean => anchors.some(a => dist(a, at) <= reach);
    const next: { link: ChainLink; d: number; enemy: boolean }[] = [];
    for (const e of w.enemies) if (near(e, reachOf(w, enemyArtRadius(w.params, e))) && canLink(w, e, plan)) next.push({ link: { kind: 'enemy', id: e.id }, d: dist(from, e), enemy: true });
    for (const o of w.objects) if (PASS_KINDS.has(o.kind) && near(o, reachOf(w, OBJECT_RADIUS)) && canLinkObject(w, o, plan)) next.push({ link: { kind: 'object', id: o.id }, d: dist(from, o), enemy: false });
    next.sort((a, b) => a.d - b.d || (a.link.kind < b.link.kind ? -1 : a.link.kind > b.link.kind ? 1 : a.link.id - b.link.id));
    for (const n of next) {
      w.chain.push(n.link);
      visit(enemyLinks + (n.enemy ? 1 : 0));
      w.chain.pop();
      if (cut) return;
    }
  };
  w.chain = [];
  visit(0);
  return { chains, values, cut };
}

/** The value of `chain` in `w` (a shadow); null — its rules refuse a link or the closing. */
function chainValue(w: World, chain: Chain): Value | null {
  w.chain = [];
  try {
    for (const link of chain.links) {
      const plan = planChain(w, w.chain, { pierce: false, back: false });
      if (link.kind === 'enemy') { const e = findEnemy(w, link.id); if (!e || !canLink(w, e, plan)) return null; }
      else { const o = w.objects.find(x => x.id === link.id); if (!o || !canLinkObject(w, o, plan)) return null; }
      w.chain.push(link);
    }
    if (chain.closed) {
      if (!loopCandidates(w).includes(chain.closed)) return null;
      w.chainClosed = chain.closed;
    }
    return planValue(w, planChain(w));
  } finally { w.chain = []; delete w.chainClosed; }
}

/** The value of `chain` in `w` (a shadow) whose rules allow it (not checked). */
function allowedValue(w: World, chain: Chain): Value {
  w.chain = [...chain.links];
  if (chain.closed) w.chainClosed = chain.closed;
  try { return planValue(w, planChain(w)); } finally { w.chain = []; delete w.chainClosed; }
}

// ---- A real release (items whose damage the highlight does not show) ----

/** A deep copy of the world that may run (the arena is shared: it is only read). */
function cloneWorld(w: World): World {
  const { arena, rng, events, ...rest } = w;
  void events;
  const copy = structuredClone(rest) as unknown as World;
  copy.arena = arena;
  copy.events = [];
  // The flow field is a class (its arrays are copied by `structuredClone`, its methods come back with the prototype).
  Object.setPrototypeOf(copy.flow, FlowField.prototype);
  const streams = new RngStreams(rng.seed);
  for (const [name, state] of rng.states()) streams.stream(name).state = state;
  copy.rng = streams;
  return copy;
}

/** One tick of the world as `Simulation.tick` runs it. */
function tick(w: World): void {
  if (w.hitstop > 0) w.hitstop = Math.max(0, w.hitstop - SIM_DT);
  else { const realDt = SIM_DT / tickScale(w); stepHero(w, realDt); update(w, SIM_DT, realDt); }
  w.tick++;
}

/** Two copies of the world run alike and hash as it does (the copy carries the whole state the step reads). */
function checkClone(w: World): void {
  const a = cloneWorld(w), b = cloneWorld(w);
  if (hashWorld(a) !== hashWorld(w)) throw new Error('a copy of the world hashes otherwise');
  for (let t = 0; t < 120; t++) { tick(a); tick(b); a.events.length = 0; b.events.length = 0; }
  if (hashWorld(a) !== hashWorld(b)) throw new Error('two copies of the world ran apart');
}

/** Credited kills and HP removed by really releasing `chain` in a copy of `w` (to the end of the dash and the run + 0.5 s). */
function releaseValue(w: World, chain: Chain): Value {
  const copy = cloneWorld(w);
  copy.chain = chain.links.map(l => ({ ...l }));
  if (chain.closed) copy.chainClosed = chain.closed;
  const before = new Map(copy.enemies.map(e => [e.id, { hp: e.hp, plates: platesOf(e) }] as const));
  const credited = new Set<number>();
  const v: Value = { kills: 0, hp: 0 };
  if (!releaseChain(copy)) return v;
  let settle = SETTLE;
  for (let t = 0; t < 1200 && settle > 0; t++) {
    tick(copy);
    for (const ev of copy.events) if (ev.type === 'kill' && ev.credited) credited.add(ev.enemyId);
    copy.events.length = 0;
    if (!copy.move || copy.status !== 'playing') settle--;
  }
  const now = new Map(copy.enemies.map(e => [e.id, e] as const));
  for (const [id, b] of before) {
    const e: Enemy | undefined = now.get(id);
    if (!e) { if (credited.has(id)) { v.kills++; v.hp += b.hp; } continue; }
    v.hp += Math.max(0, b.hp - e.hp) + Math.max(0, b.plates - platesOf(e));
  }
  return v;
}

// ---- A moment ----

/** `newChain` — the new best is a chain the plain rules refuse; `kills` — it kills more than the chain without the item would (with it). */
interface MomentResult { changed: boolean; cut: boolean; newChain: boolean; kills: boolean }

/** For every active item: is the chain without the item still among the best with it (chains up to `cap` enemy links)? */
function readMoment(w: World, info: MomentInfo, cap: number, checkSame: boolean): Map<string, MomentResult> {
  const out = new Map<string, MomentResult>();
  const plain = shadowOf(w, null, info), found = searchChains(plain, cap);
  const without = new Map<string, Value | null>(found.values);
  const valueWithout = (c: Chain): Value | null => { if (!without.has(c.key)) without.set(c.key, chainValue(plain, c)); return without.get(c.key)!; };
  // The chain without the item: the best by the value, the first the search drew of equal ones.
  let old: Chain | null = null;
  for (const c of found.chains) if (!old || cmp(found.values.get(c.key)!, found.values.get(old.key)!) > 0) old = c;
  const plainRelease = new Map<string, Value>();
  for (const item of ACTIVE) {
    if (!old) { out.set(item.key, { changed: false, cut: found.cut, newChain: false, kills: false }); continue; }
    const shadow = shadowOf(w, item, info);
    // «Точильный камень» acts on the first chain of the arena only: later its world is the plain one.
    const own = item.search && !(item.id === 'whetstone' && info.chains > 0) ? searchChains(shadow, cap) : null;
    const pool = new Map(found.chains.map(c => [c.key, c] as const));
    for (const c of own?.chains ?? []) if (!pool.has(c.key)) pool.set(c.key, c);
    const chains = [...pool.values()];
    // A chain the plain rules allow, the item's rules allow too (every item only widens them: R, anchors, colour, power); a
    // chain only the item's search found is valued by the search. `same`: the item leaves the highlight as it is.
    const withValues = new Map<string, Value | null>(own?.values ?? []);
    const valueWith = (c: Chain): Value | null => {
      if (!withValues.has(c.key)) withValues.set(c.key, item.same ? valueWithout(c) : allowedValue(shadow, c));
      return withValues.get(c.key)!;
    };
    // Both shortcuts are checked on the third moment of the first fight of every arena.
    if (checkSame) for (const c of found.chains) {
      const a = chainValue(shadow, c), b = valueWithout(c)!;
      if (!a) throw new Error(`«${item.title}» refuses the plain chain ${c.key}: value it with \`chainValue\``);
      if (item.same && cmp(a, b)) throw new Error(`«${item.title}» changes the highlight of ${c.key}: mark it without \`same\``);
    }
    // The damage outside the highlight: the chain without the item and the `TOP` best with it are released with it and without.
    const extra = new Map<string, Value>();
    if (item.release) {
      const ranked = chains.filter(c => valueWith(c)).sort((a, b) => cmp(valueWith(b)!, valueWith(a)!));
      const picked = new Map<string, Chain>([[old.key, old], ...ranked.slice(0, TOP).map(c => [c.key, c] as const)]);
      for (const c of picked.values()) {
        if (!valueWith(c)) continue;
        if (!plainRelease.has(c.key)) plainRelease.set(c.key, valueWithout(c) ? releaseValue(plain, c) : { kills: 0, hp: 0 });
        const a = releaseValue(shadow, c), b = plainRelease.get(c.key)!;
        extra.set(c.key, { kills: a.kills - b.kills, hp: a.hp - b.hp });
      }
    }
    const value = (c: Chain): Value | null => { const v = valueWith(c), e = extra.get(c.key); return v && e ? { kills: v.kills + e.kills, hp: v.hp + e.hp } : v; };
    const oldValue = value(old);
    let top: Chain | null = null, topValue: Value | null = null;
    for (const c of chains) { const v = value(c); if (v && (!topValue || cmp(v, topValue) > 0)) { top = c; topValue = v; } }
    const changed = !!top && !!topValue && (!oldValue || cmp(topValue, oldValue) > 0);
    out.set(item.key, { changed, cut: found.cut || !!own?.cut, newChain: changed && !valueWithout(top!), kills: changed && (!oldValue || topValue!.kills > oldValue.kills) });
  }
  return out;
}

// ---- Fights ----

interface Tally { moments: number; changed: number; fights: number; fightsChanged: number; cut: number; newChain: number; kills: number }
const newTally = (): Tally => ({ moments: 0, changed: 0, fights: 0, fightsChanged: 0, cut: 0, newChain: 0, kills: 0 });
const tallyKey = (item: string, cap: number): string => `${item}/${cap}`;
const tallies = new Map<string, Tally>();
const byArena = new Map<string, Map<string, Tally>>();
const tallyOf = (map: Map<string, Tally>, key: string): Tally => { let t = map.get(key); if (!t) map.set(key, t = newTally()); return t; };
let fights = 0, moments = 0, chainsSum = 0;
const cutMoments = new Map<number, number>(CAPS.map(c => [c, 0]));
const started = Date.now();

for (const arenaId of RUN_ARENAS) {
  const arenaTallies = new Map<string, Tally>();
  byArena.set(arenaId, arenaTallies);
  for (let k = 1; k <= SEEDS; k++) {
    fights++;
    const sim = new Simulation({ arena: endless(arenaTemplate(arenaId)), params: harmlessRunParams(), seed: seedOf(700 + k), ...LOADOUT ? { loadout: LOADOUT } : {} }), w = sim.world;
    const fightChanged = new Set<string>();
    let turns = 0, chains = 0;
    for (let t = 0; t < SECS * 60 && w.status === 'playing'; t++) {
      if (t === BASE_S * 60) sim.command({ t: 'goals' });
      if (t % EVERY === 15) {
        if (turns % SAMPLE_TURNS === 0 && !w.move && !w.chain.length) {
          const hash = hashWorld(w);
          if (moments === 0) checkClone(w);
          for (const cap of CAPS) {
            // `same` is checked on the third moment of the first fight of every arena (the field is full by then).
            const result = readMoment(w, { chains }, cap, k === 1 && turns === 2 * SAMPLE_TURNS);
            if ([...result.values()].some(r => r.cut)) cutMoments.set(cap, cutMoments.get(cap)! + 1);
            for (const [item, r] of result) {
              const key = tallyKey(item, cap);
              for (const tally of [tallyOf(tallies, key), tallyOf(arenaTallies, key)]) {
                tally.moments++;
                if (r.changed) tally.changed++;
                if (r.cut) tally.cut++;
                if (r.newChain) tally.newChain++;
                if (r.kills) tally.kills++;
              }
              if (r.changed) fightChanged.add(key);
            }
          }
          moments++;
          // The measure only reads: the fight goes on as it would without it.
          if (hashWorld(w) !== hash) throw new Error(`the moment changed the world (${arenaId}, seed ${k}, tick ${t})`);
        }
        turns++;
        chains += playChain(sim);
      }
      sim.tick();
      w.events.length = 0;
    }
    chainsSum += chains;
    for (const item of ACTIVE) for (const cap of CAPS) {
      const key = tallyKey(item.key, cap);
      for (const tally of [tallyOf(tallies, key), tallyOf(arenaTallies, key)]) { tally.fights++; if (fightChanged.has(key)) tally.fightsChanged++; }
    }
  }
  process.stderr.write(`${arenaTitle(arenaId)}: ${((Date.now() - started) / 1000).toFixed(0)} с\n`);
}

// ---- Report ----

const pct = (n: number, d: number): string => (d ? `${Math.round(100 * n / d)} %` : '—');
/** The measured class (thresholds of this script, a heuristic): by the share of fights with at least one change. */
function measured(t: Tally): Estimate {
  if (!t.changed) return 'нет';
  const f = t.fightsChanged / Math.max(1, t.fights);
  return f >= 0.75 ? 'часто' : f >= 0.25 ? 'иногда' : 'редко';
}
const head = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
const date = new Date().toISOString().slice(0, 10).split('-').reverse().join('.');
const num = (x: number, digits = 1): string => x.toFixed(digits).replace('.', ',');
console.log(`# Тест «меняет стиль» (задача 29, п. 7): ${date}, HEAD ${head}\n`);
console.log(`${SEEDS} seed × ${RUN_ARENAS.length} арен, ${SECS} с (база ${BASE_S} с, затем цели), ${ROW > 0 ? `снаряжение ряда ${ROW} (элиты, пластины, крепкие)` : 'без снаряжения'}; бот без предметов, цепь каждые ${num(EVERY / 60)} с; момент каждые ${num(SAMPLE_TURNS * EVERY / 60)} с, перед цепью бота. Поиск — до ${BUDGET} состояний; молоты и волна — настоящее отпускание цепи без предмета и ${TOP} лучших с ним.`);
console.log('Ценность: убийства отпускания, затем снятые HP (пластина — 1). «Другая»: цепь без предмета (лучшая, из равных — первая по поиску) уже не лучшая с ним. Из них «новой цепью» — без предмета такую цепь не собрать; «больше убийств» — новая лучшая убивает больше, остальные выигрывают снятыми HP.');
console.log('Класс замера (пороги скрипта): доля боёв, где хоть раз другая, ≥ 75 % — часто, ≥ 25 % — иногда, больше 0 — редко.\n');
const capHead = CAPS.map(c => `≤ ${c} звеньев: моменты / бои / новой цепью / больше убийств / класс`).join(' | ');
console.log(`| Предмет | оценка отчёта | ${capHead} |`);
console.log(`| --- | --- |${CAPS.map(() => ' --- |').join('')}`);
for (const item of ACTIVE) {
  const cells = CAPS.map(cap => {
    const t = tallies.get(tallyKey(item.key, cap))!;
    const cls = item.blind && !t.changed ? `нет (не видит: ${item.blind})` : measured(t);
    return `${pct(t.changed, t.moments)} / ${pct(t.fightsChanged, t.fights)} / ${pct(t.newChain, t.changed)} / ${pct(t.kills, t.changed)} / ${cls}`;
  });
  console.log(`| ${item.title} | ${item.estimate} | ${cells.join(' | ')} |`);
}
if (process.argv.includes('--by-arena')) for (const cap of CAPS) {
  console.log(`\nПо аренам, ≤ ${cap} звеньев — моменты с другой лучшей цепью:\n`);
  console.log(`| Предмет | ${RUN_ARENAS.map(arenaTitle).join(' | ')} |\n| --- |${RUN_ARENAS.map(() => ' --- |').join('')}`);
  for (const item of ACTIVE) console.log(`| ${item.title} | ${RUN_ARENAS.map(a => { const t = byArena.get(a)!.get(tallyKey(item.key, cap)); return t ? pct(t.changed, t.moments) : '—'; }).join(' | ')} |`);
}
console.log(`\nБоёв ${fights}, моментов ${moments}, цепей бота за бой ${num(chainsSum / Math.max(1, fights))}. Поиск обрезан бюджетом (без предмета или с ним): ${CAPS.map(c => `≤ ${c} — ${pct(cutMoments.get(c)!, moments)} моментов`).join(', ')}.`);
console.log(`(${((Date.now() - started) / 1000).toFixed(0)} с)`);
