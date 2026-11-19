#!/usr/bin/env node
// cLoop release tool. Regenerates this branch's profiles and profiles/catalog.json from the cLoop
// source txt, and optionally sets the package version.
//
//   node tools/release.mjs --txt <path to cloop-town.txt> [--version X.Y.Z] [--edition main|codex|claude]
//
// Output per edition: town.md and high.md (no builders), plus town.cheap.md, town.cheap-100.md,
// high.cheap.md and high.cheap-100.md, which add a Builders block from vendor/cheapgpt-builders.json
// (written by tools/sync-builders.mjs). The txt is the Town Council prompt for the main edition
// (Claude Code root + Codex CLI members); every other profile and edition is derived from it here.
// The tool refuses to run when the txt's ROLES AND INVOCATION section or intro no longer match the
// templates below: update the templates in this file first, then rerun. It never guesses.
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITIONS = ["main", "codex", "claude"];
const PROFILE_IDS = ["town", "high"];
export const BUILDER_IDS = ["cheap", "cheap-100"];

export const MODELS = {
  main: {
    town: { root: "Opus 5.5 medium", a: ["Opus 5.5", "medium"], b: ["gpt-6.1-terra", "max"], e: ["gpt-6.1-terra", "medium"] },
    high: { root: "Opus 5.5 high", a: ["Opus 5.5", "xhigh"], b: ["gpt-6.1-sol", "max"], e: ["gpt-6.1-sol", "medium"] },
  },
  codex: {
    town: { root: "gpt-6.1-sol medium", a: ["gpt-6.1-terra", "max"], b: ["gpt-6.1-sol", "medium"], e: ["gpt-6.1-terra", "medium"] },
    high: { root: "gpt-6.1-sol high", a: ["gpt-6.1-sol", "max"], b: ["gpt-6-astra", "xhigh"], e: ["gpt-6.1-sol", "medium"] },
  },
  claude: {
    town: { root: "Opus 5.5 medium", a: ["Sonnet 5.5", "xhigh"], b: ["Opus 5.5", "medium"], e: ["Sonnet 5.5", "medium"] },
    high: { root: "Opus 5.5 high", a: ["Opus 5.5", "xhigh"], b: ["Fable 5.1", "xhigh"], e: ["Opus 5.5", "medium"] },
  },
};

const META = {
  main: {
    harness: "claude-codex",
    town: { title: "Town Council", account: "Claude Max + ChatGPT Plus", difficulty: "everyday to hard tasks on small accounts" },
    high: { title: "High Council", account: "Claude Max + ChatGPT Pro", difficulty: "hardest tasks" },
  },
  codex: {
    harness: "codex",
    town: { title: "Town Council", account: "ChatGPT Plus", difficulty: "everyday to hard tasks on small accounts" },
    high: { title: "High Council", account: "ChatGPT Pro", difficulty: "hardest tasks" },
  },
  claude: {
    harness: "claude",
    town: { title: "Town Council", account: "Claude Max", difficulty: "everyday to hard tasks on small accounts" },
    high: { title: "High Council", account: "Claude Max (higher tier)", difficulty: "hardest tasks" },
  },
};

// cLoop edition -> the cheapGPT edition its builders come from.
export const CHEAPGPT_EDITION = { main: "exp", codex: "main", claude: "claude-edition" };

const CLAUDE_ALIAS = { "Opus 5.5": "opus", "Sonnet 5.5": "sonnet", "Haiku 5.5": "haiku", "Fable 5.1": "fable" };
const label = ([name, effort]) => `${name} ${effort}`;

const INTRO_TOWN_MAIN = "You are the cLoop root (the c stands for council): a Claude Code session that owns the task from goals to release.";
const LABS_MAIN = "A council of two fresh, independent models from different labs (Member A and Member B)";
const LABS_SAME = "A council of two fresh, independent models (Member A and Member B)";

const ROLES_HEAD = `## ROLES AND INVOCATION

The user fixes the model hierarchy for the task; it does not change during it.

| Role | Model | Run as | Writes |
|---|---|---|---|
`;

const WRITES_MEMBER = "only its probe worktree as judge; its own worktree as dueler";

const SHARED_BULLETS = `- The same models and effort serve loops and gates; gates differ by scope and by the probe requirement.
- The council is never substituted: a failed call is re-dispatched once, then that role stops and is reported.
- Every member call is a new instance with a self-contained packet. Explorers are resumed only for follow-ups on their own option.
- Every call works in its own worktree: a judge or a duel diagnosis in a probe worktree of the frozen commit, discarded after the call; a writer in a worktree of BEST.
`;

