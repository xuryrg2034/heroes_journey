/**
 * Task 21 «Почему погиб» (design 15.10.2026, docs/design-notes/tasks-21-25.md): the run fight's «Поражение» says, under its
 * title, who killed the hero (`rtDeathLine`, the words of the run-end screen) and one line of the series before it — the hits of
 * the last `SERIES_WINDOW` game seconds, the lethal one too: the source with the most hits, how many and over how long, and the
 * last one when it is another («касание ×6 за 4 с · последний — взрыв сапёра»). A sapper's blast says whose it was: lit by a
 * touch and not the player's — «(поджёг касанием)», the player's kill (`credited`: the chain, Q, a hammer, a wave) —
 * «(убит тобой)», anything else — no mark. View only: read from the `hit` and `kill` events and the world's time, never a Param.
 */
import { RT_DEATH_ABILITY, RT_DEATH_TOUCH } from '../run/rtRunEnd';
import type { World, WorldEvent } from '../sim/world';

/** Game seconds before the lethal hit whose hits make the series (design 15.10.2026). */
export const SERIES_WINDOW = 5;
/** Hits kept: more than the window can hold (invulnerability spaces them). */
const KEEP = 64;

export type SapperBlame = 'touch' | 'yours';
export interface SeriesHit { t: number; source: string; damage: number; blame?: SapperBlame }

export const DEATH_SERIES_TEXT = {
  touch: 'касание',
  /** A source with no name of its own (none today: every hit source of the sim is named). */
  other: 'удар',
  blame: { touch: '(поджёг касанием)', yours: '(убит тобой)' } as Readonly<Record<SapperBlame, string>>,
  series: (name: string, n: number, seconds: number): string => `${name} ×${n} за ${seconds} с`,
  last: (name: string): string => `последний — ${name}`,
  single: (damage: number): string => `1 удар · −${damage} HP`,
} as const;

/** The series' name of a hit source: an ability by its run-end name, every touch — «касание». */
export function seriesName(source: string): string {
  if (Object.hasOwn(RT_DEATH_ABILITY, source)) return RT_DEATH_ABILITY[source];
  return RT_DEATH_TOUCH.includes(source) ? DEATH_SERIES_TEXT.touch : DEATH_SERIES_TEXT.other;
}

const named = (hit: SeriesHit): string => hit.blame ? `${seriesName(hit.source)} ${DEATH_SERIES_TEXT.blame[hit.blame]}` : seriesName(hit.source);

/**
 * The series line of the hits up to the lethal one (the last of `hits`, in time order); null — no hits. The main source has the
 * most hits in the window; a tie — the more damage, then the later. Seconds — from its first hit in the window to the death,
 * rounded up, at least 1.
 */
export function deathSeriesLine(hits: readonly SeriesHit[]): string | null {
  const last = hits.at(-1);
  if (!last) return null;
  const window = hits.filter(h => h.t >= last.t - SERIES_WINDOW - 1e-9);
  if (window.length === 1) return `${DEATH_SERIES_TEXT.single(last.damage)}${last.blame ? ` ${DEATH_SERIES_TEXT.blame[last.blame]}` : ''}`;
  const groups = new Map<string, { n: number; damage: number; first: number; latest: number }>();
  window.forEach((h, i) => {
    const name = seriesName(h.source), g = groups.get(name);
    if (g) { g.n++; g.damage += h.damage; g.latest = i; } else groups.set(name, { n: 1, damage: h.damage, first: h.t, latest: i });
  });
  let main = '', best: { n: number; damage: number; first: number; latest: number } | null = null;
  for (const [name, g] of groups) {
    if (!best || g.n > best.n || (g.n === best.n && (g.damage > best.damage || (g.damage === best.damage && g.latest > best.latest)))) { main = name; best = g; }
  }
  const seconds = Math.max(1, Math.ceil(last.t - best!.first - 1e-6));
  const head = DEATH_SERIES_TEXT.series(main, best!.n, seconds);
  if (seriesName(last.source) === main) return last.blame ? `${head} ${DEATH_SERIES_TEXT.blame[last.blame]}` : head;
  return `${head} · ${DEATH_SERIES_TEXT.last(named(last))}`;
}

/**
 * Collects a fight's hits on the hero for the series (main.ts: `seen` before every tick, `read` every frame before the events
 * go, as `RtDeathWatch`). A new fight — `reset`.
 */
export class DeathSeries {
  readonly hits: SeriesHit[] = [];
  /** Sappers seen burning a touch-lit fuse before a tick (ids are never reused in a world). */
  private readonly lit = new Set<number>();
  /** Sappers the player killed (`kill` with `credited`). */
  private readonly yours = new Set<number>();

  reset(): void { this.hits.length = 0; this.lit.clear(); this.yours.clear(); }

  seen(world: World): void { for (const e of world.enemies) if (e.kind === 'sapper' && e.vars.lit === 1) this.lit.add(e.id); }

  read(world: World, events: readonly WorldEvent[]): void {
    for (const ev of events) {
      // A kill comes before the hit of its blast (`detonate` kills the owner first): read in order.
      if (ev.type === 'kill' && ev.credited) this.yours.add(ev.enemyId);
      else if (ev.type === 'hit') {
        const blame: SapperBlame | undefined = ev.source !== 'blast' ? undefined : this.yours.has(ev.enemyId) ? 'yours' : this.lit.has(ev.enemyId) ? 'touch' : undefined;
        this.hits.push({ t: world.time, source: ev.source, damage: ev.damage, ...blame ? { blame } : {} });
        if (this.hits.length > KEEP) this.hits.shift();
      }
    }
  }

  line(): string | null { return deathSeriesLine(this.hits); }
}
