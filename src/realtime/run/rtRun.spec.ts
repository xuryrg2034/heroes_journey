/**
 * The run of the real-time game (stage 2 of the transition, step 1; docs/realtime-slice.md, «Реализация (шаг 1)»).
 * Node only: `npm run test:realtime-run`. Everything goes through the run's commands and, on battle nodes, through the
 * arena simulation driven by journalled commands — the same path the page takes (runView.ts → main.ts):
 * - the map is the turn-based generator's map of the run seed; the run starts past the trunk with 12 HP and the gift;
 * - a battle node plays an arena of the pool of its run row (any of 1–3 / temporary final marked), seeded by the run seed
 *   and the node id; the hero enters it with the run's HP; a victory returns to the map, a defeat ends the run;
 * - whole runs walk to the boss on spread seeds; saves load back at every step; a reload starts the open arena again;
 * - a run arena replays from its journal (with the hero's starting HP) to the same hash;
 * - HP numbers of the turn-based run arrive ×2.4 rounded up: rest, merchant, gift, hard battle, events;
 * - events without an analogue in the slice never come; their off options cannot be taken;
 * - step 3: consumables come from a find, a craft, the merchant, the gift and events, open as in the turn-based run,
 *   go into the arena as its loadout, are used there through commands and come back; the energy of the gift and events
 *   starts the next arena; the full gift is the turn-based roll as it is;
 * - different seeds give different maps and arena sequences; the real-time keys only are written.
 */
import { generateForestMap } from '../../game/run/mapGenerator';
import { forestEvent } from '../../game/run/forestEvents';
import { forestNodeSeed } from '../../game/run/forestRun';
import { FOREST_HARD_HEAL, FOREST_REST_HEAL } from '../../game/run/forestMap';
import { FOREST_RUN_STORAGE_KEY, type RunStorage } from '../../game/run/forestRunStorage';
import { PLAYER_PROFILE_KEY } from '../../game/run/playerProfile';
import { defaultParams } from '../sim/params';
import { goalProgress } from '../sim/world';
import { GIFT_STREAMS, rollGift } from '../../game/run/runGift';
import { rewardChoices } from '../../game/items';
import { shopStock } from '../../game/run/merchant';
import { streamValue } from '../../game/run/runStreams';
import { NODE_TYPE_INFO } from '../../forestMapScreen';
import { RT_NODE_TYPES } from '../view/nodeTypes';
import { EVENT_RISK_MIN_HP } from '../../game/run/forestEvents';
import { replay, Simulation } from '../sim/simulation';
import { arenaCandidates, ARENA_POOLS, arenaTitle, runRow, STAND_IN_ARENAS, TEMPORARY_FINAL_ARENAS } from './arenaPools';
import { rtHp, RT_RUN_HP } from './hpScale';
import {
  arenaPreview, arenaSeed, createRtRun, GIFT_POOL, rtMapNodes, parseRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick,
  rtChooseTalisman, rtEnterNode, rtEventView, rtGiftOptions, rtGiftView, rtNode, rtRestCraft, rtRestFinish, rtRestHeal, rtRestView, rtShopBuy, rtShopLeave, rtShopView, serializeRtRun,
  type RtRunState, type RtRunStep,
} from './rtRun';
import type { ItemKind } from '../sim/kit';
import type { GiftOption } from '../../game/run/runGift';
import { RT_TALISMANS_OFF, rtShopTalisman, rtTalisman, rtTalismanOffer } from './rtTalismans';
import { createRtProfileStore, createRtRunStore, RT_PROFILE_STORAGE_KEY, RT_RUN_STORAGE_KEY } from './rtRunStorage';
import { SLICE_EVENTS, SLICE_EVENTS_OFF } from './sliceEvents';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds: neighbouring small seeds roll alike in some generators. */
const SEEDS = Array.from({ length: 10 }, (_, k) => Math.imul(k + 1, 2654435761) >>> 0);

function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}
const roundTrip = (run: RtRunState) => parseRtRun(serializeRtRun(run));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- The arena of a node, played through commands ----

/** The arena of the open battle node, as main.ts starts it: the pending arena and seed, the run's HP and loadout. */
function startArena(run: RtRunState): Simulation {
  const pending = run.pending;
  assert(pending?.kind === 'battle', 'no open battle');
  return new Simulation({ arena: pending.arena, params: defaultParams(), seed: pending.seed, record: true, hero: { hp: run.hp, maxHp: run.maxHp }, loadout: rtArenaLoadout(run) });
}
/**
 * Plays the arena a while (the horde arrives and touches the hero), then the goals are marked done and the hero walks into
 * the open door from 1.4 units inside the arena: the door's own rule (a new touch while walking) wins it.
 */
function winArena(sim: Simulation, warmup = 90): void {
  const w = sim.world;
  for (let i = 0; i < warmup && w.status === 'playing'; i++) sim.tick();
  if (w.status !== 'playing') return;
  sim.command({ t: 'goals' });
  const door = w.objects.find(o => o.kind === 'door')!, dx = w.arena.width / 2 - door.x, dy = w.arena.height / 2 - door.y, len = Math.hypot(dx, dy);
  sim.command({ t: 'teleport', x: door.x + dx / len * 1.4, y: door.y + dy / len * 1.4 });
  sim.command({ t: 'walk', x: -dx / len, y: -dy / len });
  for (let i = 0; i < 900 && w.status === 'playing'; i++) sim.tick();
}
/** Stands still in a ring of enemies until the hero falls (a lost arena). */
function loseArena(sim: Simulation): void {
  const w = sim.world;
  for (let k = 0; k < 8; k++) sim.command({ t: 'place', x: w.hero.x + Math.cos(k * Math.PI / 4) * 0.6, y: w.hero.y + Math.sin(k * Math.PI / 4) * 0.6, color: k % 4, hp: 2, kind: 'basic' });
  for (let i = 0; i < 60 * 120 && w.status === 'playing'; i++) sim.tick();
}
const outcomeOf = (run: RtRunState, sim: Simulation) => {
  const w = sim.world, pending = run.pending!;
  return { nodeId: (pending as { nodeId: string }).nodeId, won: w.status === 'victory', hp: w.hero.hp, kills: w.stats.kills, damage: w.stats.damageTaken, time: w.endTime ?? w.time,
    ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials }, wardUsed: w.kit.wardUsed } : {} };
};
/** Takes the first gift button that is on (and the first of its own choice, if it has one), or passes the gift by. */
function takeGift(run: RtRunState, prefer?: (kind: string) => boolean): RtRunState {
  const view = rtGiftView(run)!, on = view.options.filter(entry => entry.available), first = on.find(entry => prefer?.(entry.option.kind)) ?? on[0];
  let next = ok(rtChooseGift(run, first ? first.index : null), 'gift');
  const open = rtGiftView(next);
  if (open && open.chosen !== null) next = ok(rtChooseGiftPick(next, open.picks[0]), 'gift pick');
  return next;
}

// ---- A bot that walks a whole run through the run's commands ----

interface Walk { run: RtRunState; arenas: string[]; standIns: string[]; finals: string[]; rowArenas: [number, string][]; events: string[]; saves: number; replays: number; previews: number; finds: number; crafts: number; bought: number; offers: string[] }

