/**
 * World labels (task 6, 12.10.2026; docs/realtime-onboarding.md): a short verb or price AT an object of the arena, instead of the
 * box of hints at the bottom. A view feature only: it reads the world and its events, never changes them, is not a Param and
 * never in the journal, the hash or the run save.
 *
 * - **Rules of a label** — at most 4 words (the chest's price is the exception the design named), at a world point with an
 *   offset (it moves with the camera), one label per object, ONE per id on screen, stays until the player does the action it
 *   names (not on a timer), and is shown once per viewer: the action marks the id in the viewer's memory (`HintStore`).
 * - **Pure part** (testable in Node, `npm run test:realtime-hints`): `detectLabels` (what stands now), `labelActions` (what was
 *   done in the frame, from the frame's events — read BEFORE main.ts clears them), `placeLabel` (where the box goes).
 * - **DOM part** — `WorldLabelLayer`: absolutely positioned elements over the stage; they never take the pointer. It will also
 *   serve the prologue's labels («Зажми и веди», «Цвет свободен», «Закончи цепь здесь»).
 * - The numbers in the texts come from the code (`sim/chest.ts`), not from literals.
 */
import type { Vec } from '../sim/geometry';
import type { Enemy, World } from '../sim/world';
import { CHEST_CURSE_KILLS, CHEST_CURSE_TOUCH } from '../sim/chest';
import { OBJECT_RADIUS } from '../sim/chain';
import { leverOf } from '../sim/slot';
import { BUILD_SOURCES } from '../sim/buildIds';
import { KNIGHT } from '../sim/enemies/garrison';
import { ROCK_RADIUS, TAIL_OUTER, TROLL } from '../sim/enemies/troll';
import { BARREL, wardrobeTopple } from '../sim/enemies/castle';
import { CHIEF, chiefMove } from '../sim/enemies/chief';
import { RECRUIT, recruitCurrent, recruitGroup } from '../sim/enemies/recruit';
import { WARDEN, wardenPartner } from '../sim/enemies/warden';
import { pitchMarkRadius, potsInFlight } from '../sim/pitch';

/** The three labels of the run (the ids are the v1 hints' Б6, Б8, Б9: the memory and the run record keep their keys). */
export type LabelId = 'b6' | 'b8' | 'b9' | OmenLabelId;
/** Task 56 «Приметы»: the first-meeting labels of the omens that show something in the fight (spec 6, «Подписи у места»). */
export type OmenLabelId = 'omen-storm' | 'omen-flood' | 'omen-drowse' | 'omen-rollcall' | 'omen-harvest';
/** A label to show: its id, text, the world point of its object and where it hangs relative to it. */
export interface LabelSpec {
  id: string;
  text: string;
  /** The object's point (arena units). */
  at: Vec;
  /** 'above' — centred over the point, `lift` arena units up; 'below' — centred under it, `lift` units down (over it when there is no room under: the elite's tags and chips hang over it and under it, so the label stands clear of both); 'side' — to the right of it (to the left when the right edge is near), `lift` units away. */
  place: 'above' | 'below' | 'side';
  lift: number;
  /** 'side' only: a point (arena units) the label keeps away from — it stands on the other side of `at` when there is room (the door by the goblin, design 13.10.2026). */
  away?: Vec;
  /** A point (arena units) the label's tail points at (the lever's knob); none — no tail. */
  tail?: Vec;
}

