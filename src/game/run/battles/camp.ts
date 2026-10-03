import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Camp branch (goblins, rows 10–12): new battles for the branch pools of the generated map (docs/roguelike-runs.md, section 4).
 * Cards, routes and metrics: docs/levels/forest-branch-camp.md. Format and checks: docs/biomes/forest-map.md,
 * «Как добавить бой узла». Ids are unique across battles/*.ts.
 */
export const CAMP_BATTLES: NodeBattle[] = [];
void authoredLesson;
