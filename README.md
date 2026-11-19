# cLoop — Claude Code edition

**cLoop** is a council loop for coding agents. The *c* stands for **council**: cLoop is short for *council-Loop*, and everywhere else it is simply cLoop.

You state the goal. A council of two independent models turns it into a rubric of single-property criteria, tagged CORE or NON-CORE. The root builds one self-contained one-shot, runs it on real input, and then closes the remaining gaps in small loops. Each loop corrects one thing and is judged by the council against the frozen rubric on a frozen commit. When a problem resists repair, the same two models switch roles: they become duelers, each diagnosing apart and fixing in its own worktree, and the root merges the result by an objective rule. Nothing counts as done until the release gate passes: the full product on a real run, the full suite once, and a full review.

This `claude` branch runs everything in **Claude Code**: the root is a Claude Code session and every member and explorer is a native subagent launched with the `Agent` tool and an explicit `model` and `effort`. No Codex needed.

## Why cLoop

Models have three default habits: they add where they should delete, they fix details where they should look at the whole, and they satisfy the measure where they should satisfy the goal. cLoop counters each one with mechanics, not exhortation:

- **A frozen rubric decides.** Every criterion holds one property, is tested against real cases before it is frozen, and can only change through an explicit step back. It never changes silently to make a result pass.
- **Real runs, not proxies.** A passing test is not rubric satisfaction, and agreement between judges is not evidence. Every claim rests on the product used on real input.
- **One-shot first, loops second.** A single self-contained file shows early whether the approach is about 80% right. A bad one-shot goes back to DEFINE or EXPLORE, never into a long chain of patches.
- **Judges write nothing.** The judges are the reviewers: read-only, blind to authorship and to each other. The duelers are the loop-breakers: they are the only council role that implements.
- **Cheap mechanics first.** Town Council is built to run real work on small accounts; High Council spends more where the task is hardest.

## The method in one screen

```text
DEFINE   what      council drafts the rubric (CORE / NON-CORE); each criterion's literal wording runs on real cases; freeze
EXPLORE  how       only when the output shape is unclear: 3–5 parallel single-file one-shots, judged blind, winner by rule
CLIMB    ship      CORE stage, then NON-CORE stage; each = one-shot → small loops → gate
                   small loop: PREVENT → BRIEF → BUILD → JUDGE → CORRECT or ACCEPT
                   gates: core gate; release gate = full run + full suite once + full review
STEP BACK          repair differently → DUEL → EXPLORE → re-DEFINE
```

Outcomes are REGRESSION, PASS, ADVANCED, STALLED or BLOCKED. After every check, loop and gate the root reports one status line, two tables (the whole rubric, then this loop) and the single next action, then keeps working until a real blocker.

## Profiles

| Profile | Council | Root (recommended) | Member A | Member B | Explorer | Account |
| --- | --- | --- | --- | --- | --- | --- |
| `town` | Town Council | Opus 5.5 medium | Sonnet 5.5 xhigh | Opus 5.5 medium | Sonnet 5.5 medium | Claude Max |
| `high` | High Council | Opus 5.5 high | Opus 5.5 xhigh | Fable 5.1 xhigh | Opus 5.5 medium | Claude Max (higher tier) |

Install **exactly one** profile per project. Member A and Member B judge every loop and every gate, and duel when a problem resists repair.

Both members come from the same lab on this branch, so every review names the nearest counterfeit (what could look like the property without being it) with extra care.

## Editions

| Branch | Root | Members and explorers |
| --- | --- | --- |
| `main` | Claude Code | Member A native subagent; Member B and explorers through Codex CLI |
| `codex` | Codex | native Codex subagents |
| `claude` | Claude Code | native Claude Code subagents |

Every branch carries the same method. Only the roles section of the profile and the installer target differ.

## For AI coding agents (Claude Code, Codex, Cursor, OpenCode)

If a human asked you to install cLoop into the **current** project:

1. cLoop is project-local. Never install into a home config and never treat it as a global skill.
2. Ask which profile to use if they did not name one (`town` or `high`); recommend from the table above.
3. Clone this repository and check out the branch that matches their harness (`main`, `codex` or `claude`). Profiles live next to `install.mjs`.
4. Run the installer with Node 18+ from the target project:

```bash
node /path/to/cLoop/install.mjs install --project . --profile town
```

5. Do not paste profile text into `CLAUDE.md` yourself, and do not install more than one profile.
6. After install or update, tell the human to open the project in Claude Code, accept the workspace trust dialog, review `/hooks`, and set the root model with `/model` (`town`: Opus 5.5 medium; `high`: Opus 5.5 high).

## Install / update / doctor / uninstall