export const LABEL_TEXT = {
  /** Б6: an armoured elite — its plate takes one hit. */
  elite: 'Пластина — 1 удар',
  /** Б9: the goblin's lever. */
  lever: 'Закончи цепь здесь',
  /** Task 40: the keymaster's prisoner (design 16.10.2026: the rule in the label — the chain across the shackle first). */
  shackle: 'В кандалах — сначала разруби',
  /** Task 41: the prisoner the player's dash set loose riots (design 16.10.2026: a flash over it, once a run). */
  riot: 'На волю!',
  /** Task 59а (spec 8): the first mark of a pitcher's pot, the first line of recruits, the first pair of wardens. */
  pitch: 'Уйди с метки',
  recruits: 'По номерам: 1, 2, 3, 4',
  wardens: 'Обоих — одной цепью',
} as const;
/** Task 56 (spec 6, ≤ 4 words each): the omens' labels — at the mark, at the pool, at the first sleeper, at the first horned enemy, at the sack. */
export const OMEN_LABEL_TEXT: Readonly<Record<OmenLabelId, string>> = {
  'omen-storm': 'Заведи толпу',
  'omen-flood': 'Мокрым +1',
  'omen-drowse': 'Спят до цепи',
  'omen-rollcall': 'Цвет зовут',
  'omen-harvest': 'Удар — всё сначала',
};
/** Б8: the price of the chest of «Застава», both numbers read from `sim/chest.ts`. */
export const chestText = (): string => `+${CHEST_CURSE_TOUCH} урон касания, ${CHEST_CURSE_KILLS} убийств`;

/** Arena units: how high above an elite's centre the label hangs; above the chest; how far the goblin's label stands from the idol's centre. */
/** Task 11: arena units from the idol's centre to the near edge of the lever's label — and of the odds line when it stands beside the idol (slotView.ts), so the two make one column. */
export const BESIDE_UNITS = 1.15;
const ELITE_LIFT = 1.0, CHEST_LIFT = 0.85, LEVER_SIDE = BESIDE_UNITS;
/** Task 11: arena units the lever's label rises when it stands over the odds line beside the idol (one column, design 13.10.2026). */
export const LEVER_OVER_LINE = 0.35;

/**
 * The labels whose object stands now: an armoured enemy with plates left in view (the nearest to the hero — one label for all
 * the elites), the chest in view, the goblin's lever in view. `onScreen` is the camera's view (renderer.sees). The caller drops
 * the ids the viewer has done.
 */
export function detectLabels(w: World, onScreen: (p: Vec) => boolean): LabelSpec[] {
  const out: LabelSpec[] = [];
  let elite: typeof w.enemies[number] | null = null, best = Infinity;
  for (const e of w.enemies) {
    // Task 43: the knight in armour is not an elite (one name — one meaning): no «Пластина» label over it either.
    if (e.kind === KNIGHT || !e.armor || e.armor.plates <= 0 || !onScreen(e)) continue;
    const d = (e.x - w.hero.x) ** 2 + (e.y - w.hero.y) ** 2;
    if (d < best) { best = d; elite = e; }
  }
  if (elite) out.push({ id: 'b6', text: LABEL_TEXT.elite, at: { x: elite.x, y: elite.y }, place: 'below', lift: ELITE_LIFT });
  const chest = w.objects.find(o => o.kind === 'chest' && onScreen(o));
  if (chest) out.push({ id: 'b8', text: chestText(), at: { x: chest.x, y: chest.y }, place: 'above', lift: CHEST_LIFT });
  const lever = leverOf(w);
  if (lever && onScreen(lever)) {
    // Design 13.10.2026 (task 11 shots): the label read as the door's when the door stood beside it — it stands on the idol's side
    // away from the door, and its tail points at the lever's red knob (slotView.ts `drawIdol`: 1.07 object radii right of the idol).
    const door = w.objects.find(o => o.kind === 'door');
    out.push({ id: 'b9', text: LABEL_TEXT.lever, at: { x: lever.x, y: lever.y }, place: 'side', lift: LEVER_SIDE, ...door ? { away: { x: door.x, y: door.y } } : {}, tail: leverKnob(lever) });
  }
  return out;
}

/**
 * Task 56 «Приметы» (spec 6): the omens' labels whose object stands now — «Заведи толпу» at the storm's mark, «Мокрым +1» at the
 * nearest pool in view, «Спят до цепи» over the nearest sleeper, «Цвет зовут» over the nearest enemy of the called colour, «Удар — всё
 * сначала» at the sack (the omen «Урожай»: `bagResetAll`). The caller drops the ids the viewer has done (`omenLabelActions`).
 */
