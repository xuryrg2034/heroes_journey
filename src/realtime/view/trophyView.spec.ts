/**
 * Task 51е «Трофеи на стене лагеря», the view (view/trophyView.ts): the perch is drawn from the profile's list and from nothing else — ten
 * hooks, the trophies in the order they came, an empty hook is a bare peg (no name, no picture), the pointer shows the name and «Поход N»
 * (the retro, run 0, has no number), «Доска Испытания» its steps; the names are the spec's. The trophies themselves are earned by real
 * runs in core's `run/trophies.spec.ts`; here the profile is walked by the run's own commands and the perch is drawn from the store.
 * Node only: `npm run test:realtime-trophy-view`. The end-to-end view is tests/realtime-trophies.spec.ts.
 */
import './nodeNavigator.testkit';
import { perchHtml, TROPHY_NAMES, trophyKey, trophyTip } from './trophyView';
import { RT_TROPHY_IDS, type RtTrophy } from '../run/trophies';
import { NPC_LINES } from './npcLines';
// @ts-expect-error node:fs has no declarations here
import { existsSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const art = (path: string): string => `art/${path}`;
const perch = (list: RtTrophy[], dropping: string[] = []): string => perchHtml(list, new Set(dropping), art);
const hooks = (html: string): string[] => html.split('<span class="rt-hearth-hook').slice(1);

check('ten hooks; a bare peg has no picture and no text; the trophies hang in the order they came', () => {
  const html = perch([{ id: 'troll', run: 4 }, { id: 'jailer', run: 2 }]);
  const list = hooks(html);
  assert(list.length === 10, `ten hooks (${list.length})`);
  assert(list[0]!.includes('data-trophy="troll"') && list[1]!.includes('data-trophy="jailer"'), 'the order of the profile, not of the catalogue');
  for (const bare of list.slice(2)) assert(!bare.includes('<img') && !bare.includes('data-trophy') && !/[А-Яа-я]/.test(bare), `a bare peg: ${bare}`);
  assert(hooks(perch([])).every(h => !h.includes('<img')), 'an empty perch is ten bare pegs');
});

check('the names are the spec\'s; every trophy has its picture file', () => {
  assert(RT_TROPHY_IDS.length === 9 && RT_TROPHY_IDS.every(id => !!TROPHY_NAMES[id]), 'a name for each of the nine');
  assert(TROPHY_NAMES.jailer === 'Гиря Тюремщика' && TROPHY_NAMES.ash === 'Доска Испытания' && TROPHY_NAMES.bestiary === 'Чернильница Неясыти' && TROPHY_NAMES['long-chain'] === 'Длинная цепь', 'names of the table');
  const html = perch(RT_TROPHY_IDS.map((id, i) => ({ id, run: i + 1, ...id === 'ash' ? { marks: [1] } : {} })));
  for (const id of RT_TROPHY_IDS) {
    const file = `camp/trophy-${id === 'long-chain' ? 'chain' : id}.png`;
    assert(html.includes(file) && existsSync(`public/art/${file}`), `the picture of ${id}`);
  }
});

check('the pointer: the name and «Поход N»; the retro (run 0) has the name only; «Доска Испытания» shows its steps', () => {
  assert(trophyTip({ id: 'castellan', run: 14 }).run === 'Поход 14' && trophyTip({ id: 'castellan', run: 14 }).name === 'Знамя Кастеляна', 'run 14');
  assert(trophyTip({ id: 'castellan', run: 0 }).run === '', 'the retro has no number');
  assert(trophyTip({ id: 'ash', run: 3, marks: [1, 2, 5] }).marks === 'Испытание: I II V', 'the steps');
  const html = perch([{ id: 'castellan', run: 0 }]);
  assert(!html.includes('Поход') && html.includes('Знамя Кастеляна'), 'the strip of the retro');
});

check('the drop: only the trophies that fall carry the animation class; the memory key of a mark is its own', () => {
  const html = perch([{ id: 'jailer', run: 1 }, { id: 'ash', run: 2, marks: [1, 2] }], ['ash']);
  const [first, second] = hooks(html);
  assert(!first!.includes('rt-drop') && second!.includes('rt-drop'), 'only «Доска» falls');
  assert(trophyKey({ id: 'ash', mark: 2 }) === 'ash:2' && trophyKey({ id: 'jailer' }) === 'jailer', 'keys');
});

check('the owl\'s `trophy` lines are the two of npc-lines-v2', () => {
  const lines = NPC_LINES.owl.trophy ?? [];
  assert(lines.length === 2 && lines[0]!.startsWith('Повесила твой трофей') && lines[1]!.startsWith('Опять трофей'), lines.join('|'));
});

console.log('trophy view: all checks passed');
