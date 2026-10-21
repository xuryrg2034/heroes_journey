/**
 * Debug-panel values in localStorage (the view only: the simulation never reads storage).
 *
 * v3 (07.10.2026, stage 3): dimming default 0.65 (design answer 31), wolves replace «fast», boar fields;
 * v1/v2 values are dropped. v4: mixed-color wolf packs by default. v5 (iteration 2, stage A): hero walking,
 * the flow field on by default — older values are dropped so the new defaults apply. v6 (stage B): passable
 * water, the floor before the goals (28) and higher greed floors. v7 (stage C): crystals and chain juice,
 * density penalty 2 by default (design answer 42). v8: crystal drop radius 4. v9 (stage D, user 07.10.2026):
 * enemies ×0.8, the hero walks through enemies (slowed ×0.7 in a crowd), R 1.875. v10–v15: stages D–H.
 * v16 (stage 1 of the transition, user 08.10.2026): the hero anchor is off by default (a talisman later). v17 (iteration 2.1
 * of the slice, 08.10.2026): speed spread ±0.35, healing 9, sandbox hero HP 15, the wandering shield and the quill cycle — older values are
 * dropped so the new defaults apply.
 */
import { defaultParams, sanitizeParams, type Params } from '../sim/params';
import { FX_DEFAULT, fxLevelOf, type FxLevel } from './juice';

/** The storage key of the panel's values (the telemetry header names it: `params.storage`). */
export const PARAMS_STORAGE_KEY = 'ashen-oath-realtime-params-v17';
const STORAGE_KEY = PARAMS_STORAGE_KEY;

export function loadParams(): Params {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return sanitizeParams(text ? JSON.parse(text) : null);
  } catch {
    return defaultParams();
  }
}

export function saveParams(params: Params): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch { /* storage may be unavailable */ }
}

/**
 * Phase A (Т3): role badges under bodies — a local setting of the view, not a Param (Params are hashed): its own key, on by
 * default; storage may be unavailable (then on).
 */
const BADGES_KEY = 'ashen-oath-realtime-role-badges';

export function loadRoleBadges(): boolean {
  try { return localStorage.getItem(BADGES_KEY) !== '0'; } catch { return true; }
}

