---
name: no-npm-through-symlinked-node-modules
description: never run npm ci/install in a scratch tree whose node_modules is a symlink to the repo's; it wipes the shared install
metadata:
  type: feedback
---

A scratch/verify tree often links `node_modules` to the main repo's folder. `npm ci` there follows the link and empties the shared `node_modules` (happened 11.10.2026: core's verify-tree2 wiped the repo install; playtest server and smoke checks broke).

**Why:** parallel sessions share the repo install; an empty folder breaks builds, Playwright and the dev server for everyone.

**How to apply:** before npm ci/install in any tree, check `ls -la node_modules` for a symlink; give the tree its own install instead. The design session's builds use their own install at `$S/deps/node_modules` (`$S/v1/node_modules` links there; smoke scripts import playwright from it). Related: [[verify-in-clean-worktree]], [[no-stash-with-parallel-agents]].
