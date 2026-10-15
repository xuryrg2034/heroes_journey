/**
 * Task 33 «Цена „Близнецов“ и „Развилки“» (docs/design-notes/tasks-29-30.md; report docs/design-notes/reports/Цена форм цепи.md,
 * П1–П3): how long the best chain may be with a form and its price, against the chain without a form, at the same moments of the
 * same fights. Read only, a heuristic for the design, not a test: `npm run realtime:forms-price` (`--seeds N`, default 8; `--secs
 * S`, default 40; `--sample S` — seconds between the moments, default 10; `--budget B` — chain states one moment's search may
 * expand, default 3000; `--max L` — the longest chain looked for, default 40).
 *
 * - **Fights.** The bot of the field measures (scripts/loopBot.ts): the run's params made harmless (4 colours), the run's 12
 *   arenas, endless; the hero stands; a greedy chain every 2.5 s; the goals at 20 s. Seeds `Math.imul(k, 2654435761) >>> 0`,
 *   k = 1…N. The bot holds no form: one fight serves every variant.
 * - **Variants.** A shadow of the world (its own empty chain) whose kit holds the form and whose params hold the variant:
 *   «без формы»; «Близнецы» free (`twinsAlternate` and `twinsNoShift` off — the old pair) and with the price (both on);
 *   «Развилка» with `forkBranches` 0 (no limit, the old form), 1 and 2. Each with `colorShiftLinks` 0 (the sandbox) and 6 (the run).
 * - **The best chain.** The longest chain the game's own rules allow from the hero now (sim/linkDepth.ts `linkDepth`: `canLink`,
 *   the anchors, the colour rule, survivors and objects end it; crystals, loot and braziers pass), in enemy links: every first
 *   link the rules allow, nearest first, the moment's budget shared among them (a cut search is a lower bound; its share is
 *   printed). The share of the field — that length over the enemies on the arena.
 *
 * Prints the date and HEAD. Seeds and the bot are fixed: the same HEAD gives the same numbers.
 */