function walkRun(seed: number, k: number, options: { gift?: 'mini' | 'full' } = {}): Walk {
  let run = createRtRun(seed, { gift: options.gift ?? 'mini' });
  const walk: Walk = { run, arenas: [], standIns: [], finals: [], rowArenas: [], events: [], saves: 0, replays: 0, previews: 0, finds: 0, crafts: 0, bought: 0, offers: [] };
  const save = () => { const loaded = roundTrip(run); assert(loaded && same(loaded, run), `save of seed ${seed} does not load back`); walk.saves++; };
  for (let step = 0; step < 200 && !run.result; step++) {
    save();
    const pending = run.pending;
    if (pending?.kind === 'gift') { run = takeGift(run); continue; }
    if (pending?.kind === 'battle') {
      const node = rtNode(run, pending.nodeId)!;
      assert(pending.seed === forestNodeSeed(seed, node.id), 'arena seed is the run seed and the node id');
      if (pending.battle === 'final') { assert(TEMPORARY_FINAL_ARENAS.includes(pending.arena) && pending.standIn === 'final', 'boss: temporary final arena'); walk.finals.push(pending.arena); }
      else {
        const { arenas, any } = arenaCandidates(runRow(node.row));
        assert(arenas.includes(pending.arena), `${node.id}: arena ${pending.arena} outside the pool of run row ${runRow(node.row)}`);
        assert(!!pending.standIn === any, 'stand-in marked exactly when the row has no arena');
        if (any) walk.standIns.push(pending.arena); else
          walk.rowArenas.push([runRow(node.row), pending.arena]);
      }
      walk.arenas.push(pending.arena);
      const hpBefore = run.hp, sim = startArena(run);
      assert(sim.world.hero.hp === run.hp && sim.world.hero.maxHp === run.maxHp, 'the hero enters with the run HP');
      assert(same(sim.world.kit!.items, run.items) && sim.world.energy === Math.min(7, run.energy + 2 * run.talismans.filter(id => id.startsWith('oath-')).length), 'the hero enters with the run\'s consumables and banked energy (+2 an oath)');
      assert(same(sim.world.kit!.talismans, run.talismans), 'the run\'s talismans act in the arena');
      // Step 3: a consumable in hand is used on the arena (healing when hurt, else a bomb on the nearest enemy).
      for (let i = 0; i < 30; i++) sim.tick();
      const target = sim.world.enemies[0];
      if (run.items.bomb && target) sim.command({ t: 'teleport', x: target.x - 1, y: target.y }), sim.command({ t: 'item', kind: 'bomb', x: target.x, y: target.y });
      winArena(sim);
      // Every fourth arena of the walk also replays from its journal.
      if (walk.arenas.length % 4 === 1) {
        const journal = sim.exportJournal()!, again = replay(JSON.parse(JSON.stringify(journal)));
        assert(again.hash() === sim.hash() && again.world.status === sim.world.status, 'a run arena replays from its journal');
        walk.replays++;
      }
      assert(sim.world.status !== 'playing', 'the arena ended');
      const outcome = outcomeOf(run, sim);
      run = ok(resolveArena(run, outcome), 'resolve');
      if (!outcome.won) { assert(run.result?.outcome === 'defeat', 'a lost arena ends the run'); break; }
      // Back on the map (a hard battle and the Jailer's row: after the talisman choice): the node is done, the HP is the
      // arena's (+ the heart of a hard battle).
      const heart = pending.battle === 'hard' ? Math.min(rtHp(FOREST_HARD_HEAL), run.maxHp - outcome.hp) : 0;
      assert(run.hp === outcome.hp + heart && run.hp <= run.maxHp, `HP after the arena: ${run.hp} (arena ${outcome.hp}, before ${hpBefore})`);
      assert(same(run.items, outcome.items) && run.energy === 0, 'the consumables left come back; the banked energy is spent');
      if (node.type === 'hard' || node.type === 'checkpoint') {
        const offer = run.pending as Extract<RtRunState['pending'], { kind: 'talisman' }>;
        assert(offer?.kind === 'talisman' && offer.source === (node.type === 'hard' ? 'hard' : 'oath') && same(roundTrip(run), run), `${node.type}: a talisman choice, saved`);
        walk.offers.push(...offer.options);
        const pick = offer.options[(k + step) % (offer.options.length + 1)] ?? null, maxHp = run.maxHp;
        run = ok(rtChooseTalisman(run, pick), 'talisman');
        if (pick === 'tough-hide') assert(run.maxHp === maxHp + rtHp(1), 'Крепкая шкура: +3 to the maximum');
        if (pick && pick !== 'blank') assert(run.talismans.includes(pick), 'taken');
        assert(offer.options.filter(option => option !== 'blank' && option !== pick).every(option => run.talismansGone.includes(option)), 'the others leave the pool');
      }
      assert(run.pending === null && run.visited[run.visited.length - 1] === node.id, 'victory returns to the map');
      continue;
    }
    if (pending?.kind === 'rest') {
      const view = rtRestView(run)!, before = run.hp, recipe = view.recipes.find(entry => entry.available);
      // Rest heal ×2.4; «Фляга росы» +3, «Клятва голода» and the gift's price «следующий привал не лечит» — 0.
      const expectedHeal = run.talismans.includes('oath-hunger') || run.restNoHeal ? 0 : rtHp(FOREST_REST_HEAL) + (run.talismans.includes('dew-flask') ? rtHp(1) : 0);
      assert(view.heal.value === expectedHeal, `rest heal ${view.heal.value}, expected ${expectedHeal}`);
      // Craft when a recipe is ready (every other walk), else heal.
      if (recipe && k % 2 === 0) {
        const had = run.items[recipe.item];
        run = ok(rtRestCraft(run, recipe.resource), 'craft');
        assert(run.items[recipe.item] === had + 1 && run.openItems.includes(recipe.item) && !rtRestView(run)!.heal.available, 'craft: +1, open, no heal');
        run = ok(rtRestFinish(run), 'rest finish');
        walk.crafts++;
        continue;
      }
      run = ok(rtRestHeal(run), 'rest');
      assert(run.hp === Math.min(run.maxHp, before + expectedHeal) && !run.restNoHeal, 'rest heals up to the maximum');
      continue;
    }
    if (pending?.kind === 'find') {
      const item = pending.options[(k + step) % pending.options.length], had = run.items[item];
      run = ok(rtChooseFind(run, item), 'find');
      assert(run.items[item] === had + 1 && run.openItems.includes(item), 'find: +1, open');
      walk.finds++;
      continue;
    }
    if (pending?.kind === 'shop') {
      const view = rtShopView(run)!;
      for (const good of view.goods) if (good.available) {
        const before = { hp: run.hp, maxHp: run.maxHp, items: { ...run.items } };
        run = ok(rtShopBuy(run, good.id), 'buy');
        if (good.id === 'heal') assert(run.hp === Math.min(run.maxHp, before.hp + rtHp(1)), 'merchant heal ×2.4');
        else if (good.id === 'harden') assert(run.maxHp === before.maxHp + rtHp(1) && run.hp === before.hp + rtHp(1), 'hardening ×2.4');
        else if (good.item) { assert(run.items[good.item] === before.items[good.item] + 1 && run.openItems.includes(good.item), 'a consumable bought: +1, open'); walk.bought++; }
      }
      run = ok(rtShopLeave(run), 'leave shop');
      continue;
    }
    if (pending?.kind === 'event') {
      const view = rtEventView(run)!;
      walk.events.push(view.event.id);
      // Off options of the slice cannot be taken.
      for (const option of view.options.filter(entry => entry.off)) assert(!rtChooseEventOption(run, option.id).ok, `${view.event.id}/${option.id} is off`);
      const options = view.options.filter(entry => entry.available);
      const choice = options[(k + step) % options.length];
      const option = view.event.options.find(entry => entry.id === choice.id)!, before = run.hp;
      run = ok(rtChooseEventOption(run, choice.id), 'event');
      // A sure outcome with HP arrives ×2.4 (never below 1, never above the maximum).
      if (!option.battle && !option.escalation && option.outcomes.length === 1 && !option.cost) {
        const effect = option.outcomes[0].effect;
        const expected = Math.min(run.maxHp, Math.max(1, before + rtHp(effect.maxHp ?? 0) + rtHp(effect.hp ?? 0)));
        assert(run.hp === expected, `${view.event.id}/${option.id}: HP ${before} → ${run.hp}, expected ${expected}`);
      }
      continue;
    }
    const next = rtAvailableNodes(run);
    assert(next.length > 0, 'a run without a result has a way on');
    // The map shows the arena of an available node — the one it plays; a node further on shows none yet.
    const chosen = next[(k + step) % next.length], preview = arenaPreview(run, chosen);
    for (const node of rtMapNodes(run)) if (!next.includes(node) && !run.picks.some(pick => pick.nodeId === node.id)) assert(arenaPreview(run, node) === null, `${node.id}: no arena before it opens`);
    run = ok(rtEnterNode(run, chosen.id), 'enter');
    if (run.pending?.kind === 'battle') { assert(preview?.arena === run.pending.arena, `${chosen.id}: previewed ${preview?.arena}, played ${run.pending.arena}`); walk.previews++; }
  }
  walk.run = run;
  return walk;
}

// ---- Checks ----

check('HP of the run: 12, turn-based HP numbers ×2.4 rounded up (one factor)', () => {
  assert(RT_RUN_HP === 12, 'run HP 12');
  assert([1, 2, 3, 5, -1, -2].map(rtHp).join() === '3,5,8,12,-3,-5', 'rtHp');
  const run = createRtRun(SEEDS[0]);
  assert(run.hp === 12 && run.maxHp === 12, 'a run starts with 12 / 12');
});

check('the map is the turn-based generator\'s map of the run seed; the run starts past the trunk', () => {
  for (const seed of SEEDS) {
    const run = createRtRun(seed);
    assert(same(run.map, generateForestMap(seed)), 'map of the turn-based generator');
    const starts = rtAvailableNodes(run);
    assert(starts.length > 0 && starts.every(node => node.row === 5), 'first transitions: row 5 (no trunk)');
  }
  const maps = new Set(SEEDS.map(seed => JSON.stringify(createRtRun(seed).map)));
  assert(maps.size === SEEDS.length, `different seeds, different maps (${maps.size} of ${SEEDS.length})`);
});