const SAME_LAB = "- The two members are different models: their findings complement each other. They come from the same lab and may share blind spots, so every review names the nearest counterfeit with extra care.\n";

const WORKTREE_BLOCK = `**Worktree per call** (the frozen commit for a judge or a diagnosis, BEST for a writer):

\`git worktree add -b cl/<call-id> "$REPO/cloop/wt/<call-id>" <commit>\`
`;

const FAILED_CALL = "Anything else is a failed call: re-dispatch it once with the same packet. A second failure stops that role and is reported; the step never passes on the remaining verdict.";

const EXEC_TAIL = `- Before and after every judge call, compare HEAD, \`git status --porcelain\` and a hash of \`git diff\` in the repository; any change voids the call. After every write call, verify nothing changed outside its worktree.
- Fail-before runs use a worktree of BEST with the new test file copied in, never \`git stash\`.
`;

const PREFLIGHT_TAIL = `- P3: a judge call leaves the repository unchanged.
- P4: two writers at once each change only their own worktree.
- Add \`cloop/*\`, \`!cloop/rubric.md\`, \`!cloop/spec.md\`, \`!cloop/architecture.md\` and \`temporary/\` to \`.git/info/exclude\`.
`;

const PREFLIGHT_HEAD = "**PREFLIGHT** (once per repo; results on the board; a failure stops that role and is reported):\n";

function rolesMain(m) {
  return `${ROLES_HEAD}| Root | ${m.root} (recommended) | this session | code, board, merges |
| Member A (judge, dueler) | ${label(m.a)} | native Claude Code subagent, fresh per call | ${WRITES_MEMBER} |
| Member B (judge, dueler) | ${label(m.b)} | \`codex exec\`, new session per call | ${WRITES_MEMBER} |
| Explorer | ${label(m.e)} | \`codex exec\`, fresh per option | its own worktree |

- The two members are different models from different labs: their findings complement each other.
${SHARED_BULLETS}
**Run folder per call:** \`cloop/runs/<call-id>/\` with \`packet.md\`, \`out.md\` and \`events.jsonl\`. Use absolute paths and random call-ids, so no path a judge sees reveals who built what.

${WORKTREE_BLOCK}
**Member B** (the sandbox confines its writes to that worktree; a judge's packet also forbids edits to tracked files):

\`codex exec -m ${m.b[0]} -c model_reasoning_effort=${m.b[1]} -s workspace-write -C "$REPO/cloop/wt/<call-id>" --json -o "$RUN/out.md" "Read $RUN/packet.md and follow it." < /dev/null > "$RUN/events.jsonl"\`

**Explorers:** the same command with their own \`-m <model> -c model_reasoning_effort=<effort>\`.

**Member A:** a native subagent with model ${m.a[0]} and ${m.a[1]} effort, prompted "Read <packet path> and follow it." Its packet names its worktree and forbids writes elsewhere.

**Execution:**
- Launch all calls of a step in one turn and wait for every completion in that turn.
- A call is complete only when it exited 0 and \`out.md\` follows the format. ${FAILED_CALL}
- After 30 minutes without a result, ask the call for a short status report and tell it to continue. No answer, or no change → kill it; that is its one re-dispatch.
${EXEC_TAIL}
${PREFLIGHT_HEAD}- P1: Codex runs and is logged in, and no \`AGENTS.md\` that \`codex exec\` reads from a worktree up to the filesystem root holds an orchestration policy.
- P2: each role's model and effort are confirmed from the harness's record (\`events.jsonl\`, the subagent call), never from the role's reply.
${PREFLIGHT_TAIL}`;
}

