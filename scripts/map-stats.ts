/**
 * Statistics of the generated forest map over many seeds (docs/roguelike-runs.md, section 3; docs/biomes/forest-map.md,
 * «Генерация карты»). Read-only: it builds runs through the run API and prints tables, nothing is saved.
 *   npm run analyze:map                 # 1000 spread seeds
 *   npm run analyze:map -- --seeds 5000
 * Battles are resolved as won with the entry resources (no engine): the numbers are about the map and the pools,
 * never about how a battle is played.
 */
import { battlePoolEntry } from '../src/game/run/battlePools';
import type { ForestMapNode, ForestNodeType } from '../src/game/run/forestMap';
import { availableNodes, chooseEventOption, chooseFindItem, chooseTalisman, createForestRun, enterNode, eventView, forestRunView, resolveBattle, restHeal, runNode, type ForestRunState } from '../src/game/run/forestRun';

const argSeeds = process.argv.indexOf('--seeds');
const COUNT = argSeeds > 0 ? Number(process.argv[argSeeds + 1]) : 1000;
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const SEEDS = Array.from({ length: COUNT }, (_, k) => spread(k + 1));
const TYPES: ForestNodeType[] = ['battle', 'hard', 'rest', 'find', 'event'];
const FREE_ROWS = [6, 7, 8, 10, 11, 12];
const SECTIONS = { 'тропы, ряды 6–8': [6, 7, 8], 'ветки, ряды 10–12': [10, 11, 12], 'все свободные': FREE_ROWS } as const;
type Section = keyof typeof SECTIONS;
const median = (list: number[]) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : 0; };
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const isBattle = (node: ForestMapNode) => !['rest', 'find', 'event'].includes(node.type);

const byRow = new Map<number, Record<string, number>>();
const nodeCounts: number[] = [], starts: number[] = [], routesToBoss: number[] = [], routesPerBoss: number[] = [];
const shares = Object.fromEntries(Object.keys(SECTIONS).map(section => [section, Object.fromEntries(TYPES.map(type => [type, [] as number[]]))])) as Record<Section, Record<string, number[]>>;
const battlesWithTrunk: number[] = [], eventsPerRoute: number[] = [];
const freeTotal = Object.fromEntries(Object.keys(SECTIONS).map(section => [section, 0])) as Record<Section, number>;
const freeByType = Object.fromEntries(Object.keys(SECTIONS).map(section => [section, Object.fromEntries(TYPES.map(type => [type, 0]))])) as Record<Section, Record<string, number>>;

for (const seed of SEEDS) {
  const run = createForestRun(seed, { map: 'generated', skipTrunk: true });
  const nodes = forestRunView(run).nodes.map(entry => entry.node).filter(node => node.lane !== 'trunk');
  const byId = new Map(nodes.map(node => [node.id, node]));
  nodeCounts.push(nodes.length);
  const first = availableNodes(run).map(node => node.id); starts.push(first.length);
  for (const node of nodes) {
    const row = byRow.get(node.row) ?? {}; row[node.type] = (row[node.type] ?? 0) + 1; row.all = (row.all ?? 0) + 1; byRow.set(node.row, row);
    for (const [section, rows] of Object.entries(SECTIONS) as [Section, readonly number[]][]) if (rows.includes(node.row)) { freeTotal[section]++; freeByType[section][node.type]++; }
  }
  const walk = (node: ForestMapNode): ForestMapNode[][] => node.next.length ? node.next.flatMap(id => walk(byId.get(id)!).map(path => [node, ...path])) : [[node]];
  const routes = first.flatMap(id => walk(byId.get(id)!));
  routesToBoss.push(routes.length);
  for (const lane of ['den', 'camp']) routesPerBoss.push(routes.filter(route => route[route.length - 1].lane === lane).length);
  for (const route of routes) {
    for (const [section, rows] of Object.entries(SECTIONS) as [Section, readonly number[]][]) {
      const free = route.filter(node => rows.includes(node.row));
      for (const type of TYPES) shares[section][type].push(free.filter(node => node.type === type).length / free.length);
    }
    battlesWithTrunk.push(4 + route.filter(isBattle).length);
    eventsPerRoute.push(route.filter(node => node.type === 'event').length);
  }
}

