/**
 * The «Логи» panel of the real-time telemetry (docs/realtime-telemetry.md, decisions 4–5; track ТA): opened from the run
 * map's header, the end of the run and the sandbox menu — never in a fight. It shows how many records the browser keeps,
 * how many no sink took yet and their size; an optional tester name (goes into `tester`); «Копировать» — the export JSON to the clipboard
 * (`ClipboardItem` with a promised blob, then `writeText`, else the page hook `window.__rtTelemetryExport` or a download link); «Очистить» asks in the panel itself.
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
    const exportButton = this.button('rt-again', 'Копировать', 'logs-export', () => void this.copy());
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

  /**
   * «Копировать» (11.10.2026, user decision): the export JSON goes to the clipboard. The first call into the clipboard is
   * synchronous in the click handler and the text is a promise — Safari and Firefox drop the user gesture after an `await`
   * and the export reads IndexedDB. Fallbacks: `writeText`, then the old file path (page hook, else `<a download>`).
   */
  private async copy(): Promise<void> {
    this.recorder.tester = this.name.value;
    const filePromise = this.recorder.exportFile();
    const clipboard = this.win.navigator?.clipboard as Clipboard | undefined;
    const Item = (this.win as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    let written: Promise<void> | null = null;
    try {
      if (clipboard && typeof clipboard.write === 'function' && Item) {
        written = clipboard.write([new Item({ 'text/plain': filePromise.then(f => new Blob([f.text], { type: 'text/plain' })) })]);
      }
    } catch { written = null; }
    try {
      let file: Awaited<typeof filePromise> | null = null;
      let copied = false;
      if (written) { try { await written; copied = true; } catch { copied = false; } }
      file = await filePromise;
      if (!copied && clipboard && typeof clipboard.writeText === 'function') {
        try { await clipboard.writeText(file.text); copied = true; } catch { copied = false; }
      }
      if (copied) {
        const size = (new Blob([file.text]).size / 1024).toFixed(1).replace('.', ',');
        this.status.textContent = `Скопировано: ${file.records} ${recordsWord(file.records)}, ${size} КиБ. Вставьте в сообщение.`;
        return;
      }
      const hook = this.win.__rtTelemetryExport;
      if (typeof hook === 'function') await hook(file.filename, file.text);
      else {
        const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = file.filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      this.status.textContent = 'Буфер недоступен — сохранён файл';
    } catch (error) {
      this.status.textContent = `Копирование не удалось: ${String(error instanceof Error ? error.message : error)}`;
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

/** «запись / записи / записей» for a count (1 запись, 2 записи, 5 записей, 11 записей, 21 запись). */
export function recordsWord(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'запись';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'записи';
  return 'записей';
}