function rolesCodex(m) {
  return `${ROLES_HEAD}| Root | ${m.root} (recommended) | this session | code, board, merges |
| Member A (judge, dueler) | ${label(m.a)} | native Codex subagent, fresh per call | ${WRITES_MEMBER} |
| Member B (judge, dueler) | ${label(m.b)} | native Codex subagent, fresh per call | ${WRITES_MEMBER} |
| Explorer | ${label(m.e)} | native Codex subagent, fresh per option | its own worktree |

${SAME_LAB}${SHARED_BULLETS}
**Run folder per call:** \`cloop/runs/<call-id>/\` with \`packet.md\` and \`out.md\`. Use absolute paths and random call-ids, so no path a judge sees reveals who built what.

${WORKTREE_BLOCK}
**Every call:** native \`spawn_agent\` with the explicit model and reasoning effort from the table and \`fork_turns: "none"\`, with the message "Read <packet path> and follow it." Await it with native \`wait_agent(timeout_ms=1800000)\`, re-entering after every timeout until the terminal result; never end the turn to poll a running call. Save the terminal reply verbatim as \`out.md\`. Its packet names its worktree and forbids writes elsewhere; a judge's packet also forbids edits to tracked files. Members and explorers spawn nothing.

**Execution:**
- Launch all calls of a step in one turn and wait for every completion in that turn.
- A call is complete only when it returned a terminal reply and \`out.md\` follows the format. ${FAILED_CALL}
- After 30 minutes without a result, ask the call for a short status report and tell it to continue. No answer, or no change → close it; that is its one re-dispatch.
${EXEC_TAIL}
${PREFLIGHT_HEAD}- P1: native subagents spawn with an explicit model and reasoning effort.
- P2: each role's model and effort are confirmed from the harness's record (the \`spawn_agent\` arguments and session log), never from the role's reply.
${PREFLIGHT_TAIL}`;
}

function claudeAliases(rows) {
  const aliases = [];
  for (const [name] of rows) {
    const alias = CLAUDE_ALIAS[name];
    if (!alias) throw new Error(`no Claude Code model alias for ${name}`);
    const entry = `\`${alias}\` for ${name}`;
    if (!aliases.includes(entry)) aliases.push(entry);
  }
  return aliases.join(", ");
}

function rolesClaude(m) {
  return `${ROLES_HEAD}| Root | ${m.root} (recommended) | this session | code, board, merges |
| Member A (judge, dueler) | ${label(m.a)} | native Claude Code subagent, fresh per call | ${WRITES_MEMBER} |
| Member B (judge, dueler) | ${label(m.b)} | native Claude Code subagent, fresh per call | ${WRITES_MEMBER} |
| Explorer | ${label(m.e)} | native Claude Code subagent, fresh per option | its own worktree |

${SAME_LAB}${SHARED_BULLETS}
**Run folder per call:** \`cloop/runs/<call-id>/\` with \`packet.md\` and \`out.md\`. Use absolute paths and random call-ids, so no path a judge sees reveals who built what.

${WORKTREE_BLOCK}
**Every call:** Claude Code's native \`Agent\` tool, never as a fork (a fork runs on your model), with the explicit \`model\` (${claudeAliases([m.a, m.b, m.e])}) and \`effort\` from the table, prompted "Read <packet path> and follow it." Save its final reply verbatim as \`out.md\`. Follow-ups to an explorer go through \`SendMessage\` to the same subagent. Its packet names its worktree and forbids writes elsewhere; a judge's packet also forbids edits to tracked files. Members and explorers spawn nothing.

**Execution:**
- Launch all calls of a step in one message and wait for every result in that turn.
- A call is complete only when it returned a final reply and \`out.md\` follows the format. ${FAILED_CALL}
- After 30 minutes without a result, ask the call for a short status report and tell it to continue. No answer, or no change → stop it; that is its one re-dispatch.
${EXEC_TAIL}
${PREFLIGHT_HEAD}- P1: native subagents launch with an explicit model and effort.
- P2: each role's model and effort are confirmed from the harness's record (the \`Agent\` call), never from the role's reply.
${PREFLIGHT_TAIL}`;
}

const RENDER = { main: rolesMain, codex: rolesCodex, claude: rolesClaude };

export function renderRoles(edition, profileId) {
  return RENDER[edition](MODELS[edition][profileId]);
}

// The Builders block appended to ROLES AND INVOCATION when --builders is cheap or cheap-100.
export function renderBuilders(edition, builderId, vendor) {
  const rows = vendor.profiles[builderId];
  const src = vendor.source;
  const d = [rows.dynamic.model, rows.dynamic.effort];
  const k = [rows.mechanical.model, rows.mechanical.effort];
  const runAs = {
    main: "`codex exec`, fresh per build step",
    codex: "native Codex subagent, fresh per build step",
    claude: "native Claude Code subagent, fresh per build step",
  }[edition];
  const how =
    edition === "main"
      ? "Run each builder with the Member B command, its own `-m <model> -c model_reasoning_effort=<effort>`, and a worktree of BEST."
      : edition === "codex"
        ? "Spawn each builder like a member, with its own model and reasoning effort, in a worktree of BEST."
        : `Launch each builder like a member, with its own \`model\` (${claudeAliases([d, k])}) and \`effort\`, in a worktree of BEST.`;
  return `
**Builders** (\`--builders ${builderId}\`: cheapGPT ${src.version}, \`${src.edition}\` edition; the BUILDERS section applies):

| Builder | Model | Run as | Writes |
|---|---|---|---|
| Dynamic | ${label(d)} | ${runAs} | its own worktree of BEST |
| Mechanical | ${label(k)} | ${runAs} | its own worktree of BEST |

${how}
`;
}

