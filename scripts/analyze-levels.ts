/**
 * Level analyzer CLI. Usage (see docs/level-metrics.md):
 *   npm run analyze:levels                                    # every battle of the node registry (= --nodes)
 *   npm run analyze:levels -- --node chief-breakfast --depth 4  # one registry battle or map node, as in a run
 *   npm run analyze:levels -- --node wolf-ford --row 5          # a registry battle on another map row
 *   npm run analyze:levels -- --node den-nest --energy 5         # entered with energy carried from earlier nodes
 *   npm run analyze:levels -- --nodes --elite-move-every 2    # compare elite movement periods (0 — no movement)
 *   npm run analyze:levels -- --nodes --talismans all          # the run's talismans (default: none — the worst case)
 *   npm run analyze:levels -- --node troll-lair --ladder 4      # on a step of «Ступени клятвы» (default 0)
 *   npm run analyze:levels -- --json my-level.json --seeds 5 --out report.json
 * Levels are analyzed in parallel child processes; every level uses its own engines.
 */
import { fork } from 'node:child_process';
import { isTalismanId, TALISMANS, type TalismanId } from '../src/game/talismans';
import { availableParallelism } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLevel, DEFAULT_ANALYSIS_OPTIONS, type AgentSummary, type AnalysisOptions, type LevelAnalysis, type LevelSource } from '../src/game/levelAnalysis';
import { allNodeBattleTargets, nodeAnalysisTargets } from '../src/game/run/nodeAnalysis';
import { ELITE_MOVE_EVERY, setEliteMoveEvery } from '../src/game/elite';
import { LADDER_MAX } from '../src/game/ladder';
import { battlePoolEntry } from '../src/game/run/battlePools';
import { forestNode } from '../src/game/run/forestMap';

/** The game's elite movement period, kept to restore it between tasks. */
const ELITE_MOVE_EVERY_DEFAULT = ELITE_MOVE_EVERY;

/** `eliteMoveEvery`: elite movement period for this analysis (elite.ts; 0 — no movement); the game uses ELITE_MOVE_EVERY. */
interface Task { source: LevelSource; options: Partial<AnalysisOptions>; eliteMoveEvery?: number }
interface Done { index: number; result?: LevelAnalysis; error?: string; ms: number }

const HELP = `analyze-levels [options]
  (no level given)   every battle of the node registry, as --nodes
  --json FILE        editor JSON level (repeatable)
  --node ID          forest-map node battle (repeatable): a registry battle id or a map node id.
                     Started as in a run: 5 HP, 0 energy (see --energy), no items, tools guaranteed on entering the node
  --nodes            every battle of the node registry (src/game/run/battles/*.ts)
  --row R            map row for registry battles not bound to a node (tools and palette of that row); default: first row of the pool band
  --energy E         node battles: entry energy instead of 0 (the run carries energy between nodes)
  --elite-move-every N  elites move every N turns (0 — not at all); the game's value is ELITE_MOVE_EVERY in elite.ts
  --talismans LIST   node battles: the run holds these talismans (comma-separated ids of talismans.ts, or all; the Ash
                     ward whole); default none — battles are judged with empty hands (docs/talismans.md, section 6)
  --ladder N         node battles: the run's step of «Ступени клятвы» 0–${LADDER_MAX} (src/game/ladder.ts; default 0 — no
                     changes). The battle side of the step applies: random elites, hard-battle elites (a hard battle is
                     a hard node or a hard pool battle), bosses, reinforcements, chests; not the run side (map, start HP,
                     rest, merchant) and not greed (it depends on the run's stock)
  --seeds K          refill seeds per level (default ${DEFAULT_ANALYSIS_OPTIONS.seeds})
  --depth D          search horizon in turns (default ${DEFAULT_ANALYSIS_OPTIONS.depth})
  --beam B           children per internal node (default ${DEFAULT_ANALYSIS_OPTIONS.beam})
  --budget N         action-list expansions per search (default ${DEFAULT_ANALYSIS_OPTIONS.nodeBudget})
  --runs N           random-agent runs per seed (default ${DEFAULT_ANALYSIS_OPTIONS.agentRuns})
  --turn-limit T     agent turn limit (default ${DEFAULT_ANALYSIS_OPTIONS.agentTurnLimit})
  --resamples K      honest planner: resampled refills per candidate, 0 disables (default ${DEFAULT_ANALYSIS_OPTIONS.plannerResamples})
  --candidates M     honest planner: first actions compared after screening all on one refill (default ${DEFAULT_ANALYSIS_OPTIONS.plannerCandidates})
  --fragile          recolor every starting enemy and report cells with |dP(greedy)| > 0.2 (slow)
  --no-search | --no-restricted | --no-agents
  --workers W        parallel processes (default: CPU count - 1)
  --out FILE         write the full JSON report`;

