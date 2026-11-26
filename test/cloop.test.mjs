// Every guard of cloop.mjs, seen refusing once at the transition it gates and then passing, on throwaway repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CMDRE = /node \.cloop\/cloop\.mjs [a-z]+/;
const RUBRIC = (extra = '') => `# rubric\n## Goals\n- G1 | "a counter that adds" | C1, C2, C3${extra ? ', C4' : ''}\n## Criteria
- C1 | CORE | add(2,3) prints 5 | evidence: node app.js 2 3 | pass: 2 3 → 5 | fail: 2 3 → 23 | boundary: 0 0 → 0
- C2 | CORE | add rejects non-numbers | evidence: node app.js a 1 | pass: a 1 → error | fail: a 1 → NaN | boundary: 1e3 is a number
- C3 | NON-CORE | --help prints usage | evidence: node app.js --help | pass: usage shown | fail: nothing | boundary: -h too${extra}\n`;
const C4 = '\n- C4 | CORE | add sums three numbers | evidence: node app.js 1 2 3 | pass: 6 | fail: 3 | boundary: 0 0 0';
const asserted = {}; // guard[:branch] → how many times its refusal was asserted (the audit test reads it)
const FAIL = 'node -e "process.exit(1)"', PASS = 'node -e 1';

function repo({ existing = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  const g = (...x) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...x], { cwd: d, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(d, '.cloop')); for (const f of ['cloop.mjs', 'flow.json']) fs.copyFileSync(path.join(SRC, f), path.join(d, '.cloop', f));
  fs.cpSync(path.join(SRC, 'cards'), path.join(d, '.cloop', 'cards'), { recursive: true });
  fs.writeFileSync(path.join(d, 'AGENTS.md'), 'method\n');
  if (existing) { fs.writeFileSync(path.join(d, 'app.js'), 'console.log(1)\n'); g('add', 'app.js'); g('commit', '-q', '-m', 'existing'); }
  const cl = (...x) => { const r = spawnSync('node', ['.cloop/cloop.mjs', ...x], { cwd: d, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  const ok = (...x) => { const r = cl(...x); assert.equal(r.code, 0, `${x.join(' ')}\n${r.out}`); return r.out; };
  const no = (re, ...x) => { // a command's refusal; a transition's refusal goes through refuse()
    assert.notEqual(x[0], 'advance', 'assert a transition with refuse(<guard>, ...)');
    const r = cl(...x); assert.notEqual(r.code, 0, `expected a refusal: ${x.join(' ')}\n${r.out}`); assert.match(r.out, re); return r.out;
  };
  const refuse = (tags, res, to, ...more) => { // each named guard's refusal at the transition it gates, asserted once in the whole suite; each names the command that satisfies it
    const r = cl('advance', to, ...more); assert.notEqual(r.code, 0, `expected ${tags} to refuse advance ${to}\n${r.out}`);
    [tags].flat().forEach((t, i) => { const re = [res].flat()[i]; assert.match(r.out, re); const line = r.out.split('\n').find((l) => re.test(l)); assert.match(line, CMDRE, `${t}: the refusal names the command that satisfies it`); asserted[t] = (asserted[t] || 0) + 1; });
    return r.out;
  };
  const state = () => JSON.parse(fs.readFileSync(path.join(d, 'cloop', 'state.json'), 'utf8'));
  const id = (out) => out.match(/^call (\w+)/m)[1];
  const reply = (cid, body) => fs.writeFileSync(path.join(d, 'cloop', 'runs', cid, 'out.md'), body);
  const met = (ids, pre = '') => ids.map((i) => `${pre}${i} | MET | evidence: run output | counterfeit: hardcoded 5 | boundary: 0 0 printed 0`).join('\n');
  const notMet = (ids, pre = '') => ids.map((i) => `${pre}${i} | NOT_MET | case: node app.js 0 0; printed nothing`).join('\n');
  let n = 0;
  const commit = () => { n++; fs.writeFileSync(path.join(d, `f${n}.js`), `// ${n}\n`); ok('git', 'add', '-A'); ok('git', 'commit', '-q', '-m', `build ${n}`); };
  const council = (kind, metIds, failIds, { extra = '', reproduce = 'yes' } = {}) => { // two judges, the judging, every NOT_MET settled by a run the engine makes
    const A = id(ok('call', 'judge')), B = id(ok('call', 'judge'));
    reply(A, [met(metIds), notMet(failIds), extra].filter(Boolean).join('\n')); reply(B, met(metIds.concat(failIds)));
    ok('judge', kind, A, B);
    for (const i of failIds) ok('reproduce', i, reproduce, '--', reproduce === 'yes' ? FAIL : PASS);
    return state();
  };
  const prevent = (block = true) => { ok('stepback', 'small', 'the whole: goal, criteria, all evidence; the cause; remove first; the real property; one correction'); if (block) ok('block', 'the next action, whole: app.js parses argv and prints the sum'); };
  const defined = (route = 'FOCUSED', extra = '') => { ok('init', route, 'demo', 'a small counter'); prevent(); fs.writeFileSync(path.join(d, 'cloop', 'rubric.md'), RUBRIC(extra)); ok('freeze'); };
  const oneshot = (metIds, failIds, o) => { prevent(false); ok('run', '--', PASS); commit(); return council('oneshot', metIds, failIds, o); };
  const nextshot = (metIds, failIds, o) => { prevent(); if (state().targets.length) ok('run', '--before', '--', FAIL); commit(); ok('run', '--', PASS); return council('loop', metIds, failIds, o); };
  const gate = (metIds, failIds, o) => { ok('run', '--e2e', '--', PASS); ok('run', '--suite', '--', PASS); return council('gate', metIds, failIds, o); };
  const duel = (metIds, failIds) => { const a = ok('call', 'dueler'), b = ok('call', 'dueler'); for (const o of [a, b]) ok('run', '--cwd', o.match(/^worktree: (\S+)/m)[1], '--', PASS); commit(); ok('run', '--', PASS); return council('merge', metIds, failIds); };
  return { d, g, cl, ok, no, refuse, state, id, reply, met, notMet, commit, council, prevent, defined, oneshot, nextshot, gate, duel };
}
const ALL = ['C1', 'C2', 'C3'];

// ── the climb: one-shot → next-shot → release gate → the user ─────────────────────────────
test('M: FOCUSED climbs one-shot → next-shot → release gate; each exit refuses until its evidence exists', () => {
  const r = repo();
  r.ok('init', 'FOCUSED', 'demo', 'a small counter');
  r.refuse(['prevented', 'rubricValid', 'rubricFrozen'], [/the step back: node/, /rubric: cloop\/rubric\.md is missing/, /freeze the rubric/], 'ONESHOT');
  r.refuse('exploreAllowed:focused', /a FOCUSED task never explores/, 'EXPLORE');
  r.prevent(); fs.writeFileSync(path.join(r.d, 'cloop', 'rubric.md'), RUBRIC()); r.ok('freeze'); r.ok('advance', 'ONESHOT');
  assert.match(r.ok('status'), /ONE self-contained file with every core and non-core criterion/);
  r.refuse(['realRun', 'judged'], [/a passing real run of the one-shot/, /the council: node/], 'LOOP');
  r.no(/PREVENT first: the step back/, 'run', '--', PASS);
  let s = r.oneshot(['C1'], ['C2', 'C3']);
  assert.equal(s.history[0].outcome, 'ADVANCED', 'a core criterion failing: a sound base, the next-shot repairs it');
  r.refuse('ladder:require', /the last outcome leads to LOOP/, 'ONESHOT');
  r.ok('advance', 'LOOP');
  r.no(/PREVENT first: .*the one-block/, 'run', '--', PASS);
  r.refuse(['seenFailing', 'nextShotPassed'], [/seen failing on BEST before the repair/, /the release gate needs a next-shot that passed/], 'GATE');
  s = r.nextshot(ALL, [], { extra: 'RUBRIC: backlog a --verbose flag' });
  assert.equal(s.history[1].outcome, 'PASS'); assert.deepEqual(s.require, ['GATE']); assert.equal(s.history[1].scope.length, 3, 'the council judged every criterion');
  assert.match(fs.readFileSync(path.join(r.d, 'cloop', 'board.md'), 'utf8'), /## Next action\n\(LOOP, [^)]*\)\nthe next action, whole/);
  r.ok('advance', 'GATE');
  r.no(/the release gate needs, before its judges:[\s\S]*run --e2e[\s\S]*run --suite/, 'call', 'judge');
  s = r.gate(ALL, []); assert.equal(s.history[2].outcome, 'PASS'); r.ok('advance', 'ACCEPT');
  r.commit(); // a later commit: what would be delivered is no longer what was gated
  r.refuse(['finalReport', 'proposalsResolved', 'gatedHead'], [/the final report: node/, /resolve every rubric proposal/, /is not the gated commit/], 'DONE');
  assert.match(r.ok('report', '--final'), /Where the work is: branch cl\/demo/);
  r.ok('resolve', '0', 'dismissed: not asked for'); r.ok('git', 'reset', '-q', '--hard', s.gateSha); r.ok('advance', 'DONE');
});

test('M: a one-shot passes on every core criterion with non-core partial; an unsound one is shot again', () => {
  const r = repo(); r.defined(); r.ok('advance', 'ONESHOT');
  let s = r.oneshot([], ALL); assert.equal(s.history[0].outcome, 'STALLED'); assert.deepEqual(s.require, ['ONESHOT'], 'an unsound base is shot again');
  r.ok('advance', 'ONESHOT'); s = r.oneshot(['C1', 'C2'], ['C3']);
  assert.equal(s.history[1].outcome, 'PASS'); assert.deepEqual(s.require, ['LOOP']); assert.deepEqual(s.targets, ['C3'], 'the next-shot repairs the non-core');
});

// ── the ladder: duel, re-define, BLOCKED ──────────────────────────────────────────────────
test('M: FULL explores; the ladder climbs to the duel and the re-define; a duel with nothing to fix is refused', () => {
  const r = repo(); r.defined('FULL');
  r.refuse('exploreAllowed:trigger', /name the trigger: node/, 'EXPLORE');
  r.ok('advance', 'EXPLORE', '--why', 'mechanism');
  r.refuse('exploreSettled', /the options judged and one chosen/, 'LOOP');
  r.prevent(false); r.commit();
  const A = r.id(r.ok('call', 'judge')), B = r.id(r.ok('call', 'judge'));
  r.reply(A, [r.met(ALL, 'X/'), r.met(['C1'], 'Y/'), r.notMet(['C2', 'C3'], 'Y/')].join('\n')); r.reply(B, [r.met(ALL, 'X/'), r.met(ALL, 'Y/')].join('\n'));
  assert.match(r.ok('judge', 'explore', A, B, '--options', 'X,Y'), /X: CORE 2\/2, all 3\/3 — eligible\n- Y: CORE 1\/2, all 1\/3\n/);
  r.no(/Y is not eligible/, 'winner', 'Y'); r.ok('winner', 'X'); r.ok('run', '--', PASS);
  r.ok('advance', 'LOOP');
  fs.appendFileSync(path.join(r.d, 'cloop', 'rubric.md'), '- C9 | NON-CORE | sneaked in | evidence: e | pass: p | fail: f | boundary: b\n');
  r.refuse('rubricUnchanged', /the rubric changed since the freeze/, 'LOOP');
  r.ok('git', 'checkout', '--', 'cloop/rubric.md');
  let s = r.nextshot(['C1', 'C3'], ['C2']); assert.equal(s.history[1].outcome, 'REGRESSION');
  r.ok('advance', 'LOOP'); s = r.nextshot(['C1', 'C3'], ['C2']); assert.equal(s.history[2].outcome, 'STALLED');
  r.ok('advance', 'LOOP'); s = r.nextshot(['C1', 'C3'], ['C2']); assert.equal(s.rung, 'full'); assert.deepEqual(s.require, ['DUEL']);
  r.ok('advance', 'DUEL'); s = r.duel(['C1', 'C3'], ['C2']); r.ok('advance', 'DUEL'); s = r.duel(['C1', 'C3'], ['C2']);
  assert.equal(s.rung, 'redefine'); assert.ok(s.ask);
  r.refuse('ladder:open', /a re-define is open .*: node \.cloop\/cloop\.mjs advance ASK/, 'LOOP');
  r.ok('advance', 'ASK');
  assert.match(r.ok('status'), /the user decides, twice[\s\S]*never dictate a phrase/);
  r.refuse('userAnswer', /the user's words: node/, 'DEFINE');
  r.ok('answer', 'drop the non-number check; numbers only');
  r.refuse('replanApproved', /the loop-breakers' re-plan: node/, 'DEFINE');
  r.ok('call', 'dueler'); r.ok('call', 'dueler'); r.ok('stepback', 'replan', 'EXPLORE', 'the mechanism is wrong: parse with a grammar'); r.ok('approve', 'yes');
  r.ok('advance', 'EXPLORE');
});

test('M: after a re-define the loop-breakers build; with nothing left open the duel is refused and the release gate named', () => {
  const r = repo(); r.defined('FULL'); r.ok('advance', 'ONESHOT');
  r.oneshot(['C1', 'C3'], ['C2']); r.ok('advance', 'LOOP'); r.ok('blocked', 'the parser cannot tell numbers from words'); r.ok('advance', 'ASK');
  r.ok('answer', 'numbers only: drop C2'); r.ok('call', 'dueler'); r.ok('call', 'dueler');
  r.ok('stepback', 'replan', 'DEFINE', 'the criterion C2 asks for a parser the goal does not need; remove C2');
  r.ok('approve', 'yes'); r.ok('advance', 'DEFINE');
  fs.writeFileSync(path.join(r.d, 'cloop', 'rubric.md'), RUBRIC(C4)); r.prevent(); r.ok('freeze', '--user', 'yes, add the three-number sum');
  r.refuse('redefineBuilds', /after a re-define, the loop-breakers build: node/, 'ONESHOT');
  r.ok('advance', 'DUEL'); let s = r.duel(['C1', 'C2', 'C3', 'C4'], []); assert.equal(s.history.at(-1).outcome, 'PASS');
  r.ok('advance', 'GATE'); s = r.gate(['C1', 'C3', 'C4'], ['C2']); assert.equal(s.history.at(-1).outcome, 'REGRESSION'); assert.deepEqual(s.require, ['LOOP'], 'a failing gate goes back to a next-shot on the current rung');

  const q = repo(); q.defined('FULL'); q.ok('advance', 'ONESHOT'); q.oneshot(['C1', 'C3'], ['C2']); q.ok('advance', 'LOOP'); q.ok('blocked', 'stuck'); q.ok('advance', 'ASK');
  q.ok('answer', 'drop C2, it is not needed'); q.ok('call', 'dueler'); q.ok('call', 'dueler'); q.ok('stepback', 'replan', 'DEFINE', 'remove C2'); q.ok('approve', 'yes'); q.ok('advance', 'DEFINE');
  fs.writeFileSync(path.join(q.d, 'cloop', 'rubric.md'), RUBRIC().replace('C1, C2, C3', 'C1, C3').replace(/\n- C2 [^\n]*/, '')); q.prevent(); q.ok('freeze', '--user', 'yes, drop C2');
  q.refuse('somethingToFix', /every criterion is established: a duel has nothing to fix; the release gate comes next/, 'DUEL');
});

test('M: ASK opens only from the ladder or a blocker; the user may say no to the re-plan and comment again', () => {
  const r = repo(); r.defined(); r.ok('advance', 'ONESHOT'); r.oneshot(['C1'], ['C2', 'C3']);
  r.refuse('ladder:ask', /ASK is the re-define: it opens from the ladder, or from node/, 'ASK');
  r.ok('advance', 'LOOP'); r.ok('blocked', 'the input format is unknown'); r.ok('advance', 'ASK');
  r.ok('answer', 'try the CSV format'); r.ok('call', 'dueler'); r.ok('call', 'dueler');
  r.no(/a FOCUSED task never explores/, 'stepback', 'replan', 'EXPLORE', 'a new mechanism');
  r.ok('stepback', 'replan', 'DEFINE', 'define the CSV format as a criterion');
  r.ok('answer', 'no: keep JSON, add a schema'); const s = r.state();
  assert.equal(s.entry.replan, null, 'a new comment starts the re-plan again'); assert.deepEqual(s.entry.duelers, []);
  r.ok('call', 'dueler'); r.ok('call', 'dueler'); r.ok('stepback', 'replan', 'DEFINE', 'a JSON schema criterion'); r.ok('approve', 'yes'); r.ok('advance', 'DEFINE');
});

// ── adoption ──────────────────────────────────────────────────────────────────────────────
test('M: an existing project is adopted: a baseline run, a prevent, the decision, a rubric that never grows', () => {
  const r = repo({ existing: true });
  r.ok('init', 'FOCUSED', 'demo', 'extend the counter');
  r.refuse(['baselineRun', 'adoptRecord'], [/the baseline real run on HEAD/, /the adoption decision: node/], 'ONESHOT');
  r.ok('run', '--', PASS); r.prevent();
  r.ok('adopt', 'replace', 'app.js prints 1; no rubric yet; the user agreed');
  r.refuse('adoptRubric:replace', /replace: DEFINE writes the new rubric/, 'ONESHOT');
  const k = repo({ existing: true }); fs.mkdirSync(path.join(k.d, 'cloop')); fs.writeFileSync(path.join(k.d, 'cloop', 'rubric.md'), RUBRIC()); k.g('add', '-A'); k.g('commit', '-q', '-m', 'rubric');
  k.ok('init', 'FOCUSED', 'demo', 'keep the rubric'); k.ok('run', '--', PASS); k.prevent(); k.ok('adopt', 'keep', 'the rubric is sound; the user agreed');
  fs.writeFileSync(path.join(k.d, 'cloop', 'rubric.md'), RUBRIC(C4)); k.ok('freeze');
  k.refuse('adoptRubric:grows', /adoption never adds criteria \(4 > 3\)/, 'ONESHOT');
});

// ── a task started on 1.2.0 continues ────────────────────────────────────────────────────
test('M: a task started on 1.2.0 (core and non-core stages) migrates on load and continues on one features stage', () => {
  const r = repo(); r.defined(); r.ok('advance', 'ONESHOT'); r.oneshot(['C1'], ['C2', 'C3']); r.ok('advance', 'LOOP');
  r.ok('stepback', 'small', 'the whole');
  const f = path.join(r.d, 'cloop', 'state.json'), s = r.state(); // rewrite it in the exact shape the 1.2.0 engine writes
  const KEYS = ['version', 'route', 'slug', 'reason', 'state', 'stage', 'baselineCount', 'entry', 'adopt', 'frozen', 'hard', 'frozenSet', 'est', 'targets', 'rung', 'count', 'require', 'prevent', 'ask', 'proposals', 'stepbacks', 'history', 'vetoes', 'backlog', 'notes', 'calls', 'runs', 'base', 'best', 'gateSha', 'snap', 'dirtyAtInit'];
  const ENTRY = ['t', 'runs', 'judged', 'finalReport', 'winner', 'winnerT', 'answer', 'replan', 'approved', 'duelers', 'fixes'];
  const old = { ...s, version: '1.2.0', stage: 'CORE', prevent: s.entry.prevent };
  old.entry = Object.fromEntries(ENTRY.map((k) => [k, s.entry[k]]));
  fs.writeFileSync(f, JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, old[k]])), null, 2));
  assert.match(r.ok('status'), /STATE LOOP · FOCUSED/);
  const m = r.state(); assert.equal(m.version, '1.2.2'); assert.ok(!('stage' in m) && !('prevent' in m)); assert.ok(m.entry.prevent, 'the recorded step back carries over');
  assert.match(fs.readFileSync(path.join(r.d, 'cloop', 'log.jsonl'), 'utf8'), /"ev":"migrate","from":"1\.2\.0","to":"1\.2\.2"/);
  r.ok('block', 'the whole product after the repair'); r.ok('run', '--before', '--', FAIL); r.commit(); r.ok('run', '--', PASS);
  assert.equal(r.council('loop', ALL, []).history.at(-1).outcome, 'PASS'); r.ok('advance', 'GATE');
});

// ── the task's own git store, when .git refuses the method's writes ──────────────────────
const asNobody = process.getuid && process.getuid() === 0 && spawnSync('runuser', ['--help']).status === 0;
const nobody = (d, ...x) => spawnSync('runuser', ['-u', 'nobody', '--', 'node', '.cloop/cloop.mjs', ...x], { cwd: d, encoding: 'utf8', env: { ...process.env, HOME: d } });
test('M: when .git refuses the method\'s writes the task gets its own store: it keeps the checkout\'s HEAD, cannot push, and is probed again', { skip: !asNobody && 'needs root and runuser to drop privileges' }, () => {
  const r = repo({ existing: true });
  spawnSync('chown', ['-R', 'nobody', r.d]);
  fs.mkdirSync(path.join(r.d, '.git', 'worktrees'), { recursive: true }); spawnSync('chown', ['-R', 'nobody', path.join(r.d, '.git', 'worktrees')]);
  for (const p of ['.git', '.git/info', '.git/config']) fs.chmodSync(path.join(r.d, p), fs.statSync(path.join(r.d, p)).isDirectory() ? 0o555 : 0o444);
  const out = nobody(r.d, 'init', 'FOCUSED', 'demo', 'extend the counter');
  assert.equal(out.status, 0, out.stdout + out.stderr); assert.match(out.stdout, /refuses the writes the method makes here \([^)]*\): the repository lives in cloop\/git/);
  assert.match(out.stdout, /STATE ADOPT .* · git: cloop\/git \(node \.cloop\/cloop\.mjs git <args>\)/);
  assert.equal(nobody(r.d, 'git', 'remote').stdout.trim(), '', 'no remote: nothing in the store can push to the user\'s repository');
  assert.equal(nobody(r.d, 'git', 'config', 'core.bare').stdout.trim(), 'false');
  assert.doesNotMatch(nobody(r.d, 'git', 'status', '--porcelain').stdout, /\.cloop|cloop\//, 'the tool\'s own files are excluded');
  const w = repo(); w.ok('init', 'FOCUSED', 'demo', 'writable'); assert.ok(!fs.existsSync(path.join(w.d, 'cloop', 'git')), 'a writable .git stays in use');
  assert.doesNotMatch(w.ok('git', 'branch', '--list', 'cl/probe-*'), /probe/, 'the probe leaves nothing behind');

  const L = repo({ existing: true }), lw = L.d + '-feature'; // a linked worktree on its own branch, ahead of main
  L.g('worktree', 'add', '-q', '-b', 'feature', lw); fs.writeFileSync(path.join(lw, 'feature.js'), 'f\n');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'feature.js'], { cwd: lw }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feature'], { cwd: lw });
  fs.cpSync(path.join(L.d, '.cloop'), path.join(lw, '.cloop'), { recursive: true });
  const tip = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: lw, encoding: 'utf8' }).stdout.trim();
  spawnSync('chown', ['-R', 'nobody', L.d, lw]); spawnSync('chmod', ['-R', 'a-w', path.join(L.d, '.git')]);
  const lo = nobody(lw, 'init', 'FOCUSED', 'demo', 'from a linked worktree'); assert.equal(lo.status, 0, lo.stdout + lo.stderr); assert.match(lo.stdout, /lives in cloop\/git/);
  assert.equal(nobody(lw, 'git', 'rev-parse', 'HEAD').stdout.trim(), tip, 'the store starts at the linked worktree\'s commit');
  assert.equal(nobody(lw, 'git', 'status', '--porcelain', '--', 'app.js', 'feature.js').stdout.trim(), '', 'the files on disk match the store');

  const B = repo({ existing: true }); fs.mkdirSync(path.join(B.d, 'cloop', 'wt'), { recursive: true }); // both refuse: worktrees cannot be made
  spawnSync('chown', ['-R', 'nobody', B.d]); spawnSync('chown', ['root', path.join(B.d, 'cloop', 'wt')]); spawnSync('chmod', ['-R', 'a-w', path.join(B.d, '.git')]);
  const bo = nobody(B.d, 'init', 'FOCUSED', 'demo', 'nothing writable');
  assert.notEqual(bo.status, 0); assert.match(bo.stderr, /in \.git \([^)]*\) and in cloop\/git \(a worktree: [^)]*\); cloop\/git was removed and the task folder kept/);
  assert.ok(!fs.existsSync(path.join(B.d, 'cloop', 'git')) && fs.existsSync(path.join(B.d, 'cloop')));
});