check('the start gift: its usual buttons (consumables, energy, resources, maximum HP, a talisman for a price, an oath); «тихий лес» off', () => {
  const mini = createRtRun(SEEDS[1], { gift: 'mini' });
  const view = rtGiftView(mini)!;
  assert(view.options.map(entry => `${entry.option.kind}:${entry.available}`).join() === 'items:true,max-hp:true', `mini gift: ${view.options.map(entry => entry.option.kind)}`);
  assert(rtAvailableNodes(mini).length === 0, 'the gift waits before the row-5 nodes');
  assert(!rtChooseGift(mini, null).ok, 'a pass is refused while a button is on');
  const taken = ok(rtChooseGift(mini, 1), 'gift');
  assert(taken.maxHp === 12 + rtHp(1) && taken.hp === 12 + rtHp(1), 'max HP gift ×2.4');
  const items = (mini.gift!.options[0] as { items: ItemKind[] }).items, withItems = ok(rtChooseGift(mini, 0), 'items gift');
  assert(items.every(item => withItems.items[item] === items.filter(other => other === item).length) && withItems.openItems.length === new Set(items).size, 'two consumables: in hand and open');
  const kinds = new Set<string>();
  for (const seed of SEEDS) {
    const run = createRtRun(seed, { gift: 'full' }), full = rtGiftView(run)!;
    for (const entry of full.options) {
      kinds.add(entry.option.kind);
      // «Тихий лес» has no analogue (no anger); a deal or an oath is on while the pool has its talisman.
      assert(entry.option.kind === 'calm' ? !entry.available : entry.available || entry.reason === 'Талисманов не осталось', `full gift: ${entry.option.kind} ${entry.available} ${entry.reason}`);
    }
    assert(GIFT_STREAMS.full.every(stream => run.streams[stream] === 1) && same(run.gift!.options, rollGift(seed, 'full', GIFT_POOL).options), 'no extra draw');
    // A button with a choice of its own: the gift stays open until the consumable is picked.
    const pickEntry = full.options.find(entry => entry.option.kind === 'pick-item');
    if (pickEntry) {
      const chosen = ok(rtChooseGift(run, pickEntry.index), 'pick button'), open = rtGiftView(chosen)!;
      assert(chosen.pending?.kind === 'gift' && open.picks.length === 3 && same(roundTrip(chosen), chosen), 'the own choice is open and loads back');
      const done = ok(rtChooseGiftPick(chosen, open.picks[2]), 'pick');
      assert(done.pending === null && done.items[open.picks[2] as ItemKind] === 1, 'the picked consumable is in hand');
    }
    const energy = full.options.find(entry => entry.option.kind === 'energy');
    if (energy) assert(ok(rtChooseGift(run, energy.index), 'energy').energy === 2, 'energy banked for the first arena');
  }
  assert(['pick-item', 'items', 'energy', 'resources', 'max-hp', 'deal', 'oath'].every(kind => kinds.has(kind)), `full gift kinds met: ${[...kinds]}`);
});

check('the full gift is the turn-based roll as it is (design answer to step 3): four buttons, a −3 maximum deal never beside +3 maximum', () => {
  let maxHpDeals = 0;
  for (let k = 1; k <= 500; k++) {
    const seed = Math.imul(k, 2654435761) >>> 0, run = createRtRun(seed, { gift: 'full' }), view = rtGiftView(run)!;
    assert(same(view.options.map(entry => entry.option), rollGift(seed, 'full', GIFT_POOL).options) && view.options.length === 4, `seed ${seed}: the roll as it is`);
    const deal = view.options[2].option as Extract<GiftOption, { kind: 'deal' }>;
    if (deal.price === 'max-hp') { maxHpDeals++; assert(!view.options.some(entry => entry.option.kind === 'max-hp'), `seed ${seed}: −3 maximum beside +3 maximum`); }
  }
  assert(maxHpDeals > 0, 'deals for the maximum came');
  assert(rtGiftOptions(SEEDS[0], createRtRun(SEEDS[0], { gift: 'mini' }).gift!).length === 2, 'the mini gift is as rolled');
});

let walks: Walk[] = [];
check('whole runs walk to the boss: arenas of the row pools, seeds of the node, victories back to the map, saves load', () => {
  walks = SEEDS.map((seed, k) => walkRun(seed, k));
  const won = walks.filter(walk => walk.run.result?.outcome === 'victory');
  for (const walk of walks) assert(walk.run.result, 'every walk ends');
  assert(won.length >= SEEDS.length - 2, `most walks reach the boss and win (${won.length} of ${SEEDS.length})`);
  for (const walk of won) {
    const last = rtNode(walk.run, walk.run.result!.nodeId)!;
    assert(last.type === 'boss' && walk.arenas.length >= 6, 'a run ends at the boss after its battles');
  }
  const replays = walks.reduce((sum, walk) => sum + walk.replays, 0), saves = walks.reduce((sum, walk) => sum + walk.saves, 0);
  console.log(`   ${won.length}/${walks.length} won, ${walks.reduce((sum, walk) => sum + walk.arenas.length, 0)} arenas, ${replays} replayed, ${saves} saves loaded back`);
});

check('arenas of the new enemies come on their rows; rows without an arena yet play any of arenas 1–3; Поляна of the run kills 20', () => {
  // Step 2: arenas 4–7 stand on their rows (section 5); only rows no arena covers (run row 9 until arena 8) play a stand-in.
  // Design answer to step 2: row 9 and the boss play any of arenas 1–7 (the pool stream and its window), not only 1–3.
  const standIns = new Set(walks.flatMap(walk => walk.standIns)), finals = new Set(walks.flatMap(walk => walk.finals));
  const late = (set: Set<string>) => [...set].some(arena => !['glade', 'buttons', 'marked'].includes(arena));
  assert(STAND_IN_ARENAS.length === 7 && TEMPORARY_FINAL_ARENAS.length === 7, 'stand-ins: arenas 1–7');
  assert(standIns.size >= 3 && late(standIns) && [...standIns].every(arena => STAND_IN_ARENAS.includes(arena)), `stand-in rows play: ${[...standIns].join(', ')}`);
  assert(finals.size >= 3 && late(finals), `boss nodes play: ${[...finals].join(', ')}`);
  for (let row = 1; row <= 8; row++) assert(!arenaCandidates(row).any, `run row ${row} has arenas of its own`);
  const rowsOf = (arena: string) => new Set(walks.flatMap(walk => walk.rowArenas.filter(([, a]) => a === arena).map(([row]) => row)));
  for (const entry of ARENA_POOLS) {
    const rows = rowsOf(entry.arena);
    assert(rows.size > 0 && [...rows].every(row => row >= entry.rows[0] && row <= entry.rows[1]), `${entry.arena} on rows ${[...rows].join(', ')} (pool ${entry.rows.join('–')})`);
  }
  console.log(`   stand-ins: ${[...standIns].join(', ')}; finals: ${[...finals].join(', ')}; ${ARENA_POOLS.map(entry => `${entry.arena} ${[...rowsOf(entry.arena)].sort().join('/')}`).join(', ')}`);
  const glade = new Simulation({ arena: 'glade', params: defaultParams(), seed: 5 });
  assert(goalProgress(glade.world).total === 20, 'Поляна of the run: kill 20');
  assert(goalProgress(new Simulation({ arena: 'kills', params: defaultParams(), seed: 5 }).world).total === defaultParams().killGoal, 'the sandbox arena keeps the slider');
  console.log(`   ${walks.reduce((sum, walk) => sum + walk.previews, 0)} previews equal the arena played`);
});

check('different seeds give different arena sequences; every arena of the pools comes', () => {
  // Three arenas and short pools (run rows 6–9 have only Логово at step 1): coincidences between runs are allowed, a
  // fixed sequence is not.
  const sequences = new Set(walks.map(walk => walk.arenas.join(',')));
  console.log(`   ${[...sequences].slice(0, 4).join(' | ')}`);
  assert(sequences.size >= SEEDS.length / 2, `arena sequences: ${sequences.size} of ${SEEDS.length}`);
  const used = new Set(walks.flatMap(walk => walk.arenas));
  for (const entry of ARENA_POOLS) assert(used.has(entry.arena), `arena ${entry.arena} comes`);
  // The first battle of a run (row 5 → run row 1): Поляна or Двор кнопок, as the pools say.
  const firsts = new Set(walks.map(walk => walk.arenas[0]));
  assert([...firsts].every(arena => arenaCandidates(1).arenas.includes(arena)) && firsts.size === 2, `first arenas: ${[...firsts].join(', ')}`);
  const seeds = new Set(walks.map(walk => arenaSeed(walk.run, walk.run.visited.find(id => rtNode(walk.run, id)!.row === 5)!)));
  assert(seeds.size === walks.length, 'arena seeds differ between runs');
});

check('events: only the slice pool comes; off options are refused; HP outcomes arrive ×2.4', () => {
  const met = walks.flatMap(walk => walk.events);
  assert(met.length > 0, 'events were met');
  for (const id of met) assert(SLICE_EVENTS.includes(id) && !SLICE_EVENTS_OFF.includes(id), `event ${id} in the slice pool`);
  // Step 3: energy, consumables and talismans have their analogues — events left without a safe option on stay out (their
  // other options need a battle modifier).
  assert(SLICE_EVENTS_OFF.join() === 'ford-ambush,den-bones', `off: ${SLICE_EVENTS_OFF.join()}`);
  // A sure risky cost in HP: «Вытащить приманку» costs 1 HP of the turn-based run — 3 here.
  const trap = forestEvent('old-trap')!.options.find(option => option.id === 'bait')!;
  assert(trap.cost && !Array.isArray(trap.cost) && (trap.cost as { hp: number }).hp === 1, 'catalogue: the bait costs 1 HP');
  console.log(`   ${met.length} events met: ${[...new Set(met)].join(', ')}`);
});

