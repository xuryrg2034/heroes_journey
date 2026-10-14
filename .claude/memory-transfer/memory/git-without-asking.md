---
name: git-without-asking
description: "User (13.10.2026) lets git commands run without approval; avoid `cd X && git` compounds that trigger prompts"
metadata:
  node_type: memory
  type: feedback
  originSessionId: a29eb7ae-8626-4067-acf2-4f0568f3f16b
  modified: 2026-10-13T00:12:09.413Z
---

The user grants git work without asking: «Даю тебе права это просто делать» (13.10.2026). Allow rule `Bash(git:*)` is in `.claude/settings.local.json` (gitignored).

**Why:** the user saw a permission prompt for almost every git call; most came from `cd <path> && git …` compounds, which the harness prompts on.

**How to apply:** use `git -C <path> …` and absolute paths instead of `cd … &&`. The shared-tree rules still hold: no stash/checkout/reset in the shared tree, commit own files by path, check the remote before push ([[no-stash-with-parallel-agents]], [[no-push-of-others-commits]]).
