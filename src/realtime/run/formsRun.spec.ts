/**
 * Task 30 «Формы в походе» (design 15.10.2026, docs/design-notes/tasks-29-30.md, «ЗАДАЧА 30» and the decisions after it;
 * docs/realtime-slice.md, section 8, «Формы в походе»). Node only: `npm run test:realtime-forms-run`. Everything goes through the
 * run's own commands (create, enter, resolve, choose, buy, save and load) and real fights of journalled commands:
 * - a run without the flag (a save before the task): no form and no «Близнецы» anywhere, the hammer screen, its save without the
 *   field; a run with the flag walks the same map, nodes, events, gift and stream counters, and its talisman screens differ only
 *   where an uncommon place drew from the pool with «Близнецы» (design decision 5);
 * - the Jailer's screen offers 3 forms of «Путь» and «Конец» by the node's roll (no stream spent), then the oath screen; 1 of 4
 *   after a severed weight; a first run (the viewer has not met the Jailer's weight) only «Прямая», «Наледь», «Взрыв на конце»;
 * - «Застава» puts a form of the other field in its rare place while the run holds one; one form per field — a form of a held
 *   field replaces the old one and the screen says which;
 * - «Чужак» and «Развилка» are never offered, «Близнецы» are (only with the flag);
 * - the fights of a run with forms play the counters' chain window and the forms' price; the forms act (real fights replay to
 *   their hash); saves read back and malformed ones read as no run.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. Variety over seeds, not a fixed outcome per seed. No claim on winning a fight.
 */
import {
  createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtChooseTalisman, rtHammerOptions, rtEnterNode, rtFormOptions, rtFormPool,
  rtFormReplaces, rtFormsFirst, rtFormSlotField, rtNode, rtRerollTalismans, rtRerollView, rtRunParams, rtShopBuy, rtShopLeave, rtShopView, serializeRtRun, RT_FORM_OFFER_SIZE, RT_JAILER_SEVERED_SLOTS,
  type RtRunState, type RtRunStep,
} from './rtRun';
import { isRtForm, rtFormField, rtTalisman, RT_FORMS } from './rtTalismans';
import { FORMS, FROST_PASS, HAMMERS } from '../sim/buildIds';
import { AFFIX_IDS } from '../sim/elites';
import { affixElement, PART_ARC, SCHEDULE_ELEMENTS } from './schedule';
import { stepChoices } from '../telemetry/recorder';
import { RT_META_LOCKABLE } from './metaCatalog';
import { assert, closeNode, ok, playFight, quiet, same, seedOf, takeGift } from './runFight.testkit';
import type { ForestMapNode } from '../forest/forestMap';
import type { WorldEvent } from '../sim/world';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

type Pending = NonNullable<RtRunState['pending']>;
type Offer = Extract<Pending, { kind: 'talisman' }>;
const VETERAN = [...SCHEDULE_ELEMENTS, ...AFFIX_IDS.map(affixElement)];
const SIMPLE = [FORMS.pierce, FROST_PASS, HAMMERS.blast].sort();
const reload = (run: RtRunState): RtRunState => { const back = parseRtRun(serializeRtRun(run)); assert(back && same(back, run), 'the save reads back'); return back; };
const win = (run: RtRunState, severed = false): RtRunState => {
  const pending = run.pending as Extract<Pending, { kind: 'battle' }>;
  return ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1, ...severed ? { severed: true } : {} }), 'win');
};
const nodeOf = (run: RtRunState): ForestMapNode => rtNode(run, (run.pending as { nodeId: string }).nodeId)!;

/** What a walk saw: every talisman screen (source, options) and the merchant's talisman, in order. */
interface Seen { screens: { source: string; options: string[] }[]; replaced: { id: string; by: string; shown: string | null }[] }
/**
 * A policy: which option a screen takes (null — refuse) and which node comes next (`prefer` — that type first, else the node
 * `(k + step)`); `severed` — the Jailer's weight was severed in its fight; `buy` — the merchant's talisman is bought.
 */
interface Policy { pick?: (run: RtRunState, offer: Offer) => string | null; prefer?: (run: RtRunState) => string | null; severed?: boolean; buy?: (run: RtRunState) => boolean; stop?: (run: RtRunState) => boolean }

