/**
 * Task 51ж «Разминка», the DOM of an attempt (view/warmupFlow.ts holds the texts): the corner button «Выход» while the attempt plays and
 * the result panel when it ended — the score, the record, the NPC's line, «Ещё раз» and «В лагерь». A view feature only: nothing here is
 * read by the simulation; no command is sent.
 */
import type { WarmupResultText } from './warmupFlow';

/** What the panel shows now (the tests read it through `snapshot().warmup`). */
export interface WarmupPanelShown { open: boolean; title: string; line: string; record: string; isRecord: boolean; say: string; speaker: string }

export class WarmupDom {
  readonly exit = document.createElement('button');
  readonly panel = document.createElement('div');
  private readonly card = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly line = document.createElement('p');
  private readonly record = document.createElement('p');
  private readonly say = document.createElement('p');
  readonly again = document.createElement('button');
  readonly back = document.createElement('button');
  readonly shown: WarmupPanelShown = { open: false, title: '', line: '', record: '', isRecord: false, say: '', speaker: '' };

  constructor() {
    this.exit.className = 'rt-warmup-exit';
    this.exit.type = 'button';
    this.exit.setAttribute('data-testid', 'warmup-exit');
    this.exit.textContent = 'Выход';
    this.exit.hidden = true;
    this.panel.className = 'rt-overlay rt-warmup';
    this.panel.setAttribute('data-testid', 'warmup-result');
    this.panel.hidden = true;
    this.card.className = 'rt-card rt-warmup-card';
    this.line.className = 'rt-warmup-score';
    this.line.setAttribute('data-testid', 'warmup-score');
    this.record.className = 'rt-warmup-record';
    this.record.setAttribute('data-testid', 'warmup-record');
    this.say.className = 'rt-warmup-say';
    this.say.setAttribute('data-testid', 'warmup-say');
    this.say.hidden = true;
    const buttons = document.createElement('div');
    buttons.className = 'rt-result-buttons';
    this.again.className = 'rt-again';
    this.again.type = 'button';
    this.again.textContent = 'Ещё раз';
    this.again.setAttribute('data-testid', 'warmup-again');
    this.back.className = 'rt-other';
    this.back.type = 'button';
    this.back.textContent = 'В лагерь';
    this.back.setAttribute('data-testid', 'warmup-camp');
    buttons.append(this.again, this.back);
    this.card.append(this.title, this.line, this.record, this.say, buttons);
    this.panel.append(this.card);
    // A focused button would be clicked again by Space (the jump key).
    for (const button of [this.exit, this.again, this.back]) button.addEventListener('click', () => button.blur());
  }

  /** The two elements for `host.append`. */
  get elements(): HTMLElement[] { return [this.exit, this.panel]; }

  /** The attempt's result: `say` — the NPC's line of a new record (speaker's name, text), none otherwise. */
  showResult(text: WarmupResultText, say: { who: string; text: string } | null): void {
    this.title.textContent = text.title;
    this.line.textContent = text.line;
    this.record.textContent = text.record;
    this.record.hidden = !text.record;
    this.record.classList.toggle('rt-new', text.isRecord);
    this.say.hidden = !say;
    this.say.replaceChildren();
    if (say) { const who = document.createElement('b'); who.textContent = `${say.who}: `; this.say.append(who, say.text); }
    this.exit.hidden = true;
    this.panel.hidden = false;
    Object.assign(this.shown, { open: true, title: text.title, line: text.line, record: text.record, isRecord: text.isRecord, say: say?.text ?? '', speaker: say?.who ?? '' });
  }

  hideResult(): void { this.panel.hidden = true; this.shown.open = false; }
}