check('a lost arena ends the run: nothing more to enter, the save keeps the end, the profile keeps the gift mark', () => {
  const seed = SEEDS[3];
  let run = ok(rtChooseGift(createRtRun(seed, { gift: 'mini' }), 1), 'gift');
  run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  const sim = startArena(run);
  loseArena(sim);
  assert(sim.world.status === 'defeat' && sim.world.hero.hp === 0, 'the hero fell');
  run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve');
  assert(run.result?.outcome === 'defeat' && run.pending === null, 'the run is over');
  assert(rtAvailableNodes(run).length === 0 && !rtEnterNode(run, rtAvailableNodes(createRtRun(seed))[0]?.id ?? 'r5c0').ok, 'nothing to enter');
  assert(same(roundTrip(run), run), 'the end of the run loads back');
  const storage = memoryStorage(), profile = createRtProfileStore(storage);
  assert(profile.giftKind(false) === 'mini' && profile.endRun({ reachedJailer: true, seeded: false }) && profile.giftKind(false) === 'full', 'gift mark');
});

check('a reload in the middle of an arena starts the same arena again from the start; malformed saves read as no run', () => {
  let run = ok(rtChooseGift(createRtRun(SEEDS[4], { gift: 'mini' }), 1), 'gift');
  run = ok(rtEnterNode(run, rtAvailableNodes(run)[1 % rtAvailableNodes(run).length].id), 'enter');
  const first = startArena(run);
  for (let i = 0; i < 200; i++) first.tick();
  const loaded = roundTrip(run)!;
  assert(loaded.pending?.kind === 'battle', 'the open battle node is saved');
  const again = startArena(loaded), fresh = startArena(run);
  assert(again.hash() === fresh.hash() && again.world.tick === 0, 'the arena starts again from its start');
  const text = serializeRtRun(run);
  const broken = [
    text.replace('"version":2', '"version":1'),
    JSON.stringify({ ...run, hp: run.maxHp + 1 }),
    JSON.stringify({ ...run, visited: ['r6c0'], currentNodeId: 'r6c0' }),
    JSON.stringify({ ...run, pending: { ...run.pending, seed: 1 } }),
    '{',
  ];
  for (const bad of broken) assert(parseRtRun(bad) === null, `malformed save accepted: ${bad.slice(0, 60)}`);
});

check('a run arena replays from its journal: the starting HP is part of it', () => {
  let run = ok(rtChooseGift(createRtRun(SEEDS[5], { gift: 'mini' }), 1), 'gift');
  run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  const hurt = { ...run, hp: 4 };
  const sim = startArena(hurt);
  winArena(sim, 240);
  const journal = sim.exportJournal()!;
  assert(same(journal.hero, { hp: 4, maxHp: run.maxHp }), 'the journal keeps the starting HP');
  const again = replay(JSON.parse(JSON.stringify(journal)));
  assert(again.hash() === sim.hash(), 'same hash');
  const full = replay({ ...journal, hero: { hp: run.maxHp, maxHp: run.maxHp } });
  assert(full.hash() !== sim.hash(), 'another starting HP is another arena');
  const old = replay({ ...journal, hero: undefined });
  assert(old.world.hero.maxHp === defaultParams().heroHp, 'a journal without `hero` (stage 1) starts with the panel HP');
});

check('rest and merchant through real visits (HP and resources prepared on entering): heal 5, merchant heal 3, hardening +3 / +3 at 4', () => {
  // Find a seed whose first trail rows reach a rest and a merchant; play to them. On entering, the test sets the HP low
  // (and gives resources at the merchant) so every good can be bought: a setup, the visit itself goes through commands.
  let rested = false, shopped = false;
  for (let k = 0; k < 40 && !(rested && shopped); k++) {
    const seed = Math.imul(k + 101, 2654435761) >>> 0;
    let run = ok(rtChooseGift(createRtRun(seed, { gift: 'mini' }), 1), 'gift');
    for (let step = 0; step < 40 && !run.result; step++) {
      if (run.pending?.kind === 'battle') {
        const sim = startArena(run); winArena(sim);
        run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve');
        continue;
      }
      if (run.pending?.kind === 'rest') {
        run = { ...run, hp: 2 };
        const view = rtRestView(run)!;
        assert(view.heal.amount === rtHp(FOREST_REST_HEAL), 'rest heals 5 from 2');
        run = ok(rtRestHeal(run), 'rest'); assert(run.hp === 2 + rtHp(FOREST_REST_HEAL), 'healed'); rested = true;
        continue;
      }
      if (run.pending?.kind === 'shop') {
        run = { ...run, hp: 1, materials: { dew: 3, powder: 3, resin: 0, herbs: 0 } };
        const view = rtShopView(run)!;
        assert(view.goods.find(good => good.id === 'harden')!.price === 4, 'first hardening costs 4');
        run = ok(rtShopBuy(run, 'heal'), 'heal'); assert(run.hp === 1 + rtHp(1), 'merchant heal +3');
        run = ok(rtShopBuy(run, 'harden'), 'harden'); assert(run.maxHp === 15 + rtHp(1) && run.hp === 1 + 2 * rtHp(1), 'hardening +3 / +3');
        assert(run.materials.dew + run.materials.powder === 6 - 2 - 4, 'paid 2 + 4 resources');
        assert(!rtShopBuy(run, 'harden').ok, 'one hardening a visit');
        run = ok(rtShopLeave(run), 'leave'); shopped = true;
        continue;
      }
      if (run.pending?.kind === 'find') { run = ok(rtChooseFind(run, run.pending.options[0]), 'find'); continue; }
      if (run.pending?.kind === 'talisman') { run = ok(rtChooseTalisman(run, null), 'talisman'); continue; }
      if (run.pending?.kind === 'event') {
        const view = rtEventView(run)!, safe = view.options.find(option => option.safe && option.available)!;
        run = ok(rtChooseEventOption(run, safe.id), 'safe option'); continue;
      }
      const next = rtAvailableNodes(run), pick = next.find(node => node.type === 'rest' && !rested) ?? next.find(node => node.type === 'shop' && !shopped) ?? next[0];
      run = ok(rtEnterNode(run, pick.id), 'enter');
    }
  }
  assert(rested && shopped, 'a rest and a merchant were visited');
});

