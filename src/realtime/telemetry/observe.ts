/**
 * Track ТB of the real-time telemetry (docs/realtime-telemetry.md, sections 3, 7 and 8): the fight observer — the
 * `FightObserver` of the contract Т0 that fills `FightSummary`. The browser (track ТA) calls it after every command and
 * every tick; the Node report (scripts/realtime-report.ts) calls it the same way while it replays a journal, so both get
 * the same summary (except `tempo.inView`, which only the browser measures, and `threats`, which the report fills from
 * threats.ts).
 *
 * Pure: no DOM, no clock, it only reads the world (the fight hash stays the same). Cheap: a few numbers per tick and a pass
 * over the new events (≈ 1 µs per tick on «Большая поляна», measured by `npm run test:realtime-report`).
 *
 * Definitions (the report reads them; docs/realtime-telemetry.md, section 8, «ТB»):
 * - damage: every `hit` event, by `hit.source`; a `wolf` hit from a wolf that was rushing on the tick before is
 *   `wolf-rush` (the throw of decision 14; a plain wolf touch stays `wolf`). `lowHp` — every tick or command with a hit
 *   that left the hero at 3 HP or lower (`tick` — ticks run, `world.tick`).
 * - chain: a chain is a dash that started (`world.move` of kind `dash` appeared). Length — enemy links at the release;
 *   colour changes — changes of colour between consecutive enemy links of the released chain (through a crystal);
 *   crystals — crystals dropped (`crystal` events); cancels — a drawn chain emptied by a command without a dash (cancel,
 *   the step back off the last link, a release with no link left); steps back — a command that shortened the drawn chain
 *   and left it non-empty; focus spent — real seconds of focus burnt while focusing; empty focus — ticks a chain was drawn
 *   with no focus left; chains with a survivor — dashes that struck a link that survived (the chain stopped there).
 * - kills: `kill` events: source `chain` — the chain (a survivor knocked over a cliff by the chain too); another credited
 *   source — a tool of the player (`bomb`, `spin`, `blast` of a sapper the player killed, `wave`, `hammer-*` …); not
 *   credited — enemy abilities.
 * - build: `talismanFired` by id; a `hammer` event counts for the run's hammer; the `ward` event for «Пепельный оберег»
 *   (`ash-ward`). `active` — talismans and relics of the kit that have no trigger of their own (constant modifiers:
 *   «Жернов», «Тяжёлый клинок», «Быстрые ноги», «Широкий круг», «Точильный камень», «Песочные часы» …).
 * - tempo: game seconds from the start to the goals, from the goals to the end, from the start to the door (a victory);
 *   enemies on the arena per tick (average, maximum).
 * - movement: path of the hero in arena units (walk, dash, jump, knockback; a `teleport` command is not a path);
 *   game seconds standing (the hero did not move in the tick), in water (his centre), in thorns.
 * - abilities: `jump` and `spin` events, `item` events by kind.
 */
import { COUNTER_TALISMANS, OATH_HUNGER, RELICS } from '../sim/buildIds';
import type { Command } from '../sim/commands';
import { WOLF_RUSH } from '../sim/enemies/wolf';
import { inThorns, inWater } from '../sim/geometry';
import type { World, WorldEvent } from '../sim/world';
import { emptyFightSummary, type FightObserver, type FightObserverFactory, type FightSummary } from './schema';

/** HP at or below this is a «low HP» moment (section 3: «Моменты HP ≤ 3»). */
export const LOW_HP = 3;

/** The source of a wolf's throw (a `wolf` hit from a wolf that was rushing). */
export const WOLF_RUSH_SOURCE = 'wolf-rush';

/** Build ids that fire events of their own; every other talisman or relic of the kit is a constant modifier («действует»). */
const FIRING: ReadonlySet<string> = new Set<string>([...Object.values(COUNTER_TALISMANS), RELICS.bloodOath, OATH_HUNGER, 'ash-ward']);

/**
 * Reads `world.events` incrementally: the view clears the list once per frame (several ticks and commands), the Node replay
 * may clear it after each tick or never. The cursor remembers the last event it read (by identity): if that event still
 * stands at its place, only the events after it are new; otherwise the list was cleared and everything in it is new.
 */
export class EventCursor {
  private seen = 0;
  private last: WorldEvent | null = null;

  /** Calls `visit` for every event that came since the last call. */
  read(world: World, visit: (event: WorldEvent) => void): void {
    const events = world.events;
    let from = this.seen > 0 && events[this.seen - 1] === this.last ? this.seen : 0;
    for (; from < events.length; from++) visit(events[from]);
    this.seen = events.length;
    this.last = events.length ? events[events.length - 1] : null;
  }
}

/** Median of a list of numbers (0 for an empty one). */
export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const bump = (map: Record<string, number>, key: string, by = 1): void => { map[key] = (map[key] ?? 0) + by; };

