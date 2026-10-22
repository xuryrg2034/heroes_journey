/**
 * Test kit (Node only) of tasks 36–37 (meta.spec.ts, hearth.spec.ts): a whole run walked by the run's own commands — enter, the
 * arena fed back (`resolveArena` with an outcome as the view builds it, no simulation), every screen chosen (the gift, «Застава»
 * and its rerolls, the chest, the feat's choice, the Jailer's hammer and oath screens, events with their options and reward
 * battles, the merchant's goods, the rest's craft, the find, the goblins' circle). Every state the walk passes through is
 * serialized into a digest (FNV-1a), and every id a screen offered is collected — the pools as the player sees them.
 * The walk's choices depend only on the seed index and the step, so a run of the same seed and options walks the same way (task 50: the
 * knack screens and the archetype row do not move the step).
 */
import { RESOURCE_KINDS } from '../forest/resources';
import type { ItemKind } from '../forest/types';
import {
  createRtRun, resolveArena, rtAvailableNodes, rtCasinoLeave, rtCasinoPlay, rtCasinoView, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick,
  rtChooseHammer, rtChooseTalisman, rtHammerRerollView, rtRerollHammers, rtEnterNode, rtEventView, rtGiftView, rtNode, rtRerollView, rtRerollTalismans, rtRestCraft, rtRestFinish, rtRestHeal,
  rtRestView, rtShopBuy, rtShopLeave, rtShopView, serializeRtRun, rtEnterGarrison, rtChooseHabit, rtChooseKnack, rtRestFuse, type RtArenaOutcome, type RtGateChoice, type RtKnackOption, type RtRunState, type RtRunStep,
} from './rtRun';
import { RT_HABITS, type RtHabitId } from './rtTalismans';

export const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
export function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}
const fnv = (hash: number, text: string): number => { for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0; return hash; };

export interface WalkOptions {
  /** The seed index (`seedOf(k)`) and the index the walk's choices turn on. */
  k: number;
  create?: Parameters<typeof createRtRun>[1];
  /** The run's seed (default `seedOf(k)`). */
  seed?: number;
  /** Lose the fight of this node (the run ends there); absent — every fight is won. */
  loseAt?: (run: RtRunState, nodeType: string) => boolean;
  /** The Jailer's fight severs the weight (default: odd k). */
  sever?: boolean;
  /** The goblins' circle may stand (`goblinCircle`; default: k % 3 === 1). */
  circle?: boolean;
  /**
   * The free reroll of the Jailer's screens (task 37 «Правка») is used on this screen when offered; absent — not used. Task 30: `form`
   * — the form screen of a run with forms (its first Jailer's screen instead of the hammer screen).
   */
  jailerReroll?: 'hammer' | 'oath' | 'form';
  /** Resources of each won fight (the loot fed back); absent — 1–3 of one kind by the step. */
  loot?: number;
  /** The option taken at an event (`null` — the walk's own pick). */
  eventChoice?: (eventId: string, open: readonly string[]) => string | null;
  /** The node entered among the available ones (absent — the walk's own pick). */
  pickNode?: (run: RtRunState, ids: readonly string[]) => string | null;
  /** Called with every state the walk passes through (after each step). */
  each?: (run: RtRunState) => void;
  /** Task 40: what «Повозка» takes at «Предместье» (`rtEnterGarrison`'s deposit); absent — the default. */
  deposit?: (run: RtRunState) => number | undefined;
  /** Task 51б: the choices at «Предместье» (`rtEnterGarrison`'s third argument: the garrison map, the consumable); absent — none. */
  gate?: (run: RtRunState) => RtGateChoice;
  /** Task 40 (the bot's curve, scripts/realtime-garrison-curve.ts): the open battle played for real; absent or null — the outcome made up. */
  fight?: (run: RtRunState) => RtArenaOutcome | null;
  /** Task 50 «Повадка»: the archetype on the gift of a run with `habits` (null — «Без повадки»); absent — by the seed index. */
  habit?: RtHabitId | null;
  /** Task 50 «Сноровка»: the card taken on the knack screen (null — «Пропустить»); absent — the walk's own pick by the step. */
  knack?: (run: RtRunState, options: readonly RtKnackOption[]) => RtKnackOption | null;
  /** Task 50 (scripts/realtime-knacks.ts): a rest with a fusion ready makes it (the first one); absent — the rest heals or crafts. */
  fuse?: boolean;
  /** Task 49: the talisman taken on a talisman screen (null — the walk's own pick); absent — the walk's own pick by the step. */
  talisman?: (run: RtRunState, options: readonly string[]) => string | null;
  /** Task 50 (telemetry): every step that went through, with the state before it (as the view hands it to the recorder). */
  onStep?: (before: RtRunState, step: Extract<RtRunStep, { ok: true }>) => void;
}
export interface Walk { run: RtRunState; digest: number; steps: number; offered: Set<string> }

