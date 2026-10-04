/**
 * Talismans and oaths in the forest run (docs/talismans.md, decisions of 04.10.2026): the run side. Runs are walked with
 * the pure run model (enterNode, resolveBattle, chooseTalisman, rests); the statistical checks end battles with a won
 * outcome carrying the entry resources (fast), the effect checks start the real engine from battleSetup. Seeds are
 * spread with Math.imul(k, 2654435761). The battle effects of the talismans are in talismans.spec.ts.
 */
import { ForestEngine } from './forestEngine';
import { authoredLesson } from './lessonBuilder';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import { FOREST_REST_HEAL } from './run/forestMap';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseTalisman, createForestRun, DEW_FLASK_HEAL, enterNode, forestNodeSeed, forestRunMap, parseForestRun,
  resolveBattle, restHeal, restView, serializeForestRun, eventView, shopLeave, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { BLANK_SCORE, RARITY_CHANCES, talismanOffer, talismansClash, type TalismanOption } from './run/talismanOffers';
import { isOath, talisman, TALISMANS, type TalismanId } from './talismans';
import { rewardChoices } from './items';
import type { RunBattleOutcome } from './run/runBattle';
import type { ItemKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const sameAfterReload = (run: ForestRunState, what: string) => assert(json(roundTrip(run)) === json(run), `${what}: survives a save and reload unchanged`);
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };
const talismanIds = (options: readonly TalismanOption[]) => options.filter((option): option is TalismanId => option !== 'blank');

const TRUNK = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4'];
/** Goblin route to the camp's hard battle (jump opens at the shaman, the spin at the Jailer). */
const TO_CAMP_ELITE = [...TRUNK, 'goblin-archer', 'trail-rest', 'goblin-shaman', 'trail-banners', 'jailer', 'camp-battle', 'camp-rest', 'camp-elite'];

type Pick = (run: ForestRunState) => TalismanOption | null;
interface WalkOptions { oath?: Pick; talisman?: Pick; engine?: boolean }
/** A won battle carrying the entry resources (the run model's own path; no engine). */
const quickWin = (run: ForestRunState): RunBattleOutcome => {
  const pending = run.pending as Extract<ForestRunState['pending'], { kind: 'battle' }>;
  return { nodeId: pending.nodeId, won: true, player: { ...pending.entry.player }, inventory: { ...pending.entry.inventory } };
};
/** A battle started in the real engine from battleSetup and won with its debug command. */
function engineWin(run: ForestRunState): { outcome: RunBattleOutcome; engine: ForestEngine } {
  const e = new ForestEngine(); e.animationScale = 0;
  assert(e.startRunBattle(battleSetup(run)!), `${run.pending?.nodeId} starts`);
  e.winLevel();
  return { outcome: e.runBattleOutcome()!, engine: e };
}
/**
 * Walk the ids: battles are won (quickly, or in the engine), finds take the first item, rests heal except on the last
 * id, the Jailer's oaths and the hard battle's talismans follow `oath` / `talisman` (default: refuse). The talisman
 * choice of the last id is left open.
 */
function walk(seed: number, ids: string[], options: WalkOptions = {}): ForestRunState {
  let run = createForestRun(seed);
  ids.forEach((id, n) => {
    run = ok(enterNode(run, id), `enter ${id}`);
    if (run.pending?.kind === 'battle') run = ok(resolveBattle(run, options.engine ? engineWin(run).outcome : quickWin(run)), `resolve ${id}`);
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `find at ${id}`);
    if (run.pending?.kind === 'talisman' && n < ids.length - 1) run = ok(chooseTalisman(run, (run.pending.source === 'oath' ? options.oath : options.talisman)?.(run) ?? null), `choice at ${id}`);
    if (run.pending?.kind === 'rest' && n < ids.length - 1) run = ok(restHeal(run), `heal at ${id}`);
  });
  return run;
}
const offerOf = (run: ForestRunState) => (run.pending?.kind === 'talisman' ? run.pending.options : []) as TalismanOption[];

