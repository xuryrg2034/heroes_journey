---
name: no-stash-with-parallel-agents
description: Never use git stash / checkout / reset on the shared working tree while helper agents are editing it
metadata:
  node_type: memory
  type: feedback
  originSessionId: a29eb7ae-8626-4067-acf2-4f0568f3f16b
  modified: 2026-09-29T08:05:27.771Z
---

While background helper agents (engine-dev, ui-dev, docs-keeper, Codex) edit the shared working tree, never run `git stash`, `git checkout -- <path>`, `git reset` or similar on it — not even briefly to read the base version.

**Why:** on 2026-09-29 I ran `git stash -- src` to read committed code while two agents were fixing `src/`; it was harmless only because they had not written yet. A write during that window would conflict or be lost.

**How to apply:** read base versions with `git show <rev>:<path>` or a separate `git worktree add` in the scratchpad; mutate the tree only after all agents in that area have reported. See [[orchestration-workflow]].
