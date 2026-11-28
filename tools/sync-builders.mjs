#!/usr/bin/env node
// Refreshes editions/<edition>/vendor/cheapgpt-builders.json, for every edition, from cheapGPT's published roles tables.
//
//   node tools/sync-builders.mjs --cheapgpt <cheapGPT checkout at a pinned commit>
//
// Each cLoop edition takes its builders from the cheapGPT edition of the same name (exp, claude, codex), read from
// <checkout>/editions/<edition>/profiles/roles.json (cheapGPT 1.10.4 and later). The commit recorded is the checkout's
// HEAD. The installer never fetches anything; it reads only the vendored files.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EDITIONS = ["exp", "claude", "codex"];
const BUILDER_IDS = ["cheap", "cheap-100"];

function fail(message) {
  process.stderr.write(`sync-builders.mjs: ERROR: ${message}\n`);
  process.exit(1);
}

export function buildVendor(roles, edition, commit) {
  if (roles.package !== "cheapGPT") fail(`the roles file is not cheapGPT's editions/${edition}/profiles/roles.json`);
  if (roles.schemaVersion !== 1) fail(`unsupported roles schemaVersion ${roles.schemaVersion}`);
  if (roles.edition !== edition) fail(`cLoop ${edition} takes builders from cheapGPT ${edition}, but this roles file is from ${roles.edition}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) fail("--commit must be a full 40-character commit sha");
  const profiles = {};
  for (const id of BUILDER_IDS) {
    const rows = roles.profiles?.[id];
    if (!Array.isArray(rows)) fail(`roles file lacks profile ${id}`);
    profiles[id] = {};
    for (const kind of ["dynamic", "mechanical"]) {
      const hits = rows.filter((row) => row.builder === kind);
      if (hits.length !== 1) fail(`${id}: expected exactly one ${kind} builder, found ${hits.length}`);
      const { model, effort, alias } = hits[0];
      profiles[id][kind] = alias ? { model, effort, alias } : { model, effort };
    }
  }
  return {
    schemaVersion: 1,
    edition,
    source: { package: "cheapGPT", version: roles.version, edition: roles.edition, commit },
    profiles,
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--cheapgpt") fail("usage: node tools/sync-builders.mjs --cheapgpt <cheapGPT checkout at a pinned commit>");
  const checkout = path.resolve(argv[1]);
  const head = spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" });
  const commit = (head.stdout || "").trim();
  if (head.status !== 0) fail(`${checkout} is not a git checkout of cheapGPT`);
  const lines = [];
  for (const edition of EDITIONS) {
    const file = path.join(checkout, "editions", edition, "profiles", "roles.json");
    if (!existsSync(file)) fail(`missing ${file}; check out cheapGPT 1.10.4 or later`);
    const vendor = buildVendor(JSON.parse(readFileSync(file, "utf8")), edition, commit);
    mkdirSync(path.join(REPO, "editions", edition, "vendor"), { recursive: true });
    writeFileSync(path.join(REPO, "editions", edition, "vendor", "cheapgpt-builders.json"), JSON.stringify(vendor, null, 2) + "\n");
    lines.push(`${edition} <- cheapGPT ${vendor.source.version} ${edition}`);
  }
  process.stdout.write(`sync-builders.mjs: OK ${lines.join("; ")} at ${commit.slice(0, 7)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