export function omenLabels(w: World, onScreen: (p: Vec) => boolean): LabelSpec[] {
  const out: LabelSpec[] = [];
  const near = <T extends Vec>(list: readonly T[]): T | null => {
    let best: T | null = null, d = Infinity;
    for (const e of list) { if (!onScreen(e)) continue; const de = (e.x - w.hero.x) ** 2 + (e.y - w.hero.y) ** 2; if (de < d) { d = de; best = e; } }
    return best;
  };
  const mark = w.storm?.mark;
  if (mark && onScreen(mark)) out.push({ id: 'omen-storm', text: OMEN_LABEL_TEXT['omen-storm'], at: { x: mark.x, y: mark.y }, place: 'above', lift: (w.params.omenStormRadius || 1) + 0.25 });
  const pool = near(w.flood?.pools ?? []);
  if (pool) out.push({ id: 'omen-flood', text: OMEN_LABEL_TEXT['omen-flood'], at: { x: pool.x, y: pool.y }, place: 'above', lift: pool.r + 0.15 });
  const sleeper = near(w.enemies.filter(e => e.sleep));
  if (sleeper) out.push({ id: 'omen-drowse', text: OMEN_LABEL_TEXT['omen-drowse'], at: { x: sleeper.x, y: sleeper.y }, place: 'below', lift: 0.75 });
  const call = w.rollcall?.color;
  const horned = call === undefined ? null : near(w.enemies.filter(e => e.color === call));
  if (horned) out.push({ id: 'omen-rollcall', text: OMEN_LABEL_TEXT['omen-rollcall'], at: { x: horned.x, y: horned.y }, place: 'below', lift: 0.75 });
  return out;
}

/** «Удар — всё сначала» (the omen «Урожай»: `bagResetAll`) at the sack, whose point the bag's view knows (`BagView.shown`); null — no sack now. */
export function harvestLabel(w: World, sack: { visible: boolean; x: number; y: number }, onScreen: (p: Vec) => boolean): LabelSpec | null {
  const at = { x: sack.x, y: sack.y };
  return w.params.bagResetAll && sack.visible && onScreen(at) ? { id: 'omen-harvest', text: OMEN_LABEL_TEXT['omen-harvest'], at, place: 'side', lift: 0.9 } : null;
}

/** The lever's red knob (arena units): slotView.ts `drawIdol` draws it 1.07 object radii right of the idol's point, a little up. */
export function leverKnob(lever: Vec): Vec { return { x: lever.x + OBJECT_RADIUS * 1.07, y: lever.y - 0.1 }; }

/**
 * Task 28 «Тюремщик в походе» (design 15.10.2026, docs/design-notes/tasks-26-28.md; boss report 5.7, item 1): the name of a boss
 * move at its sign for `BOSS_LABEL_LIFE` real seconds, the first time the move starts in the fight (event `bossMove`, stage
 * 'start'). The Jailer's fight in a run is one (row 5; a death ends the run), so «first in the fight» is «first in the run» — no
 * field in the save. Unlike the labels above, it goes on a timer and marks no viewer memory. «Свисток» has no name label.
 * Task 48 (design 16.10.2026, spec 16): the Troll's five moves are named the same way — «Удар дубиной» at the lane's end, «Бросок
 * камня» over the rock's circle, «Хвост метёт» under the ring, «Рык» and «Храп» on his belly (the first start in the fight; no other text).
 */
export const BOSS_MOVE_TEXT = { flail: 'Кистень', throw: 'Бросок гири', club: 'Удар дубиной', rock: 'Бросок камня', tail: 'Хвост метёт', roar: 'Рык', snore: 'Храп' } as const;
/**
 * Task 54a «Главарь» (design 17.10.2026, docs/design-notes/task-54-chief.md, 17): the Chief's five moves, named the same way at their first start
 * in the fight: «Взмах половником» over the half-disc's far edge, «Горсть перца» over the middle circle, «Обед!» and «Приправа» over the cauldron,
 * «Свисток» over the gate's circle. Kept apart from `BOSS_MOVE_TEXT`: the Jailer's «Свисток» has no name label.
 */
