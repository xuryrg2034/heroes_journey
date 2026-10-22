/**
 * Task 51з «Поход дня» — the view's parts (docs/realtime-slice.md, «Поход дня»; the core is run/rtDaily.ts):
 * - the attempt's session kept across a reload (`DailySessionStore`): the journal of the run's steps and the fights' journals;
 * - the proof's tools (`DailyTools`): «Сохранить» (the file `daily-ГГГГ-ММ-ДД.json`), «Проверить» (the kept proof), «Проверить файл`;
 * - the html of the button at the fire, its panel and the end screen's block.
 * View only: the run's steps go through the core's `rtStep` (RunView `go`), the rules and the check are the core's.
 */
import { checkDailyProof, rtDailyClaimText, type RtDailyClaim, type RtDailyProofStore, type RtDailyView, type RtStepCall } from '../run/rtDaily';
import type { Journal } from '../sim/simulation';
import type { KeyValueStore } from '../telemetry/buffer';

/** The date for the player: `ГГГГ-ММ-ДД` (the seed's and the file's form) as `ДД.ММ.ГГГГ`. */
export const dailyDateText = (date: string): string => date.split('-').reverse().join('.');
const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** One attempt in progress: the date, the attempt's number, the run's steps, the fights' journals in order; `broken` — a step or a journal is missing (no proof). */
export interface DailySession { date: string; attempt: number; steps: RtStepCall[]; journals: Journal[]; broken: boolean }

export const DAILY_SESSION_KEY = 'ashen-oath-rt-daily-session-v1';
export const DAILY_FIGHTS_KEY = 'ashen-oath-rt-daily-fights-v1';

/** The session in the viewer's `localStorage` (steps — small, saved at every step; the journals — their own key, saved when a fight ends). */
export class DailySessionStore {
  constructor(private readonly store: KeyValueStore | null) {}
  load(): DailySession | null {
    try {
      const head = JSON.parse(this.store?.getItem(DAILY_SESSION_KEY) ?? 'null') as Partial<DailySession> | null;
      if (!head || typeof head.date !== 'string' || !Number.isInteger(head.attempt) || !Array.isArray(head.steps)) return null;
      const journals = JSON.parse(this.store?.getItem(DAILY_FIGHTS_KEY) ?? '[]') as unknown;
      const list = Array.isArray(journals) ? journals as Journal[] : [];
      const fights = head.steps.filter(call => call?.fn === 'resolveArena').length;
      return { date: head.date, attempt: head.attempt as number, steps: head.steps, journals: list, broken: head.broken === true || fights !== list.length };
    } catch { return null; }
  }
  /** The steps (and `broken`); with `fights` also the journals. */
  save(session: DailySession, fights = false): void {
    try {
      this.store?.setItem(DAILY_SESSION_KEY, JSON.stringify({ date: session.date, attempt: session.attempt, steps: session.steps, broken: session.broken }));
      if (fights) this.store?.setItem(DAILY_FIGHTS_KEY, JSON.stringify(session.journals));
    } catch { session.broken = true; /* full or blocked: the attempt plays on, its proof cannot be kept after a reload */ }
  }
  clear(): void { try { this.store?.removeItem(DAILY_SESSION_KEY); this.store?.removeItem(DAILY_FIGHTS_KEY); } catch { /* optional */ } }
}

/** The tip of «Сохранить» and «Проверить» while the date has no proof. */
const NO_PROOF = 'Сначала пройди поход дня';

/** «Сохранить», «Проверить», «Проверить файл» of the best attempt's proof of a date (the buttons stand in the camp's panel and on the run's end screen). */
export class DailyTools {
  /** The last answer of a check or a save (shown under the buttons). */
  status = '';
  constructor(
    readonly proofs: RtDailyProofStore,
    private readonly build: () => string,
    /** A proof of `date` passed the check (telemetry). */
    private readonly verified: (date: string) => void,
    private readonly redraw: () => void,
  ) {}

  /** The buttons (and the hidden file input) for the proof of `date`; `has` — the best attempt's proof is kept. */
  buttonsHtml(date: string, has: boolean): string {
    return `<div class="rt-daily-proof" data-testid="daily-proof">`
      + `<button class="rt-other" data-action="daily-save" data-date="${date}" data-testid="daily-save"${has ? '' : ` disabled title="${NO_PROOF}"`}>Сохранить</button>`
      + `<button class="rt-other" data-action="daily-verify" data-date="${date}" data-testid="daily-verify"${has ? '' : ` disabled title="${NO_PROOF}"`}>Проверить</button>`
      + `<button class="rt-other" data-action="daily-file-pick" data-testid="daily-file-pick">Проверить файл</button>`
      + `<input type="file" accept=".json,application/json" hidden data-action="daily-file" data-testid="daily-file"></div>`
      + `<p class="rt-daily-status" data-testid="daily-status">${esc(this.status)}</p>`;
  }

