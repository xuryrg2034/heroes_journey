---
name: turn-based-dropped
description: 11.10.2026 the turn-based game was removed (user decision, confirmed directly); realtime only; history under tag turn-based-final
metadata:
  type: project
---

User (11.10.2026, relayed by design, then confirmed to me directly): «пошаговую вообще не трогай… Можем вообще её убить, пусть будет в гит истории. Фул фокус на реалтайм». Done the same day: tag `turn-based-final` = 3830767 (pushed); what realtime used moved to `src/realtime/forest/` and `src/realtime/art/` (bit-for-bit equivalence probe on 200 seeds); `src/game`, `src/render`, `src/editor`, `src/main.ts` deleted (4c63101); `index.html` is the realtime game, `realtime.html` redirects; AGENTS.md rewritten (1f85477).

**Why:** realtime is the only direction; guarding turn-based cost verify time and blocked changes.

**How to apply:** acceptance = typecheck, every `npm run test:*` (all realtime now), build, Playwright realtime x3 (`npx playwright test` runs the realtime suite). No golden, no turn-based checks. `src/realtime/forest/*` outputs for a seed (maps, node seeds, events, shop) must not change without a decision — saves and journals depend on them. Related: [[verify-in-clean-worktree]].