/** The observer of one fight. Created with the world at the start (before the first command or tick). */
export function createFightObserver(start: World): FightObserver {
  const s = emptyFightSummary();
  const cursor = new EventCursor();
  let world = start;
  // Chains.
  const lengths: number[] = [];
  let chainLen = start.chain.length, move = start.move, survivorDash: unknown = null, focus = start.focus;
  // Wolves rushing at the end of the last tick (a `wolf` hit from one of them is a throw).
  let rushing = new Set<number>(), nextRushing = new Set<number>();
  // Tempo and movement.
  let ticks = 0, enemySum = 0, heroX = start.hero.x, heroY = start.hero.y, time = start.time;

  /** Reads the events that came since the last call. */
  const readEvents = (): void => {
    let hit = false;
    cursor.read(world, ev => {
      switch (ev.type) {
        case 'hit': {
          const source = ev.source === 'wolf' && rushing.has(ev.enemyId) ? WOLF_RUSH_SOURCE : ev.source;
          s.damage.total += ev.damage;
          bump(s.damage.bySource, source, ev.damage);
          bump(s.damage.hits, source);
          hit = true;
          return;
        }
        case 'kill':
          if (ev.source === 'chain') s.kills.chain++;
          else if (ev.credited) bump(s.kills.tools, ev.source ?? 'other');
          else s.kills.enemies++;
          return;
        case 'chainHit':
          if (!ev.killed && world.move && survivorDash !== world.move) { survivorDash = world.move; s.chain.survivorEnds++; }
          return;
        case 'crystal': s.chain.crystals++; return;
        case 'talismanFired': bump(s.build.fired, ev.id); return;
        case 'hammer': bump(s.build.fired, world.kit?.hammer ?? 'hammer'); return;
        case 'ward': bump(s.build.fired, 'ash-ward'); return;
        case 'jump': s.abilities.jumps++; return;
        case 'spin': s.abilities.spins++; return;
        case 'item': bump(s.abilities.items, ev.kind); return;
        default: return;
      }
    });
    if (hit && world.hero.hp <= LOW_HP) s.damage.lowHp.push({ tick: world.tick, hp: world.hero.hp });
  };

  /** A dash that started since the last call: its length and colour changes at the release. */
  const noteMove = (): void => {
    const m = world.move;
    if (m === move) return;
    move = m;
    if (!m || m.kind !== 'dash') return;
    s.chain.count++;
    let enemies = 0, color: number | null = null;
    for (const link of m.links) {
      if (link.kind !== 'enemy') continue;
      enemies++;
      const e = world.enemies.find(x => x.id === link.id);
      if (!e) continue;
      if (color !== null && e.color !== color) s.chain.colorChanges++;
      color = e.color;
    }
    lengths.push(enemies);
  };

  return {
    command(cmd: Command, w: World): void {
      world = w;
      readEvents();
      const before = chainLen, started = w.move !== move && w.move?.kind === 'dash';
      noteMove();
      const now = w.chain.length;
      if (before > 0 && now === 0 && !started) s.chain.cancels++;
      else if (now > 0 && now < before) s.chain.backsteps++;
      chainLen = now;
      focus = w.focus;
      // A test teleport is not a path.
      if (cmd.t === 'teleport') { heroX = w.hero.x; heroY = w.hero.y; }
    },

    tick(w: World): void {
      world = w;
      readEvents();
      noteMove();
      chainLen = w.chain.length;
      if (w.focusing) s.chain.focusSpent += Math.max(0, focus - w.focus);
      else if (chainLen > 0 && !w.move && w.focus <= 0) s.chain.focusEmpty++;
      focus = w.focus;
      // Enemies and the rushing wolves (one pass).
      const enemies = w.enemies;
      ticks++;
      enemySum += enemies.length;
      if (enemies.length > s.tempo.enemies.max) s.tempo.enemies.max = enemies.length;
      nextRushing.clear();
      for (const e of enemies) if (e.kind === 'wolf' && e.vars.st === WOLF_RUSH) nextRushing.add(e.id);
      [rushing, nextRushing] = [nextRushing, rushing];
      // Movement on game time.
      const hero = w.hero, dt = w.time - time, dx = hero.x - heroX, dy = hero.y - heroY;
      time = w.time;
      if (dx !== 0 || dy !== 0) { s.movement.path += Math.sqrt(dx * dx + dy * dy); heroX = hero.x; heroY = hero.y; }
      else s.movement.idle += dt;
      if (dt > 0) {
        if (inWater(hero, w.arena)) s.movement.water += dt;
        if (w.arena.terrain && inThorns(hero, w.arena)) s.movement.thorns += dt;
      }
    },

    summary(): FightSummary {
      const out: FightSummary = JSON.parse(JSON.stringify(s)) as FightSummary;
      out.chain.lengthMedian = median(lengths);
      out.chain.lengthMax = lengths.reduce((a, b) => Math.max(a, b), 0);
      out.tempo.enemies.avg = ticks ? enemySum / ticks : 0;
      const w = world, end = w.endTime ?? w.time;
      out.tempo.toGoals = w.greedStart;
      out.tempo.afterGoals = w.greedStart !== null ? end - w.greedStart : null;
      out.tempo.toDoor = w.status === 'victory' ? end : null;
      out.build.active = (w.kit?.talismans ?? []).filter(id => !FIRING.has(id));
      return out;
    },
  };
}

/** The factory the view and the report use (`FightObserverFactory` of Т0). */
export const fightObserver: FightObserverFactory = createFightObserver;
