/**
 * Task 36 «Опыт героя, открытия, рекорд глубины» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md) and the carry line of
 * task 37: the meta block of the run-end screen. One DOM element per ended run — it outlives the run screen's redraws, so its
 * animation plays once:
 * 1. «+N опыта» counts up with its parts listed; the hero's bar fills from the old experience to the new one (count-up, task 35
 *    С3), the next threshold marked on it;
 * 2. a pack opened: the bar reaches the mark, the mark flashes, three cards turn over one by one (a silhouette → the item, its
 *    name on the card) with the reward sound — the meta's main moment, no text plate;
 * 3. the depth record — «Ряд 8 — новый рекорд» only when beaten (the old one small); task 38 — the garrison's «Гарнизон, ряд 2»;
 *    task 40 — «Гарнизон пройден» (the record's `wonLevel`);
 * 4. «В лагерь: +N» — the resources fly from the header's number to it and it counts up; task 40 — «(Повозка +M)» beside it.
 * View only: the profile already holds the result (`MetaEnd`).
 */
import { RT_XP_VOW } from '../run/rtMeta';
import { GARRISON_TITLE } from '../run/garrison';
import { countUpValue } from './juice';
import { metaItemCard, xpBar, xpPartLabel, type MetaEnd } from './metaModel';

/** The stock's token (the carry line; task 40 — the cart's number on «Предместье»). */
export const ICON = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 2 L17 7 L14.5 17 L5.5 17 L3 7 Z" fill="#e3b45a" stroke="#1a2330" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 7 L10 9 L17 7 M10 9 L10 17" fill="none" stroke="#1a2330" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The sounds the block asks for (the host plays them by its sound setting). */
export type MetaSound = 'tick' | 'mark' | 'flip' | 'pack';

/** What the block has shown so far (tests read it). */
export interface MetaEndShown { xp: number; gain: number; bar: number; mark: boolean; flipped: number; carry: number; done: boolean }

/**
 * The record's depth in words: «ряд 8», «лес пройден». Task 38: a garrison record (`level` 2) — «Гарнизон, ряд 2» (the forest is
 * behind it); `forest` — a forest row next to a garrison one says its level: «лес, ряд 9». A garrison record of row 0 (no garrison
 * node yet) — «лес пройден». Task 40: `passed` — the level the record passed (core's `wonLevel`: 0 none, 1 the forest, 2 the
 * garrison — «гарнизон пройден»); never the profile's `won` (any victory).
 */
export function rowWord(row: number, passed: number, level?: number, forest = false): string {
  if (passed >= 2) return `${GARRISON_TITLE.toLowerCase()} пройден`;
  if (level === 2) return row > 0 ? `${GARRISON_TITLE}, ряд ${row}` : 'лес пройден';
  return passed >= 1 ? 'лес пройден' : forest ? `лес, ряд ${row}` : `ряд ${row}`;
}
/** A record has a line: a row, a level passed or the garrison (smoke v62: row 0 of the forest — none). */
const hasRecord = (r: { row: number; wonLevel?: number; level?: number }): boolean => r.row > 0 || !!r.wonLevel || !!r.level;