export function saveRoleBadges(on: boolean): void {
  try { localStorage.setItem(BADGES_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

/**
 * П1 «Глубина звена»: the numbers next to the next-link candidates — a local setting of the view, not a Param (Params are
 * hashed): its own key, on by default in the run and in the sandbox; storage may be unavailable (then on). The sandbox
 * panel's «Вид» and the gear of the run map switch it.
 */
const LINK_DEPTH_KEY = 'ashen-oath-realtime-link-depth';
/** Task 62: the sandbox's «Показать фигуру» (the class word at the centre of a drawn contour; off by default). */
const SHOW_GLYPH_KEY = 'ashen-oath-realtime-show-glyph';

export function loadShowGlyph(): boolean {
  try { return localStorage.getItem(SHOW_GLYPH_KEY) === '1'; } catch { return false; }
}

export function saveShowGlyph(on: boolean): void {
  try { localStorage.setItem(SHOW_GLYPH_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

export function loadLinkDepth(): boolean {
  try { return localStorage.getItem(LINK_DEPTH_KEY) !== '0'; } catch { return true; }
}

export function saveLinkDepth(on: boolean): void {
  try { localStorage.setItem(LINK_DEPTH_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

/**
 * The run's sound (design 14.10.2026): the switch «Звук» and the slider «Громкость» on the gear of the run map — a local setting
 * of the view, not a Param (Params are hashed; the run plays the default ones, so the sandbox panel's «Звук удара» no longer
 * reaches it). Everything outside the sandbox (the run and the prologue) plays by it; the sandbox keeps its panel. Its own key;
 * storage may be unavailable or hold junk (then on, 0.3 — the Params' defaults).
 */
export interface SoundSetting { on: boolean; volume: number }
const SOUND_KEY = 'ashen-oath-realtime-sound';
export const SOUND_DEFAULT: SoundSetting = { on: true, volume: 0.3 };

export function loadSound(): SoundSetting {
  try {
    const raw = JSON.parse(localStorage.getItem(SOUND_KEY) ?? 'null') as Partial<SoundSetting> | null;
    if (!raw || typeof raw !== 'object') return { ...SOUND_DEFAULT };
    const volume = typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : SOUND_DEFAULT.volume;
    return { on: typeof raw.on === 'boolean' ? raw.on : SOUND_DEFAULT.on, volume };
  } catch { return { ...SOUND_DEFAULT }; }
}

export function saveSound(sound: SoundSetting): void {
  try { localStorage.setItem(SOUND_KEY, JSON.stringify({ on: sound.on, volume: sound.volume })); } catch { /* storage may be unavailable */ }
}

/**
 * Phase B, track Д5: the sandbox build — a counter talisman (Т1), a relic or the new oath (Т3, 5а) and a hammer (Т2) put into
 * the sandbox loadout from the next arena. Not a Param (Params are hashed: a new key would change the hash of old journals);
 * the loadout goes into the journal as it is. Its own key; storage may be unavailable (then nothing taken).
 */
export interface SandboxBuild {
  talisman: string; relic: string; hammer: string;
  /** Task 29: the forms by field (sim/buildIds.ts `FORM_FIELD`) — «Конец», «Звено», «Путь»; '' — none. Old saves: none. */
  end: string; link: string; path: string;
  /** Task 50: the chosen counter is on rank II («II» by the counter; acts only with «Счётчики: окно — одна цепь»). Old saves: no. */
  honed?: boolean;
}
const BUILD_KEY = 'ashen-oath-realtime-sandbox-build';

export function loadSandboxBuild(): SandboxBuild {
  const empty: SandboxBuild = { talisman: '', relic: '', hammer: '', end: '', link: '', path: '' };
  try {
    const raw = JSON.parse(localStorage.getItem(BUILD_KEY) ?? 'null') as Partial<SandboxBuild> | null;
    if (!raw || typeof raw !== 'object') return empty;
    const text = (v: unknown): string => (typeof v === 'string' ? v : '');
    return { talisman: text(raw.talisman), relic: text(raw.relic), hammer: text(raw.hammer), end: text(raw.end), link: text(raw.link), path: text(raw.path), ...raw.honed === true ? { honed: true } : {} };
  } catch { return empty; }
}

export function saveSandboxBuild(build: SandboxBuild): void {
  try { localStorage.setItem(BUILD_KEY, JSON.stringify(build)); } catch { /* storage may be unavailable */ }
}

/**
 * П7 «Часы сессии»: the end-screen line and the 90-minute nudge on the run map — a local setting of the view, not a Param:
 * its own key, on by default; storage may be unavailable (then on). The gear of the run map switches it.
 */
const SESSION_CLOCK_KEY = 'ashen-oath-realtime-session-clock';

export function loadSessionClock(): boolean {
  try { return localStorage.getItem(SESSION_CLOCK_KEY) !== '0'; } catch { return true; }
}

export function saveSessionClock(on: boolean): void {
  try { localStorage.setItem(SESSION_CLOCK_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

/**
 * П8 «Новое на карте»: the sign «✦ новое» on the node card and the one-time captions in a fight — a local setting of the
 * view, not a Param: its own key, on by default; storage may be unavailable (then on). The gear of the run map switches it.
 */
const NEW_ON_MAP_KEY = 'ashen-oath-realtime-new-on-map';

export function loadNewOnMap(): boolean {
  try { return localStorage.getItem(NEW_ON_MAP_KEY) !== '0'; } catch { return true; }
}

export function saveNewOnMap(on: boolean): void {
  try { localStorage.setItem(NEW_ON_MAP_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

/**
 * «Обучение» (view/hints.ts, view/worldLabels.ts): the toggle «Подсказки» of the run map's gear — the world labels in a fight, the pulse of
 * the consumable slots and the lines on the run screens. A local setting of the view, not a Param: its own key, on by default; storage may be unavailable (then on).
 * What was already shown is the memory `ashen-oath-realtime-hints` (HintStore), not this key.
 */
const HINTS_ON_KEY = 'ashen-oath-realtime-hints-on';

export function loadHintsOn(): boolean {
  try { return localStorage.getItem(HINTS_ON_KEY) !== '0'; } catch { return true; }
}

export function saveHintsOn(on: boolean): void {
  try { localStorage.setItem(HINTS_ON_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

/**
 * Task 35, С1 «Тряска и вспышки» (view/juice.ts): the viewer's level 0 / 50 / 100 % of the camera shake and the full-screen flash —
 * a local setting of the view, not a Param (the hash and the journal stay): the gear of the run map and the sandbox panel's «Вид»
 * set it, the run, the prologue and the sandbox play by it. Its own key; storage may be unavailable or hold junk (then 100).
 */
const FX_KEY = 'ashen-oath-realtime-fx';

export function loadFx(): FxLevel {
  try { return fxLevelOf(localStorage.getItem(FX_KEY)); } catch { return FX_DEFAULT; }
}

export function saveFx(level: FxLevel): void {
  try { localStorage.setItem(FX_KEY, String(level)); } catch { /* storage may be unavailable */ }
}
