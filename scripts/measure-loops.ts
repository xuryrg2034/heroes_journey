/**
 * Loop research, step 0 (docs/realtime-loop-research.md, sections 4.3 and 4.5): how often the field offers a loop, a loop
 * closed on the hero and a straight line, at the current numbers and with each reachability toggle of step 1 (section 4.2).
 * A heuristic for the design, not a test: `npm run realtime:measure-loops` (`--seeds N`, default 20; `--secs S`, default 40;
 * `--every S` — seconds between the bot's chains, default 2.5; `--walk` — the hero walks; `--variants base,rows,…`).
 *
 * The bot of the big-arena measure (scripts/realtime-big-arenas.ts): the hero takes no damage and stands — only his greedy
 * chains move him; the fight never ends by itself. The bot chains at the pace of the v17 players (one in 2.5 s): every
 * 0.67 s (the big-arena bot) it clears the same-colour neighbours round the hero and the figures near him thin out. 20 s of the base pace, then the goals are set and the
 * greed table runs. Every 0.5 s of game time the field is read:
 * - (а) a 4-cycle of one colour: every edge a link would take (R to the edge of the body, `linkToEdge`, and sight with
 *   `sightSlack`, chain.ts `reachRefusal`), at least one body centre inside (even-odd). «Где угодно» — anywhere; «от героя» —
 *   one of its corners is a first link the hero can take (the loop closes on the first link, so it must start there).
 * - (б) an arc of 3–5 links of one colour closed on the hero: the first link is in the hero's reach, the last one too, at
 *   least one body centre inside the polygon hero + arc.
 * - (в) a line of 3–5 links of one colour from a first link in the hero's reach, every turn ≤ 25° (cos ≥ 0.906); bodies on
 *   its continuation: centres ahead of the last link within R, at most 0.5 off the line.
 * «Inside» counts every enemy body but the corners (any colour, any kind, not the reaper); the median is of the best figure
 * of each moment that has one. Left out (the counts are upper bounds): the shield's guard (`canBeLinkedFrom`), a tough link
 * that would survive and end the chain before the figure closes, crystals as corners, the turn hero → first link of a line;
 * an edge counts if it holds in either direction (R + the larger body), the corridor is measured to body centres.
 * The palette by the row adds the colours of the arena's own start enemies (spawn.ts `palette`), as the game does.
 *
 * `--pierce` (loop research, step 3, «Прямая»; design 12.10.2026, point 14): only the base variant, by arena — how often the
 * field offers a pierce and how often it would kill. Every 0.5 s a search over the real chain rules (a shadow of the world with
 * its own chain, as sim/linkDepth.ts: `canLink` from the hero's first link, enemy links only, 3–5 of them, at most
 * `PIERCE_BUDGET` chain states) asks the sim's own plan (`planChain(...).pierce`, sim/pierce.ts `pierceShape`) on each path of 3+:
 * «доступна» — some path gives a pierce (a straight tail, its last link dies, P ≥ 1); «≥ 1 убит» — some pierce kills a body of
 * its corridor. The pierce is turned on in the shadow only; the bot's own chains play without it. Measurement = rule.
 *
 * Variants (section 4.2): base (the run's params, 4 colours, mixed groups); «палитра по рядам» (the run's `Loadout.colors`
 * by the row, rtRun.ts `rtColorsByRow`); «одноцветные группы» (`groupColor 'mono'`); «R 2,25» (the mage's R); and together.
 * The arenas are the run's 12 (pools, «Застава», «Последний рубеж») from their templates, without the phase A rosters.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { arenaTemplate, type ArenaTemplate } from '../src/realtime/sim/arenas';
import '../src/realtime/sim/arenasStage3';
import '../src/realtime/sim/arenasCamera';
import { NO_PIERCE, canLink, chainAnchor, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { enemyArtRadius, kindOf } from '../src/realtime/sim/enemies/kinds';
import { dist, lineOfSight, type Vec } from '../src/realtime/sim/geometry';
import type { Params } from '../src/realtime/sim/params';
import { defaultParams } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import { NO_COLOR, type ChainLink, type Enemy, type World } from '../src/realtime/sim/world';
import { ARENA_POOLS, arenaCandidates, arenaTitle, FINAL_ARENA, HARD_ARENA } from '../src/realtime/run/arenaPools';
import { rtColorsByRow, rtRunParams } from '../src/realtime/run/rtRun';

const arg = (name: string, fallback: number): number => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const SEEDS = arg('--seeds', 20), SECS = arg('--secs', 40), BASE_S = Math.min(20, SECS / 2);
/** Game seconds between the bot's chains: v17 telemetry — 8–14 chains in a fight of 13–36 s, about one in 2.5 s. */
const EVERY = Math.max(1, Math.round(arg('--every', 2.5) * 60));
/** `--walk`: the hero walks a pattern of directions (a new one every second, as the walking bot of the big-arena measure). */
const WALKING = process.argv.includes('--walk');
const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
/** Turn limit of a line (25°). */
const LINE_COS = 0.906;
/** Half-width of the corridor ahead of a line. */
const CORRIDOR = 0.5;
const MAX_ARC = 5;