export const CHIEF_MOVE_TEXT = { swing: 'Взмах половником', pepper: 'Горсть перца', feast: 'Обед!', season: 'Приправа', whistle: 'Свисток' } as const;
/** Arena units: how high over the Chief's feet «Взмах половником» hangs (over his head), and how far under the cauldron's centre «Обед!» and «Приправа» stand. */
const CHIEF_HEAD_LIFT = 2.4, CHIEF_POT_LIFT = 1.0;
/** Real seconds a boss move's name stays. */
export const BOSS_LABEL_LIFE = 1;
/** Arena units: how high over the core the flail's name hangs, and over the throw's circle (its radius is 1). */
const FLAIL_LABEL_LIFT = 1.1, THROW_LABEL_LIFT = 1.15;
/** Task 48: how high over the club's lane end its name hangs, and how far under the Troll's centre his belly's label stands (units). */
const TROLL_CLUB_LIFT = 0.9, TROLL_BELLY = 1.0;

/**
 * Task 55а (design 17.10.2026, spec 11): the castle's two moves are named the same way — «Падение шкафа» over the end of the fixed lane,
 * «Удар ладьи» over the rook — at the first windup of each in the fight. The same set `named` holds them (the keys cannot meet the boss moves').
 */
export const CASTLE_MOVE_TEXT = { topple: 'Падение шкафа', strike: 'Удар ладьи' } as const;
const TOPPLE_LABEL_LIFT = 0.9, ROOK_LABEL_LIFT = 1.1;

/**
 * Task 55 Д (design 17.10.2026, spec 11): the warlock's one move is named the same way — «Перенос» over the candle that lights, at the first
 * sign of the fight (`warlockShift` `mark`). The refusals «под чарами» and «вне окна» are the cursor's (`REFUSAL_TEXT`); no other text.
 */
export const WARLOCK_MOVE_TEXT = { shift: 'Перенос' } as const;
const SHIFT_LABEL_LIFT = 0.9;

/**
 * Task 55а (design 17.10.2026, spec 3.1): «Кончи цепь на бочке — покатится» over the first barrel of the run in view (the sandbox: of the
 * fight) for `BOSS_LABEL_LIFE` s; one label, no plate. The host keeps the once; null — no barrel in view.
 */
export const BARREL_LABEL_TEXT = 'Кончи цепь на бочке — покатится';
const BARREL_LABEL_LIFT = 0.8;
export function barrelLabel(w: World, onScreen: (p: Vec) => boolean): LabelSpec | null {
  const hero = w.hero;
  let best: Enemy | null = null, d = Infinity;
  for (const e of w.enemies) {
    if (e.kind !== BARREL || !onScreen(e)) continue;
    const de = (e.x - hero.x) ** 2 + (e.y - hero.y) ** 2;
    if (de < d) { d = de; best = e; }
  }
  return best ? { id: 'castle-barrel', text: BARREL_LABEL_TEXT, at: { x: best.x, y: best.y }, place: 'above', lift: BARREL_LABEL_LIFT } : null;
}

