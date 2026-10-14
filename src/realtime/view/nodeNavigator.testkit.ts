/**
 * Node 20 has no global `navigator` (Node ≥ 21 has one). pixi.js reads it while its modules load (`navigator.userAgent`,
 * `navigator.gpu`), so a Node test that imports view code — the Playwright specs through the config, the view's Node sets —
 * throws «navigator is not defined» on Node 20 (14.10.2026: Playwright found 0 tests). Import this module first: it puts
 * a plain navigator (the fields pixi reads; no `gpu` — WebGPU is not there, as on Node ≥ 21) and leaves an existing one alone. The game never imports it.
 */
if (typeof (globalThis as { navigator?: unknown }).navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Node.js', language: 'en-US', languages: ['en-US'], hardwareConcurrency: 1 },
    configurable: true,
    writable: true,
  });
}

export {};