/** Walks `run` by its own commands (battles won without a fight, the rest closed simply), saving and loading at every step. */
function walk(run: RtRunState, k: number, policy: Policy = {}, seen: Seen = { screens: [], replaced: [] }): RtRunState {
  const record = (step: RtRunStep, shown: (id: string) => string | null): RtRunState => {
    assert(step.ok, `a step: ${!step.ok ? step.reason : ''}`);
    for (const e of step.events) if (e.type === 'form-replaced') seen.replaced.push({ id: e.id, by: e.by, shown: shown(e.by) });
    return step.run;
  };
  for (let step = 0; step < 300 && !run.result; step++) {
    if (policy.stop?.(run)) return run;
    run = reload(run);
    const pending = run.pending;
    if (pending?.kind === 'battle') { run = win(run, policy.severed && nodeOf(run).type === 'checkpoint'); continue; }
    if (pending?.kind === 'talisman') {
      seen.screens.push({ source: pending.source, options: [...pending.options] });
      const pick = policy.pick?.(run, pending) ?? null, before = run;
      run = record(rtChooseTalisman(run, pick), id => rtFormReplaces(before, id));
      continue;
    }
    if (pending?.kind === 'shop') {
      const stock = pending.stock.talisman;
      if (stock) seen.screens.push({ source: 'shop', options: [stock] });
      const good = rtShopView(run)!.goods.find(entry => entry.id === 'talisman');
      if (good?.available && policy.buy?.(run)) run = record(rtShopBuy(run, 'talisman'), () => good.replaces ?? null);
      run = ok(rtShopLeave(run), 'leave');
      continue;
    }
    if (pending?.kind === 'gift') { run = takeGift(run); continue; }
    if (pending) { run = closeNode(run); continue; }
    const next = rtAvailableNodes(run), want = policy.prefer?.(run);
    run = ok(rtEnterNode(run, (next.find(node => node.type === want) ?? next[(k + step) % next.length]).id), 'enter');
  }
  return run;
}
const atJailerScreen = (run: RtRunState): boolean => run.pending?.kind === 'talisman' && (run.pending.source === 'form' || run.pending.source === 'oath') || run.pending?.kind === 'hammer';
const toJailerScreen = (run: RtRunState, k: number, severed = false): RtRunState => {
  const at = walk(run, k, { prefer: () => 'checkpoint', severed, stop: atJailerScreen });
  assert(atJailerScreen(at), `seed ${k}: the Jailer's screen reached`);
  return at;
};

check('a run without the flag (a save before the task): no form, no «Близнецы», the hammer screen, the save without the field; a run with the flag walks the same map, nodes, events, gift and stream counters, its screens differ only in uncommon places (the openers\' pool, design decision 5)', () => {
  let differ = 0, slots = 0;
  for (let k = 1; k <= 80; k++) {
    const seenOld: Seen = { screens: [], replaced: [] }, seenNew: Seen = { screens: [], replaced: [] };
    const policy: Policy = { prefer: run => (run.visited.length % 3 === 0 ? 'hard' : null) };
    const old = walk(createRtRun(seedOf(k), { gift: 'full', forms: false }), k, policy, seenOld);
    const fresh = walk(createRtRun(seedOf(k), { gift: 'full' }), k, policy, seenNew);
    assert(old.forms === undefined && !serializeRtRun(old).includes('"forms"') && fresh.forms === true, `seed ${k}: the flag`);
    assert(seenOld.screens.every(s => s.options.every(id => !isRtForm(id) && id !== FORMS.twins)), `seed ${k}: a form or «Близнецы» without the flag`);
    for (const [what, a, b] of [['map', old.map, fresh.map], ['visited', old.visited, fresh.visited], ['picks', old.picks, fresh.picks], ['events', old.eventChoices, fresh.eventChoices],
      ['streams', old.streams, fresh.streams], ['gift', old.gift, fresh.gift], ['oath draws', old.oathDraws, fresh.oathDraws]] as const) assert(same(a, b), `seed ${k}: ${what} differ`);
    // The screens in order: the hammer screen of the old run is the form screen of the new one; the rest place by place.
    const a = seenOld.screens, b = seenNew.screens.filter(s => s.source !== 'form');
    assert(a.length === b.length, `seed ${k}: ${a.length} screens vs ${b.length}`);
    for (let i = 0; i < a.length; i++) {
      assert(a[i].source === b[i].source, `seed ${k}: screen ${i} ${a[i].source} vs ${b[i].source}`);
      for (let s = 0; s < Math.max(a[i].options.length, b[i].options.length); s++) {
        slots++;
        const x = a[i].options[s], y = b[i].options[s];
        if (x === y) continue;
        differ++;
        const uncommon = (id: string | undefined) => !id || id === FORMS.twins || rtTalisman(id)?.rarity === 'uncommon';
        assert(uncommon(x) && uncommon(y), `seed ${k}: ${a[i].source} place ${s}: ${x} vs ${y} — not an uncommon place`);
      }
    }
  }
  console.log(`   80 seeds: ${differ} of ${slots} offer places differ, every one an uncommon place`);
});

