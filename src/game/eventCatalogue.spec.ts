import { ForestEngine } from './forestEngine';
import type { ItemKind, ResourceKind } from './forestTypes';
import { RESOURCE_KINDS } from './resources';
import { extraAngerBeforeGoals, firstChainPower, reinforcementShift, startsWithElite, talisman, type BattleModifier } from './talismans';
import { uniqueEntities } from './entityFootprint';
import { angerPerTurn, pressureBossLives } from './mapBattleRules';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseGift, chooseTalisman, createForestRun, enterNode, eventCandidates, eventView, forestRunScore, forestRunView, giftView, nodeBattleId,
  parseForestRun, resolveBattle, restHeal, runNode, serializeForestRun, shopLeave, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { eventFits, eventOption, forestEvent, FOREST_EVENTS, validateForestEvents } from './run/forestEvents';
import { CATALOGUE_EVENTS, eventUnlockLevel } from './run/unlocks';
import { poolCandidates } from './run/battlePools';
import { forestBattle } from './run/forestBattles';

// The event catalogue (docs/events.md, agreed 04.10.2026): all 14 events through real run commands on generated maps.
// Every option of every event is taken and its changes are compared with the catalogue table of docs/events.md (written
// out below from the document, not read from the data); HP never drops below 1; an option the cat cannot pay is
// unavailable with a reason; random outcomes come out in their shares over many seeds; the same seed and actions give
// the same run, also after a reload at every step; modifiers of the next battle act on exactly one battle in the real
// engine; the reward battle gives its reward on a victory, ends the run on a defeat and can be refused; branch events
// stand only in their branch; an event comes at most once per run; closed events never come; forged saves are rejected.
// Battles on the way are resolved through resolveBattle with the cat's state set by the walk (map-stats.ts does the
// same); the engine plays the battles whose setup matters (modifiers, the reward battle). Seeds are spread with
// Math.imul(k, 2654435761). No test claims a victory of a bot.

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };
const stockOf = (run: ForestRunState) => RESOURCE_KINDS.reduce((sum, kind) => sum + (run.resources.materials?.[kind] ?? 0), 0);
type Stock = Partial<Record<ResourceKind, number>>;

/** What a walk leaves the cat with: HP and energy after every battle, resources from the first battle past the trunk. */
interface Plan {
  hp?: number; energy?: number; loot?: Stock; unlocks?: number;
  /** Effects the last battle leaves on the cat (poison: the rest and «Костёр путника» clear it). */
  poison?: boolean;
  /** A find takes this item when offered. */
  find?: ItemKind;
  /** The walk enters event nodes on its way (to meet many events) instead of avoiding them. */
  events?: boolean;
  /** Accept only a run in this state on arrival (else the next seed). */
  accept?: (run: ForestRunState) => boolean;
  from?: number;
}

/** Resolve the open battle as won, the cat left as the plan says (the engine's own result is not needed here). */
function winQuick(run: ForestRunState, plan: Plan, first: boolean): ForestRunState {
  const pending = run.pending as Extract<ForestRunState['pending'], { kind: 'battle' }>, entry = pending.entry;
  return ok(resolveBattle(run, { nodeId: pending.nodeId, won: true,
    player: { hp: plan.hp ?? entry.player.hp, maxHp: entry.player.maxHp, energy: plan.energy ?? entry.player.energy,
      ...plan.poison ? { damageEffects: { burning: 0, burningTurns: 0, poison: 1, bleeding: 0, bleedingSteps: 0 } } : {} },
    inventory: { ...entry.inventory }, ...first && plan.loot ? { materials: { dew: 0, powder: 0, resin: 0, herbs: 0, ...plan.loot } } : {} }), `resolve ${pending.nodeId}`);
}
/** An option of a passing event that changes as little as it can: nothing at all, else no HP, energy or resources. */
function passEvent(run: ForestRunState): ForestRunState {
  const view = eventView(run)!, calm = (id: string) => { const option = eventOption(view.event, id)!; return !option.battle && !option.escalation && !option.cost; };
  const nothing = view.options.find(entry => entry.available && calm(entry.id) && eventOption(view.event, entry.id)!.outcomes.every(outcome => !Object.keys(outcome.effect).length));
  const quiet = view.options.find(entry => entry.available && calm(entry.id) && eventOption(view.event, entry.id)!.outcomes.every(outcome =>
    !outcome.effect.hp && !outcome.effect.energy && !outcome.effect.resources && !outcome.effect.materials && !outcome.effect.maxHp && !outcome.effect.talisman && !outcome.effect.modifier));
  return ok(chooseEventOption(run, (nothing ?? quiet ?? view.options.find(entry => entry.available && entry.safe)!).id), `pass ${view.event.id}`);
}
/** Finish whatever is open that is not the target: battles won, finds, talismans refused, rests healed, merchants left. */
function settle(run: ForestRunState, plan: Plan, state: { battles: number }): ForestRunState {
  const pending = run.pending!;
  if (pending.kind === 'battle') return winQuick(run, plan, !runNode(run, pending.nodeId)!.lane.startsWith('trunk') && state.battles++ === 0);
  if (pending.kind === 'find') return ok(chooseFindItem(run, plan.find && pending.options.includes(plan.find) ? plan.find : pending.options[0]), 'find');
  if (pending.kind === 'talisman') return ok(chooseTalisman(run, null), 'refuse');
  if (pending.kind === 'rest') return ok(restHeal(run), 'heal');
  if (pending.kind === 'shop') return ok(shopLeave(run), 'leave');
  if (pending.kind === 'event') return passEvent(run);
  throw new Error(`unexpected ${pending.kind}`);
}
/**
 * The first spread seed (from `plan.from`) whose generated run, walked by a seeded route, enters an event node holding
 * `eventId` in the state the plan asks: the run with that event open.
 */
function reach(eventId: string, plan: Plan = {}): ForestRunState {
  for (let k = plan.from ?? 1; k < (plan.from ?? 1) + 1500; k++) {
    const seed = spread(k), state = { battles: 0 };
    let run = createForestRun(seed, { map: 'generated', skipTrunk: true, ...plan.unlocks !== undefined ? { unlocks: plan.unlocks } : {} }), choice = seed;
    for (let guard = 0; guard < 80 && !run.result; guard++) {
      if (run.pending) { run = settle(run, plan, state); continue; }
      const next = availableNodes(run), target = next.find(node => node.content.kind === 'event' && node.content.eventId === eventId);
      if (target) {
        run = ok(enterNode(run, target.id), `enter ${target.id}`);
        if (!plan.accept || plan.accept(run)) return run;
        break;
      }
      choice = spread(choice + 1);
      const others = next.filter(node => plan.events ? true : node.type !== 'event'), list = others.length ? others : next;
      run = ok(enterNode(run, list[choice % list.length].id), 'walk');
    }
  }
  throw new Error(`no run reaches ${eventId}`);
}

