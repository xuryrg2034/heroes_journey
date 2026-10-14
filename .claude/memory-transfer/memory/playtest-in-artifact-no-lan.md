---
name: playtest-in-artifact-no-lan
description: 13.10.2026 user playtests in the published artifact; do not start the LAN vite server after a build unless asked
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8751faa6-8af0-47bc-8359-b9a6615871d9
  modified: 2026-10-13T09:33:35.091Z
---

From v40 (13.10.2026) the user said: «Сервак не поднимай, я тестирую в артефакте».

**Why:** the user plays the published artifact (https://claude.ai/artifact/Xu1g1ehswtttQBD9oGZRxX), so the LAN server (RT_TELEMETRY_LAN=1, port 5173) is unused.
**How to apply:** after a core push: clean build, smoke tests, republish the artifact, report. Skip the LAN server step unless the user asks for it again.

14.10.2026 (move to the second machine): the build and smoke pipeline is in the repo — `tools/artifact/` (`node tools/artifact/build.mjs`, `node tools/artifact/smoke.mjs`, Node only; steps, the artifact URL and the version list in `tools/artifact/README.md`). After each core push that changes game code, the design session builds it in a clean tree and republishes the artifact.
