/**
 * Tasks 36–37 «Мета v1»: the one start of a new run with the camp's choices (design 16.10.2026) — «В поход» in the camp and «Новый
 * поход» on the run screen go the same way: with «Два пути» / «Три пути» a choice of 2 / 3 forest maps (each drawn as the run map,
 * its node counts by kind, a count that differs from another map lit), with «Выбор травницы» a choice of Марфа's consumable; then
 * the run starts (the gift as before). Nothing bought — no window, the run starts at once. Its own overlay over the run screen and
 * the camp; the plan (the maps, the kinds, the run's flags) is core's (`hearthStart`).
 */
import { createRtRun, rtMapNodes } from '../run/rtRun';
import { ITEM_TITLES, type ItemKind } from '../sim/kit';
import { RT_VOW_TITLES, type RtVowId } from '../run/metaCatalog';
import { RT_NODE_TYPES } from './nodeTypes';
import type { HearthStart } from './metaModel';

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The chosen start: the run's seed (a map's, or the base), the consumable, core's plan, the map's index (null — no choice shown). */
/** Task 51г: `vows` — Евлампий's vows taken (none — an empty list). */
export type RunStartGo = (seed: number, item: ItemKind | null, plan: HearthStart, map: number | null, vows: string[]) => void;

/** Task 51г: what each vow asks (spec 3.3); kept — +15 experience, counted only when the run reaches the Jailer. */
export const VOW_RULES: Readonly<Record<RtVowId, string>> = { 'vow-no-shop': 'Ни одного торговца за поход', 'vow-no-rest': 'Ни одного привала', 'vow-no-mapheal': 'Ни одного лечения на карте', 'vow-no-reroll': 'Ни одного переброса, платного и бесплатного' };

export class RunStart {
  readonly el: HTMLDivElement;
  private state: { plan: HearthStart; seed: number; map: number | null; item: ItemKind | null; vows: string[]; step: 'maps' | 'items' | 'vows'; go: RunStartGo } | null = null;
  /** What the start shows now (tests read it): the step and the maps offered. */
  readonly shown = { step: null as 'maps' | 'items' | 'vows' | null, maps: 0, vows: 0 };

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'rt-run-start-choice';
    this.el.hidden = true;
    this.el.addEventListener('click', event => this.onClick(event));
  }

  /** Starts a run from the plan of `base`: the choices bought, then `go`; nothing to choose — `go` at once. */
  begin(plan: HearthStart, base: number, go: RunStartGo): void {
    const step = plan.maps && plan.maps.length > 1 ? 'maps' : plan.items && plan.items.length > 1 ? 'items' : plan.vows?.length ? 'vows' : null;
    if (!step) { go(base, plan.items?.[0] ?? null, plan, null, []); return; }
    this.state = { plan, seed: base, map: null, item: plan.items?.[0] ?? null, vows: [], step, go };
    this.draw();
  }

  close(): void { this.state = null; this.el.hidden = true; this.el.innerHTML = ''; this.shown.step = null; this.shown.maps = 0; this.shown.vows = 0; }

  private draw(): void {
    const s = this.state;
    if (!s) { this.close(); return; }
    this.el.hidden = false;
    this.shown.step = s.step;
    if (s.step === 'maps' && s.plan.maps) {
      const maps = s.plan.maps, counts = maps.map(mapCounts);
      this.shown.maps = maps.length;
      const cards = maps.map((seed, i) => {
        const line = MAP_KINDS.map(k => { const n = counts[i][k.id] ?? 0, differs = counts.some((c, j) => j !== i && (c[k.id] ?? 0) !== n);
          return `<span class="${differs ? 'rt-mp-diff' : ''}" title="${esc(k.label)}">${k.icon} ${n}</span>`; }).join('');
        return `<button class="rt-hearth-map" data-action="map" data-seed="${seed}" data-index="${i}" data-testid="hearth-map-${i}">${mapPreview(seed)}<span class="rt-mp-counts">${line}</span><b>Путь ${i + 1}</b></button>`;
      }).join('');
      this.el.innerHTML = `<div class="rt-overlay rt-hearth-modal" data-testid="hearth-maps"><div class="rt-card"><h2>${maps.length === 3 ? 'Три пути' : 'Два пути'}</h2><div class="rt-hearth-maps">${cards}</div></div></div>`;
      return;
    }
    if (s.step === 'vows') {
      const vows = (s.plan.vows ?? []) as RtVowId[], count = s.plan.vowCount ?? 1;
      this.shown.vows = vows.length;
      const cards = vows.map(id => `<button class="rt-run-choice rt-vow${s.vows.includes(id) ? ' rt-chosen' : ''}" data-action="vow" data-vow="${id}" data-testid="vow-${id}" aria-pressed="${s.vows.includes(id)}" ${!s.vows.includes(id) && s.vows.length >= count ? 'disabled' : ''}><b>${esc(RT_VOW_TITLES[id])}</b><small>${esc(VOW_RULES[id])}</small></button>`).join('');
      this.el.innerHTML = `<div class="rt-overlay rt-hearth-modal" data-testid="hearth-vows"><div class="rt-card"><h2>${count > 1 ? 'Два обета' : 'Обет'}</h2>`
        + `<p class="rt-run-note">Взять до ${count} из ${vows.length}. Сдержанный обет даёт +15 опыта, если поход дойдёт до Тюремщика.</p><div class="rt-run-choices">${cards}</div>`
        + `<button class="rt-again rt-vow-go" data-action="vows-go" data-testid="vows-go">${s.vows.length ? 'В поход' : 'Без обета'}</button></div></div>`;
      return;
    }
    const items = s.plan.items ?? [];
    const cards = items.map(kind => `<button class="rt-run-choice" data-action="item" data-item="${kind}" data-testid="hearth-item-${kind}"><b>${esc(ITEM_TITLES[kind])}</b></button>`).join('');
    this.el.innerHTML = `<div class="rt-overlay rt-hearth-modal" data-testid="hearth-items"><div class="rt-card"><h2>Выбор травницы</h2><div class="rt-run-choices">${cards}</div></div></div>`;
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]'), s = this.state;
    if (!target || !s) return;
    if (target.dataset.action === 'map') {
      s.seed = Number(target.dataset.seed) >>> 0; s.map = Number(target.dataset.index);
      if (s.plan.items && s.plan.items.length > 1) { s.step = 'items'; this.draw(); return; }
      this.afterItem(s.plan.items?.[0] ?? null); return;
    }
    if (target.dataset.action === 'item') { this.afterItem(target.dataset.item as ItemKind); return; }
    if (target.dataset.action === 'vow') {
      const id = target.dataset.vow!, count = s.plan.vowCount ?? 1;
      s.vows = s.vows.includes(id) ? s.vows.filter(v => v !== id) : s.vows.length < count ? [...s.vows, id] : s.vows;
      this.draw(); return;
    }
    if (target.dataset.action === 'vows-go') this.finish(s.item);
  }

  /** After the maps and the consumable: Евлампий's vows (a level of his), else the run. */
  private afterItem(item: ItemKind | null): void {
    const s = this.state!;
    s.item = item;
    if (s.plan.vows?.length) { s.step = 'vows'; this.draw(); return; }
    this.finish(item);
  }

  private finish(item: ItemKind | null): void {
    const s = this.state!;
    this.close();
    s.go(s.seed, item, s.plan, s.map, s.vows);
  }
}