/** A won hard battle offers three talismans in place of the find; the Jailer offers three oaths and opens the spin. */
function sources() {
  for (let k = 1; k <= 6; k++) {
    const seed = spread(k);
    let run = walk(seed, TO_CAMP_ELITE.slice(0, TO_CAMP_ELITE.indexOf('jailer') + 1), { engine: true });
    assert(run.pending?.kind === 'talisman' && run.pending.source === 'oath' && run.pending.nodeId === 'jailer', `seed ${k}: the Jailer victory offers oaths`);
    const oaths = offerOf(run);
    assert(oaths.length === 3 && json([...talismanIds(oaths)].sort()) === json(TALISMANS.filter(entry => isOath(entry.id)).map(entry => entry.id).sort()), `seed ${k}: all three oaths are offered`);
    assert(run.tools.abilities.includes('spin') && !availableNodes(run).length, `seed ${k}: the spin opens with the victory, the map waits for the choice`);
    sameAfterReload(run, `seed ${k}: the open oath choice`);
    run = ok(chooseTalisman(run, null), `seed ${k}: refuse the oaths`);
    assert(run.talismans.length === 0 && json(availableNodes(run).map(node => node.id)) === json(['den-battle', 'camp-battle']), `seed ${k}: a refusal moves on to the branches`);
    for (const id of ['camp-battle', 'camp-rest']) { run = ok(enterNode(run, id), `enter ${id}`); if (run.pending?.kind === 'battle') run = ok(resolveBattle(run, engineWin(run).outcome), id); }
    run = ok(enterNode(ok(restHeal(run), 'heal'), 'camp-elite'), 'enter the hard battle');
    const finds = run.finds.length, { outcome } = engineWin(run);
    const won = ok(resolveBattle(run, outcome), `seed ${k}: win the hard battle`);
    assert(won.pending?.kind === 'talisman' && won.pending.source === 'hard' && won.finds.length === finds, `seed ${k}: the hard battle offers talismans, not a find`);
    const options = offerOf(won);
    assert(options.length === 3 && new Set(options).size === 3 && options.every(option => option !== 'blank' && !isOath(option)), `seed ${k}: three different talismans`);
    assert(won.resources.player.hp === Math.min(won.resources.player.maxHp, outcome.player.hp + 1), `seed ${k}: the hard battle still heals 1 HP`);
    sameAfterReload(won, `seed ${k}: the open talisman choice`);
    const taken = ok(chooseTalisman(won, options[1]), `seed ${k}: take the second talisman`);
    assert(json(taken.talismans) === json([options[1]]) && json(taken.talismansGone) === json([...talismanIds(oaths), options[0], options[2]]) && taken.currentNodeId === 'camp-elite',
      `seed ${k}: the taken talisman is held, the others (and the refused oaths) leave the pool, the node completes`);
    assert(!chooseTalisman(won, oaths[0]).ok, `seed ${k}: only an offered option can be taken`);
    sameAfterReload(taken, `seed ${k}: a run with a talisman`);
  }
  // Generated maps: every won hard battle and Jailer on a bot's path offers its choice.
  let hard = 0, jailers = 0;
  for (let k = 1; k <= 30; k++) {
    let run = createForestRun(spread(k), { map: 'generated' }), choice = spread(k + 99);
    while (!run.result) {
      choice = spread(choice + 1);
      if (run.pending?.kind === 'battle') {
        const node = forestRunMap(run).node(run.pending.nodeId)!;
        run = ok(resolveBattle(run, quickWin(run)), `generated ${k}: resolve`);
        if (node.type === 'hard') { hard++; assert(run.pending?.kind === 'talisman' && run.pending.source === 'hard', `generated ${k}: ${node.id} offers talismans`); }
        if (node.type === 'checkpoint') { jailers++; assert(run.pending?.kind === 'talisman' && run.pending.source === 'oath' && run.tools.abilities.includes('spin'), `generated ${k}: the Jailer offers oaths, the spin is open`); }
      } else if (run.pending?.kind === 'talisman') {
        const options = [...run.pending.options, null];
        run = ok(chooseTalisman(run, options[choice % options.length]), `generated ${k}: choose`);
        sameAfterReload(run, `generated ${k}: after a talisman choice`);
      } else if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), 'find');
      else if (run.pending?.kind === 'rest') run = ok(restHeal(run), 'heal');
      else if (run.pending?.kind === 'event') run = skipEvent(run);
      else if (run.pending?.kind === 'shop') run = ok(shopLeave(run), 'leave the merchant');
      else {
        const next = availableNodes(run), prefer = next.find(node => node.type === 'hard') ?? next[choice % next.length];
        run = ok(enterNode(run, prefer.id), `generated ${k}: enter ${prefer.id}`);
        if (run.pending?.kind === 'event') run = skipEvent(run);
      }
    }
  }
  assert(jailers === 30 && hard >= 8, `generated maps: ${jailers} Jailers and ${hard} hard battles offered their choices`);
  console.log(`PASS sources: the hard battle offers 3 talismans instead of the find (+1 HP), the Jailer 3 oaths and the spin; ${hard} hard battles and ${jailers} Jailers on generated maps`);
}
/** Events are not part of this suite: take the first available option. */
const skipEvent = (run: ForestRunState) => ok(chooseEventOption(run, eventView(run)!.options.find(option => option.available)!.id), 'event');