function parse(argv: string[]) {
  const tasks: LevelSource[] = [], options: Partial<AnalysisOptions> = {};
  let out: string | undefined, workers = Math.max(1, availableParallelism() - 1), allNodes = false, row: number | undefined, energy: number | undefined, eliteMoveEvery: number | undefined, talismans: TalismanId[] | undefined, ladder = 0;
  const nodeIds: string[] = [];
  const number = (flag: string, value: string | undefined, min: number) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min) throw new Error(`${flag}: expected an integer >= ${min}`);
    return parsed;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = argv[i + 1];
    switch (flag) {
      case '--json': if (!value) throw new Error('--json: file required');
        tasks.push({ kind: 'custom', definition: JSON.parse(readFileSync(value, 'utf8')), id: basename(value) }); i++; break;
      case '--node': if (!value) throw new Error('--node: id required'); nodeIds.push(value); i++; break;
      case '--nodes': allNodes = true; break;
      case '--row': row = number(flag, value, 1); i++; break;
      case '--energy': energy = number(flag, value, 0); i++; break;
      case '--elite-move-every': eliteMoveEvery = number(flag, value, 0); i++; break;
      case '--talismans': {
        const ids = value === 'all' ? TALISMANS.map(entry => entry.id) : (value ?? '').split(',').filter(Boolean);
        const unknown = ids.filter(id => !isTalismanId(id));
        if (!ids.length || unknown.length) throw new Error(`--talismans: unknown ${unknown.join(', ') || 'list'} (ids of src/game/talismans.ts or all)`);
        talismans = ids as TalismanId[]; i++; break;
      }
      case '--ladder': ladder = number(flag, value, 0); if (ladder > LADDER_MAX) throw new Error(`--ladder: expected 0–${LADDER_MAX}`); i++; break;
      case '--seeds': options.seeds = number(flag, value, 1); i++; break;
      case '--depth': options.depth = number(flag, value, 1); i++; break;
      case '--beam': options.beam = number(flag, value, 1); i++; break;
      case '--budget': options.nodeBudget = number(flag, value, 1); i++; break;
      case '--runs': options.agentRuns = number(flag, value, 0); i++; break;
      case '--turn-limit': options.agentTurnLimit = number(flag, value, 1); i++; break;
      case '--resamples': options.plannerResamples = number(flag, value, 0); i++; break;
      case '--candidates': options.plannerCandidates = number(flag, value, 1); i++; break;
      case '--fragile': options.fragile = true; break;
      case '--no-search': options.search = false; break;
      case '--no-restricted': options.restricted = false; break;
      case '--no-agents': options.agents = false; break;
      case '--workers': workers = number(flag, value, 1); i++; break;
      case '--out': if (!value) throw new Error('--out: file required'); out = value; i++; break;
      case '--help': case '-h': console.log(HELP); process.exit(0);
      default: throw new Error(`Unknown argument ${flag}\n${HELP}`);
    }
  }
  const skipped: string[] = [];
  // Without any level the whole node registry is analyzed.
  if (!tasks.length && !nodeIds.length) allNodes = true;
  if (allNodes) { const all = allNodeBattleTargets(row); skipped.push(...all.skipped); tasks.push(...all.targets.map(target => ({ kind: 'run-node' as const, target }))); }
  for (const id of nodeIds) tasks.push(...nodeAnalysisTargets(id, row).map(target => ({ kind: 'run-node' as const, target })));
  if (row !== undefined && !allNodes && !nodeIds.length) throw new Error('--row: use with --node or --nodes');
  if (energy !== undefined) {
    if (!tasks.some(task => task.kind === 'run-node')) throw new Error('--energy: use with --node or --nodes');
    for (const task of tasks) if (task.kind === 'run-node') task.target.setup.player.energy = energy;
  }
  if (talismans) {
    if (!tasks.some(task => task.kind === 'run-node')) throw new Error('--talismans: use with --node or --nodes');
    for (const task of tasks) if (task.kind === 'run-node') { task.target.setup.talismans = [...talismans]; task.target.setup.wardReady = talismans.includes('ash-ward'); }
  }
  if (ladder) {
    if (!tasks.some(task => task.kind === 'run-node')) throw new Error('--ladder: use with --node or --nodes');
    for (const task of tasks) if (task.kind === 'run-node') {
      const { setup } = task.target, hard = forestNode(setup.nodeId)?.type === 'hard' || battlePoolEntry(setup.template.id)?.type === 'hard';
      setup.ladder = ladder; if (hard) setup.hard = true;
    }
  }
  for (const id of skipped) console.log(`skip ${id}: not bound to a map node and not in the pools (battlePools.ts), pass --row R`);
  if (!tasks.length) throw new Error('No level to analyze.');
  return { tasks: tasks.map(source => ({ source, options, ...(eliteMoveEvery === undefined ? {} : { eliteMoveEvery }) })), out, workers };
}

