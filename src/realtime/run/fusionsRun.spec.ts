/**
 * Task 44 «Сплавы» in the run (docs/design-notes/task-44-fusions.md; docs/realtime-slice.md, section 8, «Сплавы»). Node only:
 * `npm run test:realtime-fusions-run`. Everything goes through the run's own commands (create, enter, choose, buy, rest, save and
 * load at every step; battles fed back won):
 * - a run without the flag (`fusions: false`, a save before the task) walks as a run with it until a half of a recipe is taken;
 * - the pair guarantee: a half taken — the next talisman screen that can carry its partner («Застава», an event's reward, the chest,
 *   the feat, the Jailer's form screen for a form, the merchant) shows the partner in its last place, on many seeds, once;
 * - the rest with both parts offers «Сплав» beside the heal and the craft; the fusion takes the rest, the parts leave the run and
 *   the pool, the next arena's kit holds the fusion and its parts; a rest closed by the heal keeps the offer for the next;
 * - the meta: a recipe whose part is locked (or a first run's form not offered) has no recipe line and no guarantee;
 * - saves: malformed flags and fusions without the flag read as no run;
 * - telemetry: the run record's `fusions` (halves, pairs, the fusion made) and the report's section.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. Variety over seeds, not a fixed outcome per seed.
 */
import {
  createRtRun, parseRtRun, rtEnterGarrison, rtRerollTalismans, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseTalisman, rtEnterNode, rtFormReplaces, rtFusionPair, rtFusionRecipe,
  rtFusionsReady, rtRestFuse, rtRestHeal, rtRestView, rtShopBuy, rtShopLeave, rtShopView, serializeRtRun, type RtRunEvent, type RtRunState, type RtRunStep,
} from './rtRun';
import { isRtForm, rtTalisman } from './rtTalismans';
import { COUNTER_TALISMANS as CT, FORMS, FUSIONS, FUSION_RECIPES, HAMMERS, fusionOfHalf, type FusionId } from '../sim/buildIds';
import { kitOf } from '../sim/kit';
import { PART_ARC } from './schedule';
import { assert, closeNode, ok, same, seedOf, takeGift } from './runFight.testkit';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { copyParams, defaultParams } from '../sim/params';
import { fusionsSection } from '../telemetry/report';
import type { Journal } from '../sim/simulation';
import { checkRecord, type RunRecord } from '../telemetry/schema';

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

const HALVES = FUSION_RECIPES.flatMap(r => [r.form, r.counter]);
const CARRYING = ['hard', 'event', 'chest', 'feat', 'form', 'shop'];
const reload = (run: RtRunState): RtRunState => { const back = parseRtRun(serializeRtRun(run)); assert(back && same(back, run), 'the save reads back'); return back; };

/** A screen the walk saw: where, what it showed, what the run held before it. */
interface Screen { source: string; options: string[]; held: string[]; gone: string[] }
interface Seen { screens: Screen[]; events: RtRunEvent[]; fused: { run: RtRunState; fusion: FusionId }[] }
/**
 * The walk's policy: a screen takes the partner of a held half if shown, else a half, else nothing; the merchant sells the same
 * way; a rest with a pair fuses (`fuse`) or heals; `prefer` — the node type to enter first.
 */
interface Policy { refusePartners?: boolean; fuse?: boolean; prefer?: (run: RtRunState) => string | null; stop?: (run: RtRunState) => boolean; takeHalves?: boolean; feed?: (before: RtRunState, step: Extract<RtRunStep, { ok: true }>) => void }
const partnerOf = (run: RtRunState, id: string): boolean => { const of = fusionOfHalf(id); return !!of && run.talismans.includes(of.partner) && !run.talismans.includes(id); };
function choose(run: RtRunState, options: readonly string[], policy: Policy): string | null {
  if (policy.takeHalves === false) return null;
  if (policy.refusePartners) return options.find(id => HALVES.includes(id) && !run.talismans.includes(id) && !partnerOf(run, id)) ?? null;
  return options.find(id => partnerOf(run, id)) ?? options.find(id => HALVES.includes(id) && !run.talismans.includes(id)) ?? null;
}