/** The kinds of nodes the map choice counts (the run map's icons, view/nodeTypes.ts); «Застава» is the checkpoint. */
export const MAP_KINDS: readonly { id: string; icon: string; label: string }[] = [
  { id: 'battle', icon: RT_NODE_TYPES.battle.icon, label: 'Бои' }, { id: 'hard', icon: RT_NODE_TYPES.hard.icon, label: 'Трудные бои' },
  { id: 'event', icon: RT_NODE_TYPES.event.icon, label: 'События' }, { id: 'rest', icon: RT_NODE_TYPES.rest.icon, label: 'Привалы' },
  { id: 'shop', icon: RT_NODE_TYPES.shop.icon, label: 'Торговцы' }, { id: 'checkpoint', icon: RT_NODE_TYPES.checkpoint.icon, label: 'Заставы' },
];

/** A map's nodes counted by kind (a find counts as an event, as the map shows it). */
export function mapCounts(seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of rtMapNodes(createRtRun(seed))) { const k = n.type === 'find' ? 'event' : n.type; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** A forest map by its seed as the run map draws it: the edges, the node circles with their icons (no stream is drawn for it). */
export function mapPreview(seed: number): string {
  const run = createRtRun(seed), nodes = rtMapNodes(run);
  const W = 1000, H = 520, pad = 40, x = (row: number) => pad + (row - 5) * (W - 2 * pad) / 9, y = (slot: number) => pad + slot * (H - 2 * pad);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = nodes.flatMap(n => n.next.map(id => { const m = byId.get(id); return m ? `<line x1="${x(n.row)}" y1="${y(n.slot ?? 0.5)}" x2="${x(m.row)}" y2="${y(m.slot ?? 0.5)}" class="rt-edge"/>` : ''; })).join('');
  const dots = nodes.map(n => `<g class="rt-node rt-mp-node${n.row === 5 ? ' rt-available' : ''}" transform="translate(${x(n.row)},${y(n.slot ?? 0.5)})"><circle r="27"/><text dy="10">${RT_NODE_TYPES[n.type].icon}</text></g>`).join('');
  return `<svg class="rt-run-map rt-hearth-mapsvg" viewBox="0 0 ${W} ${H}" aria-hidden="true">${edges}${dots}</svg>`;
}