// ---- Variants ----

interface Variant { id: string; title: string; rows: boolean; mono: boolean; r: number | null }
const VARIANTS: Variant[] = [
  { id: 'base', title: 'база (4 цвета, смешанные группы, R 1,875)', rows: false, mono: false, r: null },
  { id: 'rows', title: 'палитра по рядам', rows: true, mono: false, r: null },
  { id: 'mono', title: 'одноцветные группы', rows: false, mono: true, r: null },
  { id: 'r225', title: 'R 2,25 (маг)', rows: false, mono: false, r: 2.25 },
  { id: 'rows-mono', title: 'палитра по рядам + одноцветные группы', rows: true, mono: true, r: null },
  { id: 'all', title: 'всё вместе (+ R 2,25)', rows: true, mono: true, r: 2.25 },
];
const only = process.argv.indexOf('--variants');
const ACTIVE = only > 0 ? VARIANTS.filter(v => process.argv[only + 1].split(',').includes(v.id)) : VARIANTS;

/** The run's params, harmless: the hero cannot fall. */
function paramsOf(v: Variant): Params {
  const p = rtRunParams(defaultParams());
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0; p.porcupineQuills = 0;
  if (v.mono) p.groupColor = 'mono';
  if (v.r !== null) p.linkRadius = v.r;
  return p;
}
const endless = (a: ArenaTemplate): ArenaTemplate => ({ ...a, id: `${a.id}-loops`, killGoal: a.goal === 'kills' ? 100000 : a.killGoal, door: { x: -100, y: -100 } });

/** The greedy chain of the bots of the specs (sliceArenas.spec.ts, realtime-big-arenas.ts). */
function playChain(sim: Simulation): number {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return 0;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return 0;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind !== 'door')].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
  return 1;
}

// ---- Geometry of a moment ----

/** Even-odd: the point is inside the polygon. */
function inside(poly: readonly Vec[], p: Vec): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

interface Moment { cycle: boolean; cycleHero: boolean; cycleIn: number; arc: boolean; arcIn: number; line: boolean; lineAhead: number; field: number }

