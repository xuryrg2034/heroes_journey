/**
 * Task 26 (11) «Расписание леса» (design 15.10.2026): the complexity count of the forest, read only — a heuristic for the design,
 * not a test: `npm run realtime:complexity` (`--viewers N`, default 300; `--runs R`, default 3; `--policy random|fights`).
 * Moved from the design helper's `compare.mts` (scratchpad, 15.10.2026), the proposal's copies replaced by the run's own code.
 *
 * Each viewer plays R runs on the run's own functions WITHOUT fights (every fight is won at once, its enemies reported as the
 * arena brings them); its living elements (ЖЭ, docs/design-notes/research_notes/Комплексити как ручка баланса) carry over:
 * - «сейчас» — a new run as the game makes it without the schedule (`createRtRun(seed)`: the gentle entry, its pools);
 * - «расписание» — a new run with the viewer's history (`createRtRun(seed, { schedule })`, run/schedule.ts), the history after a
 *   run being what the profile keeps (`rtScheduleMet`).
 * The map policy: `random` — uniform among the available nodes (as the bot), `fights` — an arena node when there is one.
 *
 * Per fight: the special kinds, the ЖЭ of the fight (`fightAtoms`, as the proposal's `atomsOf`), the new ones (the bag left out —
 * outside the budget, variant E; a line with it too), the field flags (shaman × the weak, «Хамелеон» × the chain, shield-bearer ×
 * braziers). The rules (heuristics of 15.10.2026, report «Комплексити как ручка баланса»): В-1 special kinds ≤ 2 on rows 1–5,
 * ≤ 3 on 6–9, ≤ 4 in the final; В-2 new ЖЭ ≤ 1 and no random elite in a fight with a new one; Б-3 flags 0 on rows 1–3, ≤ 1 on 4–6,
 * ≤ 2 later, a new flag not in a fight with a new ЖЭ; П-1 the first 3 fights of a run without an elite and with ≤ 2 kinds.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. It prints the date and HEAD.
 */
import { execSync } from 'node:child_process';
import {
  createRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtCasinoLeave, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick,
  rtChooseHammer, rtChooseTalisman, rtEnterNode, rtEventView, rtGiftView, rtNode, rtRestHeal, rtScheduleMet, rtShopLeave, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';
import { runRow } from '../src/realtime/run/arenaPools';
import { arenaKinds } from '../src/realtime/run/arenaKinds';
import { arenaElements, SCHEDULE_ELEMENTS, SCHEDULE_KINDS } from '../src/realtime/run/schedule';
import { arenaTemplate, markedGoalArena } from '../src/realtime/sim/arenas';
import type { Loadout } from '../src/realtime/sim/kit';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const VIEWERS = Number(option('--viewers', '300')), RUNS = Number(option('--runs', '3')), POLICY = option('--policy', 'random');
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const hash = (a: number, b: number): number => { let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); x ^= x >>> 15; x = Math.imul(x, 0x27d4eb2f); return (x ^ (x >>> 13)) >>> 0; };
/** The living elements of the schedule (proposal: 20; task 28 adds `part`, the Jailer's weight); the affix types are not counted apart. */
const ALL = [...SCHEDULE_ELEMENTS];

interface Fight { run: number; row: number; fight: number; arena: string; roster?: string; atoms: string[]; fresh: string[]; kinds: number; flags: string[]; newFlags: string[]; randomElite: boolean; final: boolean }

/** The ЖЭ of a fight as the player meets them (the proposal's `atomsOf`): the arena's, its kinds, the elite and affix, the goblin, the bag. */
function fightAtoms(arena: string, roster: string | undefined, kit: Loadout, markedGoals: boolean): string[] {
  const t = markedGoalArena(arenaTemplate(arena), markedGoals), gone = new Set(kit.withoutKinds ?? []);
  const out = new Set<string>([...arenaElements(arena, markedGoals), ...[...arenaKinds(arena, roster)].filter(k => SCHEDULE_KINDS.includes(k) && !gone.has(k))]);
  const elite = t.enemies.some(e => e.elite) || !!kit.guaranteedElite || !!kit.randomElites;
  if (elite) out.add('elite');
  if (elite && (kit.eliteAffixes ?? 0) > 0) out.add('affix');
  if (kit.slot) out.add('bust');
  if (!kit.noBag) out.add('bag');
  return ALL.filter(id => out.has(id));
}
/** The field flags of a fight: a shaman (× the weak), «Хамелеон» possible (× the chain), a shield-bearer with braziers. */
function fightFlags(atoms: readonly string[], kit: Loadout): string[] {
  const flags: string[] = [];
  if (atoms.includes('shaman')) flags.push('shaman');
  if (atoms.includes('affix') && (!kit.affixKinds || kit.affixKinds.includes('chameleon'))) flags.push('chameleon');
  if (atoms.includes('shield') && atoms.includes('brazier')) flags.push('shield-brazier');
  return flags;
}

