# cLoop — Claude Code + Codex CLI

**cLoop** is a council loop for coding agents. The *c* stands for **council**: cLoop is short for *council-Loop*, and everywhere else it is simply cLoop.

You state the goal. A council of two independent models helps turn it into a rubric of single-property criteria, tagged CORE or NON-CORE. The root builds the stage as one self-contained one-shot, runs it on real input, and closes what is left in small loops; the council judges every loop against the rubric on a committed candidate. When a failure resists the root, the same two models become loop-breakers; when they cannot close it either, you decide a re-plan. Nothing counts as done until the release gate passes: the product end to end on a real run, the full suite, and a full review.

This `main` branch runs the root in **Claude Code**. Member A is a native Claude Code subagent; Member B, the explorers and the builders are **Codex CLI** sessions (`codex exec`) that the root launches directly. Two labs on one council, so their findings complement each other.

## What is new in 1.1.0: a decidable architecture

Every step of cLoop is now decidable, and each decision has one owner:

- **What can be computed is enforced by code.** A small tool, `cloop.mjs` (Node, standard library only, installed at the project root), holds the flow: the states and their transitions, the evidence each exit needs, the council's outcome, BEST (the commit everything builds from, which only moves forward), the escalation ladder, the rubric's format and freeze, and the gates' preconditions. The agent cannot skip a step, invent an outcome or move the finish line: the tool refuses and says what is missing.
- **What needs judgment is guided by principles, not scripts.** The prompt keeps only what code cannot decide: the step back, causes, tagging, merges, quality and taste, under five laws, a few vetoes and the cues that trigger them. Each state's instructions are printed by the tool when the state is entered, so the prompt stays small (about 12 KB, down from 37 KB) and every instruction is read when it applies.
- **What belongs to you stays yours.** Goals, any change to an approved or frozen finish line, a re-plan when a failure resists the loop-breakers, and acceptance are your decisions, asked with options and a recommendation while the agent keeps working on the rest.

For you this means runs that follow the method instead of drifting from it, evidence you can check (`cloop/log.jsonl`, `cloop/board.md`, `node cloop.mjs report`), and fewer tokens spent on instructions the model would otherwise re-read and re-interpret on every turn.

## Why cLoop

Models have three default habits: they add where they should delete, they fix details where they should look at the whole, and they satisfy the measure where they should satisfy the goal. cLoop counters each one with mechanics, not exhortation:

- **Step backs on the whole.** Every build opens with a step back that reads all the evidence, names the class of failure and its root cause, considers removal first, and decides one correction for the whole property. It comes in three sizes: yours in a few lines, the loop-breakers' in a few paragraphs, and a re-plan you approve.
- **Real runs, not proxies.** A passing test is not rubric satisfaction, and agreement between judges is not evidence. Every MET names the nearest counterfeit it excludes and a boundary case that was run; a violation counts only once the root reproduces it.
- **One-shot first, loops second.** A single self-contained file shows early whether the approach is right. A bad one-shot goes to a re-plan, never into a long chain of patches. The small loop is one mechanic used two ways: it builds what the one-shot left and corrects what a council found.
- **Escalate only as far as the failure requires.** Progress keeps the root in its small loops; repeated stalls or regressions bring in the loop-breakers; only what they cannot close comes to you.
- **Cheap mechanics first.** Town Council is built to run real work on small accounts; High Council spends more where the task is hardest.

## The method in one screen

```text
ROUTE    DIRECT (one local edit) | FOCUSED: DEFINE → CLIMB | FULL: DEFINE → EXPLORE (when triggered) → CLIMB
ADOPT    an existing project is adopted first: keep, simplify or replace, with you
DEFINE   goals with you → both members draft the rubric → CORE / NON-CORE → freeze
         (provisional until the first council, then frozen hard; changes need your words)
EXPLORE  2–4 parallel single-file one-shots, judged blind, ranked by the tool, merged
CLIMB    CORE stage, then NON-CORE stage; each = PREVENT → one-shot → small loops → gate
ACCEPT   the release gate passed: you accept, or your feedback goes back to DEFINE or EXPLORE

LADDER   small: your step back + a small loop      (3rd ADVANCED, 2nd STALLED or REGRESSION → full)
         full: two loop-breakers, one merge         (ADVANCED → small; 2nd STALLED or REGRESSION → re-define)
         re-define: your comment → their re-plan → your approval   (ADVANCED → small)
```

Outcomes are PASS, ADVANCED, STALLED, REGRESSION or BLOCKED, computed by the tool. After every judging the root sends you `node cloop.mjs report` and keeps working.

## Profiles

| Profile | Council | Root (recommended) | Member A | Member B | Explorer | Account |
| --- | --- | --- | --- | --- | --- | --- |
| `town` | Town Council | Opus 5.5 medium | Opus 5.5 medium | `gpt-6.1-terra` max | `gpt-6.1-terra` medium | Claude Max + ChatGPT Plus |
| `high` | High Council | Opus 5.5 high | Opus 5.5 xhigh | `gpt-6.1-sol` max | `gpt-6.1-sol` medium | Claude Max + ChatGPT Pro |

