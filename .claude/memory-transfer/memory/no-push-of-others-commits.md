---
name: no-push-of-others-commits
description: "In the shared repo tree, never push while another session has unpushed local commits; commit own docs from a separate worktree"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8751faa6-8af0-47bc-8359-b9a6615871d9
  modified: 2026-10-11T15:13:14.369Z
---

On 11.10.2026 I committed a research doc in the shared tree and ran `git pull --rebase && git push`. The push carried core's unpushed oath-stake commits to origin before core pushed them itself.

**Why:** core pushes only after its own review and full verify; my push bypasses its gate (that time the commits had passed, by luck).

**How to apply:** before any push from the shared tree, run `git log origin/<branch>..HEAD`; if it lists commits that are not mine, do not push — commit docs from a separate worktree (`git worktree add` in the scratchpad) or ask core to push. Related: [[verify-in-clean-worktree]], [[no-stash-with-parallel-agents]].