async function runTask(task: Task, index: number): Promise<Done> {
  const started = performance.now();
  try {
    setEliteMoveEvery(task.eliteMoveEvery ?? ELITE_MOVE_EVERY_DEFAULT);
    return { index, result: await analyzeLevel(task.source, task.options), ms: Math.round(performance.now() - started) };
  }
  catch (error) { return { index, error: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) }; }
}

/** Child process: analyze tasks sent by the parent until disconnected. */
function worker() {
  process.on('message', async (message: { task: Task; index: number }) => { process.send!(await runTask(message.task, message.index)); });
  process.on('disconnect', () => process.exit(0));
}

async function runAll(tasks: Task[], workers: number, onDone: (done: Done) => void): Promise<Done[]> {
  const results: Done[] = [];
  if (workers <= 1 || tasks.length <= 1) {
    for (let i = 0; i < tasks.length; i++) { const done = await runTask(tasks[i], i); results[i] = done; onDone(done); }
    return results;
  }
  // Heaviest first: battles deeper on the map dominate the wall time.
  const queue = tasks.map((_, i) => i).sort((a, b) => weight(tasks[b]) - weight(tasks[a]));
  const script = fileURLToPath(import.meta.url);
  // Every worker promise settles: a crashed worker reports its in-flight task as an error and
  // stops taking work; tasks nobody could run are reported after all workers are gone.
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, () => new Promise<void>(resolve => {
    const child = fork(script, ['--worker'], { execArgv: process.execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let current: { index: number; started: number } | undefined, settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const fail = (reason: string) => {
      if (current && !results[current.index]) { const done = { index: current.index, error: reason, ms: Math.round(performance.now() - current.started) }; results[current.index] = done; onDone(done); }
      current = undefined; finish();
    };
    const next = () => {
      const index = queue.shift();
      if (index === undefined) { current = undefined; if (child.connected) child.disconnect(); finish(); return; }
      current = { index, started: performance.now() };
      child.send({ task: tasks[index], index });
    };
    child.on('message', (done: Done) => { results[done.index] = done; onDone(done); current = undefined; next(); });
    child.on('error', error => fail(`worker error: ${error.message}`));
    child.on('exit', (code, signal) => fail(`worker exited (${signal ?? code})`));
    next();
  })));
  tasks.forEach((_, index) => { if (!results[index]) { results[index] = { index, error: 'not run: all workers exited', ms: 0 }; onDone(results[index]); } });
  return results;
}
function weight(task: Task) {
  if (task.source.kind === 'run-node') return task.source.target.row + 40;
  return 50;
}

