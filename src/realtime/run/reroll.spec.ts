/**
 * B5 К10 «Переброс» (run/rtRun.ts `rtRerollTalismans`; docs/realtime-casino.md, «Переброс (К10)»). Node only:
 * `npm run test:realtime-reroll`.
 *
 * The run goes by its own commands; its arenas are real fights (journalled commands on the quiet test field of
 * runFight.testkit.ts) whose cauldron pays the resources a reroll costs:
 * - a run without a reroll saves byte for byte as before: whole runs of 8 seeds give the same saves at every step as the
 *   code of 7ae55fc (fixture `walks`);
 * - «Застава»: a reroll costs 1, then 2, then 3 resources, paid as the merchant is paid; each new offer has none of the
 *   talismans shown on the screen before; the 4th waits for resources and says why; the offer, the price and the stream
 *   counter survive a reload, and the next reroll after a reload is the same as without it;
 * - the shown and rerolled talismans go back to the pool: only the last offer's options not taken leave it;
 * - an event's reward rerolls too; the Jailer's oaths and relics do not;
 * - with resources to spare, rerolls go on until no talisman outside the shown ones is left, then the button is off;
 * - several seeds: different new offers; the same state rerolls the same;
 * - saves written before the reroll (fixtures `hard`, `event`, code of 7ae55fc) load unchanged and reroll from price 1;
 *   malformed reroll fields are no run;
 * - telemetry: a reroll is no choice (the rerolled options are not recorded as refused).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import {
  createRtRun, parseRtRun, resolveArena, rtAvailableNodes, rtChooseEventOption, rtChooseTalisman, rtEnterNode, rtEventView, rtLuckReport, rtRerollTalismans, rtRerollView,
  serializeRtRun, RT_REROLL_PRICE, type RtRunState,
} from './rtRun';
import { createRtRunStore, RT_RUN_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { rtTalisman, rtTalismanEligible, RT_TALISMANS } from './rtTalismans';
import { shopPayment, stockTotal } from '../forest/merchant';
import { stepChoices } from '../telemetry/recorder';
import { assert, closeNode, ok, playFight, same, seedOf, takeGift } from './runFight.testkit';
import before from '../../../tests/fixtures/rt-run-save-before-reroll.json';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

type Offer = Extract<NonNullable<RtRunState['pending']>, { kind: 'talisman' }>;
const offerOf = (run: RtRunState): Offer => { assert(run.pending?.kind === 'talisman', `an open talisman offer (${run.pending?.kind})`); return run.pending; };
const total = (run: RtRunState): number => stockTotal(run.materials);
const reload = (run: RtRunState): RtRunState => { const back = parseRtRun(serializeRtRun(run)); assert(back, 'the save loads'); return back; };

/** FNV-1a of a text (32 bits, hex). */
const fnv = (text: string): string => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };
/**
 * A whole run walked without a reroll: hard nodes first, then events (an event's battle when it can be taken), battles won
 * on the test field (chains 6 6 6 6), talisman screens take their first option, other screens close simply. Returns every
 * save on the way. The same walk wrote the fixture's `walks` with the code of 7ae55fc.
 */
function walkSaves(k: number): string[] {
  let run: RtRunState = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  const saves = [serializeRtRun(run)];
  for (let step = 0; step < 160 && !run.result; step++) {
    const p = run.pending;
    if (p?.kind === 'battle') run = ok(resolveArena(run, playFight(run, { chains: [6, 6, 6, 6], k }).outcome), 'fight');
    else if (p?.kind === 'talisman') run = ok(rtChooseTalisman(run, p.options[0] ?? null), 'talisman');
    else if (p?.kind === 'event') {
      const fight = rtEventView(run)!.options.find(option => option.battle && option.available);
      run = fight ? ok(rtChooseEventOption(run, fight.id), 'event battle') : closeNode(run);
    } else if (p) run = closeNode(run);
    else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, (next.find(n => n.type === 'hard') ?? next.find(n => n.type === 'event') ?? next[0]).id), 'enter'); }
    saves.push(serializeRtRun(run));
  }
  return saves;
}

/**
 * Walks seed `k` by the run's commands (fights won on the test field, so the cauldron pays resources) until a talisman offer
 * of `source` is open; an event takes its battle when it can. Other offers on the way are refused. Null — none on the way.
 */
