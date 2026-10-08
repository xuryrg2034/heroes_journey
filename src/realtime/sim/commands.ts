/**
 * Player and debug commands of the real-time simulation (stage 1 of the transition, docs/realtime-prototype.md,
 * «Ядро реального времени»). Everything outside the simulation that changes the world is a command: the view turns
 * keys, the mouse and the debug panel into commands, and the simulation journals each one with the tick it comes
 * before (simulation.ts). A replay applies the same commands before the same ticks and gets the same world.
 *
 * Commands are plain JSON (a journal is a JSON file). The simulation reads nothing else — no DOM, no clock.
 */
import { beginChain, cancelChain, dragChain, dragChainAlong, jump, releaseChain, type DragMode } from './chain';
import { setParam, setPhases, type ParamKey, type Phase } from './params';
import { spawnBurst, spawnEnemy } from './spawn';
import { completeGoals, type EnemyKind, type World } from './world';

export type Command =
  /** Walking input (WASD / arrows): components in −1…1; journalled when it changes. */
  | { t: 'walk'; x: number; y: number }
  /** Left button pressed on the arena: start a chain at the point. */
  | { t: 'begin'; x: number; y: number }
  /** The pointer at a point while the button is held: `full` — the pointer event, `append` — the held still pointer. */
  | { t: 'drag'; x: number; y: number; mode: DragMode }
  /** A pointer move from (fx, fy) to (x, y) with the button held: links along the whole path (prototype stage G). */
  | { t: 'sweep'; fx: number; fy: number; x: number; y: number }
  /** Left button released: the hero dashes along the chain. */
  | { t: 'release' }
  /** Right button, Esc, the menu: the drawn chain is dropped. */
  | { t: 'cancel' }
  /** A jump towards the point (the jump mode of the view is not simulation state). */
  | { t: 'jump'; x: number; y: number }
  /** A debug-panel value (the view saves it to storage itself). */
  | { t: 'param'; key: ParamKey; value: unknown }
  /** The debug-panel phase table. */
  | { t: 'phases'; phases: Phase[] }
  /** Debug: the goals are done (the greed stage starts). */
  | { t: 'goals' }
  /** Debug: up to `count` enemies at once on free edge points. */
  | { t: 'burst'; count: number }
  /** Test setup: remove every enemy (keep the marked ones with `keepMarked`), marker, queued newcomer and the chain. */
  | { t: 'clear'; keepMarked: boolean }
  /** Test setup: an enemy of `kind` at a point. */
  | { t: 'place'; x: number; y: number; color: number; hp: number; kind: EnemyKind }
  /** Test setup: move the hero. */
  | { t: 'teleport'; x: number; y: number }
  /** Test setup: the jump energy. */
  | { t: 'energy'; value: number }
  /** Test setup: a crystal worth `value` kills at a point. */
  | { t: 'crystal'; x: number; y: number; value: number }
  /**
   * Test setup (stage 2 of the transition): the enemy `id` frozen for `seconds` of game time — the common cold state
   * (`Enemy.chill`) the cold consumable of step 3 will set; 0 thaws it.
   */
  | { t: 'chill'; id: number; seconds: number };

/** What a command returned: true/false for the chain and the jump, the new id for `place` and `crystal`. */
export type CommandResult = boolean | number | void;

/** Applies a command to the world between ticks. */
export function applyCommand(world: World, cmd: Command): CommandResult {
  switch (cmd.t) {
    case 'walk': world.input.x = cmd.x; world.input.y = cmd.y; return;
    case 'begin': return beginChain(world, { x: cmd.x, y: cmd.y });
    case 'drag': dragChain(world, { x: cmd.x, y: cmd.y }, cmd.mode); return;
    case 'sweep': dragChainAlong(world, { x: cmd.fx, y: cmd.fy }, { x: cmd.x, y: cmd.y }); return;
    case 'release': return releaseChain(world);
    case 'cancel': cancelChain(world); return;
    case 'jump': return jump(world, { x: cmd.x, y: cmd.y });
    case 'param': {
      const params = world.params, oldMax = params.heroHp;
      setParam(params, cmd.key, cmd.value);
      if (cmd.key === 'heroHp') {
        const hero = world.hero;
        hero.maxHp = params.heroHp;
        // Shift current HP by the change of the maximum; a living hero keeps at least 1.
        const floor = hero.hp > 0 ? 1 : 0;
        hero.hp = Math.max(floor, Math.min(params.heroHp, hero.hp + params.heroHp - oldMax));
      }
      return;
    }
    case 'phases': setPhases(world.params, cmd.phases); return;
    case 'goals': if (world.status === 'playing') completeGoals(world); return;
    case 'burst': if (world.status === 'playing') spawnBurst(world, cmd.count); return;
    case 'clear':
      world.enemies = cmd.keepMarked ? world.enemies.filter(e => e.marked) : [];
      world.markers.length = 0; world.queue.length = 0; world.chain = [];
      return;
    case 'place': return spawnEnemy(world, { x: cmd.x, y: cmd.y }, cmd.color, cmd.hp, cmd.kind).id;
    case 'teleport': world.hero.x = cmd.x; world.hero.y = cmd.y; return;
    case 'energy': world.energy = cmd.value; return;
    case 'crystal': {
      const id = world.nextId++;
      world.objects.push({ id, kind: 'crystal', x: cmd.x, y: cmd.y, pressed: false, value: cmd.value, born: world.time });
      return id;
    }
    case 'chill': {
      const e = world.enemies.find(x => x.id === cmd.id);
      if (!e) return false;
      if (cmd.seconds > 0) e.chill = cmd.seconds; else delete e.chill;
      return true;
    }
  }
}