/** Rarity rolls over many seeds: about 50/33/17%; the offer draws on its own stream (the battle seed is unchanged). */
function rarities() {
  const counts = { common: 0, uncommon: 0, rare: 0 }, first = { common: 0, uncommon: 0, rare: 0 };
  const SEEDS = 600;
  let total = 0;
  for (let k = 1; k <= SEEDS; k++) {
    const seed = spread(k), run = walk(seed, TO_CAMP_ELITE);
    const options = offerOf(run);
    assert(options.length === 3 && !options.includes('blank'), `seed ${k}: a full pool offers three talismans`);
    options.forEach((option, slot) => {
      const rarity = talisman(option as TalismanId).rarity as keyof typeof counts;
      counts[rarity]++; total++;
      if (slot === 0) first[rarity]++;
    });
    // The talisman stream does not touch the node's battle seed or the find table of the same node.
    assert(battleSeedUnchanged(seed), `seed ${k}: battle seeds come from the run seed and node id only`);
  }
  for (const rarity of ['common', 'uncommon', 'rare'] as const) {
    const share = counts[rarity] / total * 100, firstShare = first[rarity] / SEEDS * 100;
    assert(Math.abs(share - RARITY_CHANCES[rarity]) < 4, `${rarity}: ${share.toFixed(1)}% of options, expected about ${RARITY_CHANCES[rarity]}%`);
    assert(Math.abs(firstShare - RARITY_CHANCES[rarity]) < 6, `${rarity}: ${firstShare.toFixed(1)}% of first options, expected about ${RARITY_CHANCES[rarity]}%`);
  }
  // Every talisman of the set is offered somewhere.
  const seen = new Set<TalismanId>();
  for (let k = 1; k <= 60; k++) talismanIds(offerOf(walk(spread(k), TO_CAMP_ELITE))).forEach(id => seen.add(id));
  assert(TALISMANS.filter(entry => !isOath(entry.id)).every(entry => seen.has(entry.id)), `every talisman is offered on some seed (${[...seen].join(', ')})`);
  console.log(`PASS rarity rolls on ${SEEDS} seeds: ${(['common', 'uncommon', 'rare'] as const).map(rarity => `${rarity} ${(counts[rarity] / total * 100).toFixed(1)}%`).join(', ')}`);
}
const battleSeedUnchanged = (seed: number) => {
  const run = ok(enterNode(ok(restHeal(walk(seed, TO_CAMP_ELITE.slice(0, -1))), 'heal'), 'camp-elite'), 'enter');
  return run.pending?.kind === 'battle' && run.pending.seed === forestNodeSeed(seed, 'camp-elite');
};

/**
 * Pool without return, clashes, the jump condition, the next rarity and the «пустышка». The maps of today give at most
 * one hard battle per path, so a second offer of the same run is computed from the real run's pool after its refusal.
 */