function fail(message) {
  process.stderr.write(`release.mjs: ERROR: ${message}\n`);
  process.exit(1);
}

function countOf(text, needle) {
  return text.split(needle).length - 1;
}

export function parseTxt(raw) {
  const text = String(raw).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const sep = (line) => /^═{10,}\s*$/.test(line);
  const find = (heading) => {
    const hits = lines.flatMap((line, i) => (line === heading ? [i] : []));
    if (hits.length !== 1) fail(`the txt must contain the line "${heading}" exactly once (found ${hits.length})`);
    return hits[0];
  };
  const mainAt = find("# MAIN PROMPT");
  const reminderAt = find("# TURN REMINDER");
  if (reminderAt < mainAt) fail("# TURN REMINDER comes before # MAIN PROMPT");
  let mainEnd = reminderAt;
  while (mainEnd > mainAt && !sep(lines[mainEnd - 1])) mainEnd -= 1;
  if (mainEnd === mainAt) fail("no ═══ separator line between # MAIN PROMPT and # TURN REMINDER");
  const body = lines.slice(mainAt + 1, mainEnd - 1).join("\n").trim();
  let reminderEnd = reminderAt + 1;
  while (reminderEnd < lines.length && !sep(lines[reminderEnd])) reminderEnd += 1;
  const reminder = lines.slice(reminderAt + 1, reminderEnd).join("\n").trim();
  if (!body.startsWith("PROFILE: town\n")) fail('the main prompt must start with the line "PROFILE: town"');
  if (!reminder.startsWith("CLOOP town. ")) fail('the turn reminder must start with "CLOOP town. "');
  if (reminder.includes("\n")) fail("the turn reminder must be a single paragraph (one line)");
  if (reminder.length > 4000) fail(`the turn reminder is ${reminder.length} chars; keep it under 4000`);
  return { body, reminder };
}

function rolesSpan(body) {
  const start = body.indexOf("\n## ROLES AND INVOCATION\n");
  if (start < 0 || countOf(body, "\n## ROLES AND INVOCATION\n") !== 1) fail("the main prompt must contain exactly one '## ROLES AND INVOCATION' section");
  const next = body.indexOf("\n## ", start + 1);
  if (next < 0) fail("'## ROLES AND INVOCATION' must be followed by another '## ' section");
  return { start: start + 1, end: next + 1 };
}

export function buildProfile(parsed, edition, profileId, builderId = "none", vendor = null) {
  const { body } = parsed;
  const span = rolesSpan(body);
  const txtRoles = body.slice(span.start, span.end);
  const expected = renderRoles("main", "town") + "\n";
  if (txtRoles !== expected) {
    fail("the txt's ROLES AND INVOCATION section differs from the main/town template in tools/release.mjs. Update the templates to match the txt, then rerun.");
  }
  if (!body.includes("\n## BUILDERS\n")) fail("the main prompt must contain a '## BUILDERS' section");
  if (countOf(body, INTRO_TOWN_MAIN) !== 1) fail(`the intro sentence must appear exactly once: ${INTRO_TOWN_MAIN}`);
  if (countOf(body, LABS_MAIN) !== 1) fail(`the council sentence must appear exactly once: ${LABS_MAIN}`);
  let roles = renderRoles(edition, profileId);
  if (builderId !== "none") roles += renderBuilders(edition, builderId, vendor);
  let out = body.slice(0, span.start) + roles + "\n" + body.slice(span.end);
  out = out.replace("PROFILE: town\n", `PROFILE: ${profileId}\n`);
  if (edition === "codex") out = out.replace(INTRO_TOWN_MAIN, INTRO_TOWN_MAIN.replace("a Claude Code session", "a Codex session"));
  if (edition !== "main") out = out.replace(LABS_MAIN, LABS_SAME);
  return out + "\n";
}

export function buildReminder(parsed, profileId) {
  return parsed.reminder.replace(/^CLOOP town\. /, `CLOOP ${profileId}. `);
}

export function profileFile(profileId, builderId = "none") {
  return builderId === "none" ? `${profileId}.md` : `${profileId}.${builderId}.md`;
}

