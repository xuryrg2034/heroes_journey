/**
 * The start gift (docs/roguelike-runs.md, 2а; runGift.ts): through real run commands on generated maps, the player
 * profile store and real battles in the engine (ended with its debug win: this suite checks the run, not a bot). Seeds
 * are spread with Math.imul(k, 2654435761).
 *
 * - full or mini by the profile mark «the previous run reached the Jailer», set at the end of every run; an entered seed
 *   always gets the full gift and leaves the mark alone; without storage the game plays the mini gift;
 * - the gift waits before the row-5 nodes (at once past the trunk, after the trunk's last battle otherwise);
 * - every button does what it says, through the next battles, rests and the save;
 * - a price never cancels a reward of the same currency; «Ловкие лапы» never come while the jump is closed;
 * - a reload restores the same gift (also the open own choice of a button); forged gifts are rejected.
 */
import { ForestEngine } from './forestEngine';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseGift, chooseGiftPick, chooseTalisman, createForestRun, enterNode, eventView, forestRunMap, giftView,
  parseForestRun, resolveBattle, restHeal, restView, runReachedJailer, serializeForestRun, shopLeave, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { GIFT_CALM_BATTLES, rollGift, type GiftOption, type GiftOptionKind } from './run/runGift';
import { createPlayerProfileStore, PLAYER_PROFILE_KEY } from './run/playerProfile';
import type { RunStorage } from './run/forestRunStorage';
import { angryOrdinaryCount, runPressureInfo } from './mapBattleRules';
import { TALISMANS, talisman, type TalismanId } from './talismans';
import type { RunBattleSetup } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };
const memory = (): RunStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
};
const fullRun = (seed: number) => createForestRun(seed, { map: 'generated', skipTrunk: true, gift: 'full' });