// ---------- The catalogue of docs/events.md, section 3, as the player sees it ----------

/** One possible result of an option: changes of HP, maximum HP, energy, resources (total and named kinds), consumables, a talisman of a rarity, a modifier, effects cleared. */
interface Diff { hp?: number; maxHp?: number; energy?: number; res?: number; herbs?: number; resin?: number; items?: Partial<Record<ItemKind, number>>; talisman?: 'common' | 'uncommon'; modifier?: BattleModifier; cleared?: true }
/** docs/events.md, section 3: every option and its outcomes (a random option lists each). `attempt`: it keeps the event open; `battle`: it starts the reward battle. */
const CATALOGUE: Record<string, Record<string, Diff[] | 'attempt' | 'battle'>> = {
  brook: { drink: [{ hp: 2 }], flask: [{ items: { frost: 1 } }], sharpen: [{ energy: 1 }] },
  'goblin-cache': { break: [{ res: 2 }, { hp: -2 }], careful: [{ energy: -1, res: 1 }], leave: [{}] },
  'owl-hollow': { feather: [{ energy: 1 }], shell: [{ res: 1 }], advice: [{ modifier: 'first-chain-power' }] },
  'old-trap': { bait: [{ hp: -1, res: 2 }], disarm: [{ energy: -1, items: { bomb: 1 } }], leave: [{}] },
  'porcupine-nest': { search: 'attempt', leave: [{}] },
  // «Перевязать (1 трава или «Лечение»): +1 к максимуму HP» — +1 HP comes with it, as «Закалка» and «Крепкая шкура».
  'wounded-cub': { bandage: [{ maxHp: 1, hp: 1, res: -1, herbs: -1 }], skin: [{ res: 2, modifier: 'wrath' }], leave: [{}] },
  'wandering-grinder': { grind: [{ res: -2, talisman: 'common' }], salve: [{ res: -1, hp: 2 }], leave: [{}] },
  'ford-ambush': { fight: 'battle', around: [{ energy: -1 }], bushes: [{ modifier: 'wrath' }] },
  'warm-den': { sleep: [{ hp: 2 }], herbs: [{ res: 2, herbs: 2 }] },
  'den-bones': { search: [{ talisman: 'uncommon' }, { modifier: 'start-elite' }], leave: [{}] },
  'drunk-cook': { stew: [{ res: -2, hp: 2 }], pot: [{ res: 3, modifier: 'early-reinforcement' }], leave: [{}] },
  'shaman-idol': { bow: [{ energy: 2, maxHp: -1 }], smash: [{ res: 1 }], leave: [{}] },
  'bone-wheel': { spin: [{ res: 2 }, { res: -1, talisman: 'common' }, { res: -1, hp: 2 }, { res: -1, hp: -1 }, { res: -1, energy: 2 }, { res: -1 }], leave: [{}] },
  'traveler-fire': { warm: [{ hp: 1, cleared: true }], resin: [{ res: -1, resin: -1, items: { fire: 1 } }] },
};
/** docs/events.md: branch, rows and the level of the bar that opens each event. */
const PLACES: Record<string, [string, number, number, number]> = {
  brook: ['trails', 6, 8, 0], 'goblin-cache': ['trails', 6, 8, 2], 'owl-hollow': ['trails', 6, 8, 0], 'old-trap': ['trails', 6, 8, 0], 'porcupine-nest': ['trails', 6, 8, 0],
  'wounded-cub': ['trails', 6, 8, 0], 'wandering-grinder': ['trails', 6, 8, 0], 'ford-ambush': ['trails', 6, 8, 4], 'warm-den': ['den', 10, 11, 0], 'den-bones': ['den', 10, 11, 5],
  'drunk-cook': ['camp', 10, 11, 0], 'shaman-idol': ['camp', 10, 11, 5], 'bone-wheel': ['common', 6, 11, 4], 'traveler-fire': ['common', 6, 11, 0],
};
/** The diff the player sees between two runs. */
function diffOf(before: ForestRunState, after: ForestRunState): Diff {
  const a = before.resources, b = after.resources, diff: Diff = {};
  const put = <K extends keyof Diff>(key: K, value: Diff[K] | 0) => { if (value) diff[key] = value as Diff[K]; };
  put('hp', b.player.hp - a.player.hp); put('maxHp', b.player.maxHp - a.player.maxHp); put('energy', b.player.energy - a.player.energy);
  put('res', stockOf(after) - stockOf(before));
  put('herbs', (b.materials?.herbs ?? 0) - (a.materials?.herbs ?? 0)); put('resin', (b.materials?.resin ?? 0) - (a.materials?.resin ?? 0));
  const items: Partial<Record<ItemKind, number>> = {};
  for (const item of ['frost', 'bomb', 'healing', 'fire'] as ItemKind[]) if (b.inventory[item] !== a.inventory[item]) items[item] = b.inventory[item] - a.inventory[item];
  if (Object.keys(items).length) diff.items = items;
  const added = after.talismans.slice(before.talismans.length);
  if (added.length) diff.talisman = talisman(added[0]).rarity as 'common' | 'uncommon';
  const waiting = (run: ForestRunState) => (run.modifiers ?? []).map(entry => entry.modifier);
  const modifier = waiting(after).find(entry => !waiting(before).includes(entry));
  if (modifier) diff.modifier = modifier;
  if (a.player.damageEffects && !b.player.damageEffects) diff.cleared = true;
  return diff;
}
/** `diff` is one of the documented results; the named-kind changes (herbs, resin) are checked only where the table names them. */
function matches(diff: Diff, allowed: Diff[]): boolean {
  return allowed.some(expected => {
    const keys = new Set([...Object.keys(diff), ...Object.keys(expected)].filter(key => key !== 'herbs' && key !== 'resin' || key in expected));
    return [...keys].every(key => json(diff[key as keyof Diff] ?? null) === json(expected[key as keyof Diff] ?? null));
  });
}

/** Data: 14 events of the catalogue with their branch, rows and opening level; the validator holds; the bar names them all. */
function data() {
  assert(!validateForestEvents().length, `event data is valid: ${validateForestEvents().join(' ')}`);
  assert(json(Object.keys(FOREST_EVENTS).sort()) === json(Object.keys(CATALOGUE).sort()) && Object.keys(FOREST_EVENTS).length === 14, 'the 14 events of the catalogue are in the game');
  assert(json(Object.keys(CATALOGUE_EVENTS).sort()) === json(Object.keys(FOREST_EVENTS).sort()), 'the bar of openings names every event');
  for (const [id, [branch, from, to, level]] of Object.entries(PLACES)) {
    const event = FOREST_EVENTS[id];
    assert(event.branch === branch && event.rows[0] === from && event.rows[1] === to && eventUnlockLevel(id) === level, `${id}: ${branch}, rows ${from}–${to}, level ${level}`);
    assert(json(event.options.map(option => option.id).sort()) === json(Object.keys(CATALOGUE[id]).sort()), `${id}: the options of the catalogue`);
  }
  console.log('PASS the catalogue: 14 events, branches, rows and opening levels as in docs/events.md; the validator holds');
}