const pct = (value: number | null | undefined) => value === null || value === undefined ? '-' : `${Math.round(value * 100)}`;
const val = (value: number | null | undefined) => value === null || value === undefined ? '-' : String(value);
const bits = (info: { bits: number | null; atLeast: number } | undefined) => !info ? '-' : info.bits !== null ? info.bits.toFixed(1) : `>=${info.atLeast.toFixed(1)}`;
const delta = (need: { bits: number | null; atLeast: number | null } | undefined) => !need ? '' : need.bits !== null ? need.bits.toFixed(1) : need.atLeast !== null ? `>=${need.atLeast.toFixed(1)}` : 'n/a';
function render(header: string[], rows: string[][]) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(row => (row[i] ?? '').length)));
  const line = (row: string[]) => row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join(' ');
  return [line(header), line(widths.map(width => '-'.repeat(width))), ...rows.map(line)].join('\n');
}
function tables(results: Done[]) {
  const ok = results.filter(done => done.result);
  const structure = render(['level', 'size', 'enem', 'col', 'lcs%', 'intl%', 'acts', 'safe%', 'win', 'goalT', 'minT', 'hp', 'sol', 'fwin%', 'trap%', 'crit', 'KM', 'exh', 'requires', 'benefit', 'spread', 'sec'],
    ok.map(done => {
      const r = done.result!, s = r.search?.[0], st = r.static;
      const restricted = r.restricted ? Object.entries(r.restricted) : [];
      const requires = restricted.filter(([, x]) => x.requires).map(([tool]) => tool).join('+') || (r.search ? 'none' : '-');
      const benefit = restricted.filter(([, x]) => x.applicable && x.benefitTurns).map(([tool, x]) => `${tool[0]}:${x.benefitTurns}t`).join(' ') || '-';
      const spread = r.seedSensitivity ? `${val(r.seedSensitivity.minTurnsSpread)}/${val(r.seedSensitivity.bestHpSpread)}` : '-';
      return [r.level.id, `${st.cols}x${st.rows}`, String(st.enemies), String(st.colors), pct(st.largestComponentShare), pct(st.colorInterleave), String(st.firstActions.total), pct(st.safeFirstChainShare),
        s ? (s.winnable ? 'yes' : 'no') : '-', val(s?.minGoalTurns), val(s?.minTurns), val(s?.bestHpAtMin), val(s?.solutionsAtMin), pct(s?.firstMoveWinShare), pct(s?.trapShare), s?.criticality?.toFixed(2) ?? '-', val(s?.keyMoves),
        s ? (s.exhaustive ? 'yes' : 'no') : '-', requires, benefit, spread, (done.ms / 1000).toFixed(0)];
    }));
  const agents = render(['level', 'P(O)', 'P(S)', 'FG', 'robust', 'P(R)', 'P(R) 95%', 'I(R)', 'P(G1)', 'I(G1)', 'Dec', 'gTrap', 'hpMed', 'hpP10', 'N_X bits (R/G1)'],
    ok.map(done => {
      const r = done.result!, a = r.agents, p = r.planner, d = r.deception;
      const need = r.restricted ? Object.entries(r.restricted).filter(([, x]) => x.agents).map(([tool, x]) => `${tool[0]}:${delta(x.agents!.needRandom)}/${delta(x.agents!.needGreedy)}`).join(' ') : '';
      return [r.level.id, pct(p ? p.pOracle : r.seedSensitivity?.winnableShare), pct(p?.pHonest), pct(p?.fortuneGap), p ? `${p.robustFirstMoves}/${p.candidates.length}` : '-',
        pct(a?.random.winRate), a ? `${pct(a.random.winRateCi95[0])}-${pct(a.random.winRateCi95[1])}` : '-', bits(a?.random.info), pct(a?.greedy.winRate), bits(a?.greedy.info),
        d?.deception?.toFixed(2) ?? '-', d?.greedyTrap === null || d?.greedyTrap === undefined ? '-' : d.greedyTrap ? 'yes' : 'no', val(a?.random.winHpMedian), val(a?.random.winHpP10), need || '-'];
    }));
  // Goals and exit: in a battle with an authored exit the win is entering the open door, so the turns to the goals
  // and to the exit are reported apart (median over the agent's runs that got there).
  const exit = render(['level', 'goalT', 'exitT', 'hpExit', 'R goal%', 'R win%', 'R goalT', 'R exitT', 'R delay', 'R hp', 'G1 goal%', 'G1 win%', 'G1 goalT', 'G1 exitT', 'G1 delay', 'G1 hp', 'G1 stuck'],
    ok.map(done => {
      const r = done.result!, s = r.search?.[0], a = r.agents;
      const agent = (x: AgentSummary | undefined) => !x ? ['-', '-', '-', '-', '-', '-'] : [pct(x.goalRate), pct(x.winRate), val(x.goalTurnsMedian), val(x.winTurnsMedian), val(x.exitDelayMedian), val(x.winHpMedian)];
      return [r.level.id, val(s?.minGoalTurns), val(s?.minTurns), val(s?.bestHpAtMin), ...agent(a?.random), ...agent(a?.greedy), a ? `${a.greedy.goalsNoExit}/${a.greedy.runs}` : '-'];
    }));
  const errors = results.filter(done => done.error).map(done => `#${done.index} ERROR ${done.error}`);
  return [structure, '', agents, '', exit, ...errors].join('\n');
}