Install **exactly one** profile per project. Member A and Member B judge every loop and every gate, and become the loop-breakers when a failure resists the root.

## Editions

| Branch | Root | Members and explorers |
| --- | --- | --- |
| `main` | Claude Code | Member A native subagent; Member B and explorers through Codex CLI |
| `codex` | Codex | native Codex subagents |
| `claude` | Claude Code | native Claude Code subagents |

Every branch carries the same method and the same `cloop.mjs` at 1.1.0. Only the roles subsection of the profile, the installer target and the builders' invocation differ.

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

In an existing project, the first FOCUSED or FULL task starts with ADOPTION: `node cloop.mjs init` detects the project and enters ADOPT, so the rubric, the spec and the architecture exist before feature work. `doctor` checks that the installed `cloop.mjs` matches this checkout.

```bash
node /path/to/cLoop/install.mjs install --project . --profile town
node /path/to/cLoop/install.mjs update --project . [--profile high]
node /path/to/cLoop/install.mjs doctor --project .
node /path/to/cLoop/install.mjs uninstall --project .
```

Flags: `--dry-run`, `--force` (overwrite a hand-edited cLoop block), `--json`, `--no-hooks`, `--hooks` (default), `--builders none|cheap|cheap-100`. `--global` is rejected. Profile aliases: `town-council`, `high-council`.

**Requirements:**
- Node 18+ and Claude Code.
- `codex` on `PATH` and logged in (Member B, the explorers and the builders run through it).
- The installer adds `Bash(codex exec:*)` to `.claude/settings.json` permissions; uninstall removes it.
- `AGENTS.md` must not hold a cLoop block, because Codex sessions would load it as their own policy. `doctor` reports it if it does.

## What it writes

```text
CLAUDE.md                        # bounded cLoop block appended or replaced
cloop.mjs                        # the flow tool the policy runs (node cloop.mjs status)
.cloop/state.json                # profile, hashes, hook mode
.claude/settings.json            # cLoop hook entries and the codex exec permission; other keys kept
.claude/hooks/cloop-turn.mjs     # heartbeat (UserPromptSubmit) + short compact reminder (SessionStart: compact)
```

Claude Code re-reads the project-root `CLAUDE.md` after compaction, so the compact hook injects only the turn reminder, never the whole block. Everything outside the `<!-- cloop:managed:start -->` / `<!-- cloop:managed:end -->` markers stays yours; `uninstall` removes only cLoop files.

While a task runs, `cloop.mjs` keeps `cloop/state.json`, `cloop/log.jsonl` (every card, run, call, judging, step back and transition) and the rendered `cloop/board.md`; calls live in `cloop/runs/` and `cloop/wt/`, scratch in `temporary/`. All are git-excluded; `node cloop.mjs clean` removes the call folders, worktrees and scratch after DONE and keeps the state, log and board. Three files are permanent and committed: `cloop/rubric.md`, `cloop/spec.md` and `cloop/architecture.md`. Where the sandbox keeps `.git` read-only, `init` keeps the repository in `cloop/git`, with its history; run git through `node cloop.mjs git <args>`.

## cheapGPT builders (`--builders`)

cLoop and [cheapGPT](https://github.com/Lycvrgvs/cheapGPT) are never installed in the same project. To get cheapGPT's economical builders, install cLoop with `--builders cheap` or `--builders cheap-100`. The builders then take only the build steps (each one-shot file and each small loop's build): each is one `codex exec` session for the whole task (first call, then `codex exec resume <thread_id>` with a delta), seeded with a conversation packet, and takes every assignment in its own worktree of BEST (`node cloop.mjs call dynamic|mechanical`); the root allocates by whether the handoff can state the exact result, merges, and runs the real path before the council. The root keeps everything else, and the council never changes. Pick the builders separately from `town` or `high`.

| Option | Dynamic builder | Mechanical builder |
| --- | --- | --- |
| `--builders none` (default) | the root builds | the root builds |
| `--builders cheap` | gpt-6.1-terra medium | gpt-6-luna max |
| `--builders cheap-100` | gpt-6.1-terra max | gpt-6-luna max |

The rows come from cheapGPT 1.9.0's published `profiles/roles.json` (the `exp` edition), copied into `vendor/cheapgpt-builders.json` at release time. Nothing is fetched at install.

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

`sync-builders` copies the builder rows from cheapGPT's published roles table, checked out at a pinned commit of the paired edition. `release` then derives the six profiles for this branch's edition (`town`, `high`, each with builders `none`, `cheap` and `cheap-100`) from the Town Council source prompt, the mono-agent `cloop-town.txt`. It refuses to run if the prompt's roles subsection or intro no longer match its template. Copy the released `cloop.mjs` next to `install.mjs`; the installer ships that file.

## Layout

```text
install.mjs              zero-dependency installer
cloop.mjs                the flow tool, copied into each target project's root
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
