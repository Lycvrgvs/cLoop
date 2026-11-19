#!/usr/bin/env node
// Refreshes vendor/cheapgpt-builders.json from cheapGPT's published roles table.
//
//   node tools/sync-builders.mjs --roles <cheapGPT checkout>/profiles/roles.json --commit <cheapGPT commit sha>
//
// Run it at release time against cheapGPT checked out at a pinned commit of the edition that pairs
// with this branch (cLoop main <- cheapGPT exp, codex <- main, claude <- claude-edition). The
// installer never fetches anything; it reads only the vendored file.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAIRS = { main: "exp", codex: "main", claude: "claude-edition" };
const BUILDER_IDS = ["cheap", "cheap-100"];

function fail(message) {
  process.stderr.write(`sync-builders.mjs: ERROR: ${message}\n`);
  process.exit(1);
}

export function buildVendor(roles, edition, commit) {
  if (roles.package !== "cheapGPT") fail("the roles file is not cheapGPT's profiles/roles.json");
  if (roles.schemaVersion !== 1) fail(`unsupported roles schemaVersion ${roles.schemaVersion}`);
  if (roles.edition !== PAIRS[edition]) fail(`cLoop ${edition} takes builders from cheapGPT ${PAIRS[edition]}, but this roles file is from ${roles.edition}`);
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
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--roles" || argv[i] === "--commit" || argv[i] === "--edition") {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else fail(`unknown option ${argv[i]}`);
  }
  if (!args.roles || !args.commit) fail("usage: node tools/sync-builders.mjs --roles <path>/profiles/roles.json --commit <sha>");
  const catalogPath = path.join(REPO, "profiles", "catalog.json");
  let edition = args.edition;
  if (!edition && existsSync(catalogPath)) edition = JSON.parse(readFileSync(catalogPath, "utf8")).edition;
  if (!PAIRS[edition]) fail(`edition must be main, codex or claude (got ${edition}); pass --edition`);
  const roles = JSON.parse(readFileSync(path.resolve(args.roles), "utf8"));
  const vendor = buildVendor(roles, edition, args.commit);
  mkdirSync(path.join(REPO, "vendor"), { recursive: true });
  writeFileSync(path.join(REPO, "vendor", "cheapgpt-builders.json"), JSON.stringify(vendor, null, 2) + "\n");
  process.stdout.write(`sync-builders.mjs: OK edition=${edition} cheapGPT ${vendor.source.version} ${vendor.source.edition} ${args.commit.slice(0, 7)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
