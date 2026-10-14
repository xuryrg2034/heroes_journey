---
name: verify-in-clean-worktree
description: "When other sessions edit the shared tree, run verify.sh in a clean git worktree outside the repo, not in the shared tree"
metadata:
  node_type: memory
  type: feedback
  originSessionId: a29eb7ae-8626-4067-acf2-4f0568f3f16b
  modified: 2026-10-03T23:07:53.117Z
---

Run full checks (`verify.sh --browser`: typecheck, every test:*, build, realtime Playwright) in a clean detached worktree under the session scratchpad (outside the repo, `node_modules` symlinked), not in the shared tree, whenever the design session or helpers may be editing files.

**Why:** 04.10.2026 the shared tree held another session's uncommitted battles (`den-quill-screen` broke three registry-wide sets), and edits inside the repo (including helper worktrees under `.claude/worktrees/`) make Vite reload pages, so Playwright failed with «Execution context was destroyed». Results in the shared tree were not about my change.

**How to apply:** `git worktree add --detach <scratchpad>/verify-tree HEAD` (or `checkout -f --detach <sha>` in that scratch worktree), copy only my changed files in, run there. Never chain `git commit`/`push` after test commands with `&&` without checking their output — a failing test does not stop the chain when its output is piped. Never run `npm ci` / `npm install` in a scratch worktree whose `node_modules` is a symlink to the main tree's: npm follows the link and empties the shared `node_modules` (11.10.2026: it broke the design session's smokes). Check `ls -la <worktree> | grep node_modules` first; verify-tree2 now has its own real `node_modules`. Related: [[no-stash-with-parallel-agents]].
