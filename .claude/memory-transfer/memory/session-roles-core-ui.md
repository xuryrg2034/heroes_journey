---
name: session-roles-core-ui
description: "Peer sessions for Ashen Oath — design (lead/acceptance), core (sim, integration, full verify, push), ui (view/HUD/CSS) created by the user 13.10.2026"
metadata:
  node_type: memory
  type: project
  originSessionId: 8751faa6-8af0-47bc-8359-b9a6615871d9
  modified: 2026-10-13T06:56:33.371Z
---

13.10.2026 the user created a separate Claude session named **ui** for interface work. Split since then:
- **design** (this role) — design decisions, spec files in scratchpad, acceptance by 1280×720 screenshots, build/publish/LAN server, reports to the user.
- **core** — simulation (`sim/`, `run/`), telemetry, rules-reviewer reviews, integration of all commits, full verify, one push per package.
- **ui** — view only (`src/realtime/view/`, `realtime.css`): HUD, action bar, map cards, prologue visuals. Commits in its own branch/worktree; core integrates.

**Why:** the user wants UI handled by a dedicated session in parallel with sim work.
**How to apply:** send view tasks to `ui`, sim tasks to `core`; ask them to agree data seams directly; never let both edit the same view files. Related: [[no-stash-with-parallel-agents]], [[no-push-of-others-commits]].
