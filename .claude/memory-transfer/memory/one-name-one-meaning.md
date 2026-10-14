---
name: one-name-one-meaning
description: "Before giving a new player-facing name, check it is not taken (KIND_CAPTIONS, AFFIX_TITLES, eliteBehaviors, rtTalismans, prologue titles)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ea30da29-dd9d-40d7-bb85-da7be5bcef04
  modified: 2026-10-13T20:26:27.455Z
---

One player-facing name has one meaning. Before a new name goes into a view text, card, summary or doc, grep it in `KIND_CAPTIONS`, `AFFIX_TITLES`, `sim/eliteBehaviors.ts` titles, `rtTalismans`, the prologue titles (`run/prologue.ts` TITLES) and the forest map names (`forest/mapGenerator.ts`).

**Why:** design (13.10.2026, complexity budget): task 12's high-HP enemy was called «вожак», but «Вожак» is the wolf elite («Элита · Вожак») → renamed «главарь», then «атаман» («Главарь с котелком» is the camp boss in `forest/mapGenerator.ts` — check forest names too); «Пепел I–V» clashed with «Пепельный оберег» → «Испытание I–V»; «второе дыхание» text must not read like the оберег's.

Also (design 14.10.2026): in player-facing texts the hero is «герой», never «кот» (the art is a cat; the text is not).

**How to apply:** when a design spec names a new thing for the UI, grep the name (case-insensitive) in src before drawing it; if taken, ask design before shipping. Related: [[session-roles-core-ui]].
