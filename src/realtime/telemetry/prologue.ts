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
import type { PrologueFrom, PrologueOutcome, PrologueRecord, PrologueRoomTally } from './schema';

/** The record without its header (`roomCount` — the rooms of the prologue now, task 13: 10). */
export type PrologueBody = Pick<PrologueRecord, 'from' | 'outcome' | 'skipRoom' | 'rooms'> & { roomCount: number; endedAt?: string };

/** How a room ended in the view's hooks (`RoomOutcome` of view/prologueFlow.ts). */
export type PrologueRoomEnd = 'win' | 'death' | 'skip';

const round2 = (x: number): number => Math.round(x * 100) / 100;

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
      rooms: b.rooms.map(r => ({ ...r, gameSeconds: round2(r.gameSeconds), realSeconds: round2(r.realSeconds) })), roomCount: b.roomCount,
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
