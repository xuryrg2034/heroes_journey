import { ForestEngine } from './forestEngine';
import { forestMapPaths, forestNode, validateForestMap } from './run/forestMap';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseTalisman, createForestRun, enterNode, eventOutcomeIndex, eventView, forestRunView, parseForestRun,
  resolveBattle, restHeal, serializeForestRun, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { FOREST_EVENTS, isSafeOption, validateForestEvents } from './run/forestEvents';

// Map events (decision of 04.10.2026, docs/roguelike-runs.md, section 5a): two test events on row 8 beside «Три знамени».
// Runs are walked with the pure run model; battles are started by the real engine and finished with its debug win
// (this suite checks the run, not a bot's victory). Seeds are spread with Math.imul(k, 2654435761).

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return (step as { run: ForestRunState }).run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));

/**
 * Walk the ids: battles start in the engine and are won (with the cat's HP and energy set before the win, as a real
 * battle could leave them), finds take their first option. Returns the run with the last node entered.
 */
function walk(seed: number, ids: string[], exit: { hp?: number; energy?: number } = {}): ForestRunState {
  let run = createForestRun(seed);
  for (const id of ids) {
    run = ok(enterNode(run, id), `enter ${id}`);
    if (run.pending?.kind === 'battle') {
      const e = new ForestEngine(); e.animationScale = 0;
      assert(e.startRunBattle(battleSetup(run)!), `${id} starts`);
      if (exit.hp !== undefined) e.state.player.hp = exit.hp;
      if (exit.energy !== undefined) e.state.player.energy = exit.energy;
      e.winLevel(); run = ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${id}`);
    }
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `find at ${id}`);
    if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), `refuse the talismans at ${id}`);
    if (run.pending?.kind === 'rest') run = ok(restHeal(run), `heal at ${id}`);
  }
  return run;
}
const TRUNK = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4'];
const TO_BROOK = [...TRUNK, 'beast-wolf', 'trail-rest', 'beast-porcupine', 'trail-brook'];
const TO_CACHE = [...TRUNK, 'goblin-archer', 'goblin-shield', 'goblin-shaman', 'trail-cache'];

function data() {
  assert(!validateForestEvents().length, `event data is valid: ${validateForestEvents().join(' ')}`);
  assert(!validateForestMap().length, `the map is valid: ${validateForestMap().join(' ')}`);
  for (const event of Object.values(FOREST_EVENTS)) assert(event.options.some(isSafeOption), `${event.id}: has a safe option`);
  const brook = forestNode('trail-brook')!, cache = forestNode('trail-cache')!;
  assert(brook.type === 'event' && brook.row === 8 && brook.column === 0 && cache.type === 'event' && cache.row === 8 && cache.column === 2, 'both events stand on row 8 beside the banners');
  assert(json(brook.next) === json(['jailer']) && json(cache.next) === json(['jailer']), 'both events lead to the Jailer');
  assert(forestNode('beast-porcupine')!.next.includes('trail-brook') && forestNode('trail-find')!.next.includes('trail-brook')
    && forestNode('trail-find')!.next.includes('trail-cache') && forestNode('goblin-shaman')!.next.includes('trail-cache'), 'event entries as decided');
  assert(forestMapPaths().every(path => path.includes('trail-banners') || path.includes('trail-brook') || path.includes('trail-cache')), 'every route passes row 8');
  // A broken event is caught by the validator.
  const broken = { bad: { id: 'bad', title: '', scene: '', options: [{ id: 'a', label: 'a', outcomes: [{ chance: 60, label: 'x', effect: { hp: -1 } }, { chance: 30, label: 'y', effect: {} }] },
    { id: 'b', label: 'b', outcomes: [{ chance: 100, effect: { energy: -1 } }] }] } };
  const errors = validateForestEvents(broken);
  assert(errors.some(error => error.includes('безопасного')) && errors.some(error => error.includes('суммой 100')), `the validator catches a missing safe option and bad chances: ${errors.join(' ')}`);
  console.log('PASS event data and map placement: row 8, safe options, every route chooses a battle or an event');
}

/** Every brook option through the real run: the changes, the caps, the completed node and the save. */
function brookOptions() {
  for (const k of [1, 2, 3]) {
    const seed = spread(k);
    for (const [hp, energy] of [[2, 0], [5, 6.5]] as const) {
      const run = walk(seed, TO_BROOK, { hp, energy });
      assert(run.pending?.kind === 'event' && run.pending.nodeId === 'trail-brook' && !availableNodes(run).length, 'the brook waits for a choice');
      assert(forestRunView(run).nodes.find(entry => entry.node.id === 'trail-brook')?.status === 'in-progress', 'the map shows the open event');
      const view = eventView(run)!;
      assert(view.options.every(option => option.available) && view.options.map(option => option.outcomes[0].text).join('|') === '+2 HP (не выше максимума)|+1 «Холод»|+1 энергия (не выше 7)',
        `the brook shows its outcomes in advance: ${json(view.options)}`);
      const drink = ok(chooseEventOption(run, 'drink'), 'drink');
      assert(drink.resources.player.hp === Math.min(5, hp + 2), `drink: ${hp} HP → ${drink.resources.player.hp}, never above the maximum`);
      const flask = ok(chooseEventOption(run, 'flask'), 'flask');
      assert(flask.resources.inventory.frost === run.resources.inventory.frost + 1, 'flask: +1 frost');
      const sharpen = ok(chooseEventOption(run, 'sharpen'), 'sharpen');
      assert(sharpen.resources.player.energy === Math.min(7, energy + 1), `sharpen: energy ${energy} → ${sharpen.resources.player.energy}, never above 7`);
      for (const [name, after] of [['drink', drink], ['flask', flask], ['sharpen', sharpen]] as const) {
        assert(after.currentNodeId === 'trail-brook' && after.pending === null && json(availableNodes(after).map(node => node.id)) === json(['jailer']), `${name}: the event completes and leads to the Jailer`);
        assert(json(roundTrip(after)) === json(after), `${name}: the run survives a save`);
        assert(forestRunView(after).battlesWon === forestRunView(run).battlesWon, `${name}: an event is not a battle`);
      }
      assert(!chooseEventOption(drink, 'flask').ok, 'one choice per event');
    }
  }
  console.log('PASS the brook: drink, flask and sharpen change HP, frost and energy within the caps and complete the node');
}

/** The cache: the random option repeats by seed and comes out about half and half; careful needs energy; leave is safe. */
function cacheOptions() {
  let loot = 0, traps = 0;
  const base = walk(spread(4), TO_CACHE, { hp: 3, energy: 1 });
  for (let k = 1; k <= 400; k++) {
    // The same route under another run seed: only the seed changes the roll (the battles do not draw from it).
    const run = { ...structuredClone(base), seed: spread(k) };
    const view = eventView(run)!, breakOption = view.options.find(option => option.id === 'break')!;
    assert(breakOption.outcomes.length === 2 && breakOption.outcomes.every(outcome => outcome.chance === 50), 'break shows both outcomes and their chance');
    const first = ok(chooseEventOption(run, 'break'), 'break'), again = ok(chooseEventOption(run, 'break'), 'break again');
    assert(json(first) === json(again), `seed ${k}: the same run and choice give the same outcome`);
    const choice = first.eventChoices.at(-1)!, gained = Object.values(first.resources.materials ?? {}).reduce((sum, count) => sum + count, 0);
    if (choice.outcome === 0) {
      loot++;
      assert(gained === 2 && first.resources.player.hp === 3, `seed ${k}: loot gives 2 crafting resources`);
      const kinds = breakOption.outcomes[0].text;
      assert(Object.entries(first.resources.materials!).every(([kind, count]) => !count || kinds.includes(({ dew: 'Роса', powder: 'Порох', resin: 'Смола', herbs: 'Травы' } as Record<string, string>)[kind])),
        `seed ${k}: the resources are the kinds shown before the choice (${kinds})`);
    } else {
      traps++;
      assert(gained === 0 && first.resources.player.hp === 1, `seed ${k}: the trap takes 2 HP from 3`);
    }
  }
  assert(loot >= 160 && traps >= 160, `the 50% outcome comes out about half and half over 400 seeds: ${loot} loot, ${traps} traps`);
  // Runs really walked under their own seed (their own battles) roll as the seed alone says: the shortcut above holds.
  for (let k = 1; k <= 12; k++) {
    const walked = ok(chooseEventOption(walk(spread(k), TO_CACHE, { hp: 3, energy: 1 }), 'break'), 'walked break');
    const swapped = ok(chooseEventOption({ ...structuredClone(base), seed: spread(k) }, 'break'), 'swapped break');
    assert(walked.eventChoices.at(-1)!.outcome === swapped.eventChoices.at(-1)!.outcome && json(walked.resources.materials ?? null) === json(swapped.resources.materials ?? null),
      `seed ${k}: the outcome depends on the run seed and the node only`);
  }

  // Careful: −1 energy (needs at least 1), one resource for sure. Unaffordable means disabled with a reason.
  for (const energy of [0, 0.5]) {
    const poor = walk(spread(5), TO_CACHE, { energy }), careful = eventView(poor)!.options.find(option => option.id === 'careful')!;
    assert(!careful.available && careful.reason.includes('Нужна энергия') && !chooseEventOption(poor, 'careful').ok, `careful at energy ${energy}: unavailable and says why (${careful.reason})`);
    const leave = ok(chooseEventOption(poor, 'leave'), 'leave');
    assert(json(leave.resources) === json(poor.resources) && leave.currentNodeId === 'trail-cache', 'passing by changes nothing and completes the node');
  }
  const rich = walk(spread(5), TO_CACHE, { energy: 1.5 }), careful = ok(chooseEventOption(rich, 'careful'), 'careful');
  assert(careful.resources.player.energy === 0.5 && Object.values(careful.resources.materials ?? {}).reduce((sum, count) => sum + count, 0) === 1, 'careful: −1 energy, +1 resource');
  // A consumable an event would give must be opened: with frost closed the flask is unavailable (rule check on a
  // model state; on the current map frost is always open by row 8).
  const brook = walk(spread(6), TO_BROOK), closed = { ...structuredClone(brook), tools: { ...brook.tools, items: [] } };
  const flask = eventView(closed)!.options.find(option => option.id === 'flask')!;
  assert(!flask.available && flask.reason.includes('Холод') && !chooseEventOption(closed, 'flask').ok, 'an event never gives a closed consumable');
  console.log(`PASS the cache: break repeats by seed (${loot}/${traps} of 400), careful needs energy, leave is safe`);
}

/** The trap never lowers HP below 1; an event never kills the cat. */
function hpFloor() {
  const traps: number[] = [];
  for (let k = 1; traps.length < 3 && k < 100; k++) {
    const option = FOREST_EVENTS['goblin-cache'].options[0];
    if (eventOutcomeIndex(spread(k), 'trail-cache', option) === 1) traps.push(spread(k));
  }
  assert(traps.length === 3, 'seeds with the trap exist');
  for (const [n, hp] of [1, 2, 5].entries()) {
    const run = walk(traps[n], TO_CACHE, { hp }), after = ok(chooseEventOption(run, 'break'), 'break');
    assert(after.eventChoices.at(-1)!.outcome === 1 && after.resources.player.hp === Math.max(1, hp - 2), `trap at ${hp} HP leaves ${after.resources.player.hp}, never below 1`);
    assert(json(roundTrip(after)) === json(after), 'the trapped run survives a save');
  }
  console.log('PASS the trap never takes the cat below 1 HP');
}

/** An open event survives a reload: the same options, and the same outcome as without the reload. */
function reload() {
  for (const k of [7, 8, 9]) {
    const run = walk(spread(k), TO_CACHE, { energy: 2 }), reloaded = roundTrip(run)!;
    assert(reloaded && reloaded.pending?.kind === 'event' && json(eventView(reloaded)) === json(eventView(run)), `seed ${k}: the reloaded event is the same`);
    for (const option of ['break', 'careful', 'leave']) {
      assert(json(ok(chooseEventOption(reloaded, option), option)) === json(ok(chooseEventOption(run, option), option)), `seed ${k}: ${option} after a reload gives the same result`);
    }
  }
  // Tampering: a forged outcome, an item over the event's gain, a missing choice, a bad pending event.
  const done = ok(chooseEventOption(walk(spread(10), TO_BROOK), 'flask'), 'flask');
  const tamper = (edit: (value: Record<string, any>) => void) => { const value = JSON.parse(serializeForestRun(done)); edit(value); return parseForestRun(JSON.stringify(value)); };
  assert(tamper(v => { v.eventChoices[0].outcome = 1; }) === null, 'an outcome the seed did not roll is rejected');
  assert(tamper(v => { v.eventChoices[0].option = 'nope'; }) === null, 'an unknown option is rejected');
  assert(tamper(v => { v.resources.inventory.frost += 1; }) === null, 'more frost than the path and the event give is rejected');
  assert(tamper(v => { v.eventChoices = []; }) === null, 'a visited event without its choice is rejected');
  const open = walk(spread(10), TO_BROOK), old = JSON.parse(serializeForestRun(open)); old.pending.options = ['x'];
  assert(parseForestRun(JSON.stringify(old)) === null, 'a malformed open event is rejected');
  const legacy = JSON.parse(serializeForestRun(walk(spread(11), [...TRUNK, 'beast-wolf']))); delete legacy.eventChoices;
  assert(json(parseForestRun(JSON.stringify(legacy))?.eventChoices) === '[]', 'a save before events loads with no choices');
  console.log('PASS an open event survives a reload unchanged; forged choices are rejected; old saves load');
}

/** Routes through each event reach the Jailer battle and go on to a boss. */
function throughToJailer() {
  const routes: [string[], string][] = [
    [[...TRUNK, 'beast-wolf', 'beast-boar', 'beast-porcupine', 'trail-brook'], 'sharpen'],
    [[...TRUNK, 'beast-wolf', 'beast-boar', 'trail-find', 'trail-brook'], 'drink'],
    [[...TRUNK, 'goblin-archer', 'goblin-shield', 'trail-find', 'trail-cache'], 'leave'],
    [[...TRUNK, 'goblin-archer', 'trail-rest', 'goblin-shaman', 'trail-cache'], 'break'],
  ];
  for (const [n, [ids, option]] of routes.entries()) {
    let run = ok(chooseEventOption(walk(spread(20 + n), ids, { energy: 1 }), option), option);
    run = ok(enterNode(run, 'jailer'), 'enter the Jailer');
    const e = new ForestEngine(); e.animationScale = 0;
    const setup = battleSetup(run)!;
    assert(e.startRunBattle(setup) && e.state.runNode?.nodeId === 'jailer', `${ids.at(-1)}: the Jailer battle starts`);
    assert(e.state.player.hp === run.resources.player.hp && e.state.player.energy === run.resources.player.energy && json(e.state.inventory) === json(run.resources.inventory),
      `${ids.at(-1)}: the event's changes reach the Jailer battle`);
    assert(setup.allowedItems.includes('frost') && setup.allowedAbilities.includes('jump'), 'the tools of the trails stay open');
    e.winLevel(); run = ok(resolveBattle(run, e.runBattleOutcome()!), 'resolve the Jailer');
    run = ok(chooseTalisman(run, null), 'refuse the oaths');
    for (const id of ['camp-battle', 'camp-rest', 'camp-elite', 'camp-breakthrough', 'camp-chief']) {
      run = ok(enterNode(run, id), `enter ${id}`);
      if (run.pending?.kind === 'battle') {
        const fight = new ForestEngine(); fight.animationScale = 0; assert(fight.startRunBattle(battleSetup(run)!), `${id} starts`);
        fight.winLevel(); run = ok(resolveBattle(run, fight.runBattleOutcome()!), `resolve ${id}`);
      }
      if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), 'find');
      if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), 'refuse the talismans');
      if (run.pending?.kind === 'rest') run = ok(restHeal(run), 'heal');
    }
    assert(run.result?.outcome === 'victory' && json(roundTrip(run)) === json(run), `${ids.at(-1)}: the route goes on to the Chief and the save holds`);
    assert(forestRunView(run).battlesWon === ids.filter(id => !['trail-find', 'trail-rest', 'trail-brook', 'trail-cache'].includes(id)).length + 5, 'battles counted without the event');
  }
  console.log('PASS routes through the brook and the cache reach the Jailer and go on to a boss');
}

data();
brookOptions();
cacheOptions();
hpFloor();
reload();
throughToJailer();
console.log('Forest event checks passed.');
