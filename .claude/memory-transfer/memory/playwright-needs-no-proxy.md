---
name: playwright-needs-no-proxy
description: "Direct `npx playwright test` runs need NO_PROXY=127.0.0.1,localhost and -c playwright.realtime.config.ts, else webServer times out / wrong config"
metadata:
  node_type: memory
  type: reference
  originSessionId: a29eb7ae-8626-4067-acf2-4f0568f3f16b
  modified: 2026-10-12T07:21:50.312Z
---

The shell has HTTP_PROXY/HTTPS_PROXY set. A direct Playwright run without `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost` fails in 30 s with «Timed out waiting 30000ms from config.webServer» — zero tests run, and a grep for «passed» shows nothing (seen 12.10.2026: two ×3 runs silently checked nothing). `verify.sh` sets NO_PROXY itself. Realtime suite: `npx playwright test -c playwright.realtime.config.ts --repeat-each 3`.

**How to apply:** in any acceptance script or helper brief that calls Playwright directly, export NO_PROXY and pass the realtime config; keep the full log (tee) and check the « N passed» line exists before reporting a run. See [[verify-in-clean-worktree]].