function pool() {
  let flaskWithoutOath = 0, pouchWithoutOath = 0;
  for (let k = 1; k <= 200; k++) {
    const seed = spread(k);
    // The oath of hunger at the Jailer: the hard battle never offers the dew flask; the oath of poverty: never the pouch.
    const hungry = walk(seed, TO_CAMP_ELITE, { oath: () => 'oath-hunger' }), poor = walk(seed, TO_CAMP_ELITE, { oath: () => 'oath-poverty' }), free = walk(seed, TO_CAMP_ELITE);
    assert(hungry.talismans[0] === 'oath-hunger' && !offerOf(hungry).includes('dew-flask'), `seed ${k}: no dew flask after the oath of hunger`);
    assert(poor.talismans[0] === 'oath-poverty' && !offerOf(poor).includes('ragman-pouch'), `seed ${k}: no ragman pouch after the oath of poverty`);
    if (offerOf(free).includes('dew-flask')) flaskWithoutOath++;
    if (offerOf(free).includes('ragman-pouch')) pouchWithoutOath++;
    for (const run of [hungry, poor, free]) {
      const ids = [...run.talismans, ...talismanIds(offerOf(run))];
      assert(!ids.some(a => ids.some(b => a !== b && talismansClash(a, b))), `seed ${k}: no clashing pair among the taken and offered`);
    }
    // Refused talismans leave the pool: no later offer of this run can show them again.
    const refused = ok(chooseTalisman(free, null), 'refuse');
    assert(json(refused.talismansGone.filter(id => !isOath(id)).sort()) === json([...talismanIds(offerOf(free))].sort()), `seed ${k}: the refused options left the pool`);
    for (const node of ['den-elite', 'later-hard-1', 'later-hard-2']) {
      const later = talismanOffer(forestNodeSeed(seed, node), 'hard', { taken: refused.talismans, gone: refused.talismansGone, abilities: refused.tools.abilities });
      assert(!later.some(option => option !== 'blank' && refused.talismansGone.includes(option)), `seed ${k}: a later offer never shows a refused talisman`);
    }
    // Ловкие лапы only with the jump open.
    const noJump = talismanOffer(forestNodeSeed(seed, 'camp-elite'), 'hard', { taken: [], gone: [], abilities: [] });
    assert(!noJump.includes('nimble-paws'), `seed ${k}: no nimble paws without the jump`);
  }
  assert(flaskWithoutOath > 10 && pouchWithoutOath > 10, `control: without the oaths the flask (${flaskWithoutOath}) and the pouch (${pouchWithoutOath}) are offered`);
  // An empty rarity gives way to the next one; a pool with nothing left gives one «пустышка».
  const commons = TALISMANS.filter(entry => entry.rarity === 'common').map(entry => entry.id);
  const allButOne = TALISMANS.filter(entry => !isOath(entry.id) && entry.id !== 'ash-ward').map(entry => entry.id);
  let nextRarity = 0;
  for (let k = 1; k <= 300; k++) {
    const noCommons = talismanOffer(spread(k), 'hard', { taken: [], gone: commons, abilities: ['jump'] });
    assert(noCommons.length === 3 && !noCommons.includes('blank') && noCommons.every(option => talisman(option as TalismanId).rarity !== 'common'), `seed ${k}: no common left — the options take the next rarity`);
    nextRarity++;
    const last = talismanOffer(spread(k), 'hard', { taken: [], gone: allButOne, abilities: ['jump'] });
    assert(json(last) === json(['ash-ward', 'blank']), `seed ${k}: one talisman left — it and one «пустышка» (${json(last)})`);
    const none = talismanOffer(spread(k), 'hard', { taken: ['ash-ward'], gone: allButOne, abilities: ['jump'] });
    assert(json(none) === json(['blank']), `seed ${k}: an empty pool offers the «пустышка» alone`);
    // Oaths never offer the «пустышка» (decision of 04.10.2026): one oath left — it alone; none — an empty offer.
    const oaths = TALISMANS.filter(entry => isOath(entry.id)).map(entry => entry.id);
    assert(json(talismanOffer(spread(k), 'oath', { taken: [], gone: oaths.slice(1), abilities: [] })) === json([oaths[0]]), `seed ${k}: one oath left — it alone, no «пустышка»`);
    assert(json(talismanOffer(spread(k), 'oath', { taken: oaths.slice(0, 1), gone: oaths.slice(1), abilities: [] })) === '[]', `seed ${k}: no oath left — an empty offer`);
  }
  // Taking the «пустышка» in a real run: its points (the pool of this run is set up by hand, a test shortcut).
  const run = walk(spread(3), TO_CAMP_ELITE), pending = run.pending as Extract<ForestRunState['pending'], { kind: 'talisman' }>;
  const blank = ok(chooseTalisman({ ...run, pending: { ...pending, options: ['blank'] } }, 'blank'), 'take the «пустышка»');
  assert(blank.score === run.score + BLANK_SCORE && blank.talismans.length === 0, 'the «пустышка» adds its points');
  console.log(`PASS pool: no return after a refusal, no clashing pairs (200 seeds), nimble paws only with the jump, the next rarity (${nextRarity} offers), one «пустышка» for an empty pool, +${BLANK_SCORE} points`);
}

