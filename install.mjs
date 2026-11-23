#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cheapgptMessage, detectCheapgpt } from "./cheapgpt-guard.mjs";

export const PACKAGE_VERSION = "1.1.0";
export const SCHEMA_VERSION = 1;
export const START_MARKER = "<!-- cloop:managed:start -->";
export const END_MARKER = "<!-- cloop:managed:end -->";
export const HOOK_TAG = "cloop:";
export const HOOK_SCRIPT_NAME = "cloop-turn.mjs";
export const INSTRUCTION_FILE = "CLAUDE.md";
export const HOOK_MODE = "claude";
export const CODEX_PERMISSION = "Bash(codex exec:*)";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_ALIASES = {
  town: "town",
  "town-council": "town",
  high: "high",
  "high-council": "high",
};
export const BUILDER_IDS = ["none", "cheap", "cheap-100"];
export const TOOL_NAME = "cloop.mjs"; // the flow tool the profiles run, installed at the project root

export class CloopError extends Error {
  constructor(message, code = "CLOOP") {
    super(message);
    this.code = code;
  }
}

export function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function resolveProfileId(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  return PROFILE_ALIASES[key] || null;
}

export function resolveBuilders(input) {
  if (input == null) return null;
  const key = String(input).trim().toLowerCase();
  return BUILDER_IDS.includes(key) ? key : undefined;
}

export async function loadCatalog(sourceRoot = HERE) {
  const catalogPath = path.join(sourceRoot, "profiles", "catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (!catalog || !catalog.profiles) {
    throw new CloopError("profiles/catalog.json is missing profiles", "CATALOG");
  }
  return catalog;
}

export async function loadProfile(profileId, sourceRoot = HERE, builders = "none") {
  const catalog = await loadCatalog(sourceRoot);
  const meta = catalog.profiles[profileId];
  if (!meta) {
    throw new CloopError(
      `Unknown profile '${profileId}'. Use town or high.`,
      "PROFILE"
    );
  }
  const file = builders === "none" ? meta.file : meta.builders?.[builders]?.file;
  if (!file) {
    throw new CloopError(`Unknown builders '${builders}'. Use none, cheap or cheap-100.`, "BUILDERS");
  }
  const filePath = path.join(sourceRoot, "profiles", file);
  const body = await readFile(filePath, "utf8");
  return {
    id: profileId,
    builders,
    meta,
    body,
    sha256: sha256(body),
    path: filePath,
  };
}

export function buildManagedBlock(profileId, profileBody, builders = "none") {
  const body = String(profileBody).replace(/\s+$/, "");
  return [
    START_MARKER,
    "## cLoop Orchestration Policy",
    "",
    builders === "none" ? `Active profile: \`${profileId}\`` : `Active profile: \`${profileId}\` · builders: \`${builders}\``,
    "",
    "This cLoop policy applies to every user turn in this repository and is addressed to the root agent; subagents follow only the instructions addressed to their role. Treat the active profile below as persistent orchestration policy for planning, implementation, testing, review, debugging, and completion. Do not silently substitute any model or reasoning effort the profile specifies for its roles. A preferred root configuration is advisory and must not block the already-running harness/system root. If the policy appears unavailable after context compaction or another harness transition, recover the current managed cLoop block before delegating or implementing.",
    "",
    body,
    "",
    END_MARKER,
    "",
  ].join("\n");
}

export function extractManagedRegion(source) {
  const text = source == null ? "" : String(source);
  const starts = [];
  const ends = [];
  for (let i = 0; i < text.length; ) {
    const found = text.indexOf(START_MARKER, i);
    if (found < 0) break;
    starts.push(found);
    i = found + START_MARKER.length;
  }
  for (let i = 0; i < text.length; ) {
    const found = text.indexOf(END_MARKER, i);
    if (found < 0) break;
    ends.push(found);
    i = found + END_MARKER.length;
  }
  if (starts.length === 0 && ends.length === 0) {
    return { kind: "absent", source: text };
  }
  if (starts.length !== 1 || ends.length !== 1) {
    return {
      kind: "malformed",
      reason:
        starts.length !== 1
          ? `expected exactly one start marker, found ${starts.length}`
          : `expected exactly one end marker, found ${ends.length}`,
      source: text,
    };
  }
  if (ends[0] < starts[0]) {
    return {
      kind: "malformed",
      reason: "end marker precedes start marker",
      source: text,
    };
  }
  let end = ends[0] + END_MARKER.length;
  if (text[end] === "\r") end += 1;
  if (text[end] === "\n") end += 1;
  return {
    kind: "ok",
    start: starts[0],
    end,
    block: text.slice(starts[0], end),
    source: text,
  };
}

