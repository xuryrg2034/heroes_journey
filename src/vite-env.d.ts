/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" keeps window.__PUZZLE_GAME test hooks in a production build. */
  readonly VITE_E2E_HOOKS?: string;
}

/** Build id for telemetry: short commit, "+dirty" for local changes, "unknown" without git (vite.config.ts). */
declare const __RT_BUILD__: string;
