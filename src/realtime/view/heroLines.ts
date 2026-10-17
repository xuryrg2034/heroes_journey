/**
 * Task 49: the lines of Ведунья (docs/design-notes/npc-lines-v2.md, «Ведунья (задача 49)»). She is a hero, not a camp NPC: no
 * upgrades, no quest, no leaving. She says one line at a time, at her place by the fire and in the cage scene. The profile counts
 * a key's lines by `toad:<key>` (`markLine`), the same memory as the NPC lines; a key's lines are said in turn.
 */
import type { LineMemory } from './npcLines';

export type ToadKey = 'cage_1' | 'cage_2' | 'first_camp' | 'pick' | 'about_cat';

export const TOAD_LINES: Readonly<Record<ToadKey, readonly string[]>> = {
  cage_1: ['Громче бей. Я спать не могу, когда бьют вполсилы.'],
  cage_2: ['Наконец-то. Я не бегаю, я черчу круг — посмотришь.'],
  first_camp: ['Ты разбил его замок. Не жди благодарности.'],
  pick: [
    'Разумеется, я. Кольцо замкну с первого боя — без спешки.',
    'Пойду я. Без кольца не прикроюсь — значит, кольцо будет.',
    'Кот пусть поспит. Сегодня кольца черчу я — без суеты.',
  ],
  about_cat: [
    'Кот рубит, я черчу. Разница — как между криком и заклинанием.',
    'Кот сломал мой замок. Прутья я бы и сама прожгла — лень было.',
  ],
};

/** The memory key (`markLine`) of a Ведунья key. */
export const toadLineId = (key: ToadKey): string => `toad:${key}`;

/** The line of `key` now: the memory's count picks it in turn. */
export function toadLine(key: ToadKey, memory: LineMemory): { id: string; text: string } {
  const list = TOAD_LINES[key], n = memory[toadLineId(key)] ?? 0;
  return { id: toadLineId(key), text: list[n % list.length] };
}