/** A rich cat on arrival: HP 3 of 5, 3 energy, at least 3 of the 8 resources (2 of each kind) left, poisoned by the last battle. */
const RICH: Plan = { hp: 3, energy: 3, loot: { dew: 2, powder: 2, resin: 2, herbs: 2 }, poison: true,
  accept: run => stockOf(run) >= 3 && (run.resources.materials?.herbs ?? 0) >= 1 && (run.resources.materials?.resin ?? 0) >= 1 && run.resources.player.hp === 3 && run.resources.player.energy === 3 && !!run.resources.player.damageEffects };
/** The same at full HP (5 of 5): room for three pricks of the nest. */
const HEALTHY: Plan = { ...RICH, hp: 5, accept: run => stockOf(run) >= 3 && run.resources.player.hp === 5 };

/** Every option of every event, from the same open event: the changes are those of the catalogue; the node completes. */
function everyOption() {
  let checked = 0;
  for (const id of Object.keys(CATALOGUE)) {
    const run = reach(id, RICH), view = eventView(run)!;
    assert(view.event.id === id && view.options.every(option => option.available), `${id}: every option is available to a rich cat (${json(view.options.map(option => option.reason))})`);
    for (const [optionId, expected] of Object.entries(CATALOGUE[id])) {
      const step = chooseEventOption(run, optionId), after = ok(step, `${id}/${optionId}`);
      if (expected === 'attempt') {
        assert(after.pending?.kind === 'event' && after.pending.attempts?.length === 1 && step.ok && step.events[0].type === 'event-attempt', `${id}/${optionId}: an attempt keeps the event open`);
        assert(matches(diffOf(run, after), [{ res: 1 }, { res: 1, hp: -1 }]), `${id}/${optionId}: an attempt gives a resource, a prick takes 1 HP (${json(diffOf(run, after))})`);
      } else if (expected === 'battle') {
        assert(after.pending?.kind === 'battle' && after.pending.nodeId === view.nodeId && !!nodeBattleId(after, runNode(after, view.nodeId)!), `${id}/${optionId}: the reward battle starts`);
      } else {
        const diff = diffOf(run, after);
        assert(matches(diff, expected), `${id}/${optionId}: ${json(diff)} is one of ${json(expected)}`);
        assert(after.pending === null && after.currentNodeId === view.nodeId && after.eventChoices.at(-1)?.option === optionId, `${id}/${optionId}: the node completes`);
      }
      assert(json(roundTrip(after)) === json(after), `${id}/${optionId}: the run survives a save`);
      checked++;
    }
  }
  console.log(`PASS every option of every event changes what the catalogue says (${checked} options)`);
}

/**
 * HP never below 1 (docs/events.md, rule 3, decision of 04.10.2026): at 1 HP every option that may take HP — a sure price
 * or a risk («Взломать», «Вытащить приманку», «Пошарить», «Крутить») — is unavailable with «Нужно HP ≥ 2», the safe option
 * and the options without HP at stake stay; from 2 HP they are taken and HP stays at least 1 (the nest until it closes).
 */
function hpFloor() {
  const RISKY: Record<string, string> = { 'goblin-cache': 'break', 'old-trap': 'bait', 'porcupine-nest': 'search', 'bone-wheel': 'spin' };
  let closed = 0, taken = 0;
  for (const [id, risky] of Object.entries(RISKY)) {
    for (const from of [1, 150, 300]) {
      const weak = reach(id, { hp: 1, energy: 3, loot: { dew: 3 }, from, accept: entry => entry.resources.player.hp === 1 && stockOf(entry) >= 1 }), view = eventView(weak)!;
      const option = view.options.find(entry => entry.id === risky)!;
      assert(!option.available && option.reason.includes('HP ≥ 2') && !chooseEventOption(weak, risky).ok, `${id}/${risky} at 1 HP: unavailable — «${option.reason}»`);
      assert(view.options.some(entry => entry.safe && entry.available), `${id}: a safe option stays at 1 HP`);
      for (const other of view.options.filter(entry => entry.id !== risky)) {
        assert(other.available, `${id}/${other.id}: no HP at stake, available at 1 HP (${other.reason})`);
        assert(ok(chooseEventOption(weak, other.id), `${id}/${other.id} at 1 HP`).resources.player.hp >= 1, `${id}/${other.id}: HP at least 1`);
      }
      closed++;
      const able = reach(id, { hp: 2, energy: 3, loot: { dew: 3 }, from, accept: entry => entry.resources.player.hp === 2 && stockOf(entry) >= 1 });
      let after = ok(chooseEventOption(able, risky), `${id}/${risky} at 2 HP`);
      // The nest: attempts while the option is open; a prick to 1 HP closes it.
      while (after.pending?.kind === 'event' && eventView(after)!.options.find(entry => entry.id === risky)!.available) after = ok(chooseEventOption(after, risky), 'again');
      assert(after.resources.player.hp >= 1, `${id}/${risky}: HP ${after.resources.player.hp} from 2 HP`);
      if (after.pending?.kind === 'event' && after.resources.player.hp === 1) {
        const shut = eventView(after)!.options.find(entry => entry.id === risky)!;
        assert(!shut.available && shut.reason.includes('HP ≥ 2'), `${id}: after a prick to 1 HP the next attempt is closed (${shut.reason})`);
      }
      taken++;
    }
  }
  console.log(`PASS at 1 HP the options that may take HP are closed with «HP ≥ 2» (${closed} events), the others stay; from 2 HP they never take the cat below 1 (${taken})`);
}