On a first install, the installer recommends making the first task an ADOPTION when the project has no `cloop/rubric.md` yet, so the rubric (opening with the G0 Method goal), the spec and the architecture exist before feature work. `doctor` checks that the rubric carries G0 verbatim.

```bash
node /path/to/cLoop/install.mjs install --project . --profile town
node /path/to/cLoop/install.mjs update --project . [--profile high]
node /path/to/cLoop/install.mjs doctor --project .
node /path/to/cLoop/install.mjs uninstall --project .
```

Flags: `--dry-run`, `--force` (overwrite a hand-edited cLoop block), `--json`, `--no-hooks`, `--hooks` (default), `--builders none|cheap|cheap-100`. `--global` is rejected. Profile aliases: `town-council`, `high-council`.

**Requirements:**
- Node 18+ and Claude Code.

## What it writes

```text
CLAUDE.md                        # bounded cLoop block appended or replaced
.cloop/state.json                # profile, hashes, hook mode
.claude/settings.json            # cLoop hook entries merged into "hooks"; other keys kept
.claude/hooks/cloop-turn.mjs     # heartbeat (UserPromptSubmit) + short compact reminder (SessionStart: compact)
```

Claude Code re-reads the project-root `CLAUDE.md` after compaction, so the compact hook injects only the turn reminder, never the whole block. Everything outside the `<!-- cloop:managed:start -->` / `<!-- cloop:managed:end -->` markers stays yours; `uninstall` removes only cLoop files.

While a task runs, the root keeps `cloop/board.md` (the board), `cloop/runs/` and `cloop/wt/` (call folders and worktrees) and `temporary/`. All are git-excluded and deleted when the task passes; on BLOCKED the board stays until a solution is found. Three files are permanent and committed: `cloop/rubric.md`, `cloop/spec.md` and `cloop/architecture.md`.

## cheapGPT builders (`--builders`)

cLoop and [cheapGPT](https://github.com/Lycvrgvs/cheapGPT) are never installed in the same project. To get cheapGPT's economical builders, install cLoop with `--builders cheap` or `--builders cheap-100`. The builders then take only the build steps (each one-shot file and each small loop's BUILD), run as native Claude Code subagents in their own worktrees. The root keeps everything else, and the council never changes. Pick the builders separately from `town` or `high`.

| Option | Dynamic builder | Mechanical builder |
| --- | --- | --- |
| `--builders none` (default) | the root builds | the root builds |
| `--builders cheap` | Sonnet 5.5 medium | Haiku 5.5 xhigh |
| `--builders cheap-100` | Sonnet 5.5 xhigh | Haiku 5.5 xhigh |

The rows come from cheapGPT 1.8.4's published `profiles/roles.json` (the `claude-edition` edition), copied into `vendor/cheapgpt-builders.json` at release time. Nothing is fetched at install.

```bash
node /path/to/cLoop/install.mjs install --project . --profile town --builders cheap
node /path/to/cLoop/install.mjs update --project . --builders none   # back to root-built steps
```

`update` keeps the recorded value until you pass another one. When cheapGPT is installed, `install` and `update` stop before writing anything and print the commands to keep one package. To move a cheapGPT project to cLoop, uninstall cheapGPT with its own installer first, then install cLoop with the matching `--builders` value.

## Tests

```bash
node --test test/installer.test.mjs
```

## Releasing

Profiles are generated, never edited by hand. To release a new prompt, on each branch run:

```bash
node tools/sync-builders.mjs --roles /path/to/cheapGPT/profiles/roles.json --commit <cheapGPT sha>
node tools/release.mjs --txt /path/to/cloop-town.txt --version X.Y.Z
node --test test/installer.test.mjs
```

`sync-builders` copies the builder rows from cheapGPT's published roles table, checked out at a pinned commit of the paired edition. `release` then derives the six profiles for this branch's edition (`town`, `high`, each with builders `none`, `cheap` and `cheap-100`) from the Town Council source prompt. It refuses to run if the prompt's roles section or intro no longer match its templates.

## Layout

```text
install.mjs              zero-dependency installer
profiles/town.md         Town Council policy (generated)
profiles/high.md         High Council policy (generated)
profiles/*.cheap*.md     the same policies with a Builders block (generated)
profiles/catalog.json    profile metadata and turn reminders (generated)
hooks/cloop-turn.mjs     copied into each target project's .claude/hooks/
tools/release.mjs        profile generator for releases
tools/sync-builders.mjs  copies cheapGPT's builder rows into vendor/
vendor/cheapgpt-builders.json  vendored builder rows and their cheapGPT source
cheapgpt-guard.mjs       stops install and update when cheapGPT is installed
test/installer.test.mjs
```
