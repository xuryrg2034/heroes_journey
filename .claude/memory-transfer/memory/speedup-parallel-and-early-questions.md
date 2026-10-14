---
name: speedup-parallel-and-early-questions
description: User chose (09.10.2026) to speed up feature work by parallel helper tracks and by helpers sending assumptions/questions at the start; full verify and Playwright repeats stay as before
metadata:
  node_type: memory
  type: feedback
  originSessionId: a29eb7ae-8626-4067-acf2-4f0568f3f16b
  modified: 2026-10-08T20:34:18.791Z
---

To speed up feature steps, the user chose (09.10.2026) two of four offered options:
- **Parallel tracks**: run independent work (e.g. enemy behaviors vs arena layouts) in separate helpers with worktree isolation at the same time, even if the design doc lists them as sequential steps.
- **Questions first**: a helper first reads the task and returns its assumptions and design questions (~10–15 min), the orchestrator relays them to the design session, then resumes the helper with answers — instead of questions arriving only after the code is done.

Not chosen (keep as before): skipping the full turn-based `verify.sh --browser` for realtime-only diffs; fewer Playwright repeats in helpers (helpers still run `--repeat-each 3`).

**Why:** a step took 1.5–2.5 h, mostly waiting (late design Q&A → rework round, serial checks).
**How to apply:** for each new step, launch helpers in a planning-and-questions phase first; split independent work into parallel worktree helpers with disjoint files. See [[verify-in-clean-worktree]], [[no-stash-with-parallel-agents]].
