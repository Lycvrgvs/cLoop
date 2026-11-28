#!/usr/bin/env node
// cLoop release tool. Regenerates every edition's profiles and catalog (editions/<edition>/profiles/) from the
// cLoop source txt, and optionally sets the version of both installers and the engine.
//
//   node tools/release.mjs --txt <path to cloop-town.txt> [--version X.Y.Z]
//
// Output, per edition: town.md and high.md (no builders), plus town.cheap.md, town.cheap-100.md, high.cheap.md and
// high.cheap-100.md, which add a Builders block from editions/<edition>/vendor/cheapgpt-builders.json (written by
// tools/sync-builders.mjs). From 1.1.0 the txt is the mono-agent Town Council prompt, written for the codex
// edition (Codex root, native Codex subagents) and run with the engine .cloop/cloop.mjs (its flow.json and cards). Every edition is
// derived from it here: only the intro's harness, the council sentence and the ROLES AND INVOCATION
// subsection (and the Builders block) differ.
// The tool refuses to run when the txt's ROLES AND INVOCATION section or intro no longer match the
// templates below: update the templates in this file first, then rerun. It never guesses.
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EDITIONS = ["exp", "claude", "codex"];
const PROFILE_IDS = ["town", "high"];
export const BUILDER_IDS = ["cheap", "cheap-100"];