function walk(run: RtRunState, k: number, policy: Policy = {}, seen: Seen = { screens: [], events: [], fused: [] }): RtRunState {
  const apply = (before: RtRunState, step: RtRunStep): RtRunState => {
    assert(step.ok, `a step: ${!step.ok ? step.reason : ''}`);
    seen.events.push(...step.events);
    policy.feed?.(before, step);
    return step.run;
  };
  for (let n = 0; n < 800 && !run.result; n++) {
    if (policy.stop?.(run)) return run;
    run = reload(run);
    const pending = run.pending, before = run;
    if (pending?.kind === 'battle') { run = apply(before, resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 })); continue; }
    if (pending?.kind === 'talisman') {
      seen.screens.push({ source: pending.source, options: [...pending.options], held: [...run.talismans], gone: [...run.talismansGone] });
      run = apply(before, rtChooseTalisman(run, choose(run, pending.options, policy)));
      continue;
    }
    if (pending?.kind === 'shop') {
      const stock = pending.stock.talisman;
      if (stock) seen.screens.push({ source: 'shop', options: [stock], held: [...run.talismans], gone: [...run.talismansGone] });
      const good = rtShopView(run)!.goods.find(entry => entry.id === 'talisman');
      if (good?.available && stock && choose(run, [stock], policy)) run = apply(before, rtShopBuy(run, 'talisman'));
      run = apply(run, rtShopLeave(run));
      continue;
    }
    if (pending?.kind === 'rest') {
      const view = rtRestView(run)!, offer = view.fusions.find(f => f.available);
      if (offer && policy.fuse) { seen.fused.push({ run, fusion: offer.fusion }); run = apply(before, rtRestFuse(run, offer.fusion)); continue; }
      run = apply(before, rtRestHeal(run));
      continue;
    }
    if (pending?.kind === 'gift') { run = takeGift(run); continue; }
    // Task 38: «Предместье» — on into the garrison (its rests offer fusions too).
    if (pending?.kind === 'outskirts') { run = apply(before, rtEnterGarrison(run)); continue; }
    if (pending) { run = closeNode(run); continue; }
    const next = rtAvailableNodes(run), want = policy.prefer?.(run);
    run = apply(before, rtEnterNode(run, (next.find(node => node.type === want) ?? next[(k + n) % next.length]).id));
  }
  return run;
}
const preferRestWhenReady = (other: string | null) => (run: RtRunState): string | null => (rtFusionsReady(run).length ? 'rest' : other);

await check('a run without the flag walks as a run with it until a half of a recipe is held; its save has no field; `fusions` needs `forms`', () => {
  let compared = 0;
  for (let k = 1; k <= 30; k++) {
    const policy: Policy = { takeHalves: false, prefer: run => (run.visited.length % 3 === 0 ? 'hard' : null) };
    const a: Seen = { screens: [], events: [], fused: [] }, b: Seen = { screens: [], events: [], fused: [] };
    const old = walk(createRtRun(seedOf(k), { gift: 'mini', fusions: false }), k, policy, a);
    const fresh = walk(createRtRun(seedOf(k), { gift: 'mini' }), k, policy, b);
    assert(!serializeRtRun(old).includes('fusion') && fresh.fusions === true && old.fusions === undefined, `seed ${k}: the flag only in the new run`);
    const firstHalf = (s: Seen) => { const i = s.screens.findIndex(x => x.held.some(id => HALVES.includes(id))); return i < 0 ? s.screens.length : i; };
    const upTo = Math.min(firstHalf(a), firstHalf(b));
    assert(same(a.screens.slice(0, upTo), b.screens.slice(0, upTo)), `seed ${k}: the same screens before a half is held`);
    if (upTo === a.screens.length && upTo === b.screens.length) {
      const { fusions: _f, fusionShown: _s, ...rest } = fresh;
      assert(same(rest, old), `seed ${k}: no half ever held — the same run`);
      compared++;
    }
  }
  assert(compared >= 5, `runs compared whole: ${compared}`);
  assert(!createRtRun(seedOf(1), { forms: false }).fusions, 'no forms — no fusions');
});

