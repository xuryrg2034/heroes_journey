/**
 * Tasks 36–37: the reference of `meta.spec.ts` — 24 runs WITHOUT the meta flags (`locked`, `hearth`) walked by `walkRun`
 * (metaWalk.testkit.ts, `REFERENCE_WALKS`): the FNV-1a digest of every serialized state the walk passed through (every offer of
 * every screen is in them), the number of steps and the result — `digest:steps:outcome:offered`, where `offered` is the length of
 * the sorted, comma-joined ids offered. Made 15.10.2026 on main 4c52dfd, before the tasks. A run without the flags must walk the
 * same, byte for byte.
 */
export const META_REFERENCE: Readonly<Record<number, string>> = {
  1: '129cf6e3:24:victory:128',
  2: '2ad29770:24:victory:78',
  3: '936431e4:24:victory:145',
  4: '39d689cb:24:victory:83',
  5: '6a8f297f:16:defeat:87',
  6: '923e20be:27:victory:120',
  7: '589edb31:25:victory:177',
  8: '53baffe5:24:victory:99',
  9: '5f1d72fc:24:victory:143',
  10: '237751df:12:defeat:0',
  11: '9a156e78:26:victory:157',
  12: '741cf1fd:26:victory:107',
  13: 'ec281a0f:25:victory:155',
  14: 'b54c6ad9:24:victory:86',
  15: '5878ae87:12:defeat:21',
  16: 'e15c309f:28:victory:167',
  17: '85b3b6d2:25:victory:197',
  18: 'd241d855:27:victory:139',
  19: 'a2575778:28:victory:130',
  20: '3859c592:12:defeat:8',
  21: 'b6ea3187:26:victory:119',
  22: '1d2b756d:24:victory:92',
  23: 'd0bd4018:26:victory:176',
  24: '8555aad4:29:victory:198',
};
