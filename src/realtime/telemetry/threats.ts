/**
 * Track ТB of the real-time telemetry (docs/realtime-telemetry.md, sections 3 and 7): the readability of threats — every
 * warning of an enemy that appeared with the hero in its zone, and how it ended. Node only (the report replays journals;
 * the browser does not run it): it reads the world after each tick and never changes it (the hash stays the same).
 *
 * Warnings (decisions of 10.10.2026, section 7):
 * - `archer` — the archer's mark (a circle fixed on the hero's centre; the hero is always in it when it appears) or, in
 *   journals without `archerPoint`, its line. Strike — the end of the aim.
 * - `boar` — the boar's lane from the windup: from the boar along its line, `boarRange` long while it winds up and the rest
 *   of the range while it charges (the lane shortens). The charge ends: a hit; the charge reached the hero without a hit
 *   (`stats.boarHits` grew) — shielded; it stopped short of its range — dodged, «укрытие» (`reason: 'cover'`, `coverKind`
 *   `wall` for a wall or a tree, `cliff` for a cliff edge; design 10.10.2026); it ran the whole range past the hero dashing
 *   or jumping through it — shielded; else dodged.
 * - `wolf` — one warning per pack (decision 10): the wolves that started to howl in one tick. While a wolf howls its line
 *   points at the hero (the hero is in it within the wolf's rush length — the sim's `wolfRushLength`: `wolfRushRange`, or
 *   `wolfLeaderThrow` in a howl the elite leader joined); at the end of the howl the line is fixed and the wolf
 *   rushes along it. The pack ends when none of it howls or rushes: a throw hit (a `wolf` hit of a wolf that rushed on
 *   the tick before) — hit; a wolf reached the hero without a hit — shielded; a rush ran out — dodged; every rush stopped
 *   short (a wall or a tree, a cliff edge) — dodged, cover (`coverKind` `cliff` if one met a cliff, else `wall`); every wolf
 *   dropped its howl or rush (the cold, a knockback, the pack broken) or died — interrupted. The exit time counts from the
 *   start of the howl; `lockTick` — the tick the lane was fixed (the first rush of the pack; design 10.10.2026).
 * - `lynx` — the lynx's line from the windup (the rest of it while it leaps). A leap that ends beside the hero without a
 *   hit, or passes him while he dashes or jumps — shielded; a knockback drops it — interrupted.
 * - `sapper` — the fuse of a sapper lit by the hero's touch and its blast are one warning (the hero is always in the
 *   circle when it lights); the fuse of a killed sapper (`sapperFuse`) is a warning when the hero is in its circle.
 *   `sapper-instant` — a sapper blast with no fuse before it (delay 0): counted apart, «без предупреждения».
 * - `flail`, `throw` (task 28 «Тюремщик в походе») — the Jailer's «Кистень» (its half disc from the core towards the hero at the
 *   windup's start) and «Бросок гири» (the circle on the hero's centre then), from the windup (`bossMove` `start`) with the hero's
 *   body in the zone. Strike — `bossMove` `hit`: a `flail` / `throw` hit — hit, else shielded (in the zone) or dodged; the core died
 *   or the move was dropped (the weight severed) — interrupted.
 * - `knight-charge`, `knight-swing` (task 43, the knight's offensive) — «Рывок» (the lane from the knight, `KNIGHT_LANE_WIDTH` wide: the
 *   whole lane while it winds up, the rest while it runs) and «Размах» (the circle `knightSwingRadius` around the knight), from the
 *   windup (`knightMove` `start`) with the hero's body in the zone. «Рывок»: a `knight-charge` hit — hit; the run passed the hero's
 *   body without a hit (a dash, a jump, invulnerability: `vars.hh` without a hit) — shielded; the run ended — dodged. «Размах»: the
 *   strike (`knightMove` `hit`) — a `knight-swing` hit, else shielded (in the zone) or dodged. The knight died — interrupted.
 *
 * - `bolt` (task 43, the law of the crossbow) — a crossbow's windup (`bolt` `aim`) with the hero's body on its fixed line. Strike —
 *   `bolt` `shot`: the hero hit — hit; the bolt went to the hero but did not hurt (invulnerability, a shield) — shielded; it struck
 *   another body first or the hero was off the line — dodged; the crossbow died before its shot or the fight ended — interrupted.
 * - `sling`, `hive`, `wisp` (task 57а «Лес: стрелки») — a slinger's windup (`shooter` `aim`) with the hero's body on one of its three
 *   fixed lines (a stone's radius + the hero's body), a hive's swell with the hero's body on a ray of its ring within the wasps' flight.
 *   The volley's shots are known at its `loose`: a shot of it hits the hero (`stone` / `wasp` of the shooter) — hit; a shield takes one
 *   (`shot` `block`) — shielded; all of them ended otherwise — dodged (`reason: 'snuff'` when the dash or a bomb put one out); the
 *   shooter died before its volley or while its shots hung (they go out with it), or the fight ended — interrupted. The wisp («Светляк») from its lighting (`wisp` `lit`), always: its
 *   touch hurt — hit, a shield took it — shielded, its flight ran out — dodged (the exit time is the flight it survived), the chain or
 *   anything else killed it — interrupted.
 *
 * - `centipede-lunge` (task 57б-2 «Сороконожка») — the head's «Рывок» from its windup (`centipede` `lunge` `start`) with the hero's body in
 *   its lane (`centipedeLane`: the whole lane while it winds up, the rest while it runs; half `CENTI_LANE_WIDTH` + the hero's body). A
 *   `centipede-lunge` hit — hit; the run's end (`lunge` `end`): a shield took it (`met` `block`) or it passed the hero during his move
 *   (`pass`) — shielded, else dodged; the head died (or became a part) before — interrupted.
 *
 * - `pot`, `warden-swing` (task 59б «Гарнизон, шаг 3») — the pitcher's pot from its throw (`pot` `throw`) with the hero's body in its mark
 *   (`pitchMarkRadius` + the hero's body round the point fixed at the throw); its landing (`pot` `land`): a `pot` hit — hit, the hero in
 *   the circle unhurt (a dash, a jump, a shield) — shielded, else dodged (the pot lands after its thrower's death too). The angry warden's
 *   «Размах» (the knight's circle, `wardenSwing`) from its windup (`warden` `swing` `start`) with the hero's body in it: the strike
 *   (`warden` `swing` `hit`) — a `warden-swing` hit, else shielded (in the zone) or dodged; the warden died — interrupted.
 *
 * - `wardrobe-topple`, `rook` (task 55в «Замок», spec task-55 §10) — «Падение шкафа» from its windup (`wardrobe` `windup`) with the hero's
 *   body in its lane (`wardrobeTopple`: fixed at the windup, `TOPPLE_WIDTH` + the hero's body); the fall (`wardrobe` `hit`): a
 *   `wardrobe-topple` hit — hit, the body in the lane unhurt — shielded, else dodged; the wardrobe gone (broken) or its windup dropped (a
 *   shove) — interrupted. «Удар ладьи» from the rook's windup (`rook` `aim`) with the hero's body on its axis (`rookLine`: each half to its
 *   first thing-cover now; the line of the aim when none); the strike (`rook` `shot`): a `rook-strike` hit — hit; the shot reached the hero
 *   unhurt (`plus` / `minus` `hero`) — shielded; else dodged (`reason: 'cover'` when a thing sheltered him: the hero on the aim's axis,
 *   the half ended at a thing); the rook died — interrupted.
 *
 * Outcomes: `hit` — a strike of this enemy by this source; `shielded` — the body in the zone on the strike tick but not
 * hurt (invulnerability, the chain's shield, a dash, a jump, the focus spare: decision 12); `dodged` — the body out of the
 * zone on the strike tick; `interrupted` — the enemy died, was knocked back, dropped its attack, or the fight ended (the
 * cold is not an outcome: a frozen archer, boar, lynx or sapper waits). Exit time — ticks from the appearance (the zone
 * fixed; for the wolf — the start of the howl) to the first tick with the body out of the zone, also in game and real
 * seconds.
 */
