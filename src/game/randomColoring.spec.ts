/**
 * Prototype A: random coloring of ordinary enemies (decision of 04.10.2026, docs/random-coloring.md).
 *
 * Four trail battles flagged in the pools draw the colors of their ordinary enemies by the battle seed on entering;
 * everything else of the scenario stays authored. Checked through real engines and real moves on many battle seeds:
 * - the scenario is kept (terrain, special enemies, targets' place and HP, doors), the battle RNG is not spent;
 * - constraints 1–5 of section 3: palette, targets of different colors, group bounds, an ordinary chain of two enemies
 *   from the cat, and no first chain meets the goals — played for real, not only forecast;
 * - variety between seeds, exact replay of the same seed, forecast = execution, a reload of the run gives the same colors;
 * - after RANDOM_COLORING_ATTEMPTS rejected candidates the battle keeps its authored colors.
 * The route specs of these battles start them without the flag and keep testing the authored coloring.
 */
import { ForestEngine } from './forestEngine';
import type { ChainPreview, EnemyColor, ForestState } from './forestTypes';
import { BATTLE_POOLS } from './run/battlePools';
import { forestBattle } from './run/forestBattles';
import { forestRowPalette } from './run/forestMap';
import { availableNodes, battleSetup, createForestRun, enterNode, parseForestRun, serializeForestRun, type ForestRunState } from './run/forestRun';
import type { RunBattleSetup } from './run/runBattle';
import { nodeBattleSetup } from './testing/fixtures';
import { colorGroupMetrics, COLORING_MAX_COMPONENT_SHARE, COLORING_MIN_INTERLEAVE, pickRandomColoring, RANDOM_COLORING_ATTEMPTS, setColoringScenarioCheck } from './randomColoring';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;

const PROTOTYPE = ['boar-garden', 'goblin-shield-flank', 'beast-quill-stop', 'goblin-pike-gate'];
const SEEDS = Array.from({ length: 60 }, (_, k) => spread(k + 1));
/** Seeds on which every first chain is played for real (check 5). */
const PLAYED_SEEDS = SEEDS.slice(0, 8);

function start(setup: RunBattleSetup): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), `${setup.template.id} (seed ${setup.seed}) starts`);
  return g;
}
const randomSetup = (id: string, seed: number) => nodeBattleSetup(id, { seed, coloring: 'random' });
const authoredSetup = (id: string, seed: number) => nodeBattleSetup(id, { seed });
const fingerprint = (g: ForestEngine) => { const s = g.captureAnalysisSnapshot(); return json([s.state, s.rng, s.nextId]); };

/**
 * Ordinary enemies of the authored layout (docs/random-coloring.md, section 2): plain goblins — weak (0 HP) or marked
 * targets — that are not elites. Everything else is a special enemy, whose color is part of the scenario.
 */
function ordinaryIndices(id: string): Set<number> {
  const battle = forestBattle(id)!;
  return new Set(battle.definition.enemies.filter(enemy => enemy.kind === 'melee' && !enemy.variant && !enemy.elite
    && (enemy.hp === 0 || battle.targetIndices.includes(enemy.index))).map(enemy => enemy.index));
}
/** Colors of the ordinary enemies by cell, in cell order. */
const ordinaryColors = (g: ForestEngine, ordinary: Set<number>) => [...ordinary].sort((a, b) => a - b).map(index => g.state.board[index]?.color ?? null);
const goalsMet = (state: ForestState) => state.phase === 'WIN' || (state.customLevel?.goalCompletedTurn ?? null) !== null;

async function play(g: ForestEngine, path: number[]): Promise<boolean> {
  g.beginChain(path[0]); for (const index of path.slice(1)) g.extendChain(index);
  return g.releaseChain();
}
function copyOf(g: ForestEngine): ForestEngine {
  const copy = new ForestEngine(); copy.animationScale = 0; copy.restoreAnalysisSnapshot(g.captureAnalysisSnapshot());
  return copy;
}

/** Only the four battles of the prototype are flagged; every other battle (and the trunk) keeps its authored colors. */
function onlyThePrototypeIsFlagged() {
  const flagged = Object.entries(BATTLE_POOLS).filter(([, entry]) => entry.coloring === 'random').map(([id]) => id).sort();
  assert(json(flagged) === json([...PROTOTYPE].sort()), `flagged battles: ${flagged.join(', ')}`);
  // An unflagged pooled battle started with a run setup plays its authored colors on any seed.
  const authored = ordinaryColors(start(authoredSetup('wolf-ford', 9501)), ordinaryIndices('wolf-ford'));
  for (const seed of SEEDS.slice(0, 5)) assert(json(ordinaryColors(start(authoredSetup('wolf-ford', seed)), ordinaryIndices('wolf-ford'))) === json(authored), `wolf-ford: authored colors on seed ${seed}`);
  console.log('PASS only the four prototype battles are flagged');
}

