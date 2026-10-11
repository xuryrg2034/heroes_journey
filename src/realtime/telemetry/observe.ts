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
 *   with no focus left; chains with a survivor — dashes that struck a link that survived (the chain stopped there; a hit
 *   that took a plate off an armoured elite, `chainHit.plates`, is not a survivor: the chain goes on through it); tough not
 *   first — released chains with an enemy of HP ≥ 2 at the release among the enemy links after the first.
 * - the loop (loop research, step 2; docs/realtime-loop-research.md, 3.3): close attempts — closing gestures (`loop` events
 *   `close` and `refused`; a run of identical refusals — the same closing and reason — with no change of the drawn chain in
 *   between counts once: the pointer moving inside the target circle sends one per point); unseals — `open` gestures (no reason); loop breaks — `open` by the rules, by the reason;
 *   seals — released closed chains (`seal` events of the phase `release`), empty ones — nobody inside, `sealInside` — how
 *   many were inside, one number per seal in order (at the release, as the player saw it). Seal kills land in
 *   `kills.tools.seal` by the kill rule below (credited, source `seal`).
 * - step-back re-adds: a link a step back took off and a later command took again into the same chain within
 *   `BACKSTEP_READD_WINDOW` real seconds (an accidental step back). Real time: each tick costs `SIM_DT ÷ tickScale` (the
 *   hit-stop tick — `SIM_DT`), the price `Simulation.nextTickCost` charges, read from the world before the tick; commands
 *   between two ticks happen at the same real moment.
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
 * - raised touches (package «Урон имеет значение»): a `hit` whose source is the striker kind's touch (`hitSource`) while the
 *   sim says its touch is raised (`touchRaised`, read after the tick: the touch is the last step of a tick).
 * - elites: an enemy with `elite` is seen from the start or from the first look at it as an elite (a newcomer becoming one);
 *   its lifetime — game seconds to its `kill` event; chains per elite — dashes with a `chainHit` on it (plate hits too);
 *   before the goals — its kill came before the `goals` event; `elitePlates` (strip by source, open, close), `eliteDown`
 *   (credited — downs; `clean` — clean kills; `inWindow` without `clean` — late window kills), `loot` (dropped, picked).
 * - the slot (casino stage 1, «Однорукий гоблин»): `slot` events — `appear` (and the game seconds after the goals of the
 *   first), `pull` (enemy links struck before the lever, the outcome), `effect`; a spin left at the end of the fight is
 *   cancelled; `hit` of the source `slot-volley` / `slot-rain` — the arrows' damage; `kill` of the source `slot` — arrow kills.
 */
import { COUNTER_TALISMANS, OATH_HUNGER, RELICS } from '../sim/buildIds';
import { tickScale } from '../sim/chain';
import type { Command } from '../sim/commands';
import { WOLF_RUSH } from '../sim/enemies/wolf';
import { kindOf } from '../sim/enemies/kinds';
import { inThorns, inWater } from '../sim/geometry';
import { SIM_DT } from '../sim/simulation';
import { touchRaised, type ChainLink, type World, type WorldEvent } from '../sim/world';
import { emptyFightSummary, type FightObserver, type FightObserverFactory, type FightSummary } from './schema';

/** HP at or below this is a «low HP» moment (section 3: «Моменты HP ≤ 3»). */
export const LOW_HP = 3;

/** The source of a wolf's throw (a `wolf` hit from a wolf that was rushing). */
export const WOLF_RUSH_SOURCE = 'wolf-rush';

/** A link taken off by a step back and taken again within this many real seconds is a step-back re-add (research 3.3). */
export const BACKSTEP_READD_WINDOW = 0.3;

/**
 * Real seconds the next tick of this world costs: `SIM_DT ÷ tickScale` (focus and the finisher slow the game), a frozen
 * hit-stop tick — `SIM_DT`. The same price as `Simulation.nextTickCost` (sim/simulation.ts), from the world alone: the
 * observer has no simulation. The test checks the two agree.
 */
export function tickRealCost(world: World): number {
  return world.hitstop > 0 ? SIM_DT : SIM_DT / tickScale(world);
}

