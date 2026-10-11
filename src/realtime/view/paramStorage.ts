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

export function loadLinkDepth(): boolean {
  try { return localStorage.getItem(LINK_DEPTH_KEY) !== '0'; } catch { return true; }
}

export function saveLinkDepth(on: boolean): void {
  try { localStorage.setItem(LINK_DEPTH_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

/**
 * Phase B, track Д5: the sandbox build — a counter talisman (Т1), a relic or the new oath (Т3, 5а) and a hammer (Т2) put into
 * the sandbox loadout from the next arena. Not a Param (Params are hashed: a new key would change the hash of old journals);
 * the loadout goes into the journal as it is. Its own key; storage may be unavailable (then nothing taken).
 */
export interface SandboxBuild { talisman: string; relic: string; hammer: string }
const BUILD_KEY = 'ashen-oath-realtime-sandbox-build';

export function loadSandboxBuild(): SandboxBuild {
  const empty: SandboxBuild = { talisman: '', relic: '', hammer: '' };
  try {
    const raw = JSON.parse(localStorage.getItem(BUILD_KEY) ?? 'null') as Partial<SandboxBuild> | null;
    if (!raw || typeof raw !== 'object') return empty;
    const text = (v: unknown): string => (typeof v === 'string' ? v : '');
    return { talisman: text(raw.talisman), relic: text(raw.relic), hammer: text(raw.hammer) };
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