async function main() {
  if (process.argv.includes('--worker')) { worker(); return; }
  let parsed: ReturnType<typeof parse>;
  try { parsed = parse(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(2); }
  const { tasks, out, workers } = parsed;
  const options = { ...DEFAULT_ANALYSIS_OPTIONS, ...tasks[0].options };
  console.log(`Analyzing ${tasks.length} level(s): depth ${options.depth}, beam ${options.beam}, budget ${options.nodeBudget}, seeds ${options.seeds}, agents ${options.agentRuns}x${options.seeds} (+greedy), workers ${Math.min(workers, tasks.length)}`);
  const started = performance.now();
  const results = await runAll(tasks, workers, done => console.log(`  done ${done.result?.level.id ?? `#${done.index}`} in ${(done.ms / 1000).toFixed(1)}s${done.error ? ` ERROR ${done.error}` : ''}`));
  const totalMs = Math.round(performance.now() - started);
  console.log(`\n${tables(results)}\n`);
  console.log('Percent columns are x100. Definitions: docs/level-metrics.md. Table 1 (oracle search O, seed 0): lcs largest same-color component share, intl color interleave,');
  console.log('acts distinct first actions, safe first chains with 0 forecast damage, goalT min turns to the goals, minT/hp/sol min turns to the win (exit battles: entering the door) / best HP at min / winning first actions, fwin/trap first actions');
  console.log('that can / cannot win within depth, crit mean w_t, KM steps with w_t<=0.1, exh exhaustive, requires/benefit restricted search (a/i/d/p), spread minT/HP over seeds.');
  console.log('Table 2: P(O) oracle, P(S) honest planner, FG = P(O)-P(S), robust = candidates winning under >=80% resampled refills, R random / G1 greedy agent,');
  console.log('I = -log2 P bits (>= when no win), Dec = 1-P(G1)/P(S), gTrap = greedy first move cannot win, hp = random-agent HP at win, N_X = I(without X)-I(with X).');
  console.log('Table 3 (exit battles: the win is entering the open door): goalT/exitT/hpExit oracle turns to the goals / to the exit / HP at the exit (seed 0, within depth);');
  console.log('per agent: goal% runs meeting the goals, win% runs leaving through the door, medians of goalT, exitT, delay = exitT - goalT and hp at the exit;');
  console.log('G1 stuck = greedy runs that met the goals but did not leave (died or hit the turn limit).');
  for (const done of results) for (const note of done.result?.notes ?? []) console.log(`note ${done.result!.level.id}: ${note}`);
  console.log(`Total wall time ${(totalMs / 1000).toFixed(1)}s`);
  if (out) {
    const report = { meta: { generatedAt: new Date().toISOString(), options, workers: Math.min(workers, tasks.length), totalMs, timingMs: Object.fromEntries(results.map(done => [done.result?.level.id ?? `#${done.index}`, done.ms])) },
      levels: results.map(done => done.result ?? { error: done.error }) };
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report written to ${out}`);
  }
  if (results.some(done => done.error)) process.exitCode = 1;
}
main();