function readMoment(w: World): Moment {
  const p = w.params, R = p.linkRadius;
  const bodies = w.enemies.filter(e => e.kind !== 'reaper');
  const links = bodies.filter(e => e.color !== NO_COLOR && kindOf(e).chainable);
  const reach = (from: Vec, to: Enemy): boolean =>
    dist(from, to) <= R + (p.linkToEdge ? enemyArtRadius(p, to) : 0) && (!p.lineOfSight || lineOfSight(from, to, w.arena, -p.sightSlack));
  const start = new Set(links.filter(e => reach(w.hero, e)).map(e => e.id));
  // Same-colour adjacency: an edge a link would take in one of its directions.
  const adj = new Map<number, Enemy[]>(links.map(e => [e.id, []]));
  for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
    const a = links[i], b = links[j];
    if (a.color !== b.color) continue;
    if (reach(a, b) || reach(b, a)) { adj.get(a.id)!.push(b); adj.get(b.id)!.push(a); }
  }
  const countIn = (poly: Vec[], skip: Set<number>): number => bodies.filter(e => !skip.has(e.id) && inside(poly, e)).length;
  const m: Moment = { cycle: false, cycleHero: false, cycleIn: 0, arc: false, arcIn: 0, line: false, lineAhead: 0, field: bodies.length };

  // (а) 4-cycles a-b-c-d.
  let heroIn = 0, anyIn = 0;
  for (const a of links) for (const b of adj.get(a.id)!) for (const d of adj.get(a.id)!) {
    if (b.id >= d.id) continue;
    for (const c of adj.get(b.id)!) {
      if (c.id === a.id || c.id === d.id || !adj.get(d.id)!.some(x => x.id === c.id)) continue;
      const poly = [a, b, c, d], n = countIn(poly, new Set([a.id, b.id, c.id, d.id]));
      if (n < 1) continue;
      m.cycle = true; anyIn = Math.max(anyIn, n);
      if (poly.some(v => start.has(v.id))) { m.cycleHero = true; heroIn = Math.max(heroIn, n); }
    }
  }
  m.cycleIn = m.cycleHero ? heroIn : anyIn;

  // (б) arcs closed on the hero and (в) lines, by the simple paths of 3–5 links from a first link in reach.
  const hero: Vec = { x: w.hero.x, y: w.hero.y };
  const path: Enemy[] = [];
  const walk = (lineOk: boolean): void => {
    const k = path.length, last = path[k - 1];
    if (k >= 3) {
      // The closing edge to the hero: the last link in the hero's reach (the same rule as the first one).
      if (start.has(last.id)) {
        const n = countIn([hero, ...path], new Set(path.map(e => e.id)));
        if (n >= 1) { m.arc = true; m.arcIn = Math.max(m.arcIn, n); }
      }
      if (lineOk) {
        m.line = true;
        const prev = path[k - 2], dx = last.x - prev.x, dy = last.y - prev.y, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len, on = new Set(path.map(e => e.id));
        const ahead = bodies.filter(e => {
          if (on.has(e.id)) return false;
          const t = (e.x - last.x) * ux + (e.y - last.y) * uy, off = Math.abs(-(e.x - last.x) * uy + (e.y - last.y) * ux);
          return t > 0 && t <= R && off <= CORRIDOR;
        }).length;
        m.lineAhead = Math.max(m.lineAhead, ahead);
      }
    }
    if (k >= MAX_ARC) return;
    for (const next of adj.get(last.id)!) {
      if (path.includes(next)) continue;
      let straight = lineOk;
      if (straight && k >= 2) {
        const a = path[k - 2], ax = last.x - a.x, ay = last.y - a.y, bx = next.x - last.x, by = next.y - last.y;
        straight = (ax * bx + ay * by) >= LINE_COS * Math.hypot(ax, ay) * Math.hypot(bx, by);
      }
      path.push(next); walk(straight); path.pop();
    }
  };
  for (const first of links) if (start.has(first.id)) { path.push(first); walk(true); path.pop(); }
  return m;
}

// ---- «Прямая» (`--pierce`) ----

/** Chain states a pierce search may expand per moment (a dense crowd finds both answers long before). */
const PIERCE_BUDGET = 600;
interface PierceMoment { available: boolean; kill: boolean; cut: boolean }

/** Is a pierce on the field now — a path of 3–5 enemy links by the chain's own rules whose plan gives one (and kills)? */
function readPierce(w: World): PierceMoment {
  const shadow: World = { ...w, chain: [], params: { ...w.params, pierceEnabled: true } };
  delete shadow.chainClosed;
  const m: PierceMoment = { available: false, kill: false, cut: false };
  let left = PIERCE_BUDGET;
  const visit = (): void => {
    const n = shadow.chain.length;
    if (n >= 3) {
      const pierce = planChain(shadow).pierce;
      if (pierce) { m.available = true; if (pierce.kills > 0) m.kill = true; }
    }
    if (m.kill || n >= MAX_ARC) return;
    const plan = planChain(shadow, shadow.chain, NO_PIERCE);
    if (plan.endsOnSurvivor) return;
    if (left-- <= 0) { m.cut = true; return; }
    for (const e of w.enemies) {
      if (!canLink(shadow, e, plan)) continue;
      shadow.chain.push({ kind: 'enemy', id: e.id } as ChainLink);
      visit();
      shadow.chain.pop();
      if (m.kill || m.cut) return;
    }
  };
  visit();
  return m;
}

interface PierceTally { fights: number; chains: number; samples: number; available: number; kill: number; cut: number }

