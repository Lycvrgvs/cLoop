// The engine's data in the repository: flow.json and cards/ agree with each other and with the README diagram.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = (args, cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

test('flow.json and cards/ validate: every state reachable and able to end, every card bound', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-check-'));
  const r = node([path.join(ROOT, 'cloop.mjs'), 'check'], tmp);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /FLOW OK/);
});

test('a missing or unbound card fails the check', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-cards-'));
  for (const f of ['cloop.mjs', 'flow.json']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  fs.cpSync(path.join(ROOT, 'cards'), path.join(tmp, 'cards'), { recursive: true });
  fs.rmSync(path.join(tmp, 'cards', 'gate.md'));
  fs.writeFileSync(path.join(tmp, 'cards', 'stray.md'), '---\ncard: stray\nstate: LOOP\nrole: root\nloads: never\n---\nunbound\n');
  const r = node([path.join(tmp, 'cloop.mjs'), 'check'], tmp);
  assert.equal(r.status, 1); assert.match(r.stdout, /card "gate" missing/); assert.match(r.stdout, /card "stray" \(stray\.md\) is bound to nothing/);
});

test('the README flow diagram matches flow.json, and a changed flow.json fails the check', () => {
  const ok = node([path.join(ROOT, 'tools', 'flow-diagram.mjs'), '--check']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-flow-')), flow = JSON.parse(fs.readFileSync(path.join(ROOT, 'flow.json'), 'utf8'));
  flow.ladder.small.STALLED = [3, 'full'];
  fs.writeFileSync(path.join(tmp, 'flow.json'), JSON.stringify(flow)); fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(tmp, 'README.md'));
  const bad = node([path.join(ROOT, 'tools', 'flow-diagram.mjs'), '--check', '--flow', path.join(tmp, 'flow.json'), '--readme', path.join(tmp, 'README.md')]);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /differs from flow\.json/);
});

test('the engine refuses a transition and names the way forward', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-run-'));
  fs.mkdirSync(path.join(tmp, '.cloop'));
  for (const f of ['cloop.mjs', 'flow.json']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, '.cloop', f));
  fs.cpSync(path.join(ROOT, 'cards'), path.join(tmp, '.cloop', 'cards'), { recursive: true });
  for (const c of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't']]) spawnSync('git', c, { cwd: tmp });
  const engine = path.join(tmp, '.cloop', 'cloop.mjs');
  const init = node([engine, 'init', 'FOCUSED', 'demo', 'a test'], tmp);
  assert.equal(init.status, 0, init.stderr); assert.match(init.stdout, /STATE DEFINE/); assert.match(init.stdout, /Settle what done means/);
  const r = node([engine, 'advance', 'ONESHOT'], tmp);
  assert.equal(r.status, 2); assert.match(r.stderr, /cloop\/rubric\.md is missing/); assert.match(r.stderr, /freeze the rubric: node \.cloop\/cloop\.mjs freeze/);
});