/** Every id the open screen offers now (talismans, relics, oaths, hammers; the merchant's talisman; the gift's talismans). */
export function offeredNow(run: RtRunState): string[] {
  const pending = run.pending, out: string[] = [];
  if (pending?.kind === 'talisman') out.push(...pending.options);
  if (pending?.kind === 'hammer') out.push(...pending.options);
  if (pending?.kind === 'shop' && pending.stock.talisman) out.push(pending.stock.talisman);
  // Task 50: the knack screen's cards (a rank II card as `<id>:2`).
  if (pending?.kind === 'knack') out.push(...pending.options.map(o => (o.hone ? `${o.id}:2` : o.id)));
  if (pending?.kind === 'gift') {
    for (const { option } of rtGiftView(run)?.options ?? []) {
      if (option.kind === 'deal') out.push(...option.reward.kind === 'pick-talisman' ? option.reward.talismans : option.reward.talisman ? [option.reward.talisman] : []);
      if (option.kind === 'oath' && option.oath) out.push(option.oath);
    }
  }
  return out;
}

/** The walk: see the file's comment. */
export function walkRun(options: WalkOptions): Walk {
  const { k } = options;
  // Task 38: a walk is of the forest run (the references of tasks 36–37) unless its options ask for the garrison.
  let run = createRtRun(options.seed ?? seedOf(k), { garrison: false, ...options.create ?? { gift: k % 2 ? 'full' : 'mini' } });
  let digest = fnv(0x811c9dc5, serializeRtRun(run)), steps = 0;
  const offered = new Set<string>();
  const seen = (next: RtRunState): RtRunState => {
    digest = fnv(digest, serializeRtRun(next)); steps++;
    for (const id of offeredNow(next)) offered.add(id);
    for (const id of next.talismans) offered.add(id);
    if (next.hammer) offered.add(next.hammer);
    for (const pick of next.picks) if (pick.eventId) offered.add(pick.eventId);
    options.each?.(next);
    return next;
  };
  seen(run);
  /** A step of the walk: it must go through; the caller's `onStep` sees it with the state before it. */
  const take = (step: RtRunStep, what: string): RtRunState => { const next = ok(step, what); if (step.ok) options.onStep?.(run, step); return next; };
  // Task 50: the knack screen and the archetype row are not counted in `step` (the walk's choices turn on it): a walk with them, every
  // knack refused and «Без повадки», makes the same choices as one without them.
  for (let turn = 0, extra = 0; turn < 400 + extra && !run.result; turn++) {
    const step = turn - extra, pending = run.pending;
    if (!pending) {
      const next = rtAvailableNodes(run), wanted = options.pickNode?.(run, next.map(entry => entry.id)), node = next.find(entry => entry.id === wanted) ?? next[(k * 7 + step) % next.length];
      run = seen(take(rtEnterNode(run, node.id, null, { goblinCircle: options.circle ?? k % 3 === 1 }), 'enter'));
      continue;
    }
    switch (pending.kind) {
      case 'battle': {
        const type = rtNode(run, pending.nodeId)!.type, lose = options.loseAt?.(run, type) ?? false;
        const played = options.fight?.(run);
        if (played) { run = seen(take(resolveArena(run, played), 'resolve')); break; }
        const outcome: RtArenaOutcome = {
          nodeId: pending.nodeId, won: !lose, hp: lose ? 0 : Math.max(1, run.maxHp - (step % 4)), kills: 20 + step % 7, damage: step % 4, time: 60 + step,
          materials: options.loot !== undefined ? { [RESOURCE_KINDS[(k + step) % RESOURCE_KINDS.length]]: options.loot } : { [RESOURCE_KINDS[(k + step) % RESOURCE_KINDS.length]]: 1 + (step % 3) },
          ...pending.feat ? { feat: { done: (k + step) % 2 === 0 } } : {},
          ...pending.battle === 'hard' && k % 3 === 0 ? { chest: true } : {},
          ...type === 'checkpoint' && (options.sever ?? k % 2 === 1) ? { severed: true } : {},
        };
        run = seen(take(resolveArena(run, outcome), 'resolve'));
        break;
      }
      case 'talisman': {
        const reroll = rtRerollView(run);
        if (reroll?.available && (reroll.free ? options.jailerReroll === (pending.source === 'form' ? 'form' : 'oath') : step % 3 === 0)) { run = seen(take(rtRerollTalismans(run), 'reroll')); break; }
        const options2 = (run.pending as typeof pending).options, at = step % (options2.length + 1), wanted = options.talisman?.(run, options2) ?? null;
        run = seen(take(rtChooseTalisman(run, wanted && options2.includes(wanted) ? wanted : at < options2.length ? options2[at] : null), 'talisman'));
        break;
      }
      case 'hammer':
        if (options.jailerReroll === 'hammer' && rtHammerRerollView(run)?.available) { run = seen(take(rtRerollHammers(run), 'hammer reroll')); break; }
        run = seen(take(rtChooseHammer(run, pending.options[step % pending.options.length] ?? null), 'hammer')); break;
      case 'event': {
        const view = rtEventView(run)!, open = view.options.filter(option => option.available);
        const wanted = options.eventChoice?.(view.event.id, open.map(option => option.id)) ?? null;
        run = seen(take(rtChooseEventOption(run, open.find(option => option.id === wanted)?.id ?? open[(k + step) % open.length].id), 'event'));
        break;
      }
      case 'shop': {
        const good = rtShopView(run)!.goods.find(entry => entry.available && entry.good !== 'heal');
        run = seen(good && step % 2 === 0 ? take(rtShopBuy(run, good.id), 'buy') : take(rtShopLeave(run), 'leave'));
        break;
      }
      case 'rest': {
        const view = rtRestView(run)!, recipe = view.recipes.find(entry => entry.available), fusion = view.fusions.find(entry => entry.available);
        if (options.fuse && fusion) run = seen(take(rtRestFuse(run, fusion.fusion), 'fuse'));
        else if (view.canFinish) run = seen(take(rtRestFinish(run), 'rest finish'));
        else run = seen(recipe && step % 2 === 1 ? take(rtRestCraft(run, recipe.resource), 'craft') : take(rtRestHeal(run), 'heal'));
        break;
      }
      case 'find': {
        // Task 41: the walk's pick, or the next one the hand can take (a full hand refuses the healing one).
        const n = pending.options.length, at = [0, 1, 2].map(d => (step + d) % n).find(i => !rtItemRefusal(run, pending.options[i])) ?? step % n;
        run = seen(take(rtChooseFind(run, pending.options[at]), 'find')); break;
      }
      case 'gift': {
        const view = rtGiftView(run)!;
        // Task 50: the archetype row first (a run with `habits`).
        if (view.habit && !view.habit.chosen) {
          const habit = options.habit !== undefined ? options.habit : k % 5 === 0 ? null : RT_HABITS[k % RT_HABITS.length].id;
          extra++;
          run = seen(take(rtChooseHabit(run, habit), 'habit')); break;
        }
        if (view.chosen !== null) {
          const n = view.picks.length, at = [0, 1, 2].map(d => (step + d) % n).find(i => !rtItemRefusal(run, view.picks[i] as ItemKind)) ?? step % n;
          run = seen(take(rtChooseGiftPick(run, view.picks[at]), 'gift pick')); break;
        }
        const open = view.options.filter(entry => entry.available);
        run = seen(take(rtChooseGift(run, open.length ? open[(k + step) % open.length].index : null), 'gift'));
        break;
      }
      case 'casino': {
        const table = rtCasinoView(run)!.tables.find(entry => entry.available);
        run = seen(table && step % 2 === 0 ? take(rtCasinoPlay(run, table.table), 'casino') : take(rtCasinoLeave(run), 'casino leave'));
        break;
      }
      // Task 38: «Предместье» — «В гарнизон».
      case 'outskirts': run = seen(take(rtEnterGarrison(run, options.deposit?.(run), options.gate?.(run)), 'garrison')); break;
      // Task 50: the knack screen — the walk's pick by the step (or the caller's).
      case 'knack': {
        const at = step % (pending.options.length + 1), pick = options.knack ? options.knack(run, pending.options) : at < pending.options.length ? pending.options[at] : null;
        extra++;
        run = seen(take(rtChooseKnack(run, pick), 'knack')); break;
      }
      default: throw new Error(`seed ${k}: no walk for ${pending.kind}`);
    }
  }
  return { run, digest, steps, offered };
}