await check('the pair guarantee: a half taken — the next screen that can carry the partner shows it in its last place («Застава»\'s rare place kept), on many seeds; once', () => {
  let shown = 0, seeds = 0, shop = 0, rare = 0;
  const sources = new Set<string>();
  for (let k = 1; k <= 40; k++) {
    const seen: Seen = { screens: [], events: [], fused: [] };
    walk(createRtRun(seedOf(k + 300), { gift: 'mini' }), k, { prefer: run => ['hard', 'event', 'shop', 'checkpoint'][run.visited.length % 4] }, seen);
    let any = false;
    // The halves held whose partner the run has not met on a carrying screen since the half came.
    const met = new Set<string>();
    for (const s of seen.screens) {
      if (!CARRYING.includes(s.source)) continue;
      const owed = s.held.filter(h => { const of = fusionOfHalf(h); return of && !s.held.includes(of.partner) && !s.held.includes(of.fusion) && !met.has(h) && !s.gone.includes(of.partner); });
      const partners = owed.map(h => fusionOfHalf(h)!.partner).filter(p => s.source !== 'form' || isRtForm(p));
      if (!partners.length) continue;
      const at = s.options.findIndex(id => partners.includes(id));
      assert(at >= 0, `seed ${k}: a ${s.source} screen after a half (${owed}) shows a partner: ${s.options}`);
      if (s.source === 'hard' && s.options.length > 1) { assert(at > 0, `seed ${k}: «Застава»'s rare place kept`); rare++; }
      for (const h of owed) if (s.options.includes(fusionOfHalf(h)!.partner)) met.add(h);
      // A pair the draw put there itself may stand anywhere; the guarantee's place is the last one.
      if (at !== s.options.length - 1) continue;
      shown++; any = true; sources.add(s.source); if (s.source === 'shop') shop++;
    }
    if (any) seeds++;
  }
  assert(seeds >= 10 && sources.has('hard') && sources.has('shop'), `the guarantee seen on ${seeds} seeds, ${shown} screens, sources ${[...sources]} (shop ${shop}, «Застава» ${rare})`);
});

await check('the guarantee is once: a partner refused is not put in the last place again (a form partner stays in the pool, the guarantee does not)', () => {
  let refused = 0;
  for (let k = 1; k <= 40; k++) {
    const seen: Seen = { screens: [], events: [], fused: [] };
    walk(createRtRun(seedOf(k + 300), { gift: 'mini' }), k, { refusePartners: true, prefer: run => ['hard', 'event', 'shop', 'checkpoint'][run.visited.length % 4] }, seen);
    const last = new Map<string, number>();
    for (const s of seen.screens) {
      if (!CARRYING.includes(s.source) || s.source === 'form' || !s.options.length) continue;
      const id = s.options[s.options.length - 1];
      if (s.held.some(h => fusionOfHalf(h)?.partner === id)) last.set(id, (last.get(id) ?? 0) + 1);
    }
    for (const [id, n] of last) { assert(n === 1, `seed ${k}: ${id} in the last place ${n} times`); refused++; }
  }
  assert(refused >= 10, `partners shown and refused: ${refused}`);
});