check('the Jailer\'s first screen: 3 forms of «Путь» and «Конец» by the node\'s roll (no stream spent; a reload the same), then the oath and relic screen of 3; every form comes over the seeds; the screen is a choice `form` for the telemetry', () => {
  const offered = new Map<string, number>();
  for (let k = 1; k <= 120; k++) {
    const before = walk(createRtRun(seedOf(k), { gift: 'mini' }), k, { prefer: () => 'checkpoint', stop: run => run.pending?.kind === 'battle' && nodeOf(run).type === 'checkpoint' });
    const at = win(before), offer = at.pending as Offer;
    assert(offer?.kind === 'talisman' && offer.source === 'form' && offer.options.length === RT_FORM_OFFER_SIZE && new Set(offer.options).size === RT_FORM_OFFER_SIZE, `seed ${k}: three forms (${offer?.kind} ${offer?.options})`);
    assert(offer.options.every(id => isRtForm(id) && ['path', 'end'].includes(rtFormField(id)!)), `seed ${k}: forms of «Путь» and «Конец» (${offer.options})`);
    assert(same(at.streams, before.streams) && same(reload(at), at) && same(rtFormOptions(at, offer.nodeId), offer.options), `seed ${k}: no stream spent, the save the same`);
    for (const id of offer.options) offered.set(id, (offered.get(id) ?? 0) + 1);
    const pick = offer.options[k % 4] ?? null, step = rtChooseTalisman(at, pick);
    assert(step.ok, 'choose');
    const choice = stepChoices(at, step);
    assert(choice.length === 1 && choice[0].source === 'form' && same(choice[0].offered, offer.options) && same(choice[0].taken, pick ? [pick] : []), `seed ${k}: the telemetry's choice ${JSON.stringify(choice)}`);
    const next = step.run, oath = next.pending as Offer;
    assert(oath?.kind === 'talisman' && oath.source === 'oath' && oath.options.length === 3 && next.streams.talismans === before.streams.talismans + 1, `seed ${k}: the oath screen of 3 (one talismans draw)`);
    assert(pick ? next.talismans.includes(pick) : !next.talismans.some(isRtForm), `seed ${k}: the form taken (${pick})`);
    assert(next.talismansGone.every(id => !isRtForm(id)), `seed ${k}: a form not taken stays in the pool`);
    reload(next);
  }
  console.log(`   offered over 120 seeds: ${RT_FORMS.map(def => `${def.name} ${offered.get(def.id) ?? 0}`).join(', ')}`);
  for (const def of RT_FORMS) assert((offered.get(def.id) ?? 0) >= 10, `${def.name}: offered ${offered.get(def.id) ?? 0} times`);
});

check('a severed weight: 1 of 4 on the form screen (the three of 1 of 3 and one more), the oath screen 1 of 3; the record keeps the sever, the save reads back', () => {
  for (let k = 1; k <= 20; k++) {
    const four = toJailerScreen(createRtRun(seedOf(k), { gift: 'mini' }), k, true), three = toJailerScreen(createRtRun(seedOf(k), { gift: 'mini' }), k);
    const o4 = (four.pending as Offer).options, o3 = (three.pending as Offer).options;
    assert(o4.length === RT_JAILER_SEVERED_SLOTS && o3.length === 3 && same(o4.slice(0, 3), o3) && (four.pending as Offer).source === 'form', `seed ${k}: ${o4} vs ${o3}`);
    assert(four.battles.at(-1)!.severed === true && same(reload(four), four), `seed ${k}: the record and the save`);
    const oath = ok(rtChooseTalisman(four, o4[3]), 'the fourth').pending as Offer;
    assert(oath.source === 'oath' && oath.options.length === 3, `seed ${k}: the oath screen of 3 (${oath.options.length})`);
    const forged = structuredClone(four);
    delete forged.battles.at(-1)!.severed;
    assert(parseRtRun(serializeRtRun(forged)) === null, `seed ${k}: four forms without the sever — no run`);
  }
});

