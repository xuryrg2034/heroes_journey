/**
 * Task 56 «Приметы», the view (task 56в; view/omenMark.ts, view/worldLabels.ts; spec docs/design-notes/task-56-omens.md, 6): the signs and
 * the lines the view builds from the run's catalogue, and the world labels read from real fights. Node only: `npm run test:realtime-omens-view`.
 *
 * - the eleven icons: one each, distinct, no emoji and no ⚡ (the energy's sign), the start flash's SVG document;
 * - the card: the node's omen is a line with its name, plus and price from the catalogue; the level's — an icon, the rule on the hover;
 * - the header's sign and the map's badge: the level's omen of the run, the rule on the hover; a run without omens — none;
 * - the end screen: «Приметы: +N» by the pool before and after, the whole pool when the gates open with the run, nothing before the gates;
 *   the pack's omen card (core `rtPackOmen`);
 * - the world labels (≤ 4 words) from real fights: «Заведи толпу» at the storm's mark and its end with the strike that kills; «Мокрым +1» at a pool
 *   and its end with the first wet link; «Спят до цепи» at a sleeper and its end with the wake; «Цвет зовут» at an enemy of the called colour and
 *   its end with the first called link; «Удар — всё сначала» at the sack.
 * The Playwright file of the same feature is tests/realtime-omens.spec.ts (real mouse, the page). Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import './nodeNavigator.testkit';
import { registerArena } from '../sim/arenas';
import { defaultParams, type Params } from '../sim/params';
import { Simulation } from '../sim/simulation';
import type { WorldEvent } from '../sim/world';
import { createRtRun, rtLevelOmen } from '../run/rtRun';
import { rtOmen, RT_OMENS, RT_OMEN_IDS, rtPackOmen, rtOmenPool, RT_OMEN_PACKS, RT_OMENS_START } from '../run/omens';
import { harvestLabel, labelActions, omenLabels, OMEN_LABEL_TEXT } from './worldLabels';
import { omenBadge, omenCardHtml, omenIconSvg, omenSign, omenSvgDoc, omensEnd } from './omenMark';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

check('icons: one for each of the catalogue\'s omens, distinct, with the id, no emoji and no ⚡', () => {
  const seen = new Set<string>();
  for (const def of RT_OMENS) {
    const svg = omenIconSvg(def.id, 24);
    assert(svg.startsWith('<svg') && svg.includes(`data-omen="${def.id}"`) && svg.endsWith('</svg>'), `${def.id}: an svg with its id`);
    assert(!/[☀-➿\u{1f300}-\u{1faff}]/u.test(svg), `${def.id}: no emoji or symbol`);
    seen.add(svg.replace(/data-omen="[a-z]+"/, ''));
    assert(omenSvgDoc(def.id).includes('xmlns="http://www.w3.org/2000/svg"'), `${def.id}: the flash's document`);
  }
  assert(seen.size === RT_OMEN_IDS.length, 'every icon differs from the others');
});

check('the card: the node\'s omen is a line with the name, the plus and the price of the catalogue; the level\'s — an icon with the rule on the hover (a second line only when there is no node\'s)', () => {
  const storm = rtOmen('storm')!, drowse = rtOmen('drowse')!;
  const both = omenCardHtml({ node: 'storm', level: 'drowse' });
  assert(both.includes('data-testid="run-danger-omen"') && both.includes(`«${storm.title}»`) && both.includes(storm.plus) && both.includes(storm.cost), 'the node\'s line says the rule');
  assert(both.includes('data-testid="run-danger-omen-level"') && both.includes(`title="Примета уровня: «${drowse.title}»`) && !both.includes('<b>Примета уровня:</b>'), 'the level\'s icon has the rule on the hover and no text of its own beside the node\'s line');
  const level = omenCardHtml({ level: 'drowse' });
  assert(level.includes('<b>Примета уровня:</b>') && level.includes(`«${drowse.title}»`) && level.replace(/title="[^"]*"/, '').indexOf(drowse.plus) < 0 && level.includes(drowse.plus), 'the level alone: its name in text, the rule only on the hover');
  assert(omenCardHtml({}) === '' && omenCardHtml(undefined) === '', 'no omen — no row');
  assert(omenCardHtml({ node: 'storm' }).includes('«Гроза»'), 'the name is the player\'s');
});

check('the header\'s sign and the map\'s badge: the level\'s omen of the run, the rule on the hover; a run without omens has none', () => {
  const run = createRtRun(seedOf(3), { gift: 'mini', garrison: false, omens: ['drowse'] });
  assert(rtLevelOmen(run) === 'drowse', 'the level\'s omen');
  const sign = omenSign(run), def = rtOmen('drowse')!;
  assert(sign.includes('data-testid="run-omen"') && sign.includes('data-omen="drowse"') && sign.includes(def.plus) && sign.includes(def.cost), 'the sign says the rule on the hover');
  assert(omenSign(createRtRun(seedOf(3), { gift: 'mini', garrison: false })) === '', 'no omens — no sign');
  const badge = omenBadge('flood');
  assert(badge.includes('data-testid="map-omen"') && badge.includes('data-omen="flood"') && badge.includes(rtOmen('flood')!.title), 'the badge names the omen');
});

check('the end: «Приметы: +N» by the pool before and after for a run played with omens; the whole pool when the gates open with this run; nothing before them; the pack\'s card', () => {
  const start = [...RT_OMENS_START], withStorm = rtOmenPool({ packs: ['hunter'], garrison: false, gambler: false });
  const played = omensEnd({ playedWith: true, gateOpen: true, before: start, after: withStorm, packId: 'hunter' });
  assert(played.gained === 1 && played.card?.id === 'storm' && played.card.kind === 'omen', 'a pack of the run: +1 and its omen\'s card');
  assert(omensEnd({ playedWith: true, gateOpen: true, before: withStorm, after: withStorm }).gained === 0, 'nothing new — no line');
  const opens = omensEnd({ playedWith: false, gateOpen: true, before: start, after: start });
  assert(opens.gained === start.length, `the gates open with this run: the whole pool (${opens.gained})`);
  const closed = omensEnd({ playedWith: false, gateOpen: false, before: start, after: withStorm, packId: 'hunter' });
  assert(closed.gained === 0 && !closed.card, 'before the gates — no line, no card');
  for (const [pack, omen] of Object.entries(RT_OMEN_PACKS)) assert(omensEnd({ playedWith: true, gateOpen: true, before: [], after: [], packId: pack }).card?.id === omen && rtPackOmen(pack)?.id === omen, `pack ${pack}`);
  assert(!omensEnd({ playedWith: true, gateOpen: true, before: [], after: [], packId: 'no-such-pack' }).card, 'a pack with no omen — no card');
});

// ---- The world labels, from real fights ----

registerArena({
  id: 'omen-view', name: 'Поле примет', summary: 'Тест вида примет', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 50,
});
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false; p.enemySpeed = 0;
  p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false; p.finisher = false;
  return Object.assign(p, extra);
}
function fight(params: Params, k = 1): Simulation {
  const sim = new Simulation({ arena: 'omen-view', params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, color = 0, hp = 0): number => sim.command({ t: 'place', x, y, color, hp, kind: 'basic' }) as number;
/** Ticks until `stop` holds on the frame (its events not yet cleared) or `limit` seconds pass; the frame's actions are read before the events go. */
function until(sim: Simulation, stop: () => boolean, limit: number): boolean {
  const end = sim.world.time + limit;
  while (sim.world.time < end) { sim.tick(); if (stop()) return true; sim.world.events.length = 0; }
  return false;
}
const words = (text: string): number => text.split(/\s+/).filter(t => t !== '—').length;