/** The block: the experience, the bar, the record, the carry, the pack's cards face down. */
function blockHtml(m: MetaEnd): string {
  // Task 51г (design 17.10.2026): «Обеты: сдержано N из M · +15×N» — the broken ones are seen by the number (a line even at N = 0).
  const kept = m.vows?.filter(v => v.kept).length ?? 0;
  const vows = m.vows?.length ? `<li data-testid="meta-part-vows"><span>Обеты: сдержано ${kept} из ${m.vows.length}</span><b>+${RT_XP_VOW}×${kept}</b></li>` : '';
  const parts = m.xp.parts.filter(p => p.xp !== 0 && !(p.id === 'vows' && m.vows?.length)).map(p => `<li data-testid="meta-part-${p.id}"><span>${esc(xpPartLabel(p.id, p.n))}</span><b>+${p.xp}</b></li>`).join('') + vows;
  const bar = xpBar(m.xp.before, m.thresholds);
  const rec = m.record.after, before = m.record.before;
  const word = rowWord(rec.row, rec.wonLevel ?? 0, rec.level);
  const record = m.record.beaten
    ? `<p class="rt-meta-record rt-meta-beaten" data-testid="meta-record" data-beaten="true"><b>${esc(word[0].toUpperCase() + word.slice(1))} — новый рекорд</b>${before && hasRecord(before) ? `<small>прежний: ${esc(rowWord(before.row, before.wonLevel ?? 0, before.level, rec.level === 2))}</small>` : ''}</p>`
    // Smoke v62: no record yet (row 0) — no line (a garrison record of row 0 has its line: «лес пройден»).
    : hasRecord(rec) ? `<p class="rt-meta-record" data-testid="meta-record" data-beaten="false"><small>Рекорд: ${esc(word)}</small></p>` : '';
  // Task 56: the omens the end opened — one quiet line, as «В лагерь» (absent or 0 — none).
  const omens = m.omens ? `<p class="rt-meta-omens" data-testid="meta-omens">Приметы: <b>+${m.omens}</b></p>` : '';
  const quest = m.quest ? `<p class="rt-meta-quest${m.quest.done ? ' rt-done' : ''}" data-testid="meta-quest">Задание: ${m.quest.done ? `выполнено <b>+${m.quest.xp} опыта, +${m.quest.stock} запаса</b>` : 'не выполнено'}</p>` : '';
  const cards = m.pack ? `<div class="rt-pack" data-testid="meta-pack" data-pack="${esc(m.pack.id)}"><p class="rt-pack-title">${esc(m.pack.title)}</p><div class="rt-pack-cards">${m.pack.items.map((item, i) => {
    const c = metaItemCard(item);
    const face = c.svg ? `<span class="rt-pack-svg">${c.svg}</span>` : `<span class="rt-pack-glyph">${esc(c.glyph)}</span>`;
    return `<div class="rt-pack-card" data-testid="pack-card-${i}" data-item="${esc(item.id)}"><div class="rt-pack-inner"><div class="rt-pack-back">${face}</div>`
      + `<div class="rt-pack-front rt-kind-${item.kind}">${face}<b>${esc(c.title)}</b><small>${esc(c.kind)}</small></div></div></div>`;
  }).join('')}</div></div>` : '';
  const next = m.nextPack && !m.pack ? `<span class="rt-meta-next" data-testid="meta-next">${esc(m.nextPack.title)} · ${m.nextPack.at}</span>` : '';
  return `<div class="rt-meta-xp"><b class="rt-meta-gain" data-testid="meta-xp-gain">+0 опыта</b><ul class="rt-meta-parts">${parts}</ul></div>`
    + `<div class="rt-meta-bar" data-testid="meta-bar"><i class="rt-meta-fill" style="width:${(bar.k * 100).toFixed(1)}%"></i>`
    + `<span class="rt-meta-mark"${bar.to === null ? ' hidden' : ''}></span><em data-testid="meta-xp-now">${m.xp.before}${bar.to !== null ? ` / ${bar.to}` : ''}</em>${next}</div>`
    + record + quest + omens + cards
    // Task 40 «Повозка»: what the cart sent at «Предместье» is inside N — named beside it (absent — no cart in the run).
    + `<p class="rt-meta-carry" data-testid="meta-carry">В лагерь: <b>+0</b>${ICON}${m.carry.cart !== undefined ? `<span class="rt-meta-cart" data-testid="meta-carry-cart">(Повозка +${m.carry.cart})</span>` : ''}${m.carry.share < 1 && m.carry.resources > 0 ? `<small>${Math.round(m.carry.share * 100)} % из ${m.carry.resources}</small>` : ''}</p>`;
}