check('a first run (the viewer has not met the Jailer\'s weight): the Jailer offers only «Прямая», «Наледь», «Взрыв на конце» — a new viewer and one who met other things (a severed weight keeps 1 of 4 on the oath screen there: three forms cannot make it); a viewer who met the weight, and a run without a schedule, the whole catalogue', () => {
  const later = new Set<string>();
  for (let k = 1; k <= 40; k++) {
    for (const seen of [[], ['cliff', 'elite', 'shield']]) {
      const run = createRtRun(seedOf(k + 100), { gift: 'mini', schedule: seen });
      assert(rtFormsFirst(run) && same([...rtFormPool(run)].sort(), SIMPLE), `seed ${k}: the first run's pool ${rtFormPool(run)}`);
      const severed = k % 2 === 0, at = toJailerScreen(run, k, severed), options = (at.pending as Offer).options;
      assert((at.pending as Offer).source === 'form' && same([...options].sort(), SIMPLE), `seed ${k} (${seen.length} met): ${options}`);
      // Three simple forms cannot make 1 of 4: a severed weight keeps its 1 of 4 on the oath screen (as before task 30).
      const oath = ok(rtChooseTalisman(at, null), 'refuse').pending as Offer;
      assert(oath.source === 'oath' && oath.options.length === (severed ? RT_JAILER_SEVERED_SLOTS : 3), `seed ${k}: the oath screen ${oath.options.length}`);
      reload(ok(rtChooseTalisman(at, null), 'refuse'));
    }
    for (const run of [createRtRun(seedOf(k + 100), { gift: 'mini', schedule: [PART_ARC] }), createRtRun(seedOf(k + 100), { gift: 'mini', schedule: VETERAN }), createRtRun(seedOf(k + 100), { gift: 'mini' })]) {
      assert(!rtFormsFirst(run) && rtFormPool(run).length === RT_FORMS.length, 'not a first run');
      for (const id of (toJailerScreen(run, k).pending as Offer).options) later.add(id);
    }
  }
  assert(later.size === RT_FORMS.length && [...later].some(id => !SIMPLE.includes(id)), `the later runs offer the others too: ${[...later]}`);
});

check('«Застава» after a form: its rare place holds a form of the other field (by the node\'s roll), the other places are talismans; taken — one form on each field; with both fields held, or with no form, the rare place is a talisman again', () => {
  let formed = 0, both = 0, plain = 0, refusedPlain = 0;
  const fields = new Set<string>();
  for (let k = 1; k <= 120; k++) {
    // The Jailer's first option is taken; «Застава» preferred after it; a form on a screen is taken.
    const seen: Seen = { screens: [], replaced: [] };
    let first: string | null = null;
    const end = walk(createRtRun(seedOf(k + 300), { gift: 'mini' }), k, {
      prefer: run => (run.visited.some(id => rtNode(run, id)!.type === 'checkpoint') ? 'hard' : 'checkpoint'),
      pick: (run, offer) => {
        if (offer.source === 'form') { first = offer.options[0]; return first; }
        if (offer.source === 'hard') {
          const field = rtFormSlotField(run), form = offer.options.find(isRtForm);
          if (field) {
            assert(form && offer.options.indexOf(form) === 0 && rtFormField(form) === field && offer.options.slice(1).every(id => !isRtForm(id)), `seed ${k}: the rare place a form of «${field}» (${offer.options})`);
            assert(rtFormPool(run, field).includes(form) && !rtFormReplaces(run, form), `seed ${k}: from the pool of that field, replacing nothing`);
            formed++; fields.add(`${rtFormField(first!)}→${field}`);
            return form;
          }
          assert(!form, `seed ${k}: a form without an open field (${offer.options})`);
          plain++;
        }
        return null;
      },
    }, seen);
    const held = end.talismans.filter(isRtForm);
    assert(new Set(held.map(rtFormField)).size === held.length, `seed ${k}: one form per field (${held})`);
    if (held.length === 2) both++;
    // The same seed with the Jailer's forms refused: «Застава» has no form.
    walk(createRtRun(seedOf(k + 300), { gift: 'mini' }), k, {
      prefer: run => (run.visited.some(id => rtNode(run, id)!.type === 'checkpoint') ? 'hard' : 'checkpoint'),
      pick: (_run, offer) => { if (offer.source === 'hard') { assert(!offer.options.some(isRtForm), `seed ${k}: no form without the first one`); refusedPlain++; } return null; },
    });
  }
  console.log(`   120 seeds: a form in the rare place ${formed} times (${[...fields].join(', ')}), runs ending with two forms ${both}; «Застава» with both fields held — talismans ${plain} times; without a first form ${refusedPlain}`);
  // A path meets at most one «Застава» on these maps (rows 7–8), so «both fields held» comes only from a later source.
  assert(formed >= 20 && fields.size === 2 && refusedPlain >= 20, 'every case met');
});