/** Крепкая шкура, the oaths' energy, Фляга росы and Клятва голода at a rest — in real runs and battles. */
function effects() {
  // Крепкая шкура: +1 to the maximum and +1 HP; the next battle starts with them.
  let hides = 0;
  for (let k = 1; k <= 120 && hides < 3; k++) {
    const run = walk(spread(k), TO_CAMP_ELITE);
    if (!offerOf(run).includes('tough-hide')) continue;
    hides++;
    const { hp, maxHp } = run.resources.player, taken = ok(chooseTalisman(run, 'tough-hide'), 'take the hide');
    assert(taken.resources.player.maxHp === maxHp + 1 && taken.resources.player.hp === hp + 1, `seed ${k}: the hide gives ${maxHp + 1} max HP and +1 HP`);
    sameAfterReload(taken, `seed ${k}: a run with the hide`);
    const next = ok(enterNode(taken, 'camp-breakthrough'), 'enter the breakthrough');
    const { engine } = engineWin(next);
    assert(engine.state.player.maxHp === maxHp + 1, `seed ${k}: the next battle starts with ${maxHp + 1} max HP`);
    assert(forge(taken, value => { value.resources.player.maxHp = maxHp; value.resources.player.hp = Math.min(hp, maxHp); }) === null, `seed ${k}: a hide run with the old maximum is rejected`);
  }
  assert(hides === 3, 'three seeds offered the hide');
  assert(forge(walk(spread(1), TO_CAMP_ELITE.slice(0, -2)), value => { value.resources.player.maxHp = 6; }) === null, 'a maximum of 6 HP without the hide is rejected');
  // Oaths: +1 energy at the start of every battle; the oath of hunger: the rest heals nothing (effects still cleared).
  for (let k = 1; k <= 4; k++) {
    const seed = spread(k);
    const hungry = walk(seed, TO_CAMP_ELITE.slice(0, TO_CAMP_ELITE.indexOf('camp-rest') + 1), { oath: () => 'oath-hunger', engine: true });
    const plain = walk(seed, TO_CAMP_ELITE.slice(0, TO_CAMP_ELITE.indexOf('camp-rest') + 1), { engine: true });
    assert(restView(hungry)!.heal.value === 0 && restView(plain)!.heal.value === FOREST_REST_HEAL, `seed ${k}: the oath of hunger makes the rest heal 0, without it ${FOREST_REST_HEAL}`);
    const wounded = { ...hungry, resources: { ...hungry.resources, player: { ...hungry.resources.player, hp: 2, damageEffects: { burning: 0, burningTurns: 0, poison: 2, bleeding: 0, bleedingSteps: 0 } } } };
    const rested = restHeal(wounded), after = ok(rested, 'heal under the oath');
    assert(after.resources.player.hp === 2 && !after.resources.player.damageEffects && rested.ok && rested.events.some(event => event.type === 'effects-cleared'), `seed ${k}: no HP under the oath of hunger, the poison still goes`);
    const into = ok(enterNode(after, 'camp-elite'), 'enter the hard battle');
    const e = new ForestEngine(); e.animationScale = 0; assert(e.startRunBattle(battleSetup(into)!), 'starts');
    assert(e.state.player.energy === Math.min(7, into.resources.player.energy + 2), `seed ${k}: the oath adds 2 energy at the start of the battle`);
  }
  // Фляга росы: a rest after the hard battle heals 1 more (generated maps where a rest follows a hard battle).
  let flasks = 0;
  for (let k = 1; k <= 400 && flasks < 3; k++) {
    const seed = spread(k), map = forestRunMap(createForestRun(seed, { map: 'generated' }));
    const hard = map.nodes.find(node => node.type === 'hard' && node.next.some(id => map.node(id)?.type === 'rest'));
    if (!hard) continue;
    let run = walkGeneratedTo(seed, hard.id);
    if (!offerOf(run).includes('dew-flask')) continue;
    flasks++;
    const rest = hard.next.find(id => map.node(id)?.type === 'rest')!;
    const withFlask = ok(enterNode(ok(chooseTalisman(run, 'dew-flask'), 'take the flask'), rest), 'enter the rest');
    const without = ok(enterNode(ok(chooseTalisman(run, null), 'refuse'), rest), 'enter the rest');
    const base = (map.node(rest)!.content as { heal: number }).heal;
    assert(restView(withFlask)!.heal.value === base + DEW_FLASK_HEAL && restView(without)!.heal.value === base, `seed ${k}: the flask heals ${base + DEW_FLASK_HEAL} instead of ${base}`);
    const wound = (state: ForestRunState) => ({ ...state, resources: { ...state.resources, player: { ...state.resources.player, hp: 1 } } });
    assert(ok(restHeal(wound(withFlask)), 'heal').resources.player.hp === 1 + base + DEW_FLASK_HEAL, `seed ${k}: the flask's heal is applied`);
    run = withFlask; sameAfterReload(run, `seed ${k}: the open rest with the flask`);
  }
  assert(flasks === 3, `three generated seeds offered the flask before a rest (${flasks})`);
  console.log('PASS effects: the hide (+1 max HP, +1 HP, next battle), oath energy +1, the oath of hunger (rest heals 0, effects cleared), the dew flask (+1 at a rest)');
}
/** Walk a generated map to the won battle of `target` (its choice open), entering only nodes from which it is reachable. */
function walkGeneratedTo(seed: number, target: string): ForestRunState {
  let run = createForestRun(seed, { map: 'generated' });
  const map = forestRunMap(run), reach = new Map<string, boolean>();
  const reaches = (id: string): boolean => {
    if (id === target) return true;
    if (!reach.has(id)) reach.set(id, map.node(id)!.next.some(reaches));
    return reach.get(id)!;
  };
  for (let guard = 0; guard < 40; guard++) {
    if (run.pending?.kind === 'battle') run = ok(resolveBattle(run, quickWin(run)), 'resolve');
    if (run.pending?.kind === 'talisman' && run.pending.nodeId === target) return run;
    if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), 'refuse');
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), 'find');
    if (run.pending?.kind === 'rest') run = ok(restHeal(run), 'heal');
    if (run.pending?.kind === 'event') run = skipEvent(run);
    if (run.pending?.kind === 'shop') run = ok(shopLeave(run), 'leave the merchant');
    if (!run.pending) run = ok(enterNode(run, availableNodes(run).find(node => reaches(node.id))!.id), 'enter');
  }
  throw new Error(`${seed}: ${target} not reached`);
}

