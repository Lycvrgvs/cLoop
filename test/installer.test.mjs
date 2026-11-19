import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  END_MARKER,
  START_MARKER,
  applyManagedBlock,
  buildManagedBlock,
  cloopHookCount,
  extractManagedRegion,
  extractProfileFromBlock,
  G0_LINES,
  loadProfile,
  mergeCloopHooks,
  run,
  sha256,
} from "../install.mjs";
import { mergeMultiAgentConfig } from "../codex-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = path.join(ROOT, "install.mjs");
const HOOK = path.join(ROOT, "hooks", "cloop-turn.mjs");

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "cloop-"));
}

async function cli(project, args, env = {}) {
  return run(["node", INSTALL, ...args, "--project", project], { sourceRoot: ROOT });
}

function countMarkers(text) {
  return {
    start: text.split(START_MARKER).length - 1,
    end: text.split(END_MARKER).length - 1,
  };
}

test("empty repository install creates AGENTS.md, one block, state, and doctor passes", async () => {
  const dir = await tempDir();
  try {
    const result = await cli(dir, ["install", "--profile", "town"]);
    assert.equal(result.ok, true);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    const markers = countMarkers(agents);
    assert.equal(markers.start, 1);
    assert.equal(markers.end, 1);
    const profile = await loadProfile("town", ROOT);
    const inner = extractProfileFromBlock(agents, "town");
    assert.equal(inner, profile.body.trim());
    assert.match(agents, /You are the cLoop root/);
    assert.doesNotMatch(agents, /sol-6-high/);
    assert.doesNotMatch(agents, /sol-6-xhigh/);
    assert.doesNotMatch(agents, /sol-6-max/);
    assert.doesNotMatch(agents, /gpt-5\.6-sol xhigh/);
    const state = JSON.parse(await readFile(path.join(dir, ".cloop", "state.json"), "utf8"));
    assert.equal(state.profile, "town");
    assert.equal(state.hookMode, "codex");
    const region = extractManagedRegion(agents);
    assert.equal(state.managedBlockSha256, sha256(region.block));
    assert.equal(existsSync(path.join(dir, ".codex", "hooks", "cloop-turn.mjs")), true);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(toml, /\[features\.multi_agent_v2\]/);
    assert.match(toml, /default_wait_timeout_ms = 1800000/);
    const doctor = await cli(dir, ["doctor"]);
    assert.equal(doctor.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing AGENTS.md user instructions survive installation", async () => {
  const dir = await tempDir();
  try {
    const original = "# Repository Rules\n\nRun npm test before completion.\n";
    await writeFile(path.join(dir, "AGENTS.md"), original);
    await cli(dir, ["install", "--profile", "town"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /Run npm test before completion\./);
    assert.match(agents, /You are the cLoop root/);
    assert.ok(agents.startsWith("# Repository Rules"));
    const markers = countMarkers(agents);
    assert.equal(markers.start, 1);
    assert.equal(markers.end, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("install is idempotent and never duplicates the managed block", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town"]);
    const first = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    await cli(dir, ["install", "--profile", "town"]);
    const second = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    const markers = countMarkers(second);
    assert.equal(markers.start, 1);
    assert.equal(markers.end, 1);
    assert.equal(extractManagedRegion(first).block, extractManagedRegion(second).block);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each profile installs only that profile's unique root text", async () => {
  const UNIQUE = {"town":"gpt-6.1-terra max","high":"gpt-6-astra xhigh"};
  for (const [profile, other] of [["town", "high"], ["high", "town"]]) {
    const dir = await tempDir();
    try {
      await cli(dir, ["install", "--profile", profile, "--no-hooks"]);
      const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
      assert.ok(agents.includes(UNIQUE[profile]), `${profile} lacks ${UNIQUE[profile]}`);
      assert.equal(agents.includes(UNIQUE[other]), false, `${profile} unexpectedly contains ${UNIQUE[other]}`);
      const loaded = await loadProfile(profile, ROOT);
      assert.equal(extractProfileFromBlock(agents, profile), loaded.body.trim());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("update replaces only cLoop-owned content and can switch profiles", async () => {
  const UNIQUE = {"town":"gpt-6.1-terra max","high":"gpt-6-astra xhigh"};
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "Keep me.\n");
    await cli(dir, ["install", "--profile", "town"]);
    await cli(dir, ["update", "--profile", "high"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /Keep me\./);
    assert.ok(agents.includes(UNIQUE.high));
    assert.equal(agents.includes(UNIQUE.town), false);
    assert.equal(countMarkers(agents).start, 1);
    const state = JSON.parse(await readFile(path.join(dir, ".cloop", "state.json"), "utf8"));
    assert.equal(state.profile, "high");
    assert.match(state.council, / \+ /);
    assert.equal(typeof state.explorer, "string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("modified managed block fails doctor and update unless --force", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town"]);
    const agentsPath = path.join(dir, "AGENTS.md");
    const agents = await readFile(agentsPath, "utf8");
    await writeFile(agentsPath, agents.replace("Every member call", "TAMPERED member call"));
    const doctor = await cli(dir, ["doctor"]);
    assert.equal(doctor.ok, false);
    await assert.rejects(() => cli(dir, ["update"]), /modified by hand/);
    const forced = await cli(dir, ["update", "--force"]);
    assert.equal(forced.ok, true);
    const restored = await readFile(agentsPath, "utf8");
    assert.match(restored, /Every member call/);
    assert.doesNotMatch(restored, /TAMPERED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed markers fail without modifying the file", async () => {
  const dir = await tempDir();
  try {
    const broken = `# Rules\n\n${START_MARKER}\npartial\n`;
    await writeFile(path.join(dir, "AGENTS.md"), broken);
    await assert.rejects(() => cli(dir, ["install", "--profile", "town"]), /malformed/);
    const after = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.equal(after, broken);
    assert.equal(existsSync(path.join(dir, ".cloop", "state.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("duplicate managed blocks fail safely", async () => {
  const dir = await tempDir();
  try {
    const profile = await loadProfile("town", ROOT);
    const block = buildManagedBlock("town", profile.body);
    await writeFile(path.join(dir, "AGENTS.md"), block + "\n" + block);
    await assert.rejects(() => cli(dir, ["install", "--profile", "town"]), /malformed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uninstall removes cLoop files and preserves user instructions", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "User rules stay.\n");
    await cli(dir, ["install", "--profile", "high"]);
    await cli(dir, ["uninstall"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /User rules stay\./);
    assert.equal(agents.includes(START_MARKER), false);
    assert.equal(existsSync(path.join(dir, ".cloop", "state.json")), false);
    assert.equal(existsSync(path.join(dir, ".codex", "hooks", "cloop-turn.mjs")), false);
    const hooksRaw = await readFile(path.join(dir, ".codex", "hooks.json"), "utf8").catch(() => "{}");
    const counts = cloopHookCount(hooksRaw);
    assert.equal(counts.heartbeat, 0);
    assert.equal(counts.recovery, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dry-run never mutates the filesystem", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "untouched\n");
    const result = await cli(dir, ["install", "--profile", "town", "--dry-run"]);
    assert.equal(result.dryRun, true);
    assert.equal(await readFile(path.join(dir, "AGENTS.md"), "utf8"), "untouched\n");
    assert.equal(existsSync(path.join(dir, ".cloop")), false);
    assert.equal(existsSync(path.join(dir, ".codex")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed transaction restores original project files", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "original\n");
    const previous = process.env.CLOOP_FAIL_AFTER;
    process.env.CLOOP_FAIL_AFTER = "state";
    try {
      await assert.rejects(() => cli(dir, ["install", "--profile", "town"]), /induced failure/);
    } finally {
      if (previous == null) delete process.env.CLOOP_FAIL_AFTER;
      else process.env.CLOOP_FAIL_AFTER = previous;
    }
    assert.equal(await readFile(path.join(dir, "AGENTS.md"), "utf8"), "original\n");
    assert.equal(existsSync(path.join(dir, ".cloop", "state.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unrelated existing hooks survive and cLoop hooks are idempotent", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    const existing = {
      description: "team hooks",
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo team", statusMessage: "team-bash" }],
          },
        ],
      },
    };
    await writeFile(path.join(dir, ".codex", "hooks.json"), JSON.stringify(existing, null, 2));
    await cli(dir, ["install", "--profile", "town"]);
    await cli(dir, ["install", "--profile", "town"]);
    const hooks = JSON.parse(await readFile(path.join(dir, ".codex", "hooks.json"), "utf8"));
    assert.equal(hooks.hooks.PreToolUse[0].hooks[0].statusMessage, "team-bash");
    const counts = cloopHookCount(JSON.stringify(hooks));
    assert.equal(counts.heartbeat, 1);
    assert.equal(counts.recovery, 1);
    await cli(dir, ["uninstall"]);
    const after = JSON.parse(await readFile(path.join(dir, ".codex", "hooks.json"), "utf8"));
    assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "echo team");
    assert.equal(after.hooks.UserPromptSubmit, undefined);
    assert.equal(after.hooks.SessionStart, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--global is refused", async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(
      () => cli(dir, ["install", "--profile", "town", "--global"]),
      /project-local only/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildManagedBlock wrapper stays short and preserves profile bytes", async () => {
  const profile = await loadProfile("high", ROOT);
  const block = buildManagedBlock("high", profile.body);
  assert.ok(block.startsWith(START_MARKER));
  assert.ok(block.includes(END_MARKER));
  assert.equal(extractProfileFromBlock(block, "high"), profile.body.trim());
  assert.equal(applyManagedBlock("", block), block.endsWith("\n") ? block : `${block}\n`);
});

function runHook(cwd, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

test("heartbeat hook uses nested Codex contract and includes turn_id", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town"]);
    const result = await runHook(dir, {
      hook_event_name: "UserPromptSubmit",
      cwd: dir,
      model: "gpt-5-based-codex",
      turn_id: "turn-abc-123",
    });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.equal(typeof ctx, "string");
    assert.match(ctx, /CLOOP HEARTBEAT: hook executed for current turn_id=turn-abc-123/);
    assert.match(ctx, /CLOOP ACTIVE: profile=town/);
    assert.match(ctx, /Preferred profile root: gpt-6\.1-sol medium/);
    assert.match(ctx, /CLOOP town\. /);
    assert.doesNotMatch(ctx, /PLANNING MODE:/);
    assert.doesNotMatch(ctx, /IMPLEMENTATION MODE:/);
    assert.ok(ctx.length < 6000);
    assert.doesNotMatch(ctx, /stop and ask the user to switch/);
    assert.doesNotMatch(ctx, /remain idle/);
    assert.doesNotMatch(ctx, /If this slug is not that root/);
    assert.doesNotMatch(ctx, /do not spawn Astra/);
    assert.match(ctx, /do not request substitute-root approval/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compact recovery uses nested SessionStart contract and rehydrates the managed block", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    const block = extractManagedRegion(agents).block;
    const result = await runHook(dir, {
      hook_event_name: "SessionStart",
      source: "compact",
      cwd: dir,
    });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.match(ctx, /CLOOP RECOVERY: SessionStart source=compact succeeded/);
    assert.ok(ctx.includes(block.trim()));
    assert.match(ctx, /You are the cLoop root/);
    assert.match(ctx, /CLOOP town\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed cLoop state fails safely without blocking", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".cloop"), { recursive: true });
    await writeFile(path.join(dir, ".cloop", "state.json"), "{not-json");
    const result = await runHook(dir, {
      hook_event_name: "UserPromptSubmit",
      cwd: dir,
    });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continue, true);
    assert.match(payload.systemMessage, /unreadable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeCloopHooks refuses malformed hooks.json", () => {
  assert.throws(() => mergeCloopHooks("{bad", true), /not valid JSON/);
});

test("profiles keep the cLoop structure and carry no harness setup text", async () => {
  for (const id of ["town", "high"]) {
    const text = await readFile(path.join(ROOT, "profiles", `${id}.md`), "utf8");
    assert.match(text, new RegExp(`^PROFILE: ${id}\nISSUE_REPO: Lycvrgvs/cLoop\n`));
    for (const need of [/the c stands for council/, /## VOCABULARY/, /## LAWS/, /## NOISE_VETO/, /## SIGNALS/, /## FLOW/, /### DEFINE/, /### EXPLORE/, /### CLIMB/, /## MECHANICS/, /### ONE-SHOT/, /### SMALL LOOP/, /### GATES/, /### OUTCOMES/, /### STEP BACK/, /### DUEL/, /## RUBRIC/, /## JUDGING/, /## ROLES AND INVOCATION/, /## BUILDERS/, /## FILES/, /## REPORTING/]) assert.match(text, need);
    for (const bad of [/^# MAIN PROMPT/m, /^# TURN REMINDER/m, /^# TEST PLAN/m, /═══/]) assert.doesNotMatch(text, bad);
  }
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual((await readdir(path.join(ROOT, "profiles"))).sort(), ["catalog.json", "high.cheap-100.md", "high.cheap.md", "high.md", "town.cheap-100.md", "town.cheap.md", "town.md"]);
});

test("catalog carries one turn reminder per profile and no full modes", async () => {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "profiles", "catalog.json"), "utf8"));
  assert.equal(catalog.edition, "codex");
  assert.deepEqual(Object.keys(catalog.profiles), ["town", "high"]);
  for (const id of ["town", "high"]) {
    const meta = catalog.profiles[id];
    assert.ok(meta.planningMode.startsWith(`CLOOP ${id}. `));
    assert.equal(meta.implementationMode, "");
    assert.ok(meta.planningMode.length < 4000);
    assert.match(meta.council, / \+ /);
    for (const b of ["cheap", "cheap-100"]) {
      assert.equal(meta.builders[b].file, `${id}.${b}.md`);
      assert.ok(existsSync(path.join(ROOT, "profiles", meta.builders[b].file)));
    }
  }
  assert.equal(catalog.buildersSource.package, "cheapGPT");
  assert.equal(catalog.buildersSource.edition, "main");
});

test("codex profiles route every role through native subagents and only high uses Astra", async () => {
  for (const id of ["town", "high"]) {
    const text = await readFile(path.join(ROOT, "profiles", `${id}.md`), "utf8");
    for (const need of [/a Codex session/, /native `spawn_agent`/, /wait_agent\(timeout_ms=1800000\)/, /fork_turns: "none"/, /same lab/]) assert.match(text, need);
    for (const bad of [/codex exec/, /Claude Code/, /native `Agent` tool/, /different labs/, /CLAUDE\.md/]) assert.doesNotMatch(text, bad);
  }
  assert.doesNotMatch(await readFile(path.join(ROOT, "profiles", "town.md"), "utf8"), /astra/i);
  assert.match(await readFile(path.join(ROOT, "profiles", "high.md"), "utf8"), /gpt-6-astra xhigh/);
});

test("doctor warns when installed packageVersion or hook script is stale", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town"]);
    const statePath = path.join(dir, ".cloop", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.packageVersion = "1.1.0";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(dir, ".codex", "hooks", "cloop-turn.mjs"), "export default 'stale';\n");
    const doctor = await cli(dir, ["doctor"]);
    assert.equal(doctor.ok, true);
    assert.ok(doctor.warnings.some((w) => /packageVersion 1\.1\.0/.test(w)));
    assert.ok(doctor.warnings.some((w) => /hook script does not match current sources/.test(w)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing unrelated Codex config survives outside the cLoop TOML block", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    const original = "model = \"gpt-5\"\n\n[mcp_servers.demo]\ncommand = \"echo\"\n";
    await writeFile(path.join(dir, ".codex", "config.toml"), original);
    await cli(dir, ["install", "--profile", "town"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(toml, /model = "gpt-5"/);
    assert.match(toml, /\[mcp_servers\.demo\]/);
    assert.match(toml, /cloop:multi-agent-v2:start/);
    assert.equal(toml.split("[features.multi_agent_v2]").length - 1, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing matching multi-agent values stay user-owned and are not duplicated", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(
      path.join(dir, ".codex", "config.toml"),
      `[features.multi_agent_v2]
enabled = true
wait_agent_enabled = true
expose_spawn_agent_model_overrides = true
min_wait_timeout_ms = 60000
default_wait_timeout_ms = 1800000
max_wait_timeout_ms = 3600000
`
    );
    await cli(dir, ["install", "--profile", "town", "--no-hooks"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.equal((toml.match(/^\s*enabled = true\s*$/gm) || []).length, 1);
    assert.doesNotMatch(toml, /cloop:multi-agent-v2:start/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing table receives only missing keys without a duplicate table", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(
      path.join(dir, ".codex", "config.toml"),
      `[features.multi_agent_v2]
enabled = true
`
    );
    await cli(dir, ["install", "--profile", "high"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.equal(toml.split("[features.multi_agent_v2]").length - 1, 1);
    assert.match(toml, /wait_agent_enabled = true/);
    assert.match(toml, /cloop:multi-agent-v2:start/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("conflicting multi-agent values fail without rewriting config", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    const original = "[features.multi_agent_v2]\nenabled = false\n";
    await writeFile(path.join(dir, ".codex", "config.toml"), original);
    await assert.rejects(() => cli(dir, ["install", "--profile", "town"]), /config conflict/);
    assert.equal(await readFile(path.join(dir, ".codex", "config.toml"), "utf8"), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uninstall removes only cLoop TOML and dry-run does not touch config", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), "keep = true\n");
    const dry = await cli(dir, ["install", "--profile", "town", "--dry-run"]);
    assert.equal(await readFile(path.join(dir, ".codex", "config.toml"), "utf8"), "keep = true\n");
    assert.ok(dry.writes.includes(".codex/config.toml"));
    await cli(dir, ["install", "--profile", "town"]);
    await cli(dir, ["uninstall"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(toml, /keep = true/);
    assert.doesNotMatch(toml, /cloop:multi-agent-v2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("transaction failure restores original Codex config", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), "keep = 1\n");
    const previous = process.env.CLOOP_FAIL_AFTER;
    process.env.CLOOP_FAIL_AFTER = "state";
    try {
      await assert.rejects(() => cli(dir, ["install", "--profile", "town"]), /induced failure/);
    } finally {
      if (previous == null) delete process.env.CLOOP_FAIL_AFTER;
      else process.env.CLOOP_FAIL_AFTER = previous;
    }
    assert.equal(await readFile(path.join(dir, ".codex", "config.toml"), "utf8"), "keep = 1\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeMultiAgentConfig refuses dotted keys", () => {
  assert.throws(
    () => mergeMultiAgentConfig("features.multi_agent_v2.enabled = true\n"),
    /dotted-key/
  );
});

test("--agents-md-limit 96k writes project_doc_max_bytes, update keeps it, default and uninstall remove it", async () => {
  const dir = await tempDir();
  const config = path.join(dir, ".codex", "config.toml");
  try {
    await cli(dir, ["install", "--profile", "town", "--agents-md-limit", "96k"]);
    let text = await readFile(config, "utf8");
    assert.match(text, /^# cloop:agents-md-limit:start\nproject_doc_max_bytes = 98304\n# cloop:agents-md-limit:end\n/);
    assert.equal((await cli(dir, ["doctor"])).ok, true);
    await cli(dir, ["update"]);
    text = await readFile(config, "utf8");
    assert.equal(text.split("project_doc_max_bytes").length - 1, 1);
    await cli(dir, ["update", "--agents-md-limit", "default"]);
    text = await readFile(config, "utf8");
    assert.doesNotMatch(text, /project_doc_max_bytes/);
    await cli(dir, ["update", "--agents-md-limit", "96k"]);
    await cli(dir, ["uninstall"]);
    assert.equal(existsSync(config), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--agents-md-limit refuses a user-owned project_doc_max_bytes and bad values", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), "project_doc_max_bytes = 65536\n");
    await assert.rejects(cli(dir, ["install", "--profile", "town", "--agents-md-limit", "96k"]), /already set/);
    await assert.rejects(cli(dir, ["install", "--profile", "town", "--agents-md-limit", "64k"]), /96k or default/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("install sets the 96 KiB AGENTS.md limit by default, respects a user-owned key, and doctor warns at the default", async () => {
  const dir = await tempDir();
  const owned = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), `# Team rules\n\n${"x".repeat(40000)}\n`);
    await cli(dir, ["install", "--profile", "town"]);
    const text = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(text, /^# cloop:agents-md-limit:start\nproject_doc_max_bytes = 98304\n# cloop:agents-md-limit:end\n/);
    let doctor = await cli(dir, ["doctor"]);
    assert.ok(!doctor.warnings.some((w) => /project_doc_max_bytes/.test(w)));
    await cli(dir, ["update", "--agents-md-limit", "default"]);
    doctor = await cli(dir, ["doctor"]);
    assert.ok(doctor.warnings.some((w) => /over Codex's project_doc_max_bytes \(32768\)/.test(w)));
    await mkdir(path.join(owned, ".codex"), { recursive: true });
    await writeFile(path.join(owned, ".codex", "config.toml"), "project_doc_max_bytes = 131072\n");
    await cli(owned, ["install", "--profile", "town"]);
    const ownedText = await readFile(path.join(owned, ".codex", "config.toml"), "utf8");
    assert.equal(ownedText.split("project_doc_max_bytes").length - 1, 1);
    assert.match(ownedText, /^project_doc_max_bytes = 131072$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(owned, { recursive: true, force: true });
  }
});


test("--builders installs the builder variant, update keeps it, and none removes it", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town", "--builders", "cheap"]);
    let text = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(text, /\*\*Builders\*\* \(`--builders cheap`/);
    assert.match(text, /Active profile: `town` · builders: `cheap`/);
    let state = JSON.parse(await readFile(path.join(dir, ".cloop", "state.json"), "utf8"));
    assert.equal(state.builders, "cheap");
    assert.equal(state.buildersSource.package, "cheapGPT");
    assert.equal((await cli(dir, ["doctor"])).ok, true);
    await cli(dir, ["update"]);
    state = JSON.parse(await readFile(path.join(dir, ".cloop", "state.json"), "utf8"));
    assert.equal(state.builders, "cheap");
    await cli(dir, ["update", "--builders", "cheap-100"]);
    text = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(text, /\*\*Builders\*\* \(`--builders cheap-100`/);
    await cli(dir, ["update", "--builders", "none"]);
    text = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.doesNotMatch(text, /\*\*Builders\*\* \(/);
    assert.equal((await cli(dir, ["doctor"])).ok, true);
    await assert.rejects(() => cli(dir, ["update", "--builders", "ultracheap"]), /--builders takes none, cheap or cheap-100/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("builder profiles are the plain profiles plus one Builders block from the vendored rows", async () => {
  const vendor = JSON.parse(await readFile(path.join(ROOT, "vendor", "cheapgpt-builders.json"), "utf8"));
  assert.equal(vendor.source.edition, "main");
  assert.match(vendor.source.commit, /^[0-9a-f]{40}$/);
  for (const id of ["town", "high"]) {
    const plain = await readFile(path.join(ROOT, "profiles", `${id}.md`), "utf8");
    assert.doesNotMatch(plain, /\*\*Builders\*\* \(/);
    for (const b of ["cheap", "cheap-100"]) {
      const text = await readFile(path.join(ROOT, "profiles", `${id}.${b}.md`), "utf8");
      const start = text.indexOf("\n**Builders** (");
      const end = text.indexOf("\n## BUILDERS\n");
      assert.ok(start > 0 && end > start);
      assert.equal(text.slice(0, start) + text.slice(end), plain);
      const block = text.slice(start, end);
      for (const kind of ["dynamic", "mechanical"]) {
        assert.ok(block.includes(`${vendor.profiles[b][kind].model} ${vendor.profiles[b][kind].effort}`), `${id}.${b} lacks the ${kind} row`);
      }
    }
  }
});

test("install and update stop before writing when cheapGPT is installed", async () => {
  const dir = await tempDir();
  const other = await tempDir();
  try {
    await mkdir(path.join(dir, ".cheapgpt"), { recursive: true });
    await writeFile(path.join(dir, ".cheapgpt", "state.json"), JSON.stringify({ profile: "cheap", instructionFile: "AGENTS.md", codexPermission: false }));
    await assert.rejects(() => cli(dir, ["install", "--profile", "town"]), /cheapGPT is installed in this project[\s\S]*--builders cheap/);
    assert.equal(existsSync(path.join(dir, ".cloop")), false);
    assert.equal(existsSync(path.join(dir, "AGENTS.md")), false);
    await cli(other, ["install", "--profile", "town"]);
    const before = await readFile(path.join(other, "AGENTS.md"), "utf8");
    await writeFile(path.join(other, "AGENTS.md"), `${before}\n<!-- cheapgpt:managed:start -->\nx\n<!-- cheapgpt:managed:end -->\n`);
    await assert.rejects(() => cli(other, ["update"]), /cheapGPT is installed in this project/);
    const doctor = await cli(other, ["doctor"]);
    assert.ok(doctor.issues.some((issue) => /cheapGPT is installed here too/.test(issue)));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test("first install recommends an ADOPTION task until a rubric exists", async () => {
  const dir = await tempDir();
  const adopted = await tempDir();
  try {
    const result = await cli(dir, ["install", "--profile", "town"]);
    assert.match(result.notes[0], /ADOPTION/);
    assert.equal((await cli(dir, ["update"])).notes, undefined);
    await mkdir(path.join(adopted, "cloop"), { recursive: true });
    await writeFile(path.join(adopted, "cloop", "rubric.md"), `${G0_LINES.join("\n")}\n`);
    assert.equal((await cli(adopted, ["install", "--profile", "town"])).notes, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(adopted, { recursive: true, force: true });
  }
});

test("doctor warns when cloop/rubric.md lacks the G0 Method block verbatim", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town"]);
    await mkdir(path.join(dir, "cloop"), { recursive: true });
    await writeFile(path.join(dir, "cloop", "rubric.md"), "# Rubric\n\n- C1 | CORE | something\n");
    let doctor = await cli(dir, ["doctor"]);
    assert.ok(doctor.warnings.some((w) => /G0 Method/.test(w)));
    await writeFile(path.join(dir, "cloop", "rubric.md"), `# Rubric\n\n${G0_LINES.join("\n")}\n\n- C1 | CORE | something\n`);
    doctor = await cli(dir, ["doctor"]);
    assert.ok(!doctor.warnings.some((w) => /G0 Method/.test(w)));
    const profile = await readFile(path.join(ROOT, "profiles", "town.md"), "utf8");
    for (const line of G0_LINES) assert.ok(profile.includes(line), `the policy lacks: ${line}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the turn hook asks for a step back after every outcome except PASS", async () => {
  const hook = await readFile(HOOK, "utf8");
  assert.equal(hook.split("After every outcome except PASS, take a step back").length - 1, 2);
  assert.doesNotMatch(hook, /coexist|cheapGPT keeps/);
  const block = buildManagedBlock("town", "body");
  assert.doesNotMatch(block, /cheapGPT/);
});

test("repeated updates keep the multi-agent table that install created", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "town"]);
    for (let i = 0; i < 3; i += 1) {
      await cli(dir, ["update"]);
      const text = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
      assert.equal(text.split("[features.multi_agent_v2]").length - 1, 1, `update ${i + 1} lost or duplicated the table`);
      assert.match(text, /expose_spawn_agent_model_overrides = true/);
      assert.equal((await cli(dir, ["doctor"])).ok, true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