/** A link as one number (enemy and object ids are separate counters). */
const linkKey = (link: ChainLink): number => (link.kind === 'enemy' ? link.id * 2 : link.id * 2 + 1);

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
  // The loop and the step-back re-adds: the drawn chain as link keys, its version (bumped on every change), the real clock,
  // links a step back took off (with the real moment), the last refusal counted (a repeat with the same chain is one).
  let keys: number[] = start.chain.map(linkKey), version = 0, clock = 0, nextCost = tickRealCost(start);
  let takenOff: { key: number; at: number }[] = [];
  let lastRefusal: { kind: string; refusal: string; version: number } | null = null;
  // Elites alive: when seen, the chains that hit them and the last of those (dashes are numbered by `s.chain.count`).
  const elites = new Map<number, { born: number; chains: number; lastDash: number }>();
  let goalsDone = start.greedStart !== null;

  /** Elites not seen before (placed, spawned, a newcomer turned elite). */
  const noteElites = (w: World): void => {
    for (const e of w.enemies) if (e.elite && !elites.has(e.id)) { elites.set(e.id, { born: w.time, chains: 0, lastDash: -1 }); s.elites.count++; }
  };
  noteElites(start);

  /** Reads the events that came since the last call. */
  const readEvents = (): void => {
    let hit = false;
    cursor.read(world, ev => {
      switch (ev.type) {
        case 'hit': {
          const source = ev.source === 'wolf' && rushing.has(ev.enemyId) ? WOLF_RUSH_SOURCE : ev.source;
          // Casino stage 1: the goblin's arrows.
          if (ev.source === 'slot-volley') s.slot.damage.volley += ev.damage;
          else if (ev.source === 'slot-rain') s.slot.damage.rain += ev.damage;
          s.damage.total += ev.damage;
          bump(s.damage.bySource, source, ev.damage);
          bump(s.damage.hits, source);
          hit = true;
          const striker = world.enemies.find(e => e.id === ev.enemyId);
          if (striker && ev.source === kindOf(striker).hitSource && touchRaised(world, striker)) { s.damage.raisedTouches.hits++; s.damage.raisedTouches.damage += ev.damage; }
          return;
        }
        case 'kill': {
          const elite = elites.get(ev.enemyId);
          if (elite) {
            elites.delete(ev.enemyId);
            s.elites.lifetime.push(world.time - elite.born);
            s.elites.chainsPer.push(elite.chains);
            if (!goalsDone) s.elites.beforeGoals++;
          }
          if (ev.source === 'slot') s.slot.kills++;
          if (ev.source === 'chain') s.kills.chain++;
          else if (ev.credited) bump(s.kills.tools, ev.source ?? 'other');
          else s.kills.enemies++;
          return;
        }
        case 'chainHit': {
          if (!ev.killed && ev.plates === undefined && world.move && survivorDash !== world.move) { survivorDash = world.move; s.chain.survivorEnds++; }
          const elite = elites.get(ev.enemyId);
          if (elite && elite.lastDash !== s.chain.count) { elite.lastDash = s.chain.count; elite.chains++; }
          return;
        }
        case 'goals': goalsDone = true; return;
        case 'elitePlates':
          if (ev.action === 'strip') bump(s.elites.platesBySource, ev.source ?? 'other', ev.removed ?? 0);
          else if (ev.action === 'open') s.elites.windows++;
          else if (ev.action === 'close') s.elites.windowsClosed++;
          return;
        case 'eliteDown':
          if (!ev.credited) return;
          s.elites.downs++;
          if (ev.clean) s.elites.cleanKills++;
          else if (ev.inWindow) s.elites.lateWindowKills++;
          return;
        case 'loot': if (ev.picked) s.elites.loot.picked++; else s.elites.loot.dropped++; return;
        case 'crystal': s.chain.crystals++; return;
        case 'loop':
          // The pointer on the last link opens (no reason); the rules open with one (sim `syncLoop`).
          if (ev.action === 'open') { if (ev.refusal) bump(s.chain.loopBreaks, ev.refusal); else s.chain.unseals++; lastRefusal = null; return; }
          if (ev.action === 'close') { s.chain.closeAttempts++; lastRefusal = null; return; }
          {
            const refusal = ev.refusal ?? '';
            if (lastRefusal && lastRefusal.kind === ev.kind && lastRefusal.refusal === refusal && lastRefusal.version === version) return;
            lastRefusal = { kind: ev.kind, refusal, version };
            s.chain.closeAttempts++;
          }
          return;
        case 'seal':
          if (ev.phase !== 'release') return;
          s.chain.seals++;
          if (!ev.inside.length) s.chain.sealsEmpty++;
          s.chain.sealInside.push(ev.inside.length);
          return;
        case 'talismanFired': bump(s.build.fired, ev.id); return;
        case 'hammer': bump(s.build.fired, world.kit?.hammer ?? 'hammer'); return;
        case 'ward': bump(s.build.fired, 'ash-ward'); return;
        case 'slot':
          // Casino stage 1 («Однорукий гоблин»): appearances, pulls (links before the lever, outcomes), effects.
          if (ev.action === 'appear') { s.slot.appeared++; if (s.slot.appearAfterGoals === null && world.greedStart !== null) s.slot.appearAfterGoals = world.time - world.greedStart; }
          else if (ev.action === 'pull') { s.slot.pulls++; s.slot.links.push(ev.links ?? 0); bump(s.slot.outcomes, ev.outcome ?? 'none'); }
          else if (ev.action === 'effect') s.slot.effects++;
          return;
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
    let enemies = 0, color: number | null = null, toughLater = false;
    for (const link of m.links) {
      if (link.kind !== 'enemy') continue;
      enemies++;
      const e = world.enemies.find(x => x.id === link.id);
      if (!e) continue;
      if (enemies > 1 && e.hp >= 2) toughLater = true;
      if (color !== null && e.color !== color) s.chain.colorChanges++;
      color = e.color;
    }
    lengths.push(enemies);
    if (toughLater) s.chain.toughNotFirst++;
  };

  /**
   * The drawn chain against the last look: a change bumps its version; links a step back took off are kept with the real
   * moment; links taken again soon after are re-adds. An emptied chain forgets them (a new chain is another chain).
   */
  const noteChain = (w: World, stepBack: boolean): void => {
    const chain = w.chain, n = chain.length;
    if (!n && !keys.length) return;
    let same = 0;
    while (same < n && same < keys.length && linkKey(chain[same]) === keys[same]) same++;
    if (same === n && same === keys.length) return;
    version++;
    if (!n) { takenOff = []; keys = []; return; }
    if (stepBack) for (let i = same; i < keys.length; i++) takenOff.push({ key: keys[i], at: clock });
    if (takenOff.length) {
      takenOff = takenOff.filter(t => clock - t.at <= BACKSTEP_READD_WINDOW);
      for (let i = same; i < n && takenOff.length; i++) {
        const key = linkKey(chain[i]), at = takenOff.findIndex(t => t.key === key);
        if (at >= 0) { s.chain.backstepReadds++; takenOff.splice(at, 1); }
      }
    }
    keys = chain.map(linkKey);
  };

  return {
    command(cmd: Command, w: World): void {
      world = w;
      noteElites(w);
      readEvents();
      const before = chainLen, started = w.move !== move && w.move?.kind === 'dash';
      noteMove();
      const now = w.chain.length;
      const stepBack = now > 0 && now < before;
      if (before > 0 && now === 0 && !started) s.chain.cancels++;
      else if (stepBack) s.chain.backsteps++;
      chainLen = now;
      noteChain(w, stepBack);
      nextCost = tickRealCost(w);
      focus = w.focus;
      // A test teleport is not a path.
      if (cmd.t === 'teleport') { heroX = w.hero.x; heroY = w.hero.y; }
    },

    tick(w: World): void {
      world = w;
      // The tick that ran cost what the world before it said.
      clock += nextCost;
      noteElites(w);
      readEvents();
      noteMove();
      chainLen = w.chain.length;
      noteChain(w, false);
      nextCost = tickRealCost(w);
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
      out.elites.aliveAtEnd = w.enemies.filter(e => elites.has(e.id)).length;
      // Casino stage 1: a spin still shown when the fight ended (the door, a defeat) never acts.
      out.slot.cancelled = w.status !== 'playing' && w.slot?.goblin?.spin ? 1 : 0;
      return out;
    },
  };
}

/** The factory the view and the report use (`FightObserverFactory` of Т0). */
export const fightObserver: FightObserverFactory = createFightObserver;