// ── witnessed reproductions and computed signals ─────────────────────────────────────────
test('M: a reproduction is a run the engine makes; signals are computed and never block', () => {
  const r = repo(); r.defined(); r.ok('advance', 'ONESHOT'); r.prevent(false); r.ok('run', '--', PASS); r.commit();
  const A = r.id(r.ok('call', 'judge')), B = r.id(r.ok('call', 'judge')); r.reply(A, [r.met(['C2', 'C3']), r.notMet(['C1'])].join('\n')); r.reply(B, r.met(ALL)); r.ok('judge', 'oneshot', A, B);
  r.no(/the run exited 0, which does not show "yes"/, 'reproduce', 'C1', 'yes', '--', PASS);
  r.ok('reproduce', 'C1', 'yes', '--', FAIL);
  let s = r.state(); assert.equal(s.history[0].outcome, 'ADVANCED'); assert.match(s.history[0].alleged.C1.evidence, /exit 1/);
  r.ok('advance', 'LOOP'); r.nextshot(['C2', 'C3'], ['C1']); r.ok('advance', 'LOOP'); r.nextshot(['C2', 'C3'], ['C1']);
  assert.match(r.ok('status'), /SIGNALS \(computed; information, never a block\)\n- the same criterion failing again: C1 \(3×\)/);
});