export const MODELS = {
  exp: {
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
  exp: {
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

const CLAUDE_ALIAS = { "Opus 5.5": "opus", "Sonnet 5.5": "sonnet", "Haiku 5.5": "haiku", "Fable 5.1": "fable" };
const label = ([name, effort]) => `${name} ${effort}`;

const SOURCE_EDITION = "codex";
const INTRO_TOWN = "You are the cLoop root (the c stands for council): a Codex session that owns a task from goals to release, with the user in the loop.";
const LABS_SAME = "A council of two fresh, independent models (Member A and Member B)";
const LABS_MAIN = "A council of two fresh, independent models from different labs (Member A and Member B)";
const CALL = "`node .cloop/cloop.mjs call <judge|member|explorer|dueler>` creates the call's id, worktree and packet, opened with the role's card; append the assignment.";
const SAME_LAB = "- The two members are different models from the same lab; they may share blind spots, so every review names the nearest counterfeit with care.\n";

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

const table = (m) => `| Root | ${m.root} (recommended), this session | code, merges |
| Member A (judge, loop-breaker) | ${label(m.a)} | its call's worktree |
| Member B (judge, loop-breaker) | ${label(m.b)} | its call's worktree |
| Explorer | ${label(m.e)} | its call's worktree |

`;

const ROLES_HEAD = `### ROLES AND INVOCATION

The user fixes the model hierarchy for the task; it does not change during it.

| Role | Model | Writes |
|---|---|---|
`;

function rolesCodex(m) {
  return `${ROLES_HEAD}${table(m)}${SAME_LAB}- ${CALL} Spawn it with native \`spawn_agent\`, the explicit model and reasoning effort from the table, \`fork_turns: "none"\`, message "Read <packet path> and follow it." Await it with \`wait_agent\`, re-entering after every timeout until the terminal reply. Save the reply verbatim as \`cloop/runs/<call-id>/out.md\`.
`;
}

function rolesClaude(m) {
  return `${ROLES_HEAD}${table(m)}${SAME_LAB}- ${CALL} Spawn it with Claude Code's native \`Agent\` tool, never as a fork (a fork runs on your model), with the explicit \`model\` (${claudeAliases([m.a, m.b, m.e])}) and \`effort\` from the table, prompted "Read <packet path> and follow it." Wait for its final reply in this turn. Save the reply verbatim as \`cloop/runs/<call-id>/out.md\`.
`;
}

const CODEX_EXEC = "`codex exec -m <model> -c model_reasoning_effort=<effort> -s workspace-write -C \"<its worktree>\" --json -o \"$REPO/cloop/runs/<call-id>/out.md\" \"Read <packet path> and follow it.\" < /dev/null > \"$REPO/cloop/runs/<call-id>/events.jsonl\"`";

function rolesExp(m) {
  return `${ROLES_HEAD}${table(m)}- The two members are different models from different labs: their findings complement each other.
- ${CALL} Member A: Claude Code's native \`Agent\` tool, never as a fork (a fork runs on your model), with \`model\` ${claudeAliases([m.a])} and \`effort\` ${m.a[1]}, prompted "Read <packet path> and follow it."; save its final reply verbatim as \`cloop/runs/<call-id>/out.md\`. Member B and explorers: ${CODEX_EXEC}, with the model and effort from the table, run as background jobs and waited for in this turn; their model and effort are confirmed from \`events.jsonl\`. Before the first \`codex exec\`, confirm Codex is logged in and that no Codex instruction file it loads from the worktree up to the filesystem root holds an orchestration policy.
`;
}

const RENDER = { exp: rolesExp, codex: rolesCodex, claude: rolesClaude };

export function renderRoles(edition, profileId) {
  return RENDER[edition](MODELS[edition][profileId]);
}

// The Builders block appended to ROLES AND INVOCATION when --builders is cheap or cheap-100.
const BUILDER_RUN = {
  codex: () => "- Spawn each builder once per task with native `spawn_agent`, its own model and reasoning effort, inheriting the conversation; give later assignments as same-thread deltas, each with the worktree from `node .cloop/cloop.mjs call dynamic|mechanical`.",
  exp: () => `- Each builder is one \`codex exec\` session for the whole task. First assignment: ${CODEX_EXEC} with its own model and effort, carrying the conversation packet; keep the \`thread_id\` from its \`thread.started\` event. Later assignments: \`codex exec resume <thread_id> --json -o "$REPO/cloop/runs/<call-id>/out.md" "Read <packet path> and follow it." < /dev/null > "$REPO/cloop/runs/<call-id>/events.jsonl"\`, with a delta packet naming the worktree from \`node .cloop/cloop.mjs call dynamic|mechanical\`. Run both builders as background jobs and wait for both in this turn.`,
  claude: (rows) => `- Spawn each builder once per task with the native \`Agent\` tool, never as a fork, with its \`model\` (${claudeAliases(rows)}) and \`effort\`, seeded with the conversation packet; continue it only through \`SendMessage\` with deltas, each naming the worktree from \`node .cloop/cloop.mjs call dynamic|mechanical\`.`,
};

export function renderBuilders(edition, builderId, vendor) {
  const rows = vendor.profiles[builderId];
  const src = vendor.source;
  const d = [rows.dynamic.model, rows.dynamic.effort];
  const k = [rows.mechanical.model, rows.mechanical.effort];
  return `
**Builders** (\`--builders ${builderId}\`: cheapGPT ${src.version}, \`${src.edition}\` edition; the BUILDERS section applies):

| Builder | Model | Writes |
|---|---|---|
| Dynamic | ${label(d)} | its call's worktree of BEST |
| Mechanical | ${label(k)} | its call's worktree of BEST |

${BUILDER_RUN[edition]([d, k])}
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
  const start = body.indexOf("\n### ROLES AND INVOCATION\n");
  if (start < 0 || countOf(body, "\n### ROLES AND INVOCATION\n") !== 1) fail("the main prompt must contain exactly one '### ROLES AND INVOCATION' subsection");
  const next = body.indexOf("\n### ", start + 1);
  if (next < 0) fail("'### ROLES AND INVOCATION' must be followed by another '### ' subsection");
  return { start: start + 1, end: next + 1 };
}

export function buildProfile(parsed, edition, profileId, builderId = "none", vendor = null) {
  const { body } = parsed;
  const span = rolesSpan(body);
  const txtRoles = body.slice(span.start, span.end);
  const expected = renderRoles(SOURCE_EDITION, "town") + "\n";
  if (txtRoles !== expected) {
    fail("the txt's ROLES AND INVOCATION subsection differs from the codex/town template in tools/release.mjs. Update the template to match the txt, then rerun.");
  }
  if (!body.includes("\n### BUILDERS\n")) fail("the main prompt must contain a '### BUILDERS' subsection");
  if (countOf(body, INTRO_TOWN) !== 1) fail(`the intro sentence must appear exactly once: ${INTRO_TOWN}`);
  if (countOf(body, LABS_SAME) !== 1) fail(`the council sentence must appear exactly once: ${LABS_SAME}`);
  let roles = renderRoles(edition, profileId);
  if (builderId !== "none") roles += renderBuilders(edition, builderId, vendor);
  let out = body.slice(0, span.start) + roles + "\n" + body.slice(span.end);
  out = out.replace("PROFILE: town\n", `PROFILE: ${profileId}\n`);
  if (edition !== "codex") out = out.replace(INTRO_TOWN, INTRO_TOWN.replace("a Codex session", "a Claude Code session"));
  if (edition === "exp") out = out.replace(LABS_SAME, LABS_MAIN);
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
  const rel = `editions/${edition}/vendor/cheapgpt-builders.json`, file = path.join(repo, rel);
  if (!existsSync(file)) fail(`missing ${rel}; run node tools/sync-builders.mjs --edition ${edition} first`);
  const vendor = JSON.parse(readFileSync(file, "utf8"));
  if (vendor.edition !== edition) fail(`${rel} is for edition ${vendor.edition}, not ${edition}`);
  if (vendor.source?.edition !== edition) fail(`${rel}: builders come from cheapGPT ${vendor.source?.edition}; each cLoop edition takes them from the cheapGPT edition of the same name (${edition})`);
  for (const b of BUILDER_IDS) {
    for (const kind of ["dynamic", "mechanical"]) {
      const row = vendor.profiles?.[b]?.[kind];
      if (!row || !row.model || !row.effort) fail(`${rel} lacks the ${b} ${kind} builder`);
      if (edition === "claude" && !CLAUDE_ALIAS[row.model]) fail(`no Claude Code alias for builder model ${row.model}`);
    }
  }
  return vendor;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--txt" || token === "--version") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) fail(`${token} needs a value`);
      args[token.slice(2)] = value;
      i += 1;
    } else fail(`unknown option ${token}`);
  }
  return args;
}

// Every file that carries the version, with the one line that holds it.
const VERSIONED = [
  ["editions/claude/install.mjs", /^export const PACKAGE_VERSION = "(\d+\.\d+\.\d+)";$/m, (v) => `export const PACKAGE_VERSION = "${v}";`],
  ["editions/codex/install.mjs", /^export const PACKAGE_VERSION = "(\d+\.\d+\.\d+)";$/m, (v) => `export const PACKAGE_VERSION = "${v}";`],
  ["cloop.mjs", /^const VERSION = '(\d+\.\d+\.\d+)';$/m, (v) => `const VERSION = '${v}';`],
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.txt) fail("usage: node tools/release.mjs --txt <cloop-town.txt> [--version X.Y.Z]");
  if (args.version && !/^\d+\.\d+\.\d+$/.test(args.version)) fail("--version must look like 1.2.3");
  const versions = new Set();
  for (const [rel, re, line] of VERSIONED) {
    const file = path.join(REPO, rel);
    if (!existsSync(file)) fail(`missing ${rel}; run from a cLoop checkout`);
    let text = readFileSync(file, "utf8");
    const hits = text.match(new RegExp(re.source, "gm")) || [];
    if (hits.length !== 1) fail(`${rel} must hold exactly one version line`);
    if (args.version) { text = text.replace(re, line(args.version)); writeFileSync(file, text); }
    versions.add(args.version || text.match(re)[1]);
  }
  if (versions.size !== 1) fail(`the installers and the engine carry different versions (${[...versions].join(", ")}); pass --version`);
  const [version] = versions;
  const parsed = parseTxt(readFileSync(path.resolve(args.txt), "utf8"));
  for (const edition of EDITIONS) {
    const vendor = loadVendor(REPO, edition);
    const profilesDir = path.join(REPO, "editions", edition, "profiles");
    if (!existsSync(profilesDir)) fail(`missing editions/${edition}/profiles`);
    for (const name of readdirSync(profilesDir)) if (name.endsWith(".md")) rmSync(path.join(profilesDir, name));
    for (const id of PROFILE_IDS) {
      for (const b of ["none", ...BUILDER_IDS]) {
        writeFileSync(path.join(profilesDir, profileFile(id, b)), buildProfile(parsed, edition, id, b, vendor));
      }
    }
    writeFileSync(path.join(profilesDir, "catalog.json"), JSON.stringify(buildCatalog(parsed, edition, version, vendor), null, 2) + "\n");
  }
  process.stdout.write(`release.mjs: OK version=${version} editions=${EDITIONS.join(",")} profiles=${EDITIONS.length * PROFILE_IDS.length * 3}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
