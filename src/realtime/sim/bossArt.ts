/**
 * «Зона нажатия босса по рисунку» (design 21.10.2026, docs/design-notes/task-48-troll.md §24; `Params.bossPickArt`): a boss's drawing is
 * much larger than its press circle (`pickRadius` 0.594 — the core's 17–41 % of its drawing, the rest took nothing). The drawing's
 * press zone is the ellipse inscribed in its box: the centre — the middle of the drawing (the feet plus half its height, or the part's
 * centre), the half-axes — half its width and height. One number for the simulation and the view: the boxes below are the view's
 * (trollView `TROLL_ART`, chiefView `CHIEF_ART`, warlockView `WARLOCK_ART`, render.ts `JAILER_ART` and `GARRISON_ART`, the parts'
 * `CLUB_ART`, `ROCK_ART`, `KNOT_ART`, `LADLE_ART`, `SACK_ART`) with the pictures' aspects (public/art/characters/*.png), and the view
 * reads the zone from `bossArtEllipse` (it copies no rule). Pure: nothing here changes the world; only `detMath`.
 */
import { datan2, dcos, dsin } from './detMath';
import { enemyArtRadius } from './enemies/kinds';
import type { Vec } from './geometry';
import type { Enemy, World } from './world';

/**
 * A drawing's box: `side` — the square the picture is fitted into, in drawing radii (`enemyArtRadius`); `aspect` — the picture's
 * height / width (the fitted box is `side` wide and `side × aspect` high, or `side` high and `side / aspect` wide); `feet` — it stands
 * on its feet `feet` radii below the body's centre and goes up (a core); otherwise centred `dy` radii below the body's centre (a part).
 */
export interface BossArtBox { side: number; aspect: number; feet?: number; dy?: number }

/**
 * The bosses' and their parts' drawings by kind id (the ids of enemies/troll.ts, chief.ts, warlock.ts, jailer.ts, garrison.ts — literal
 * here: this table is read while those modules load; a part drawn smaller than its press circle is not here).
 */
export const BOSS_ART: Readonly<Record<string, BossArtBox>> = {
  troll: { side: 6.8, aspect: 1226 / 1300, feet: 1 },
  chief: { side: 5.4, aspect: 1263 / 1281, feet: 1 },
  warlock: { side: 5.0, aspect: 1200 / 1162, feet: 1 },
  jailer: { side: 5.4, aspect: 1282 / 1227, feet: 1 },
  castellan: { side: 4.2, aspect: 1280 / 1265, feet: 1 },
  'troll-club': { side: 5, aspect: 518 / 760 },
  'troll-rock': { side: 3.4, aspect: 645 / 760 },
  'troll-tail': { side: 2.3, aspect: 645 / 760 },
  'chief-ladle': { side: 3.4, aspect: 481 / 751, dy: -0.35 },
  'chief-sack': { side: 2.8, aspect: 677 / 751, dy: -0.35 },
};
/** The club's kind (enemies/troll.ts `TROLL_CLUB`). */
const CLUB = 'troll-club';

/**
 * The club's pose (trollView `buildPartArt`, `posePartArt`): the picture hangs from its grip (the share `CLUB_GRIP` of the picture) at
 * the part's centre, turned by `head + π − CLUB_AXIS` — its head up and a little left in the paw (`CLUB_HAND`), along the line from the
 * core while it lies.
 */
const CLUB_GRIP = { x: 0.92, y: 0.88 };
const CLUB_AXIS = datan2(380, 640);
const CLUB_HAND = -1.95;

/** A press zone: the ellipse's centre, half-axes along its own axes, and the axes' turn (`cos`, `sin`; 1, 0 — upright). */
export interface ArtEllipse { x: number; y: number; a: number; b: number; cos: number; sin: number }

/** The fitted box of `box` in arena units for a drawing radius `r`: its width and height. */
function fitted(box: BossArtBox, r: number): { w: number; h: number } {
  return box.aspect > 1 ? { w: r * box.side / box.aspect, h: r * box.side } : { w: r * box.side, h: r * box.side * box.aspect };
}

/** The press zone of `e`'s drawing (the ellipse inscribed in its box); null — not a boss body with a large drawing. */
export function bossArtEllipse(world: World, e: Enemy): ArtEllipse | null {
  const box = BOSS_ART[e.kind];
  if (!box) return null;
  const r = enemyArtRadius(world.params, e), { w, h } = fitted(box, r);
  if (e.kind === CLUB) {
    const core = e.partOf !== undefined ? world.enemies.find(c => c.id === e.partOf) : undefined;
    const head = e.vars.lie !== undefined && core ? datan2(e.y - core.y, e.x - core.x) : CLUB_HAND, turn = head + Math.PI - CLUB_AXIS;
    const cos = dcos(turn), sin = dsin(turn), lx = (0.5 - CLUB_GRIP.x) * w, ly = (0.5 - CLUB_GRIP.y) * h;
    return { x: e.x + lx * cos - ly * sin, y: e.y + lx * sin + ly * cos, a: w / 2, b: h / 2, cos, sin };
  }
  const y = box.feet !== undefined ? e.y + r * box.feet - h / 2 : e.y + r * (box.dy ?? 0);
  return { x: e.x, y, a: w / 2, b: h / 2, cos: 1, sin: 0 };
}

/**
 * The drawing order of the bosses' bodies (design 21.10.2026): a part is drawn over its core. Higher — on top. One number for the
 * simulation (the overlap rule, `artPick`) and the view (it draws the bodies by it).
 */
export const BOSS_ART_LAYER: Readonly<Record<string, number>> = {
  troll: 0, chief: 0, warlock: 0, jailer: 0, castellan: 0,
  'troll-club': 1, 'troll-rock': 1, 'troll-tail': 1, 'chief-ladle': 1, 'chief-sack': 1,
};

/**
 * The overlap rule of the drawings (design 21.10.2026), in one place: among the boss bodies whose drawings hold `p`, those `accept` lets
 * the chain take; of them the one drawn on top (`BOSS_ART_LAYER`), a tie — the one `p` is deeper in. Null — none. A pick that accepts
 * every body (the hint's «what is under the pointer») gets the one on top: its refusal is the one shown.
 */
export function artPick(world: World, p: Vec, accept: (e: Enemy) => boolean): Enemy | null {
  let best: Enemy | null = null, layer = -Infinity, depth = Infinity;
  for (const e of world.enemies) {
    const zone = bossArtEllipse(world, e), q = zone ? artEllipseDepth(zone, p) : Infinity;
    if (q > 1 || !accept(e)) continue;
    const l = BOSS_ART_LAYER[e.kind] ?? 0;
    if (l > layer || (l === layer && q < depth)) { best = e; layer = l; depth = q; }
  }
  return best;
}

/** Where `p` stands in the ellipse `z`: (dx/a)² + (dy/b)² along its axes — inside at 1 or less. */
export function artEllipseDepth(z: ArtEllipse, p: Vec): number {
  const dx = p.x - z.x, dy = p.y - z.y, u = (dx * z.cos + dy * z.sin) / z.a, v = (dy * z.cos - dx * z.sin) / z.b;
  return u * u + v * v;
}