check('one form per field: a form of a held field replaces the old one — the screen shows which (`rtFormReplaces`, the merchant\'s `replaces`), the old one leaves the run and the pool; «Звено»: «Близнецы» and «Якорь у героя» over many runs; «Путь» on the Jailer\'s screen of a run that held a path form (a save made by hand)', () => {
  // «Звено»: the run walks taking every «Близнецы» and «Якорь у героя» a screen or the merchant offers. Both in one run are rare
  // (uncommon and rare), so after the first map step one of them is put into the run by hand (the save reads back) and the walk
  // goes on with the run's own screens and draws.
  const replaced: Seen['replaced'] = [];
  const linked = (id: string) => id === FORMS.twins || id === 'hero-anchor';
  for (let k = 1; k <= 300 && !(replaced.some(r => r.by === FORMS.twins) && replaced.some(r => r.by === 'hero-anchor')); k++) {
    const seen: Seen = { screens: [], replaced: [] };
    const policy: Policy = {
      prefer: run => (['hard', 'shop', 'event'][run.visited.length % 3]),
      pick: (_run, offer) => offer.options.find(linked) ?? null,
      buy: run => { const id = (run.pending as Extract<Pending, { kind: 'shop' }>).stock.talisman; return !!id && linked(id); },
    };
    const start = walk(createRtRun(seedOf(k + 700), { gift: 'full' }), k, { ...policy, stop: run => !run.pending && run.visited.length >= 1 });
    const held = reload({ ...structuredClone(start), talismans: [...start.talismans.filter(id => !linked(id)), k % 2 ? FORMS.twins : 'hero-anchor'] });
    const end = walk(held, k, policy, seen);
    for (const r of seen.replaced) {
      assert(r.shown === r.id, `seed ${k}: the screen showed «${r.shown}», replaced «${r.id}»`);
      assert(!end.talismans.includes(r.id) && end.talismansGone.includes(r.id), `seed ${k}: «${r.id}» left the run and the pool`);
    }
    assert(end.talismans.filter(id => rtFormField(id) === 'link').length === 1, `seed ${k}: one form of «Звено» (${end.talismans})`);
    replaced.push(...seen.replaced);
  }
  console.log(`   «Звено» replaced ${replaced.length} times: ${replaced.map(r => `${r.id}→${r.by}`).join(', ')}`);
  assert(replaced.some(r => r.by === FORMS.twins) && replaced.some(r => r.by === 'hero-anchor'), 'both ways met');
  // «Путь»: a run that holds a path form before its Jailer's fight (put in by hand — no screen of a run gives one before the
  // Jailer; the save reads back), then wins it: the screen's path form replaces it, the screen says so, the save reads back.
  for (let k = 1; k <= 40; k++) {
    const before = walk(createRtRun(seedOf(k + 900), { gift: 'mini' }), k, { prefer: () => 'checkpoint', stop: run => run.pending?.kind === 'battle' && nodeOf(run).type === 'checkpoint' });
    const other = [FROST_PASS, HAMMERS.cut, HAMMERS.fire][k % 3];
    const held = win(reload({ ...structuredClone(before), talismans: [...before.talismans, other] })), offer = held.pending as Offer;
    assert(offer.source === 'form' && !offer.options.includes(other), `seed ${k}: the form screen without the held one`);
    const path = offer.options.find(id => rtFormField(id) === 'path');
    if (!path) continue;
    reload(held);
    assert(rtFormReplaces(held, path) === other && offer.options.every(id => (rtFormField(id) === 'path') === (rtFormReplaces(held, id) === other)), `seed ${k}: the screen shows «${other}» replaced by the path forms only (${offer.options})`);
    const step = rtChooseTalisman(held, path);
    assert(step.ok && step.events.some(e => e.type === 'form-replaced' && e.id === other && e.by === path), `seed ${k}: the event`);
    const after = reload(step.run);
    assert(after.talismans.includes(path) && !after.talismans.includes(other) && after.talismansGone.includes(other), `seed ${k}: the old path form left (${after.talismans})`);
    assert(parseRtRun(serializeRtRun({ ...after, talismans: [...after.talismans, other], talismansGone: after.talismansGone.filter(id => id !== other) })) === null, `seed ${k}: two path forms — no run`);
    return;
  }
  throw new Error('no Jailer screen with a path form in 40 seeds');
});