function measurePierce(arenaId: string): PierceTally {
  const t: PierceTally = { fights: 0, chains: 0, samples: 0, available: 0, kill: 0, cut: 0 };
  const arena = endless(arenaTemplate(arenaId)), params = paramsOf(VARIANTS[0]);
  for (let k = 1; k <= SEEDS; k++) {
    t.fights++;
    const sim = new Simulation({ arena, params, seed: seedOf(700 + k) }), w = sim.world;
    for (let tick = 0; tick < SECS * 60 && w.status === 'playing'; tick++) {
      if (WALKING && tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
      if (tick === BASE_S * 60) sim.command({ t: 'goals' });
      if (tick % EVERY === 15) t.chains += playChain(sim);
      sim.tick();
      w.events.length = 0;
      if (tick % 30 === 29 && !w.move) {
        const m = readPierce(w);
        t.samples++;
        if (m.available) t.available++;
        if (m.kill) t.kill++;
        if (m.cut) t.cut++;
      }
    }
  }
  return t;
}

// ---- Tallies ----

interface Tally { fights: number; chains: number; samples: number; field: number; cycle: number; cycleHero: number; cycleIn: number[]; arc: number; arcIn: number[]; line: number; lineHit: number; lineAhead: number[] }
const newTally = (): Tally => ({ fights: 0, chains: 0, samples: 0, field: 0, cycle: 0, cycleHero: 0, cycleIn: [], arc: 0, arcIn: [], line: 0, lineHit: 0, lineAhead: [] });
function add(t: Tally, m: Moment): void {
  t.samples++; t.field += m.field;
  if (m.cycle) t.cycle++;
  if (m.cycleHero) t.cycleHero++;
  if (m.cycle) t.cycleIn.push(m.cycleIn);
  if (m.arc) { t.arc++; t.arcIn.push(m.arcIn); }
  if (m.line) { t.line++; t.lineAhead.push(m.lineAhead); if (m.lineAhead > 0) t.lineHit++; }
}
function merge(into: Tally, t: Tally): void {
  into.fights += t.fights; into.chains += t.chains; into.samples += t.samples; into.field += t.field; into.cycle += t.cycle; into.cycleHero += t.cycleHero; into.arc += t.arc; into.line += t.line; into.lineHit += t.lineHit;
  into.cycleIn.push(...t.cycleIn); into.arcIn.push(...t.arcIn); into.lineAhead.push(...t.lineAhead);
}

function measure(arenaId: string, v: Variant, colors: number): Tally {
  const t = newTally(), arena = endless(arenaTemplate(arenaId)), params = paramsOf(v);
  for (let k = 1; k <= SEEDS; k++) {
    t.fights++;
    const sim = new Simulation({ arena, params, seed: seedOf(700 + k), ...colors < 4 ? { loadout: { colors } } : {} }), w = sim.world;
    for (let tick = 0; tick < SECS * 60 && w.status === 'playing'; tick++) {
      if (WALKING && tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
      if (tick === BASE_S * 60) sim.command({ t: 'goals' });
      if (tick % EVERY === 15) t.chains += playChain(sim);
      sim.tick();
      w.events.length = 0;
      if (tick % 30 === 29 && !w.move) add(t, readMoment(w));
    }
  }
  return t;
}

// ---- Report ----

const pct = (n: number, d: number): string => (d ? `${Math.round(100 * n / d)} %` : '—');
const mean = (xs: number[]): string => (xs.length ? (xs.reduce((a, c) => a + c, 0) / xs.length).toFixed(1).replace('.', ',') : '—');
const median = (xs: number[]): string => { if (!xs.length) return '—'; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; const m = s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; return String(m).replace('.', ','); };
const row = (label: string, t: Tally): string =>
  `| ${label} | ${(t.field / Math.max(1, t.samples)).toFixed(1).replace('.', ',')} | ${pct(t.cycle, t.samples)} | ${pct(t.cycleHero, t.samples)} | ${median(t.cycleIn)} (${mean(t.cycleIn)}) | ${pct(t.arc, t.samples)} | ${median(t.arcIn)} (${mean(t.arcIn)}) | ${pct(t.line, t.samples)} | ${pct(t.lineHit, t.samples)} | ${median(t.lineAhead)} (${mean(t.lineAhead)}) |`;
const HEAD = '| | тел | (а) 4-цикл | (а) от героя | внутри | (б) дуга на героя | внутри | (в) линия 3+ | с телом впереди | тел впереди |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

const ARENAS = [...ARENA_POOLS.map(e => e.arena), HARD_ARENA, FINAL_ARENA];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const started = Date.now();
if (process.argv.includes('--pierce')) {
  console.log(`# Измерение «Прямой» (шаг 3): ${SEEDS} seed × ${ARENAS.length} арен, ${SECS} с (база ${BASE_S} с, затем цели), срез каждые 0,5 с, цепь бота каждые ${(EVERY / 60).toFixed(2).replace('.', ',')} с, герой ${WALKING ? 'ходит' : 'стоит'}, поиск до ${PIERCE_BUDGET} состояний\n`);
  console.log('| Арена | срезов | доступна | ≥ 1 тело убито | поиск обрезан |\n| --- | --- | --- | --- | --- |');
  const all: PierceTally = { fights: 0, chains: 0, samples: 0, available: 0, kill: 0, cut: 0 };
  for (const arena of ARENAS) {
    const t = measurePierce(arena);
    all.fights += t.fights; all.chains += t.chains; all.samples += t.samples; all.available += t.available; all.kill += t.kill; all.cut += t.cut;
    console.log(`| ${arenaTitle(arena)} | ${t.samples} | ${pct(t.available, t.samples)} | ${pct(t.kill, t.samples)} | ${pct(t.cut, t.samples)} |`);
  }
  console.log(`| **все арены** | ${all.samples} | ${pct(all.available, all.samples)} | ${pct(all.kill, all.samples)} | ${pct(all.cut, all.samples)} |`);
  console.log(`\nЦепей бота за бой: ${(all.chains / Math.max(1, all.fights)).toFixed(1).replace('.', ',')}.`);
  console.log(`(${((Date.now() - started) / 1000).toFixed(0)} с)`);
  process.exit(0);
}
console.log(`# Измерение петли (шаг 0): ${SEEDS} seed × ${ARENAS.length} арен, ${SECS} с (база ${BASE_S} с, затем цели), срез каждые 0,5 с, цепь бота каждые ${(EVERY / 60).toFixed(2).replace('.', ',')} с, герой ${WALKING ? 'ходит' : 'стоит'}\n`);
console.log('«внутри», «тел впереди» — медиана (среднее) по моментам, где фигура есть.\n');
for (const v of ACTIVE) {
  // Palettes this variant plays per arena: 4, or by the rows the arena stands on.
  const cache = new Map<string, Tally>();
  const tally = (arena: string, colors: number): Tally => {
    const key = `${arena}/${colors}`;
    if (!cache.has(key)) cache.set(key, measure(arena, v, colors));
    return cache.get(key)!;
  };
  const rowsOf = (arena: string): number[] => ARENA_POOLS.find(e => e.arena === arena)?.rows ? ROWS.filter(r => arenaCandidates(r).includes(arena)) : [];
  console.log(`## ${v.title}\n\nПо рядам похода (арены пула ряда, поровну):\n\n${HEAD}`);
  const all = newTally();
  for (const r of ROWS) {
    const t = newTally(), colors = v.rows ? rtColorsByRow(r) : 4;
    for (const arena of arenaCandidates(r)) merge(t, tally(arena, colors));
    console.log(row(`ряд ${r}${v.rows ? ` (${colors} цв.)` : ''}`, t));
  }
  console.log(`\nПо аренам${v.rows ? ' (палитра — по рядам арены; «Застава» и «Последний рубеж» — 4 цвета)' : ''}:\n\n${HEAD}`);
  for (const arena of ARENAS) {
    const palettes = v.rows ? [...new Set(rowsOf(arena).map(rtColorsByRow))] : [4];
    for (const colors of palettes.length ? palettes : [4]) {
      const t = tally(arena, colors);
      merge(all, t);
      console.log(row(`${arenaTitle(arena)}${v.rows ? ` (${colors} цв.)` : ''}`, t));
    }
  }
  console.log(row('**все замеры**', all));
  console.log(`\nЦепей бота за бой: ${(all.chains / Math.max(1, all.fights)).toFixed(1).replace('.', ',')} (среднее по всем замерам).`);
  console.log('');
}
console.log(`(${((Date.now() - started) / 1000).toFixed(0)} с)`);