/** An option the cat cannot pay is unavailable and says why; the safe option is always there; a cost alternative is paid. */
function unaffordable() {
  const reason = (run: ForestRunState, id: string) => eventView(run)!.options.find(option => option.id === id)!;
  const blocked = (run: ForestRunState, id: string, text: string) => {
    const option = reason(run, id);
    assert(!option.available && option.reason.includes(text) && !chooseEventOption(run, id).ok, `${eventView(run)!.event.id}/${id}: unavailable — «${option.reason}» (expects «${text}»)`);
    assert(eventView(run)!.options.some(entry => entry.safe && entry.available), `${eventView(run)!.event.id}: a safe option stays`);
  };
  blocked(reach('old-trap', { energy: 0, accept: run => run.resources.player.energy === 0 }), 'disarm', 'Нужна энергия: 1 (сейчас 0)');
  blocked(reach('ford-ambush', { energy: 0, accept: run => run.resources.player.energy === 0 }), 'around', 'Нужна энергия');
  blocked(reach('goblin-cache', { energy: 0, accept: run => run.resources.player.energy === 0 }), 'careful', 'Нужна энергия');
  blocked(reach('drunk-cook', { loot: { dew: 1 }, accept: run => stockOf(run) === 1 }), 'stew', 'Нужно ресурсов: 2, есть 1');
  const grinder = reach('wandering-grinder', { loot: { dew: 1 }, accept: run => stockOf(run) === 1 });
  blocked(grinder, 'grind', 'Нужно ресурсов: 2, есть 1');
  assert(reason(grinder, 'salve').available, 'wandering-grinder: the salve at 1 resource');
  blocked(reach('traveler-fire', { loot: { dew: 2 }, accept: run => !run.resources.materials?.resin }), 'resin', '«Смола»');
  // «Перевязать»: 1 herb, or «Лечение» when there is no herb; neither — unavailable.
  blocked(reach('wounded-cub', { loot: { dew: 2 }, accept: run => !run.resources.materials?.herbs && !run.resources.inventory.healing }), 'bandage', 'или');
  const herbs = reach('wounded-cub', { loot: { herbs: 1 }, accept: run => run.resources.materials?.herbs === 1 && !run.resources.inventory.healing });
  const withHerb = ok(chooseEventOption(herbs, 'bandage'), 'bandage with a herb');
  assert(withHerb.resources.materials!.herbs === 0 && json(withHerb.eventChoices.at(-1)!.paid) === json({ dew: 0, powder: 0, resin: 0, herbs: 1 }) && withHerb.eventChoices.at(-1)!.cost === undefined, 'wounded-cub: the herb is paid first');
  const potion = reach('wounded-cub', { loot: { dew: 2 }, find: 'healing', events: true, accept: run => !run.resources.materials?.herbs && run.resources.inventory.healing >= 1 });
  const withPotion = ok(chooseEventOption(potion, 'bandage'), 'bandage with «Лечение»');
  assert(withPotion.resources.inventory.healing === potion.resources.inventory.healing - 1 && withPotion.eventChoices.at(-1)!.cost === 1 && withPotion.resources.player.maxHp === potion.resources.player.maxHp + 1
    && json(roundTrip(withPotion)) === json(withPotion), 'wounded-cub: without a herb «Лечение» is given');
  // Conditions of appearance: the grinder and the wheel need resources in stock; without them they never come.
  let poor = 0, rich = 0;
  for (let k = 1; k <= 300; k++) {
    const empty = { ...createForestRun(spread(k), { map: 'generated', skipTrunk: true }) }, full = { ...empty, resources: { ...empty.resources, materials: { dew: 1, powder: 0, resin: 0, herbs: 0 } } };
    const place = { row: 7, lane: 'shared' as const };
    if (eventCandidates(empty, place).some(id => id === 'wandering-grinder' || id === 'bone-wheel')) poor++;
    if (eventCandidates(full, place).includes('wandering-grinder') && eventCandidates(full, place).includes('bone-wheel')) rich++;
  }
  assert(poor === 0 && rich === 300, `the grinder and the wheel wait for resources (without: ${poor}, with: ${rich} of 300)`);
  console.log('PASS unpayable options are unavailable with a reason, a safe option stays; «Перевязать» pays a herb or «Лечение»; the grinder and the wheel wait for resources');
}

/** Random outcomes come out in their shares over many seeds (the outcome depends on the run seed and the stream only). */
function shares() {
  const tolerance = 4;
  const count = (id: string, option: string, plan: Plan, n: number, attempts = 1) => {
    const base = reach(id, plan), tallies: number[][] = Array.from({ length: attempts }, () => []);
    for (let k = 1; k <= n; k++) {
      let run: ForestRunState = { ...structuredClone(base), seed: spread(k + 5000) };
      for (let attempt = 0; attempt < attempts; attempt++) {
        const step = ok(chooseEventOption(run, option), `${id}/${option}`);
        const outcome = attempts > 1 ? (step.pending as { attempts: number[] }).attempts[attempt] : step.eventChoices.at(-1)!.outcome;
        tallies[attempt][outcome] = (tallies[attempt][outcome] ?? 0) + 1;
        run = step;
      }
    }
    return tallies.map(tally => tally.map(value => (value ?? 0) / n * 100));
  };
  const check = (what: string, got: number[], want: number[]) => {
    assert(want.every((chance, n) => Math.abs((got[n] ?? 0) - chance) <= tolerance), `${what}: ${got.map(value => value.toFixed(1)).join('/')} vs ${want.join('/')}`);
    return `${what} ${got.map(value => value.toFixed(1)).join('/')}`;
  };
  const lines = [
    check('goblin-cache/break', count('goblin-cache', 'break', RICH, 3000)[0], [50, 50]),
    check('den-bones/search', count('den-bones', 'search', RICH, 3000)[0], [50, 50]),
    check('bone-wheel/spin', count('bone-wheel', 'spin', RICH, 6000)[0], Array(6).fill(100 / 6)),
  ];
  // The wheel shows «1 из 6» on every sector (decision of 04.10.2026: exactly 1/6, no 17/16 split).
  const wheel = eventView(reach('bone-wheel', RICH))!.options.find(option => option.id === 'spin')!;
  assert(wheel.outcomes.length === 6 && wheel.outcomes.every(outcome => outcome.odds === '1 из 6'), `the wheel shows 1 of 6: ${json(wheel.outcomes.map(outcome => outcome.odds))}`);
  const nest = count('porcupine-nest', 'search', HEALTHY, 3000, 3);
  lines.push(...nest.map((tally, attempt) => check(`porcupine-nest attempt ${attempt + 1}`, tally, [[75, 25], [50, 50], [25, 75]][attempt])));
  // The shortcut (another seed on the same open event) is what a real walk of that seed gives: the roll reads only the seed and the stream.
  for (let k = 1; k <= 6; k++) {
    const walked = reach('goblin-cache', { ...RICH, from: k * 50 });
    const swapped = { ...structuredClone(reach('goblin-cache', RICH)), seed: walked.seed, streams: structuredClone(walked.streams) };
    assert(ok(chooseEventOption(walked, 'break'), 'walked').eventChoices.at(-1)!.outcome === ok(chooseEventOption(swapped as ForestRunState, 'break'), 'swapped').eventChoices.at(-1)!.outcome, 'the roll depends on the seed and the stream only');
  }
  console.log(`PASS random outcomes in their shares (±${tolerance} points): ${lines.join('; ')}`);
}