function walkTo(k: number, source: 'hard' | 'event' | 'oath'): RtRunState | null {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  for (let step = 0; step < 160 && !run.result; step++) {
    const p = run.pending;
    if (p?.kind === 'talisman' && p.source === source && p.options.length) return run;
    if (p?.kind === 'battle') { run = ok(resolveArena(run, playFight(run, { chains: [6, 6, 6, 6], k }).outcome), 'fight'); continue; }
    if (p?.kind === 'event' && source === 'event') {
      const fight = rtEventView(run)!.options.find(option => option.battle && option.available);
      if (fight) { run = ok(rtChooseEventOption(run, fight.id), 'event battle'); continue; }
    }
    if (p) { run = closeNode(run); continue; }
    const next = rtAvailableNodes(run), want = source === 'oath' ? 'checkpoint' : source;
    run = ok(rtEnterNode(run, (next.find(n => n.type === want) ?? next.find(n => n.type === 'battle') ?? next[0]).id), 'enter');
  }
  return null;
}

check('a run without a reroll saves byte for byte as the code of 7ae55fc: 8 whole runs, every save on the way', () => {
  const walks = before.walks as Record<string, { steps: number; hash: string; talismansDraws: number; result: string }>;
  let screens = 0;
  for (const [k, want] of Object.entries(walks)) {
    const saves = walkSaves(Number(k)), last = JSON.parse(saves[saves.length - 1]) as RtRunState;
    assert(saves.length === want.steps && fnv(saves.join('\n')) === want.hash, `seed ${k}: ${saves.length} saves, hash ${fnv(saves.join('\n'))} (was ${want.steps}, ${want.hash})`);
    assert(last.streams.talismans === want.talismansDraws && last.result?.outcome === want.result, `seed ${k}: the stream counter and the end`);
    assert(saves.every(text => !text.includes('"rerolls"') && !text.includes('"rerolled"')), `seed ${k}: no reroll field is written`);
    screens += want.talismansDraws;
  }
  assert(screens >= 10, `talisman screens on the way: ${screens}`);
});

check('«Застава»: a reroll costs 1, 2, 3 resources (the merchant\'s payment); every new offer has none shown before; the 4th waits for resources', () => {
  let run = parseRtRun(before.hard)!;
  assert(run && offerOf(run).source === 'hard' && total(run) === 6, `the fixture: a «Застава» offer, 6 resources (${total(run)})`);
  const shown: string[] = [...offerOf(run).options], draws = run.streams.talismans;
  for (let n = 1; n <= 3; n++) {
    const view = rtRerollView(run)!;
    assert(view.available && view.price === n && view.rerolls === n - 1 && view.total === total(run), `reroll ${n}: price ${view.price}`);
    const step = rtRerollTalismans(run);
    assert(step.ok, `reroll ${n}`);
    const after = step.run, offer = offerOf(after), event = step.events.find(e => e.type === 'talisman-rerolled');
    assert(event?.type === 'talisman-rerolled' && event.price === n && same(event.paid, shopPayment(run.materials, n)) && same(event.options, offer.options), `reroll ${n}: the event`);
    assert(total(after) === total(run) - n && same(after.materials, Object.fromEntries(Object.entries(run.materials).map(([kind, have]) => [kind, have - event.paid[kind as keyof typeof event.paid]]))), `reroll ${n}: paid ${n}`);
    assert(after.streams.talismans === draws + n && same({ ...after.streams, talismans: 0 }, { ...run.streams, talismans: 0 }), `reroll ${n}: one more talismans draw, no other stream moves`);
    assert(offer.options.length === 3 && new Set(offer.options).size === 3 && offer.options.every(id => !shown.includes(id)), `reroll ${n}: a new offer ${offer.options} (shown ${shown})`);
    assert(offer.rerolls === n && same(offer.rerolled, shown), `reroll ${n}: the screen keeps the price and the shown ones`);
    assert(same(after.talismans, run.talismans) && same(after.talismansGone, run.talismansGone) && after.hp === run.hp && after.pending?.kind === 'talisman', `reroll ${n}: nothing else changes`);
    shown.push(...offer.options);
    run = after;
  }
  const view = rtRerollView(run)!;
  assert(!view.available && view.price === 4 && view.reason === 'Нужно ресурсов: 4, есть 0', `the 4th: ${view.reason}`);
  const refused = rtRerollTalismans(run);
  assert(!refused.ok && refused.reason === view.reason, 'refused with the reason');
  // The choice: only the last offer's options not taken leave the pool; the rerolled ones are back in it.
  const offer = offerOf(run), taken = offer.options[1];
  const done = ok(rtChooseTalisman(run, taken), 'take');
  assert(done.pending === null && done.talismans.includes(taken) && same(done.talismansGone, [...run.talismansGone, ...offer.options.filter(id => id !== taken)]), 'the last offer\'s other options are gone');
  const pool = { taken: done.talismans, gone: done.talismansGone };
  assert(offer.rerolled!.every(id => !done.talismansGone.includes(id) && (rtTalismanEligible(id, pool) || rtTalisman(id)!.excludes?.includes(taken) || rtTalisman(taken)!.excludes?.includes(id))), 'the rerolled ones are back in the pool');
  assert(!rtLuckReport(done).length, 'a reroll is no chance: the luck block has no line for it');
});

