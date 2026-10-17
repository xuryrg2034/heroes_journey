/**
 * Task 49 «Второй герой», the view's meta part (view/metaSource.ts, view/heroLines.ts, view/runView.ts): the camp's source follows the
 * chosen hero (the bar, the next pack and the record are the hero's; only a freed hero is chosen), the cards' law lines (two lines of
 * at most 6 words), Ведунья's lines in turn from the profile's memory, and the recipe line of «Иней» in her run («Сплав: с «Печать» →
 * «Ледяная печать»», the pair held by the innate half). Node only: `npm run test:realtime-hero-view`. The screens at 1280×720 by real
 * clicks are tests/realtime-toad-meta.spec.ts.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { createRtRun, rtRunParams } from '../run/rtRun';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RunStorage } from '../run/rtRunStorage';
import { rtHeroPacks, RT_TOAD_ID } from '../run/metaCatalog';
import { heroCardLines, recipeHtml } from './runView';
import { defaultParams } from '../sim/params';
import { TOAD_LINES, toadLine } from './heroLines';
import { ProfileMeta } from './metaSource';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
function memoryStorage(initial: object): RunStorage {
  const data = new Map<string, string>([[RT_PROFILE_STORAGE_KEY, JSON.stringify(initial)]]);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const HEARTH = { stock: 3, levels: { owl: 0, herb: 0, smith: 0 }, met: {}, lines: {}, quiet: 0 };
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

check('the camp source: the cat alone before the rescue; the chosen hero\'s bar, next pack and record after it; only a freed hero is chosen', () => {
  const alone = new ProfileMeta(createRtProfileStore(memoryStorage({ version: 1, giftFull: false, runs: 3, meta: { heroes: { cat: { xp: 70, packs: ['hunter'], record: { row: 6, won: false, xp: 40 } } }, hearth: HEARTH } })));
  assert(alone.heroes().length === 2 && alone.heroes().filter(h => h.open).map(h => h.id).join() === 'cat', 'only the cat is open');
  assert(alone.chooseHero('toad') === false && alone.hearth().hero === 'cat', 'not freed: not chosen');
  assert(alone.hearth().xp === 70 && alone.hearth().record?.row === 6, 'the cat\'s experience and record');

  const both = new ProfileMeta(createRtProfileStore(memoryStorage({ version: 1, giftFull: false, runs: 3, meta: { heroes: { cat: { xp: 70, packs: ['hunter'], record: { row: 6, won: false, xp: 40 } }, toad: { xp: 10, packs: [] } }, hearth: HEARTH, freed: { toad: { row: 5, run: 1 } } } })));
  assert(both.heroes().filter(h => h.open).length === 2 && both.heroes()[0].chosen, 'both open, the cat chosen at first');
  assert(both.chooseHero('toad') && both.hearth().hero === 'toad', 'her choice sticks');
  const h = both.hearth();
  assert(h.xp === 10 && h.record === null, 'her experience, no record yet');
  assert(h.nextPack?.id === rtHeroPacks(RT_TOAD_ID)[0].id && h.nextPack.title === 'Иней', `her first pack is «Иней» (${h.nextPack?.title})`);
  assert(both.chooseHero('cat') && both.hearth().nextPack?.id === 'return', `the cat's next pack after «Охотник» (${both.hearth().nextPack?.id})`);
});

check('the hero cards: two lines of at most 6 words each; the cat number is the run chainShieldMinKills in words; the toad law and price are the spec', () => {
  const need = rtRunParams(defaultParams()).chainShieldMinKills;
  for (const id of ['cat', 'toad'] as const) {
    const lines = heroCardLines(id);
    assert(lines.length === 2, `${id}: two lines`);
    for (const line of lines) assert(line.split(/\s+/).length <= 6, `${id}: «${line}» at most 6 words`);
  }
  assert(need === 3 && heroCardLines('cat').join(' / ') === 'Формы находит в походе / Щит — после трёх убийств', `the cat card (the run number ${need})`);
  assert(heroCardLines('cat', 2)[1] === 'Щит — после двух убийств' && heroCardLines('cat', 4)[1] === 'Щит — после четырёх убийств', 'the number follows the parameter');
  assert(heroCardLines('toad').join(' / ') === 'Кольцо с первого боя / Щит — только после кольца', 'her law and price');
});

check('her lines come in turn by the profile\'s memory (`toad:<key>`); the cage line is the spec\'s example', () => {
  assert(toadLine('pick', {}).text === TOAD_LINES.pick[0] && toadLine('pick', { 'toad:pick': 1 }).text === TOAD_LINES.pick[1], 'pick lines in turn');
  assert(toadLine('pick', { 'toad:pick': 3 }).text === TOAD_LINES.pick[0], 'and round again');
  assert(toadLine('first_camp', {}).id === 'toad:first_camp', 'the memory key');
  assert(TOAD_LINES.cage_2[0].includes('черчу круг'), 'the cage line names her law');
});

check('«Иней на клинке» in her run: «Сплав: с «Печать» → «Ледяная печать» · пара есть» (the innate half is held); the cat\'s card has no «пара есть»', () => {
  const toad = createRtRun(seedOf(2), { gift: 'full', hero: RT_TOAD_ID, seeded: true }), cat = createRtRun(seedOf(2), { gift: 'full' });
  const line = recipeHtml(toad, 'frost-edge').replace(/<[^>]+>/g, '');
  assert(line === 'Сплав: с «Печать» → «Ледяная печать» · пара есть', `her card says: ${line}`);
  assert(!recipeHtml(cat, 'frost-edge').includes('пара есть'), 'the cat does not hold the pair at the start');
});