// ── cards and flow as data ───────────────────────────────────────────────────────────────
test('M: the flow validator accepts the shipped flow and cards; the re-define asks twice in plain words', () => {
  const r = repo(); assert.match(r.cl('check').out, /FLOW OK: 11 states[\s\S]*20 cards, each bound/);
  const ask = r.ok('card', 'ask');
  assert.match(ask, /decides, twice/); assert.match(ask, /1\. Their comment/); assert.match(ask, /3\. Their decision on the plan/); assert.match(ask, /never dictate a phrase/); assert.match(ask, /may stop the task/);
});

// ── the audit of this suite ──────────────────────────────────────────────────────────────
test('M: audit: every guard in flow.json is seen refusing, each assertion exactly once, at the transition it gates', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(SRC, 'flow.json'), 'utf8'));
  const guards = new Set([...flow.always, ...Object.values(flow.states).flatMap((st) => [...(st.exit || []), ...Object.values(st.to || {}).flat()])]);
  for (const gd of guards) assert.ok(Object.keys(asserted).some((t) => t.split(':')[0] === gd), `${gd}: never seen refusing`);
  for (const [t, k] of Object.entries(asserted)) { assert.ok(guards.has(t.split(':')[0]), `${t}: not a guard in flow.json`); assert.equal(k, 1, `${t}: asserted ${k} times`); }
});