console.log(`Generated forest map, ${COUNT} spread seeds (Math.imul(k, 2654435761) >>> 0, k = 1…${COUNT})\n`);
console.log('Nodes by row (share of the row\'s nodes over all maps):');
console.log('| Ряд | Узлов на карту (ср.) | Бой | Трудный | Привал | Находка | Событие | Прочее |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
  const counts = byRow.get(row)!, all = counts.all, other = all - TYPES.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
  console.log(`| ${row} | ${(all / COUNT).toFixed(2)} | ${TYPES.map(type => counts[type] ? pct(counts[type] / all) : '—').join(' | ')} | ${other ? pct(other / all) : '—'} |`);
}
console.log('\nShares of free nodes (fixed rows 5, 9, 13, 14 excluded), over all nodes of the maps and per route:');
console.log('| Часть | Тип | Доля узлов карт | На путь: мин | среднее | макс |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const section of Object.keys(SECTIONS) as Section[]) {
  for (const type of TYPES) {
    const list = shares[section][type], avg = list.reduce((a, b) => a + b, 0) / list.length;
    if (!freeByType[section][type]) continue;
    console.log(`| ${section} | ${type} | ${pct(freeByType[section][type] / freeTotal[section])} | ${pct(Math.min(...list))} | ${pct(avg)} | ${pct(Math.max(...list))} |`);
  }
}
const hist = (list: number[]) => { const counts = new Map<number, number>(); for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1); return [...counts].sort((a, b) => a[0] - b[0]).map(([value, count]) => `${value}: ${pct(count / list.length)}`).join(', '); };
console.log(`\nNodes per map (without the trunk): median ${median(nodeCounts)}, min ${Math.min(...nodeCounts)}, max ${Math.max(...nodeCounts)}`);
console.log(`Start nodes (row 5): median ${median(starts)}; ${hist(starts)}`);
console.log(`Routes from row 5 to a boss: median ${median(routesToBoss)}, min ${Math.min(...routesToBoss)}, max ${Math.max(...routesToBoss)}; per boss median ${median(routesPerBoss)}`);
console.log(`Battles per route, trunk included (+4): ${hist(battlesWithTrunk)}`);
console.log(`Events per route: ${hist(eventsPerRoute)}`);

// Repeats: random runs (a uniform choice at every step), battles resolved as won with the entry resources.
let runs = 0, runsWithRepeat = 0, pooled = 0, repeats = 0, sameMain = 0, transitions = 0;
const repeatsBySection = { trails: 0, branches: 0 }, pooledBySection = { trails: 0, branches: 0 };
const repeated = new Map<string, number>();
for (const [k, seed] of SEEDS.entries()) {
  let run: ForestRunState = createForestRun(seed, { map: 'generated', skipTrunk: true }), choice = spread(k + 7);
  const met: string[] = [];
  while (!run.result) {
    choice = spread(choice + 1);
    if (run.pending?.kind === 'battle') {
      const entry = run.pending.entry;
      const step = resolveBattle(run, { nodeId: run.pending.nodeId, won: true, player: { ...entry.player }, inventory: { ...entry.inventory } });
      if (!step.ok) throw new Error(step.reason); run = step.run;
    } else if (run.pending?.kind === 'find') {
      const step = chooseFindItem(run, run.pending.options[0]); if (!step.ok) throw new Error(step.reason); run = step.run;
    } else if (run.pending?.kind === 'talisman') {
      const step = chooseTalisman(run, null); if (!step.ok) throw new Error(step.reason); run = step.run;
    } else if (run.pending?.kind === 'rest') {
      const step = restHeal(run); if (!step.ok) throw new Error(step.reason); run = step.run;
    } else if (run.pending?.kind === 'event') {
      const step = chooseEventOption(run, eventView(run)!.options.find(option => option.available)!.id); if (!step.ok) throw new Error(step.reason); run = step.run;
    } else {
      const next = availableNodes(run), target = next[choice % next.length];
      const step = enterNode(run, target.id); if (!step.ok) throw new Error(step.reason); run = step.run;
      const node = runNode(run, target.id)!;
      if (node.content.kind !== 'battle') continue;
      const id = node.content.battleId, section = node.row <= 9 ? 'trails' : 'branches';
      pooled++; pooledBySection[section]++;
      if (met.includes(id)) { repeats++; repeatsBySection[section]++; repeated.set(id, (repeated.get(id) ?? 0) + 1); }
      if (met.length) { transitions++; if (battlePoolEntry(met[met.length - 1])?.main === battlePoolEntry(id)?.main) sameMain++; }
      met.push(id);
    }
  }
  runs++; if (met.length !== new Set(met).size) runsWithRepeat++;
}
console.log(`\nRandom runs (${runs}): pooled battles per run ${(pooled / runs).toFixed(2)}; repeated battles ${repeats} (${pct(repeats / pooled)} of pooled battles); runs with a repeat ${pct(runsWithRepeat / runs)}`);
console.log(`  trails (rows 5–9): ${pct(repeatsBySection.trails / pooledBySection.trails)} of their battles repeat; branches (rows 10–14): ${pct(repeatsBySection.branches / pooledBySection.branches)}`);
console.log(`  the same main enemy as the battle before: ${pct(sameMain / transitions)} of transitions`);
console.log(`  most repeated: ${[...repeated].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, count]) => `${id} ${count}`).join(', ')}`);