import { archerLine, archerMark } from '../sim/enemies/archer';
import { WOLF_HOWL, WOLF_RUSH, wolfRushLength } from '../sim/enemies/wolf';
import { LYNX_LEAP, LYNX_STUN, LYNX_WINDUP } from '../sim/enemies/lynx';
import { inFlail, jailerMove, JAILER } from '../sim/enemies/jailer';
import { BOLT_HALF } from '../sim/enemies/crossbow';
import { STONE_RADIUS } from '../sim/enemies/slinger';
import { CENTI_LANE_WIDTH, CENTI_LUNGE_SOURCE, centipedeLane } from '../sim/enemies/centipede';
import { HIVE_SPEED, WASP_LIFE, WASP_RADIUS } from '../sim/enemies/hive';
import { KNIGHT_CHARGE_SOURCE, KNIGHT_LANE_WIDTH, KNIGHT_SWING_SOURCE, knightLane, knightSwing } from '../sim/enemies/garrison';
import { WARDEN_SWING_SOURCE, wardenSwing } from '../sim/enemies/warden';
import { pitchMarkRadius, POT_SOURCE } from '../sim/pitch';
// Task 55в: the castle's moves.
import { rookLine, ROOK_HALF, ROOK_SOURCE, TOPPLE_SOURCE, wardrobeTopple } from '../sim/enemies/castle';
import { blockedAt, cliffAt, dist, type Vec } from '../sim/geometry';
import { bodyRadiusOf } from '../sim/enemies/kinds';
import { heroRadius } from '../sim/params';
import { SIM_DT } from '../sim/simulation';
import { enemyFrozen, touchReachOf, type Enemy, type World, type WorldEvent } from '../sim/world';
import { EventCursor } from './observe';
import type { ThreatTally } from './schema';

export type ThreatKind = 'archer' | 'boar' | 'wolf' | 'lynx' | 'sapper' | 'sapper-instant' | 'flail' | 'throw' | 'bolt' | 'knight-charge' | 'knight-swing' | 'sling' | 'hive' | 'wisp' | 'pot' | 'warden-swing' | 'centipede-lunge' | 'wardrobe-topple' | 'rook';
export const THREAT_KINDS: readonly ThreatKind[] = ['archer', 'boar', 'wolf', 'lynx', 'sapper', 'sapper-instant', 'flail', 'throw', 'bolt', 'knight-charge', 'knight-swing', 'sling', 'hive', 'wisp', 'pot', 'warden-swing', 'centipede-lunge', 'wardrobe-topple', 'rook'];
export type ThreatOutcome = 'hit' | 'shielded' | 'dodged' | 'interrupted';
export type CoverKind = 'wall' | 'cliff';

/** One warning with the hero in its zone at its appearance. */
export interface ThreatWarning {
  kind: ThreatKind;
  /** The enemies of the warning (the pack of wolves; one enemy otherwise; the owner of a sapper blast). */
  enemies: number[];
  /** Ticks run (`world.tick`) and game seconds at the appearance. */
  tick: number;
  time: number;
  outcome: ThreatOutcome | null;
  /** Why it ended this way: `cover` (a boar stopped by a wall), `move` (passed through a dash or a jump), `dead`, `knock`, `dropped`, `fall`, `end` … */
  reason?: string;
  /** A dodge by cover (`reason: 'cover'`): what stopped the rush — a wall or a tree (`wall`), a cliff edge (`cliff`). */
  coverKind?: CoverKind;
  /** Wolves: ticks run when the lane was fixed — the first wolf of the pack started its rush (absent if none did). */
  lockTick?: number;
  /** Ticks run when it ended. */
  endTick?: number;
  /** From the appearance to the first tick out of the zone: ticks, game seconds, real seconds (null — the hero never left it). */
  exitTicks: number | null;
  exitGame: number | null;
  exitReal: number | null;
}

interface Hit { enemyId: number; source: string }
interface Open {
  w: ThreatWarning;
  startReal: number;
  /** The hero's body is in the zone now (null — the zone is gone: the enemy left the arena). */
  inZone(world: World): boolean | null;
}