await check('the guarantee is once and survives a reroll: a run holding «Иней на клинке» meets «Печать» in the last place of one screen only, the Jailer form screen included (a form stays in the pool, the guarantee does not); a reroll keeps a pair in its place', () => {
  let shown = 0, rerolled = 0;
  for (let k = 1; k <= 30; k++) {
    // The half as the run's state (a rare talisman of «Застава»): the walk then refuses every partner.
    const start = { ...takeGift(createRtRun(seedOf(k + 700), { gift: 'mini' })), talismans: [CT.frostEdge] };
    const seen: Seen = { screens: [], events: [], fused: [] };
    let tried = false;
    const policy: Policy = { refusePartners: true, prefer: run => ['hard', 'shop', 'event'][run.visited.length % 3], stop: run => {
      // Once: a screen showing the pair is rerolled (resources given) — the pair stays in the last place, the save reads back.
      const p = run.pending;
      const pair = p?.kind === 'talisman' ? p.options[p.options.length - 1] : undefined;
      if (tried || p?.kind !== 'talisman' || !['hard', 'event', 'chest'].includes(p.source) || !pair || !partnerOf(run, pair)) return false;
      tried = true;
      const rich = { ...structuredClone(run), materials: { dew: 9, powder: 9, resin: 9, herbs: 9 } };
      const step = rtRerollTalismans(rich);
      if (!step.ok) return false;
      const again = step.run.pending as Extract<NonNullable<RtRunState['pending']>, { kind: 'talisman' }>;
      assert(again.options[again.options.length - 1] === pair && !again.rerolled!.includes(pair!), `seed ${k}: the pair kept by the reroll: ${again.options}`);
      reload(step.run);
      rerolled++;
      return false;
    } };
    walk(start, k, policy, seen);
    const last = seen.screens.filter(s => CARRYING.includes(s.source) && s.options[s.options.length - 1] === FORMS.seal).length;
    assert(last <= 1, `seed ${k}: «Печать» in the last place ${last} times`);
    shown += last;
  }
  assert(shown >= 10 && rerolled >= 1, `«Печать» shown by the guarantee: ${shown}; rerolled: ${rerolled}`);
});

await check('the rest: both parts held — «Сплав» beside the heal; the fusion takes the rest, the parts leave the run and the pool; the next arena holds the fusion with its parts; a heal keeps the offer for the next rest', () => {
  const made = new Set<string>();
  let declined = 0, after = 0, again = 0;
  for (let k = 1; k <= 40 && (made.size < 3 || !declined); k++) {
    const fuse = k % 2 === 1;
    const seen: Seen = { screens: [], events: [], fused: [] };
    const end = walk(createRtRun(seedOf(k + 500), { gift: 'mini' }), k, { fuse, prefer: preferRestWhenReady(k % 2 ? 'hard' : 'shop') }, seen);
    for (const { run, fusion } of seen.fused) {
      const recipe = FUSION_RECIPES.find(r => r.fusion === fusion)!;
      const view = rtRestView(run)!;
      assert(view.heal.available && view.fusions.some(f => f.fusion === fusion && f.form === recipe.form && f.counter === recipe.counter && f.available), 'the rest offers the fusion beside the heal');
      const done = ok(rtRestFuse(run, fusion), 'fuse');
      assert(done.talismans.includes(fusion) && !done.talismans.includes(recipe.form) && !done.talismans.includes(recipe.counter), 'one item instead of two');
      assert(done.talismansGone.includes(recipe.form) && done.talismansGone.includes(recipe.counter) && done.pending === null && done.visited.includes(view.nodeId), 'the parts are gone; the rest completed');
      assert(done.hp === run.hp, 'no heal with the fusion');
      reload(done);
      made.add(fusion);
    }
    // The next arena after a fusion: its kit holds the fusion and its parts (a hammer part in the hammer slot).
    for (const fusion of FUSION_RECIPES.map(r => r.fusion).filter(f => end.talismans.includes(f))) {
      const r = FUSION_RECIPES.find(x => x.fusion === fusion)!, kit = kitOf(rtArenaLoadout(end));
      assert(kit.talismans.includes(fusion) && kit.talismans.includes(r.counter) && (r.form === HAMMERS.return ? kit.hammer === HAMMERS.return : kit.talismans.includes(r.form)), `${fusion}: the kit ${kit.talismans} ${kit.hammer}`);
      after++;
    }
    if (!fuse) {
      const refusals = seen.events.filter(e => e.type === 'fusion-declined');
      declined += refusals.length;
      // The offer stays: both parts are still held, the next rest offers the fusion again (a second refusal, if a rest came).
      if (refusals.length) assert(rtFusionsReady(end).length > 0, `seed ${k}: the pair kept after the heal`);
      if (refusals.length >= 2) again++;
    }
  }
  assert(made.size >= 2 && after >= 1, `fusions made: ${[...made]}, arenas after: ${after}`);
  assert(declined >= 1 && again >= 1, `rests closed by the heal with a pair ready: ${declined}; runs offered it again: ${again}`);
});

