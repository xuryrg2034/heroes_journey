import { ForestEngine } from './forestEngine';
import { forestNode } from './run/forestMap';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, createForestRun, enterNode, eventResourceKinds, eventOutcomeIndex, eventView, forestRunView,
  parseForestRun, resolveBattle, restCraft, restFinish, restHeal, restView, serializeForestRun, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { forestEvent } from './run/forestEvents';
import { CRAFT_COST, emptyMaterials, RESOURCE_KINDS, RESOURCES } from './resources';
import type { ItemKind, ResourceKind } from './forestTypes';

// Rest: heal or craft (decision of 04.10.2026, docs/roguelike-runs.md, section 5; docs/biomes/forest-map.md, «Привал»).
// Runs are walked with the pure run model; battles start in the real engine and end with its debug win. Resources a
// battle picks up (elite loot, the exit chest) are left in the engine's battle materials before the win, as a real
// battle could leave them; the event route gets them from the real «Гоблинский тайник». Seeds are spread with
// Math.imul(k, 2654435761).

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return (step as { run: ForestRunState }).run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const sameAfterReload = (run: ForestRunState, what: string) => assert(json(roundTrip(run)) === json(run), `${what}: survives a save and reload unchanged`);
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };

const TRUNK = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4'];
/** Goblin route without a find (no item chosen on the way), to the camp rest before the hard battle. */
const TO_CAMP_REST = [...TRUNK, 'goblin-archer', 'goblin-shield', 'goblin-shaman', 'trail-banners', 'jailer', 'camp-battle', 'camp-rest'];

/**
 * Walk the ids. Battles start in the engine and are won; `loot` resources are left in the battle's materials of the
 * named node before the win (`hp` sets the cat's HP the same way). Rests on the way heal; the last id is entered only.
 */