/** The escalation: three attempts at 25 → 50 → 75%, shown before each; leave at any moment; a reload mid-way changes nothing. */
function escalation() {
  for (const from of [1, 300, 600]) {
    let run = reach('porcupine-nest', { ...HEALTHY, from });
    for (let attempt = 0; attempt < 3; attempt++) {
      const option = eventView(run)!.options.find(entry => entry.id === 'search')!;
      assert(option.available && json(option.attempts) === json({ done: attempt, max: 3 }) && option.outcomes[1].chance === [25, 50, 75][attempt], `attempt ${attempt + 1}: the chance ${[25, 50, 75][attempt]}% is shown before it`);
      assert(eventView(run)!.options.find(entry => entry.id === 'leave')!.available, 'leave at any moment');
      const reloaded = roundTrip(run)!;
      assert(json(reloaded) === json(run), `attempt ${attempt + 1}: the open event survives a reload`);
      const next = ok(chooseEventOption(run, 'search'), `attempt ${attempt + 1}`);
      assert(json(ok(chooseEventOption(reloaded, 'search'), 'after the reload')) === json(next), `attempt ${attempt + 1}: the same outcome after a reload`);
      assert(next.streams!.events === run.streams!.events + 1, 'every attempt is its own draw of the events stream');
      run = next;
    }
    const spent = eventView(run)!.options.find(entry => entry.id === 'search')!;
    assert(!spent.available && spent.reason.includes('3 из 3') && !chooseEventOption(run, 'search').ok, 'no fourth attempt');
    const left = ok(chooseEventOption(run, 'leave'), 'leave');
    assert(left.pending === null && json(left.eventChoices.at(-1)!.attempts) === json((run.pending as { attempts: number[] }).attempts) && json(roundTrip(left)) === json(left), 'leaving keeps the attempts in the record');
    // Leaving after one attempt is as good.
    const once = ok(chooseEventOption(ok(chooseEventOption(reach('porcupine-nest', { ...HEALTHY, from }), 'search'), 'search'), 'leave'), 'leave after one');
    assert(once.eventChoices.at(-1)!.attempts?.length === 1, 'leave after the first attempt');
  }
  console.log('PASS the escalation: three attempts at 25/50/75%, each shown before it and drawn on its own; leave any time; reloads change nothing');
}

/** The same seed and actions give the same run; a reload before every choice gives the same result. */
function reloads() {
  for (const id of Object.keys(CATALOGUE)) {
    const run = reach(id, RICH), again = reach(id, RICH);
    assert(json(run) === json(again), `${id}: the same seed and actions reach the same event`);
    const reloaded = roundTrip(run)!;
    assert(json(eventView(reloaded)) === json(eventView(run)), `${id}: the reloaded event shows the same options and outcomes`);
    for (const option of eventView(run)!.options) assert(json(chooseEventOption(reloaded, option.id)) === json(chooseEventOption(run, option.id)), `${id}/${option.id}: the same result after a reload`);
  }
  console.log('PASS every event: the same seed and actions give the same run; a reload before the choice gives the same result');
}

/** Waiting modifiers of the run's view; the real engine gets them in the next battle only. */
function playBattle(run: ForestRunState): { run: ForestRunState; engine: ForestEngine } {
  const setup = battleSetup(run)!, engine = new ForestEngine(); engine.animationScale = 0;
  assert(engine.startRunBattle(setup), `${setup.nodeId} starts`);
  return { run, engine };
}
function nextBattle(run: ForestRunState): ForestRunState {
  for (let guard = 0; guard < 30; guard++) {
    if (run.pending?.kind === 'battle') return run;
    if (run.pending) { run = settle(run, {}, { battles: 1 }); continue; }
    const next = availableNodes(run), battle = next.find(node => node.type === 'battle' || node.type === 'hard' || node.type === 'checkpoint') ?? next[0];
    run = ok(enterNode(run, battle.id), 'to the next battle');
  }
  throw new Error('no battle ahead');
}
/** A modifier of the next battle acts on exactly one map battle, in the real engine, and is dropped after it. */
function modifiers() {
  const elites = (engine: ForestEngine) => uniqueEntities(engine.state.board).filter(({ cell }) => cell.elite).length;
  const cases: [string, string, BattleModifier, (engine: ForestEngine) => boolean, Plan?][] = [
    ['owl-hollow', 'advice', 'first-chain-power', engine => firstChainPower(engine.state) === 1],
    ['wounded-cub', 'skin', 'wrath', engine => extraAngerBeforeGoals(engine.state) === 1],
    ['ford-ambush', 'bushes', 'wrath', engine => extraAngerBeforeGoals(engine.state) === 1],
    ['drunk-cook', 'pot', 'early-reinforcement', engine => reinforcementShift(engine.state) === -1],
    ['den-bones', 'search', 'start-elite', engine => startsWithElite(engine.state)],
  ];
  for (const [id, optionId, modifier, acts] of cases) {
    // «Кости у логова»: a seed whose search wakes the den (the 50% outcome with the elite).
    const wakes = (entry: ForestRunState) => id !== 'den-bones' || ok(chooseEventOption(entry, optionId), 'search').eventChoices.at(-1)!.outcome === 1;
    let run = reach(id, { ...RICH, accept: entry => RICH.accept!(entry) && wakes(entry) });
    run = ok(chooseEventOption(run, optionId), `${id}/${optionId}`);
    assert(json(forestRunView(run).modifiers.map(entry => entry.modifier)) === json([modifier]) && forestRunView(run).modifiers[0].battles === 1, `${id}: the run waits with «${modifier}» for one battle`);
    assert(json(roundTrip(run)) === json(run), `${id}: the waiting modifier survives a save`);
    run = nextBattle(run);
    const first = playBattle(run);
    assert(json(battleSetup(run)!.modifiers) === json([modifier]) && first.engine.state.runNode?.modifiers?.includes(modifier) && acts(first.engine), `${id}: the next battle gets «${modifier}» in the engine`);
    if (modifier === 'start-elite') {
      const plain = new ForestEngine(); plain.animationScale = 0;
      assert(plain.startRunBattle({ ...battleSetup(run)!, modifiers: undefined }) && elites(first.engine) === elites(plain) + 1, `start-elite: one elite more than the same battle without it (${elites(first.engine)} vs ${elites(plain)})`);
    }
    assert(!run.modifiers && json(roundTrip(run)) === json(run), `${id}: the battle took the modifier`);
    first.engine.winLevel();
    run = ok(resolveBattle(run, first.engine.runBattleOutcome()!), 'win');
    run = nextBattle(run);
    const second = playBattle(run);
    assert(!battleSetup(run)!.modifiers && !second.engine.state.runNode?.modifiers && !acts(second.engine), `${id}: the battle after it has no «${modifier}»`);
  }
  console.log('PASS modifiers of the next battle (first chain 1, anger 2, early reinforcement, start elite) act on exactly one battle in the engine');
}

