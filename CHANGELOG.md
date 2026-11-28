# Changelog

Other tools may detect and cleanly remove a cLoop install by its footprint: the managed block markers in the policy file, the fields of `.cloop/state.json` (including `codexPermission`, whether cLoop added the `Bash(codex exec:*)` permission), the hook tags, the engine folder's file set, and the header of the legacy root `cloop.mjs`. Each release lists what it changes in that footprint.

## 1.2.4

Every edition on one branch: `main` carries `exp` (until now the `main` branch), `claude` and `codex`; `install --edition <name>` picks one, a new project gets `exp`, and `update` keeps the edition a project has (read from its install state: `instructionFile`, `codexPermission`, and for a Claude Code install without the permission record, its council). The `claude` and `codex` branches are frozen at 1.2.3. Builders re-synced from cheapGPT 1.10.4, whose editions now have the same names as cLoop's. The engine reports 1.2.4; tasks saved by 1.2.3 keep owing every prevent.

Footprint, per edition, checked by installing every edition, profile, builders value and hook mode from the old branch and from `main`:
- Managed block markers: unchanged (`<!-- cloop:managed:start -->`, `<!-- cloop:managed:end -->`). With `--builders cheap|cheap-100`, the block's one Builders line names cheapGPT 1.10.4 and its new edition name (`exp`, `claude`, `codex`; was `exp`, `claude-edition`, `main`).
- `.cloop/state.json` fields: unchanged, no field added (`packageVersion` becomes `1.2.4`; with builders, `buildersSource` names cheapGPT 1.10.4, and the block and profile hashes follow the Builders line).
- Hook tags: unchanged (`cloop:`, `cloop-turn.mjs`); the hook scripts are byte-identical.
- Legacy root `cloop.mjs` header: unchanged (`// cLoop tool: the flow, the escalation ladder`); update still removes it.
- Engine folder file set (`.cloop/`): unchanged (`cloop.mjs`, `flow.json`, `cards/` with the same 20 `.md` files; only `cloop.mjs` changes).
- The `Bash(codex exec:*)` permission record: unchanged (`exp` only).
- Repository paths for consumers that pin them: the vendored builder rows move from `vendor/cheapgpt-builders.json` to `editions/<edition>/vendor/cheapgpt-builders.json`, the profiles from `profiles/` to `editions/<edition>/profiles/`.

## 1.2.3

The prevent (step back, then one-block) is enforced by the engine in every working state, from one `prevent` rule in `flow.json`; the duel's loop-breakers each have their own prevent recorded against their call; the re-define's new definition is a one-block before the user's yes; tasks saved by 1.2.2 continue.

Footprint:
- Managed block markers: unchanged (`<!-- cloop:managed:start -->`, `<!-- cloop:managed:end -->`).
- `.cloop/state.json` fields: unchanged (`packageVersion` becomes `1.2.3`).
- Hook tags: unchanged (`cloop:`, `cloop-turn.mjs`).
- Legacy root `cloop.mjs` header: unchanged (`// cLoop tool: the flow, the escalation ladder`); update still removes it.
- Engine folder file set (`.cloop/`): unchanged (`cloop.mjs`, `flow.json`, `cards/` with the same 20 `.md` files; their text changes).
- The `Bash(codex exec:*)` permission record: unchanged.

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