/** The run-end meta block of one ended run; `play` runs its animation once. */
export class MetaEndView {
  readonly el: HTMLElement;
  readonly shown: MetaEndShown = { xp: 0, gain: 0, bar: 0, mark: false, flipped: 0, carry: 0, done: false };
  private timers: number[] = [];
  private frame = 0;
  private played = false;

  constructor(readonly meta: MetaEnd, readonly key: string, private readonly sound: (s: MetaSound) => void) {
    this.el = document.createElement('section');
    this.el.className = 'rt-meta';
    this.el.setAttribute('data-testid', 'meta-end');
    this.el.innerHTML = blockHtml(meta);
    this.shown.xp = meta.xp.before;
  }

  /** Plays once: the gain and the bar, the mark and the cards, the carry. `from` — the screen point the resources fly from. */
  play(from: { x: number; y: number } | null): void {
    if (this.played) return;
    this.played = true;
    const m = this.meta, gainEl = this.el.querySelector<HTMLElement>('[data-testid="meta-xp-gain"]')!;
    const fill = this.el.querySelector<HTMLElement>('.rt-meta-fill')!, now = this.el.querySelector<HTMLElement>('[data-testid="meta-xp-now"]')!;
    const start = performance.now() + 250, time = 1.1;
    // With a pack the bar runs to its threshold (the mark), then starts its new stretch at the after-value.
    const crossed = m.pack ? m.thresholds.find(t => m.xp.before < t && m.xp.after >= t) ?? null : null;
    const target = crossed ?? m.xp.after;
    let ticks = 0;
    const tick = (): void => {
      const t = (performance.now() - start) / 1000;
      if (t < 0) { this.frame = requestAnimationFrame(tick); return; }
      const gain = countUpValue(0, m.xp.gained, t, time), xp = countUpValue(m.xp.before, target, t, time);
      gainEl.textContent = `+${gain} опыта`;
      const bar = xpBar(crossed !== null && xp >= crossed ? crossed - 0.001 : xp, m.thresholds);
      fill.style.width = `${(bar.k * 100).toFixed(1)}%`;
      now.textContent = `${xp}${bar.to !== null ? ` / ${bar.to}` : ''}`;
      this.shown.gain = gain; this.shown.xp = xp; this.shown.bar = bar.k;
      if (Math.floor(gain / 5) > ticks) { ticks = Math.floor(gain / 5); this.sound('tick'); }
      if (t < time) { this.frame = requestAnimationFrame(tick); return; }
      if (crossed !== null) this.openPack(crossed); else this.carry(from, 300);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** The bar reached a threshold: the mark flashes, the cards turn over one by one, the bar starts its new stretch. */
  private openPack(at: number): void {
    const m = this.meta, mark = this.el.querySelector<HTMLElement>('.rt-meta-mark')!, fill = this.el.querySelector<HTMLElement>('.rt-meta-fill')!;
    this.el.querySelector('.rt-meta-bar')!.classList.add('rt-meta-hit');
    mark.classList.add('rt-meta-mark-hit');
    this.shown.mark = true;
    this.sound('mark');
    const pack = this.el.querySelector<HTMLElement>('[data-testid="meta-pack"]')!;
    this.later(350, () => pack.classList.add('rt-pack-in'));
    const cards = [...this.el.querySelectorAll<HTMLElement>('.rt-pack-card')];
    cards.forEach((card, i) => this.later(900 + i * 420, () => { card.classList.add('rt-flipped'); this.shown.flipped = i + 1; this.sound(i === cards.length - 1 ? 'pack' : 'flip'); }));
    this.later(900 + cards.length * 420 + 200, () => {
      const bar = xpBar(m.xp.after, m.thresholds), now = this.el.querySelector<HTMLElement>('[data-testid="meta-xp-now"]')!;
      this.el.querySelector('.rt-meta-bar')!.classList.remove('rt-meta-hit');
      fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth; fill.style.transition = '';
      fill.style.width = `${(bar.k * 100).toFixed(1)}%`;
      now.textContent = `${m.xp.after}${bar.to !== null ? ` / ${bar.to}` : ''}`;
      mark.hidden = bar.to === null;
      this.shown.xp = m.xp.after; this.shown.bar = bar.k;
      void at;
      this.carry(null, 400);
    });
  }

  /** «В лагерь: +N»: the tokens fly to the line (from the header's resources or `from`), the number counts up. */
  private carry(from: { x: number; y: number } | null, delay: number): void {
    const m = this.meta, line = this.el.querySelector<HTMLElement>('[data-testid="meta-carry"]')!, num = line.querySelector('b')!;
    this.later(delay, () => {
      const target = num.getBoundingClientRect(), res = document.querySelector('[data-testid="run-resources"]')?.getBoundingClientRect();
      const src = from ?? (res ? { x: res.left + res.width / 2, y: res.top + res.height / 2 } : { x: target.left, y: target.top - 80 });
      const sx = src.x, sy = src.y;
      const tokens = Math.min(6, m.carry.n);
      for (let i = 0; i < tokens; i++) {
        const token = document.createElement('span');
        token.className = 'rt-res-token';
        token.setAttribute('data-testid', 'carry-token');
        token.innerHTML = ICON;
        token.style.left = `${sx - 8 + (i - (tokens - 1) / 2) * 10}px`; token.style.top = `${sy - 8}px`;
        document.body.appendChild(token);
        const dx = target.left + target.width / 2 - sx - (i - (tokens - 1) / 2) * 10, dy = target.top + target.height / 2 - sy;
        token.animate([{ transform: 'translate(0,0) scale(1.3)' }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 50}px) scale(1.1)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(0.8)` }],
          { duration: 480, delay: i * 70, easing: 'ease-in', fill: 'both' }).onfinish = () => token.remove();
      }
      const start = performance.now() + 480, time = Math.max(0.3, Math.min(0.6, 0.3 + 0.03 * m.carry.n));
      const tick = (): void => {
        const t = (performance.now() - start) / 1000, v = t < 0 ? 0 : countUpValue(0, m.carry.n, t, time);
        num.textContent = `+${v}`; this.shown.carry = v;
        line.classList.toggle('rt-meta-counting', t >= 0 && v < m.carry.n);
        if (t < time) { this.frame = requestAnimationFrame(tick); return; }
        line.classList.remove('rt-meta-counting');
        this.shown.done = true;
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  /** Shows the end state at once (a click on the screen skips the animation). */
  finish(): void {
    if (this.shown.done) return;
    this.stop();
    const m = this.meta, bar = xpBar(m.xp.after, m.thresholds);
    this.el.querySelector<HTMLElement>('[data-testid="meta-xp-gain"]')!.textContent = `+${m.xp.gained} опыта`;
    this.el.querySelector<HTMLElement>('.rt-meta-fill')!.style.width = `${(bar.k * 100).toFixed(1)}%`;
    this.el.querySelector<HTMLElement>('[data-testid="meta-xp-now"]')!.textContent = `${m.xp.after}${bar.to !== null ? ` / ${bar.to}` : ''}`;
    this.el.querySelector<HTMLElement>('.rt-meta-mark')!.hidden = bar.to === null;
    this.el.querySelector('[data-testid="meta-pack"]')?.classList.add('rt-pack-in');
    for (const c of this.el.querySelectorAll('.rt-pack-card')) c.classList.add('rt-flipped');
    this.el.querySelector<HTMLElement>('[data-testid="meta-carry"] b')!.textContent = `+${m.carry.n}`;
    Object.assign(this.shown, { gain: m.xp.gained, xp: m.xp.after, bar: bar.k, flipped: m.pack?.items.length ?? 0, carry: m.carry.n, done: true, mark: !!m.pack });
    this.played = true;
  }

  stop(): void { cancelAnimationFrame(this.frame); for (const t of this.timers) clearTimeout(t); this.timers = []; }

  private later(ms: number, run: () => void): void { this.timers.push(window.setTimeout(run, ms)); }
}