/**
 * The scenario stays authored: terrain, the cat, doors, devices, every entity's place, kind, variant, HP, weapon and
 * elite mark, the targets, and the colors of special enemies. Only ordinary colors may change, and the battle starts
 * with the same RNG and ID allocator as its authored coloring (the coloring spends nothing of the battle).
 */
function scenarioIsKept() {
  for (const id of PROTOTYPE) {
    const ordinary = ordinaryIndices(id);
    for (const seed of SEEDS) {
      const r = start(randomSetup(id, seed)), a = start(authoredSetup(id, seed)), rs = r.state, as = a.state;
      assert(json(rs.terrain) === json(as.terrain) && rs.player.index === as.player.index && json(rs.devices) === json(as.devices), `${id} ${seed}: terrain, cat and devices are authored`);
      const ra = r.captureAnalysisSnapshot(), aa = a.captureAnalysisSnapshot();
      assert(ra.rng === aa.rng && ra.nextId === aa.nextId, `${id} ${seed}: the coloring spends no battle RNG or ID`);
      assert(json(rs.tutorial?.targetIds) === json(as.tutorial?.targetIds), `${id} ${seed}: the same marked targets`);
      rs.board.forEach((cell, index) => {
        const other = as.board[index];
        assert(!!cell === !!other, `${id} ${seed}: cell ${index} occupied as authored`);
        if (!cell || !other) return;
        assert(cell.id === other.id && cell.kind === other.kind && cell.variant === other.variant && cell.hp === other.hp && cell.maxHp === other.maxHp
          && cell.behavior.aggressive === other.behavior.aggressive && cell.behavior.passive === other.behavior.passive && !!cell.elite === !!other.elite && json(cell.shield) === json(other.shield),
          `${id} ${seed}: cell ${index} keeps its authored entity`);
        if (!ordinary.has(index)) assert(cell.color === other.color, `${id} ${seed}: the special enemy or door on ${index} keeps its authored color`);
      });
    }
  }
  console.log(`PASS the scenario stays authored on ${SEEDS.length} seeds of each battle; no battle RNG is spent`);
}

/** Constraints 1–4 of section 3 on the started battle, checked on the board the player sees. */
function constraintsHold() {
  for (const id of PROTOTYPE) {
    const ordinary = ordinaryIndices(id), battle = forestBattle(id)!;
    const special = battle.definition.enemies.filter(enemy => enemy.color !== null && !ordinary.has(enemy.index)).map(enemy => enemy.color as EnemyColor);
    for (const seed of SEEDS) {
      const g = start(randomSetup(id, seed)), state = g.state;
      const palette = new Set<EnemyColor>([...forestRowPalette(state.runNode!.row), ...special]);
      // 1. Palette: the row's colors plus the special enemies' colors.
      for (const index of ordinary) { const color = state.board[index]?.color; assert(color !== null && color !== undefined && palette.has(color), `${id} ${seed}: ${index} colored ${color} outside the palette`); }
      // 2. Marked targets of different colors.
      const targetColors = state.tutorial!.targetIds.map(targetId => state.board.find(cell => cell?.id === targetId)?.color);
      assert(new Set(targetColors).size === targetColors.length, `${id} ${seed}: targets of different colors (${json(targetColors)})`);
      // 3. Group bounds, as the analyzer reports them (static.largestComponentShare, static.colorInterleave).
      const groups = colorGroupMetrics(state);
      assert(groups.largestComponentShare <= COLORING_MAX_COMPONENT_SHARE && groups.colorInterleave >= COLORING_MIN_INTERLEAVE,
        `${id} ${seed}: group share ${groups.largestComponentShare}, interleave ${groups.colorInterleave}`);
      // 4. An ordinary chain of two or more enemies from the cat.
      assert(g.availableMoves().some(path => g.preview(path).valid && g.preview(path).enemies >= 2), `${id} ${seed}: a first chain of two enemies`);
      assert(g.coloring && g.coloring.attempt !== null, `${id} ${seed}: a random coloring passed (attempt ${g.coloring?.attempt})`);
    }
  }
  console.log(`PASS constraints 1–4 on ${SEEDS.length} seeds of each battle`);
}

/** 5. No first chain meets the goals: every chain the cat can open with is played for real on a copy. */
async function noFirstChainMeetsTheGoals() {
  let played = 0;
  for (const id of PROTOTYPE) for (const seed of PLAYED_SEEDS) {
    const g = start(randomSetup(id, seed));
    for (const path of g.availableMoves()) {
      const copy = copyOf(g);
      if (!await play(copy, path)) continue;
      played++;
      assert(!goalsMet(copy.state), `${id} ${seed}: the first chain ${json(path)} meets the goals`);
    }
  }
  console.log(`PASS no first chain meets the goals (${played} first chains played on ${PLAYED_SEEDS.length} seeds of each battle)`);
}