check('the pool: «Близнецы» come with the flag (rarity uncommon), never without it; «Чужак» and «Развилка» never — over many whole runs and every screen (hard, events, the chest, the feat, the merchant, the gift, the Jailer)', () => {
  const count = { twins: 0, twinsOld: 0, screens: 0 };
  for (let k = 1; k <= 150; k++) for (const forms of [true, false]) {
    const seen: Seen = { screens: [], replaced: [] };
    const run = createRtRun(seedOf(k + 1100), { gift: 'full', forms, feats: true });
    const end = walk(run, k, { prefer: r => (r.visited.length % 2 ? 'hard' : 'shop'), pick: (_r, offer) => offer.options[k % 3] ?? null, buy: () => k % 2 === 0 }, seen);
    const gift = run.gift ? JSON.stringify(run.gift) : '';
    for (const s of seen.screens) {
      count.screens++;
      assert(!s.options.includes(FORMS.alien) && !s.options.includes(FORMS.fork), `seed ${k}: «Чужак» or «Развилка» offered (${s.source}: ${s.options})`);
      if (s.options.includes(FORMS.twins)) { if (forms) count.twins++; else count.twinsOld++; }
    }
    assert(!gift.includes(FORMS.alien) && !gift.includes(FORMS.fork) && !gift.includes(FORMS.twins), 'the gift: its old draws');
    assert(!end.talismans.includes(FORMS.alien) && !end.talismans.includes(FORMS.fork), 'never taken');
  }
  console.log(`   ${count.screens} screens: «Близнецы» on ${count.twins} with the flag, ${count.twinsOld} without`);
  assert(count.twins >= 5 && count.twinsOld === 0, '«Близнецы» only with the flag');
  assert(rtTalisman(FORMS.twins)?.rarity === 'uncommon', 'uncommon');
});

check('the fights: a run with forms plays the counters\' chain window, «Близнецы» with their price and «Возврат» fixed (`rtArenaParams`); without the flag — the old values; the forms taken act in real fights («Огненный проход» or another path hammer as the loadout\'s hammer, «Взрыв на конце» beside it from the talismans) and replay to their hash', () => {
  const run0 = createRtRun(seedOf(1), { gift: 'mini' }), old0 = createRtRun(seedOf(1), { gift: 'mini', forms: false });
  const p = rtArenaParams(run0, rtRunParams(quiet())), q = rtArenaParams(old0, rtRunParams(quiet()));
  assert(p.counterWindow && p.twinsAlternate && p.twinsNoShift && p.returnFixed, 'the run with forms');
  assert(!q.counterWindow && !q.twinsAlternate && !q.twinsNoShift && !q.returnFixed, 'the run without');
  let pairs = 0;
  for (let k = 1; k <= 200 && pairs < 3; k++) {
    // The Jailer: «Огненный проход» if offered; «Застава»: «Взрыв на конце» if offered; the next fight plays both.
    const found: { run?: RtRunState } = {};
    walk(createRtRun(seedOf(k + 1500), { gift: 'mini' }), k, {
      prefer: run => (run.visited.some(id => rtNode(run, id)!.type === 'checkpoint') ? 'hard' : 'checkpoint'),
      pick: (_run, offer) => offer.source === 'form' ? (offer.options.includes(HAMMERS.fire) ? HAMMERS.fire : null)
        : offer.source === 'hard' ? (offer.options.includes(HAMMERS.blast) ? HAMMERS.blast : null) : null,
      stop: run => { if (run.pending?.kind === 'battle' && run.talismans.includes(HAMMERS.blast)) { found.run = run; return true; } return false; },
    });
    if (!found.run) continue;
    const run = found.run, loadout = rtArenaLoadout(run), path = run.talismans.find(id => rtFormField(id) === 'path')!;
    assert(loadout.hammer === path && loadout.talismans!.includes(HAMMERS.blast) && !loadout.talismans!.includes(path), `seed ${k}: the loadout (${loadout.hammer}; ${loadout.talismans})`);
    const events: WorldEvent[] = [];
    playFight(run, { chains: [4, 4], k, params: rtArenaParams(run, rtRunParams(quiet())), seen: w => events.push(...w.events) });
    const kinds = new Set(events.flatMap(e => (e.type === 'hammer' ? [e.kind] : [])));
    assert(path === HAMMERS.fire && kinds.has('blast') && kinds.has('fire'), `seed ${k}: both forms acted (${[...kinds]})`);
    pairs++;
  }
  assert(pairs >= 1, 'a run with a path hammer and «Взрыв на конце» met');
  // «Возврат» never with «Взрыв на конце» (the return run's shadow does not see the blast): not in the pool of the other field.
  const ret = { ...createRtRun(seedOf(9), { gift: 'mini' }), talismans: [HAMMERS.return] };
  assert(rtFormSlotField(ret) === 'end' && !rtFormPool(ret, 'end').includes(HAMMERS.blast) && rtFormPool(ret, 'end').length === 2, `«Возврат»: ${rtFormPool(ret, 'end')}`);
});