/**
 * «Злится на 1 больше» (`wrath`) waits for the first battle where it acts (decision of 04.10.2026): a battle under the
 * gift's calm and a boss battle leave it waiting; the next battle without them takes it. The other modifiers go to the
 * nearest battle. Real commands on generated runs with the full gift's calm; reloads at every step change nothing.
 */
function wrathWaits() {
  const WRATH: Record<string, string> = { 'wounded-cub': 'skin', 'ford-ambush': 'bushes' };
  const calmLeft = (run: ForestRunState) => run.modifiers?.find(entry => entry.modifier === 'calm')?.battles ?? 0;
  const wrathOf = (run: ForestRunState) => run.modifiers?.find(entry => entry.modifier === 'wrath');
  let checked = 0;
  for (let k = 1; k < 3000 && checked < 3; k++) {
    let run = createForestRun(spread(k), { map: 'generated', skipTrunk: true, gift: 'full' });
    if (giftView(run)!.options[1].option.kind !== 'calm') continue;
    run = ok(chooseGift(run, 1), 'the calm');
    const state = { battles: 0 }, plan: Plan = { loot: { dew: 2 } };
    let choice = spread(k + 77), took: string | null = null;
    // Walk to a wrath event while the calm still holds a battle: battles last, the event first.
    for (let guard = 0; guard < 20 && !took && !run.result; guard++) {
      if (run.pending?.kind === 'event') {
        const id = eventView(run)!.event.id;
        if (WRATH[id] && calmLeft(run) >= 1) { run = ok(chooseEventOption(run, WRATH[id]), `${id}/${WRATH[id]}`); took = id; break; }
      }
      if (run.pending) { run = settle(run, plan, state); continue; }
      const next = availableNodes(run), target = next.find(node => node.content.kind === 'event' && !!WRATH[node.content.eventId]);
      const quiet = next.filter(node => node.type !== 'battle' && node.type !== 'hard' && node.type !== 'checkpoint'), list = quiet.length ? quiet : next;
      choice = spread(choice + 1);
      run = ok(enterNode(run, (target ?? list[choice % list.length]).id), 'walk');
    }
    if (!took) continue;
    assert(wrathOf(run)?.battles === 1 && calmLeft(run) >= 1 && json(roundTrip(run)) === json(run), `${run.seed}: wrath waits beside the calm`);
    // Battles under the calm: they take the calm, not the wrath; no anger before the goals in the engine.
    while (calmLeft(run) >= 1) {
      run = nextBattle(run);
      const calm = playBattle(run);
      assert(json(battleSetup(run)!.modifiers) === json(['calm']) && wrathOf(run)?.battles === 1, `${run.seed}: the battle under the calm leaves the wrath waiting (${json(battleSetup(run)!.modifiers)})`);
      assert(extraAngerBeforeGoals(calm.engine.state) === 0 && angerPerTurn(calm.engine.state) === 0, `${run.seed}: no anger under the calm in the engine`);
      assert(json(roundTrip(run)) === json(run), `${run.seed}: the battle under the calm survives a reload`);
      assert(forge(run, v => { v.pending.modifiers = ['calm', 'wrath']; delete v.modifiers; }) === null, `${run.seed}: a save where the calm battle took the wrath is rejected`);
      calm.engine.winLevel(); run = ok(resolveBattle(run, calm.engine.runBattleOutcome()!), 'win under the calm');
      assert(json(roundTrip(run)) === json(run), `${run.seed}: after the calm battle the run survives a reload`);
    }
    // The next battle takes the wrath: 2 angry per turn before the goals in the engine.
    run = nextBattle(run);
    const wrath = playBattle(run);
    assert(json(battleSetup(run)!.modifiers) === json(['wrath']) && !run.modifiers, `${run.seed}: the first battle without the calm takes the wrath`);
    assert(extraAngerBeforeGoals(wrath.engine.state) === 1 && angerPerTurn(wrath.engine.state) === 2, `${run.seed}: the wrath acts in the engine (${angerPerTurn(wrath.engine.state)} per turn)`);
    assert(json(roundTrip(run)) === json(run), `${run.seed}: the wrath battle survives a reload`);
    wrath.engine.winLevel(); run = ok(resolveBattle(run, wrath.engine.runBattleOutcome()!), 'win with the wrath');
    run = nextBattle(run);
    assert(!battleSetup(run)!.modifiers && extraAngerBeforeGoals(playBattle(run).engine.state) === 0, `${run.seed}: the battle after it has no wrath`);
    checked++;
  }
  assert(checked === 3, `runs with the calm and a wrath event found (${checked})`);
  // A boss battle (Troll or Chief: no anger before the goals while the boss lives) leaves the wrath waiting; another
  // modifier is taken. On the generated maps a wrath of rows 6–8 is always taken by the Jailer before a boss, so the
  // run state before the boss is set as a model.
  for (const k of [1, 2]) {
    let run = createForestRun(spread(k + 40), { map: 'generated', skipTrunk: true }), choice = spread(k);
    const state = { battles: 0 };
    for (let guard = 0; guard < 80 && !availableNodes(run).some(node => node.type === 'boss'); guard++) {
      if (run.pending) { run = settle(run, {}, state); continue; }
      choice = spread(choice + 1); const next = availableNodes(run); run = ok(enterNode(run, next[choice % next.length].id), 'walk');
    }
    const boss = availableNodes(run).find(node => node.type === 'boss')!;
    const model: ForestRunState = { ...structuredClone(run), modifiers: [{ modifier: 'wrath', battles: 1 }, { modifier: 'first-chain-power', battles: 1 }] };
    const entered = ok(enterNode(model, boss.id), 'enter the boss'), fight = playBattle(entered);
    assert(json(battleSetup(entered)!.modifiers) === json(['first-chain-power']) && json(entered.modifiers) === json([{ modifier: 'wrath', battles: 1 }]), `${boss.id}: the boss battle takes the first chain, the wrath waits`);
    assert(pressureBossLives(fight.engine.state.board) && extraAngerBeforeGoals(fight.engine.state) === 0 && angerPerTurn(fight.engine.state) === 0 && firstChainPower(fight.engine.state) === 1, `${boss.id}: in the engine no anger before the goals, the first chain 1`);
  }
  console.log(`PASS «wrath» waits for the first battle where it acts: battles under the calm (${checked} runs) and boss battles leave it, the next battle takes it (2 per turn in the engine); reloads change nothing`);
}