check('the reward battle of an event is an arena of the node\'s row; its victory completes the event, its defeat ends the run', () => {
  // «Засада у брода» is out of the slice pool at step 1 (its safe options need energy and modifiers), so play never meets
  // it: the test puts it on a real entered event node (setup), then plays the arena through commands.
  let base: RtRunState | null = null;
  for (let k = 0; k < 40 && !base; k++) {
    let run = ok(rtChooseGift(createRtRun(Math.imul(k + 201, 2654435761) >>> 0, { gift: 'mini' }), 1), 'gift');
    for (let step = 0; step < 12 && !base && !run.result; step++) {
      if (run.pending?.kind === 'battle') { const sim = startArena(run); winArena(sim); run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve'); continue; }
      if (run.pending?.kind === 'event') { base = run; break; }
      if (run.pending) break;
      const next = rtAvailableNodes(run), pick = next.find(node => node.type === 'event' && node.row <= 8) ?? next.find(node => node.type === 'battle');
      if (!pick) break;
      run = ok(rtEnterNode(run, pick.id), 'enter');
    }
  }
  assert(base && base.pending?.kind === 'event', 'an event node on the trails');
  const setup: RtRunState = structuredClone(base);
  setup.picks.find(entry => entry.nodeId === (base!.pending as { nodeId: string }).nodeId)!.eventId = 'ford-ambush';
  const view = rtEventView(setup)!, fight = view.options.find(option => option.id === 'fight')!;
  // Step 3: «Обойти» (1 energy) has its analogue — banked energy, none here; «Обойти по кустам» (a modifier) stays off.
  const around = view.options.find(option => option.id === 'around')!;
  assert(fight.available && fight.battle && view.options.filter(option => option.off).map(option => option.id).join() === 'bushes', 'fight on, the way through the bushes off');
  assert(!around.off && !around.available && around.reason.includes('энергия'), `around: ${around.reason}`);
  assert(rtEventView({ ...setup, energy: 1 })!.options.find(option => option.id === 'around')!.available, 'with 1 banked energy it can be taken');
  assert(fight.outcomes[0].text.includes(`«${arenaTitle(fight.battle.arena)}»`), `the arena is named: ${fight.outcomes[0].text}`);
  let run = ok(rtChooseEventOption(setup, 'fight'), 'fight');
  const node = rtNode(run, (setup.pending as { nodeId: string }).nodeId)!;
  assert(run.pending?.kind === 'battle' && run.pending.battle === 'event' && run.pending.arena === fight.battle.arena, 'the arena shown is the arena played');
  assert(arenaCandidates(runRow(node.row)).arenas.includes(run.pending.arena) && run.pending.seed === arenaSeed(run, node.id), 'arena of the row, seed of the node');
  const lost = (() => { const sim = startArena(run); loseArena(sim); return ok(resolveArena(run, outcomeOf(run, sim)), 'lose'); })();
  assert(lost.result?.outcome === 'defeat', 'a lost reward battle ends the run');
  const sim = startArena(run); winArena(sim);
  run = ok(resolveArena(run, outcomeOf(run, sim)), 'win');
  // Step 3: the reward — common talismans to choose from (2); the choice completes the event.
  const reward = run.pending as Extract<RtRunState['pending'], { kind: 'talisman' }>;
  assert(reward?.kind === 'talisman' && reward.source === 'event' && reward.options.length === 2 && reward.options.every(id => ['whetstone', 'dew-flask'].includes(id)), `reward: ${JSON.stringify(reward)}`);
  assert(same(roundTrip(run), run), 'the reward choice is saved');
  run = ok(rtChooseTalisman(run, reward.options[0]), 'reward');
  assert(run.pending === null && run.talismans.includes(reward.options[0]) && run.visited.includes(node.id) && run.eventChoices.some(choice => choice.nodeId === node.id && choice.option === 'fight'), 'the choice completes the event');
});

check('the risk threshold of events is scaled: an option that may lose HP needs 5 HP (2 × 2.4)', () => {
  let found = false;
  for (let k = 0; k < 60 && !found; k++) {
    let run = ok(rtChooseGift(createRtRun(Math.imul(k + 301, 2654435761) >>> 0, { gift: 'mini' }), 1), 'gift');
    for (let step = 0; step < 12 && !found && !run.result; step++) {
      if (run.pending?.kind === 'battle') { const sim = startArena(run); winArena(sim); run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve'); continue; }
      if (run.pending?.kind === 'event') {
        const risky = rtEventView(run)!.event.options.find(option => !option.cost && option.outcomes.some(outcome => (outcome.effect.hp ?? 0) < 0));
        if (!risky) break;
        // Setup: the HP on entering the event, one below and at the threshold.
        const need = rtHp(EVENT_RISK_MIN_HP), low = rtEventView({ ...run, hp: need - 1 })!.options.find(option => option.id === risky.id)!;
        const enough = rtEventView({ ...run, hp: need })!.options.find(option => option.id === risky.id)!;
        assert(need === 5 && !low.available && low.reason.includes('HP ≥ 5') && enough.available, `${risky.id}: closed at 4 HP, open at 5`);
        assert(!rtChooseEventOption({ ...run, hp: need - 1 }, risky.id).ok, 'refused at 4 HP');
        found = true; break;
      }
      if (run.pending) break;
      const next = rtAvailableNodes(run), pick = next.find(node => node.type === 'event' && node.row <= 8) ?? next.find(node => node.type === 'battle');
      if (!pick) break;
      run = ok(rtEnterNode(run, pick.id), 'enter');
    }
  }
  assert(found, 'an event with a risky option was met');
});

/**
 * Walks spread seeds (offset `salt`) through their runs — battles won, finds take their first option, events their safe
 * option, rests heal, merchants are left — choosing nodes of `type` when they can, until a node of `type` is open.
 * `prepare` may set the state up on entering it (a setup, as the HP of the rest test). Null — none met.
 */
function openNode(salt: number, type: 'find' | 'shop' | 'rest' | 'event', prepare: (run: RtRunState) => RtRunState = run => run): RtRunState | null {
  for (let k = 0; k < 60; k++) {
    let run = ok(rtChooseGift(createRtRun(Math.imul(k + salt, 2654435761) >>> 0, { gift: 'mini' }), 1), 'gift');
    for (let step = 0; step < 40 && !run.result; step++) {
      const pending = run.pending;
      if (pending?.kind === type) return prepare(run);
      if (pending?.kind === 'battle') { const sim = startArena(run); winArena(sim); run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve'); continue; }
      if (pending?.kind === 'find') { run = ok(rtChooseFind(run, pending.options[0]), 'find'); continue; }
      if (pending?.kind === 'rest') { run = ok(rtRestHeal(run), 'rest'); continue; }
      if (pending?.kind === 'shop') { run = ok(rtShopLeave(run), 'shop'); continue; }
      if (pending?.kind === 'talisman') { run = ok(rtChooseTalisman(run, null), 'talisman'); continue; }
      if (pending?.kind === 'event') { const safe = rtEventView(run)!.options.find(option => option.safe && option.available)!; run = ok(rtChooseEventOption(run, safe.id), 'event'); continue; }
      const next = rtAvailableNodes(run), pick = next.find(node => node.type === type) ?? next.find(node => node.type === 'battle') ?? next[0];
      run = ok(rtEnterNode(run, pick.id), 'enter');
    }
  }
  return null;
}
/** Enters the first battle node reachable from `run` (other nodes on the way are passed as `openNode` does). */
function nextArena(run: RtRunState): RtRunState {
  for (let step = 0; step < 20; step++) {
    if (run.pending?.kind === 'battle') return run;
    if (run.pending) { run = nextArenaStep(run); continue; }
    const next = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, (next.find(node => isBattle(node.type)) ?? next[0]).id), 'enter');
  }
  throw new Error('no arena reached');
}
const bombsOf = (sim: Simulation): number => sim.world.kit?.items.bomb ?? 0;
const seedOf32 = (k: number): number => Math.imul(k, 2654435761) >>> 0;
/** One step past an open non-battle node: a find takes its first option, a rest heals, a merchant is left, an event takes its safe option, a talisman choice is refused. */
function nextArenaStep(run: RtRunState): RtRunState {
  const pending = run.pending;
  if (pending?.kind === 'find') return ok(rtChooseFind(run, pending.options[0]), 'find');
  if (pending?.kind === 'rest') return ok(rtRestHeal(run), 'rest');
  if (pending?.kind === 'shop') return ok(rtShopLeave(run), 'shop');
  if (pending?.kind === 'talisman') return ok(rtChooseTalisman(run, null), 'talisman');
  if (pending?.kind === 'event') { const safe = rtEventView(run)!.options.find(option => option.safe && option.available)!; return ok(rtChooseEventOption(run, safe.id), 'event'); }
  if (pending?.kind === 'gift') return takeGift(run);
  return run;
}
const isBattle = (type: string) => ['battle', 'hard', 'checkpoint', 'breakthrough', 'boss'].includes(type);

check('a find offers the turn-based three; the consumable taken goes into the next arena, is used there and the rest comes back', () => {
  let checked = 0;
  for (const salt of [501, 601, 701]) {
    const atFind = openNode(salt, 'find');
    assert(atFind && atFind.pending?.kind === 'find', 'a find was met');
    const nodeId = atFind.pending.nodeId;
    assert(same(atFind.pending.options, rewardChoices(forestNodeSeed(atFind.seed, nodeId), 0).map(option => option.item)), 'the turn-based find of the node');
    assert(atFind.pending.options.includes('bomb') && same(roundTrip(atFind), atFind), 'a bomb is always offered; the open find loads back');
    let run = ok(rtChooseFind(atFind, 'bomb'), 'take the bomb');
    run = { ...run, items: { ...run.items, bomb: 2 } }; // setup: a second bomb, to see one used and one carried
    assert(run.openItems.includes('bomb') && same(roundTrip(run), run), 'open, saved');
    run = nextArena(run);
    const sim = startArena(run), w = sim.world;
    assert(bombsOf(sim) === 2, 'the arena starts with the bombs of the run');
    for (let i = 0; i < 60 && !w.enemies.length; i++) sim.tick();
    const target = w.enemies[0];
    sim.command({ t: 'teleport', x: target.x - 1.5, y: target.y });
    assert(sim.command({ t: 'item', kind: 'bomb', x: target.x, y: target.y }) === true && bombsOf(sim) === 1, 'a bomb used on the arena');
    winArena(sim);
    const journal = sim.exportJournal()!;
    assert(same(journal.loadout, rtArenaLoadout(run)) && replay(JSON.parse(JSON.stringify(journal))).hash() === sim.hash(), 'the arena with its loadout replays to the same hash');
    run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve');
    assert(run.items.bomb === 1 && same(roundTrip(run), run), 'one bomb carried on');
    checked++;
  }
  assert(checked === 3, 'three runs');
});

check('merchant: consumables of the open kinds (one open — the other slot closed), buying a closed one opens it', () => {
  const atShop = openNode(801, 'shop', run => ({ ...run, materials: { dew: 4, powder: 4, resin: 0, herbs: 0 } }));
  assert(atShop && atShop.pending?.kind === 'shop', 'a merchant was met');
  // The stock of the turn-based merchant from the merchant draw and the open consumables on entering.
  const draw = atShop.streams.merchant - 1, expected = shopStock(streamValue(atShop.seed, 'merchant', draw), atShop.openItems, GIFT_POOL);
  assert(same(atShop.pending.stock.items, expected.items), `stock ${atShop.pending.stock.items} = ${expected.items}`);
  // A setup visit with exactly one open kind: one slot of it, one of a closed kind.
  const one: RtRunState = { ...atShop, openItems: ['frost'] };
  const stock = shopStock(streamValue(one.seed, 'merchant', draw), one.openItems, GIFT_POOL);
  assert(stock.items.length === 2 && stock.items[0] === 'frost' && stock.items[1] !== 'frost', `one open: ${stock.items}`);
  const visit: RtRunState = { ...one, pending: { ...atShop.pending, stock: { items: stock.items, talisman: null } } };
  const view = rtShopView(visit)!, closed = view.goods.find(good => good.opens)!;
  assert(closed && closed.price === 3, 'the closed one is on sale for 3');
  const bought = ok(rtShopBuy(visit, closed.id), 'buy');
  assert(bought.items[closed.item!] === 1 && bought.openItems.includes(closed.item!) && !rtShopView(bought)!.goods.find(good => good.id === closed.id)!.available, 'bought: in hand, open, sold');
  assert(same(roundTrip(bought), bought), 'the visit with a purchase loads back');
  // None open: no consumables on sale.
  assert(shopStock(streamValue(one.seed, 'merchant', draw), [], GIFT_POOL).items.length === 0, 'none open — none sold');
});

check('rest: craft 2 of a resource into its consumable (any number of recipes), it opens; crafting cancels the heal', () => {
  const atRest = openNode(901, 'rest', run => ({ ...run, hp: 3, materials: { dew: 4, powder: 1, resin: 2, herbs: 0 } }));
  assert(atRest && atRest.pending?.kind === 'rest', 'a rest was met');
  const view = rtRestView(atRest)!;
  assert(view.recipes.map(recipe => `${recipe.resource}>${recipe.item}:${recipe.available}`).join() === 'dew>frost:true,powder>bomb:false,resin>fire:true,herbs>healing:false', 'recipes');
  let run = ok(rtRestCraft(atRest, 'dew'), 'frost');
  run = ok(rtRestCraft(run, 'dew'), 'frost again');
  run = ok(rtRestCraft(run, 'resin'), 'fire');
  assert(run.items.frost === 2 && run.items.fire === 1 && run.materials.dew === 0 && run.materials.resin === 0 && run.openItems.includes('frost'), 'crafted');
  assert(!rtRestCraft(run, 'powder').ok && !rtRestHeal(run).ok && run.hp === 3, 'no recipe without resources; no heal after crafting');
  assert(same(roundTrip(run), run), 'the open rest with crafts loads back');
  run = ok(rtRestFinish(run), 'finish');
  assert(run.pending === null && run.items.frost === 2, 'the rest completes');
});

check('events: a consumable outcome joins the run and opens; energy is banked for the next arena, which starts with it and spends it', () => {
  // A real event node on the trails (rows 6–8), where «Ручей у камней» and «Старый капкан» stand.
  let atEvent: RtRunState | null = null;
  for (let salt = 1001; salt < 2000 && !atEvent; salt += 100) {
    const run = openNode(salt, 'event');
    if (run?.pending?.kind === 'event' && rtNode(run, run.pending.nodeId)!.row <= 8) atEvent = run;
  }
  assert(atEvent && atEvent.pending?.kind === 'event', 'a trail event was met');
  const nodeId = atEvent.pending.nodeId;
  // Setup: «Ручей у камней» on this real event node (a trail event: rows 6–8).
  const brook: RtRunState = structuredClone(atEvent);
  brook.picks.find(entry => entry.nodeId === nodeId)!.eventId = 'brook';
  {
    const flask = ok(rtChooseEventOption(brook, 'flask'), 'flask');
    assert(flask.items.frost === brook.items.frost + 1 && flask.openItems.includes('frost'), 'the flask: +1 cold, open');
    let run = ok(rtChooseEventOption(brook, 'sharpen'), 'sharpen');
    assert(run.energy === 1 && rtEventView(brook)!.options.find(option => option.id === 'sharpen')!.outcomes[0].text.includes('следующей арены'), 'energy +1 banked');
    run = nextArena(run);
    const sim = startArena(run);
    assert(sim.world.energy === 1, 'the next arena starts with 1 energy');
    winArena(sim);
    run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve');
    assert(run.energy === 0, 'spent by that arena');
  }
  // An energy cost is paid from the banked energy: «Разобрать капкан» (1 energy → a bomb) on a trail node.
  {
    const trap: RtRunState = structuredClone(atEvent);
    trap.picks.find(entry => entry.nodeId === nodeId)!.eventId = 'old-trap';
    assert(!rtEventView(trap)!.options.find(option => option.id === 'disarm')!.available, 'no banked energy: closed');
    const paid = ok(rtChooseEventOption({ ...trap, energy: 1 }, 'disarm'), 'disarm');
    assert(paid.energy === 0 && paid.items.bomb === trap.items.bomb + 1, 'paid 1 energy, got a bomb');
  }
});

check('elites in the run: random ones from run row 3; the loot of an elite picked up on the arena comes into the run', () => {
  // Every battle of the walks: the arena of run rows 1–2 has no random elites, from row 3 it has.
  let low = 0, high = 0;
  for (const walk of walks.slice(0, 3)) {
    let run = takeGift(createRtRun(walk.run.seed, { gift: 'mini' }));
    for (let step = 0; step < 6; step++) {
      run = nextArena(run);
      const pending = run.pending as Extract<RtRunState['pending'], { kind: 'battle' }>, row = runRow(rtNode(run, pending.nodeId)!.row);
      const loadout = rtArenaLoadout(run);
      assert(loadout.randomElites === (row >= 3), `run row ${row}: random elites ${loadout.randomElites}`);
      if (row >= 3) high++; else low++;
      const sim = startArena(run); winArena(sim);
      run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve');
    }
  }
  assert(low > 0 && high > 0, `rows below 3: ${low}, from 3: ${high}`);
  // The loot: an elite placed on a run arena, killed by a bomb of the run, its loot walked onto — into the run.
  let run = nextArena(takeGift(createRtRun(SEEDS[7], { gift: 'mini' })));
  run = { ...run, items: { ...run.items, bomb: 1 }, openItems: ['bomb'] }; // setup: a bomb in hand, open
  const sim = startArena(run), w = sim.world;
  sim.command({ t: 'teleport', x: 3, y: 5 });
  // A random elite: its loot always drops (a resource).
  const id = sim.command({ t: 'place', x: 5.5, y: 5, color: 0, hp: 2, kind: 'basic', elite: 'random' }) as number;
  assert(sim.command({ t: 'item', kind: 'bomb', x: 5.5, y: 5 }) === true && !w.enemies.some(e => e.id === id), 'the elite killed by the bomb');
  const loot = w.objects.find(o => o.kind === 'loot')!;
  assert(loot, 'loot fell');
  sim.command({ t: 'teleport', x: loot.x, y: loot.y });
  sim.tick();
  assert(!w.objects.some(o => o.kind === 'loot'), 'picked up');
  winArena(sim);
  const before = { items: { ...run.items, bomb: 0 }, materials: { ...run.materials } };
  run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve');
  const gained = (Object.keys(run.items) as ItemKind[]).reduce((sum, kind) => sum + run.items[kind] - before.items[kind], 0)
    + (Object.keys(run.materials) as (keyof typeof run.materials)[]).reduce((sum, kind) => sum + run.materials[kind] - before.materials[kind], 0);
  assert(gained === 1 && same(roundTrip(run), run), `the loot came into the run (${loot.loot}), loads back`);
});

check('talisman offers: a hard battle offers three by the rarity roll (rare «Якорь у героя» included); talismans without an analogue never come', () => {
  const offered = new Map<string, number>();
  for (let k = 1; k <= 400; k++) {
    for (const option of rtTalismanOffer(Math.imul(k, 2654435761) >>> 0, 'hard', { taken: [], gone: [] })) offered.set(option, (offered.get(option) ?? 0) + 1);
  }
  const total = [...offered.values()].reduce((a, b) => a + b, 0), rare = ['nimble-paws', 'ash-ward', 'hero-anchor'].reduce((sum, id) => sum + (offered.get(id) ?? 0), 0);
  console.log(`   ${[...offered].map(([id, n]) => `${id} ${n}`).join(', ')}`);
  assert(offered.has('hero-anchor') && rare / total > 0.12 && rare / total < 0.24, `rare share ${(rare / total).toFixed(3)}`);
  for (const off of RT_TALISMANS_OFF) assert(!offered.has(off.id), `${off.id} is never offered`);
  // The oath offer of the Jailer's row: only «Клятва голода» has its price in real time.
  assert(same(rtTalismanOffer(seedOf32(7), 'oath', { taken: [], gone: [] }), ['oath-hunger']), 'oaths: hunger only');
  assert(rtTalismanOffer(seedOf32(7), 'oath', { taken: ['oath-hunger'], gone: [] }).length === 0, 'no oath left: an empty offer (refusal only)');
  // The pool runs dry: the «пустышка».
  const all = ['whetstone', 'dew-flask', 'tough-hide', 'millstone-shard', 'hourglass', 'nimble-paws', 'ash-ward', 'hero-anchor'];
  assert(same(rtTalismanOffer(seedOf32(8), 'hard', { taken: all, gone: [] }), ['blank']), 'an empty pool: the «пустышка»');
  // The gift, events and the merchant never give a talisman without an analogue (many seeds).
  for (let k = 1; k <= 200; k++) {
    const seed = seedOf32(k), gift = rollGift(seed, 'full', GIFT_POOL);
    const deal = gift.options[2] as Extract<GiftOption, { kind: 'deal' }>, oath = gift.options[3] as Extract<GiftOption, { kind: 'oath' }>;
    const drawn = [...deal.reward.kind === 'pick-talisman' ? deal.reward.talismans : [deal.reward.talisman], oath.oath, rtShopTalisman(seed, { taken: [], gone: [] })];
    for (const id of drawn) assert(id === null || !RT_TALISMANS_OFF.some(off => off.id === id), `seed ${seed}: ${id}`);
  }
});

check('talismans in the run: taken at a hard battle, the merchant, an event, the gift; their run effects (tough hide, dew flask, hunger, oath energy, ward)', () => {
  // A hard battle: a real one on a walk, its offer through the commands.
  let atHard: RtRunState | null = null;
  for (let k = 0; k < 40 && !atHard; k++) {
    let run = takeGift(createRtRun(seedOf32(k + 1200), { gift: 'mini' }));
    for (let step = 0; step < 40 && !atHard && !run.result; step++) {
      const pending = run.pending;
      if (pending?.kind === 'battle') {
        const sim = startArena(run); winArena(sim); run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve');
        if (run.pending?.kind === 'talisman' && run.pending.source === 'hard') atHard = run;
        else if (run.pending?.kind === 'talisman') run = ok(rtChooseTalisman(run, null), 'refuse');
        continue;
      }
      if (pending) { run = nextArenaStep(run); continue; }
      const next = rtAvailableNodes(run), pick = next.find(node => node.type === 'hard') ?? next.find(node => node.type === 'battle') ?? next[0];
      run = ok(rtEnterNode(run, pick.id), 'enter');
    }
  }
  assert(atHard && atHard.pending?.kind === 'talisman', 'a hard battle offered talismans');
  const offer = atHard.pending.options;
  assert(offer.length === 3 && new Set(offer).size === 3, `three different: ${offer}`);
  // Setup: «Крепкая шкура» among the options, to see its +3 / +3.
  const setup: RtRunState = { ...atHard, pending: { ...atHard.pending, options: ['tough-hide', ...offer.filter(id => id !== 'tough-hide').slice(0, 2)] } };
  let run = ok(rtChooseTalisman(setup, 'tough-hide'), 'take');
  assert(run.maxHp === setup.maxHp + 3 && run.hp === setup.hp + 3 && run.talismans.includes('tough-hide'), 'Крепкая шкура: +3 / +3');
  const setupOptions = (setup.pending as Extract<RtRunState['pending'], { kind: 'talisman' }>).options;
  assert(setupOptions.slice(1).every(id => run.talismansGone.includes(id as string)), 'the others are gone');
  assert(same(roundTrip(run), run), 'saved');
  // Rest: «Фляга росы» +3; «Клятва голода» — nothing (crafting stays); the gift's price — one rest without healing.
  const atRest = openNode(1301, 'rest', next => ({ ...next, hp: 2 }))!;
  const node = rtNode(atRest, (atRest.pending as { nodeId: string }).nodeId)!;
  assert(rtRestView({ ...atRest, talismans: ['dew-flask'] })!.heal.value === rtHp(FOREST_REST_HEAL) + 3, 'dew flask: +3');
  assert(rtRestView({ ...atRest, talismans: ['oath-hunger'] })!.heal.value === 0 && rtRestView({ ...atRest, talismans: ['oath-hunger'] })!.recipes.length === 4, 'hunger: no heal, crafting stays');
  const noHeal = ok(rtRestHeal({ ...atRest, restNoHeal: true }), 'rest without heal');
  assert(noHeal.hp === 2 && !noHeal.restNoHeal && node.type === 'rest', 'the price is paid by one rest');
  // Oaths: +2 energy at the start of every arena, with the banked energy, up to 7.
  const oathRun = nextArena({ ...takeGift(createRtRun(seedOf32(1401), { gift: 'mini' })), talismans: ['oath-hunger'], energy: 6 });
  assert(rtArenaLoadout(oathRun).energy === 7 && rtArenaLoadout({ ...oathRun, energy: 1 }).energy === 3, 'oath energy');
  assert(startArena({ ...oathRun, energy: 0 }).world.energy === 2, 'the arena starts with 2');
  // The ward: whole until it saves the hero; the arena reports it, the run lets it crumble (the next loadout has none).
  let warded = nextArena({ ...takeGift(createRtRun(seedOf32(1402), { gift: 'mini' })), talismans: ['ash-ward'], hp: 1 });
  assert(rtArenaLoadout(warded).ward === true, 'ward whole');
  const sim = startArena(warded);
  sim.command({ t: 'param', key: 'contactDamage', value: 3 });
  sim.command({ t: 'place', x: sim.world.hero.x + 0.5, y: sim.world.hero.y, color: 0, hp: 9, kind: 'basic' });
  for (let i = 0; i < 3; i++) sim.tick();
  assert(sim.world.hero.hp === 1 && sim.world.kit!.wardUsed, 'the ward saved the hero');
  // The attacker gone, the touches harmless again: the arena is won.
  sim.command({ t: 'clear', keepMarked: true });
  sim.command({ t: 'param', key: 'contactDamage', value: 0 });
  winArena(sim);
  assert(sim.world.status === 'victory', 'won');
  warded = ok(resolveArena(warded, outcomeOf(warded, sim)), 'resolve');
  assert(warded.wardSpent === true && rtArenaLoadout(nextArena(warded)).ward === false && same(roundTrip(warded), warded), 'crumbled for the run');
});

check('talismans from the merchant (price by rarity; not bought — gone), from events (a common one drawn) and from the gift (a deal with its price, an oath)', () => {
  const atShop = openNode(1501, 'shop', next => ({ ...next, materials: { dew: 5, powder: 5, resin: 0, herbs: 0 } }))!;
  const talisman = (atShop.pending as Extract<RtRunState['pending'], { kind: 'shop' }>).stock.talisman;
  assert(talisman && !RT_TALISMANS_OFF.some(off => off.id === talisman), `the merchant offers ${talisman}`);
  const good = rtShopView(atShop)!.goods.find(entry => entry.id === 'talisman')!;
  assert(good.price === { common: 4, uncommon: 6, rare: 8 }[rtTalisman(talisman)!.rarity as 'common'], `price ${good.price}`);
  const bought = ok(rtShopBuy(atShop, 'talisman'), 'buy');
  assert(bought.talismans.includes(talisman) && !rtShopView(bought)!.goods.find(entry => entry.id === 'talisman')!.available, 'bought once');
  const left = ok(rtShopLeave(atShop), 'leave without buying');
  assert(left.talismansGone.includes(talisman), 'not bought: gone');
  // An event: «Бродячий точильщик», «Заточка» (2 resources → a common talisman) on a real trail event node.
  let atEvent: RtRunState | null = null;
  for (let salt = 1601; salt < 2600 && !atEvent; salt += 100) {
    const next = openNode(salt, 'event');
    if (next?.pending?.kind === 'event' && rtNode(next, next.pending.nodeId)!.row <= 8) atEvent = next;
  }
  assert(atEvent && atEvent.pending?.kind === 'event', 'a trail event');
  const grinder: RtRunState = structuredClone({ ...atEvent, materials: { dew: 2, powder: 0, resin: 0, herbs: 0 } });
  grinder.picks.find(entry => entry.nodeId === (atEvent!.pending as { nodeId: string }).nodeId)!.eventId = 'wandering-grinder';
  const ground = ok(rtChooseEventOption(grinder, 'grind'), 'grind');
  assert(ground.talismans.length === 1 && rtTalisman(ground.talismans[0])!.rarity === 'common' && ground.materials.dew === 0, `a common talisman: ${ground.talismans}`);
  // A common one gone gives way to the next rarity (as the turn-based draw); with none left «Заточка» is closed.
  const commonsGone = ok(rtChooseEventOption({ ...grinder, talismans: ['whetstone', 'dew-flask'] }, 'grind'), 'grind without commons');
  assert(rtTalisman(commonsGone.talismans[2])!.rarity === 'uncommon', `gives way: ${commonsGone.talismans}`);
  const dry = rtEventView({ ...grinder, talismans: ['whetstone', 'dew-flask', 'tough-hide', 'millstone-shard', 'hourglass', 'nimble-paws', 'ash-ward'] })!.options.find(option => option.id === 'grind')!;
  assert(!dry.available && dry.reason === 'Талисманов не осталось', 'none left: closed');
  // The gift: a deal pays its price and gives its talisman; an oath is taken.
  let dealt = 0, sworn = 0;
  for (let k = 1; k <= 30; k++) {
    const run0 = createRtRun(seedOf32(k + 1700), { gift: 'full' }), view = rtGiftView(run0)!;
    const deal = view.options.find(entry => entry.option.kind === 'deal' && entry.available), oath = view.options.find(entry => entry.option.kind === 'oath' && entry.available);
    if (deal) {
      let taken = ok(rtChooseGift(run0, deal.index), 'deal');
      if (rtGiftView(taken)) taken = ok(rtChooseGiftPick(taken, rtGiftView(taken)!.picks[0]), 'pick');
      const option = deal.option as Extract<GiftOption, { kind: 'deal' }>;
      assert(taken.talismans.length === 1, 'the deal gives a talisman');
      if (option.price === 'hp') assert(taken.hp === 12 - 3 + (taken.talismans[0] === 'tough-hide' ? 3 : 0), `price −3 HP: ${taken.hp}`);
      if (option.price === 'max-hp') assert(taken.maxHp === 12 - 3, 'price −3 maximum');
      if (option.price === 'rest') assert(taken.restNoHeal === true, 'price: the next rest');
      assert(same(roundTrip(taken), taken), 'saved');
      dealt++;
    }
    if (oath) { const taken = ok(rtChooseGift(run0, oath.index), 'oath'); assert(same(taken.talismans, ['oath-hunger']), 'the oath'); sworn++; }
  }
  assert(dealt > 10 && sworn > 10, `deals ${dealt}, oaths ${sworn}`);
  // A tampered save: an unknown talisman, one taken and gone, a ward spent without the ward.
  for (const bad of [{ ...ground, talismans: ['ragman-pouch'] }, { ...ground, talismansGone: [...ground.talismans] }, { ...ground, wardSpent: true }]) assert(parseRtRun(JSON.stringify(bad)) === null, 'tampered talismans');
});

check('icons and labels of the node types equal the turn-based map screen\'s', () => {
  for (const [type, info] of Object.entries(NODE_TYPE_INFO)) {
    const own = RT_NODE_TYPES[type as keyof typeof RT_NODE_TYPES];
    assert(own && own.icon === info.icon && own.label === info.label, `${type}: ${own?.icon} ${own?.label}`);
  }
  assert(Object.keys(RT_NODE_TYPES).length === Object.keys(NODE_TYPE_INFO).length, 'same types');
});

check('a malformed save reads as no run: arena, open node, result, gift, picks, battles, event choices, attempts', () => {
  // Real states to tamper with: a run at an open battle, one at an open event with an attempt, one that ended.
  // A full gift whose off buttons exist (deals and oaths until talismans): the tampered choice below takes one of them.
  const atBattle = (() => { const run = takeGift(createRtRun(SEEDS[6], { gift: 'full' }), kind => kind === 'resources' || kind === 'max-hp'); return ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter'); })();
  assert(atBattle.pending?.kind === 'battle' && same(roundTrip(atBattle), atBattle), 'the untouched open battle loads');
  const ended = walks.find(walk => walk.run.battles.length && walk.run.eventChoices.length)!.run;
  assert(same(roundTrip(ended), ended), 'the untouched ended run loads');
  const pending = atBattle.pending as Extract<RtRunState['pending'], { kind: 'battle' }>;
  const tampered: [string, unknown][] = [
    ['unknown arena', { ...atBattle, pending: { ...pending, arena: 'nope' }, picks: atBattle.picks.map(pick => ({ ...pick, arena: 'nope' })) }],
    ['arena other than the pick', { ...atBattle, pending: { ...pending, arena: pending.arena === 'glade' ? 'marked' : 'glade' } }],
    ['unknown battle kind', { ...atBattle, pending: { ...pending, battle: 'boss' } }],
    ['an event battle on a battle node', { ...atBattle, pending: { ...pending, battle: 'event' } }],
    ['unknown stand-in', { ...atBattle, pending: { ...pending, standIn: 'nearest' } }],
    ['a result with an open battle', { ...atBattle, result: { outcome: 'victory', nodeId: pending.nodeId } }],
    ['an unknown open kind', { ...atBattle, pending: { kind: 'tavern', nodeId: pending.nodeId } }],
    ['a rest open on a battle node', { ...atBattle, pending: { kind: 'rest', nodeId: pending.nodeId } }],
    ['gift options not the roll', { ...atBattle, gift: { ...atBattle.gift!, options: [{ kind: 'max-hp', amount: 5 }] } }],
    ['gift button out of range', { ...atBattle, gift: { ...atBattle.gift!, chosen: 9 } }],
    ['gift button off in the slice', { ...atBattle, gift: { ...atBattle.gift!, chosen: rtGiftView({ ...atBattle, gift: { ...atBattle.gift!, chosen: undefined }, pending: { kind: 'gift' } })!.options.findIndex(entry => !entry.available) } }],
    ['a gift pick not among its picks', { ...atBattle, gift: { ...atBattle.gift!, pick: 'sword' } }],
    ['consumables of an unknown kind', { ...atBattle, items: { ...atBattle.items, sword: 1 } }],
    ['a negative consumable count', { ...atBattle, items: { ...atBattle.items, bomb: -1 } }],
    ['an unknown open consumable', { ...atBattle, openItems: ['sword'] }],
    ['an open consumable twice', { ...atBattle, openItems: ['bomb', 'bomb'] }],
    ['banked energy over 7', { ...atBattle, energy: 8 }],
    ['a pick of an unknown event', { ...ended, picks: [...ended.picks, { nodeId: ended.visited[0], eventId: 'no-such-event' }] }],
    ['a battle record of an unknown arena', { ...ended, battles: [{ ...ended.battles[0], arena: 'nope' }, ...ended.battles.slice(1)] }],
    ['a battle record without kills', { ...ended, battles: [{ ...ended.battles[0], kills: -1 }, ...ended.battles.slice(1)] }],
    ['an event choice of an unknown option', { ...ended, eventChoices: [{ ...ended.eventChoices[0], option: 'dance' }] }],
    ['an event choice outcome out of range', { ...ended, eventChoices: [{ ...ended.eventChoices[0], outcome: 7 }] }],
    ['a result and an open node', { ...ended, pending: { kind: 'rest', nodeId: ended.visited[0] } }],
  ];
  for (const [what, value] of tampered) assert(parseRtRun(JSON.stringify(value)) === null, `accepted: ${what}`);
  // Escalation attempts: a real open «Гнездо дикобразов» with an attempt, then out-of-range indexes.
  let nest: RtRunState | null = null;
  for (let k = 0; k < 80 && !nest; k++) {
    let run = ok(rtChooseGift(createRtRun(Math.imul(k + 401, 2654435761) >>> 0, { gift: 'mini' }), 1), 'gift');
    for (let step = 0; step < 12 && !nest && !run.result; step++) {
      if (run.pending?.kind === 'battle') { const sim = startArena(run); winArena(sim); run = ok(resolveArena(run, outcomeOf(run, sim)), 'resolve'); continue; }
      if (run.pending?.kind === 'event') { if (rtEventView(run)!.event.id === 'porcupine-nest') nest = ok(rtChooseEventOption(run, 'search'), 'search'); break; }
      if (run.pending) break;
      const next = rtAvailableNodes(run), pick = next.find(node => node.type === 'event' && node.row <= 8) ?? next.find(node => node.type === 'battle');
      if (!pick) break;
      run = ok(rtEnterNode(run, pick.id), 'enter');
    }
  }
  assert(nest && nest.pending?.kind === 'event' && same(roundTrip(nest), nest), 'an open escalation loads');
  const open = nest.pending as Extract<RtRunState['pending'], { kind: 'event' }>;
  for (const attempts of [[5], [0, 0, 0, 0], [-1], ['x']]) assert(parseRtRun(JSON.stringify({ ...nest, pending: { ...open, attempts } })) === null, `attempts ${JSON.stringify(attempts)} accepted`);
});

/** A plain object as the Web Storage API. */
function memoryStorage(initial: Record<string, string> = {}): RunStorage & { keys(): string[] } {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); }, keys: () => [...data.keys()] };
}