check('saves: a run with forms reads back; a run without the flag saves no field and reads back byte for byte; a malformed flag, a form or «Близнецы» in a run without the flag, a hammer of the hammer screen in a run with it, a forged form screen — no run', () => {
  for (let k = 1; k <= 10; k++) {
    const old = toJailerScreen(createRtRun(seedOf(k + 2000), { gift: 'mini', forms: false }), k), text = serializeRtRun(old);
    assert(old.pending?.kind === 'hammer' && serializeRtRun(parseRtRun(text)!) === text && !text.includes('"forms"'), `seed ${k}: the old run byte for byte`);
    const at = toJailerScreen(createRtRun(seedOf(k + 2000), { gift: 'mini' }), k), offer = at.pending as Offer;
    const taken = ok(rtChooseTalisman(at, offer.options[0]), 'take');
    reload(taken);
    const bad = (value: unknown, what: string) => assert(parseRtRun(JSON.stringify(value)) === null, `seed ${k}: ${what} — no run`);
    bad({ ...taken, forms: false }, 'forms: false');
    bad({ ...taken, forms: 1 }, 'forms: 1');
    // Each with its control: the same save without the one thing wrong reads back.
    const noFlag = structuredClone(taken) as Partial<RtRunState>;
    delete noFlag.forms;
    // Task 44: the fusions' flag lives only with the forms.
    delete noFlag.fusions;
    bad(noFlag, 'a form without the flag');
    assert(parseRtRun(JSON.stringify({ ...noFlag, talismans: noFlag.talismans!.filter(id => !isRtForm(id)) })), 'control: without the form it reads');
    const fresh = createRtRun(seedOf(k + 2000), { gift: 'mini', forms: false });
    bad({ ...fresh, talismans: [FORMS.twins] }, '«Близнецы» without the flag');
    assert(parseRtRun(JSON.stringify({ ...fresh, talismans: ['hero-anchor'] })), 'control: another talisman reads');
    const hammer = rtHammerOptions(taken, offer.nodeId)[0];
    bad({ ...taken, hammer }, 'a hammer of the hammer screen with the flag');
    assert(parseRtRun(JSON.stringify({ ...noFlag, talismans: noFlag.talismans!.filter(id => !isRtForm(id)), hammer })), 'control: that hammer reads without the flag');
    bad({ ...at, pending: { ...offer, options: [...offer.options].reverse() } }, 'a forged form screen');
    bad({ ...at, pending: { kind: 'hammer', nodeId: offer.nodeId, options: rtHammerOptions(at, offer.nodeId) } }, 'the hammer screen with the flag');
    const atOld = structuredClone(at) as Partial<RtRunState>;
    delete atOld.forms;
    delete atOld.fusions;
    assert(parseRtRun(JSON.stringify({ ...atOld, pending: { kind: 'hammer', nodeId: offer.nodeId, options: rtHammerOptions(at, offer.nodeId) } })), 'control: the hammer screen without the flag reads');
  }
});