/** Colorings differ between seeds (most seeds give a coloring of their own) and from the authored one; every ordinary cell varies. */
function colorsVary() {
  for (const id of PROTOTYPE) {
    const ordinary = ordinaryIndices(id), authored = json(ordinaryColors(start(authoredSetup(id, SEEDS[0])), ordinary));
    const colorings = SEEDS.map(seed => ordinaryColors(start(randomSetup(id, seed)), ordinary));
    const distinct = new Set(colorings.map(json));
    assert(distinct.size >= SEEDS.length * 0.95, `${id}: ${distinct.size} distinct colorings of ${SEEDS.length} seeds`);
    assert(colorings.filter(coloring => json(coloring) !== authored).length >= SEEDS.length * 0.95, `${id}: random colorings differ from the authored one`);
    [...ordinary].sort((a, b) => a - b).forEach((index, n) => {
      const seen = new Set(colorings.map(coloring => coloring[n]));
      assert(seen.size >= 2, `${id}: the ordinary enemy on ${index} always gets color ${[...seen][0]}`);
    });
    // Colors are not glued to cells: two neighbouring seeds rarely agree on a cell beyond chance (4 colors: about 1/4).
    let same = 0, total = 0;
    for (let k = 1; k < colorings.length; k++) colorings[k].forEach((color, n) => { total++; if (color === colorings[k - 1][n]) same++; });
    assert(same / total < 0.4, `${id}: neighbouring seeds share ${(same / total * 100).toFixed(0)}% of the ordinary colors`);
  }
  console.log(`PASS colorings vary between seeds and from the authored layout`);
}

/** The same seed and the same actions give exactly the same battle; a restart keeps the drawn colors. */
async function replayIsExact() {
  for (const id of PROTOTYPE) for (const seed of SEEDS.slice(0, 4)) {
    const a = start(randomSetup(id, seed)), b = start(randomSetup(id, seed)), entry = fingerprint(a);
    assert(entry === fingerprint(b), `${id} ${seed}: the same seed gives the same opening`);
    for (let turn = 0; turn < 4 && a.state.phase === 'PLAYER_INPUT'; turn++) {
      const move = a.availableMoves(8)[0]; if (!move) break;
      assert(await play(a, move) && await play(b, move), `${id} ${seed}: turn ${turn} plays`);
      assert(fingerprint(a) === fingerprint(b), `${id} ${seed}: turn ${turn} replays exactly`);
    }
    a.restartLevel();
    assert(fingerprint(a) === entry, `${id} ${seed}: a restart returns to the same colored opening`);
  }
  console.log('PASS the same seed replays exactly; a restart keeps the colors');
}

/** Forecast = execution on random colorings: damage, death, victory and forced deaths of the first turns. */
async function forecastMatchesExecution() {
  let compared = 0;
  for (const id of PROTOTYPE) for (const seed of SEEDS.slice(0, 4)) {
    const g = start(randomSetup(id, seed));
    for (let turn = 0; turn < 6 && g.state.phase === 'PLAYER_INPUT'; turn++) {
      const moves = g.availableMoves(8);
      if (!moves.length) break;
      const path = moves[turn % moves.length], before = g.captureAnalysisSnapshot(), preview: ChainPreview = g.preview(path);
      assert(fingerprint(g) === json([before.state, before.rng, before.nextId]), `${id} ${seed}: the preview changes nothing`);
      if (!preview.valid) continue;
      assert(await play(g, path), `${id} ${seed}: turn ${turn} plays`);
      const after = g.state, label = `${id} ${seed} turn ${turn}`;
      compared++;
      assert(before.state.player.hp - preview.damage === after.player.hp, `${label}: forecast damage ${preview.damage}, executed ${before.state.player.hp} → ${after.player.hp}`);
      assert(!!preview.playerDies === (after.player.hp === 0), `${label}: forecast death`);
      assert((!!preview.completesRoom || !!preview.enemyPhase?.completesObjective) === (after.phase === 'WIN'), `${label}: forecast victory`);
      for (const death of preview.enemyPhase?.deaths ?? []) assert(!after.board.some(cell => cell?.id === death.id), `${label}: forecast death of ${death.id}`);
    }
  }
  console.log(`PASS forecast = execution on random colorings (${compared} turns)`);
}

