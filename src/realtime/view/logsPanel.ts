/**
 * The «Логи» panel of the real-time telemetry (docs/realtime-telemetry.md, decisions 4–5; track ТA): opened from the run
 * map's header, the end of the run and the sandbox menu — never in a fight. It shows how many records the browser keeps,
 * how many no sink took yet and their size; an optional tester name (goes into `tester`); «Экспорт» — the page hook
 * `window.__rtTelemetryExport` first, else a download link; «Очистить» asks in the panel itself.
 */
import type { RtRecorder } from '../telemetry/recorder';
import type { RtTelemetryWindow } from '../telemetry/schema';

const kib = (chars: number): string => (chars < 1024 ? `${chars} Б` : chars < 1024 * 1024 ? `${(chars / 1024).toFixed(0)} КБ` : `${(chars / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`);

export class LogsPanel {
  readonly el: HTMLDivElement;
  private readonly stats: HTMLParagraphElement;
  private readonly status: HTMLParagraphElement;
  private readonly name: HTMLInputElement;
  private readonly confirm: HTMLDivElement;
  private readonly clearButton: HTMLButtonElement;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly recorder: RtRecorder, private readonly win: RtTelemetryWindow & Window = window) {
    this.el = document.createElement('div');
    this.el.className = 'rt-overlay rt-logs';
    this.el.setAttribute('data-testid', 'logs');
    this.el.hidden = true;
    const card = document.createElement('div');
    card.className = 'rt-card rt-logs-card';
    card.innerHTML = '<h2>Логи плейтеста</h2>';
    this.stats = document.createElement('p');
    this.stats.className = 'rt-logs-stats';
    this.stats.setAttribute('data-testid', 'logs-stats');
    const label = document.createElement('label');
    label.className = 'rt-logs-name';
    label.textContent = 'Имя тестера (необязательно) ';
    this.name = document.createElement('input');
    this.name.type = 'text';
    this.name.maxLength = 64;
    this.name.placeholder = 'без имени';
    this.name.setAttribute('data-testid', 'logs-tester');
    this.name.addEventListener('change', () => { this.recorder.tester = this.name.value; });
    label.appendChild(this.name);
    const buttons = document.createElement('div');
    buttons.className = 'rt-logs-buttons';
    const exportButton = this.button('rt-again', 'Экспорт', 'logs-export', () => void this.export());
    this.clearButton = this.button('rt-other', 'Очистить', 'logs-clear', () => { this.confirm.hidden = false; this.clearButton.hidden = true; });
    const close = this.button('rt-other', 'Закрыть', 'logs-close', () => this.close());
    buttons.append(exportButton, this.clearButton, close);
    this.confirm = document.createElement('div');
    this.confirm.className = 'rt-logs-confirm';
    this.confirm.hidden = true;
    this.confirm.append(Object.assign(document.createElement('span'), { textContent: 'Удалить все записи из браузера? ' }),
      this.button('rt-other', 'Да, удалить', 'logs-clear-yes', () => void this.clear()),
      this.button('rt-other', 'Нет', 'logs-clear-no', () => { this.confirm.hidden = true; this.clearButton.hidden = false; }));
    this.status = document.createElement('p');
    this.status.className = 'rt-logs-status';
    this.status.setAttribute('data-testid', 'logs-status');
    card.append(this.stats, label, buttons, this.confirm, this.status);
    this.el.appendChild(card);
    this.el.addEventListener('click', event => { if (event.target === this.el) this.close(); });
  }

  private button(className: string, text: string, testId: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.setAttribute('data-testid', testId);
    b.addEventListener('click', () => { b.blur(); onClick(); });
    return b;
  }

  get open(): boolean { return !this.el.hidden; }

  show(): void {
    this.el.hidden = false;
    this.name.value = this.recorder.tester;
    this.confirm.hidden = true;
    this.clearButton.hidden = false;
    this.status.textContent = '';
    this.refresh();
    this.timer ??= setInterval(() => this.refresh(), 1000);
  }

  close(): void {
    this.recorder.tester = this.name.value;
    this.el.hidden = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  refresh(): void {
    const s = this.recorder.stats();
    this.stats.textContent = `Записей ${s.records} · не доставлено ${s.undelivered} · ${kib(s.chars)}${s.bufferFull ? ' · буфер полон: часть записей только в памяти вкладки' : ''}`;
  }

  private async export(): Promise<void> {
    this.recorder.tester = this.name.value;
    try {
      const file = await this.recorder.exportFile();
      const hook = this.win.__rtTelemetryExport;
      if (typeof hook === 'function') await hook(file.filename, file.text);
      else {
        const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = file.filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      this.status.textContent = `Экспорт: ${file.records} записей, ${file.filename}`;
    } catch (error) {
      this.status.textContent = `Экспорт не удался: ${String(error instanceof Error ? error.message : error)}`;
    }
  }

  private async clear(): Promise<void> {
    await this.recorder.clear();
    this.confirm.hidden = true;
    this.clearButton.hidden = false;
    this.status.textContent = 'Записи удалены.';
    this.refresh();
  }
}