/** The walks of the byte-for-byte reference (meta.reference.ts): 24 seeds, both gifts, feats on every third, the circle on some. */
export const REFERENCE_WALKS = (): WalkOptions[] => Array.from({ length: 24 }, (_, i) => {
  const k = i + 1;
  // Task 30: the reference predates the forms — its runs are created without them (`forms: false`, as a save before it); task 41:
  // without the cap of healing potions (`potionCap: 0`); task 48: without the Troll (`troll: false`); task 58: without the chronicle (`chronicle: false`);
  // 20.10.2026: the markers of before (`markerSeek: false`); «Дыры ядра боссов»: without the core's wards (`bossHoles: false`); «Ядро в окне — первым»: the nearest pick (`corePickFirst: false`); the press circles only (`bossPickArt: false`);
  // task 57а (on 22.10.2026): the forest without the new shooters (`forestShooters: false`); task 48 §25 (on 22.10.2026): the sitting Troll (`trollMove: false`); task 55 §23 (on 23.10.2026): Колдун v0 (`warlockV1: false`).
  return { k, create: { gift: k % 2 ? 'full' : 'mini', ...k % 3 === 0 ? { feats: true } : {}, ...k % 4 === 0 ? { schedule: [] } : {}, forms: false, potionCap: 0, troll: false, trollMove: false, warlockV1: false, markerSeek: false, chronicle: false, bossHoles: false, corePickFirst: false, bossPickArt: false, forestShooters: false }, ...k % 5 === 0 ? { loseAt: (_run: RtRunState, type: string) => type === 'checkpoint' } : {} };
});