/** A first-row battle of a generated run that plays a prototype battle (found on some run seed). */
function runInPrototypeBattle(): ForestRunState {
  for (let k = 1; k <= 80; k++) {
    const run = createForestRun(spread(k), { map: 'generated', skipTrunk: true });
    for (const node of availableNodes(run)) {
      const entered = enterNode(run, node.id);
      if (!entered.ok || entered.run.pending?.kind !== 'battle') continue;
      const setup = battleSetup(entered.run);
      if (setup && PROTOTYPE.includes(setup.template.id)) return entered.run;
    }
  }
  throw new Error('no generated run enters a prototype battle on its first row');
}

/**
 * In a run the flagged battle gets the random coloring by the run seed and the node id; a save and reload of the run
 * gives the same setup and the same colored opening (the coloring is never rerolled).
 */
function runAndReloadKeepTheColors() {
  const run = runInPrototypeBattle(), setup = battleSetup(run)!;
  assert(setup.coloring === 'random', `${setup.template.id}: the run asks for the random coloring`);
  const first = start(setup);
  const reloaded = parseForestRun(serializeForestRun(run))!;
  assert(json(battleSetup(reloaded)) === json(setup), `${setup.template.id}: the reloaded run gives the same setup`);
  assert(fingerprint(start(battleSetup(reloaded)!)) === fingerprint(first), `${setup.template.id}: the reloaded run gives the same colored opening`);
  const ordinary = ordinaryIndices(setup.template.id);
  assert(json(ordinaryColors(first, ordinary)) !== json(ordinaryColors(start({ ...setup, coloring: undefined }), ordinary)), `${setup.template.id}: the run's coloring is not the authored one`);
  // An unflagged battle of the run (any first-row battle of another seed that is not in the prototype) has no flag.
  let unflagged = 0;
  for (let k = 1; k <= 20 && !unflagged; k++) {
    const other = createForestRun(spread(k), { map: 'generated', skipTrunk: true });
    for (const node of availableNodes(other)) {
      const entered = enterNode(other, node.id);
      const otherSetup = entered.ok && entered.run.pending?.kind === 'battle' ? battleSetup(entered.run) : null;
      if (otherSetup && !PROTOTYPE.includes(otherSetup.template.id)) { assert(otherSetup.coloring === undefined, `${otherSetup.template.id}: no random coloring`); unflagged++; }
    }
  }
  assert(unflagged > 0, 'an unflagged run battle was checked');
  console.log(`PASS the run plays ${setup.template.id} with the random coloring; a reload gives the same colors`);
}

/**
 * Fallback: when every candidate is rejected (a scenario check that never passes), the battle starts after exactly
 * RANDOM_COLORING_ATTEMPTS candidates with its authored colors. A check that passes only the third candidate gives a
 * coloring other than the first candidate, the same on every start of that seed.
 */
function fallbackAfterTheAttempts() {
  const id = 'goblin-pike-gate', seed = SEEDS[0], ordinary = ordinaryIndices(id);
  const authored = json(ordinaryColors(start(authoredSetup(id, seed)), ordinary));
  const firstCandidate = json(ordinaryColors(start(randomSetup(id, seed)), ordinary));
  let calls = 0;
  try {
    setColoringScenarioCheck(() => { calls++; return false; });
    const g = start(randomSetup(id, seed));
    assert(calls === RANDOM_COLORING_ATTEMPTS, `${calls} candidates were checked, expected ${RANDOM_COLORING_ATTEMPTS}`);
    assert(g.coloring?.attempt === null && json(ordinaryColors(g, ordinary)) === authored, 'after the attempts the battle keeps its authored colors');
    const thirds: string[] = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      calls = 0; setColoringScenarioCheck(() => ++calls === 3);
      const third = start(randomSetup(id, seed));
      assert(third.coloring?.attempt === 3, `the third candidate passes (attempt ${third.coloring?.attempt})`);
      thirds.push(json(ordinaryColors(third, ordinary)));
    }
    assert(thirds[0] === thirds[1] && thirds[0] !== firstCandidate && thirds[0] !== authored, 'a retry draws a new candidate from the same seed, the same every time');
  } finally { setColoringScenarioCheck(null); }
  // The pure picker stops after exactly the attempts and hands back the authored lesson.
  let tries = 0;
  const lesson = forestBattle(id)!, choice = pickRandomColoring(lesson, [0, 1, 2, 3], seed, () => { tries++; return false; });
  assert(tries === RANDOM_COLORING_ATTEMPTS && choice.attempt === null && choice.lesson === lesson, 'the picker falls back to the authored lesson');
  console.log(`PASS fallback to the authored colors after ${RANDOM_COLORING_ATTEMPTS} rejected candidates`);
}

async function main() {
  onlyThePrototypeIsFlagged();
  scenarioIsKept();
  constraintsHold();
  await noFirstChainMeetsTheGoals();
  colorsVary();
  await replayIsExact();
  await forecastMatchesExecution();
  runAndReloadKeepTheColors();
  fallbackAfterTheAttempts();
}
await main();
console.log('random coloring: ok');