function walk(seed: number, ids: string[], options: { loot?: Record<string, Partial<Record<ResourceKind, number>>>; hp?: number; poison?: boolean } = {}): ForestRunState {
  let run = createForestRun(seed);
  ids.forEach((id, n) => {
    run = ok(enterNode(run, id), `enter ${id}`);
    if (run.pending?.kind === 'battle') {
      const e = new ForestEngine(); e.animationScale = 0;
      assert(e.startRunBattle(battleSetup(run)!), `${id} starts`);
      const loot = options.loot?.[id];
      if (loot) e.state.materials = { ...emptyMaterials(), ...e.state.materials, ...loot };
      if (options.hp !== undefined) e.state.player.hp = options.hp;
      if (options.poison) e.state.player.damageEffects = { burning: 0, burningTurns: 0, poison: 2, bleeding: 0, bleedingSteps: 0 };
      e.winLevel(); run = ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${id}`);
    }
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `find at ${id}`);
    if (run.pending?.kind === 'rest' && n < ids.length - 1) run = ok(restHeal(run), `heal at ${id}`);
  });
  return run;
}

/** «Лечение»: +2 HP up to the maximum, effects cleared, the rest completes; the resources stay. */
function heal() {
  for (let k = 1; k <= 4; k++) {
    const hp = [1, 2, 4, 5][k - 1], seed = spread(k);
    const run = walk(seed, TO_CAMP_REST, { hp, poison: true, loot: { 'camp-battle': { dew: 3 } } });
    assert(run.pending?.kind === 'rest' && run.currentNodeId === 'camp-battle' && !availableNodes(run).length, `seed ${k}: the rest waits for a choice`);
    assert(run.resources.player.hp === hp && (run.resources.player.damageEffects?.poison ?? 0) > 0, `seed ${k}: entering the rest heals nothing yet`);
    sameAfterReload(run, `seed ${k}: the open rest`);
    const view = restView(run)!, expected = Math.min(5, hp + 2);
    assert(view.heal.available && view.heal.amount === expected - hp && view.heal.value === 2 && view.heal.clearsEffects, `seed ${k}: the heal offers +${expected - hp}`);
    const step = restHeal(run), healed = ok(step, `seed ${k}: heal`);
    assert(healed.resources.player.hp === expected && !healed.resources.player.damageEffects, `seed ${k}: ${hp} → ${expected} HP, poison removed`);
    assert(step.ok && step.events.some(event => event.type === 'effects-cleared') && step.events.some(event => event.type === 'rest-completed' && event.choice === 'heal' && event.healed === expected - hp), `seed ${k}: heal events`);
    assert(healed.pending === null && healed.currentNodeId === 'camp-rest' && json(availableNodes(healed).map(node => node.id)) === json(['camp-elite']), `seed ${k}: healing completes the rest`);
    assert(healed.resources.materials?.dew === 3 && json(healed.resources.inventory) === json(run.resources.inventory), `seed ${k}: healing keeps resources and items`);
    assert(json(healed.rests) === json([{ nodeId: 'camp-rest', choice: 'heal', crafted: [] }]), `seed ${k}: the rest is recorded as a heal`);
    assert(!restCraft(healed, 'dew').ok && !restHeal(healed).ok, `seed ${k}: nothing more at a completed rest`);
    sameAfterReload(healed, `seed ${k}: after the heal`);
  }
  console.log('PASS heal: +2 HP up to the maximum, effects cleared, the rest completes, resources kept (4 seeds)');
}

/** Each recipe: two of a resource become one item; HP and effects untouched; «К карте» completes the rest. */
function eachRecipe() {
  for (let k = 5; k <= 8; k++) {
    const seed = spread(k);
    let run = walk(seed, TO_CAMP_REST, { hp: 3, poison: true, loot: { 'camp-battle': { dew: 2, powder: 2, resin: 2, herbs: 2 } } });
    const before = structuredClone(run.resources);
    for (const resource of RESOURCE_KINDS) {
      const item = RESOURCES[resource].crafts, have = run.resources.inventory[item];
      const step = restCraft(run, resource);
      run = ok(step, `seed ${k}: craft ${resource}`);
      assert(run.resources.materials![resource] === 0 && run.resources.inventory[item] === have + 1, `seed ${k}: ${CRAFT_COST} ${resource} → +1 ${item}`);
      assert(step.ok && step.events.some(event => event.type === 'rest-crafted' && event.resource === resource && event.item === item), `seed ${k}: craft event for ${item}`);
      assert(run.pending?.kind === 'rest', `seed ${k}: the rest stays open while crafting`);
      sameAfterReload(run, `seed ${k}: after crafting ${item}`);
    }
    assert(json(run.resources.inventory) === json({ frost: before.inventory.frost + 1, bomb: before.inventory.bomb + 1, healing: before.inventory.healing + 1, fire: before.inventory.fire + 1 }), `seed ${k}: one of each item`);
    assert(run.resources.player.hp === 3 && (run.resources.player.damageEffects?.poison ?? 0) > 0, `seed ${k}: crafting neither heals nor clears effects`);
    assert(restView(run)!.recipes.every(recipe => !recipe.available && recipe.have === 0), `seed ${k}: no recipe left`);
    const done = restFinish(run); run = ok(done, `seed ${k}: leave the rest`);
    assert(run.pending === null && run.currentNodeId === 'camp-rest' && json(run.rests[run.rests.length - 1]) === json({ nodeId: 'camp-rest', choice: 'craft', crafted: ['frost', 'bomb', 'fire', 'healing'] }), `seed ${k}: the rest is recorded with its crafts`);
    assert(done.ok && done.events.some(event => event.type === 'rest-completed' && event.choice === 'craft' && event.crafted.length === 4), `seed ${k}: completion event`);
    sameAfterReload(run, `seed ${k}: after the crafting rest`);
  }
  console.log('PASS each recipe: dew → frost, powder → bomb, resin → fire, herbs → healing (4 seeds)');
}

/** Several recipes at one rest, a resource running short, and the heal gone after the first craft. */
function severalShortAndNoHeal() {
  for (let k = 9; k <= 12; k++) {
    const seed = spread(k);
    let run = walk(seed, TO_CAMP_REST, { hp: 2, loot: { 'camp-battle': { dew: 5, resin: 1 } } });
    // Short of a resource: nothing changes, the reason names the shortage.
    const short = restCraft(run, 'resin');
    assert(!short.ok && /Смола/.test(short.reason) && /есть 1/.test(short.reason), `seed ${k}: one resin is not enough (${short.ok ? '' : short.reason})`);
    assert(!restCraft(run, 'powder').ok, `seed ${k}: no powder, no bomb`);
    assert(!restFinish(run).ok && restView(run)!.heal.available, `seed ${k}: the rest cannot be left without a choice; the heal is still there`);
    run = ok(restCraft(run, 'dew'), `seed ${k}: first frost`);
    // Crafting cancels the heal of this rest.
    const view = restView(run)!;
    assert(!view.heal.available && view.canFinish, `seed ${k}: after a craft the heal is gone`);
    const noHeal = restHeal(run);
    assert(!noHeal.ok && run.resources.player.hp === 2, `seed ${k}: heal refused after crafting`);
    run = ok(restCraft(run, 'dew'), `seed ${k}: second frost`);
    assert(run.resources.materials!.dew === 1 && !restView(run)!.recipes.find(recipe => recipe.resource === 'dew')!.available, `seed ${k}: one dew left`);
    assert(!restCraft(run, 'dew').ok, `seed ${k}: the third frost is refused`);
    run = ok(restFinish(run), `seed ${k}: leave`);
    assert(run.resources.player.hp === 2 && json(run.rests[run.rests.length - 1].crafted) === json(['frost', 'frost']) && run.resources.materials!.resin === 1, `seed ${k}: two frosts, no heal`);
    sameAfterReload(run, `seed ${k}: two crafts at one rest`);
  }
  console.log('PASS several recipes at one rest; a short resource is refused; crafting cancels the heal (4 seeds)');
}

/** A craft of a closed consumable opens it for the run: the next battle allows it and the engine uses it. */
async function opensClosedItem() {
  let checked = 0;
  for (let k = 13; k <= 18; k++) {
    const seed = spread(k);
    const run = walk(seed, TO_CAMP_REST, { loot: { 'camp-battle': { dew: 2, powder: 2, resin: 2, herbs: 2 } } });
    const closed = RESOURCE_KINDS.find(resource => !run.tools.items.includes(RESOURCES[resource].crafts));
    assert(closed, `seed ${k}: the goblin route without a find keeps some consumable closed`);
    const item = RESOURCES[closed!].crafts;
    assert(restView(run)!.recipes.find(recipe => recipe.resource === closed)!.opens, `seed ${k}: the recipe says it opens ${item}`);
    // Control: a heal keeps it closed, and the hard battle does not allow it.
    const healed = ok(enterNode(ok(restHeal(run), 'heal'), 'camp-elite'), 'enter the hard battle after a heal');
    assert(!healed.tools.items.includes(item) && !battleSetup(healed)!.allowedItems.includes(item), `seed ${k}: without the craft ${item} stays closed`);
    const step = restCraft(run, closed!), crafted = ok(step, `craft ${item}`);
    assert(step.ok && step.events.some(event => event.type === 'tools-unlocked' && event.items.includes(item)) && crafted.tools.items.includes(item), `seed ${k}: crafting ${item} opens it`);
    sameAfterReload(crafted, `seed ${k}: the opened item`);
    const next = ok(enterNode(ok(restFinish(crafted), 'leave'), 'camp-elite'), 'enter the hard battle');
    sameAfterReload(next, `seed ${k}: the battle after the craft`);
    const setup = battleSetup(next)!;
    assert(setup.allowedItems.includes(item) && setup.inventory[item] === crafted.resources.inventory[item], `seed ${k}: the next battle allows ${item} and carries it`);
    const e = new ForestEngine(); e.animationScale = 0;
    assert(e.startRunBattle(setup), `seed ${k}: the hard battle starts`);
    const target = e.state.board.findIndex((_cell, index) => e.previewItem(item, index).valid);
    assert(target >= 0, `seed ${k}: ${item} is usable in the next battle`);
    const count = e.state.inventory[item];
    assert(await e.useItem(item, target) && e.state.inventory[item] === count - 1, `seed ${k}: the crafted ${item} is really used`);
    checked++;
  }
  console.log(`PASS crafting a closed consumable opens it; the next battle allows and uses it (${checked} seeds)`);
}

/** Resources from a real event: the goblin cache gives two of a kind on some seeds; the camp rest crafts them. */
function eventResources() {
  const option = forestEvent('goblin-cache')!.options.find(entry => entry.id === 'break')!;
  let found = 0;
  for (let k = 1; k <= 400 && found < 3; k++) {
    const seed = spread(k);
    const kinds = eventResourceKinds(seed, 'trail-cache', option);
    if (eventOutcomeIndex(seed, 'trail-cache', option) !== 0 || kinds[0] !== kinds[1]) continue;
    let run = walk(seed, [...TRUNK, 'goblin-archer', 'goblin-shield', 'goblin-shaman', 'trail-cache']);
    assert(eventView(run)!.options.some(entry => entry.id === 'break' && entry.available), `seed ${k}: the cache can be broken`);
    run = ok(chooseEventOption(run, 'break'), `seed ${k}: break the cache`);
    assert(run.resources.materials?.[kinds[0]] === 2, `seed ${k}: two ${kinds[0]} from the cache`);
    for (const id of ['jailer', 'camp-battle', 'camp-rest']) {
      run = ok(enterNode(run, id), `enter ${id}`);
      if (run.pending?.kind === 'battle') { const e = new ForestEngine(); e.animationScale = 0; e.startRunBattle(battleSetup(run)!); e.winLevel(); run = ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${id}`); }
    }
    const item = RESOURCES[kinds[0]].crafts, have = run.resources.inventory[item];
    run = ok(restFinish(ok(restCraft(run, kinds[0]), 'craft from the cache')), 'leave');
    assert(run.resources.inventory[item] === have + 1 && run.resources.materials![kinds[0]] === 0, `seed ${k}: the cache's ${kinds[0]} became ${item}`);
    sameAfterReload(run, `seed ${k}: the event-resource craft`);
    found++;
  }
  assert(found === 3, `three spread seeds where the cache gives two of a kind (found ${found})`);
  console.log('PASS resources from the goblin cache are crafted at the camp rest (3 seeds)');
}

