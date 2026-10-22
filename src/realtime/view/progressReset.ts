/**
 * User request 22.10.2026: «Сбросить прогресс» in the gear of the run map. The viewer's game progress goes; the page then
 * reloads and plays as a first-time player's (the prologue «Опушка», the camp with nothing open).
 *
 * Removed: the run (`-v7`, and `-v6` that is still read), the profile (meta, heroes, «Испытание», «Летопись», trophies, the
 * schedule's history, the day's log), the day's proof and its attempt, the prologue's mark, the labels and «✦ новое» already
 * shown, the chain record. Kept: the settings (sound, «Тряска и вспышки», «Подсказки», the view toggles, the sandbox's
 * params and build, the debug panel), the session clock (the time of play, not progress) and the telemetry (the fights' logs
 * of «Логи» — data of the tester, not of the game).
 */
import { RT_DAILY_PROOF_KEY } from '../run/rtDaily';
import { RT_PROFILE_STORAGE_KEY, RT_RUN_STORAGE_KEY, RT_RUN_STORAGE_KEY_V6 } from '../run/rtRunStorage';
import { CHAIN_RECORD_KEY } from './chainRecord';
import { DAILY_FIGHTS_KEY, DAILY_SESSION_KEY } from './dailyView';
import { FIRST_MEET_KEY } from './firstMeet';
import { HINTS_KEY } from './hints';
import { NEW_SEEN_KEY } from './newSeen';
import { PROLOGUE_KEY } from './prologueFlow';

export const PROGRESS_KEYS: readonly string[] = [
  RT_RUN_STORAGE_KEY, RT_RUN_STORAGE_KEY_V6, RT_PROFILE_STORAGE_KEY, RT_DAILY_PROOF_KEY, DAILY_SESSION_KEY, DAILY_FIGHTS_KEY,
  PROLOGUE_KEY, FIRST_MEET_KEY, HINTS_KEY, NEW_SEEN_KEY, CHAIN_RECORD_KEY,
];

/** Removes the progress keys; storage is optional (without it, or when it throws, nothing is removed). */
export function resetProgress(storage: Pick<Storage, 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  for (const key of PROGRESS_KEYS) try { storage?.removeItem(key); } catch { /* Storage is optional. */ }
}
