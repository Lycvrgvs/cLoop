# Changelog

Other tools may detect and cleanly remove a cLoop install by its footprint: the managed block markers in the policy file, the fields of `.cloop/state.json` (including `codexPermission`, whether cLoop added the `Bash(codex exec:*)` permission), the hook tags, the engine folder's file set, and the header of the legacy root `cloop.mjs`. Each release lists what it changes in that footprint.

## 1.2.2

One climb (one-shot → next-shot → release gate), a prevent (step back + one-block) before every step, the council on every criterion at every step, a re-define that asks the user twice, a git store that keeps the checkout's HEAD and cannot push, and migration of tasks started on 1.2.0.

Footprint:
- Managed block markers: unchanged (`<!-- cloop:managed:start -->`, `<!-- cloop:managed:end -->`).
- `.cloop/state.json` fields: unchanged (`packageVersion` becomes `1.2.2`).
- Hook tags: unchanged (`cloop:`, `cloop-turn.mjs`).
- Legacy root `cloop.mjs` header: unchanged (`// cLoop tool: the flow, the escalation ladder`); update still removes it.
- Engine folder file set (`.cloop/`): **changed** in `cards/`.
  - Old (1.2.0): `cloop.mjs`, `flow.json`, `cards/` = accept, adopt, ask, define, done, duel, dueler, dynamic, explore, explorer, gate, judge, loop, mechanical, member, merge, oneshot, step-back, stopped (19 `.md` files).
  - New (1.2.2): `cloop.mjs`, `flow.json`, `cards/` = accept, adopt, ask, define, done, duel, dueler, dynamic, explore, explorer, gate, judge, mechanical, member, merge, next-shot, one-block, oneshot, step-back, stopped (20 `.md` files). `loop.md` is removed; `next-shot.md` and `one-block.md` are added. `update` replaces the whole `cards/` folder.

## 1.2.0

Instructions moved into `cards/*.md` and the flow into `flow.json`; the engine, its flow and its cards install under `.cloop/`. The 1.1.0 root `cloop.mjs` is removed by `update`.
