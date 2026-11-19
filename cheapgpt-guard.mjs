// cLoop and cheapGPT are never installed in the same project. install and update call
// detectCheapgpt() before writing anything; when it finds any cheapGPT artifact they stop and print
// the commands to keep one package. cLoop never edits cheapGPT's files.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// cLoop edition -> the cheapGPT edition with the same root and invocation.
export const CHEAPGPT_EDITION = { main: "exp", codex: "main", claude: "claude-edition" };
const MARKER = "cheapgpt:managed";
const BUILDER_PROFILES = ["cheap", "cheap-100"];

async function readIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function imports(text) {
  const out = [];
  for (const match of String(text).matchAll(/(?:^|\s)@([^\s`'"]+)/gm)) out.push(match[1]);
  return out;
}

export async function detectCheapgpt(projectRoot) {
  const found = [];
  const at = (rel) => path.join(projectRoot, rel);
  let state = null;
  const stateText = await readIfExists(at(".cheapgpt/state.json"));
  if (stateText != null) {
    found.push(".cheapgpt/state.json");
    try {
      state = JSON.parse(stateText);
    } catch {
      state = null;
    }
  }
  for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
    const text = await readIfExists(at(rel));
    if (text == null) continue;
    if (text.includes(MARKER)) found.push(`a cheapgpt:managed block in ${rel}`);
    for (const imported of imports(text)) {
      const file = path.resolve(projectRoot, imported);
      if (!file.startsWith(path.resolve(projectRoot) + path.sep)) continue;
      const body = await readIfExists(file);
      if (body != null && body.includes(MARKER)) found.push(`a cheapgpt:managed block in ${imported} (imported by ${rel})`);
    }
  }
  for (const rel of [".codex/hooks.json", ".claude/settings.json"]) {
    const text = await readIfExists(at(rel));
    if (text != null && text.includes("cheapgpt-turn.mjs")) found.push(`a cheapGPT hook in ${rel}`);
  }
  for (const rel of [".codex/hooks/cheapgpt-turn.mjs", ".claude/hooks/cheapgpt-turn.mjs"]) {
    if (existsSync(at(rel))) found.push(rel);
  }
  return { found, state };
}

// The cheapGPT edition that wrote this state, when the state says enough to tell.
export function cheapgptEditionOf(state) {
  if (!state || typeof state !== "object") return null;
  if (state.instructionFile === "AGENTS.md") return "main";
  if (state.instructionFile === "CLAUDE.md") return state.codexPermission ? "exp" : "claude-edition";
  return null;
}

export function cheapgptMessage({ found, state }, cloopEdition) {
  const pair = CHEAPGPT_EDITION[cloopEdition];
  const edition = cheapgptEditionOf(state);
  const profile = state && typeof state.profile === "string" ? state.profile : null;
  const lines = [
    `cheapGPT is installed in this project (found: ${found.join("; ")}). cLoop and cheapGPT are never installed together, so nothing was written. Ask the user which single package to keep:`,
  ];
  if (edition) {
    lines.push(`- Keep cLoop: first remove cheapGPT with its own installer, from its ${edition} edition: node /path/to/cheapGPT/install.mjs uninstall --project .`);
  } else {
    lines.push("- Keep cLoop: first remove cheapGPT with its own installer, from the edition that installed it: node /path/to/cheapGPT/install.mjs uninstall --project .");
  }
  if (edition === pair && BUILDER_PROFILES.includes(profile)) {
    lines.push(`  then rerun this command with --builders ${profile} to keep cheapGPT's ${profile} builders inside cLoop.`);
  } else {
    lines.push(`  cheapGPT's builders are available inside cLoop with --builders cheap|cheap-100 (this ${cloopEdition} edition takes them from cheapGPT ${pair}); ask the user which, if any.`);
  }
  lines.push("- Keep cheapGPT alone: do not install cLoop here.");
  return lines.join("\n");
}