check('the meta (task 36): a locked form is offered nowhere — «Возврат» (pack 2) on the Jailer\'s screen and in «Застава»\'s place, «Близнецы» (pack 3) in no pool; a lock that leaves fewer forms than a screen needs shows fewer; the camp (task 37): «Полный верстак» gives the form screen 4, «Правка» rerolls it free (the forms not shown first, no stream spent, one reroll a run)', () => {
  assert(RT_META_LOCKABLE.includes(FORMS.twins) && RT_META_LOCKABLE.includes(HAMMERS.return) && !RT_META_LOCKABLE.includes('shockwave'), 'pack 3 holds «Близнецы», «Ударная волна» is no longer locked');
  const locked = [...RT_META_LOCKABLE];
  let formScreens = 0, hard = 0, twinsOpen = 0;
  for (let k = 1; k <= 60; k++) {
    const seen: Seen = { screens: [], replaced: [] };
    const run = createRtRun(seedOf(k + 4000), { gift: k % 2 ? 'full' : 'mini', feats: true, locked });
    const end = walk(run, k, {
      prefer: r => (r.visited.some(id => rtNode(r, id)!.type === 'checkpoint') ? (k % 3 ? 'hard' : 'shop') : null),
      pick: (_r, offer) => offer.options[0] ?? null, buy: () => true,
    }, seen);
    const gift = JSON.stringify(run.gift ?? {});
    for (const sc of seen.screens) {
      assert(!sc.options.some(id => locked.includes(id)), `seed ${k}: a locked item offered (${sc.source}: ${sc.options})`);
      if (sc.source === 'form') formScreens++;
      if (sc.source === 'hard') hard++;
    }
    assert(!locked.some(id => gift.includes(`"${id}"`)) && !end.talismans.some(id => locked.includes(id)), `seed ${k}: the gift and the run hold nothing locked`);
    // The same seed with every pack open: «Близнецы» may come.
    const open: Seen = { screens: [], replaced: [] };
    walk(createRtRun(seedOf(k + 4000), { gift: k % 2 ? 'full' : 'mini', feats: true, locked: [] }), k, { pick: (_r, offer) => offer.options[0] ?? null, buy: () => true }, open);
    if (open.screens.some(sc => sc.options.includes(FORMS.twins))) twinsOpen++;
  }
  console.log(`   60 meta runs with every pack locked: ${formScreens} form screens, ${hard} «Застава» screens, nothing locked offered; the same seeds open — «Близнецы» offered in ${twinsOpen}`);
  assert(formScreens >= 30 && hard >= 10 && twinsOpen >= 1, 'every source met');
  // A lock that leaves two forms (a state made by hand — the meta locks only «Возврат» of them): the Jailer shows two, «Застава» one.
  const before = walk(createRtRun(seedOf(4100), { gift: 'mini' }), 1, { prefer: () => 'checkpoint', stop: r => r.pending?.kind === 'battle' && nodeOf(r).type === 'checkpoint' });
  const tight = { ...before, locked: [HAMMERS.fire, HAMMERS.cut, HAMMERS.return, FROST_PASS, FORMS.seal] };
  const two = win(tight, true), screen = two.pending as Offer;
  assert(screen.source === 'form' && same([...screen.options].sort(), [HAMMERS.blast, FORMS.pierce].sort()), `two forms left: ${screen.options}`);
  assert(rtFormPool({ ...two, talismans: [FORMS.pierce] }, 'path').length === 0 && rtFormSlotField({ ...two, talismans: [FORMS.pierce] }) === 'path', 'no path form left — «Застава» keeps its rare talisman');
  // The camp: «Полный верстак» — 4 forms; «Правка» — the form screen rerolls free once.
  let rerolled = 0;
  for (let k = 1; k <= 8; k++) {
    const four = toJailerScreen(createRtRun(seedOf(k + 4200), { gift: 'mini', locked: [], hearth: { hammerAll: true } }), k);
    assert((four.pending as Offer).options.length === RT_JAILER_SEVERED_SLOTS, `seed ${k}: «Полный верстак» — 4 forms (${(four.pending as Offer).options})`);
    const at = toJailerScreen(createRtRun(seedOf(k + 4200), { gift: 'mini', locked: [], hearth: { jailerRerolls: 1 } }), k), offer = at.pending as Offer;
    const view = rtRerollView(at);
    assert(view?.free && view.available && view.price === 0, `seed ${k}: a free reroll on the form screen`);
    const again = reload(ok(rtRerollTalismans(at), 'reroll')), next = again.pending as Offer;
    assert(next.source === 'form' && next.options.length === offer.options.length && next.options.some(id => !offer.options.includes(id)), `seed ${k}: new forms first (${offer.options} → ${next.options})`);
    assert(same(again.streams, at.streams) && again.jailerRerolled === 1 && same(again.materials, at.materials) && rtRerollView(again) === null, `seed ${k}: no stream, no price, one reroll`);
    const oath = ok(rtChooseTalisman(again, next.options[0]), 'take').pending as Offer;
    assert(oath.source === 'oath' && rtRerollView({ ...again, pending: oath }) === null, `seed ${k}: no free reroll left for the oath screen`);
    rerolled++;
  }
  assert(rerolled === 8, 'rerolled');
});

check('the measure (heuristic, 300 runs, a bot taking the first option of every screen, «Застава» when it can after the Jailer): forms at the end of a run — none, one, two, three; every run that took the Jailer\'s form holds it', () => {
  const by = [0, 0, 0, 0];
  let jailer = 0;
  for (let k = 1; k <= 300; k++) {
    const end = walk(createRtRun(seedOf(k + 3000), { gift: 'mini' }), k, {
      prefer: run => (run.visited.some(id => rtNode(run, id)!.type === 'checkpoint') ? (k % 2 ? 'hard' : null) : null),
      pick: (_run, offer) => offer.options[0] ?? null,
      buy: () => true,
    });
    if (end.visited.some(id => rtNode(end, id)!.type === 'checkpoint')) jailer++;
    const forms = end.talismans.filter(id => rtFormField(id) !== null).length;
    by[Math.min(3, forms)]++;
  }
  console.log(`   300 runs (${jailer} past the Jailer): forms at the end — 0: ${by[0]}, 1: ${by[1]}, 2: ${by[2]}, 3: ${by[3]}`);
  assert(by[1] + by[2] + by[3] >= jailer && by[2] > 0, 'a form for every run past the Jailer; a second in some');
});

console.log(`realtime-forms-run: ${checks} checks passed`);