export function extractProfileFromBlock(block, profileId) {
  const region = extractManagedRegion(block);
  if (region.kind !== "ok") return null;
  const inner = region.block
    .replace(START_MARKER, "")
    .replace(END_MARKER, "");
  const needle = "recover the current managed cLoop block before delegating or implementing.";
  const idx = inner.indexOf(needle);
  if (idx < 0) return inner.trim();
  return inner.slice(idx + needle.length).trim();
}

export function applyManagedBlock(source, block) {
  const region = extractManagedRegion(source);
  if (region.kind === "malformed") {
    throw new CloopError(
      `AGENTS.md cLoop markers are malformed (${region.reason}). Refusing to guess. Fix or restore the file, then rerun.`,
      "MARKERS"
    );
  }
  const normalizedBlock = block.endsWith("\n") ? block : `${block}\n`;
  if (region.kind === "absent") {
    const preserved = String(source || "").replace(/\s+$/, "");
    return preserved ? `${preserved}\n\n${normalizedBlock}` : normalizedBlock;
  }
  const before = region.source.slice(0, region.start).replace(/\s+$/, "");
  const after = region.source.slice(region.end).replace(/^\s+/, "").replace(/\s+$/, "");
  const parts = [];
  if (before) parts.push(before);
  parts.push(normalizedBlock.replace(/\n+$/, ""));
  if (after) parts.push(after);
  return `${parts.join("\n\n")}\n`;
}

export function removeManagedBlock(source) {
  const region = extractManagedRegion(source);
  if (region.kind === "malformed") {
    throw new CloopError(
      `AGENTS.md cLoop markers are malformed (${region.reason}). Refusing to uninstall.`,
      "MARKERS"
    );
  }
  if (region.kind === "absent") return String(source || "");
  const before = region.source.slice(0, region.start).replace(/\s+$/, "");
  const after = region.source.slice(region.end).replace(/^\s+/, "").replace(/\s+$/, "");
  if (!before && !after) return "";
  if (before && after) return `${before}\n\n${after}\n`;
  return `${before || after}\n`;
}

function projectPaths(projectRoot) {
  return {
    root: projectRoot,
    agents: path.join(projectRoot, INSTRUCTION_FILE), // instruction file (CLAUDE.md); property name kept for a minimal diff
    stateDir: path.join(projectRoot, ".cloop"),
    state: path.join(projectRoot, ".cloop", "state.json"),
    claudeDir: path.join(projectRoot, ".claude"),
    hooksDir: path.join(projectRoot, ".claude", "hooks"),
    hooksJson: path.join(projectRoot, ".claude", "settings.json"), // Claude Code settings file holding the hooks key
    hookScript: path.join(projectRoot, ".claude", "hooks", HOOK_SCRIPT_NAME),
    tool: path.join(projectRoot, TOOL_NAME),
  };
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(tmp, contents, "utf8");
  try {
    await rename(tmp, filePath);
  } catch {
    await rm(filePath, { force: true });
    await rename(tmp, filePath);
  }
}

function hookCommand() {
  return `node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${HOOK_SCRIPT_NAME}"`;
}

function isCloopHookHandler(handler) {
  if (!handler || typeof handler !== "object") return false;
  const command = `${handler.command || ""} ${handler.commandWindows || ""} ${handler.statusMessage || ""}`;
  return command.includes(HOOK_SCRIPT_NAME) || command.includes(HOOK_TAG);
}

function cloopHookHandler(kind) {
  return { type: "command", command: hookCommand(), statusMessage: `${HOOK_TAG}${kind}`, timeout: 15 };
}