await check('the rest: the gift\'s «следующий привал не лечит» and «Клятва голода» keep the fusion; the fusion spends the price; a craft begun takes it away', () => {
  for (let k = 1; k <= 30; k++) {
    let at: RtRunState | null = null;
    walk(createRtRun(seedOf(k + 500), { gift: 'mini' }), k, { prefer: preferRestWhenReady(k % 2 ? 'hard' : 'shop'), stop: run => { if (run.pending?.kind === 'rest' && rtRestView(run)!.fusions.length) { at = run; return true; } return false; } });
    if (!at) continue;
    const run = at as RtRunState, fusion = rtRestView(run)!.fusions[0].fusion;
    const priced = { ...structuredClone(run), restNoHeal: true as const };
    assert(rtRestView(priced)!.heal.value === 0 && rtRestView(priced)!.fusions[0].available, 'the price: no heal, the fusion stays');
    assert(ok(rtRestFuse(priced, fusion), 'fuse').restNoHeal === undefined, 'the fusion spends the price');
    const hungry = { ...structuredClone(run), talismans: [...run.talismans, 'oath-hunger'] };
    assert(rtRestView(hungry)!.heal.value === 0 && rtRestView(hungry)!.fusions[0].available, '«Клятва голода»: the fusion stays');
    const crafting = { ...structuredClone(run), pending: { kind: 'rest' as const, nodeId: rtRestView(run)!.nodeId, crafted: ['frost' as const] } };
    assert(!rtRestView(crafting)!.fusions[0].available && !rtRestFuse(crafting, fusion).ok, 'after a craft — no fusion');
    return;
  }
  throw new Error('no rest with a pair on 30 seeds');
});

await check('a fusion is the form of its field: a later form of that field replaces it (the screens say so); the fusion makes no pair guarantee for its own field', () => {
  const base = createRtRun(seedOf(7), { gift: 'mini' });
  const held = { ...base, talismans: [FUSIONS.spear, HAMMERS.return] };
  assert(rtFormReplaces(held, FORMS.seal) === FUSIONS.spear && rtFormReplaces(held, HAMMERS.fire) === HAMMERS.return, 'the same field replaces');
  const withHalf = { ...base, talismans: [FUSIONS.spear, CT.frostEdge] };
  assert(rtFusionPair(withHalf, 'r6c1', 'hard', ['a', 'b', 'c']) === null, 'no «Печать» guarantee over «Копьё»');
  assert(rtFusionPair({ ...base, talismans: [CT.frostEdge] }, 'r6c1', 'hard', ['whetstone', 'dew-flask', 'hourglass']) === FORMS.seal, 'the guarantee without the fusion');
});