  /** A click on a button of `buttonsHtml`; true — it was one of ours. */
  click(target: HTMLElement): boolean {
    const action = target.dataset.action;
    if (action === 'daily-save') { this.save(target.dataset.date ?? ''); return true; }
    if (action === 'daily-verify') { void this.verifyKept(target.dataset.date ?? ''); return true; }
    if (action === 'daily-file-pick') { target.parentElement?.querySelector<HTMLInputElement>('input[type="file"]')?.click(); return true; }
    return action === 'daily-file';
  }
  /** The file input changed; true — it was ours. */
  change(target: HTMLElement): boolean {
    if (target.dataset.action !== 'daily-file') return false;
    const input = target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (file) void this.verifyFile(file);
    return true;
  }

  /** The proof as `daily-ГГГГ-ММ-ДД.json` (a download). */
  save(date: string): void {
    const proof = this.proofs.proof(date);
    if (!proof) { this.say('Сохранять нечего: доказательства этого дня нет.'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(proof)], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = `daily-${date}.json`; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.say(`Сохранено: daily-${date}.json`);
  }
  async verifyKept(date: string): Promise<void> {
    const proof = this.proofs.proof(date);
    await this.check(proof, 'Доказательства этого дня нет.');
  }
  async verifyFile(file: File): Promise<void> {
    let value: unknown = null;
    try { value = JSON.parse(await file.text()); } catch { this.say('Не удалось прочитать файл.'); return; }
    await this.check(value, 'Это не файл «Похода дня».');
  }
  private async check(value: unknown, missing: string): Promise<void> {
    if (value === null || value === undefined) { this.say(missing); return; }
    let result;
    try { result = await checkDailyProof(value, this.build()); } catch { this.say('Проверка не удалась.'); return; }
    if (result.ok) {
      this.verified((value as { date: string }).date);
      this.say(`Проверено: ${dailyDateText((value as { date: string }).date)} · ${rtDailyClaimText(result.claim)}`);
    } else this.say(result.otherBuild ? `${result.reason}: этот файл не проверить.` : `Не прошло: ${result.reason}`);
  }
  private say(text: string): void { this.status = text; this.redraw(); }
}

/** The button beside «В поход» at the fire (closed before the first win: its reason stands under the pair, `dailyReasonHtml`). */
export function dailyButtonHtml(view: RtDailyView): string {
  return view.unlocked
    ? '<button class="rt-other rt-hearth-daily" data-action="daily-open" data-testid="hearth-daily">Поход дня</button>'
    : `<button class="rt-other rt-hearth-daily" disabled data-testid="hearth-daily" title="${esc(view.reason)}">Поход дня</button>`;
}
export function dailyReasonHtml(view: RtDailyView): string {
  return view.unlocked ? '' : `<small class="rt-hearth-daily-reason" data-testid="hearth-daily-reason">${esc(view.reason)}</small>`;
}

const claimLine = (label: string, claim: RtDailyClaim | null): string => claim ? `<li data-testid="daily-${label === 'Первая' ? 'first' : 'best'}">${label}: ${esc(rtDailyClaimText(claim))}</li>` : '';

/** The panel of the run of the day over the camp: the date, the attempts, «Начать» (or why not), the proof's buttons. */
export function dailyPanelHtml(view: RtDailyView, tools: DailyTools): string {
  const tries = view.tries ? `<p class="rt-daily-tries" data-testid="daily-tries">Попыток сегодня: ${view.tries}</p>` : '';
  const results = view.first || view.best ? `<ul class="rt-daily-results">${claimLine('Первая', view.first)}${claimLine('Лучшая', view.best)}</ul>` : '';
  const start = view.canStart
    ? `<button class="rt-again" data-action="daily-start" data-testid="daily-start">${view.tries ? 'Ещё попытка' : 'Начать'}</button>`
    : `<button class="rt-again" disabled data-testid="daily-start">Начать</button><p class="rt-run-note" data-testid="daily-reason">${esc(view.reason)}</p>`;
  return `<div class="rt-overlay rt-hearth-modal" data-action="daily-close" data-testid="daily-panel"><div class="rt-card rt-daily-card">`
    + `<h2>Поход дня</h2><p class="rt-daily-date" data-testid="daily-date">${dailyDateText(view.date)} · один лес для всех</p>`
    + `<p class="rt-run-note">Опыт и награды в лагерь не идут. Итог можно сохранить в файл и проверить повтором.</p>`
    + `${tries}${results}${start}${tools.buttonsHtml(view.date, view.proof)}`
    + `<button class="rt-other" data-action="daily-close" data-testid="daily-close">Закрыть</button></div></div>`;
}

/** The end screen's block of a run of the day: the claim, whether it is the best, the proof's buttons (no experience block here). */
export function dailyEndHtml(date: string, claim: RtDailyClaim, view: RtDailyView, best: boolean | null, tools: DailyTools): string {
  const note = best === false ? 'Это не лучшая попытка дня: сохранена лучшая.' : '';
  return `<div class="rt-daily-end" data-testid="daily-end"><p class="rt-daily-claim" data-testid="daily-claim">Поход дня ${dailyDateText(date)}: ${esc(rtDailyClaimText(claim))}</p>`
    + `${note ? `<p class="rt-run-note" data-testid="daily-note">${note}</p>` : ''}${tools.buttonsHtml(date, view.proof)}</div>`;
}
