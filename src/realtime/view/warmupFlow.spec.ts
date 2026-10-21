/**
 * The warmup's view logic (view/warmupFlow.ts), Node only: `npm run test:realtime-warmup-view`. The texts of the choice screen, the label at
 * the hero on real worlds of the three layouts, the result texts, the speaker of `warmup_record` and its lines. The end-to-end result is
 * tests/realtime-warmup.spec.ts (real clicks). The rules are core's (`npm run test:realtime-warmup`).
 */
import './nodeNavigator.testkit';
import { Simulation } from '../sim/simulation';
import { WARMUP_LAYOUTS, WARMUP_SEED, warmupLoadout, warmupMerge, warmupParams, type WarmupId } from '../run/warmup';
import { NPC_LINES, npcLine } from './npcLines';
import { WARMUP_GOALS, plural, scoreText, secondsLeft, warmupLabel, warmupLabelText, warmupResultText, warmupRows, warmupSpeaker } from './warmupFlow';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const attempt = (id: WarmupId): Simulation => new Simulation({ arena: id, params: warmupParams(id), seed: WARMUP_SEED, loadout: warmupLoadout() });

check('plural: звено / звена / звеньев and убийство / убийства / убийств by the Russian rule (11–14 are «many»)', () => {
  const forms = [1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(n => plural(n, 'а', 'б', 'в')).join('');
  assert(forms === 'аббввввабвав', `forms ${forms}`);
});

check('scoreText: the unit of each layout, a decimal comma for the time', () => {
  assert(scoreText('warmup-line', 7) === '7 звеньев' && scoreText('warmup-line', 1) === '1 звено' && scoreText('warmup-line', 3) === '3 звена', 'chain');
  assert(scoreText('warmup-mix', 12.3) === '12,3 с' && scoreText('warmup-mix', 9) === '9,0 с', 'time');
  assert(scoreText('warmup-gap', 14) === '14 убийств' && scoreText('warmup-gap', 1) === '1 убийство' && scoreText('warmup-gap', 22) === '22 убийства', 'kills');
});

check('the choice rows: one per layout in the core\'s order, the title, what it asks, the record or «—»', () => {
  const none = warmupRows(undefined);
  assert(none.map(r => r.id).join() === WARMUP_LAYOUTS.map(l => l.id).join(), 'order');
  assert(none.every(r => r.record === '—' && r.best === null && r.goal === WARMUP_GOALS[r.id] && r.title.length > 0), 'no records yet');
  const some = warmupRows({ 'warmup-line': { best: 7 }, 'warmup-mix': { best: 12.3 } });
  assert(some[0].record === '7 звеньев' && some[1].record === '12,3 с' && some[2].record === '—', 'records');
});

check('the label at the hero on the three layouts: the timer and the number of the record, from the real world', () => {
  const line = attempt('warmup-line'), mix = attempt('warmup-mix'), gap = attempt('warmup-gap');
  assert(warmupLabelText('warmup-line', line.world) === '20 с · цепь 0', `line ${warmupLabelText('warmup-line', line.world)}`);
  assert(warmupLabelText('warmup-mix', mix.world) === '0,0 с', `mix ${warmupLabelText('warmup-mix', mix.world)}`);
  assert(warmupLabelText('warmup-gap', gap.world) === '30 с · убито 0', `gap ${warmupLabelText('warmup-gap', gap.world)}`);
  for (let i = 0; i < 600; i++) { line.tick(); mix.tick(); gap.tick(); }
  assert(secondsLeft(line.world, 'warmup-line') === 10 && secondsLeft(gap.world, 'warmup-gap') === 20, 'half the limit left');
  assert(warmupLabelText('warmup-line', line.world) === '10 с · цепь 0', 'timer runs');
  assert(warmupLabelText('warmup-mix', mix.world) === `${mix.world.time.toFixed(1).replace('.', ',')} с`, 'mix shows the game time');
  const spec = warmupLabel('warmup-line', line.world);
  assert(spec.id === 'warmup' && spec.place === 'side' && spec.at.x === line.world.hero.x && spec.at.y === line.world.hero.y, 'at the hero');
});

check('the timer never goes below 0 s', () => {
  const sim = attempt('warmup-line');
  for (let i = 0; i < 1300; i++) sim.tick();
  assert(secondsLeft(sim.world, 'warmup-line') === 0, 'no negative timer');
});

check('the result texts: a score with a new record, a score under the record, a death, an uncleared field', () => {
  const m0 = warmupMerge(undefined, 'warmup-line', 6);
  const first = warmupResultText('warmup-line', 'limit', 6, m0);
  assert(first.line === '6 звеньев' && first.record === 'Новый рекорд!' && first.isRecord && first.title === 'Строй', 'first');
  const m1 = warmupMerge(m0.records, 'warmup-line', 4);
  const worse = warmupResultText('warmup-line', 'limit', 4, m1);
  assert(worse.line === '4 звена' && worse.record === 'Рекорд: 6 звеньев' && !worse.isRecord, 'worse');
  const death = warmupResultText('warmup-gap', 'death', null, warmupMerge(undefined, 'warmup-gap', null));
  assert(death.line === 'Погиб — без итога' && death.record === '' && !death.isRecord, 'death');
  const open = warmupResultText('warmup-mix', 'limit', null, warmupMerge({ 'warmup-mix': { best: 20.5 } }, 'warmup-mix', null));
  assert(open.line === 'Поле не очищено — без итога' && open.record === 'Рекорд: 20,5 с', 'uncleared');
  const faster = warmupResultText('warmup-mix', 'clear', 12.3, warmupMerge({ 'warmup-mix': { best: 20.5 } }, 'warmup-mix', 12.3));
  assert(faster.line === '12,3 с' && faster.isRecord, 'faster is a record');
});

check('the speaker of `warmup_record`: Ерофей at the fire, else Неясыть; both have lines; the lines go in turn', () => {
  assert(warmupSpeaker(true) === 'smith' && warmupSpeaker(false) === 'owl', 'speaker');
  assert((NPC_LINES.smith.warmup_record?.length ?? 0) === 2 && (NPC_LINES.owl.warmup_record?.length ?? 0) === 1, 'counts of npc-lines-v2.md');
  const a = npcLine('smith', 'warmup_record', undefined, {}), b = npcLine('smith', 'warmup_record', undefined, { 'smith:warmup_record': 1 });
  assert(a && b && a.text !== b.text && a.id === 'smith:warmup_record', 'turn');
  assert(!!npcLine('owl', 'warmup_record', undefined, {}), 'owl');
});