/** The names of the moves that start in this frame for the first time (`named` — the moves named in this fight; this adds to it). */
export function bossMoveLabels(w: World, named: Set<string>): LabelSpec[] {
  const out: LabelSpec[] = [];
  for (const ev of w.events) {
    if (ev.type === 'wardrobe' && ev.action === 'windup' && !named.has('topple')) {
      const e = w.enemies.find(x => x.id === ev.id), lane = e ? wardrobeTopple(w, e) : null;
      if (!lane) continue;
      named.add('topple');
      out.push({ id: 'castle-topple', text: CASTLE_MOVE_TEXT.topple, at: { x: lane.to.x, y: lane.to.y }, place: 'above', lift: TOPPLE_LABEL_LIFT });
      continue;
    }
    if (ev.type === 'rook' && ev.action === 'aim' && !named.has('strike')) {
      const e = w.enemies.find(x => x.id === ev.id);
      if (!e) continue;
      named.add('strike');
      out.push({ id: 'castle-strike', text: CASTLE_MOVE_TEXT.strike, at: { x: e.x, y: e.y }, place: 'above', lift: ROOK_LABEL_LIFT });
      continue;
    }
    if (ev.type === 'warlockShift' && ev.action === 'mark' && !named.has('shift')) {
      named.add('shift');
      out.push({ id: 'warlock-shift', text: WARLOCK_MOVE_TEXT.shift, at: { x: ev.x, y: ev.y }, place: 'above', lift: SHIFT_LABEL_LIFT });
      continue;
    }
    if (ev.type !== 'bossMove' || ev.stage !== 'start' || named.has(ev.move)) continue;
    const core = w.enemies.find(e => e.id === ev.id);
    if (!core) continue;
    if (core.kind === CHIEF) {
      const text = CHIEF_MOVE_TEXT[ev.move as keyof typeof CHIEF_MOVE_TEXT], m = chiefMove(w);
      if (!text || !m) continue;
      named.add(ev.move);
      // The core's head (the drawing is about 2.2 units tall), the pepper's centre and the gate's circle: above; the cauldron's moves: under it.
      const below = ev.move === 'feast' || ev.move === 'season';
      out.push({ id: `boss-${ev.move}`, text, at: { x: m.at.x, y: m.at.y }, place: below ? 'below' : 'above', lift: ev.move === 'swing' ? CHIEF_HEAD_LIFT : below ? CHIEF_POT_LIFT : m.r + 0.15 });
      continue;
    }
    if (!(ev.move in BOSS_MOVE_TEXT)) continue;
    named.add(ev.move);
    const text = BOSS_MOVE_TEXT[ev.move as keyof typeof BOSS_MOVE_TEXT];
    if (core.kind === TROLL) {
      const v = core.vars;
      if (ev.move === 'club' && v.bx !== undefined) out.push({ id: `boss-${ev.move}`, text, at: { x: v.bx, y: v.by }, place: 'above', lift: TROLL_CLUB_LIFT });
      else if (ev.move === 'rock' && v.ax !== undefined) out.push({ id: `boss-${ev.move}`, text, at: { x: v.ax, y: v.ay }, place: 'above', lift: ROCK_RADIUS + 0.15 });
      else if (ev.move === 'tail') out.push({ id: `boss-${ev.move}`, text, at: { x: core.x, y: core.y + TAIL_OUTER }, place: 'below', lift: 0.15 });
      else out.push({ id: `boss-${ev.move}`, text, at: { x: core.x, y: core.y + TROLL_BELLY }, place: 'below', lift: 0.2 });
      continue;
    }
    if (ev.move === 'throw' && core.vars.ax !== undefined) out.push({ id: `boss-${ev.move}`, text, at: { x: core.vars.ax, y: core.vars.ay }, place: 'above', lift: THROW_LABEL_LIFT });
    else out.push({ id: `boss-${ev.move}`, text, at: { x: core.x, y: core.y }, place: 'above', lift: FLAIL_LABEL_LIFT });
  }
  return out;
}

/** Arena units: how far under the prisoner's centre its label hangs (clear of its padlock over the drawing). */
const SHACKLE_LIFT = 0.8;

/**
 * Task 40 «Ключник» (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md, 2): «В кандалах — сначала разруби» under the
 * prisoner nearest to the hero in view — one label, no plate. The host shows it from the first shackle of the run (the event
 * `tether` `shackle`; the sandbox — of the fight) until the player's dash cuts a shackle (`shackleCut`); a label of the view only,
 * no Param, no journal. Null — no prisoner in view.
 */
export function shackleLabel(w: World, onScreen: (p: Vec) => boolean): LabelSpec | null {
  let best: typeof w.enemies[number] | null = null, d = Infinity;
  for (const t of w.tethers ?? []) {
    if (t.kind !== 'shackle') continue;
    const e = w.enemies.find(x => x.id === t.held);
    if (!e || !onScreen(e)) continue;
    const de = (e.x - w.hero.x) ** 2 + (e.y - w.hero.y) ** 2;
    if (de < d) { d = de; best = e; }
  }
  return best ? { id: 'shackle', text: LABEL_TEXT.shackle, at: { x: best.x, y: best.y }, place: 'below', lift: SHACKLE_LIFT } : null;
}
/** Task 40: the frame's events — a shackle was put on (the label's start), the player's dash cut one (its end). */
export const shackleMet = (w: World): boolean => w.events.some(ev => ev.type === 'tether' && ev.action === 'shackle');
export const shackleCut = (w: World): boolean => w.events.some(ev => ev.type === 'tether' && ev.action === 'cut' && ev.kind === 'shackle');