/** A reload offers the same open rest with the same crafts; forged saves are rejected; old saves load. */
function saves() {
  const seed = spread(21);
  const open = walk(seed, TO_CAMP_REST, { hp: 2, loot: { 'camp-battle': { dew: 4, powder: 2 } } });
  const crafting = ok(restCraft(open, 'dew'), 'craft frost');
  const reloaded = roundTrip(crafting)!;
  assert(reloaded && reloaded.pending?.kind === 'rest' && json(restView(reloaded)) === json(restView(crafting)), 'the reloaded rest is the same: crafts, stock, no heal');
  assert(!restHeal(reloaded).ok && ok(restCraft(reloaded, 'dew'), 'craft after reload').resources.inventory.frost === crafting.resources.inventory.frost + 1, 'after a reload the rest goes on crafting');
  assert(forestRunView(reloaded).nodes.find(entry => entry.node.id === 'camp-rest')?.status === 'in-progress', 'the map shows the open rest');
  const done = ok(restFinish(ok(restCraft(crafting, 'powder'), 'craft bomb')), 'leave');
  sameAfterReload(done, 'the completed crafting rest');

  // Forged saves.
  assert(forge(crafting, v => { v.pending.crafted.push('frost'); v.resources.inventory.frost++; }) === null, 'an open rest crafting more than its resources is rejected');
  assert(forge(crafting, v => { v.resources.materials.dew += CRAFT_COST; }) === null, 'resources not spent on a craft are rejected');
  assert(forge(crafting, v => { v.pending.crafted = []; v.resources.materials.dew += CRAFT_COST; }) === null, 'an item without its craft is rejected');
  assert(forge(crafting, v => { v.pending.extra = 1; }) === null, 'a malformed open rest is rejected');
  assert(forge(crafting, v => { v.pending.crafted = ['axe']; }) === null, 'an unknown crafted item is rejected');
  assert(forge(done, v => { v.rests.pop(); }) === null, 'a crafting rest dropped from the record is rejected');
  assert(forge(done, v => { v.rests[v.rests.length - 1].choice = 'heal'; }) === null, 'a heal with crafted items is rejected');
  assert(forge(done, v => { v.rests[v.rests.length - 1].crafted.push('bomb'); v.resources.inventory.bomb++; }) === null, 'a craft over the gained powder is rejected');
  assert(forge(done, v => { delete v.rests; }) === null, 'dropping the rest records of a crafting run is rejected');
  // A craft at the trail rest from resources gained later at the camp battle.
  const early = walk(seed, [...TRUNK, 'goblin-archer', 'trail-rest'], {});
  const late = walk(seed, [...TRUNK, 'goblin-archer', 'trail-rest', 'goblin-shaman', 'trail-banners', 'jailer', 'camp-battle'], { loot: { 'camp-battle': { dew: 2 } } });
  assert(early.pending?.kind === 'rest' && late.rests[0].nodeId === 'trail-rest', 'the early-craft forgery has its rest');
  assert(forge(late, v => { v.rests[0] = { nodeId: 'trail-rest', choice: 'craft', crafted: ['frost'] }; v.resources.materials.dew -= CRAFT_COST; v.resources.inventory.frost++; }) === null,
    'a craft from resources gained after the rest is rejected');
  // Old saves: a rest healed on entering, no `rests` field.
  const old = forge(late, v => { delete v.rests; });
  assert(old && json(old.rests) === json([{ nodeId: 'trail-rest', choice: 'heal', crafted: [] }]), 'an old save loads; its rest reads as a heal');
  assert(ok(enterNode(old!, 'camp-rest'), 'the old run goes on').pending?.kind === 'rest', 'the old run meets the new rest');
  console.log('PASS saves: the open rest reloads with its crafts; forged crafts are rejected; old saves load');
}

