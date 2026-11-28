// One repository, three editions: the root installer picks one, keeps the installed one, and refuses a silent switch.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { DEFAULT_EDITION, EDITIONS, installedEdition } from "../install.mjs";
import { cheapgptEditionOf } from "../cheapgpt-guard.mjs";
import { buildVendor } from "../tools/sync-builders.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = path.join(ROOT, "install.mjs");
const project = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cloop-ed-")); spawnSync("git", ["init", "-q"], { cwd: d }); return d; };
const cli = (dir, ...args) => spawnSync(process.execPath, [INSTALL, ...args, "--project", dir], { encoding: "utf8" });
const state = (dir) => JSON.parse(readFileSync(path.join(dir, ".cloop", "state.json"), "utf8"));
const FILE = { exp: "CLAUDE.md", claude: "CLAUDE.md", codex: "AGENTS.md" };

test("every edition has its profiles, vendored builders and installer", () => {
  assert.deepEqual(Object.keys(EDITIONS), ["exp", "claude", "codex"]);
  assert.equal(DEFAULT_EDITION, "exp");
  for (const [e, { installer }] of Object.entries(EDITIONS)) {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "editions", e, "profiles", "catalog.json"), "utf8"));
    assert.equal(catalog.edition, e);
    assert.equal(catalog.buildersSource.edition, e, `${e} takes its builders from the cheapGPT edition of the same name`);
    assert.ok(existsSync(path.join(ROOT, "editions", e, "vendor", "cheapgpt-builders.json")));
    assert.ok(existsSync(path.join(ROOT, "editions", installer, "install.mjs")));
    assert.ok(existsSync(path.join(ROOT, "editions", installer, "hooks", "cloop-turn.mjs")));
  }
});

test("install --edition picks one; update without it keeps the installed edition; the default is exp", () => {
  for (const e of [null, "exp", "claude", "codex"]) {
    const dir = project();
    try {
      const r = cli(dir, "install", "--profile", "town", ...(e ? ["--edition", e] : []));
      assert.equal(r.status, 0, r.stderr);
      const want = e || "exp";
      assert.equal(installedEdition(dir), want);
      assert.equal(state(dir).instructionFile, FILE[want]);
      assert.equal(Boolean(state(dir).codexPermission), want === "exp");
      const before = state(dir);
      const u = cli(dir, "update");
      assert.equal(u.status, 0, u.stderr);
      const after = state(dir);
      for (const k of ["installedAt", "updatedAt"]) { delete before[k]; delete after[k]; }
      assert.deepEqual(after, before, `${want}: update keeps the edition and its state`);
      assert.equal(cli(dir, "doctor").status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a switch of edition is refused with the two commands that make it; an unknown edition is refused", () => {
  const dir = project();
  try {
    assert.equal(cli(dir, "install", "--profile", "town", "--edition", "claude").status, 0);
    const r = cli(dir, "update", "--edition", "codex");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /this project has the claude edition installed; to change it, run uninstall first, then install --edition codex/);
    assert.equal(state(dir).instructionFile, "CLAUDE.md");
    const bad = cli(dir, "install", "--profile", "town", "--edition", "main");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unknown edition 'main'; the editions are exp, claude, codex/);
    assert.equal(cli(dir, "uninstall").status, 0);
    assert.equal(cli(dir, "install", "--profile", "town", "--edition", "codex").status, 0);
    assert.equal(installedEdition(dir), "codex");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exp is recognised when the codex exec permission predated cLoop (so it was not recorded)", () => {
  const dir = project();
  try {
    mkdirSync(path.join(dir, ".claude"));
    writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(codex exec:*)"] } }));
    assert.equal(cli(dir, "install", "--profile", "high").status, 0);
    assert.equal(state(dir).codexPermission, false);
    assert.equal(installedEdition(dir), "exp");
    assert.equal(cli(dir, "update").status, 0);
    assert.match(readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), /gpt-6\.1-sol max/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cheapGPT's editions carry the same names: the guard reads them and sync-builders accepts only them", () => {
  assert.equal(cheapgptEditionOf({ instructionFile: "AGENTS.md" }), "codex");
  assert.equal(cheapgptEditionOf({ instructionFile: "CLAUDE.md", codexPermission: true }), "exp");
  assert.equal(cheapgptEditionOf({ instructionFile: "CLAUDE.md", codexPermission: false }), "claude");
  const roles = (edition) => ({ package: "cheapGPT", schemaVersion: 1, version: "1.10.4", edition, profiles: Object.fromEntries(["cheap", "cheap-100"].map((p) => [p, [{ builder: "dynamic", model: "m", effort: "high" }, { builder: "mechanical", model: "n", effort: "max" }]])) });
  const sha = "22efe47a9d05eb6c1a99892257bc04d4b43899c3";
  const v = buildVendor(roles("codex"), "codex", sha);
  assert.deepEqual(v.source, { package: "cheapGPT", version: "1.10.4", edition: "codex", commit: sha });
  const old = spawnSync(process.execPath, ["--input-type=module", "-e", `import { buildVendor } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "tools", "sync-builders.mjs")).href)}; buildVendor(${JSON.stringify(roles("main"))}, "codex", "${sha}");`], { encoding: "utf8" });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /cLoop codex takes builders from cheapGPT codex, but this roles file is from main/);
});