export function buildCatalog(parsed, edition, version, vendor) {
  const profiles = {};
  for (const id of PROFILE_IDS) {
    const m = MODELS[edition][id];
    const builders = {};
    for (const b of BUILDER_IDS) {
      const rows = vendor.profiles[b];
      builders[b] = {
        file: profileFile(id, b),
        dynamic: `${rows.dynamic.model} ${rows.dynamic.effort}`,
        mechanical: `${rows.mechanical.model} ${rows.mechanical.effort}`,
      };
    }
    profiles[id] = {
      id,
      file: profileFile(id),
      title: META[edition][id].title,
      account: META[edition][id].account,
      difficulty: META[edition][id].difficulty,
      root: m.root,
      council: `${label(m.a)} + ${label(m.b)}`,
      explorer: label(m.e),
      planningMode: buildReminder(parsed, id),
      implementationMode: "",
      builders,
    };
  }
  return {
    schemaVersion: 1,
    packageVersion: version,
    harness: META[edition].harness,
    edition,
    buildersSource: vendor.source,
    profiles,
  };
}

export function loadVendor(repo = REPO, edition) {
  const file = path.join(repo, "vendor", "cheapgpt-builders.json");
  if (!existsSync(file)) fail("missing vendor/cheapgpt-builders.json; run node tools/sync-builders.mjs first");
  const vendor = JSON.parse(readFileSync(file, "utf8"));
  if (vendor.edition !== edition) fail(`vendor/cheapgpt-builders.json is for edition ${vendor.edition}, not ${edition}`);
  if (vendor.source?.edition !== CHEAPGPT_EDITION[edition]) fail(`vendor builders come from cheapGPT ${vendor.source?.edition}; edition ${edition} pairs with ${CHEAPGPT_EDITION[edition]}`);
  for (const b of BUILDER_IDS) {
    for (const kind of ["dynamic", "mechanical"]) {
      const row = vendor.profiles?.[b]?.[kind];
      if (!row || !row.model || !row.effort) fail(`vendor/cheapgpt-builders.json lacks the ${b} ${kind} builder`);
      if (edition === "claude" && !CLAUDE_ALIAS[row.model]) fail(`no Claude Code alias for builder model ${row.model}`);
    }
  }
  return vendor;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--txt" || token === "--version" || token === "--edition") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) fail(`${token} needs a value`);
      args[token.slice(2)] = value;
      i += 1;
    } else fail(`unknown option ${token}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.txt) fail("usage: node tools/release.mjs --txt <cloop-town.txt> [--version X.Y.Z] [--edition main|codex|claude]");
  const catalogPath = path.join(REPO, "profiles", "catalog.json");
  const installPath = path.join(REPO, "install.mjs");
  if (!existsSync(installPath)) fail(`missing ${installPath}; run from a cLoop checkout`);
  let edition = args.edition;
  if (!edition && existsSync(catalogPath)) edition = JSON.parse(readFileSync(catalogPath, "utf8")).edition;
  if (!EDITIONS.includes(edition)) fail(`edition must be one of ${EDITIONS.join(", ")} (got ${edition}); pass --edition`);
  const vendor = loadVendor(REPO, edition);
  let install = readFileSync(installPath, "utf8");
  const versionRe = /^export const PACKAGE_VERSION = "(\d+\.\d+\.\d+)";$/m;
  const found = install.match(versionRe);
  if (!found || countOf(install, "export const PACKAGE_VERSION = ") !== 1) fail("install.mjs must contain exactly one PACKAGE_VERSION line");
  let version = found[1];
  if (args.version) {
    if (!/^\d+\.\d+\.\d+$/.test(args.version)) fail("--version must look like 1.2.3");
    version = args.version;
    install = install.replace(versionRe, `export const PACKAGE_VERSION = "${version}";`);
    writeFileSync(installPath, install);
  }
  const parsed = parseTxt(readFileSync(path.resolve(args.txt), "utf8"));
  const profilesDir = path.join(REPO, "profiles");
  for (const name of readdirSync(profilesDir)) if (name.endsWith(".md")) rmSync(path.join(profilesDir, name));
  for (const id of PROFILE_IDS) {
    for (const b of ["none", ...BUILDER_IDS]) {
      writeFileSync(path.join(profilesDir, profileFile(id, b)), buildProfile(parsed, edition, id, b, vendor));
    }
  }
  writeFileSync(catalogPath, JSON.stringify(buildCatalog(parsed, edition, version, vendor), null, 2) + "\n");
  process.stdout.write(`release.mjs: OK edition=${edition} version=${version} profiles=${PROFILE_IDS.length * 3}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