check('saving uses the real-time keys only; the turn-based saves are neither read nor written', () => {
  const turnBasedRun = '{"version":2,"seed":1}', turnBasedProfile = '{"version":1,"trunkCleared":true,"giftFull":true}';
  const storage = memoryStorage({ [FOREST_RUN_STORAGE_KEY]: turnBasedRun, [PLAYER_PROFILE_KEY]: turnBasedProfile });
  const store = createRtRunStore(storage), profile = createRtProfileStore(storage);
  assert(store.load() === null && profile.giftKind(false) === 'mini', 'turn-based saves are not read');
  const run = walks[0].run;
  assert(store.save(run) && profile.endRun({ reachedJailer: true, seeded: false }), 'stored');
  assert(same(store.load(), run), 'the run loads back');
  assert(storage.keys().sort().join() === [FOREST_RUN_STORAGE_KEY, PLAYER_PROFILE_KEY, RT_PROFILE_STORAGE_KEY, RT_RUN_STORAGE_KEY].sort().join(), 'only the real-time keys added');
  assert(storage.getItem(FOREST_RUN_STORAGE_KEY) === turnBasedRun && storage.getItem(PLAYER_PROFILE_KEY) === turnBasedProfile, 'turn-based saves untouched');
  assert(!profile.endRun({ reachedJailer: false, seeded: true }) && profile.giftKind(false) === 'full', 'a seeded run does not change the gift mark');
});

console.log(`realtime-run: ${checks} checks passed`);