check('a reload in the middle of the screen keeps the offer, the price and the stream; the next reroll is the same as without the reload', () => {
  for (const k of [7, 12, 17, 21]) {
    const at = walkTo(k, 'hard');
    assert(at, `seed ${k}: a «Застава» offer`);
    const rich = { ...at, materials: { ...at.materials, dew: at.materials.dew + 10 } };
    const once = ok(rtRerollTalismans(rich), 'reroll 1');
    // The page's store, as a reload reads it.
    const data: Record<string, string> = {};
    const storage: RunStorage = { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; }, removeItem: key => { delete data[key]; } };
    const store = createRtRunStore(storage);
    assert(store.save(once), 'saved');
    const back = store.load()!;
    assert(back && same(back, once) && JSON.parse(data[RT_RUN_STORAGE_KEY]).pending.rerolls === 1, `seed ${k}: the screen comes back as it was`);
    assert(rtRerollView(back)!.price === 2 && same(offerOf(back).options, offerOf(once).options), `seed ${k}: price 2, the same offer`);
    const twice = ok(rtRerollTalismans(once), 'reroll 2'), twiceBack = ok(rtRerollTalismans(back), 'reroll 2 after the reload');
    assert(same(twice, twiceBack), `seed ${k}: the second reroll does not depend on the reload`);
    assert(same(reload(twice), twice) && rtRerollView(reload(twice))!.price === 3, `seed ${k}: price 3 after a reload`);
  }
});

check('several seeds: «Застава» offers reroll to different new offers; the same state rerolls the same', () => {
  const offers = new Set<string>();
  let seeds = 0;
  for (let k = 1; k <= 40 && seeds < 6; k++) {
    const at = walkTo(k, 'hard');
    if (!at || total(at) < RT_REROLL_PRICE) continue;
    const a = ok(rtRerollTalismans(at), 'reroll'), b = ok(rtRerollTalismans(structuredClone(at)), 'reroll again');
    assert(same(a, b), `seed ${k}: the same state rerolls the same`);
    const offer = offerOf(a).options;
    assert(offer.every(id => !offerOf(at).options.includes(id)) && offer.length === 3, `seed ${k}: a new offer`);
    // The first place of a «Застава» offer is rare while a rare one is left (the offer's rule holds after a reroll).
    const rareLeft = RT_TALISMANS.some(def => def.rarity === 'rare' && rtTalismanEligible(def.id, { taken: at.talismans, gone: [...at.talismansGone, ...offerOf(at).options] }));
    assert(!rareLeft || rtTalisman(offer[0])!.rarity === 'rare', `seed ${k}: the first place is rare`);
    offers.add(offer.join(','));
    seeds++;
  }
  assert(seeds >= 4 && offers.size >= Math.min(seeds, 3), `different offers over ${seeds} seeds: ${[...offers].join(' | ')}`);
});

check('an event\'s reward rerolls (from price 1, a fixture of 7ae55fc); the Jailer\'s oaths and relics do not', () => {
  const old = parseRtRun(before.event)!;
  assert(old && serializeRtRun(old) === before.event && offerOf(old).source === 'event' && offerOf(old).rerolls === undefined, 'the fixture loads unchanged');
  const view = rtRerollView(old)!;
  assert(view.available && view.price === 1 && total(old) === 3, `price 1 with 3 resources: ${JSON.stringify(view)}`);
  const once = ok(rtRerollTalismans(old), 'reroll'), offer = offerOf(once);
  assert(offer.options.length === offerOf(old).options.length && offer.options.every(id => !offerOf(old).options.includes(id) && ['common', 'uncommon'].includes(rtTalisman(id)!.rarity)), `the reward's new commons: ${offer.options}`);
  const twice = ok(rtRerollTalismans(once), 'reroll 2');
  assert(total(twice) === 0 && !rtRerollView(twice)!.available && rtRerollView(twice)!.reason === 'Нужно ресурсов: 3, есть 0', 'paid 1 + 2, the third waits');
  // The reward still completes its event.
  const done = ok(rtChooseTalisman(twice, offerOf(twice).options[0]), 'take');
  assert(done.pending === null && done.eventChoices.some(choice => choice.nodeId === offer.nodeId), 'the event completes');
  // The Jailer: no reroll.
  const jailer = walkTo(3, 'oath');
  assert(jailer && offerOf(jailer).source === 'oath', 'the Jailer\'s offer');
  const rich = { ...jailer, materials: { ...jailer.materials, dew: 20 } };
  assert(rtRerollView(rich) === null && !rtRerollTalismans(rich).ok, 'the Jailer\'s offer is not rerolled');
});