const ok = (step: RtRunStep): RtRunState => { if (!step.ok) throw new Error(step.reason); return step.run; };

/** One run of a viewer (`met` — the viewer's elements, changed; `flagsMet` — the flags met); returns its fights. */
function walk(mode: 'now' | 'schedule', seed: number, runNo: number, met: Set<string>, flagsMet: Set<string>, history: string[]): { fights: Fight[]; history: string[] } {
  let run = createRtRun(seed, mode === 'schedule' ? { schedule: history } : {});
  const fights: Fight[] = [];
  for (let step = 0; step < 400 && !run.result; step++) {
    const pending = run.pending;
    if (!pending) {
      const nodes = rtAvailableNodes(run), arenaNodes = nodes.filter(n => ['battle', 'hard', 'checkpoint', 'breakthrough', 'boss'].includes(n.type));
      const pool = POLICY === 'fights' && arenaNodes.length ? arenaNodes : nodes;
      run = ok(rtEnterNode(run, pool[hash(seed, step) % pool.length].id, null, { goblinCircle: true }));
      continue;
    }
    switch (pending.kind) {
      case 'gift': { const view = rtGiftView(run)!; run = ok(view.chosen !== null ? rtChooseGiftPick(run, view.picks[0]) : rtChooseGift(run, null)); break; }
      case 'battle': {
        const node = rtNode(run, pending.nodeId)!, kit = rtArenaLoadout(run);
        const atoms = fightAtoms(pending.arena, pending.roster, kit, !!run.markedGoals), fresh = atoms.filter(a => !met.has(a));
        const flags = fightFlags(atoms, kit), newFlags = flags.filter(f => !flagsMet.has(f));
        fights.push({ run: runNo, row: runRow(node.row), fight: fights.length + 1, arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, atoms, fresh,
          kinds: atoms.filter(a => SCHEDULE_KINDS.includes(a)).length, flags, newFlags, randomElite: !!kit.randomElites, final: pending.battle === 'final' });
        for (const a of atoms) met.add(a);
        for (const f of flags) flagsMet.add(f);
        // The fight is won at once; it reports the kinds the arena brings, an elite when one stands, one affix of the allowed ones.
        const kinds = [...arenaKinds(pending.arena, pending.roster)].filter(k => !(kit.withoutKinds ?? []).includes(k));
        const affixes = atoms.includes('affix') ? [kit.affixKinds?.[0] ?? 'fiery'] : [];
        run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.maxHp, kills: 30, damage: 0, time: 60, kinds, elite: atoms.includes('elite'), affixes }));
        break;
      }
      case 'talisman': run = ok(rtChooseTalisman(run, pending.options[0] ?? null)); break;
      case 'hammer': run = ok(rtChooseHammer(run, pending.options[0])); break;
      case 'find': run = ok(rtChooseFind(run, pending.options[0])); break;
      case 'rest': run = ok(rtRestHeal(run)); break;
      case 'shop': run = ok(rtShopLeave(run)); break;
      case 'casino': run = ok(rtCasinoLeave(run)); break;
      case 'event': { const view = rtEventView(run)!, open = view.options.filter(o => o.available && !o.off); run = ok(rtChooseEventOption(run, open[hash(seed, step) % open.length].id)); break; }
      default: throw new Error(`pending ${pending.kind}`);
    }
  }
  return { fights, history: mode === 'schedule' ? [...rtScheduleMet(run)].sort() : history };
}

const n2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') : '—');
const pc = (a: number, b: number): string => (b ? `${Math.round(100 * a / b)} %` : '—');
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const noBag = (f: Fight): string[] => f.fresh.filter(a => a !== 'bag');
const kindCap = (f: Fight): number => (f.final ? 4 : f.row <= 5 ? 2 : 3);
const flagCap = (row: number): number => (row <= 3 ? 0 : row <= 6 ? 1 : 2);