/** Task 41: real seconds «На волю!» hangs over the rioting prisoner. */
export const RIOT_LABEL_LIFE = 1.2;
/** Arena units: how far over the prisoner's centre «На волю!» hangs (over its drawing). */
const RIOT_LIFT = 1.2;
/** Task 41 «Узник на воле»: the prisoner whose riot began this frame (`frenzy` `start` with `riot`) — its id, or null. */
export function riotStarted(w: World): number | null {
  for (const ev of w.events) if (ev.type === 'frenzy' && ev.action === 'start' && ev.riot) return ev.id;
  return null;
}
/**
 * Task 41 (design 16.10.2026, docs/design-notes/task-41-prisoner-potions.md, 2): «На волю!» over the rioting prisoner `id` — a flash
 * of `RIOT_LABEL_LIFE` s that follows it, once a run (the sandbox: a fight); the host keeps the once. Null — the prisoner is gone.
 */
export function riotLabel(w: World, id: number): LabelSpec | null {
  const e = w.enemies.find(x => x.id === id);
  return e ? { id: 'riot', text: LABEL_TEXT.riot, at: { x: e.x, y: e.y }, place: 'above', lift: RIOT_LIFT } : null;
}

/** Which side of the label the tail sits on to point at `p` (stage px), or none when `p` is inside it. */
export function tailSide(rect: Rect, p: Vec): 'left' | 'right' | 'up' | 'down' | null {
  if (p.x < rect.left) return 'left';
  if (p.x > rect.right) return 'right';
  if (p.y < rect.top) return 'up';
  if (p.y > rect.bottom) return 'down';
  return null;
}

/** Sources whose strip of a plate is the PLAYER's (`elitePlates` `source`): the chain, the spin (Q), the items, the goblin's effects, the tools of the player's build (a hammer's fire, blast, cut and return, the wave: `BUILD_SOURCES`). The archer's arrow, a sapper's blast, a push and the elite's own fire trail (`fire-trail`, an enemy's property) are not. */
export const PLAYER_PLATE_SOURCES: ReadonlySet<string> = new Set(['chain', 'spin', 'bomb', 'fire', 'slot', ...Object.values(BUILD_SOURCES)]);

/**
 * The labels whose action was done in this frame (read from `w.events`, before they are cleared): a plate of any elite taken off
 * BY THE PLAYER (event `elitePlates` `strip`, whatever the way: the chain, the spin Q, a bomb, fire, the goblin), the chest
 * taken, the first pull of the lever.
 */
export function labelActions(w: World): LabelId[] {
  const ids: LabelId[] = [];
  const events = w.events;
  if (events.some(e => e.type === 'elitePlates' && e.action === 'strip' && e.source !== undefined && PLAYER_PLATE_SOURCES.has(e.source))) ids.push('b6');
  if (events.some(e => e.type === 'chest')) ids.push('b8');
  if (events.some(e => e.type === 'slot' && e.action === 'pull')) ids.push('b9');
  // Task 56: the storm killed with its strike; a link taken in water / of the called colour; the sleepers woke; a step of the bag filled.
  if (events.some(e => e.type === 'enemyHit' && e.source === 'storm' && e.killed)) ids.push('omen-storm');
  if (w.chain.some(l => l.kind === 'enemy' && l.wet)) ids.push('omen-flood');
  if (events.some(e => e.type === 'omen' && e.omen === 'drowse')) ids.push('omen-drowse');
  if (w.chain.some(l => l.kind === 'enemy' && l.call)) ids.push('omen-rollcall');
  if (events.some(e => e.type === 'bag' && e.action === 'step')) ids.push('omen-harvest');
  return ids;
}

/** A pixel rectangle. */
export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Where a label of size `size` goes, in px of the stage: from the object's screen point `at`, `k` px per arena unit, kept
 * inside `bounds` (the stage minus the HUD plate and the action bar). A 'side' label flips to the left of the object when the
 * right does not fit.
 */