/**
 * Generated maps: a craft that opens an item changes the tools the next pool battle is picked with; the save check
 * replays it. A bot heads for a rest, crafts a closed item there and plays on, saving after every step.
 */
function generatedMaps() {
  let opened = 0;
  for (let k = 40; k <= 60 && opened < 4; k++) {
    const seed = spread(k);
    let run = createForestRun(seed, { map: 'generated', skipTrunk: true }), item: ItemKind | null = null, after = 0;
    for (let step = 0; step < 40 && !run.result && after < 3; step++) {
      sameAfterReload(run, `generated ${k}: step ${step}`);
      if (run.pending?.kind === 'battle') {
        const e = new ForestEngine(); e.animationScale = 0;
        const setup = battleSetup(run)!;
        assert(e.startRunBattle(setup), `generated ${k}: ${setup.nodeId} starts`);
        if (item) { assert(setup.allowedItems.includes(item), `generated ${k}: ${setup.nodeId} allows the crafted ${item}`); after++; }
        if (!run.resources.materials) e.state.materials = { dew: 2, powder: 2, resin: 2, herbs: 2 };
        e.winLevel(); run = ok(resolveBattle(run, e.runBattleOutcome()!), `generated ${k}: resolve`);
      } else if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `generated ${k}: find`);
      else if (run.pending?.kind === 'event') run = ok(chooseEventOption(run, eventView(run)!.options.find(option => option.available)!.id), `generated ${k}: event`);
      else if (run.pending?.kind === 'rest') {
        const recipe = restView(run)!.recipes.find(entry => entry.available && entry.opens);
        if (recipe && !item) { item = recipe.item; run = ok(restFinish(ok(restCraft(run, recipe.resource), `generated ${k}: craft`)), `generated ${k}: leave`); }
        else run = ok(restHeal(run), `generated ${k}: heal`);
      } else {
        const next = availableNodes(run);
        run = ok(enterNode(run, (next.find(node => node.type === 'rest' && !item) ?? next[0]).id), `generated ${k}: enter`);
      }
    }
    if (item && after) opened++;
  }
  assert(opened >= 3, `generated maps: a crafted item opened and allowed in later pool battles (${opened} seeds)`);
  console.log(`PASS generated maps: an item opened by crafting is allowed in later pool battles and the run saves at every step (${opened} seeds)`);
}

/** Same seed, same choices — the same run, also through a save in the middle. */
function determinism() {
  const play = (reload: boolean) => {
    let run = walk(spread(30), TO_CAMP_REST, { loot: { 'camp-battle': { herbs: 4, resin: 3 } } });
    for (const resource of ['herbs', 'resin', 'herbs'] as ResourceKind[]) { run = ok(restCraft(run, resource), `craft ${resource}`); if (reload) run = roundTrip(run)!; }
    return serializeForestRun(ok(restFinish(run), 'leave'));
  };
  assert(play(false) === play(true), 'crafting is deterministic and save-independent');
  console.log('PASS same choices give the same run, with or without reloads');
}

assert(forestNode('camp-rest')?.type === 'rest' && CRAFT_COST === 2, 'the camp rest exists; a recipe takes two');
heal();
eachRecipe();
severalShortAndNoHeal();
await opensClosedItem();
eventResources();
saves();
generatedMaps();
determinism();
console.log('Rest craft checks passed.');