/** Win the open battle in the engine (the cat keeps its HP and energy). */
function winBattle(run: ForestRunState): ForestRunState {
  const e = new ForestEngine(); e.animationScale = 0;
  assert(e.startRunBattle(battleSetup(run)!), `${run.pending?.nodeId} starts`);
  e.winLevel();
  return ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${run.pending?.nodeId}`);
}
/** Lose the open battle in the engine: the run ends there. */
function loseBattle(run: ForestRunState): ForestRunState {
  const e = new ForestEngine(); e.animationScale = 0;
  assert(e.startRunBattle(battleSetup(run)!), `${run.pending?.nodeId} starts`);
  e.state.player.hp = 0; e.state.phase = 'LOSE';
  return ok(resolveBattle(run, e.runBattleOutcome()!), `lose ${run.pending?.nodeId}`);
}
/** Finish whatever is open past the gift: battles won, finds the first, talismans refused, rests healed, events the first option. */
function settle(run: ForestRunState): ForestRunState {
  for (let guard = 0; run.pending && guard < 10; guard++) {
    const pending = run.pending;
    if (pending.kind === 'battle') run = winBattle(run);
    else if (pending.kind === 'find') run = ok(chooseFindItem(run, pending.options[0]), 'find');
    else if (pending.kind === 'talisman') run = ok(chooseTalisman(run, null), 'refuse');
    else if (pending.kind === 'rest') run = ok(restHeal(run), 'rest');
    else if (pending.kind === 'event') run = ok(chooseEventOption(run, eventView(run)!.options.find(option => option.available)!.id), 'event');
    else if (pending.kind === 'shop') run = ok(shopLeave(run), 'leave');
    else throw new Error(`unexpected ${pending.kind}`);
  }
  return run;
}
/** Take the gift button of `kind` (and the first of its own choice). */
function take(run: ForestRunState, kind: GiftOptionKind, pick?: (picks: string[]) => string): ForestRunState {
  const index = run.gift!.options.findIndex(option => option.kind === kind);
  assert(index >= 0, `the gift has ${kind}`);
  let next = ok(chooseGift(run, index), `take ${kind}`);
  if (next.pending?.kind === 'gift') next = ok(chooseGiftPick(next, (pick ?? (picks => picks[0]))(giftView(next)!.picks)), `pick for ${kind}`);
  return next;
}
/** Seeds whose full gift has a button matching `test`. */
function seedsWith(test: (options: GiftOption[]) => boolean, count: number): number[] {
  const found: number[] = [];
  for (let k = 1; found.length < count && k < 2000; k++) if (test(fullRun(spread(k)).gift!.options)) found.push(spread(k));
  assert(found.length === count, `found ${count} seeds (${found.length})`);
  return found;
}
/**
 * Walk until `test` holds after entering a node, settling everything else on the way; `toward` (a node type) steers to
 * an available node from which a node of that type can still be reached.
 */
function walkTo(run: ForestRunState, test: (run: ForestRunState) => boolean, toward?: string, limit = 30): ForestRunState {
  const map = forestRunMap(run), memo = new Map<string, boolean>();
  const reaches = (id: string): boolean => {
    if (!memo.has(id)) memo.set(id, map.node(id)!.type === toward || map.node(id)!.next.some(reaches));
    return memo.get(id)!;
  };
  for (let n = 0; n < limit && !run.result; n++) {
    const list = availableNodes(run), next = (toward && list.find(node => reaches(node.id))) || list[0];
    run = ok(enterNode(run, next.id), 'enter');
    if (test(run)) return run;
    run = settle(run);
  }
  throw new Error('target not reached');
}

/** Full or mini by the profile; set at the end of every run; an entered seed always full and leaves the mark alone. */
function profileDecides() {
  const storage = memory(), profile = createPlayerProfileStore(storage);
  assert(profile.giftKind(false) === 'mini', 'the first run gets the mini gift');
  const mini = createForestRun(spread(1), { map: 'generated', skipTrunk: true, gift: profile.giftKind(false) });
  const view = giftView(mini)!;
  assert(view.kind === 'mini' && json(view.options.map(entry => entry.option.kind)) === json(['items', 'max-hp']), 'the mini gift: two random consumables or +1 maximum HP');
  assert(!availableNodes(mini).length && !enterNode(mini, 'r5c0').ok, 'the row-5 nodes wait for the gift');
  // A run that dies on the trails (row < 9) keeps the mini gift; one that reaches the Jailer earns the full one.
  let early = ok(chooseGift(mini, 1), 'take +1 HP');
  early = loseBattle(ok(enterNode(early, availableNodes(early)[0].id), 'enter row 5'));
  assert(early.result?.outcome === 'defeat' && !runReachedJailer(early), 'the run fell before the Jailer');
  assert(profile.endRun({ reachedJailer: runReachedJailer(early), seeded: false }) && profile.giftKind(false) === 'mini', 'falling before the Jailer keeps the mini gift');
  let far = ok(chooseGift(createForestRun(spread(2), { map: 'generated', skipTrunk: true, gift: 'mini' }), 0), 'take the consumables');
  far = walkTo(far, run => run.pending?.kind === 'battle' && run.pending.nodeId === 'r9c1');
  far = loseBattle(far);
  assert(far.result?.outcome === 'defeat' && runReachedJailer(far), 'the run fell at the Jailer');
  profile.endRun({ reachedJailer: runReachedJailer(far), seeded: false });
  assert(profile.giftKind(false) === 'full' && JSON.parse(storage.data.get(PLAYER_PROFILE_KEY)!).giftFull === true, 'reaching the Jailer earns the full gift');
  // An entered seed: always full; its end changes nothing in the profile.
  assert(profile.giftKind(true) === 'full', 'an entered seed gets the full gift');
  const seeded = createForestRun(spread(3), { map: 'generated', skipTrunk: true, gift: profile.giftKind(true), seeded: true });
  assert(seeded.seeded && giftView(seeded)!.kind === 'full' && giftView(seeded)!.options.length === 4, 'the seeded run shows four buttons');
  assert(!profile.endRun({ reachedJailer: false, seeded: true }) && profile.giftKind(false) === 'full', 'a seeded run leaves the mark alone');
  profile.endRun({ reachedJailer: false, seeded: false });
  assert(profile.giftKind(false) === 'mini', 'the next unseeded run that falls early takes the full gift away again');
  // Without storage the game plays: the mini gift, nothing remembered, no error.
  const none = createPlayerProfileStore(null);
  assert(none.giftKind(false) === 'mini' && !none.endRun({ reachedJailer: true, seeded: false }) && none.giftKind(false) === 'mini', 'without storage: the mini gift every time');
  const broken = createPlayerProfileStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} });
  assert(broken.giftKind(false) === 'mini' && !broken.endRun({ reachedJailer: true, seeded: false }), 'a throwing storage: the mini gift, no error');
  console.log('PASS full or mini gift by the profile (set at every run end), an entered seed always full and leaves the mark, no storage — mini');
}

/** The gift waits after the trunk's last battle in a run that plays the trunk. */
function afterTheTrunk() {
  let run = createForestRun(spread(4), { map: 'generated', gift: 'full' });
  assert(run.pending === null && availableNodes(run).every(node => node.row === 1), 'a first run starts at the trunk, the gift waits');
  for (let n = 0; n < 4; n++) {
    assert(run.pending === null, `trunk battle ${n + 1}: no gift yet`);
    run = winBattle(ok(enterNode(run, availableNodes(run)[0].id), 'enter the trunk'));
  }
  assert(run.pending?.kind === 'gift' && !availableNodes(run).length, 'after the trunk the gift waits before row 5');
  run = take(run, run.gift!.options[0].kind);
  assert(run.pending === null && availableNodes(run).every(node => node.row === 5), 'the gift taken, the row-5 nodes open');
  console.log('PASS the gift waits after the trunk and before row 5');
}

/** Button 1: a consumable of three, two random ones, +2 energy — through the next battle. */
function consumables() {
  for (const seed of seedsWith(options => options[0].kind === 'pick-item', 3)) {
    const run = fullRun(seed), option = run.gift!.options[0] as Extract<GiftOption, { kind: 'pick-item' }>;
    let picked = ok(chooseGift(run, 0), 'pick-item');
    assert(picked.pending?.kind === 'gift' && json(giftView(picked)!.picks) === json(option.items) && option.items.length === 3 && new Set(option.items).size === 3, 'three different consumables to choose from');
    assert(json(roundTrip(picked)) === json(picked) && json(giftView(roundTrip(picked)!)) === json(giftView(picked)), 'the open choice survives a reload');
    assert(!chooseGift(picked, 1).ok && !chooseGiftPick(picked, 'nope').ok, 'no second button, no item outside the choice');
    const item = option.items[2];
    picked = ok(chooseGiftPick(picked, item), 'pick');
    const battle = ok(enterNode(picked, availableNodes(picked)[0].id), 'enter row 5');
    const setup = battleSetup(battle)!;
    assert(setup.inventory[item] >= 1 && setup.allowedItems.includes(item), `the chosen ${item} is in the next battle and opened`);
    assert(json(roundTrip(battle)) === json(battle), 'the run with the gift item saves');
  }
  for (const seed of seedsWith(options => options[0].kind === 'items', 3)) {
    const run = fullRun(seed), option = run.gift!.options[0] as Extract<GiftOption, { kind: 'items' }>;
    const after = ok(chooseGift(run, 0), 'items'), setup = battleSetup(ok(enterNode(after, availableNodes(after)[0].id), 'enter'))!;
    for (const item of option.items) assert(setup.allowedItems.includes(item) && setup.inventory[item] >= option.items.filter(entry => entry === item).length, `${item} from the gift is open and held`);
  }
  for (const seed of seedsWith(options => options[0].kind === 'energy', 3)) {
    const after = ok(chooseGift(fullRun(seed), 0), 'energy');
    assert(after.resources.player.energy === 2 && battleSetup(ok(enterNode(after, availableNodes(after)[0].id), 'enter'))!.player.energy === 2, '+2 energy reaches the next battle');
  }
  console.log('PASS button 1: a consumable of three (opened, in the next battle), two random consumables, +2 energy');
}

/** Button 2: three resources, +1 maximum HP, and the calm of the first two battles (real anger in the engine). */
async function supplies() {
  for (const seed of seedsWith(options => options[1].kind === 'resources', 3)) {
    const run = fullRun(seed), option = run.gift!.options[1] as Extract<GiftOption, { kind: 'resources' }>, after = ok(chooseGift(run, 1), 'resources');
    const total = Object.values(after.resources.materials ?? {}).reduce((sum, count) => sum + count, 0);
    assert(total === 3 && option.resources.every(kind => after.resources.materials![kind] >= 1) && json(roundTrip(after)) === json(after), 'three resources of the named kinds, saved');
    assert(forge(after, value => { value.resources.materials.dew += 1; }) === null, 'a resource over the gift is rejected');
  }
  for (const seed of seedsWith(options => options[1].kind === 'max-hp', 3)) {
    const after = ok(chooseGift(fullRun(seed), 1), 'max-hp');
    assert(after.resources.player.maxHp === 6 && after.resources.player.hp === 6 && json(roundTrip(after)) === json(after), '+1 maximum HP and +1 HP, saved');
    const setup = battleSetup(ok(enterNode(after, availableNodes(after)[0].id), 'enter'))!;
    assert(setup.player.maxHp === 6, 'the next battle starts with the new maximum');
  }
  // The calm: the first two battles past the gift get it, the third does not; in the engine no calm enemy turns angry
  // before the goals, while the same battle without it does (the pressure panel says 0 beforehand).
  let angered = 0;
  for (const seed of seedsWith(options => options[1].kind === 'calm', 6)) {
    let run = ok(chooseGift(fullRun(seed), 1), 'calm');
    const setups: RunBattleSetup[] = [];
    while (setups.length < 3) {
      run = ok(enterNode(run, availableNodes(run)[0].id), 'enter');
      if (run.pending?.kind === 'battle') { setups.push(battleSetup(run)!); assert(json(roundTrip(run)) === json(run), 'a battle with the calm saves'); }
      run = settle(run);
    }
    assert(json(setups.map(setup => setup.modifiers ?? [])) === json([['calm'], ['calm'], []]), `seed ${seed}: the calm acts on exactly ${GIFT_CALM_BATTLES} battles`);
    for (const [calm, setup] of [[true, setups[0]], [false, { ...setups[0], modifiers: undefined }]] as const) {
      const e = new ForestEngine(); e.animationScale = 0;
      assert(e.startRunBattle(setup), 'the first battle starts');
      let turned = 0;
      for (let n = 0; n < 4 && e.state.phase === 'PLAYER_INPUT' && e.state.customLevel!.goalCompletedTurn === null; n++) {
        const shown = runPressureInfo(e.state).nextAnger, before = angryOrdinaryCount(e.state.board);
        assert(await e.waitTurn(), 'rest');
        const now = angryOrdinaryCount(e.state.board);
        if (calm) assert(shown === 0 && now <= before, `seed ${seed}: with the calm no enemy turns angry before the goals (${before} → ${now}, shown ${shown})`);
        else turned += Math.max(0, now - before);
      }
      if (!calm && turned) angered++;
    }
  }
  assert(angered >= 3, `control: without the calm enemies turn angry in the same battles (${angered} of 6)`);
  console.log('PASS button 2: three resources, +1 maximum HP, the calm on the first two battles (no anger before the goals in the engine)');
}

/** Button 3: a talisman for a price — each price and reward, the pool, the rest that does not heal. */
function deals() {
  const deal = (options: GiftOption[]) => options[2] as Extract<GiftOption, { kind: 'deal' }>;
  for (const price of ['hp', 'max-hp', 'rest'] as const) for (const reward of ['pick-talisman', 'talisman'] as const) {
    for (const seed of seedsWith(options => deal(options).price === price && deal(options).reward.kind === reward, 2)) {
      const run = fullRun(seed), option = deal(run.gift!.options);
      const after = take(run, 'deal', picks => picks[1]);
      const player = after.resources.player, hide = after.talismans.includes('tough-hide') ? 1 : 0;
      if (price === 'hp') assert(player.hp === 4 + hide && player.maxHp === 5 + hide, '−1 HP now (the hide, if given, adds its point after)');
      if (price === 'max-hp') assert(player.maxHp === 4 && player.hp === 4, '−1 to the maximum HP');
      if (option.reward.kind === 'pick-talisman') {
        assert(option.reward.talismans.length === 2 && option.reward.talismans.every(id => talisman(id).rarity === 'common'), 'two common talismans to choose from');
        assert(json(after.talismans) === json([option.reward.talismans[1]]) && json(after.talismansGone) === json([option.reward.talismans[0]]), 'the chosen talisman is taken, the other leaves the pool');
      } else {
        assert(option.reward.talisman && talisman(option.reward.talisman).rarity === 'uncommon' && json(after.talismans) === json([option.reward.talisman]), 'a random uncommon talisman is taken');
      }
      assert(json(roundTrip(after)) === json(after), 'the deal saves');
      const setup = battleSetup(ok(enterNode(after, availableNodes(after)[0].id), 'enter'))!;
      assert(json(setup.talismans) === json(after.talismans), 'the talisman acts in the next battle');
      if (price === 'rest') {
        // The next rest heals nothing (effects are still cleared), the one after heals again.
        let walked = walkTo(after, next => next.pending?.kind === 'rest', 'rest');
        assert(walked.restNoHeal && restView(walked)!.heal.value === 0, 'the next rest does not heal');
        walked = ok(restHeal(walked), 'heal at the first rest');
        assert(!walked.restNoHeal && json(roundTrip(walked)) === json(walked), 'the price is paid at that rest');
        let second: ForestRunState | null = null;
        try { second = walkTo(walked, next => next.pending?.kind === 'rest', 'rest'); } catch { second = null; /* a path without a second rest */ }
        if (second) assert(restView(second)!.heal.value > 0, 'the rest after it heals again');
      }
    }
  }
  console.log('PASS button 3: each price (−1 HP, −1 maximum HP, the next rest without healing) with each reward (a common of two, a random uncommon)');
}

/** Button 4: a random oath, no choice. */
function gamble() {
  for (const seed of seedsWith(options => options[3].kind === 'oath', 4)) {
    const run = fullRun(seed), oath = (run.gift!.options[3] as Extract<GiftOption, { kind: 'oath' }>).oath!;
    const after = ok(chooseGift(run, 3), 'oath');
    assert(talisman(oath).rarity === 'oath' && json(after.talismans) === json([oath]) && after.pending === null, 'the oath is taken at once');
    const e = new ForestEngine(); e.animationScale = 0;
    assert(e.startRunBattle(battleSetup(ok(enterNode(after, availableNodes(after)[0].id), 'enter'))!) && e.state.player.energy === 2, 'the oath adds +2 energy at the start of the next battle');
  }
  console.log('PASS button 4: a random oath, taken without a choice, acts in the next battle');
}

/** The price never cancels a reward of the same currency; «Ловкие лапы» never come while the jump is closed. */
function rules() {
  let maxHpPrice = 0, pairs = 0;
  for (let k = 1; k <= 600; k++) {
    const options = fullRun(spread(k)).gift!.options, deal = options[2] as Extract<GiftOption, { kind: 'deal' }>;
    assert(json(options.map(option => option.kind).slice(2)) === json(['deal', 'oath']), 'the order: consumable, resource, deal, gamble');
    if (options[1].kind === 'max-hp') { pairs++; assert(deal.price !== 'max-hp', `seed ${k}: −1 maximum HP never comes with +1 maximum HP`); }
    if (deal.price === 'max-hp') {
      maxHpPrice++;
      const rewarded = deal.reward.kind === 'talisman' ? [deal.reward.talisman] : deal.reward.talismans;
      assert(!rewarded.includes('tough-hide'), `seed ${k}: a deal costing the maximum never gives the hide`);
    }
    const all = json(options);
    assert(!all.includes('nimble-paws'), `seed ${k}: no «Ловкие лапы» before the jump`);
  }
  assert(maxHpPrice > 50 && pairs > 100, `both sides of the rule met (${maxHpPrice} deals costing the maximum, ${pairs} gifts with +1 maximum)`);
  // The same roll with a pool where only rare talismans are left: the fallback reaches the rare ones, still never the paws
  // without the jump; with the jump open they may come.
  const lower = TALISMANS.filter(entry => entry.rarity === 'common' || entry.rarity === 'uncommon').map(entry => entry.id) as TalismanId[];
  let paws = 0;
  for (let k = 1; k <= 200; k++) {
    const closed = json(rollGift(spread(k), 'full', { taken: [], gone: lower, abilities: [] }).options);
    assert(!closed.includes('nimble-paws'), `seed ${k}: the fallback to rare talismans skips the paws without the jump`);
    if (json(rollGift(spread(k), 'full', { taken: [], gone: lower, abilities: ['jump'] }).options).includes('nimble-paws')) paws++;
  }
  assert(paws > 0, `control: with the jump open the paws can come (${paws} of 200)`);
  console.log(`PASS the price never cancels its currency (${maxHpPrice} deals for the maximum, none beside +1 maximum or the hide); no paws before the jump`);
}

/** A reload restores the same gift; forged gifts and a skipped gift are rejected. */
function saves() {
  for (let k = 1; k <= 6; k++) {
    const run = fullRun(spread(k)), loaded = roundTrip(run)!;
    assert(loaded && json(loaded) === json(run) && json(giftView(loaded)) === json(giftView(run)), `seed ${k}: the open gift reloads the same`);
    for (let index = 0; index < 4; index++) {
      const a = chooseGift(run, index), b = chooseGift(loaded, index);
      assert(json(a) === json(b), `seed ${k}: button ${index + 1} gives the same after a reload`);
    }
    assert(forge(run, value => { value.gift.options[0] = { kind: 'energy', amount: 7 }; }) === null, `seed ${k}: forged buttons are rejected`);
    assert(forge(run, value => { value.gift.kind = 'mini'; }) === null, `seed ${k}: another gift kind is rejected`);
    assert(forge(run, value => { value.gift.chosen = 9; }) === null, `seed ${k}: a button out of range is rejected`);
    assert(forge(run, value => { value.pending = null; }) === null, `seed ${k}: the gift cannot be skipped`);
    assert(forge(run, value => { delete value.gift; }) === null, `seed ${k}: an open gift without its gift is rejected`);
    const taken = ok(chooseGift(run, 1), 'take');
    if (taken.pending === null) {
      assert(forge(taken, value => { value.gift.chosen = 0; }) === null || run.gift!.options[0].kind === run.gift!.options[1].kind, `seed ${k}: another button than the effects show is rejected`);
      assert(forge(taken, value => { value.streams['gift-deal'] = 0; }) === null, `seed ${k}: the gift streams are counted`);
    }
  }
  const mini = createForestRun(spread(7), { map: 'generated', skipTrunk: true, gift: 'mini' });
  assert(json(roundTrip(mini)) === json(mini) && mini.streams!['gift-item'] === 1 && mini.streams!['gift-deal'] === 0, 'the mini gift draws its one stream');
  assert(forge(mini, value => { value.seeded = true; }) === null, 'a seeded run with a mini gift is rejected');
  // A save made before the gift: no gift, nothing waits.
  const old = createForestRun(spread(8), { map: 'generated', skipTrunk: true });
  assert(old.gift === undefined && availableNodes(old).length > 0 && json(roundTrip(old)) === json(old), 'a run without a gift plays and saves as before');
  console.log('PASS the gift reloads the same (also the open choice); forged, skipped and mismatched gifts are rejected; runs without a gift play');
}

profileDecides();
afterTheTrunk();
consumables();
await supplies();
deals();
gamble();
rules();
saves();