// A test arena for the node battle after the ward is taken: `hp` porcupines around the cat, all of them targets. A chain
// through all of them takes `hp` quills — lethal at the last one — and kills the last target: the battle is won.
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
const RING = [11, 6, 7, 8, 13, 18, 17, 16];
function wardArena(hp: number): string {
  const id = `spec-run-ward-${hp}`, tiles = '#'.repeat(25).split('');
  tiles[12] = 'H'; RING.slice(0, hp).forEach(index => { tiles[index] = 'P'; });
  const rows = Array.from({ length: 5 }, (_, row) => tiles.slice(row * 5, row * 5 + 5).join(''));
  registry[id] = authoredLesson({ id, name: id, description: '', hint: '', seed: 9100, rows, legend: { P: { color: 0, variant: 'porcupine', hp: 0, target: true } } });
  return id;
}

/** The Ash ward: passed while whole, crumbles after saving the cat and is never passed again. */
async function ward() {
  let wards = 0;
  for (let k = 1; k <= 200 && wards < 3; k++) {
    const seed = spread(k), run = walk(seed, TO_CAMP_ELITE);
    if (!offerOf(run).includes('ash-ward')) continue;
    wards++;
    let held = ok(enterNode(ok(chooseTalisman(run, 'ash-ward'), 'take the ward'), 'camp-breakthrough'), 'enter the breakthrough');
    const setup = battleSetup(held)!;
    assert(setup.wardReady === true && setup.talismans?.includes('ash-ward'), `seed ${k}: the whole ward goes into the battle`);
    // The node battle is played in the arena (same node, same run setup): a real lethal chain of quills.
    const hp = setup.player.hp, e = new ForestEngine(); e.animationScale = 0;
    assert(e.startRunBattle({ ...setup, template: { kind: 'battle', id: wardArena(hp) } }) && e.state.player.ward, `seed ${k}: the arena starts with the ward`);
    const path = RING.slice(0, hp), before = json(e.captureAnalysisSnapshot()), preview = e.preview(path);
    assert(json(e.captureAnalysisSnapshot()) === before, `seed ${k}: the forecast spends nothing`);
    assert(preview.valid && preview.wardSaves && !preview.playerDies && preview.completesRoom && preview.damage === hp - 1, `seed ${k}: forecast — lethal, the ward saves, the battle is won`);
    assert(e.beginChain(path[0]), 'begin'); for (const index of path.slice(1)) assert(e.extendChain(index), 'extend');
    assert(await e.releaseChain(), 'release');
    assert(e.state.phase === 'WIN' && e.state.player.hp === 1 && !e.state.player.ward, `seed ${k}: the cat wins with 1 HP, the ward is gone`);
    const step = resolveBattle(held, e.runBattleOutcome()!);
    held = ok(step, 'resolve');
    assert(held.wardSpent === true && step.ok && step.events.some(event => event.type === 'ward-crumbled'), `seed ${k}: the run marks the ward crumbled`);
    sameAfterReload(held, `seed ${k}: a run with the crumbled ward`);
    assert(forge(held, value => { value.talismans = value.talismans.filter((id: string) => id !== 'ash-ward'); }) === null, `seed ${k}: a crumbled ward without the ward is rejected`);
    held = ok(enterNode(held, 'camp-chief'), 'enter the Chief');
    const next = battleSetup(held)!;
    assert(!next.wardReady && next.talismans?.includes('ash-ward'), `seed ${k}: the crumbled ward is not passed again (the badge stays)`);
    const chief = new ForestEngine(); chief.animationScale = 0; assert(chief.startRunBattle(next), 'the Chief starts');
    assert(!chief.state.player.ward, `seed ${k}: the next battle has no ward`);
  }
  assert(wards === 3, 'three seeds offered the ward');
  console.log('PASS Ash ward: passed while whole, saves the cat once in a real chain as forecast, crumbles in the run and is not passed again');
}