export function placeLabel(spec: Pick<LabelSpec, 'place' | 'lift'> & { /** In the same space as `at` (stage px). */ away?: Vec }, at: Vec, k: number, size: { w: number; h: number }, bounds: Rect, gap = 6, avoid: readonly Rect[] = [], bodies: readonly Rect[] = []): Rect {
  const clampTo = (left: number, top: number): Rect => {
    left = Math.max(bounds.left + gap, Math.min(bounds.right - gap - size.w, left));
    top = Math.max(bounds.top + gap, Math.min(bounds.bottom - gap - size.h, top));
    return { left, top, right: left + size.w, bottom: top + size.h };
  };
  const spot = (kind: 'above' | 'below' | 'side' | 'left'): Rect => {
    if (kind === 'above') return clampTo(at.x - size.w / 2, at.y - spec.lift * k - size.h);
    if (kind === 'below') {
      // No room under the object (the action bar, the screen edge): over it, as the 'side' label flips to the other side.
      let top = at.y + spec.lift * k;
      if (top + size.h > bounds.bottom - gap) top = at.y - spec.lift * k - size.h;
      return clampTo(at.x - size.w / 2, top);
    }
    if (kind === 'left') return clampTo(at.x - spec.lift * k - size.w, at.y - size.h / 2);
    const right = at.x + spec.lift * k, left = at.x - spec.lift * k - size.w;
    const rightFits = right + size.w <= bounds.right - gap, leftFits = left >= bounds.left + gap;
    // Away from `away` (it stands right of the point: the left side first) while that side has room; else as before — right, left at the edge.
    const goLeft = spec.away && spec.away.x >= at.x ? leftFits || !rightFits : !rightFits;
    return clampTo(goLeft ? left : right, at.y - size.h / 2);
  };
  const hits = (r: Rect, list: readonly Rect[]): Rect | undefined => list.find(a => r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top);
  let rect = spot(spec.place);
  // Clear of the bodies of the enemies (review 12.10.2026): the first of the other places that covers none; none — as it was.
  if (bodies.length && hits(rect, bodies)) {
    const order = (['above', 'below', 'side', 'left'] as const).filter(kind => kind !== spec.place);
    const free = order.map(spot).find(r => !hits(r, bodies));
    if (free) rect = free;
  }
  let { left, top } = rect;
  // Clear of the elite plaques and caption plates (`avoid`): under the plate that is in the way, else over it.
  for (let pass = 0; pass < avoid.length; pass++) {
    const hit = hits({ left, top, right: left + size.w, bottom: top + size.h }, avoid);
    if (!hit) break;
    const under = hit.bottom + 4, over = hit.top - 4 - size.h;
    top = under + size.h <= bounds.bottom - gap ? under : Math.max(bounds.top + gap, over);
  }
  return { left, top, right: left + size.w, bottom: top + size.h };
}

/** What the layer shows now (the tests read it through `snapshot().onboarding.labels`). */
export interface ShownLabel extends Rect { id: string; text: string; tail?: 'left' | 'right' | 'up' | 'down' }

/** The DOM layer of the labels: an element per id, made when the label first shows, hidden when it goes. */
export class WorldLabelLayer {
  private readonly els = new Map<string, HTMLElement>();
  private shownNow: ShownLabel[] = [];
  constructor(private readonly parent: HTMLElement) {}

