/**
 * Debug-panel values in localStorage (the view only: the simulation never reads storage).
 *
 * v3 (07.10.2026, stage 3): dimming default 0.65 (design answer 31), wolves replace «fast», boar fields;
 * v1/v2 values are dropped. v4: mixed-color wolf packs by default. v5 (iteration 2, stage A): hero walking,
 * the flow field on by default — older values are dropped so the new defaults apply. v6 (stage B): passable
 * water, the floor before the goals (28) and higher greed floors. v7 (stage C): crystals and chain juice,
 * density penalty 2 by default (design answer 42). v8: crystal drop radius 4. v9 (stage D, user 07.10.2026):
 * enemies ×0.8, the hero walks through enemies (slowed ×0.7 in a crowd), R 1.875. v10–v15: stages D–H.
 * v16 (stage 1 of the transition, user 08.10.2026): the hero anchor is off by default (a talisman later).
 */
import { defaultParams, sanitizeParams, type Params } from '../sim/params';

const STORAGE_KEY = 'ashen-oath-realtime-params-v16';

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