check('the labels are ≤ 4 words, one text each', () => {
  for (const [id, text] of Object.entries(OMEN_LABEL_TEXT)) assert(words(text) <= 4, `${id}: ${text}`);
  assert(OMEN_LABEL_TEXT['omen-storm'] === 'Заведи толпу' && OMEN_LABEL_TEXT['omen-flood'] === 'Мокрым +1' && OMEN_LABEL_TEXT['omen-drowse'] === 'Спят до цепи' && OMEN_LABEL_TEXT['omen-rollcall'] === 'Цвет зовут' && OMEN_LABEL_TEXT['omen-harvest'] === 'Удар — всё сначала', 'the spec\'s words');
});

check('«Гроза»: «Заведи толпу» hangs at the mark; the strike that kills is its action', () => {
  for (let k = 1; k <= 3; k++) {
    const sim = fight(quiet({ omenStorm: true }), k), w = sim.world;
    for (const [x, y] of [[10, 6], [10.7, 6], [10.35, 6.6]]) place(sim, x, y);
    assert(!omenLabels(w, () => true).some(l => l.id === 'omen-storm'), `seed ${k}: no label before the mark`);
    assert(until(sim, () => !!w.storm?.mark, 10), `seed ${k}: the mark stands`);
    const label = omenLabels(w, () => true).find(l => l.id === 'omen-storm');
    assert(label && label.text === 'Заведи толпу' && Math.hypot(label.at.x - w.storm!.mark!.x, label.at.y - w.storm!.mark!.y) < 1e-9, `seed ${k}: the label at the mark`);
    assert(!omenLabels(w, () => false).length, `seed ${k}: nothing off screen`);
    assert(until(sim, () => labelActions(w).includes('omen-storm'), 3), `seed ${k}: the strike that kills marks the label done`);
    assert(w.events.some((e: WorldEvent) => e.type === 'omen' && e.omen === 'storm' && e.action === 'strike'), `seed ${k}: the strike`);
  }
});