await check('the meta: a recipe with a locked part, or a form a first run never offers, has no recipe line and no guarantee; a recipe never unlocks', () => {
  const locked = createRtRun(seedOf(3), { gift: 'mini', locked: [CT.longArm] });
  assert(rtFusionRecipe(locked, FORMS.pierce) === null && rtFusionRecipe(locked, CT.longArm) === null, 'Копьё: «Длинная рука» locked');
  assert(rtFusionRecipe(locked, HAMMERS.return)?.fusion === FUSIONS.boomerang, 'Бумеранг open');
  assert(rtFusionPair({ ...locked, talismans: [FORMS.pierce] }, 'r6c1', 'hard', ['whetstone']) === null, 'no guarantee of a locked part');
  const first = createRtRun(seedOf(3), { gift: 'mini', schedule: [] });
  assert(!first.schedule!.seen.includes(PART_ARC) && rtFusionRecipe(first, CT.frostEdge) === null && rtFusionRecipe(first, CT.finisher) === null, 'a first run: no «Печать», no «Возврат»');
  assert(rtFusionRecipe(first, FORMS.pierce)?.fusion === FUSIONS.spear, 'a first run: «Копьё» from «Прямая»');
  const none = createRtRun(seedOf(3), { gift: 'mini', fusions: false });
  assert(rtFusionRecipe(none, FORMS.pierce) === null && rtFusionPair({ ...none, talismans: [FORMS.pierce] }, 'r6c1', 'hard', ['whetstone']) === null, 'no flag — nothing');
});

await check('saves: malformed flags and fusions without the flag read as no run; a run with fusions reads back', () => {
  const run = createRtRun(seedOf(5), { gift: 'mini' });
  reload(run);
  const bad = (value: unknown, what: string) => assert(parseRtRun(JSON.stringify(value)) === null, `${what} — no run`);
  bad({ ...run, fusions: 1 }, 'fusions: 1');
  bad({ ...run, forms: undefined }, 'fusions without forms');
  bad({ ...run, fusionShown: [FORMS.pierce] , fusions: undefined }, 'fusionShown without the flag');
  bad({ ...run, fusionShown: ['whetstone'] }, 'fusionShown of a non-half');
  const noFlag = { ...run, fusions: undefined };
  bad({ ...noFlag, talismans: [FUSIONS.iceSeal] }, 'a fusion without the flag');
  assert(parseRtRun(JSON.stringify({ ...noFlag, talismans: ['whetstone'] })), 'control: the run without the flag reads');
  assert(parseRtRun(JSON.stringify({ ...run, fusionShown: [FORMS.pierce] })), 'control: a spent guarantee reads');
  assert(rtTalisman(FUSIONS.spear)?.rarity === 'fusion' && rtTalisman(FUSIONS.boomerang)?.excludes?.length === 2, 'the catalogue');
});

await check('telemetry: the run record\'s `fusions` — the halves, the pairs, the fusion made; the report\'s section counts them', async () => {
  const fake = (): KeyValueStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
  };
  const sessionFake = (): SessionStore => { const map = new Map<string, string>(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }; };
  for (let k = 1; k <= 40; k++) {
    const local = fake();
    const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: copyParams(defaultParams() as unknown as Journal['params']), local, sessionStore: sessionFake(), channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
    const start = takeGift(createRtRun(seedOf(k + 500), { gift: 'mini' }));
    rec.runStarted(null, start);
    const seen: Seen = { screens: [], events: [], fused: [] };
    walk(start, k, { fuse: true, prefer: preferRestWhenReady(k % 2 ? 'hard' : 'shop'), feed: (before, step) => rec.runStep(before, step) }, seen);
    if (!seen.fused.length) continue;
    await new Promise(r => setTimeout(r, 10));
    const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run').pop()!;
    const f = record.fusions!;
    assert(f && f.halves.length >= 2 && f.paired.length >= 1 && f.made.length === seen.fused.length && f.made[0].fusion === seen.fused[0].fusion && f.made[0].row >= 1, `the record: ${JSON.stringify(f)}`);
    assert(checkRecord(record) === null && checkRecord({ ...record, fusions: { ...f, made: [{ row: 'x' }] } }) === 'run fusions', 'checkRecord takes the field and refuses a malformed one');
    const text = fusionsSection([record]);
    assert(/Пара собрана: 1 из 1/.test(text) && /Сплав сделан: 1 из 1/.test(text), text);
    return;
  }
  throw new Error('no fusion made on 40 seeds');
});

console.log(`\n${checks} checks passed`);
