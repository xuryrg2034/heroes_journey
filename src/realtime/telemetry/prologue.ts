/**
 * The prologue's telemetry (task 6, step 5, 13.10.2026; docs/realtime-telemetry.md, «Пролог»): one light record per playthrough
 * of the prologue «Опушка» — per room the time (game and real seconds), the attempts (deaths, returns of the enemies), the ghost
 * hand and the arrow shown; the skip (its room) or the end; where it was started (the first launch, the gear's «Обучение»). No
 * fight journals: the rooms' determinism is checked by the Node tests of `run/prologue.ts`.
 *
 * `PrologueTally` takes the points of the view's `PrologueHooks` (view/prologueFlow.ts) and hands the record's body to `write`
 * (the recorder puts it into the buffer under one id; the last copy wins). Pure: no DOM, no clock but the `now` given.
 */
import { PROLOGUE_ROOM_COUNT } from '../run/prologue';
import { bustInside, type World, type WorldEvent } from '../sim/world';
import type { PrologueBust, PrologueFrom, PrologueOutcome, PrologueRecord, PrologueRoomTally } from './schema';

/** The record without its header (`roomCount` — the rooms of the prologue now, task 13: 10). */
export type PrologueBody = Pick<PrologueRecord, 'from' | 'outcome' | 'skipRoom' | 'rooms'> & { roomCount: number; endedAt?: string };

/** How a room ended in the view's hooks (`RoomOutcome` of view/prologueFlow.ts). */
export type PrologueRoomEnd = 'win' | 'death' | 'skip';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Task 24 «Урок перебора» (design 15.10.2026; room 8 «Гоблин»): the show bust of the room seen by the view's frames — whether the
 * hero stood in the circle when the idol lit, when he left it for good, and what the blast took. `read` every frame with the
 * frame's events (before they go; the view's `PrologueHooks.frame`): frame-precise, not tick-precise (the prologue keeps no
 * journals). Returns the bust it closed (its blast went off), else null; `end` closes an open one when the room ends.
 */
export class PrologueBustWatch {
  private open: { blastId: number; t0: number; inside: boolean; inNow: boolean; out: number | null } | null = null;

  read(world: World, events: readonly WorldEvent[]): PrologueBust | null {
    const o = this.open;
    // The hero against the burning circle at this frame (before this frame's events: a blast in them took it away).
    if (o) {
      const b = world.blasts.find(x => x.id === o.blastId);
      if (b) {
        const inNow = bustInside(world, b);
        if (o.inNow && !inNow) o.out = round2(world.time - o.t0);
        else if (!o.inNow && inNow) o.out = null;
        o.inNow = inNow;
      }
    }
    for (const ev of events) {
      if (ev.type !== 'slot') continue;
      if (ev.action === 'lit' && ev.blastId !== undefined) {
        const b = world.blasts.find(x => x.id === ev.blastId), inside = !!b && bustInside(world, b);
        this.open = { blastId: ev.blastId, t0: world.time, inside, inNow: inside, out: null };
      } else if (ev.action === 'blast' && this.open) {
        const at = this.open, damage = events.filter(e => e.type === 'hit' && e.source === 'slot-bust').reduce((n, e) => n + (e.type === 'hit' ? e.damage : 0), 0);
        this.open = null;
        return { inside: at.inside, outAfter: at.inside && ev.inside === false ? at.out : null, damage };
      }
    }
    return null;
  }

  /** The room ended (won, died, skipped) with the fuse still burning: the bust without its blast; null — none open. */
  end(): PrologueBust | null {
    const o = this.open;
    this.open = null;
    return o ? { inside: o.inside, outAfter: null, damage: null } : null;
  }
}

export class PrologueTally {
  private readonly body: PrologueBody;
  private ended = false;

  constructor(from: PrologueFrom, private readonly write: (body: PrologueBody) => void, private readonly now: () => string = () => new Date().toISOString()) {
    this.body = { from, outcome: 'open', skipRoom: null, rooms: [], roomCount: PROLOGUE_ROOM_COUNT };
  }

  /** The record's body now (a copy; seconds rounded to 0.01). */
  snapshot(): PrologueBody {
    const b = this.body;
    return {
      from: b.from, outcome: b.outcome, skipRoom: b.skipRoom,
      rooms: b.rooms.map(r => ({ ...r, gameSeconds: round2(r.gameSeconds), realSeconds: round2(r.realSeconds), ...r.busts ? { busts: r.busts.map(x => ({ ...x })) } : {} })), roomCount: b.roomCount,
      ...b.endedAt ? { endedAt: b.endedAt } : {},
    };
  }

  private flush(): void { this.write(this.snapshot()); }

  private room(n: number): PrologueRoomTally {
    let r = this.body.rooms.find(x => x.room === n);
    if (!r) { r = { room: n, attempts: 0, deaths: 0, restores: 0, gameSeconds: 0, realSeconds: 0, hands: 0, arrows: 0, outcome: 'open' }; this.body.rooms.push(r); }
    return r;
  }

  /** A room starts (`attempt` from 1; a death plays it again with the next one). */
  roomStart(n: number, attempt: number): void {
    if (this.ended) return;
    const r = this.room(n);
    r.attempts = Math.max(r.attempts + 1, attempt);
    r.outcome = 'open';
    this.flush();
  }

  /** An attempt ends: won, died, or skipped; `game` and `real` — its seconds. */
  roomEnd(n: number, outcome: PrologueRoomEnd, game: number, real: number): void {
    if (this.ended) return;
    const r = this.room(n);
    r.gameSeconds += Math.max(0, game); r.realSeconds += Math.max(0, real);
    // Task 24: a show bust whose fuse still burned when the room ended.
    const open = this.bustWatch.end();
    if (open) (r.busts ??= []).push(open);
    if (outcome === 'death') r.deaths++;
    r.outcome = outcome === 'death' ? 'open' : outcome;
    this.flush();
  }

  /** The ghost hand (`hand`) or the arrow with the circle (`arrow`) came. Written with the room's end. */
  shown(n: number, kind: 'hand' | 'arrow'): void {
    if (this.ended) return;
    const r = this.room(n);
    if (kind === 'hand') r.hands++; else r.arrows++;
  }

  /**
   * Task 24: a frame of room `n` — its world and the frame's events (before the view clears them); the room's show busts go into
   * its tally (`PrologueRoomTally.busts`). Written with the room's end.
   */
  frame(n: number, world: World, events: readonly WorldEvent[]): void {
    if (this.ended) return;
    const bust = this.bustWatch.read(world, events);
    if (bust) (this.room(n).busts ??= []).push(bust);
  }
  private readonly bustWatch = new PrologueBustWatch();

  /** The start enemies came back (event `restore`). Written with the room's end. */
  restore(n: number): void { if (!this.ended) this.room(n).restores++; }

  /** «Пропустить обучение» in room `n`. */
  skip(n: number): void { if (!this.ended) this.body.skipRoom = n; }

  /** The playthrough ends: the last room won (`done`) or skipped. Later calls change nothing. */
  end(how: Exclude<PrologueOutcome, 'open'>): void {
    if (this.ended) return;
    this.body.outcome = how;
    this.body.endedAt = this.now();
    this.ended = true;
    this.flush();
  }
}