export function mergeCloopHooks(existingJson, enabled) {
  let parsed;
  if (existingJson == null || existingJson.trim() === "") {
    parsed = { hooks: {} };
  } else {
    try {
      parsed = JSON.parse(existingJson);
    } catch {
      throw new CloopError(
        "Existing .claude/settings.json is not valid JSON. Refusing to rewrite unrelated hooks.",
        "HOOKS"
      );
    }
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CloopError("Existing .claude/settings.json is not an object.", "HOOKS");
  }
  if (!parsed.hooks || typeof parsed.hooks !== "object" || Array.isArray(parsed.hooks)) {
    parsed.hooks = {};
  }

  const strip = (eventName) => {
    const groups = parsed.hooks[eventName];
    if (!Array.isArray(groups)) return;
    const kept = [];
    for (const group of groups) {
      if (!group || typeof group !== "object") {
        throw new CloopError(
          `Refusing to rewrite malformed ${eventName} hook group.`,
          "HOOKS"
        );
      }
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      const remaining = handlers.filter((handler) => !isCloopHookHandler(handler));
      const removedCloop = remaining.length !== handlers.length;
      if (!removedCloop) {
        kept.push(group);
        continue;
      }
      if (remaining.length > 0) {
        kept.push({ ...group, hooks: remaining });
      }
    }
    if (kept.length) parsed.hooks[eventName] = kept;
    else delete parsed.hooks[eventName];
  };

  strip("UserPromptSubmit");
  strip("SessionStart");

  if (enabled) {
    const promptGroups = Array.isArray(parsed.hooks.UserPromptSubmit)
      ? parsed.hooks.UserPromptSubmit
      : [];
    promptGroups.push({
      hooks: [cloopHookHandler("heartbeat")],
    });
    parsed.hooks.UserPromptSubmit = promptGroups;

    const startGroups = Array.isArray(parsed.hooks.SessionStart)
      ? parsed.hooks.SessionStart
      : [];
    startGroups.push({
      matcher: "compact",
      hooks: [cloopHookHandler("recovery")],
    });
    parsed.hooks.SessionStart = startGroups;
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function mergeCodexPermission(settingsText, enabled) {
  const parsed = settingsText && settingsText.trim() ? JSON.parse(settingsText) : {};
  if (!parsed.permissions || typeof parsed.permissions !== "object") parsed.permissions = {};
  const allow = Array.isArray(parsed.permissions.allow) ? parsed.permissions.allow.filter((x) => x !== CODEX_PERMISSION) : [];
  if (enabled) allow.push(CODEX_PERMISSION);
  if (allow.length) parsed.permissions.allow = allow; else delete parsed.permissions.allow;
  if (!Object.keys(parsed.permissions).length) delete parsed.permissions;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
export function hasCodexPermission(settingsText) {
  try { return (JSON.parse(settingsText)?.permissions?.allow || []).includes(CODEX_PERMISSION); } catch { return false; }
}

export function cloopHookCount(hooksJson) {
  if (!hooksJson) return { heartbeat: 0, recovery: 0 };
  let parsed;
  try {
    parsed = JSON.parse(hooksJson);
  } catch {
    return { heartbeat: 0, recovery: 0, malformed: true };
  }
  const count = (eventName, kind) => {
    const groups = parsed?.hooks?.[eventName];
    if (!Array.isArray(groups)) return 0;
    let n = 0;
    for (const group of groups) {
      for (const handler of group?.hooks || []) {
        if (isCloopHookHandler(handler) && String(handler.statusMessage || "").includes(kind)) {
          n += 1;
        }
      }
    }
    return n;
  };
  return {
    heartbeat: count("UserPromptSubmit", "heartbeat"),
    recovery: count("SessionStart", "recovery"),
  };
}

function snapshotFile(filePath, contents) {
  return { filePath, existed: contents != null, contents };
}

async function restoreSnapshots(snapshots) {
  for (const snap of snapshots) {
    if (!snap.existed) {
      await rm(snap.filePath, { force: true });
    } else {
      await atomicWrite(snap.filePath, snap.contents);
    }
  }
}

async function maybeFail(stage) {
  if (process.env.CLOOP_FAIL_AFTER === stage) {
    throw new CloopError(`induced failure after ${stage}`, "INDUCED");
  }
}

function buildState({
  profile,
  managedBlock,
  hookMode,
  created,
  previous,
}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    packageVersion: PACKAGE_VERSION,
    profile: profile.id,
    root: profile.meta.root,
    council: profile.meta.council,
    explorer: profile.meta.explorer,
    builders: profile.builders || "none",
    buildersDetail: profile.builders && profile.builders !== "none" ? profile.meta.builders?.[profile.builders] || null : null,
    buildersSource: profile.builders && profile.builders !== "none" ? profile.buildersSource || null : null,
    planningMode: profile.meta.planningMode,
    implementationMode: profile.meta.implementationMode,
    installedAt: previous?.installedAt || now,
    updatedAt: now,
    instructionFile: INSTRUCTION_FILE,
    managedBlockSha256: sha256(managedBlock),
    profileSha256: profile.sha256,
    hookMode,
    hookFiles: hookMode === HOOK_MODE ? [`.claude/hooks/${HOOK_SCRIPT_NAME}`] : [],
    created: {
      agents: Boolean(created?.agents),
      hooksJson: Boolean(created?.hooksJson),
      hookScript: Boolean(created?.hookScript),
      stateDir: Boolean(created?.stateDir),
      claudeDir: Boolean(created?.claudeDir),
    },
    codexPermission: Boolean(created?.codexPermission),
  };
}

async function readState(paths) {
  const raw = await readTextIfExists(paths.state);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new CloopError(
      ".cloop/state.json exists but is not valid JSON. Use --force only after reviewing the file.",
      "STATE"
    );
  }
}

function managedBlockModified(state, currentBlock) {
  if (!state || !currentBlock) return false;
  return sha256(currentBlock) !== state.managedBlockSha256;
}

export function parseArgs(argv) {
  const args = {
    command: null,
    project: process.cwd(),
    profile: null,
    builders: null,
    dryRun: false,
    force: false,
    json: false,
    hooks: true,
    hooksExplicit: false,
    help: false,
  };
  const rest = argv.slice(2);
  if (rest.length === 0 || rest[0] === "-h" || rest[0] === "--help") {
    args.command = "help";
    args.help = true;
    return args;
  }
  const first = rest[0];
  if (first.startsWith("-")) {
    throw new CloopError(
      "Missing command. Use install, update, doctor, or uninstall.",
      "USAGE"
    );
  }
  args.command = first;
  for (let i = 1; i < rest.length; i += 1) {
    const token = rest[i];
    const next = () => {
      const value = rest[i + 1];
      if (value == null || value.startsWith("-")) {
        throw new CloopError(`Missing value for ${token}`, "USAGE");
      }
      i += 1;
      return value;
    };
    if (token === "--project") args.project = path.resolve(next());
    else if (token.startsWith("--project=")) args.project = path.resolve(token.slice(10));
    else if (token === "--profile") args.profile = next();
    else if (token.startsWith("--profile=")) args.profile = token.slice(10);
    else if (token === "--builders") args.builders = next();
    else if (token.startsWith("--builders=")) args.builders = token.slice(11);
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--force") args.force = true;
    else if (token === "--json") args.json = true;
    else if (token === "--hooks" || token === "--turn-reminder") {
      args.hooks = true;
      args.hooksExplicit = true;
    } else if (token === "--no-hooks" || token === "--no-turn-reminder") {
      args.hooks = false;
      args.hooksExplicit = true;
    }
    else if (token === "--global") {
      throw new CloopError(
        "cLoop refuses --global. It is project-local only and writes that project's CLAUDE.md and .claude/, never ~/.claude.",
        "USAGE"
      );
    } else if (token === "-h" || token === "--help") {
      args.help = true;
      args.command = "help";
    } else {
      throw new CloopError(`Unknown option ${token}`, "USAGE");
    }
  }
  return args;
}

export function helpText() {
  return `cLoop — project-local Claude Code orchestration installer

cLoop never installs globally. It only mutates the target --project directory:
  CLAUDE.md
  .cloop/state.json
  .claude/settings.json (hooks key)
  .claude/hooks/cloop-turn.mjs

Every repository needs its own install. Installing in one project does not affect others.

Usage:
  node install.mjs install --project . --profile <id>
  node install.mjs update --project . [--profile <id>]
  node install.mjs doctor --project .
  node install.mjs uninstall --project .

Profiles:
  town   Town Council   root=Opus 5.5 medium; council=Sonnet 5.5 xhigh + Opus 5.5 medium
  high   High Council   root=Opus 5.5 high; council=Opus 5.5 xhigh + Fable 5.1 xhigh

Options:
  --project <dir>     Target repository (default: cwd)
  --profile <id>      Required for install; optional for update
  --builders <id>     none (default), cheap or cheap-100: cheapGPT's builders take the build
                      steps; kept by update until you pass another value
  --dry-run           Validate and report without writing
  --force             Overwrite a manually edited cLoop block
  --json              Machine-readable output
  --no-hooks          Skip Claude Code heartbeat/recovery hooks
  --hooks             Install hooks (default)

Do not copy-paste profile text into CLAUDE.md. Always run this script.
`;
}

async function inspectProject(paths) {
  const agents = await readTextIfExists(paths.agents);
  const state = await readState(paths);
  const hooksJson = await readTextIfExists(paths.hooksJson);
  const region = extractManagedRegion(agents || "");
  return {
    agents,
    state,
    hooksJson,
    region,
    hasAgents: agents != null,
    hasState: state != null,
    hasHooksJson: hooksJson != null,
    hasClaudeDir: existsSync(paths.claudeDir),
    hasStateDir: existsSync(paths.stateDir),
    hasHookScript: existsSync(paths.hookScript),
  };
}

function requireUnmodified(inspect, force, action) {
  if (inspect.region.kind === "malformed") {
    throw new CloopError(
      `AGENTS.md cLoop markers are malformed (${inspect.region.reason}). ${action} refused.`,
      "MARKERS"
    );
  }
  if (
    inspect.state &&
    inspect.region.kind === "ok" &&
    managedBlockModified(inspect.state, inspect.region.block) &&
    !force
  ) {
    throw new CloopError(
      `cLoop managed block in AGENTS.md was modified by hand. ${action} refused. Review the block, then rerun with --force.`,
      "MODIFIED"
    );
  }
}

async function writeInstallation({
  paths,
  inspect,
  profile,
  hookMode,
  dryRun,
}) {
  const catalog = await loadCatalog(HERE);
  const managedBlock = buildManagedBlock(profile.id, profile.body, profile.builders);
  const nextAgents = applyManagedBlock(inspect.agents || "", managedBlock);
  const created = {
    agents: !inspect.hasAgents,
    hooksJson: hookMode === HOOK_MODE && !inspect.hasHooksJson,
    hookScript: hookMode === HOOK_MODE && !inspect.hasHookScript,
    stateDir: !inspect.hasStateDir,
    claudeDir: (hookMode === HOOK_MODE || true) && !inspect.hasClaudeDir,
  };
  const nextState = buildState({
    profile,
    managedBlock,
    hookMode,
    created: {
      agents: inspect.state?.created?.agents || created.agents,
      hooksJson: hookMode === HOOK_MODE && (inspect.state?.created?.hooksJson || created.hooksJson),
      hookScript: hookMode === HOOK_MODE && (inspect.state?.created?.hookScript || created.hookScript),
      stateDir: inspect.state?.created?.stateDir || created.stateDir,
      claudeDir: inspect.state?.created?.claudeDir || created.claudeDir,
      codexPermission: catalog.harness === "claude-codex",
    },
    previous: inspect.state,
  });
  let nextHooksJson =
    hookMode === HOOK_MODE
      ? mergeCloopHooks(inspect.hooksJson, true)
      : inspect.hasHooksJson
        ? mergeCloopHooks(inspect.hooksJson, false)
        : null;
  if (catalog.harness === "claude-codex") {
    nextHooksJson = mergeCodexPermission(nextHooksJson == null ? "" : nextHooksJson, true);
  }
  const hookSource = path.join(HERE, "hooks", HOOK_SCRIPT_NAME);

  const planned = {
    profile: profile.id,
    instructionFile: INSTRUCTION_FILE,
    hookMode,
    managedBlockSha256: nextState.managedBlockSha256,
    writes: [INSTRUCTION_FILE, ".cloop/state.json", TOOL_NAME],
  };
  if (hookMode === HOOK_MODE) {
    planned.writes.push(".claude/settings.json", `.claude/hooks/${HOOK_SCRIPT_NAME}`);
  } else if (inspect.hasHooksJson || inspect.hasHookScript || catalog.harness === "claude-codex") {
    planned.writes.push(".claude/settings.json");
    if (inspect.hasHookScript) planned.removes = [`.claude/hooks/${HOOK_SCRIPT_NAME}`];
  }

  if (dryRun) {
    return { dryRun: true, ...planned };
  }

  const snapshots = [
    snapshotFile(paths.agents, inspect.agents),
    snapshotFile(paths.state, inspect.hasState ? JSON.stringify(inspect.state, null, 2) + "\n" : null),
    snapshotFile(paths.hooksJson, inspect.hooksJson),
    snapshotFile(
      paths.hookScript,
      inspect.hasHookScript ? await readTextIfExists(paths.hookScript) : null
    ),
    snapshotFile(paths.tool, await readTextIfExists(paths.tool)),
  ];

  try {
    await atomicWrite(paths.agents, nextAgents);
    await maybeFail("agents");
    await copyFile(path.join(HERE, TOOL_NAME), paths.tool);
    if (hookMode === HOOK_MODE) {
      await mkdir(paths.hooksDir, { recursive: true });
      await copyFile(hookSource, paths.hookScript);
      await maybeFail("hooks");
    }
    if (nextHooksJson != null) {
      await atomicWrite(paths.hooksJson, nextHooksJson);
    }
    if (hookMode !== HOOK_MODE && inspect.hasHookScript) {
      await rm(paths.hookScript, { force: true });
    }
    await maybeFail("state");
    await atomicWrite(paths.state, `${JSON.stringify(nextState, null, 2)}\n`);
  } catch (err) {
    await restoreSnapshots(snapshots);
    throw err;
  }

  return { dryRun: false, ...planned, state: nextState };
}

export const ADOPTION_NOTE =
  "Next: cloop/rubric.md does not exist yet. In an existing project the first FOCUSED or FULL task starts with ADOPTION (node cloop.mjs init detects the project and enters ADOPT), so the rubric, the spec and the architecture exist before feature work. In a new project, the first task writes them in DEFINE.";

function withAdoptionNote(result, inspect, paths) {
  if (!result.dryRun && !inspect.state && !existsSync(path.join(paths.root, "cloop", "rubric.md"))) {
    return { ...result, notes: [ADOPTION_NOTE] };
  }
  return result;
}

async function refuseCheapgpt(projectRoot, sourceRoot) {
  const detected = await detectCheapgpt(projectRoot);
  if (detected.found.length) {
    const catalog = await loadCatalog(sourceRoot);
    throw new CloopError(cheapgptMessage(detected, catalog.edition), "CHEAPGPT");
  }
}

async function cmdInstall(args, sourceRoot = HERE) {
  const profileId = resolveProfileId(args.profile);
  if (!profileId) {
    throw new CloopError(
      "install requires --profile town|high",
      "USAGE"
    );
  }
  const paths = projectPaths(args.project);
  const inspect = await inspectProject(paths);
  const builders = resolveBuilders(args.builders ?? "none");
  if (!builders) throw new CloopError("--builders takes none, cheap or cheap-100", "USAGE");
  await refuseCheapgpt(paths.root, sourceRoot);
  requireUnmodified(inspect, args.force, "install");
  const profile = await loadProfile(profileId, sourceRoot, builders);
  profile.buildersSource = (await loadCatalog(sourceRoot)).buildersSource || null;
  const hookMode = args.hooks ? HOOK_MODE : "none";
  return writeInstallation({
    paths,
    inspect,
    profile,
    hookMode,
    dryRun: args.dryRun,
  }).then((result) => withAdoptionNote(result, inspect, paths));
}

async function cmdUpdate(args, sourceRoot = HERE) {
  const paths = projectPaths(args.project);
  const inspect = await inspectProject(paths);
  if (!inspect.state && inspect.region.kind === "absent") {
    throw new CloopError(
      "No cLoop installation found. Run install --profile <id> first.",
      "MISSING"
    );
  }
  requireUnmodified(inspect, args.force, "update");
  const profileId = resolveProfileId(args.profile) || resolveProfileId(inspect.state?.profile);
  if (!resolveProfileId(profileId)) {
    throw new CloopError(
      "update needs --profile because existing state has no recognized profile.",
      "USAGE"
    );
  }
  const builders = args.builders != null ? resolveBuilders(args.builders) : resolveBuilders(inspect.state?.builders) || "none";
  if (!builders) throw new CloopError("--builders takes none, cheap or cheap-100", "USAGE");
  await refuseCheapgpt(paths.root, sourceRoot);
  const profile = await loadProfile(resolveProfileId(profileId), sourceRoot, builders);
  profile.buildersSource = (await loadCatalog(sourceRoot)).buildersSource || null;
  let hookMode = inspect.state?.hookMode === "none" ? "none" : HOOK_MODE;
  if (args.hooksExplicit) hookMode = args.hooks ? HOOK_MODE : "none";
  return writeInstallation({
    paths,
    inspect,
    profile,
    hookMode,
    dryRun: args.dryRun,
  });
}

async function cmdUninstall(args) {
  const paths = projectPaths(args.project);
  const inspect = await inspectProject(paths);
  if (!inspect.state && inspect.region.kind === "absent" && !inspect.hasHookScript) {
    throw new CloopError("No cLoop installation found.", "MISSING");
  }
  requireUnmodified(inspect, args.force, "uninstall");

  const nextAgents =
    inspect.agents == null ? null : removeManagedBlock(inspect.agents);
  let nextHooksJson = inspect.hasHooksJson
    ? mergeCloopHooks(inspect.hooksJson, false)
    : null;
  if (inspect.state?.codexPermission && nextHooksJson != null) {
    nextHooksJson = mergeCodexPermission(nextHooksJson, false);
  }

  const planned = {
    removes: [".cloop/state.json"],
    writes: [],
  };
  if (existsSync(paths.tool)) planned.removes.push(TOOL_NAME);
  if (inspect.hasAgents) planned.writes.push(INSTRUCTION_FILE);
  if (inspect.hasHookScript) planned.removes.push(`.claude/hooks/${HOOK_SCRIPT_NAME}`);
  if (inspect.hasHooksJson || inspect.state?.codexPermission) planned.writes.push(".claude/settings.json");

  if (args.dryRun) {
    return { dryRun: true, action: "uninstall", ...planned };
  }

  const snapshots = [
    snapshotFile(paths.agents, inspect.agents),
    snapshotFile(paths.state, inspect.hasState ? JSON.stringify(inspect.state, null, 2) + "\n" : null),
    snapshotFile(paths.hooksJson, inspect.hooksJson),
    snapshotFile(
      paths.hookScript,
      inspect.hasHookScript ? await readTextIfExists(paths.hookScript) : null
    ),
    snapshotFile(paths.tool, await readTextIfExists(paths.tool)),
  ];

  try {
    await rm(paths.tool, { force: true });
    if (nextAgents == null || nextAgents.trim() === "") {
      if (inspect.hasAgents) await rm(paths.agents, { force: true });
    } else {
      await atomicWrite(paths.agents, nextAgents);
    }
    await maybeFail("agents");
    if (inspect.hasHookScript) await rm(paths.hookScript, { force: true });
    if (nextHooksJson != null) {
      const parsed = JSON.parse(nextHooksJson);
      const empty =
        (Object.keys(parsed).length === 0 || (Object.keys(parsed).length === 1 && parsed.hooks && Object.keys(parsed.hooks).length === 0)) &&
        inspect.state?.created?.hooksJson;
      if (empty) await rm(paths.hooksJson, { force: true });
      else await atomicWrite(paths.hooksJson, nextHooksJson);
    }
    await maybeFail("state");
    await rm(paths.state, { force: true });
    if (existsSync(paths.stateDir)) {
      try {
        await rm(paths.stateDir, { recursive: true });
      } catch {
        /* keep dir if not empty */
      }
    }
  } catch (err) {
    await restoreSnapshots(snapshots);
    throw err;
  }

  return { dryRun: false, action: "uninstall", ...planned };
}

export async function doctorProject(projectRoot, sourceRoot = HERE) {
  const paths = projectPaths(projectRoot);
  const inspect = await inspectProject(paths);
  const catalog = await loadCatalog(sourceRoot);
  const issues = [];
  const warnings = [];

  if (!inspect.hasState) issues.push("missing .cloop/state.json");
  let state = inspect.state;
  if (state) {
    if (state.schemaVersion !== SCHEMA_VERSION) {
      issues.push(`state schemaVersion ${state.schemaVersion} != ${SCHEMA_VERSION}`);
    }
    if (state.packageVersion && state.packageVersion !== PACKAGE_VERSION) {
      warnings.push(
        `installed packageVersion ${state.packageVersion} != ${PACKAGE_VERSION}; run update`
      );
    }
    if (!resolveProfileId(state.profile)) issues.push(`unrecognized profile '${state.profile}'`);
    if (state.instructionFile !== INSTRUCTION_FILE) {
      issues.push(`instructionFile ${state.instructionFile} is not AGENTS.md`);
    }
  }
  if (!inspect.hasAgents) issues.push(`missing ${INSTRUCTION_FILE}`);
  if (inspect.region.kind === "absent") issues.push(`no cLoop managed block in ${INSTRUCTION_FILE}`);
  if (inspect.region.kind === "malformed") issues.push(`malformed markers: ${inspect.region.reason}`);
  if (inspect.region.kind === "ok" && state) {
    if (managedBlockModified(state, inspect.region.block)) {
      issues.push("managed block hash does not match state.json");
    }
    const expectedProfile = state.profile && resolveProfileId(state.profile);
    if (expectedProfile) {
      try {
        const profile = await loadProfile(expectedProfile, sourceRoot, resolveBuilders(state.builders) || "none");
        const expected = buildManagedBlock(profile.id, profile.body, profile.builders);
        if (inspect.region.block.replace(/\s+$/, "") !== expected.replace(/\s+$/, "")) {
          warnings.push("installed block does not match current cLoop profile sources; run update");
        }
      } catch {
        warnings.push("could not load current profile sources for comparison");
      }
    }
  }

  const agentsMd = await readTextIfExists(path.join(projectRoot, "AGENTS.md"));
  if (inspect.agents && inspect.agents.includes("@AGENTS.md") && agentsMd && agentsMd.includes(START_MARKER)) {
    warnings.push("CLAUDE.md imports an AGENTS.md that holds a cLoop block; both policies would load");
  }

  const hookCounts = cloopHookCount(inspect.hooksJson);
  if (state?.hookMode === HOOK_MODE) {
    if (!inspect.hasHookScript) issues.push("missing .claude/hooks/cloop-turn.mjs");
    if (hookCounts.malformed) issues.push(".claude/settings.json is malformed");
    if (hookCounts.heartbeat !== 1) {
      issues.push(`expected exactly one cLoop UserPromptSubmit heartbeat hook, found ${hookCounts.heartbeat}`);
    }
    if (hookCounts.recovery !== 1) {
      issues.push(`expected exactly one cLoop SessionStart compact recovery hook, found ${hookCounts.recovery}`);
    }
    try {
      const expectedHook = await readFile(path.join(sourceRoot, "hooks", HOOK_SCRIPT_NAME), "utf8");
      const installedHook = await readTextIfExists(paths.hookScript);
      if (installedHook != null && sha256(installedHook) !== sha256(expectedHook)) {
        warnings.push("installed cLoop hook script does not match current sources; run update");
      }
    } catch {
      warnings.push("could not compare cLoop hook script to current sources");
    }
    warnings.push(
      "Claude Code runs project hooks only after you accept the workspace trust dialog; review them with /hooks. CLAUDE.md remains authoritative if hooks are skipped"
    );
  } else if (state?.hookMode === "none") {
    if (hookCounts.heartbeat || hookCounts.recovery) {
      issues.push("hookMode is none but cLoop hook entries still exist");
    }
  }

  if (catalog.harness === "claude-codex") {
    if (agentsMd && agentsMd.includes(START_MARKER)) {
      issues.push("AGENTS.md holds a cLoop block; Codex member and explorer sessions would load it as their own policy — remove it from AGENTS.md");
    }
    if (spawnSync("codex", ["--version"]).status !== 0) {
      warnings.push("codex CLI not found on PATH; Member B and the explorers cannot run");
    }
    if (!hasCodexPermission(inspect.hooksJson)) {
      issues.push(`missing ${CODEX_PERMISSION} permission in .claude/settings.json`);
    }
  }

  const recordedBuilders = state ? (state.builders == null ? "none" : resolveBuilders(state.builders)) : null;
  if (state && !recordedBuilders) issues.push(`unrecognized builders '${state.builders}'`);
  if (inspect.region.kind === "ok" && recordedBuilders) {
    const hasBlock = inspect.region.block.includes("**Builders** (`--builders ");
    const matches = recordedBuilders === "none" ? !hasBlock : inspect.region.block.includes(`**Builders** (\`--builders ${recordedBuilders}\``);
    if (!matches) issues.push(`the managed block's Builders section does not match --builders ${recordedBuilders}; run update`);
  }
  const vendorText = await readTextIfExists(path.join(sourceRoot, "vendor", "cheapgpt-builders.json"));
  let vendorSource = null;
  try {
    vendorSource = vendorText == null ? null : JSON.parse(vendorText).source;
  } catch {
    vendorSource = null;
  }
  const sourceCatalog = await loadCatalog(sourceRoot);
  if (JSON.stringify(vendorSource) !== JSON.stringify(sourceCatalog.buildersSource || null)) {
    issues.push("vendor/cheapgpt-builders.json does not match the builder source recorded in profiles/catalog.json; regenerate the profiles");
  } else if (recordedBuilders && recordedBuilders !== "none" && JSON.stringify(state.buildersSource || null) !== JSON.stringify(vendorSource)) {
    warnings.push("installed builders come from an older cheapGPT roles table than this checkout; run update");
  }
  const cheapgpt = await detectCheapgpt(projectRoot);
  if (cheapgpt.found.length) {
    issues.push(`cheapGPT is installed here too (${cheapgpt.found.join("; ")}); keep one package: remove cheapGPT with its own uninstaller, or uninstall cLoop`);
  }
  const installedTool = await readTextIfExists(paths.tool);
  if (installedTool == null) issues.push(`missing ${TOOL_NAME} at the project root`);
  else {
    const expectedTool = await readTextIfExists(path.join(sourceRoot, TOOL_NAME));
    if (expectedTool != null && sha256(installedTool.replace(/\r\n/g, "\n")) !== sha256(expectedTool.replace(/\r\n/g, "\n"))) warnings.push(`installed ${TOOL_NAME} does not match current sources; run update`);
  }

  return {
    ok: issues.length === 0,
    project: projectRoot,
    profile: state?.profile || null,
    builders: recordedBuilders || null,
    hookMode: state?.hookMode || null,
    issues,
    warnings,
  };
}

async function cmdDoctor(args, sourceRoot = HERE) {
  return doctorProject(args.project, sourceRoot);
}

export async function run(argv, options = {}) {
  const sourceRoot = options.sourceRoot || HERE;
  const args = parseArgs(argv);
  args.project = path.resolve(args.project);
  if (args.help || args.command === "help") {
    return { ok: true, help: helpText() };
  }
  const commands = {
    install: cmdInstall,
    update: cmdUpdate,
    uninstall: cmdUninstall,
    doctor: cmdDoctor,
  };
  const fn = commands[args.command];
  if (!fn) {
    throw new CloopError(
      `Unknown command '${args.command}'. Use install, update, doctor, or uninstall.`,
      "USAGE"
    );
  }
  const result = await fn(args, sourceRoot);
  return { ok: true, command: args.command, ...result };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

async function main() {
  try {
    const result = await run(process.argv);
    if (result.help) {
      process.stdout.write(result.help);
      return;
    }
    const jsonMode = process.argv.includes("--json");
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.command === "doctor") {
      if (result.ok) process.stdout.write("cLoop doctor: ok\n");
      else process.stdout.write("cLoop doctor: FAILED\n");
      if (result.profile) process.stdout.write(`profile: ${result.profile}\n`);
      if (result.builders) process.stdout.write(`builders: ${result.builders}\n`);
      if (result.hookMode) process.stdout.write(`hookMode: ${result.hookMode}\n`);
      for (const issue of result.issues || []) process.stdout.write(`issue: ${issue}\n`);
      for (const warning of result.warnings || []) process.stdout.write(`warning: ${warning}\n`);
      if (!result.ok) process.exitCode = 1;
    } else if (result.dryRun) {
      process.stdout.write(`cLoop ${result.command || "plan"} dry-run: no files written\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`cLoop ${result.command} complete (${result.profile || result.action || "ok"}${result.state?.builders && result.state.builders !== "none" ? `, builders ${result.state.builders}` : ""})\n`);
      for (const note of result.notes || []) process.stdout.write(`${note}\n`);
      if (result.hookMode === HOOK_MODE) process.stdout.write("Hooks installed in .claude/settings.json. Accept the workspace trust dialog and review /hooks.\n");
    }
    if (result.command === "doctor" && result.ok === false) process.exitCode = 1;
  } catch (err) {
    const jsonMode = process.argv.includes("--json");
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: err.message, code: err.code || "CLOOP" }, null, 2)}\n`
      );
    } else {
      process.stderr.write(`cloop: ${err.message}\n`);
    }
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  await main();
}