/** «Засада у брода»: a trail battle of the pool; a victory gives its talisman choice; a defeat ends the run; refusal is safe. */
function rewardBattle() {
  for (const from of [1, 400]) {
    const run = reach('ford-ambush', { ...RICH, from }), node = runNode(run, (run.pending as { nodeId: string }).nodeId)!;
    const view = eventView(run)!.options.find(option => option.id === 'fight')!;
    assert(view.available && view.battle?.battleId && view.outcomes[0].text.includes('поражение заканчивает поход'), 'the fight shows its battle and reward');
    const accepted = ok(chooseEventOption(run, 'fight'), 'fight'), setup = battleSetup(accepted)!;
    assert(setup.template.id === view.battle!.battleId && poolCandidates({ row: node.row, type: 'battle', lane: node.lane }, accepted.tools).includes(setup.template.id)
      && forestBattle(setup.template.id) && setup.row === node.row, `the reward battle is a trail battle of row ${node.row} (${setup.template.id})`);
    assert(accepted.streams!.pool === run.streams!.pool + 1 && json(roundTrip(accepted)) === json(accepted), 'it draws from the pool stream; the open battle survives a save');
    // Victory: the battle's own rules, then two common talismans to choose from; the node completes after the choice.
    const won = playBattle(accepted); won.engine.winLevel();
    const offered = ok(resolveBattle(accepted, won.engine.runBattleOutcome()!), 'win');
    assert(offered.pending?.kind === 'talisman' && offered.pending.source === 'event' && offered.pending.options.length === 2
      && offered.pending.options.every(option => option !== 'blank' && talisman(option).rarity === 'common'), `a victory offers two common talismans (${json(offered.pending)})`);
    assert(json(roundTrip(offered)) === json(offered), 'the reward choice survives a save');
    const options = (offered.pending as { options: string[] }).options, taken = ok(chooseTalisman(offered, options[0] as never), 'take');
    assert(taken.talismans.at(-1) === options[0] && taken.talismansGone.includes(options[1] as never) && taken.pending === null && taken.currentNodeId === node.id
      && taken.eventChoices.at(-1)!.option === 'fight' && forestRunView(taken).battlesWon === forestRunView(run).battlesWon + 1 && json(roundTrip(taken)) === json(taken), 'the talisman is taken, the event completes');
    // The won battle is an ordinary battle of the run's score (decision of 04.10.2026); a refused fight is not.
    const ordinary = (entry: ForestRunState) => forestRunScore(entry).lines.find(line => line.id === 'battles')?.points ?? 0;
    assert(ordinary(taken) === ordinary(run) + 2, `the ambush battle adds 2 to «обычные бои» (${ordinary(run)} → ${ordinary(taken)})`);
    const refused = ok(chooseTalisman(offered, null), 'refuse the reward');
    assert(refused.pending === null && refused.talismans.length === run.talismans.length, 'the reward may be refused');
    // Defeat: the run ends at the event node.
    const lost = playBattle(accepted); lost.engine.damagePlayer(99);
    const ended = ok(resolveBattle(accepted, lost.engine.runBattleOutcome()!), 'lose');
    assert(ended.result?.outcome === 'defeat' && ended.result.nodeId === node.id && !availableNodes(ended).length && json(roundTrip(ended)) === json(ended), 'a defeat ends the run');
    // Refusal: «Обойти по кустам» is always there and free.
    const bushes = ok(chooseEventOption(run, 'bushes'), 'bushes');
    assert(bushes.pending === null && json(bushes.resources) === json(run.resources) && bushes.streams!.pool === run.streams!.pool, 'refusing the battle is free and plays no battle');
    assert(ordinary(bushes) === ordinary(run), 'a refused fight adds no battle to the score');
  }
  console.log('PASS the reward battle: a trail battle of the pool; a victory offers two common talismans; a defeat ends the run; refusal is free');
}

/** Many random runs: each event at most once, branch events only in their branch and rows, closed events never; a node with no event left becomes a find. */
function placement() {
  // `crowded`: the run's map as a generator-3 map could be (a saved run keeps it): events on every node of rows 6–8 and of
  // the branch rows 10–11, so a route meets five events.
  const walk = (k: number, unlocks: number | undefined, loot: boolean, crowded = false) => {
    let run = createForestRun(spread(k), { map: 'generated', skipTrunk: true, ...unlocks !== undefined ? { unlocks } : {} }), choice = spread(k + 99);
    if (crowded && run.map.kind === 'generated') run = { ...run, map: { ...run.map, generator: 3, nodes: run.map.nodes.map(node => /^r[678]c|^(den|camp)-r1[01]c/.test(node.id) ? { ...node, type: 'event' as const } : node) } };
    const state = { battles: 0 }, plan: Plan = { loot: loot ? { dew: 2, powder: 1 } : undefined };
    for (let guard = 0; guard < 120 && !run.result; guard++) {
      if (run.pending) { run = settle(run, plan, state); continue; }
      choice = spread(choice + 1);
      const next = availableNodes(run), events = next.filter(node => node.type === 'event'), list = events.length ? events : next;
      run = ok(enterNode(run, list[choice % list.length].id), 'walk');
    }
    return run;
  };
  const seen = (level: number | undefined, loot: boolean, runs: number) => {
    const met = new Set<string>();
    let finds = 0, eventNodes = 0;
    for (let k = 1; k <= runs; k++) {
      const run = walk(k, level, loot), ids: string[] = [];
      for (const pick of run.picks) {
        const node = runNode(run, pick.nodeId)!;
        if (node.type !== 'event') continue;
        eventNodes++;
        if (pick.find) { finds++; assert(node.content.kind === 'find', 'an event node without an event is a find'); continue; }
        const event = forestEvent(pick.eventId!)!;
        assert(!ids.includes(event.id), `${run.seed}: ${event.id} twice in a run`);
        assert(eventFits(event, node), `${run.seed}: ${event.id} (${event.branch}) on ${node.id}`);
        if (event.branch === 'den' || event.branch === 'camp') assert(node.lane === event.branch && node.row >= 10 && node.row <= 11, `${run.seed}: ${event.id} only in its branch`);
        if (event.branch === 'trails') assert(node.row >= 6 && node.row <= 8, `${run.seed}: ${event.id} only on the trails`);
        ids.push(event.id); met.add(event.id);
      }
      assert(json(roundTrip(run)) === json(run), `${run.seed}: the walked run survives a save`);
    }
    return { met, finds, eventNodes };
  };
  const closed = seen(0, true, 150);
  for (const id of ['goblin-cache', 'ford-ambush', 'bone-wheel', 'den-bones', 'shaman-idol']) assert(!closed.met.has(id), `level 0: closed ${id} never comes`);
  // An event node with no open event left to fit it becomes a find. A map of generator 4 holds at most 2 events on a
  // route, so at level 0 an event node always has one left; a saved generator-3 map could hold more: on such a map (all
  // free nodes of rows 6–8 and 10–11 events) a branch at level 0 has two own or common events, so a route that met
  // «Костёр путника» on the trails finds none left on row 11. Searched, not fixed; the save replays the find.
  let found: ForestRunState | null = null, searched = 0;
  for (let k = 1000; k < 6000 && !found; k++, searched++) {
    const run = walk(k, 0, false, true), pick = run.picks.find(entry => entry.find);
    if (!pick) continue;
    found = run;
    const node = runNode(run, pick.nodeId)!, before = { ...run, picks: run.picks.slice(0, run.picks.indexOf(pick)) };
    assert(node.type === 'event' && node.content.kind === 'find' && !eventCandidates(before, node).filter(id => !FOREST_EVENTS[id].requires).length, `${run.seed}: ${node.id} became a find with no event left`);
    assert(run.finds.some(entry => entry.nodeId === node.id) && json(roundTrip(run)) === json(run), `${run.seed}: the find was offered and taken; the run survives a save`);
  }
  assert(found, `a node with no open event left becomes a find (searched ${searched} runs)`);
  const open = seen(5, true, 150);
  assert(Object.keys(FOREST_EVENTS).every(id => open.met.has(id)), `level 5: every event comes (${[...open.met].join(', ')})`);
  console.log(`PASS placement on 300 runs: each event once, branch events in their branch, closed ones never (level 0), all 14 at level 5; a node with no event left became a find on a generator-3 map (seed ${found!.seed}, ${searched} runs searched)`);
}