/** Distance from `p` to the segment from `a` along the unit (dx, dy) for `len`. */
function rayDistance(a: Vec, dx: number, dy: number, len: number, p: Vec): number {
  const t = Math.max(0, Math.min(len, (p.x - a.x) * dx + (p.y - a.y) * dy));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

/** Reach of an enemy's body to the hero's (the touch of world.ts with its slack; task 48 — a solid body's own reach, `touchReachOf`). */
const reachOf = (world: World, e: Enemy): number => touchReachOf(world, e);

/** Follows every warning of a fight. Create it with the world at the start; call `tick` after each tick, `finish` at the end. */
export class ThreatTracker {
  readonly warnings: ThreatWarning[] = [];
  private readonly cursor = new EventCursor();
  private open: Open[] = [];
  private real = 0;
  /** Attacks already looked at (opened, or the hero was out of the zone at their appearance): by enemy id. */
  private readonly seenArcher = new Set<number>();
  private readonly seenBoar = new Set<number>();
  private readonly seenLynx = new Set<number>();
  private readonly seenWolf = new Set<number>();
  private readonly seenSapper = new Set<number>();
  private readonly seenBlast = new Set<number>();
  /** Wolf states at the end of the last tick (a throw is a hit of a wolf that rushed then). */
  private wolfState = new Map<number, number>();
  private boarHits = 0;
  private enemies = new Map<number, Enemy>();
  // This tick's events.
  private hits: Hit[] = [];
  private kills = new Map<number, string>();
  private blasts: Vec[] = [];
  /** Task 28: the Jailer's moves of this tick (`bossMove`): begun and struck, by the core's id. */
  private bossStarts: { id: number; move: string }[] = [];
  private bossHits: { id: number; move: string }[] = [];
  /** Task 43: the crossbows' windups and shots of this tick (`bolt`), and the open bolt warnings by the crossbow's id. */
  private boltAims: Extract<WorldEvent, { type: 'bolt' }>[] = [];
  private boltShots: Extract<WorldEvent, { type: 'bolt' }>[] = [];
  private readonly boltOpen = new Map<number, Open>();
  /** Task 43: the knights' moves of this tick (`knightMove`): `start`, and the ends (`end` of the run, `hit` of the swing). */
  private knightStarts: { id: number; move: string }[] = [];
  private knightEnds: { id: number; move: string }[] = [];
  /** Task 43: the charges whose run met the hero's body without a hit (shielded). */
  private readonly knightPassed = new Set<Open>();
  /** Task 57а: the shooters' windups and volleys, the shots' ends and the wisps' events of this tick. */
  private shooterEvents: Extract<WorldEvent, { type: 'shooter' }>[] = [];
  private shotEnds: Extract<WorldEvent, { type: 'shot' }>[] = [];
  private wispEvents: Extract<WorldEvent, { type: 'wisp' }>[] = [];
  /** Task 57а: the open volley warnings by the shooter's id — the hit source, and its shots once loosed. */
  private readonly volleyOpen = new Map<number, { o: Open; source: string; shots: Set<number> | null; snuffed: boolean }>();
  private readonly wispOpen = new Map<number, Open>();
  /** Task 57б-2: this tick's centipede lunges; the open warnings by the head's id. */
  private centiEvents: Extract<WorldEvent, { type: 'centipede' }>[] = [];
  private readonly centiOpen = new Map<number, Open>();
  /** Task 59б: this tick's pots and wardens' swings; the open warnings by the pot's and the warden's id. */
  private potEvents: Extract<WorldEvent, { type: 'pot' }>[] = [];
  private wardenEvents: Extract<WorldEvent, { type: 'warden' }>[] = [];
  private readonly potOpen = new Map<number, { o: Open; by: number; at: Vec }>();
  private readonly wardenOpen = new Map<number, Open>();
  /** Task 55в: this tick's wardrobes' and rooks' events; the open warnings by the wardrobe's and the rook's id (the rook's aim line). */
  private wardrobeEvents: Extract<WorldEvent, { type: 'wardrobe' }>[] = [];
  private rookEvents: Extract<WorldEvent, { type: 'rook' }>[] = [];
  private readonly toppleOpen = new Map<number, Open>();
  private readonly rookOpen = new Map<number, { o: Open; aim: { from: Vec; to: Vec } }>();
  /** Hits already explained by a warning of this tick. */
  private used = new Set<Hit>();

  constructor(world: World) {
    this.boarHits = world.stats.boarHits;
    this.cursor.read(world, () => { /* events before the start are not this fight's */ });
  }

  /** After a tick; `realDt` — the real seconds it stood for (`Simulation.nextTickCost()` before it). */
  tick(world: World, realDt: number = SIM_DT): void {
    this.real += realDt;
    this.hits = []; this.kills.clear(); this.blasts = []; this.used.clear(); this.bossStarts = []; this.bossHits = []; this.boltAims = []; this.boltShots = []; this.knightStarts = []; this.knightEnds = [];
    this.shooterEvents = []; this.shotEnds = []; this.wispEvents = []; this.potEvents = []; this.wardenEvents = []; this.centiEvents = []; this.wardrobeEvents = []; this.rookEvents = [];
    this.cursor.read(world, ev => {
      if (ev.type === 'hit') this.hits.push({ enemyId: ev.enemyId, source: ev.source });
      else if (ev.type === 'knightMove') { if (ev.stage === 'start') this.knightStarts.push({ id: ev.id, move: ev.move }); else if (ev.stage === 'end' || ev.stage === 'hit') this.knightEnds.push({ id: ev.id, move: ev.move }); }
      else if (ev.type === 'bossMove') (ev.stage === 'start' ? this.bossStarts : this.bossHits).push({ id: ev.id, move: ev.move });
      else if (ev.type === 'kill') this.kills.set(ev.enemyId, ev.source ?? '');
      else if (ev.type === 'blast' && ev.source === 'blast') this.blasts.push({ x: ev.x, y: ev.y });
      else if (ev.type === 'bolt') (ev.action === 'aim' ? this.boltAims : this.boltShots).push(ev);
      else if (ev.type === 'shooter') this.shooterEvents.push(ev);
      else if (ev.type === 'shot') this.shotEnds.push(ev);
      else if (ev.type === 'wisp') this.wispEvents.push(ev);
      else if (ev.type === 'pot') this.potEvents.push(ev);
      else if (ev.type === 'warden') this.wardenEvents.push(ev);
      else if (ev.type === 'centipede') this.centiEvents.push(ev);
      else if (ev.type === 'wardrobe') this.wardrobeEvents.push(ev);
      else if (ev.type === 'rook') this.rookEvents.push(ev);
    });
    this.enemies = new Map(world.enemies.map(e => [e.id, e]));
    // Exit times first: the strike tick counts too.
    for (const o of this.open) {
      if (o.w.exitTicks !== null) continue;
      const inside = o.inZone(world);
      if (inside === false) this.exit(o, world);
    }
    this.resolveArchers(world);
    this.resolveBoars(world);
    this.resolveLynxes(world);
    this.resolveWolves(world);
    this.resolveSappers(world);
    this.resolveBoss(world);
    this.resolveBolts(world);
    this.resolveKnights(world);
    this.resolveForest(world);
    this.resolveStep3(world);
    this.resolveCastle(world);
    if (world.status !== 'playing') for (const o of [...this.open]) this.close(o, world, 'interrupted', 'end');
    else this.openNew(world);
    this.wolfState = new Map(world.enemies.filter(e => e.kind === 'wolf').map(e => [e.id, e.vars.st ?? 0]));
    this.wolfRan = new Map(world.enemies.filter(e => e.kind === 'wolf' && e.vars.st === WOLF_RUSH).map(e => [e.id, { ran: e.vars.ran ?? 0, len: wolfRushLength(world, e) }]));
    this.boarHits = world.stats.boarHits;
  }

  /** The journal ended (an unloaded page, a fight still open): what is still open is interrupted. */
  finish(world: World): void { for (const o of [...this.open]) this.close(o, world, 'interrupted', 'end'); }

  /** Counts by kind (`FightSummary.threats`): only warnings with an outcome. */
  tally(): Record<string, ThreatTally> {
    const out: Record<string, ThreatTally> = {};
    for (const w of this.warnings) {
      if (!w.outcome) continue;
      const t = out[w.kind] ??= { warned: 0, hit: 0, dodged: 0, shielded: 0, interrupted: 0, exitTicks: [] };
      t.warned++;
      t[w.outcome]++;
      if (w.outcome === 'dodged' && w.exitTicks !== null) t.exitTicks.push(w.exitTicks);
    }
    return out;
  }

  // ---- Common ----

  private exit(o: Open, world: World): void {
    o.w.exitTicks = world.tick - o.w.tick;
    o.w.exitGame = world.time - o.w.time;
    o.w.exitReal = this.real - o.startReal;
  }

  private add(kind: ThreatKind, enemies: number[], world: World, inZone: Open['inZone']): Open {
    const w: ThreatWarning = { kind, enemies, tick: world.tick, time: world.time, outcome: null, exitTicks: null, exitGame: null, exitReal: null };
    this.warnings.push(w);
    const o: Open = { w, startReal: this.real, inZone };
    this.open.push(o);
    return o;
  }

  private close(o: Open, world: World, outcome: ThreatOutcome, reason?: string, cover?: CoverKind): void {
    o.w.outcome = outcome;
    if (reason) o.w.reason = reason;
    if (cover) o.w.coverKind = cover;
    o.w.endTick = world.tick;
    if (outcome === 'dodged' && o.w.exitTicks === null) this.exit(o, world);
    this.open = this.open.filter(x => x !== o);
  }

  /** A hit of this tick by `ids` with `source` (marked as explained). */
  private hitBy(ids: readonly number[], source: string, also?: (h: Hit) => boolean): boolean {
    const h = this.hits.find(x => !this.used.has(x) && ids.includes(x.enemyId) && x.source === source && (!also || also(x)));
    if (h) this.used.add(h);
    return !!h;
  }

  /** The detonation nearest to `at` among this tick's blasts (taken: one blast explains one warning). */
  private takeBlast(at: Vec): boolean {
    if (!this.blasts.length) return false;
    let best = 0;
    for (let i = 1; i < this.blasts.length; i++) if (dist(this.blasts[i], at) < dist(this.blasts[best], at)) best = i;
    this.blasts.splice(best, 1);
    return true;
  }

  private kindOpen(kind: ThreatKind): Open[] { return this.open.filter(o => o.w.kind === kind); }

  // ---- Task 59б: the pitcher's pot and the angry warden's «Размах» ----

  private resolveStep3(world: World): void {
    const hero = world.hero, inMark = (w: World, at: Vec): boolean => dist(w.hero, at) < pitchMarkRadius(w) + heroRadius(w.params);
    for (const ev of this.potEvents) {
      if (ev.action === 'land') {
        const open = this.potOpen.get(ev.id);
        if (!open) continue;
        this.potOpen.delete(ev.id);
        this.close(open.o, world, this.hitBy([open.by], POT_SOURCE) ? 'hit' : ev.hit === 'hero' ? 'shielded' : 'dodged');
      } else if (ev.action === 'throw' && ev.by !== undefined) {
        const at = { x: ev.x, y: ev.y };
        if (inMark(world, at)) this.potOpen.set(ev.id, { o: this.add('pot', [ev.by], world, w => inMark(w, at)), by: ev.by, at });
      }
    }
    for (const [id, o] of this.wardenOpen) {
      if (this.wardenEvents.some(ev => ev.id === id && ev.action === 'swing' && ev.stage === 'hit')) {
        this.wardenOpen.delete(id);
        this.close(o, world, this.hitBy([id], WARDEN_SWING_SOURCE) ? 'hit' : o.inZone(world) ? 'shielded' : 'dodged');
      } else if (!this.enemies.has(id)) { this.wardenOpen.delete(id); this.close(o, world, 'interrupted', 'dead'); }
    }
    for (const ev of this.wardenEvents) {
      if (ev.action !== 'swing' || ev.stage !== 'start') continue;
      const e = this.enemies.get(ev.id), swing = e ? wardenSwing(world, e) : null;
      if (!swing || dist(hero, swing) > swing.r + heroRadius(world.params)) continue;
      // The circle of the windup (the warden stands while it winds up; the strike clears its state — the circle stays the windup's).
      const circle = { x: swing.x, y: swing.y, r: swing.r };
      this.wardenOpen.set(ev.id, this.add('warden-swing', [ev.id], world, w => dist(w.hero, circle) <= circle.r + heroRadius(w.params)));
    }
  }

  // ---- Task 55в: «Падение шкафа» and «Удар ладьи» ----

  private resolveCastle(world: World): void {
    const hr = heroRadius(world.params);
    const onSegment = (from: Vec, to: Vec, half: number) => (w: World): boolean => {
      const len = dist(from, to), dx = len > 0 ? (to.x - from.x) / len : 1, dy = len > 0 ? (to.y - from.y) / len : 0;
      return rayDistance(from, dx, dy, len, w.hero) <= half + heroRadius(w.params);
    };
    for (const [id, o] of this.toppleOpen) {
      if (this.wardrobeEvents.some(ev => ev.id === id && ev.action === 'hit')) {
        this.toppleOpen.delete(id);
        this.close(o, world, this.hitBy([id], TOPPLE_SOURCE) ? 'hit' : o.inZone(world) ? 'shielded' : 'dodged');
      } else {
        const e = this.enemies.get(id);
        if (!e) { this.toppleOpen.delete(id); this.close(o, world, 'interrupted', 'dead'); }
        else if (!wardrobeTopple(world, e)) { this.toppleOpen.delete(id); this.close(o, world, 'interrupted', 'dropped'); }
      }
    }
    for (const ev of this.wardrobeEvents) {
      if (ev.action !== 'windup') continue;
      const e = this.enemies.get(ev.id), lane = e ? wardrobeTopple(world, e) : null;
      if (!lane) continue;
      const inLane = onSegment({ ...lane.from }, { ...lane.to }, lane.half);
      if (inLane(world)) this.toppleOpen.set(ev.id, this.add('wardrobe-topple', [ev.id], world, inLane));
    }
    for (const [id, open] of this.rookOpen) {
      const shot = this.rookEvents.find(ev => ev.id === id && ev.action === 'shot');
      if (shot) {
        this.rookOpen.delete(id);
        const reached = shot.plus === 'hero' || shot.minus === 'hero', sheltered = shot.plus === 'thing' || shot.minus === 'thing';
        if (this.hitBy([id], ROOK_SOURCE)) this.close(open.o, world, 'hit');
        else if (reached) this.close(open.o, world, 'shielded');
        else this.close(open.o, world, 'dodged', sheltered && onSegment(open.aim.from, open.aim.to, ROOK_HALF)(world) ? 'cover' : undefined);
      } else if (!this.enemies.has(id)) { this.rookOpen.delete(id); this.close(open.o, world, 'interrupted', 'dead'); }
    }
    for (const ev of this.rookEvents) {
      if (ev.action !== 'aim') continue;
      const aim = { from: { x: ev.x0, y: ev.y0 }, to: { x: ev.x1, y: ev.y1 } };
      if (!onSegment(aim.from, aim.to, ROOK_HALF)(world)) continue;
      // The zone: the sign now (a thing shoved onto the axis shortens a half — the hero behind it is out of the zone); the aim's line once gone.
      const inZone = (w: World): boolean => {
        const e = this.enemies.get(ev.id) ?? w.enemies.find(x => x.id === ev.id), line = e ? rookLine(w, e) : null;
        return line ? rayDistance({ x: line.x0, y: line.y0 }, line.axis === 'row' ? 1 : 0, line.axis === 'row' ? 0 : 1, dist({ x: line.x0, y: line.y0 }, { x: line.x1, y: line.y1 }), w.hero) <= line.half + hr : onSegment(aim.from, aim.to, ROOK_HALF)(w);
      };
      this.rookOpen.set(ev.id, { o: this.add('rook', [ev.id], world, inZone), aim });
    }
  }

  // ---- Archer ----

  private archerZone(world: World, e: Enemy): Open['inZone'] | null {
    const hr = heroRadius(world.params), mark = archerMark(world, e);
    if (mark) { const at = { ...mark.at }, r = mark.r; return w => dist(w.hero, at) <= r + hr; }
    const line = archerLine(world, e);
    if (!line) return null;
    const len = dist(line.from, line.to), dx = len > 0 ? (line.to.x - line.from.x) / len : 1, dy = len > 0 ? (line.to.y - line.from.y) / len : 0;
    const from = { ...line.from }, half = line.half;
    return w => rayDistance(from, dx, dy, len, w.hero) <= half + hr;
  }

  private resolveArchers(world: World): void {
    for (const o of this.kindOpen('archer')) {
      const id = o.w.enemies[0], e = this.enemies.get(id);
      if (this.hitBy([id], 'arrow')) this.close(o, world, 'hit');
      else if (!e) this.close(o, world, 'interrupted', 'dead');
      else if (e.vars.aim === 1 && world.status === 'playing') continue;
      else if (world.status !== 'playing') this.close(o, world, 'interrupted', 'end');
      else this.close(o, world, o.inZone(world) ? 'shielded' : 'dodged');
    }
  }

  // ---- Boar ----

  private boarZone(e: Enemy): Open['inZone'] {
    const id = e.id;
    return world => {
      const b = this.enemies.get(id);
      if (!b || (b.boar !== 'windup' && b.boar !== 'charge')) return null;
      const left = b.boar === 'windup' ? world.params.boarRange : Math.max(0, world.params.boarRange - b.charged);
      return rayDistance(b, b.dirX, b.dirY, left, world.hero) <= reachOf(world, b);
    };
  }

  private readonly boarPassed = new Set<Open>();

  private resolveBoars(world: World): void {
    const knocked = world.stats.boarHits > this.boarHits;
    for (const o of this.kindOpen('boar')) {
      const id = o.w.enemies[0], e = this.enemies.get(id);
      if (this.hitBy([id], 'boar')) { this.close(o, world, 'hit'); continue; }
      if (!e) { this.close(o, world, 'interrupted', 'dead'); continue; }
      if (world.status !== 'playing') { this.close(o, world, 'interrupted', 'end'); continue; }
      if (e.boar === 'windup' || e.boar === 'charge') {
        if (e.boar === 'charge' && world.move && dist(e, world.hero) <= reachOf(world, e) + world.params.boarChargeSpeed * SIM_DT) this.boarPassed.add(o);
        continue;
      }
      const reached = knocked && e.boar === 'rest' && dist(e, world.hero) <= reachOf(world, e) + world.params.boarChargeSpeed * SIM_DT;
      if (reached) this.close(o, world, 'shielded');
      else if (e.charged < world.params.boarRange - 1e-6) this.close(o, world, 'dodged', 'cover', this.boarStop(world, e));
      else if (this.boarPassed.has(o)) this.close(o, world, 'shielded', 'move');
      else this.close(o, world, 'dodged');
      this.boarPassed.delete(o);
    }
  }

  /** What stopped a charge short of its range: the cliff edge where its next step would go (and no wall there), else a wall or a tree. */
  private boarStop(world: World, e: Enemy): CoverKind {
    const p = world.params, r = bodyRadiusOf(p, e) * 0.95, step = Math.min(p.boarChargeSpeed * SIM_DT, Math.max(0, p.boarRange - e.charged));
    const next = { x: e.x + e.dirX * step, y: e.y + e.dirY * step };
    return cliffAt(next, r, world.arena) && !blockedAt(next, r, world.arena, false) ? 'cliff' : 'wall';
  }

  // ---- Lynx ----

  private lynxZone(e: Enemy): Open['inZone'] {
    const id = e.id;
    return world => {
      const l = this.enemies.get(id);
      if (!l || (l.vars.st !== LYNX_WINDUP && l.vars.st !== LYNX_LEAP)) return null;
      const left = l.vars.st === LYNX_WINDUP ? l.vars.len : Math.max(0, l.vars.len - (l.vars.ran ?? 0));
      return rayDistance(l, l.vars.dx, l.vars.dy, left, world.hero) <= reachOf(world, l);
    };
  }

  private readonly lynxPassed = new Set<Open>();

  private resolveLynxes(world: World): void {
    for (const o of this.kindOpen('lynx')) {
      const id = o.w.enemies[0], e = this.enemies.get(id);
      if (this.hitBy([id], 'lynx')) { this.close(o, world, 'hit'); continue; }
      if (!e) { this.close(o, world, 'interrupted', 'dead'); continue; }
      if (world.status !== 'playing') { this.close(o, world, 'interrupted', 'end'); continue; }
      const st = e.vars.st;
      if (st === LYNX_WINDUP || st === LYNX_LEAP) {
        const step = world.params.lynxRange / Math.max(0.01, world.params.lynxLeapTime) * SIM_DT;
        if (st === LYNX_LEAP && world.move && dist(e, world.hero) <= reachOf(world, e) + step) this.lynxPassed.add(o);
        continue;
      }
      if (st !== LYNX_STUN) this.close(o, world, 'interrupted', 'knock');
      else if (dist(e, world.hero) <= reachOf(world, e) + 1e-6) this.close(o, world, 'shielded');
      else if (this.lynxPassed.has(o)) this.close(o, world, 'shielded', 'move');
      else this.close(o, world, 'dodged');
      this.lynxPassed.delete(o);
    }
  }

  // ---- Wolves (one warning per pack) ----

  private readonly packs = new Map<Open, Map<number, 'howl' | 'rush' | 'reached' | 'missed' | 'wall' | 'cliff' | 'dropped' | 'dead'>>();
  /**
   * Distance each rushing wolf had run at the end of the last tick and its rush length then (a rush that ends short of its
   * length hit a wall; the sim forgets the leader's longer length when the rush ends).
   */
  private wolfRan = new Map<number, { ran: number; len: number }>();

  private wolfZone(members: readonly number[]): Open['inZone'] {
    return world => {
      let any = false;
      for (const id of members) {
        const e = this.enemies.get(id);
        if (!e) continue;
        const st = e.vars.st ?? 0, reach = reachOf(world, e);
        if (st === WOLF_HOWL) { any = true; if (dist(e, world.hero) <= wolfRushLength(world, e) + reach) return true; }
        else if (st === WOLF_RUSH) {
          any = true;
          if (rayDistance(e, e.vars.dx ?? 1, e.vars.dy ?? 0, Math.max(0, wolfRushLength(world, e) - (e.vars.ran ?? 0)), world.hero) <= reach) return true;
        }
      }
      return any ? false : null;
    };
  }

  private resolveWolves(world: World): void {
    for (const o of this.kindOpen('wolf')) {
      const members = this.packs.get(o)!, ids = [...members.keys()];
      const hit = this.hitBy(ids, 'wolf', h => this.wolfState.get(h.enemyId) === WOLF_RUSH);
      for (const [id, state] of members) {
        if (state !== 'howl' && state !== 'rush') continue;
        const e = this.enemies.get(id);
        if (!e) { members.set(id, 'dead'); continue; }
        const st = e.vars.st ?? 0;
        if (st === WOLF_HOWL) continue;
        if (st === WOLF_RUSH) { members.set(id, 'rush'); o.w.lockTick ??= world.tick; continue; }
        // The rush ended: at the hero; short of its range — a wall or a tree (the wolf walks back) or a cliff edge (it leaves the
        // ring for a while: `away`); or it ran out. A howl or rush dropped (the cold, a knockback, the pack broken) — back in the ring.
        if (state === 'rush' || this.wolfState.get(id) === WOLF_RUSH) {
          const p = world.params, last = this.wolfRan.get(id), short = (last?.ran ?? 0) + p.wolfRushSpeed * SIM_DT < (last?.len ?? p.wolfRushRange) - 1e-6;
          if (st !== 0 && dist(e, world.hero) <= reachOf(world, e) + 1e-6) members.set(id, 'reached');
          else if (st !== 0) members.set(id, short ? 'wall' : 'missed');
          else members.set(id, (e.vars.away ?? 0) > 0 && !enemyFrozen(e) && e.knock <= 0 ? 'cliff' : 'dropped');
        } else members.set(id, 'dropped');
      }
      if (hit) { this.close(o, world, 'hit'); this.packs.delete(o); continue; }
      if (world.status !== 'playing') { this.close(o, world, 'interrupted', 'end'); this.packs.delete(o); continue; }
      const states = [...members.values()];
      if (states.some(s => s === 'howl' || s === 'rush')) continue;
      if (states.includes('reached')) this.close(o, world, 'shielded');
      else if (states.includes('missed')) this.close(o, world, 'dodged');
      // Every wolf that rushed was stopped short: cover — by a cliff if one of them met a cliff edge.
      else if (states.includes('cliff') || states.includes('wall')) this.close(o, world, 'dodged', 'cover', states.includes('cliff') ? 'cliff' : 'wall');
      else this.close(o, world, 'interrupted', states.includes('dropped') ? 'dropped' : 'dead');
      this.packs.delete(o);
    }
  }

  // ---- Sappers ----

  private readonly sapperOwner = new Map<Open, { owner: number; blast: number | null; center: Vec }>();
  /** Fuses of killed sappers that burn with the hero out of their circle at the start: not warnings. */
  private readonly quiet = new Map<number, { owner: number; at: Vec }>();

  private sapperZone(state: { center: Vec }): Open['inZone'] {
    return world => dist(world.hero, state.center) <= world.params.sapperRadius + heroRadius(world.params);
  }

  private resolveSappers(world: World): void {
    const live = new Map(world.blasts.filter(b => b.source === 'blast').map(b => [b.id, b]));
    // A blast of a fuse burning now: it continues the warning of its owner (lit by touch, then killed) or is a new one.
    for (const b of live.values()) {
      if (this.seenBlast.has(b.id)) continue;
      this.seenBlast.add(b.id);
      const owned = [...this.sapperOwner.entries()].find(([, s]) => s.owner === b.ownerId && s.blast === null);
      if (owned) { owned[1].blast = b.id; owned[1].center = { x: b.x, y: b.y }; continue; }
      if (world.status !== 'playing' || dist(world.hero, b) > b.radius + heroRadius(world.params)) { this.quiet.set(b.id, { owner: b.ownerId, at: { x: b.x, y: b.y } }); continue; }
      const state = { owner: b.ownerId, blast: b.id, center: { x: b.x, y: b.y } };
      const o = this.add('sapper', [b.ownerId], world, this.sapperZone(state));
      this.sapperOwner.set(o, state);
    }
    for (const o of this.kindOpen('sapper')) {
      const s = this.sapperOwner.get(o)!;
      if (s.blast !== null && live.has(s.blast)) continue;
      if (s.blast === null) {
        const e = this.enemies.get(s.owner);
        if (e) { s.center = { x: e.x, y: e.y }; continue; }
        // The owner is gone: its own blast went off now, or a death without a blast (a cliff, the end).
        if (this.hitBy([s.owner], 'blast')) { this.takeBlast(s.center); this.endSapper(o, world, 'hit'); continue; }
        if (this.kills.get(s.owner) !== undefined && this.takeBlast(s.center)) { this.endSapper(o, world, o.inZone(world) ? 'shielded' : 'dodged'); continue; }
        this.endSapper(o, world, 'interrupted', world.status !== 'playing' ? 'end' : this.kills.has(s.owner) ? 'fall' : 'dead');
        continue;
      }
      // The fuse of the dead sapper burnt out.
      if (this.hitBy([s.owner], 'blast')) { this.takeBlast(s.center); this.endSapper(o, world, 'hit'); continue; }
      if (this.takeBlast(s.center)) this.endSapper(o, world, o.inZone(world) ? 'shielded' : 'dodged');
      else this.endSapper(o, world, 'interrupted', 'end');
    }
    // A fuse that burnt out with the hero out of its circle at its start: its blast is no warning, not an instant one either.
    for (const [id, q] of [...this.quiet]) {
      if (live.has(id)) continue;
      this.quiet.delete(id);
      this.hitBy([q.owner], 'blast');
      this.takeBlast(q.at);
    }
    // Blasts nothing announced (a fuse of 0): «без предупреждения», counted when the hero was in the circle.
    for (const at of this.blasts) {
      const hit = this.hitBy(this.hits.map(h => h.enemyId), 'blast');
      if (!hit && dist(world.hero, at) > world.params.sapperRadius + heroRadius(world.params)) continue;
      const o = this.add('sapper-instant', [], world, () => null);
      this.close(o, world, hit ? 'hit' : 'shielded');
    }
    this.blasts = [];
  }

  private endSapper(o: Open, world: World, outcome: ThreatOutcome, reason?: string): void {
    this.close(o, world, outcome, reason);
    this.sapperOwner.delete(o);
  }

  // ---- Task 28: the Jailer's «Кистень» and «Бросок гири» ----

  /** The zone of the move the core `core` winds up now (fixed at the windup's start), or null — none of the two. */
  private bossZone(world: World, core: Enemy): Open['inZone'] | null {
    const m = jailerMove(world, core);
    if (!m || (m.move !== 'flail' && m.move !== 'throw')) return null;
    const hr = heroRadius(world.params), at = { ...m.at }, r = m.r;
    if (m.move === 'throw') return w => dist(w.hero, at) <= r + hr;
    const dir = m.dir ?? 0;
    return w => inFlail(at, dir, w.hero, hr);
  }

  /** Task 43: the bolts — a shot closes its warning; a crossbow gone without its shot interrupts it; a new aim opens one. */
  private resolveBolts(world: World): void {
    for (const shot of this.boltShots) {
      const o = this.boltOpen.get(shot.id);
      if (!o) continue;
      this.boltOpen.delete(shot.id);
      if (shot.hit === 'hero' && (this.hitBy([shot.id], 'bolt') || this.hitBy([shot.id], 'castellan-bolt'))) this.close(o, world, 'hit');
      else if (shot.hit === 'hero') this.close(o, world, 'shielded');
      else this.close(o, world, 'dodged', shot.hit === 'enemy' ? 'body' : undefined);
    }
    for (const [id, o] of this.boltOpen) if (!this.enemies.has(id)) { this.boltOpen.delete(id); this.close(o, world, 'interrupted', 'dead'); }
    for (const aim of this.boltAims) {
      const r = BOLT_HALF + heroRadius(world.params), dx = aim.x1 - aim.x0, dy = aim.y1 - aim.y0, len = Math.hypot(dx, dy) || 1;
      const zone = (w: World): boolean => rayDistance({ x: aim.x0, y: aim.y0 }, dx / len, dy / len, len, w.hero) <= r;
      if (zone(world)) this.boltOpen.set(aim.id, this.add('bolt', [aim.id], world, zone));
    }
  }

  private resolveBoss(world: World): void {
    for (const kind of ['flail', 'throw'] as const) {
      for (const o of this.kindOpen(kind)) {
        const id = o.w.enemies[0], core = this.enemies.get(id);
        if (this.hitBy([id], kind)) { this.close(o, world, 'hit'); continue; }
        if (this.bossHits.some(h => h.id === id && h.move === kind)) { this.close(o, world, o.inZone(world) ? 'shielded' : 'dodged'); continue; }
        if (!core) { this.close(o, world, 'interrupted', 'dead'); continue; }
        if (world.status !== 'playing') { this.close(o, world, 'interrupted', 'end'); continue; }
        // The move is still winding up; dropped (the weight severed) — interrupted.
        if (jailerMove(world, core)?.move !== kind) this.close(o, world, 'interrupted', 'dropped');
      }
    }
    // New windups with the hero's body in the zone.
    if (world.status !== 'playing') return;
    for (const start of this.bossStarts) {
      if (start.move !== 'flail' && start.move !== 'throw') continue;
      const core = this.enemies.get(start.id);
      if (!core || core.kind !== JAILER) continue;
      const zone = this.bossZone(world, core);
      if (zone?.(world)) this.add(start.move, [core.id], world, zone);
    }
  }

  // ---- Task 43: the knight's «Рывок» and «Размах» ----

  /** The zone of the move the knight `e` runs now: the rest of the charge's lane, or the swing's circle; null — none. */
  private knightZone(world: World, e: Enemy, move: string): Open['inZone'] | null {
    const id = e.id, hr = heroRadius(world.params);
    if (move === 'charge') {
      if (!knightLane(e)) return null;
      return w => {
        const k = this.enemies.get(id), lane = k ? knightLane(k) : null;
        if (!k || !lane) return null;
        return rayDistance(k, lane.dx, lane.dy, lane.charging ? lane.len : dist(k, lane.to), w.hero) <= KNIGHT_LANE_WIDTH / 2 + hr;
      };
    }
    const swing = knightSwing(world, e);
    if (!swing) return null;
    return w => {
      const k = this.enemies.get(id), s = k ? knightSwing(w, k) : null;
      return s ? dist(w.hero, s) <= s.r + hr : null;
    };
  }

  private resolveKnights(world: World): void {
    for (const [kind, move, source] of [['knight-charge', 'charge', KNIGHT_CHARGE_SOURCE], ['knight-swing', 'swing', KNIGHT_SWING_SOURCE]] as const) {
      for (const o of this.kindOpen(kind)) {
        const id = o.w.enemies[0], e = this.enemies.get(id);
        if (this.hitBy([id], source)) { this.close(o, world, 'hit'); this.knightPassed.delete(o); continue; }
        if (e && move === 'charge' && e.vars.hh) this.knightPassed.add(o);
        if (this.knightEnds.some(x => x.id === id && x.move === move)) {
          if (move === 'charge') this.close(o, world, this.knightPassed.has(o) ? 'shielded' : 'dodged', this.knightPassed.has(o) ? 'move' : undefined);
          else this.close(o, world, o.inZone(world) ? 'shielded' : 'dodged');
          this.knightPassed.delete(o);
          continue;
        }
        if (!e) { this.close(o, world, 'interrupted', 'dead'); this.knightPassed.delete(o); continue; }
        if (world.status !== 'playing') { this.close(o, world, 'interrupted', 'end'); this.knightPassed.delete(o); }
      }
    }
    if (world.status !== 'playing') return;
    for (const start of this.knightStarts) {
      const e = this.enemies.get(start.id);
      if (!e) continue;
      const zone = this.knightZone(world, e, start.move);
      if (zone?.(world)) this.add(start.move === 'charge' ? 'knight-charge' : 'knight-swing', [e.id], world, zone);
    }
  }

  // ---- Task 57а: the forest shooters ----

  private resolveForest(world: World): void {
    for (const [id, v] of this.volleyOpen) {
      const done = (outcome: ThreatOutcome, reason?: string): void => { this.volleyOpen.delete(id); this.close(v.o, world, outcome, reason); };
      if (this.hitBy([id], v.source)) { done('hit'); continue; }
      if (!v.shots) {
        if (this.shooterEvents.some(e => e.action === 'loose' && e.id === id)) {
          const taken = new Set([...this.volleyOpen.values()].flatMap(x => (x.shots ? [...x.shots] : [])));
          v.shots = new Set((world.shots ?? []).filter(s => s.owner === id && !taken.has(s.id)).map(s => s.id));
        } else if (!this.enemies.has(id)) { done('interrupted', 'dead'); continue; }
        else if (world.status !== 'playing') { done('interrupted', 'end'); continue; }
        else continue;
      }
      const shots = v.shots;
      if (this.shotEnds.some(e => e.action === 'block' && shots.has(e.id))) { done('shielded'); continue; }
      if (this.shotEnds.some(e => e.action === 'snuff' && shots.has(e.id))) v.snuffed = true;
      // Design 17.10.2026: the hanging ring went out with its dead hive (`by: 'owner'`) — interrupted, as a shooter dead before its volley.
      if (this.shotEnds.some(e => e.by === 'owner' && shots.has(e.id))) { done('interrupted', 'dead'); continue; }
      if (world.status !== 'playing') { done('interrupted', 'end'); continue; }
      if (!(world.shots ?? []).some(s => shots.has(s.id))) done('dodged', v.snuffed ? 'snuff' : undefined);
    }
    for (const [id, o] of this.wispOpen) {
      const out = this.wispEvents.find(e => e.action === 'out' && e.id === id);
      const done = (outcome: ThreatOutcome, reason?: string): void => { this.wispOpen.delete(id); this.close(o, world, outcome, reason); };
      if (out?.why === 'touch') { this.hitBy([id], 'wisp'); done('hit'); }
      else if (out?.why === 'block') done('shielded');
      else if (out) done('dodged');
      else if (!this.enemies.has(id)) done('interrupted', 'dead');
      else if (world.status !== 'playing') done('interrupted', 'end');
    }
    if (world.status !== 'playing') return;
    const hr = heroRadius(world.params);
    for (const ev of this.shooterEvents) {
      if (ev.action !== 'aim') continue;
      let zone: Open['inZone'] | null = null;
      if (ev.lines) {
        const lines = ev.lines.map(l => { const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) || 1; return { from: { x: l.x0, y: l.y0 }, dx: (l.x1 - l.x0) / len, dy: (l.y1 - l.y0) / len, len }; });
        zone = w => lines.some(l => rayDistance(l.from, l.dx, l.dy, l.len, w.hero) <= STONE_RADIUS + hr);
      } else if (ev.points) {
        const reach = WASP_LIFE * (world.params.hiveSpeed ?? HIVE_SPEED), at = { x: ev.x, y: ev.y };
        const rays = ev.points.map(p => { const len = Math.hypot(p.x - at.x, p.y - at.y) || 1; return { from: { x: p.x, y: p.y }, dx: (p.x - at.x) / len, dy: (p.y - at.y) / len }; });
        zone = w => rays.some(r => rayDistance(r.from, r.dx, r.dy, reach, w.hero) <= WASP_RADIUS + hr);
      }
      if (zone?.(world)) this.volleyOpen.set(ev.id, { o: this.add(ev.lines ? 'sling' : 'hive', [ev.id], world, zone), source: ev.lines ? 'stone' : 'wasp', shots: null, snuffed: false });
    }
    for (const ev of this.wispEvents) if (ev.action === 'lit') this.wispOpen.set(ev.id, this.add('wisp', [ev.id], world, () => true));
    this.resolveCentipedes(world);
  }

  // ---- Task 57б-2: the centipede's «Рывок» ----

  private resolveCentipedes(world: World): void {
    for (const [id, o] of this.centiOpen) {
      const done = (outcome: ThreatOutcome, reason?: string): void => { this.centiOpen.delete(id); this.close(o, world, outcome, reason); };
      if (this.hitBy([id], CENTI_LUNGE_SOURCE)) { done('hit'); continue; }
      const end = this.centiEvents.find(e => e.action === 'lunge' && e.stage === 'end' && e.id === id);
      if (end && end.action === 'lunge') { done(end.met === 'block' || end.met === 'pass' ? 'shielded' : 'dodged', end.met === 'pass' ? 'move' : undefined); continue; }
      if (!this.enemies.has(id)) { done('interrupted', 'dead'); continue; }
      if (world.status !== 'playing') done('interrupted', 'end');
    }
    if (world.status !== 'playing') return;
    const hr = heroRadius(world.params);
    for (const ev of this.centiEvents) {
      if (ev.action !== 'lunge' || ev.stage !== 'start') continue;
      const id = ev.id;
      const zone: Open['inZone'] = w => {
        const k = this.enemies.get(id), lane = k ? centipedeLane(w, k) : null;
        return k && lane ? rayDistance(k, lane.dx, lane.dy, lane.len, w.hero) <= CENTI_LANE_WIDTH / 2 + hr : null;
      };
      if (zone(world)) this.centiOpen.set(id, this.add('centipede-lunge', [id], world, zone));
    }
  }

  // ---- New warnings ----

  private openNew(world: World): void {
    const howling: Enemy[] = [];
    for (const e of world.enemies) {
      switch (e.kind) {
        case 'archer': {
          if (e.vars.aim !== 1) { this.seenArcher.delete(e.id); break; }
          if (this.seenArcher.has(e.id)) break;
          this.seenArcher.add(e.id);
          const zone = this.archerZone(world, e);
          if (zone?.(world)) this.add('archer', [e.id], world, zone);
          break;
        }
        case 'boar': {
          if (e.boar !== 'windup' && e.boar !== 'charge') { this.seenBoar.delete(e.id); break; }
          if (this.seenBoar.has(e.id)) break;
          this.seenBoar.add(e.id);
          const zone = this.boarZone(e);
          if (zone(world)) this.add('boar', [e.id], world, zone);
          break;
        }
        case 'lynx': {
          if (e.vars.st !== LYNX_WINDUP && e.vars.st !== LYNX_LEAP) { this.seenLynx.delete(e.id); break; }
          if (this.seenLynx.has(e.id)) break;
          this.seenLynx.add(e.id);
          const zone = this.lynxZone(e);
          if (zone(world)) this.add('lynx', [e.id], world, zone);
          break;
        }
        case 'wolf': {
          const st = e.vars.st ?? 0;
          if (st !== WOLF_HOWL && st !== WOLF_RUSH) { this.seenWolf.delete(e.id); break; }
          if (!this.seenWolf.has(e.id)) { this.seenWolf.add(e.id); if (st === WOLF_HOWL) howling.push(e); }
          break;
        }
        case 'sapper': {
          if (e.vars.lit !== 1 || e.vars.exploded === 1 || this.seenSapper.has(e.id)) break;
          this.seenSapper.add(e.id);
          const state = { owner: e.id, blast: null, center: { x: e.x, y: e.y } };
          const zone = this.sapperZone(state);
          if (!zone(world)) break;
          const o = this.add('sapper', [e.id], world, zone);
          this.sapperOwner.set(o, state);
          break;
        }
        default: break;
      }
    }
    if (howling.length) {
      // The wolves that started to howl in this tick — one pack (the ring starts at most one howl a tick).
      const ids = howling.map(e => e.id), zone = this.wolfZone(ids);
      if (zone(world)) {
        const o = this.add('wolf', ids, world, zone);
        this.packs.set(o, new Map(ids.map(id => [id, 'howl' as const])));
      }
    }
  }
}