/** Saves: open choices and choices made reload unchanged; forged choices, pools and fields are rejected; old saves load. */
function saves() {
  for (let k = 1; k <= 8; k++) {
    const seed = spread(k), run = walk(seed, TO_CAMP_ELITE, { oath: run => offerOf(run)[k % 3] });
    const options = offerOf(run), other = TALISMANS.find(entry => !isOath(entry.id) && !options.includes(entry.id) && !run.talismans.some(id => talismansClash(id, entry.id)))!.id;
    sameAfterReload(run, `seed ${k}: open choice after an oath`);
    assert(forge(run, value => { value.pending.options[0] = other; }) === null, `seed ${k}: a forged offer is rejected`);
    assert(forge(run, value => { value.talismanChoices[0].chosen = 'whetstone'; }) === null, `seed ${k}: an oath choice outside the offer is rejected`);
    assert(forge(run, value => { value.talismans = []; }) === null, `seed ${k}: dropping a taken oath is rejected`);
    const taken = ok(chooseTalisman(run, options[0]), 'take');
    sameAfterReload(taken, `seed ${k}: a talisman taken`);
    assert(forge(taken, value => { value.talismans[1] = other; value.talismanChoices[1].chosen = other; }) === null, `seed ${k}: a talisman outside the offer is rejected`);
    assert(forge(taken, value => { value.talismansGone = []; }) === null, `seed ${k}: refused talismans cannot return to the pool`);
    assert(forge(taken, value => { value.talismanChoices.pop(); }) === null, `seed ${k}: a hard battle without its choice is rejected`);
    assert(forge(taken, value => { value.wardSpent = true; }) === null || taken.talismans.includes('ash-ward'), `seed ${k}: a crumbled ward without the ward is rejected`);
    assert(forge(taken, value => { value.legacyRewardsUntil = value.visited.length + 3; }) === null, `seed ${k}: old rewards past the visited nodes are rejected`);
    assert(forge(taken, value => { value.talismans.push('ash-ward'); }) === null, `seed ${k}: an extra talisman is rejected`);
  }
  // A save from before the talismans: a hard battle with its find open, the Jailer passed without an oath.
  const seed = spread(5), before = walk(seed, TO_CAMP_ELITE), old = JSON.parse(serializeForestRun(before));
  // Saves before the talismans came before the long streams too (runStreams.ts): node-seeded rolls.
  delete old.talismans; delete old.talismansGone; delete old.talismanChoices; delete old.streams;
  old.pending = { kind: 'find', nodeId: 'camp-elite', options: rewardChoices(forestNodeSeed(seed, 'camp-elite'), 1).map(option => option.item) };
  let legacy = parseForestRun(JSON.stringify(old));
  assert(legacy && legacy.legacyRewardsUntil === legacy.visited.length + 1 && legacy.talismans.length === 0, 'an old save with an open hard-battle find loads');
  legacy = ok(chooseFindItem(legacy, (legacy.pending as { options: ItemKind[] }).options[0]), 'the old find is taken');
  sameAfterReload(legacy, 'the old run after its find');
  const breakthrough = ok(enterNode(legacy, 'camp-breakthrough'), 'the old run goes on');
  assert(battleSetup(breakthrough)!.talismans === undefined, 'the old run has no talismans');
  // An old save whose open battle is a hard one: the victory now offers talismans.
  const oldBattle = JSON.parse(serializeForestRun(ok(enterNode(ok(restHeal(walk(seed, TO_CAMP_ELITE.slice(0, -1))), 'heal'), 'camp-elite'), 'enter')));
  delete oldBattle.talismans; delete oldBattle.talismansGone; delete oldBattle.talismanChoices; delete oldBattle.streams;
  const loaded = parseForestRun(JSON.stringify(oldBattle))!;
  assert(loaded && !loaded.legacyRewardsUntil || loaded.legacyRewardsUntil! <= loaded.visited.length, 'an old open battle keeps no old reward');
  const won = ok(resolveBattle(loaded, quickWin(loaded)), 'win the old open hard battle');
  assert(won.pending?.kind === 'talisman' && json(roundTrip(won)) === json(won), 'its victory offers talismans and saves');
  console.log('PASS saves: open and made choices reload; forged offers, choices, pools, maximum HP and old-reward ranges are rejected; old saves load and go on');
}

/** The same seed and choices give the same offers and run. */
function replay() {
  for (let k = 1; k <= 5; k++) {
    const a = walk(spread(k), TO_CAMP_ELITE, { oath: run => offerOf(run)[0] }), b = walk(spread(k), TO_CAMP_ELITE, { oath: run => offerOf(run)[0] });
    assert(json(a) === json(b), `seed ${k}: same seed and choices — same run and offer`);
  }
  const offers = new Set(Array.from({ length: 40 }, (_, k) => json(offerOf(walk(spread(k + 1), TO_CAMP_ELITE)))));
  assert(offers.size > 20, `offers differ between seeds (${offers.size} of 40)`);
  console.log('PASS replay: same seed and choices give the same offers; offers vary by seed');
}

sources();
rarities();
pool();
effects();
await ward();
saves();
replay();
console.log('PASS run talismans');