/** Forged saves are rejected: another outcome, an extra attempt, a reward without a victory, a closed event, a lost modifier, a find where an event fits. */
function forgery() {
  const cache = ok(chooseEventOption(reach('goblin-cache', RICH), 'break'), 'break');
  assert(cache && forge(cache, v => { v.eventChoices.at(-1).outcome = 1 - v.eventChoices.at(-1).outcome; }) === null, 'another outcome is rejected');
  let nest = reach('porcupine-nest', HEALTHY);
  nest = ok(chooseEventOption(ok(chooseEventOption(nest, 'search'), 'search'), 'search'), 'search');
  assert(forge(nest, v => { v.pending.attempts.push(0); v.streams.events++; }) === null, 'a fourth attempt in the open event is rejected');
  assert(forge(nest, v => { v.pending.attempts[1] = 1 - v.pending.attempts[1]; }) === null, 'another attempt outcome is rejected');
  const left = ok(chooseEventOption(nest, 'leave'), 'leave');
  assert(forge(left, v => { v.eventChoices.at(-1).attempts.push(0); v.streams.events++; }) === null, 'an extra attempt in the record is rejected');
  assert(forge(left, v => { v.eventChoices.at(-1).attempts.pop(); v.streams.events--; }) === null, 'a missing attempt is rejected');
  // A reward without a victory: the talisman choice of the ambush made from the open event, or a record of the fight without its battle.
  const ambush = reach('ford-ambush', RICH);
  assert(forge(ambush, v => { v.pending = { kind: 'talisman', nodeId: v.pending.nodeId, source: 'event', options: ['whetstone', 'dew-flask'] }; v.streams.talismans++; }) === null, 'a reward choice without the battle is rejected');
  const bushes = ok(chooseEventOption(ambush, 'bushes'), 'bushes');
  assert(forge(bushes, v => { v.eventChoices.at(-1).option = 'fight'; v.eventChoices.at(-1).outcome = 0; delete v.modifiers; }) === null, 'a fight without its battle is rejected');
  assert(forge(bushes, v => { delete v.modifiers; }) === null, 'a lost modifier is rejected');
  const fought = ok(chooseEventOption(ambush, 'fight'), 'fight');
  assert(forge(fought, v => { v.pending.modifiers = ['first-chain-power']; }) === null, 'a battle with a modifier it did not take is rejected');
  // A closed event (the review of the bar: unlocks 0 and «Гоблинский тайник»).
  const level0 = reach('brook', { ...RICH, unlocks: 0 });
  assert(roundTrip(level0) && forge(level0, v => { v.picks.at(-1).eventId = 'goblin-cache'; }) === null, 'a closed event in a save is rejected');
  assert(forge(level0, v => { v.picks[v.picks.length - 1] = { nodeId: v.picks.at(-1).nodeId, find: true }; v.pending = { kind: 'find', nodeId: v.pending.nodeId, options: [] }; }) === null, 'a find where an event fits is rejected');
  // Payments and the maximum HP.
  const stew = ok(chooseEventOption(reach('drunk-cook', RICH), 'stew'), 'stew');
  assert(forge(stew, v => { const paid = v.eventChoices.at(-1).paid; const kind = Object.keys(paid).find(key => paid[key] > 0)!; paid[kind]--; }) === null, 'a payment short of the price is rejected');
  const bow = ok(chooseEventOption(reach('shaman-idol', RICH), 'bow'), 'bow');
  assert(bow.resources.player.maxHp === 4 && forge(bow, v => { v.resources.player.maxHp = 5; }) === null, 'the maximum HP the idol took is checked');
  // The pick of an event node is the roll of its entering draw: another event that fits the node is rejected, open and after leaving.
  let swapped = 0;
  for (const id of ['old-trap', 'drunk-cook', 'traveler-fire', 'brook']) {
    const run = reach(id, RICH), nodeId = (run.pending as { nodeId: string }).nodeId, before = { ...run, picks: run.picks.slice(0, -1) };
    const other = eventCandidates(before, runNode(run, nodeId)!).find(entry => entry !== id && FOREST_EVENTS[entry].options.some(option => option.id === 'leave'));
    if (!other) continue;
    const swap = (v: any) => { v.picks.at(-1).eventId = other; };
    assert(roundTrip(run) && forge(run, swap) === null, `${id} → ${other}: another fitting event in the open node is rejected`);
    const leave = FOREST_EVENTS[id].options.some(option => option.id === 'leave') ? ok(chooseEventOption(run, 'leave'), 'leave') : null;
    if (leave) assert(roundTrip(leave) && forge(leave, swap) === null, `${id} → ${other}: another fitting event after leaving is rejected`);
    swapped++;
  }
  assert(swapped >= 3, `swapped picks checked (${swapped})`);
  // Saves of generator 2 (before the catalogue) may repeat an event once the two events of that time open in the run were met; new maps may not.
  const twice = reach('owl-hollow', { ...RICH, unlocks: 0, events: true, accept: run => run.picks.some(pick => pick.eventId === 'brook') });
  const repeat = (generator: number) => forge(twice, v => { v.map.generator = generator; v.picks.at(-1).eventId = 'brook'; });
  assert(repeat(3) === null && repeat(2) !== null, 'a repeated event loads only from a map of generator 2');
  console.log('PASS forged saves are rejected: outcomes, attempts, a reward without a victory, a closed event, another fitting event, modifiers, payments, the maximum HP; generator-2 repeats load');
}

data();
everyOption();
hpFloor();
unaffordable();
shares();
escalation();
reloads();
modifiers();
wrathWaits();
rewardBattle();
placement();
forgery();
console.log('Event catalogue checks passed.');