  /** `project` — arena units to px of the stage; `k` — px per arena unit; `bounds` — where a label may stand; `avoid` — rectangles (the elite plaques) it keeps clear of. Returns the ids that appeared in this call. */
  update(specs: readonly LabelSpec[], project: (x: number, y: number) => Vec, k: number, bounds: Rect, avoid: readonly Rect[] = [], bodies: readonly Rect[] = []): string[] {
    const appeared: string[] = [], keep = new Set<string>();
    this.shownNow = [];
    for (const spec of specs) {
      let el = this.els.get(spec.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'rt-world-label';
        el.setAttribute('data-testid', 'world-label');
        el.dataset.id = spec.id;
        el.hidden = true;
        this.parent.append(el);
        this.els.set(spec.id, el);
      }
      if (el.hidden) appeared.push(spec.id);
      if (el.textContent !== spec.text) el.textContent = spec.text;
      el.hidden = false;
      // `placeLabel` works in stage px: the point to keep away from is projected as the label's own point.
      const rect = placeLabel({ place: spec.place, lift: spec.lift, ...spec.away ? { away: project(spec.away.x, spec.away.y) } : {} }, project(spec.at.x, spec.at.y), k, { w: el.offsetWidth, h: el.offsetHeight }, bounds, 6, avoid, bodies);
      el.style.left = `${Math.round(rect.left)}px`;
      el.style.top = `${Math.round(rect.top)}px`;
      const side = spec.tail ? tailSide(rect, project(spec.tail.x, spec.tail.y)) : null;
      if (side) el.dataset.tail = side; else delete el.dataset.tail;
      keep.add(spec.id);
      this.shownNow.push({ id: spec.id, text: spec.text, ...rect, ...side ? { tail: side } : {} });
    }
    for (const [id, el] of this.els) if (!keep.has(id) && !el.hidden) el.hidden = true;
    return appeared;
  }

  hideAll(): void { for (const el of this.els.values()) el.hidden = true; this.shownNow = []; }
  shown(): ShownLabel[] { return this.shownNow.map(l => ({ ...l })); }
}

/** Task 59а: real seconds each of the garrison's step-3 labels hangs (the mark flies 1.8 s at the first throw; the others are read at once). */
export const GARRISON3_LABEL_LIFE = { pitch: 2, recruits: 3, wardens: 3 } as const;
export type Garrison3LabelId = keyof typeof GARRISON3_LABEL_LIFE;
/** Arena units: how high the labels hang over their object. */
const RECRUIT_LABEL_LIFT = 1.1, WARDEN_LABEL_LIFT = 1.0, MARK_LABEL_GAP = 0.25;

/**
 * Task 59а (spec 8, «Подписи у места»): the labels of the three new kinds — «Уйди с метки» over the mark of a pot in the air,
 * «По номерам: 1, 2, 3, 4» over the current recruit of the first line in view, «Обоих — одной цепью» over the warden of the first pair
 * in view nearest the hero. The host shows each once a run (the sandbox: a fight), the barrel's rule; a label of the view only,
 * no Param, no journal. Null — none of the kind stands in view.
 */
export function garrison3Label(w: World, id: Garrison3LabelId, onScreen: (p: Vec) => boolean): LabelSpec | null {
  const near = <T extends Vec>(list: readonly T[]): T | null => {
    let best: T | null = null, d = Infinity;
    for (const e of list) { if (!onScreen(e)) continue; const de = (e.x - w.hero.x) ** 2 + (e.y - w.hero.y) ** 2; if (de < d) { d = de; best = e; } }
    return best;
  };
  if (id === 'pitch') {
    const pot = near(potsInFlight(w));
    return pot ? { id: 'pitch', text: LABEL_TEXT.pitch, at: { x: pot.x, y: pot.y }, place: 'above', lift: pitchMarkRadius(w) + MARK_LABEL_GAP } : null;
  }
  if (id === 'recruits') {
    const list = w.enemies.filter(e => e.kind === RECRUIT && (e.vars.rn ?? 0) > 0);
    const e = near(list);
    if (!e) return null;
    const cur = recruitCurrent(w.enemies, recruitGroup(e));
    const first = list.find(x => recruitGroup(x) === recruitGroup(e) && x.vars.rn === cur) ?? e;
    return { id: 'recruits', text: LABEL_TEXT.recruits, at: { x: first.x, y: first.y }, place: 'above', lift: RECRUIT_LABEL_LIFT };
  }
  const pair = near(w.enemies.filter(e => e.kind === WARDEN && !!wardenPartner(w, e)));
  return pair ? { id: 'wardens', text: LABEL_TEXT.wardens, at: { x: pair.x, y: pair.y }, place: 'above', lift: WARDEN_LABEL_LIFT } : null;
}
