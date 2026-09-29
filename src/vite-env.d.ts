/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" keeps window.__PUZZLE_GAME test hooks in a production build. */
  readonly VITE_E2E_HOOKS?: string;
}
