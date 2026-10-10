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
 *   points at the hero (the hero is in it within `wolfRushRange`); at the end of the howl the line is fixed and the wolf
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
 *
 * Outcomes: `hit` — a strike of this enemy by this source; `shielded` — the body in the zone on the strike tick but not
 * hurt (invulnerability, the chain's shield, a dash, a jump, the focus spare: decision 12); `dodged` — the body out of the
 * zone on the strike tick; `interrupted` — the enemy died, was knocked back, dropped its attack, or the fight ended (the
 * cold is not an outcome: a frozen archer, boar, lynx or sapper waits). Exit time — ticks from the appearance (the zone
 * fixed; for the wolf — the start of the howl) to the first tick with the body out of the zone, also in game and real
 * seconds.
 */
import { archerLine, archerMark } from '../sim/enemies/archer';
import { WOLF_HOWL, WOLF_RUSH } from '../sim/enemies/wolf';
import { LYNX_LEAP, LYNX_STUN, LYNX_WINDUP } from '../sim/enemies/lynx';
import { blockedAt, cliffAt, dist, type Vec } from '../sim/geometry';
import { bodyRadiusOf } from '../sim/enemies/kinds';
import { heroRadius } from '../sim/params';
import { SIM_DT } from '../sim/simulation';
import { CONTACT_SLACK, enemyFrozen, touchDistanceOf, type Enemy, type World } from '../sim/world';
import { EventCursor } from './observe';
import type { ThreatTally } from './schema';

export type ThreatKind = 'archer' | 'boar' | 'wolf' | 'lynx' | 'sapper' | 'sapper-instant';
export const THREAT_KINDS: readonly ThreatKind[] = ['archer', 'boar', 'wolf', 'lynx', 'sapper', 'sapper-instant'];
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

/** Reach of an enemy's body to the hero's (the touch of world.ts with its slack). */
const reachOf = (world: World, e: Enemy): number => touchDistanceOf(world.params, e) + CONTACT_SLACK;

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
  /** Hits already explained by a warning of this tick. */
  private used = new Set<Hit>();

  constructor(world: World) {
    this.boarHits = world.stats.boarHits;
    this.cursor.read(world, () => { /* events before the start are not this fight's */ });
  }

  /** After a tick; `realDt` — the real seconds it stood for (`Simulation.nextTickCost()` before it). */
  tick(world: World, realDt: number = SIM_DT): void {
    this.real += realDt;
    this.hits = []; this.kills.clear(); this.blasts = []; this.used.clear();
    this.cursor.read(world, ev => {
      if (ev.type === 'hit') this.hits.push({ enemyId: ev.enemyId, source: ev.source });
      else if (ev.type === 'kill') this.kills.set(ev.enemyId, ev.source ?? '');
      else if (ev.type === 'blast' && ev.source === 'blast') this.blasts.push({ x: ev.x, y: ev.y });
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
    if (world.status !== 'playing') for (const o of [...this.open]) this.close(o, world, 'interrupted', 'end');
    else this.openNew(world);
    this.wolfState = new Map(world.enemies.filter(e => e.kind === 'wolf').map(e => [e.id, e.vars.st ?? 0]));
    this.wolfRan = new Map(world.enemies.filter(e => e.kind === 'wolf' && e.vars.st === WOLF_RUSH).map(e => [e.id, e.vars.ran ?? 0]));
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
  /** Distance each rushing wolf had run at the end of the last tick (a rush that ends short of its range hit a wall). */
  private wolfRan = new Map<number, number>();

  private wolfZone(members: readonly number[]): Open['inZone'] {
    return world => {
      const p = world.params;
      let any = false;
      for (const id of members) {
        const e = this.enemies.get(id);
        if (!e) continue;
        const st = e.vars.st ?? 0, reach = reachOf(world, e);
        if (st === WOLF_HOWL) { any = true; if (dist(e, world.hero) <= p.wolfRushRange + reach) return true; }
        else if (st === WOLF_RUSH) {
          any = true;
          if (rayDistance(e, e.vars.dx ?? 1, e.vars.dy ?? 0, Math.max(0, p.wolfRushRange - (e.vars.ran ?? 0)), world.hero) <= reach) return true;
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
          const p = world.params, short = (this.wolfRan.get(id) ?? 0) + p.wolfRushSpeed * SIM_DT < p.wolfRushRange - 1e-6;
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