const head = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
console.log(`# realtime-complexity ${new Date().toISOString().slice(0, 10)}, HEAD ${head}: viewers ${VIEWERS} × runs ${RUNS}, policy ${POLICY} (heuristic: no fights, every fight won)`);
for (const mode of ['now', 'schedule'] as const) {
  const viewers: Fight[][] = [];
  for (let v = 1; v <= VIEWERS; v++) {
    const met = new Set<string>(), flags = new Set<string>(), all: Fight[] = [];
    let history: string[] = [];
    for (let r = 0; r < RUNS; r++) { const out = walk(mode, seedOf(v + r * VIEWERS), r + 1, met, flags, history); all.push(...out.fights); history = out.history; }
    viewers.push(all);
  }
  console.log(`\n## ${mode === 'now' ? 'СЕЙЧАС (без расписания)' : 'РАСПИСАНИЕ'}`);
  for (let r = 1; r <= RUNS; r++) {
    const fights = viewers.flatMap(v => v.filter(f => f.run === r)), peaks = viewers.map(v => Math.max(0, ...v.filter(f => f.run === r).map(f => noBag(f).length)));
    const peaksBag = viewers.map(v => Math.max(0, ...v.filter(f => f.run === r).map(f => f.fresh.length)));
    const metEnd = viewers.map(v => new Set(v.filter(f => f.run <= r).flatMap(f => f.atoms)).size);
    console.log(`\n### Поход ${r}: боёв ${fights.length}`);
    console.log(`новых ЖЭ на бой ${n2(mean(fights.map(f => noBag(f).length)))} (с котомкой ${n2(mean(fights.map(f => f.fresh.length)))}); пик за поход, среднее ${n2(mean(peaks))} (с котомкой ${n2(mean(peaksBag))}); походов с пиком ≥ 3 — ${pc(peaks.filter(p => p >= 3).length, peaks.length)}`);
    console.log(`боёв с ≥ 2 новыми ${pc(fights.filter(f => noBag(f).length >= 2).length, fights.length)} (с котомкой ${pc(fights.filter(f => f.fresh.length >= 2).length, fights.length)}); ЖЭ в бою ${n2(mean(fights.map(f => f.atoms.length)))}; особых видов в бою ${n2(mean(fights.map(f => f.kinds)))}; флагов поля в бою ${n2(mean(fights.map(f => f.flags.length)))}`);
    console.log(`встречено к концу похода ${n2(mean(metEnd))} из ${ALL.length}`);
    const v1 = fights.filter(f => f.kinds > kindCap(f)).length, v2 = fights.filter(f => noBag(f).length > 1 || (noBag(f).length > 0 && f.randomElite)).length;
    const b3 = fights.filter(f => f.flags.length > flagCap(f.row) || (f.newFlags.length > 0 && noBag(f).length > 0)).length;
    const p1 = viewers.filter(v => v.filter(f => f.run === r && f.fight <= 3).every(f => !f.atoms.includes('elite') && f.kinds <= 2)).length;
    console.log(`нарушения: В-1 ${pc(v1, fights.length)}; В-2 ${pc(v2, fights.length)}; Б-3 ${pc(b3, fights.length)}; П-1 выполнено в ${pc(p1, viewers.length)} походов`);
    console.log('новых ЖЭ по номеру боя: ' + Array.from({ length: 10 }, (_, i) => i + 1).map(n => { const fs = fights.filter(f => f.fight === n); return fs.length ? `#${n} ${n2(mean(fs.map(f => noBag(f).length)))}` : ''; }).filter(Boolean).join('; '));
    console.log('особых видов по номеру боя: ' + Array.from({ length: 10 }, (_, i) => i + 1).map(n => { const fs = fights.filter(f => f.fight === n); return fs.length ? `#${n} ${n2(mean(fs.map(f => f.kinds)))}` : ''; }).filter(Boolean).join('; '));
  }
  const first = viewers.flatMap(v => v.filter(f => f.run === 1)), arenas: Record<string, number> = {};
  for (const f of first) { const key = f.arena + (f.roster ? `[${f.roster}]` : ''); arenas[key] = (arenas[key] ?? 0) + 1; }
  console.log('\nарены первого похода: ' + Object.entries(arenas).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => `${k} ${pc(n, first.length)}`).join(', '));
  const pairs: Record<string, number> = {};
  for (const f of first) if (noBag(f).length >= 2) { const key = `ряд ${f.row} ${f.arena}: ${noBag(f).join('+')}`; pairs[key] = (pairs[key] ?? 0) + 1; }
  if (Object.keys(pairs).length) console.log('бои первого похода с ≥ 2 новыми: ' + Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} (${n})`).join('; '));
}
