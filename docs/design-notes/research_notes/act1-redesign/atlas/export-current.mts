// Read-only export of the current authored layouts. No simulation is run.
import { writeFileSync } from 'node:fs';
import { arenaTemplate, markedGoalArena } from '../../../../../src/realtime/sim/arenas';
import '../../../../../src/realtime/sim/arenasStage3';
import '../../../../../src/realtime/sim/arenasBoss';

const ids = ['glade', 'p-yard', 'p-gorge', 'p-braziers', 'p-cliff', 'shields', 'buttons', 'p-archer-yard', 'powder', 'archers', 'p-river', 'lynx-den', 'p-thicket', 'thorns', 'shaman-circle', 'marked', 'ford', 'outpost', 'last-stand', 'jailer', 'jailer-yard', 'troll'];
const arenas = ids.map(id => {
  const t = markedGoalArena(arenaTemplate(id), true);
  return { id, name: t.name, width: t.width, height: t.height, heroStart: t.heroStart, door: t.door, obstacles: t.obstacles,
    terrain: t.terrain ?? [], enemies: t.enemies, buttons: t.buttons, braziers: t.braziers ?? [], gates: t.gates ?? [],
    chest: t.chest ?? null, goal: t.goal, killGoal: t.killGoal ?? null };
});
writeFileSync(new URL('./current-arena-data.json', import.meta.url), JSON.stringify({ date: '2026-10-18', context: 'Authored templates with markedGoals=true; no roster, kit, dynamic spawning or simulation.', arenas }, null, 2) + '\n');
console.log(`Exported ${arenas.length} current arena templates`);