check('«Половодье»: «Мокрым +1» at the nearest pool; the first wet link is its action (a dry link is not)', () => {
  const sim = fight(quiet({ omenFlood: true }), 2), w = sim.world;
  const pools = w.flood!.pools;
  assert(pools.length === 3, 'three pools');
  const labels = omenLabels(w, () => true).filter(l => l.id === 'omen-flood');
  assert(labels.length === 1 && labels[0].text === 'Мокрым +1', 'one label');
  const near = pools.reduce((a, b) => (Math.hypot(a.x - w.hero.x, a.y - w.hero.y) <= Math.hypot(b.x - w.hero.x, b.y - w.hero.y) ? a : b));
  assert(labels[0].at.x === near.x && labels[0].at.y === near.y, 'at the nearest pool');
  const dryAt = { x: 15, y: 1 };
  if (!pools.some(p => Math.hypot(p.x - dryAt.x, p.y - dryAt.y) <= p.r)) {
    place(sim, dryAt.x, dryAt.y); sim.command({ t: 'teleport', x: dryAt.x - 1.5, y: dryAt.y }); sim.command({ t: 'begin', x: dryAt.x, y: dryAt.y });
    assert(w.chain.length === 1 && !labelActions(w).includes('omen-flood'), 'a dry link does not end the label');
    sim.command({ t: 'cancel' } as never);
  }
  const p = pools[0];
  place(sim, p.x, p.y); sim.command({ t: 'teleport', x: p.x + (p.x > 15 ? -1.5 : 1.5), y: p.y });
  sim.command({ t: 'begin', x: p.x, y: p.y });
  assert(w.chain.length === 1 && w.chain[0].kind === 'enemy' && w.chain[0].wet === true && labelActions(w).includes('omen-flood'), 'the wet link ends the label');
});

check('«Сонный час»: «Спят до цепи» over the nearest sleeper; the wake is its action', () => {
  const sim = fight(quiet({ omenDrowse: true }), 1), w = sim.world;
  place(sim, 12, 6); place(sim, 20, 6);
  sim.tick();
  const label = omenLabels(w, () => true).find(l => l.id === 'omen-drowse');
  assert(label && label.text === 'Спят до цепи' && label.at.x === 12, 'the label over the nearest sleeper');
  sim.world.events.length = 0;
  sim.command({ t: 'teleport', x: 10.5, y: 6 }); sim.command({ t: 'begin', x: 12, y: 6 }); sim.command({ t: 'release' });
  assert(until(sim, () => labelActions(w).includes('omen-drowse'), 2), 'the first pass wakes them: the action');
  assert(!omenLabels(w, () => true).some(l => l.id === 'omen-drowse'), 'no sleeper — no label');
});

check('«Перекличка»: «Цвет зовут» over an enemy of the called colour; a called link is its action', () => {
  const sim = fight(quiet({ omenRollcall: true }), 3), w = sim.world;
  place(sim, 12, 4, 0); place(sim, 12, 6, 1); place(sim, 12, 8, 2);
  assert(until(sim, () => w.rollcall?.color !== undefined, 5), 'a colour is called');
  const color = w.rollcall!.color!, label = omenLabels(w, () => true).find(l => l.id === 'omen-rollcall');
  assert(label && label.text === 'Цвет зовут', 'the label');
  const called = w.enemies.find(e => e.color === color)!;
  assert(label.at.x === called.x && label.at.y === called.y, 'over the called colour');
  sim.world.events.length = 0;
  sim.command({ t: 'teleport', x: called.x - 1.5, y: called.y }); sim.command({ t: 'begin', x: called.x, y: called.y });
  assert(w.chain[0]?.kind === 'enemy' && w.chain[0].call === true && labelActions(w).includes('omen-rollcall'), 'the called link ends the label');
});

check('«Урожай»: «Удар — всё сначала» at the sack, only with the omen\'s key and a sack in view', () => {
  const sack = { visible: true, x: 5, y: 6 }, w = fight(quiet({ bagResetAll: true })).world, off = fight(quiet()).world;
  const spec = harvestLabel(w, sack, () => true);
  assert(spec && spec.id === 'omen-harvest' && spec.text === 'Удар — всё сначала' && spec.at.x === 5, 'the label at the sack');
  assert(!harvestLabel(w, { ...sack, visible: false }, () => true) && !harvestLabel(w, sack, () => false), 'no sack in view — none');
  assert(!harvestLabel(off, sack, () => true), 'no omen — none');
});

console.log(`${checks} checks passed`);
