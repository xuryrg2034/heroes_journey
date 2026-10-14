---
name: open-flaky-porcupine-test
description: Realtime Playwright flakes (porcupine, boar, wolves, camera ×2, archer mark, goblin lever, pond, П2) fixed 12.10.2026 in 7ca65ab; watch for regressions, write timed waits in game time
metadata:
  node_type: memory
  type: project
  originSessionId: a29eb7ae-8626-4067-acf2-4f0568f3f16b
  modified: 2026-10-12T05:00:00.000Z
---

09–12.10.2026: nine realtime Playwright tests flaked under parallel load (porcupine tremble, sandbox boar, wolves, camera ×2, archer mark, goblin lever, pond, П2). Core fixed them in 7ca65ab (docs e6447ce, docs/realtime-slice.md section 13). Two causes: waits by the wall clock (page plays less game time under load) and "frozen" scenes that still got one group of newcomers. Fix: `tests/realtimeFrames.ts` (`untilFrame`, `gameWait` — probe in the page every frame, bounded by game seconds) and `maxEnemies` 0 in freeze/quiet/still. Each test was shown to fail on a deliberate break; suite ×3 under load 474/474, then ×3 474/474. Design session accepted it 12.10.2026.

**Why:** a real-time flake can hide a timing assumption; the fix must keep real input and not loosen checks.
**How to apply:** if one of these fails again, treat it as a regression (new wall-clock wait or new newcomer path), not as a known flake. New browser tests should wait through `untilFrame`/`gameWait`, not `expect.poll` on positions.