check('with resources to spare the rerolls go on until nothing new is left; then the button is off and says why', () => {
  for (const k of [7, 12]) {
    const at = walkTo(k, 'hard');
    assert(at, `seed ${k}: a «Застава» offer`);
    let run: RtRunState = { ...at, materials: { ...at.materials, dew: 500 } };
    const shown = [...offerOf(run).options], spent = total(run);
    let n = 0;
    while (rtRerollView(run)!.available) {
      run = ok(rtRerollTalismans(run), `reroll ${++n}`);
      const options = offerOf(run).options;
      assert(options.length >= 1 && options.every(id => !shown.includes(id)), `reroll ${n}: new ones`);
      shown.push(...options);
    }
    assert(n >= 3 && spent - total(run) === n * (n + 1) / 2, `seed ${k}: ${n} rerolls paid 1 + 2 + … + ${n}`);
    assert(rtRerollView(run)!.reason === 'Других талисманов не осталось', rtRerollView(run)!.reason);
    // Everything the pool had for the offer was shown once on this screen.
    const pool = { taken: at.talismans, gone: at.talismansGone };
    const open = RT_TALISMANS.filter(def => ['common', 'uncommon', 'rare'].includes(def.rarity) && rtTalismanEligible(def.id, pool)).map(def => def.id);
    assert(same([...shown].sort(), [...open].sort()), `seed ${k}: shown ${shown.length}, the pool had ${open.length}`);
    assert(same(reload(run), run), 'it saves');
  }
});

check('saves before the reroll load unchanged; malformed reroll fields are no run', () => {
  const hard = parseRtRun(before.hard)!;
  assert(hard && serializeRtRun(hard) === before.hard && offerOf(hard).rerolled === undefined && rtRerollView(hard)!.price === 1, 'the «Застава» fixture: unchanged, price 1');
  // It plays on: the choice completes the node as before.
  const taken = ok(rtChooseTalisman(hard, offerOf(hard).options[0]), 'take');
  assert(taken.pending === null && taken.talismans.includes(offerOf(hard).options[0]), 'plays on');
  const once = ok(rtRerollTalismans(hard), 'reroll');
  const forge = (edit: (pending: Record<string, any>, run: Record<string, any>) => void): string => { const value = JSON.parse(serializeRtRun(once)); edit(value.pending, value); return JSON.stringify(value); };
  assert(parseRtRun(forge(() => undefined)) !== null, 'the unedited save loads');
  const bad: [string, (pending: Record<string, any>, run: Record<string, any>) => void][] = [
    ['rerolls without rerolled', pending => { delete pending.rerolled; }],
    ['rerolled without rerolls', pending => { delete pending.rerolls; }],
    ['zero rerolls', pending => { pending.rerolls = 0; }],
    ['a fraction', pending => { pending.rerolls = 1.5; }],
    ['more rerolls than shown', pending => { pending.rerolls = 4; }],
    ['an unknown talisman', pending => { pending.rerolled[0] = 'no-such-talisman'; }],
    ['a shown one twice', pending => { pending.rerolled[1] = pending.rerolled[0]; }],
    ['a shown one offered now', pending => { pending.rerolled[0] = pending.options[0]; }],
    ['a shown one taken', (pending, run) => { run.talismans.push(pending.rerolled[0]); }],
    ['a shown one gone', (pending, run) => { run.talismansGone.push(pending.rerolled[0]); }],
    ['the offer not of the draw', pending => { pending.options = [...pending.options].reverse(); }],
    ['no draw for the reroll', (_pending, run) => { run.streams.talismans = 1; }],
  ];
  for (const [what, edit] of bad) assert(parseRtRun(forge(edit)) === null, `${what} is no run`);
});

check('telemetry: a reroll is no choice; the choice after it records the last offer', () => {
  const hard = parseRtRun(before.hard)!;
  const step = rtRerollTalismans(hard);
  assert(step.ok && stepChoices(hard, step).length === 0, 'a reroll records no choice');
  const pick = rtChooseTalisman(step.run, null);
  assert(pick.ok, 'refuse');
  const choices = stepChoices(step.run, pick);
  assert(choices.length === 1 && same(choices[0].offered, offerOf(step.run).options) && same(choices[0].refused, offerOf(step.run).options), JSON.stringify(choices));
});

console.log(`reroll: ${checks} checks ok`);