import { execSync } from 'node:child_process';
import { arenaTemplate } from '../src/realtime/sim/arenas';
import '../src/realtime/sim/arenasStage3';
import '../src/realtime/sim/arenasCamera';
import { canLink } from '../src/realtime/sim/chain';
import { FORMS } from '../src/realtime/sim/buildIds';
import { dist } from '../src/realtime/sim/geometry';
import { hashWorld } from '../src/realtime/sim/hash';
import { emptyKit, type Kit } from '../src/realtime/sim/kit';
import { linkDepth } from '../src/realtime/sim/linkDepth';
import type { Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { World } from '../src/realtime/sim/world';
import { arenaTitle } from '../src/realtime/run/arenaPools';
import { RUN_ARENAS, endless, harmlessRunParams, playChain, seedOf } from './loopBot';

const arg = (name: string, fallback: number): number => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const SEEDS = arg('--seeds', 8), SECS = arg('--secs', 40), SAMPLE = arg('--sample', 10), BUDGET = arg('--budget', 3000), MAX = arg('--max', 40);
/** The bot draws every 2.5 s (150 ticks), the first at tick 15; the goals at 20 s. */
const EVERY = 150, GOALS_S = 20, SAMPLE_TURNS = Math.max(1, Math.round(SAMPLE * 60 / EVERY));

interface Variant { key: string; title: string; form: string | null; params: Partial<Params> }
const VARIANTS: readonly Variant[] = [
  { key: 'none', title: 'без формы', form: null, params: {} },
  { key: 'twins-free', title: '«Близнецы» свободно', form: FORMS.twins, params: { twinsAlternate: false, twinsNoShift: false } },
  { key: 'twins-price', title: '«Близнецы» с ценой', form: FORMS.twins, params: { twinsAlternate: true, twinsNoShift: true } },
  { key: 'fork-0', title: '«Развилка» без предела', form: FORMS.fork, params: { forkBranches: 0 } },
  { key: 'fork-1', title: '«Развилка» 1', form: FORMS.fork, params: { forkBranches: 1 } },
  { key: 'fork-2', title: '«Развилка» 2', form: FORMS.fork, params: { forkBranches: 2 } },
];
const SHIFTS = [0, 6] as const;

/** A shadow of `w` with its own empty chain, the variant's form in its kit and its params. */
function shadowOf(w: World, v: Variant, shift: number): World {
  const shadow: World = { ...w, chain: [], params: { ...w.params, ...v.params, colorShiftLinks: shift } };
  delete shadow.chainClosed;
  const base: Kit = w.kit ?? emptyKit(), kit: Kit = { ...base, talismans: base.talismans.filter(id => !Object.values(FORMS).includes(id as never)) };
  if (v.form) kit.talismans.push(v.form);
  shadow.kit = kit;
  return shadow;
}

/** The longest chain (enemy links) from the hero now, the moment's budget shared by the first links, nearest first. */
function bestChain(w: World): { length: number; cut: boolean } {
  let left = BUDGET, best = 0, cut = false;
  const first = w.enemies.filter(e => canLink(w, e)).sort((a, b) => dist(a, w.hero) - dist(b, w.hero));
  for (const e of first) {
    if (left <= 0) { cut = true; break; }
    const d = linkDepth(w, e, { max: MAX, budget: left });
    left -= d.expanded;
    if (d.cut) cut = true;
    best = Math.max(best, d.depth);
    if (best >= MAX) break;
  }
  return { length: best, cut };
}

interface Tally { lengths: number[]; shares: number[]; cut: number }
const tallies = new Map<string, Tally>();
const tallyOf = (key: string): Tally => { let t = tallies.get(key); if (!t) tallies.set(key, t = { lengths: [], shares: [], cut: 0 }); return t; };
const keyOf = (v: Variant, shift: number): string => `${v.key}/${shift}`;

const started = Date.now();
let fights = 0, moments = 0;
for (const arenaId of RUN_ARENAS) {
  for (let k = 1; k <= SEEDS; k++) {
    fights++;
    const sim = new Simulation({ arena: endless(arenaTemplate(arenaId)), params: harmlessRunParams(), seed: seedOf(k) }), w = sim.world;
    let turns = 0;
    for (let t = 0; t < SECS * 60 && w.status === 'playing'; t++) {
      if (t === GOALS_S * 60) sim.command({ t: 'goals' });
      if (t % EVERY === 15) {
        if (turns % SAMPLE_TURNS === 0 && !w.move && !w.chain.length && w.enemies.length) {
          const hash = hashWorld(w);
          for (const v of VARIANTS) for (const shift of SHIFTS) {
            const r = bestChain(shadowOf(w, v, shift)), tally = tallyOf(keyOf(v, shift));
            tally.lengths.push(r.length);
            tally.shares.push(r.length / w.enemies.length);
            if (r.cut) tally.cut++;
          }
          moments++;
          // The measure only reads: the fight goes on as it would without it.
          if (hashWorld(w) !== hash) throw new Error(`the moment changed the world (${arenaId}, seed ${k}, tick ${t})`);
        }
        turns++;
        playChain(sim);
      }
      sim.tick();
      w.events.length = 0;
    }
  }
  process.stderr.write(`${arenaTitle(arenaId)}: ${((Date.now() - started) / 1000).toFixed(0)} с\n`);
}

// ---- Report ----

const quantile = (xs: readonly number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};
const num = (x: number, digits = 1): string => x.toFixed(digits).replace('.', ',');
const pct = (x: number): string => `${Math.round(100 * x)} %`;
const head = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
console.log(`Цена форм цепи (задача 33), ${new Date().toISOString().slice(0, 10)}, HEAD ${head}. Бои: ${fights} (${RUN_ARENAS.length} арен похода × ${SEEDS} seed, ${SECS} с), моментов: ${moments} (каждые ${SAMPLE} с), бюджет поиска ${BUDGET} состояний, предел длины ${MAX}. Эвристика.`);
console.log('');
for (const shift of SHIFTS) {
  console.log(`### «Смена цвета» ${shift === 0 ? 'выкл. (0)' : `${shift}`}`);
  console.log('');
  console.log('| Вариант | p50 длины | p90 длины | p90 / без формы | p90 доли поля | Поиск обрезан |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const none = quantile(tallyOf(keyOf(VARIANTS[0], shift)).lengths, 0.9);
  for (const v of VARIANTS) {
    const t = tallyOf(keyOf(v, shift)), p90 = quantile(t.lengths, 0.9);
    console.log(`| ${v.title} | ${quantile(t.lengths, 0.5)} | ${p90} | ${none ? num(p90 / none, 2) : '—'} | ${pct(quantile(t.shares, 0.9))} | ${pct(t.cut / Math.max(1, t.lengths.length))} |`);
  }
  console.log('');
}
