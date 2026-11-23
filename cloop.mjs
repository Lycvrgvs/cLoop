#!/usr/bin/env node
// cLoop tool: the flow, the escalation ladder, the guards, the task state, the board and the reports.
// What can be computed is decided here; judgment stays with the agent; the user's decisions stay with the user.
// Node standard library only. Run from the repository root: node cloop.mjs <command> ...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'cloop');
const F = { state: path.join(DIR, 'state.json'), log: path.join(DIR, 'log.jsonl'), board: path.join(DIR, 'board.md'), rubric: path.join(DIR, 'rubric.md') };
const TAGS = ['CORE', 'NON-CORE'];
const TOOL_FILES = ['cloop.mjs', 'cloop-town.txt', 'AGENTS.md', 'CLAUDE.md'];
const installed = (f) => TOOL_FILES.includes(f) || ['.cloop/', '.codex/', '.claude/'].some((d) => f.startsWith(d)); // the installer's files, never the product
const EXPLORE_TRIGGERS = { shape: "the output's shape is unclear after DEFINE", mechanism: 'several mechanisms are plausible and no cheap check separates them' };

// ── Escalation: outcomes counted per rung since the last PASS or rung change; the nth of a kind moves the rung ──
const RUNGS = {
  small: { to: ['LOOP'], says: "the root's small step back (PREVENT), then a small loop" },
  full: { to: ['DUEL'], says: "two loop-breakers' full step backs, each with a small loop; one merge, one council" },
  redefine: { to: ['ASK'], says: "a re-define: the user, then the loop-breakers' re-plan, approved by the user" },
};
const LIMIT = { small: { ADVANCED: [3, 'full'], STALLED: [2, 'full'], REGRESSION: [2, 'full'] }, full: { ADVANCED: [1, 'small'], STALLED: [2, 'redefine'], REGRESSION: [2, 'redefine'] }, redefine: { ADVANCED: [1, 'small'], STALLED: [1, 'redefine'], REGRESSION: [1, 'redefine'] } };
const zero = () => ({ ADVANCED: 0, STALLED: 0, REGRESSION: 0 });

// ── The flow: allowed next states and the card shown on entry ───────────────────────────────
const MERGE = `Merge guideline: compare candidates on reproduced real-run evidence (CORE established, then all; a regression disqualifies). Among the best, keep the one that fixes the named cause at its origin with the smallest coherent change. Combine candidates only when they are disjoint and run together, and judge the combination again. Never merge on reading alone.`;
const FLOW = {
  ADOPT: { next: ['PREFLIGHT'], card: `Existing project: adopt what is there before any route.
Read the history, the product and any rubric, spec and architecture. Recommend to the user, with reasons: keep, simplify or replace. Established evidence stays valid unless the change invalidates it; adoption never adds criteria.
node cloop.mjs adopt keep|simplify|replace "<reason and the user's answer>". Keep or simplify: the rubric must be valid and frozen here. Replace: DEFINE writes a new one.` },
  PREFLIGHT: { next: ['DEFINE', 'EXPLORE', 'ONESHOT', 'LOOP'], card: `Prove the council works before any product work.
P1 each role spawns with an explicit model and reasoning effort.
P2 each role's model and effort are confirmed from the harness record, never from its reply; a record that shows only the request is "requested", not confirmed.
P3 a judge call leaves the repository unchanged (call judge, then node cloop.mjs isolation).
P4 two writers, each in its own worktree, change only that worktree.
Record each: node cloop.mjs preflight P<n> ok|fail "<evidence>". A failing check: recover it, or ask the user.` },
  DEFINE: { next: ['EXPLORE', 'ONESHOT', 'LOOP', 'DUEL', 'GATE'], card: `Settle what done means, in cloop/rubric.md.
Goals, with the user: the objective, real inputs, stakes, what is dropped. Quote each goal under "## Goals" and map it to criteria or to Drop.
Draft: both members apart (call member, each in its own worktree) draft the criteria, and for a new repository spec.md and architecture.md. Merge them by the merge guideline.
Tag: CORE if the objective fails without it, plus what is needed to run and judge that; otherwise NON-CORE. A property only use can show gets "evidence: use session — <what to do>"; its judge must use the product. Optional: backlog. Out of scope: Drop, with the reason.
Each criterion is one property with a pass case, a fail case and its boundary (the closest input where a wrong result would still look right). Keep a criterion only if a goal needs it.
node cloop.mjs freeze. The rubric is provisional until the first council judges it, then frozen hard. Removing a criterion, changing a goal, or any change after the hard freeze needs the user: freeze --user "<their words>".
Next: ONESHOT; EXPLORE only for a trigger; LOOP when the remaining work is a few independent behaviours; after a re-define, DUEL.` },
  EXPLORE: { next: ['LOOP', 'GATE', 'DUEL', 'ASK'], card: `Choose how, by evidence.
PREVENT: small step back (node cloop.mjs stepback small).
2-4 explorers (call explorer), options that differ in mechanism, each one self-contained file in its own worktree. Run every option yourself on real input.
Council: both judges review every option blind (aliases), one line per option and criterion: <alias>/<ID> | MET|NOT_MET | ... Then node cloop.mjs judge explore <idA> <idB> --options <aliases>; the tool ranks them.
Merge: node cloop.mjs winner <alias> (one of the top), or winner <a>,<b> for an amalgam, which the council judges again (judge merge). Integrate it and run it on real input on HEAD. Losers become vetoes.` },
  ONESHOT: { next: ['LOOP', 'GATE', 'DUEL', 'ASK'], card: `Generate the stage in one file, then judge it.
PREVENT: small step back first: what the stage's criteria demand, the real inputs, the representation you handle best.
Build all the stage's new logic as one self-contained file (an unfamiliar target: build it in a familiar form first, then translate, using the first version's outputs as the oracle) and run it on real input. Integrate it into the product, reproduce its outputs on the same inputs (node cloop.mjs run), commit, then judge (judge oneshot): judges review HEAD.
After the council: PASS → GATE. Otherwise judge the one-shot: good (a sound base, what is left is a few behaviours) → LOOP; bad (a wrong base) → ASK, a re-define with the user. A REGRESSION follows the ladder.` },
  LOOP: { next: ['LOOP', 'GATE', 'DUEL', 'ASK'], card: `Build or correct the targeted behaviours on BEST: the same loop builds what the one-shot left and corrects what a council found.
PREVENT is the small step back that names the targets (--targets); a target that already failed is reproduced on BEST with a real run first.
Seen to fail: node cloop.mjs run --before --cwd <worktree of BEST> -- <the target's test> (it must fail on BEST, because the behaviour is missing or wrong; --judgment when the evidence is the criterion's real output).
BUILD the smallest coherent change at the origin. RUN the real path. JUDGE (judge loop).` },
  DUEL: { next: ['LOOP', 'GATE', 'DUEL', 'ASK'], card: `Break what the root's small loops could not close.
Two loop-breakers (call dueler, twice), each from BEST in its own worktree and apart, from a self-contained packet (the goal, the targets' criteria, the vetoes, BEST and its diff, every real-run result, finding and dropped attempt, your reading labelled an unverified hypothesis): a full step back on the whole, in a few paragraphs, in the representation it reasons best in, naming the step at fault; then one small loop on its strongest hypothesis, with its test seen failing on BEST and the real path run.
Run each result yourself (node cloop.mjs run --cwd <its worktree> -- ...). Merge into the product by the merge guideline, run the real path on HEAD, then one council judges the merge (judge merge).` },
  GATE: { next: ['ONESHOT', 'LOOP', 'DUEL', 'ACCEPT', 'ASK'], card: `Certify the stage on one commit.
Commit the candidate. node cloop.mjs run --e2e -- <the product end to end, on its normal path and speed>; at the release gate also run --suite -- <full suite>. Then both judges on the stage's whole scope (core gate: CORE; release gate: everything); judge gate.
Only a reproduced violation of a criterion in scope blocks.` },
  ASK: { next: ['DEFINE', 'EXPLORE', 'STOPPED'], card: `Re-define: the full step back with the user, who decides before anything is built.
1 Show the user the targets, what was tried, the evidence (or the blocker) and 2-3 options with your recommendation. Record their words: node cloop.mjs answer "<their comment>". "stop" → advance STOPPED.
2 Two loop-breakers (call dueler, twice) take the full step back with the user's comment, apart, and each proposes a re-plan from the step at fault: DEFINE when the goal or a criterion is wrong, EXPLORE when the mechanism or the shape is wrong. Merge them by the merge guideline: node cloop.mjs stepback replan DEFINE|EXPLORE "<the re-plan>".
3 Show the user the re-plan; record their approval: node cloop.mjs approve "<their words>". Then advance to the re-plan's state; after DEFINE, the loop-breakers build (DUEL).` },
  ACCEPT: { next: ['DONE', 'DEFINE', 'EXPLORE'], card: `The release gate passed: deliver to the user.
node cloop.mjs report --final opens your message. Resolve every open rubric proposal (node cloop.mjs resolve <n> "<how>").
The user accepts: advance DONE (the tool writes vetoes and backlog into the rubric and checks the delivered commit is the gated one). The user gives feedback: node cloop.mjs answer "<their words>", then DEFINE (changed or new goals) or EXPLORE (the mechanism is wrong), by your judgment.` },
  DONE: { next: [], terminal: true, card: `Done. Unless the user asked to keep them, node cloop.mjs clean.
Issue report, only after a task that reached a full step back or a re-define, or met a refusal it could not satisfy: a project-neutral draft in cloop/reports/ (no code, paths, names or secrets) naming the method element (state, ladder, guard, card, law) that was missing, misleading or wrong, its evidence, and one change that removes or sharpens before it adds. The change must hold for every project the method serves: a law, veto, signal, flow step or guard stated without this project's domain, never a rewording of a rule that already covers the case, and never a fix for a single judgment slip the existing rule already covered. Show it; file it (gh issue create --repo <ISSUE_REPO>) only on yes.` },
  STOPPED: { next: [], terminal: true, card: 'Stopped by the user: report the candidate, the reproducible open cases, what is needed, and the options.' },
};
const STEPBACK = `Step back on the whole before the detail, by the method in the prompt's MECHANICS.
Small (yours, a few lines): node cloop.mjs stepback small --targets <IDs> "<the whole, the class and root cause, what to remove, the real property, the one correction>".
Full: each loop-breaker's, a few paragraphs, in its packet (DUEL). Re-define: the full step back with the user (ASK).`;

// ── State, log, git ────────────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString();
const die = (msg) => { console.error('REFUSED: ' + msg); process.exit(2); };
const load = () => { if (!fs.existsSync(F.state)) die('no task: node cloop.mjs init <FOCUSED|FULL> <slug> "<reason>"'); return JSON.parse(fs.readFileSync(F.state, 'utf8')); };
function save(s, event) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(F.state, JSON.stringify(s, null, 2));
  if (event) fs.appendFileSync(F.log, JSON.stringify({ t: now(), state: s.state, ...event }) + '\n');
  fs.writeFileSync(F.board, board(s));
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd || ROOT, maxBuffer: 1 << 26, shell: !!opts.shell, timeout: opts.timeout });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}
const gitDirArgs = () => fs.existsSync(path.join(DIR, 'git')) ? ['--git-dir=' + path.join(DIR, 'git'), '--work-tree=' + ROOT] : [];
const git = (args, cwd) => sh('git', ['-c', 'safe.directory=*', ...(cwd ? [] : gitDirArgs()), ...args], { cwd });
const head = (cwd) => git(['rev-parse', 'HEAD'], cwd).out.trim();
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
function gitUsable() { // the operations the method needs: a commit, a branch ref and a worktree
  if (!fs.existsSync(path.join(ROOT, '.git')) && git(['init', '-b', 'main']).code) return false;
  if (git(['rev-parse', '--verify', 'HEAD']).code && git(['commit', '--allow-empty', '-m', 'cLoop baseline']).code) return false;
  const wt = path.join(DIR, 'wt', 'probe-' + crypto.randomBytes(3).toString('hex'));
  const ok = !git(['update-ref', 'refs/heads/cloop-probe', 'HEAD']).code && !git(['worktree', 'add', '--detach', wt, 'HEAD']).code;
  git(['worktree', 'remove', '--force', wt]); git(['update-ref', '-d', 'refs/heads/cloop-probe']); git(['worktree', 'prune']); fs.rmSync(wt, { recursive: true, force: true });
  return ok;
}
const snapshot = () => ({ head: head(), status: git(['status', '--porcelain']).out, diff: sha256(git(['diff']).out), t: now() });
const sameTree = (a, b) => a.head === b.head && a.status === b.status && a.diff === b.diff;

// ── Rubric: goals mapped to criteria, criteria with their cases ──────────────────────────
function section(text, name) {
  const start = text.search(new RegExp(`^## ${name}\\s*$`, 'm')); if (start < 0) return null;
  const body = text.slice(start).split('\n').slice(1), end = body.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? body : body.slice(0, end)).map((l) => l.trim()).filter((l) => l.startsWith('- '));
}
function rubric() {
  if (!fs.existsSync(F.rubric)) return { crit: [], goals: [], errors: ['cloop/rubric.md is missing'], warnings: [] };
  const text = fs.readFileSync(F.rubric, 'utf8'), errors = [], warnings = [], crit = [], goals = [];
  const cl = section(text, 'Criteria'), gl = section(text, 'Goals');
  if (!cl) errors.push('no "## Criteria" section'); if (!gl) errors.push('no "## Goals" section');
  for (const raw of cl || []) {
    const parts = raw.slice(2).split(' | ').map((p) => p.trim()), [id, tag, property] = parts;
    const field = (k) => (parts.find((p) => p.startsWith(k + ':')) || '').slice(k.length + 1).trim();
    const c = { id, tag, property, evidence: field('evidence'), pass: field('pass'), fail: field('fail'), boundary: field('boundary'), raw };
    c.use = /\buse session\b/i.test(c.evidence);
    if (!id || !TAGS.includes(tag) || !property) errors.push(`"${raw.slice(0, 50)}…" needs "<ID> | CORE|NON-CORE | <property>"`);
    for (const k of ['evidence', 'pass', 'fail', 'boundary']) if (!c[k]) errors.push(`${id}: missing ${k}:`);
    if (crit.some((x) => x.id === id)) errors.push(`${id}: duplicate ID`);
    if (/\band\b/i.test(property || '')) warnings.push(`${id}: "and" in the property; split it if it can be half-met`);
    crit.push(c);
  }
  for (const raw of gl || []) {
    const [gid, words, map] = raw.slice(2).split(' | ').map((p) => p.trim());
    if (!gid || !words || !map) { errors.push(`goal "${raw.slice(0, 50)}…" needs "<G#> | <the user's words> | <IDs> or Drop: <reason>"`); continue; }
    const drop = /^Drop:\s*\S/.test(map), ids = drop ? [] : map.split(/[,\s]+/).filter(Boolean);
    for (const id of ids) if (!crit.some((c) => c.id === id)) errors.push(`${gid}: maps to unknown criterion ${id}`);
    if (!drop && !ids.length) errors.push(`${gid}: maps to nothing (criteria or Drop: <reason>)`);
    goals.push({ gid, raw, ids, drop });
  }
  for (const c of crit) if (!goals.some((g) => g.ids.includes(c.id))) errors.push(`${c.id}: no goal traces to it`);
  if (!crit.some((c) => c.tag === 'CORE')) errors.push('no CORE criterion');
  return { crit, goals, errors, warnings, hash: sha256([...(gl || []), ...(cl || [])].join('\n')) };
}
const openTargets = (s, ids) => { const known = rubric().crit.map((c) => c.id), t = (ids || []).filter((id) => known.includes(id) && !s.est.includes(id)); return t.length ? t : stageScope(s).filter((id) => !s.est.includes(id)); };
const stageScope = (s) => rubric().crit.filter((c) => c.tag === s.stage).map((c) => c.id);
const gateScope = (s) => rubric().crit.filter((c) => s.stage === 'CORE' ? c.tag === 'CORE' : true).map((c) => c.id);

// ── Guards: what a transition from the current state to `to` still needs ─────────────────
function needs(s, to, why) {
  const n = [], e = s.entry, R = rubric(), j = e.judged;
  if (!FLOW[s.state].next.includes(to)) return [`${s.state} cannot go to ${to}; allowed: ${FLOW[s.state].next.join(', ') || 'none'}`];
  if (s.ask && s.state !== 'ASK' && to !== 'ASK') return [`a re-define (${s.ask}): ASK`];
  if (to === 'ASK' && !s.ask && !(s.require && s.require.includes('ASK'))) return ['ASK is the re-define: the ladder, a bad one-shot or a blocker leads there'];
  if (!e.card) n.push('the step card of this entry (node cloop.mjs card ...)');
  if (s.frozen && !['DEFINE', 'ADOPT'].includes(s.state) && R.hash !== s.frozen) n.push('the rubric changed since the freeze: only DEFINE changes it');
  if (s.require && !s.require.includes(to)) n.push(`the ladder (rung ${s.rung}) leads to ${s.require.join(' or ')}`);
  if (s.state === 'DEFINE') { const open = stageScope(s).filter((id) => !s.est.includes(id));
    if (to === 'GATE' && open.length) n.push(`stage criteria still open: ${open.join(', ')}`);
    else if (s.rung === 'redefine' && open.length && to !== 'DUEL') n.push('after a re-define, the loop-breakers build: DUEL'); }
  if (to === 'EXPLORE' && !(s.require && s.require.includes('EXPLORE')) && !['ASK', 'ACCEPT', 'ONESHOT'].includes(s.state)) {
    if (!['DEFINE', 'PREFLIGHT'].includes(s.state)) n.push('EXPLORE from here comes from the ladder');
    else if (s.route !== 'FULL') n.push('a FOCUSED route explores only from the ladder');
    else if (!EXPLORE_TRIGGERS[why]) n.push(`a trigger: advance EXPLORE --why ${Object.keys(EXPLORE_TRIGGERS).join('|')}`);
  }
  if (to === 'ASK') return n; // the user decides; no exit evidence is owed
  switch (s.state) {
    case 'ADOPT':
      if (!s.adopt) n.push('the adoption decision (node cloop.mjs adopt ...)');
      else if (s.adopt !== 'replace') { if (R.errors.length) n.push(...R.errors.map((x) => 'rubric: ' + x)); if (s.frozen !== R.hash) n.push('freeze'); if (R.crit.length > s.baselineCount) n.push(`adoption never adds criteria (${R.crit.length} > ${s.baselineCount})`); }
      break;
    case 'PREFLIGHT':
      for (const p of ['P1', 'P2', 'P3', 'P4']) if (s.preflight[p] !== 'ok') n.push(`${p} ok`);
      if (to !== 'DEFINE' && !s.frozen) n.push('a frozen rubric (DEFINE)');
      break;
    case 'DEFINE': if (R.errors.length) n.push(...R.errors.map((x) => 'rubric: ' + x)); if (s.frozen !== R.hash) n.push('freeze (node cloop.mjs freeze)'); break;
    case 'EXPLORE':
      if (!j || !e.winner) n.push('the options judged and merged (judge explore, winner)');
      else if (!j.outcome) n.push('the amalgam judged (judge merge)');
      else if (!e.runs.some((r) => r.code === 0 && r.t > e.winnerT && r.sha === head() && !r.cwd)) n.push('the integrated result run on real input on HEAD (node cloop.mjs run)');
      break;
    case 'ONESHOT': if (!e.runs.some((r) => r.kind === 'run' && r.code === 0)) n.push('a real run of the one-shot'); if (!j) n.push('the one-shot judged (judge oneshot)'); break;
    case 'LOOP':
      if (!e.runs.some((r) => r.kind === 'before' && (r.code !== 0 || r.judgment))) n.push('the regression seen failing on BEST (run --before)');
      if (!j) n.push('the loop judged (judge loop)');
      break;
    case 'DUEL': if (!j) n.push('the merge judged (judge merge)'); break;
    case 'GATE': if (!j) n.push('the gate judged (judge gate)'); break;
    case 'ASK':
      if (!e.answer) n.push("the user's comment (node cloop.mjs answer ...)");
      else if (to !== 'STOPPED') { if (!e.replan) n.push('the re-plan (node cloop.mjs stepback replan DEFINE|EXPLORE ...)'); else if (!e.approved) n.push("the user's approval of the re-plan (node cloop.mjs approve ...)"); else if (to !== e.replan.choice) n.push(`the approved re-plan goes to ${e.replan.choice}`); }
      break;
    case 'ACCEPT':
      if (to !== 'DONE') { if (!e.answer) n.push("the user's feedback (node cloop.mjs answer ...)"); break; }
      if (!e.finalReport) n.push('the final report (node cloop.mjs report --final)');
      if (s.proposals.some((p) => !p.resolved)) n.push('every rubric proposal resolved (node cloop.mjs resolve ...)');
      if (head() !== s.gateSha) n.push(`HEAD ${head().slice(0, 7)} is not the gated ${(s.gateSha || 'none').slice(0, 7)}`);
      break;
  }
  if (j && j.outcome === 'PASS' && !['ASK', 'ACCEPT'].includes(s.state)) { // where a PASS leads
    const open = stageScope(s).filter((id) => !s.est.includes(id));
    if (s.state === 'GATE') {
      if (s.stage === 'CORE' && !['ONESHOT', 'LOOP'].includes(to)) n.push('core gate passed: the NON-CORE stage starts (ONESHOT or LOOP)');
      if (s.stage === 'NON-CORE' && to !== 'ACCEPT') n.push('release gate passed: ACCEPT');
    } else if (to === 'GATE' && open.length) n.push(`stage criteria still open: ${open.join(', ')}`);
    else if (to !== 'GATE' && to !== 'LOOP') n.push('after a PASS: LOOP for what is open, else GATE');
  }
  return n;
}

// ── Judging ──────────────────────────────────────────────────────────────────────────────
function inside(cited, worktree) { // a cited file that exists inside the worktree; delimiters around the path are ignored
  const token = (cited || '').trim().split(/\s/)[0].replace(/^[`'"(<\[]+|[`'"),;:.>\]]+$/g, '');
  if (!token) return false;
  const norm = (p) => { const r = fs.realpathSync.native(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  for (const base of [ROOT, worktree]) {
    const sp = path.resolve(base, token); if (!fs.existsSync(sp)) continue;
    const rel = path.relative(norm(worktree), norm(sp));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}
function parseOut(file, ids, worktree, useIds) {
  if (!fs.existsSync(file)) return { incomplete: [`${rel(file)} not found`], v: {}, rubricLines: [], fixes: [] };
  const text = fs.readFileSync(file, 'utf8'), v = {}, incomplete = [], rubricLines = [], fixes = [];
  for (const line of text.split('\n').map((l) => l.trim().replace(/^[-*]\s*/, '').replace(/^`|`$/g, ''))) {
    let m = line.match(/^RUBRIC:\s*(.+)/); if (m) { rubricLines.push(m[1]); continue; }
    m = line.match(/^FIX:\s*(.+)/); if (m) { fixes.push(m[1]); continue; }
    const parts = line.split(' | ').map((p) => p.trim());
    if (!ids.includes(parts[0]) || !['MET', 'NOT_MET'].includes(parts[1])) continue;
    const val = (k) => { const p = parts.find((x) => x.startsWith(k + ':')); return p ? p.slice(k.length + 1).trim() : ''; };
    if (parts[1] === 'MET' && !(val('evidence') && val('counterfeit') && val('boundary'))) incomplete.push(`${parts[0]}: MET needs evidence, counterfeit and boundary`);
    if (parts[1] === 'NOT_MET' && !val('case')) incomplete.push(`${parts[0]}: NOT_MET needs case`);
    if (parts[1] === 'MET' && useIds.includes(parts[0].split('/').pop())) {
      if (!inside(val('session'), worktree)) incomplete.push(`${parts[0]}: a MET judged by use needs session: <the judge's own session record inside its worktree>`);
    }
    v[parts[0]] = parts[1];
  }
  for (const id of ids) if (!v[id]) incomplete.push(`${id}: no verdict line`);
  return { v, incomplete, rubricLines, fixes };
}
function escalate(s, j) { // the ladder: outcomes counted per rung since the last PASS or rung change
  s.prevent = null;
  if (j.outcome === 'PASS') { s.rung = 'small'; s.count = zero(); s.require = null; return; }
  if (j.kind === 'oneshot' && j.outcome !== 'REGRESSION') { s.require = ['LOOP', 'ASK']; return; } // good → LOOP; bad → a re-define
  const from = s.rung; s.count[j.outcome]++;
  const [n, to] = LIMIT[from][j.outcome]; if (s.count[j.outcome] >= n && to !== from) { s.rung = to; s.count = zero(); }
  s.require = RUNGS[s.rung].to;
  if (s.rung === 'redefine') s.ask = `${j.kind} ${j.outcome} at rung ${from}: ${s.targets.join(', ')}`;
}
function settle(s) { // the outcome of a judging, once every NOT_MET is reproduced or dismissed
  const j = s.entry.judged;
  if (!j || j.outcome || (j.kind === 'explore' && !s.entry.winner) || Object.values(j.alleged).some((x) => x.reproduced === undefined)) return;
  const est = j.scope.filter((id) => j.met.includes(id) && !(j.alleged[id] && j.alleged[id].reproduced));
  const regress = j.scope.filter((id) => s.est.includes(id) && j.alleged[id] && j.alleged[id].reproduced);
  const fresh = est.filter((id) => !s.est.includes(id)), failed = j.scope.filter((id) => !est.includes(id));
  j.established = est;
  j.outcome = regress.length ? 'REGRESSION' : !failed.length ? 'PASS' : fresh.length ? 'ADVANCED' : 'STALLED';
  s.est = [...new Set([...s.est.filter((id) => !regress.includes(id)), ...est])];
  s.targets = failed;
  if (['PASS', 'ADVANCED'].includes(j.outcome)) s.best = j.sha; // ratchet-climbing: BEST only moves forward
  if (j.kind === 'gate' && j.outcome === 'PASS') s.gateSha = j.sha;
  s.hard = true; // the first council ends the provisional rubric
  const from = s.rung; escalate(s, j); j.from = from; j.to = s.rung; s.history.push(j);
}
function blocked(s, why) { s.ask = 'BLOCKED: ' + why; s.rung = 'redefine'; s.count = zero(); s.require = ['ASK']; }

// ── Rendering ────────────────────────────────────────────────────────────────────────────
function counts(s) {
  const C = rubric().crit, k = (t) => C.filter((c) => c.tag === t), e = (arr) => arr.filter((c) => s.est.includes(c.id)).length;
  return `CORE ${e(k('CORE'))}/${k('CORE').length} · NON-CORE ${e(k('NON-CORE'))}/${k('NON-CORE').length}`;
}
const levelLine = (s) => `rung ${s.rung} (${RUNGS[s.rung].says}; here: ADVANCED ${s.count.ADVANCED}/${LIMIT[s.rung].ADVANCED[0]}, STALLED ${s.count.STALLED}/${LIMIT[s.rung].STALLED[0]}, REGRESSION ${s.count.REGRESSION}/${LIMIT[s.rung].REGRESSION[0]})`;
const nextLines = (s) => FLOW[s.state].next.map((t) => { const x = needs(s, t); return `- ${t}: ${x.length ? 'needs ' + x.join('; ') : 'ready'}`; });
function board(s) {
  const R = rubric();
  return [`# cLoop board (rendered by cloop.mjs; do not edit)`, '',
    `## Task`, `${s.route} — ${s.reason} | cl/${s.slug} | state ${s.state} | stage ${s.stage} | ${levelLine(s)} | rubric ${s.frozen ? s.frozen.slice(0, 12) + (s.hard ? ' (frozen)' : ' (provisional)') : 'not frozen'}`, '',
    `## BEST`, `${s.best ? s.best.slice(0, 7) : 'none'} | ${counts(s)}`, '',
    `## Criteria`, ...R.crit.map((c) => `- ${c.id} ${c.tag}${c.use ? ' (use)' : ''}: ${s.est.includes(c.id) ? 'established' : 'open'}`), '',
    `## Judgings`, ...s.history.map((h) => `- ${h.t.slice(11, 19)} ${h.kind} @${(h.sha || '').slice(0, 7)} → ${h.outcome} (${h.established.length}/${h.scope.length}), rung ${h.from} → ${h.to}`), '',
    `## Step backs`, ...s.stepbacks.map((x) => `- ${x.size}${x.choice ? ' → ' + x.choice : ''}${x.targets ? ' [' + x.targets.join(',') + ']' : ''}: ${x.text.slice(0, 160)}`), '',
    `## Open`, ...(s.ask ? [`- re-define with the user: ${s.ask}`] : []), ...s.proposals.map((p, i) => `- rubric proposal ${i}: ${p.text}${p.resolved ? ' (resolved: ' + p.resolved + ')' : ''}`), '',
    `## Vetoes`, ...s.vetoes.map((v) => '- ' + v), '', `## Backlog`, ...s.backlog.map((v) => '- ' + v), '', `## Notes`, ...s.notes.map((v) => '- ' + v), '',
    `## Next`, ...nextLines(s), ''].join('\n');
}
function report(s, final) {
  const j = s.history[s.history.length - 1], open = rubric().crit.filter((c) => !s.est.includes(c.id)).map((c) => c.id);
  const ready = FLOW[s.state].next.find((t) => !needs(s, t).length);
  const out = [`Last: ${j ? j.outcome + ' (' + j.kind + ')' : 'no judging yet'} — ${levelLine(s)} — ${s.state}/${s.stage} — ${counts(s)} — open: ${open.join(', ') || 'none'} — next: ${FLOW[s.state].terminal ? 'end' : ready || needs(s, (s.require || FLOW[s.state].next)[0]).join('; ')}`];
  if (j) {
    const blocks = Object.entries(j.alleged).filter(([, x]) => x.reproduced).map(([id]) => id);
    const notes = [...Object.entries(j.alleged).filter(([, x]) => x.reproduced === false).map(([id]) => id + ' unconfirmed'), ...s.proposals.filter((p) => !p.resolved).map((p) => 'rubric proposal: ' + p.text)];
    if (blocks.length) out.push('Blocks: ' + blocks.join(', ')); if (notes.length) out.push('Does not block: ' + notes.join('; '));
  }
  if (final) out.push(`Delivered: cl/${s.slug} at ${head().slice(0, 7)}.`, ...(s.vetoes.length ? ['Vetoes: ' + s.vetoes.join('; ')] : []), ...(s.backlog.length ? ['Backlog: ' + s.backlog.join('; ')] : []));
  return out.join('\n');
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────
const freshEntry = () => ({ t: now(), card: null, runs: [], judged: null, finalReport: false, winner: null, winnerT: null, answer: null, replan: null, approved: null, duelers: [], fixes: [] });
const [cmd, ...a] = process.argv.slice(2);
const flag = (f) => { const i = a.indexOf(f); if (i < 0) return false; a.splice(i, 1); return true; };
const opt = (f) => { const i = a.indexOf(f); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
const text = (min, what) => { const t = a.join(' ').trim(); if (t.length < min) die(`${what} (${min}+ characters)`); return t; };

const C = {
  init() {
    const [route, slug, ...why] = a;
    if (!['FOCUSED', 'FULL'].includes(route) || !slug) die('init <FOCUSED|FULL> <slug> "<reason>"');
    if (fs.existsSync(F.state)) die('a task exists: node cloop.mjs status');
    fs.mkdirSync(DIR, { recursive: true });
    const existing = !git(['rev-parse', '--verify', 'HEAD']).code && git(['ls-files']).out.split('\n').filter((f) => f && !installed(f)).length > 0;
    if (!fs.existsSync(path.join(DIR, 'git')) && !gitUsable()) {
      const history = !git(['rev-parse', '--verify', 'HEAD']).code, bare = path.join(DIR, 'git');
      const r = history ? git(['clone', '--bare', '--no-hardlinks', '-q', ROOT, bare], ROOT) : git(['init', '--bare', '-b', 'main', bare], ROOT); if (r.code) die(r.out);
      if (history) git(['reset', '-q']);
      console.log(`.git does not allow refs or worktrees here: the repository lives in cloop/git${history ? ', with its history' : ''} (git through node cloop.mjs git <args>)`);
    }
    const ex = path.resolve(ROOT, git(['rev-parse', '--git-dir']).out.trim(), 'info', 'exclude'); fs.mkdirSync(path.dirname(ex), { recursive: true });
    const have = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8').split('\n') : [];
    fs.appendFileSync(ex, ['cloop/*', '!cloop/rubric.md', '!cloop/spec.md', '!cloop/architecture.md', 'temporary/'].filter((w) => !have.includes(w)).map((w) => w + '\n').join(''));
    if (git(['rev-parse', '--verify', 'HEAD']).code) git(['commit', '--allow-empty', '-m', 'cLoop baseline']);
    git(['checkout', '-B', 'cl/' + slug]);
    const dirtyAtInit = git(['status', '--porcelain']).out.split('\n').filter((l) => l.trim()).map((l) => l.slice(3).trim()); // what was there before the task is not its candidate
    const s = { route, slug, reason: why.join(' '), state: existing ? 'ADOPT' : 'PREFLIGHT', stage: 'CORE', baselineCount: fs.existsSync(F.rubric) ? rubric().crit.length : 0, entry: freshEntry(), preflight: {}, adopt: null, frozen: null, hard: false, frozenSet: null, est: [], targets: [], rung: 'small', count: zero(), require: null, prevent: null, ask: null, proposals: [], stepbacks: [], history: [], vetoes: [], backlog: [], notes: [], calls: {}, runs: [], best: null, gateSha: null, snap: null, dirtyAtInit };
    save(s, { ev: 'init', route, slug, existing }); console.log(`CLOOP: ${route} — ${s.reason}`); C.status();
  },
  status() {
    const s = load(), R = rubric(), T = FLOW[s.state];
    console.log(`STATE ${s.state} · stage ${s.stage} · ${counts(s)} · ${levelLine(s)}\n\nCARD\n${T.card}`);
    if (T.terminal) return;
    if (['DEFINE', 'EXPLORE', 'DUEL'].includes(s.state)) console.log('\n' + MERGE);
    if (s.ask) console.log(`\nRE-DEFINE WITH THE USER (${s.ask})`);
    if (['ONESHOT', 'LOOP', 'EXPLORE', 'DUEL', 'ASK'].includes(s.state)) console.log('\n' + STEPBACK);
    if (!s.entry.card) console.log('\nWrite the step card first: node cloop.mjs card "<intent>" "<route>" "<objection>"');
    if (['LOOP', 'DUEL'].includes(s.state)) { const ids = s.state === 'DUEL' ? openTargets(s, s.targets) : (s.prevent && s.prevent.targets) || s.targets; console.log('\nTARGETS\n' + (R.crit.filter((c) => ids.includes(c.id)).map((c) => c.raw).join('\n') || 'none: name them in the PREVENT step back (--targets)')); }
    if (['DEFINE', 'PREFLIGHT'].includes(s.state) && s.route === 'FULL') console.log('\nEXPLORE TRIGGERS\n' + Object.entries(EXPLORE_TRIGGERS).map(([k, v]) => `- ${k}: ${v}`).join('\n'));
    if (R.warnings.length) console.log('\nRUBRIC WARNINGS\n- ' + R.warnings.join('\n- '));
    const j = s.entry.judged; if (j && !j.outcome && j.alleged) { const ids = Object.keys(j.alleged).filter((id) => j.alleged[id].reproduced === undefined); if (ids.length) console.log('\nREPRODUCE before the outcome counts: ' + ids.map((id) => `node cloop.mjs reproduce ${id} yes|no "<command and output>"`).join(' ; ')); }
    if (s.entry.fixes.length) console.log('\nCOUNCIL FIX SUGGESTIONS (advice, not obligations)\n- ' + s.entry.fixes.join('\n- '));
    console.log('\nNEXT\n' + nextLines(s).join('\n'));
  },
  card() { const s = load(), [intent, route, objection] = a; if (FLOW[s.state].terminal) die('terminal states take no card'); if (!intent || !route || !objection) die('card "<intent>" "<route>" "<objection>"'); s.entry.card = { intent, route, objection }; save(s, { ev: 'card', intent, route, objection }); console.log('card recorded'); },
  advance() {
    const s = load(), why = opt('--why'), to = a[0]; if (!FLOW[to]) die('unknown state ' + to);
    const x = needs(s, to, why); if (x.length) die(`${s.state} → ${to} needs:\n- ` + x.join('\n- '));
    const j = s.entry.judged;
    if (to === 'ASK' && !s.ask) { s.rung = 'redefine'; s.count = zero(); s.ask = `a bad one-shot: ${s.targets.join(', ')}`; } // a wrong base is re-defined with the user
    if (s.state === 'ASK') s.ask = null;
    if (s.state === 'DEFINE' && s.rung === 'redefine') s.targets = stageScope(s).filter((id) => !s.est.includes(id)); // the re-defined stage's open criteria
    if (s.state === 'GATE' && j && j.outcome === 'PASS' && s.stage === 'CORE') s.stage = 'NON-CORE';
    if (to === 'DONE' && (s.vetoes.length || s.backlog.length)) {
      let t = fs.readFileSync(F.rubric, 'utf8').trimEnd();
      if (s.vetoes.length) t += '\n\n## Vetoes\n' + s.vetoes.map((v) => '- ' + v).join('\n');
      if (s.backlog.length) t += '\n\n## Backlog\n' + s.backlog.map((v) => '- ' + v).join('\n');
      fs.writeFileSync(F.rubric, t + '\n'); git(['add', 'cloop/rubric.md']); git(['commit', '-m', 'Record vetoes and backlog']);
      const files = git(['diff', '--name-only', s.gateSha, 'HEAD']).out.trim().split('\n').filter(Boolean);
      if (files.some((f) => f !== 'cloop/rubric.md') || rubric().hash !== s.frozen) die('the delivery commit changes more than the rubric notes');
    }
    if (to === 'EXPLORE' && EXPLORE_TRIGGERS[why]) s.notes.push(`EXPLORE trigger: ${why} — ${EXPLORE_TRIGGERS[why]}`);
    s.require = null; s.state = to; s.entry = freshEntry(); save(s, { ev: 'advance', to, why }); C.status();
  },
  adopt() { const s = load(), d = a.shift(); if (s.state !== 'ADOPT' || !['keep', 'simplify', 'replace'].includes(d)) die('adopt keep|simplify|replace "<reason>" (in ADOPT)'); s.adopt = d; save(s, { ev: 'adopt', decision: d, reason: text(20, "the reason and the user's answer") }); console.log('adoption: ' + d); },
  preflight() { const s = load(), [p, res, ...ev] = a; if (!/^P[1-4]$/.test(p) || !['ok', 'fail'].includes(res)) die('preflight P<1-4> ok|fail "<evidence>"'); s.preflight[p] = res; save(s, { ev: 'preflight', p, res, evidence: ev.join(' ') }); console.log(`${p} ${res}`); },
  freeze() {
    const s = load(), user = opt('--user'); if (!['DEFINE', 'ADOPT'].includes(s.state)) die('freeze only in DEFINE or ADOPT');
    const R = rubric(); if (R.errors.length) die('rubric:\n- ' + R.errors.join('\n- '));
    if (s.frozenSet && R.hash !== s.frozen) {
      const removed = s.frozenSet.ids.filter((id) => !R.crit.some((c) => c.id === id)), goals = R.goals.map((g) => g.raw).join('\n') !== s.frozenSet.goals;
      const why = [...(s.hard ? ['the rubric is frozen hard'] : []), ...(removed.length ? [`removed: ${removed.join(', ')}`] : []), ...(goals ? ['the goals changed'] : [])];
      if (why.length && (!user || user.trim().length < 3)) die(`this change needs the user (${why.join('; ')}): freeze --user "<their words>"`);
    }
    s.frozen = R.hash; s.frozenSet = { ids: R.crit.map((c) => c.id), goals: R.goals.map((g) => g.raw).join('\n') };
    git(['add', 'cloop/rubric.md']); git(['commit', '-m', 'Freeze rubric']);
    save(s, { ev: 'freeze', hash: R.hash, hard: s.hard, user }); console.log(`frozen ${R.hash.slice(0, 12)} (${s.hard ? 'hard' : 'provisional until the first council'})` + (R.warnings.length ? '\nwarnings:\n- ' + R.warnings.join('\n- ') : ''));
  },
  run() {
    const s = load(), kind = flag('--e2e') ? 'e2e' : flag('--suite') ? 'suite' : flag('--before') ? 'before' : 'run', judgment = flag('--judgment'), cwd = opt('--cwd');
    if (['ONESHOT', 'LOOP', 'EXPLORE'].includes(s.state) && !s.prevent && !s.entry.judged) die('PREVENT first: node cloop.mjs stepback small "<what the evidence shows, the cause, the next move>"');
    if (a[0] === '--') a.shift(); const command = a.join(' '); if (!command) die('run [--e2e|--suite|--before [--judgment]] [--cwd dir] -- <command>');
    const dir = cwd ? path.resolve(ROOT, cwd) : ROOT, t0 = Date.now(), r = sh(command, [], { cwd: dir, shell: true, timeout: 3 * 3600e3 });
    const rec = { kind, command, cwd: cwd ? dir : null, code: r.code, sha: head(cwd ? dir : undefined), secs: Math.round((Date.now() - t0) / 100) / 10, t: now(), tail: r.out.split('\n').slice(-12).join('\n'), judgment };
    s.entry.runs.push(rec); s.runs.push(rec); save(s, { ev: 'run', ...rec });
    process.stdout.write(r.out); console.log(`\n[cloop] ${kind} exit ${r.code} on ${rec.sha.slice(0, 7)} in ${rec.secs}s`);
  },
  call() {
    const s = load(), role = a[0], at = opt('--at'), roles = { judge: 'HEAD', member: 'HEAD', explorer: 'BEST', dueler: 'BEST', dynamic: 'BEST', mechanical: 'BEST' };
    if (!roles[role]) die('call judge|member|explorer|dueler|dynamic|mechanical [--at <commit>]');
    if (role === 'judge') { const dirty = git(['status', '--porcelain']).out.split('\n').filter((l) => l.trim() && !installed(l.slice(3).trim()) && !(s.dirtyAtInit || []).includes(l.slice(3).trim())).join('\n'); if (dirty) die('judges review HEAD: commit the candidate first; a file that is not part of the product goes in the repository\'s info/exclude (uncommitted: ' + dirty.split('\n').slice(0, 3).join(', ') + ')'); }
    if (s.state === 'GATE' && role === 'judge') { const h = head(), ok = (k) => s.runs.some((r) => r.kind === k && r.code === 0 && r.sha === h); if (!ok('e2e')) die('a gate runs the product end to end on this commit first: node cloop.mjs run --e2e -- <command>'); if (s.stage === 'NON-CORE' && !ok('suite')) die('the release gate runs the full suite on this commit first: node cloop.mjs run --suite -- <command>'); }
    const commit = at || (roles[role] === 'BEST' ? s.best || head() : head()), id = crypto.randomBytes(4).toString('hex');
    const run = path.join(DIR, 'runs', id), wt = path.join(DIR, 'wt', id); fs.mkdirSync(run, { recursive: true });
    const r = git(['worktree', 'add', '-b', 'cl/' + id, wt, commit]); if (r.code) die(r.out);
    if (role === 'judge' && !s.snap) s.snap = snapshot();
    if (role === 'dueler') s.entry.duelers.push(id);
    s.calls[id] = { role, commit, t: now(), worktree: wt }; save(s, { ev: 'call', id, role, commit });
    console.log(`call ${id} (${role}) at ${commit.slice(0, 7)}\npacket: ${rel(run)}/packet.md\nreturn: ${rel(run)}/out.md (the reply, verbatim)\nworktree: ${rel(wt)}`);
  },
  isolation() { const s = load(); if (!s.snap) die('no open judge call'); const ok = sameTree(s.snap, snapshot()); console.log(ok ? 'repository unchanged since the first judge call' : 'repository CHANGED since the first judge call'); if (ok) { s.snap = null; save(s, { ev: 'isolation', ok }); } process.exit(ok ? 0 : 1); },
  judge() {
    const s = load(), options = (opt('--options') || '').split(',').filter(Boolean), [kind, idA, idB] = a, e = s.entry;
    const kinds = { explore: ['EXPLORE'], oneshot: ['ONESHOT'], loop: ['LOOP'], merge: ['EXPLORE', 'DUEL'], gate: ['GATE'] };
    if (!kinds[kind] || !idA || !idB) die('judge <explore|oneshot|loop|merge|gate> <callA> <callB> [--options a,b,c]');
    if (!kinds[kind].includes(s.state)) die(`judge ${kind} belongs to ${kinds[kind].join(' or ')}; you are in ${s.state}`);
    if (e.judged && !e.judged.outcome && !(kind === 'merge' && e.judged.amalgam)) die('the open judging needs its reproductions first');
    if (e.judged && e.judged.outcome) die('this entry is judged; follow the outcome');
    if (kind === 'merge' && s.state === 'EXPLORE' && !(e.judged && e.judged.amalgam)) die('judge merge in EXPLORE follows winner <a>,<b>');
    if (kind === 'merge' && s.state === 'DUEL') {
      if (e.duelers.length < 2) die('two loop-breakers first (call dueler, twice)');
      for (const d of e.duelers) if (!e.runs.some((r) => r.cwd === s.calls[d].worktree)) die(`run loop-breaker ${d}'s result yourself (node cloop.mjs run --cwd ${rel(s.calls[d].worktree)} -- ...)`);
      const last = Math.max(...e.runs.filter((r) => r.cwd).map((r) => Date.parse(r.t)));
      if (!e.runs.some((r) => !r.cwd && r.code === 0 && Date.parse(r.t) > last)) die('run the merged product on HEAD (node cloop.mjs run -- ...)');
    }
    if (['loop', 'merge'].includes(kind) && s.state !== 'EXPLORE' && !s.prevent && !e.duelers.length) die('PREVENT first: the step back that names the targets');
    for (const id of [idA, idB]) if (!s.calls[id] || s.calls[id].role !== 'judge') die(`${id} is not a judge call (node cloop.mjs call judge)`);
    if (idA === idB) die('two different judges');
    if (!s.snap) die('no snapshot: start the judge calls with node cloop.mjs call judge');
    const before = s.snap, after = snapshot(); s.snap = null;
    if (!sameTree(before, after)) { save(s, { ev: 'judge-void', kind }); die('the repository changed during the calls: both void; re-dispatch once with the same packets'); }
    if (kind === 'gate') { const ok = (k) => s.runs.some((r) => r.kind === k && r.code === 0 && r.sha === before.head && r.t < before.t); if (!ok('e2e')) die('a gate needs run --e2e on this commit before the judges'); if (s.stage === 'NON-CORE' && !ok('suite')) die('the release gate needs run --suite on this commit before the judges'); }
    const scope = kind === 'gate' ? gateScope(s) : kind === 'loop' ? ((s.prevent && s.prevent.targets) || s.targets) : (kind === 'merge' && s.state === 'DUEL') ? openTargets(s, s.targets) : stageScope(s);
    if (!scope.length) die('nothing in scope');
    if (kind === 'explore' && options.length < 2) die('explore needs --options with at least two aliases');
    const ids = kind === 'explore' ? options.flatMap((o) => scope.map((c) => `${o}/${c}`)) : scope, useIds = rubric().crit.filter((c) => c.use).map((c) => c.id);
    const res = [idA, idB].map((id) => ({ id, ...parseOut(path.join(DIR, 'runs', id, 'out.md'), ids, s.calls[id].worktree, useIds) })), bad = res.filter((r) => r.incomplete.length);
    if (bad.length) {
      const twice = bad.filter((r) => s.calls[r.id].redispatched); if (twice.length) blocked(s, `judge ${twice.map((r) => r.id).join(', ')} incomplete after its re-dispatch`);
      save(s, { ev: 'judge-incomplete', calls: bad.map((r) => r.id) });
      die(bad.map((r) => `${r.id} incomplete:\n  - ${r.incomplete.join('\n  - ')}`).join('\n') + (s.ask ? `\n${s.ask}: ASK` : '\nre-dispatch that call once with the same packet (node cloop.mjs redispatch <id>), then judge again'));
    }
    for (const r of res) { for (const p of r.rubricLines) if (!s.proposals.some((x) => x.text === p && !x.resolved)) s.proposals.push({ text: p, resolved: null }); for (const f of r.fixes) if (!e.fixes.includes(f)) e.fixes.push(f); }
    const met = ids.filter((id) => res.some((r) => r.v[id] === 'MET')), alleged = {};
    for (const r of res) for (const id of ids) if (r.v[id] === 'NOT_MET') alleged[id] = {};
    if (kind === 'explore') {
      const C2 = rubric().crit, good = (o, c) => met.includes(`${o}/${c}`) && !alleged[`${o}/${c}`];
      const rank = options.map((o) => ({ o, core: scope.filter((c) => C2.find((x) => x.id === c).tag === 'CORE' && good(o, c)).length, all: scope.filter((c) => good(o, c)).length })).sort((x, y) => y.core - x.core || y.all - x.all);
      e.judged = { kind, sha: before.head, scope, options, rank, met, alleged, t: now(), outcome: null, established: [] };
      save(s, { ev: 'judge', kind, rank });
      return console.log('RANK (CORE established, then all)\n' + rank.map((r) => `- ${r.o}: CORE ${r.core}, all ${r.all}/${scope.length}`).join('\n') + `\nnode cloop.mjs winner <alias> (top: ${rank.filter((r) => r.core === rank[0].core && r.all === rank[0].all).map((r) => r.o).join(', ')}), or winner <a>,<b> for an amalgam (then judge merge)`);
    }
    e.judged = { kind, sha: before.head, scope, met, alleged, t: now(), outcome: null, established: [] }; settle(s);
    save(s, { ev: 'judge', kind, met, alleged: Object.keys(alleged), outcome: e.judged.outcome }); C.status();
  },
  winner() {
    const s = load(), picks = (a[0] || '').split(',').filter(Boolean), j = s.entry.judged;
    if (s.state !== 'EXPLORE' || !j || j.kind !== 'explore' || s.entry.winner) die('winner follows judge explore, once');
    for (const o of picks) if (!j.options.includes(o)) die('unknown option ' + o);
    if (picks.length === 1 && !j.rank.filter((r) => r.core === j.rank[0].core && r.all === j.rank[0].all).some((r) => r.o === picks[0])) die('a single winner is one of the top options by rank');
    if (!picks.length) die('winner <alias> | winner <a>,<b>');
    for (const r of j.rank) if (!picks.includes(r.o)) s.vetoes.push(`explored option ${r.o}: CORE ${r.core}, all ${r.all}/${j.scope.length}`);
    s.entry.winner = picks.join(','); s.entry.winnerT = now();
    if (picks.length > 1) { s.entry.judged = { kind: 'explore', amalgam: true, scope: j.scope, alleged: {}, met: [], outcome: null, established: [], t: now() }; save(s, { ev: 'winner', options: picks }); return console.log('amalgam: integrate it, run it, then judge merge'); }
    j.met = j.scope.filter((c) => j.met.includes(`${picks[0]}/${c}`)); j.alleged = Object.fromEntries(j.scope.filter((c) => j.alleged[`${picks[0]}/${c}`]).map((c) => [c, {}]));
    settle(s); save(s, { ev: 'winner', options: picks }); C.status();
  },
  redispatch() { const s = load(), id = a[0]; if (!s.calls[id]) die('unknown call'); if (s.calls[id].redispatched) die('a call is re-dispatched once; a second failure goes to the user'); s.calls[id].redispatched = true;
    const wt = s.calls[id].worktree; git(['reset', '-q', '--hard', s.calls[id].commit], wt); git(['clean', '-qfdx'], wt); // the retry starts blind, as the first call did
    if (!s.snap && s.calls[id].role === 'judge') s.snap = snapshot(); save(s, { ev: 'redispatch', id }); console.log(`re-dispatch ${id} with the same packet; its reply replaces out.md`); },
  reproduce() {
    const s = load(), [id, yn, ...ev] = a, j = s.entry.judged; if (!j || !j.alleged[id] || !['yes', 'no'].includes(yn)) die('reproduce <ID> yes|no "<command and output>"');
    j.alleged[id].reproduced = yn === 'yes'; j.alleged[id].evidence = ev.join(' '); settle(s); save(s, { ev: 'reproduce', id, reproduced: yn === 'yes' }); C.status();
  },
  stepback() {
    const s = load(), size = a.shift(), targets = (opt('--targets') || '').split(',').filter(Boolean), known = rubric().crit.map((c) => c.id);
    for (const t of targets) if (!known.includes(t)) die('unknown criterion ' + t);
    if (size === 'small') {
      if (s.state === 'ASK') die('at a re-define the loop-breakers step back: stepback replan DEFINE|EXPLORE "<the re-plan>"');
      const t = text(40, 'a step back answers its questions'); s.prevent = { t: now(), targets: targets.length ? targets : null };
      s.stepbacks.push({ size, targets: s.prevent.targets, text: t, t: now() }); save(s, { ev: 'stepback', size, targets, text: t }); return console.log('small step back recorded (PREVENT)');
    }
    if (size === 'replan') {
      const choice = a.shift(); if (s.state !== 'ASK' || !s.entry.answer) die("the re-plan follows the user's comment at ASK (node cloop.mjs answer ...)");
      if (!['DEFINE', 'EXPLORE'].includes(choice)) die('stepback replan DEFINE|EXPLORE "<the re-plan>"');
      if (s.entry.duelers.length < 2) die("two loop-breakers take the full step back with the user's comment first (call dueler, twice)");
      const t = text(200, 'a re-plan is a full step back, in a few paragraphs'); s.entry.replan = { choice, text: t, t: now() }; s.entry.approved = null;
      s.stepbacks.push({ size, choice, targets: targets.length ? targets : s.targets, text: t, t: now() }); save(s, { ev: 'stepback', size, choice, text: t }); return console.log(`re-plan recorded (${choice}); show it to the user, then: node cloop.mjs approve "<their words>"`);
    }
    die('stepback small --targets <IDs> "<answers>" | stepback replan DEFINE|EXPLORE "<the re-plan>" (a full step back is the loop-breakers\', in their packets)');
  },
  approve() { const s = load(); if (s.state !== 'ASK' || !s.entry.replan) die('approve follows the re-plan at ASK'); const t = text(3, "the user's words"); s.entry.approved = { t: now(), text: t }; s.count = zero(); save(s, { ev: 'approve', text: t }); console.log('the user approved the re-plan: advance ' + s.entry.replan.choice); },
  blocked() { const s = load(); const t = text(10, 'what blocks the work'); blocked(s, t); save(s, { ev: 'blocked', text: t }); console.log('blocked: ASK the user'); },
  answer() { const s = load(); if (!['ASK', 'ACCEPT'].includes(s.state)) die('answers belong to ASK or ACCEPT'); const t = text(3, "the user's words"); s.entry.answer = t; save(s, { ev: 'answer', text: t }); console.log('answer recorded'); },
  resolve() { const s = load(), [i, ...how] = a, p = s.proposals[+i]; if (!p || how.join(' ').trim().length < 3) die('resolve <n> "<applied in DEFINE | dismissed: reason>"'); p.resolved = how.join(' '); save(s, { ev: 'resolve', i }); console.log('resolved'); },
  veto() { const s = load(); s.vetoes.push(text(10, 'a veto names the option and why')); save(s, { ev: 'veto', text: a.join(' ') }); console.log('veto recorded'); },
  backlog() { const s = load(); s.backlog.push(text(5, 'a backlog item')); save(s, { ev: 'backlog', text: a.join(' ') }); console.log('backlog recorded'); },
  note() { const s = load(); s.notes.push(text(5, 'a note')); save(s, { ev: 'note', text: a.join(' ') }); console.log('note recorded'); },
  report() { const s = load(), final = flag('--final'); if (final) { if (s.state !== 'ACCEPT') die('--final only in ACCEPT'); s.entry.finalReport = true; save(s, { ev: 'report', final }); } console.log(report(s, final)); },
  clean() {
    const s = load(); if (!FLOW[s.state].terminal) die('clean only after DONE or STOPPED');
    for (const id of Object.keys(s.calls)) { git(['worktree', 'remove', '--force', s.calls[id].worktree]); git(['branch', '-D', 'cl/' + id]); }
    for (const d of [path.join(DIR, 'runs'), path.join(DIR, 'wt'), path.join(ROOT, 'temporary')]) fs.rmSync(d, { recursive: true, force: true });
    save(s, { ev: 'clean' }); console.log('task files removed; rubric, spec, architecture, state, log and board kept');
  },
  git() { const r = git(a); process.stdout.write(r.out); process.exit(r.code); },
  check() { // flow validator: cards, known targets, every state reachable and able to end, ladder targets reachable where judgings happen
    const errs = [], judging = ['EXPLORE', 'ONESHOT', 'LOOP', 'DUEL', 'GATE'];
    for (const [k, v] of Object.entries(FLOW)) { if (!v.card) errs.push(k + ': no card'); for (const t of v.next) if (!FLOW[t]) errs.push(`${k} → ${t}: unknown`); }
    for (const k of Object.keys(FLOW)) { const seen = new Set([k]), q = [k]; let ok = false; while (q.length) { const x = q.shift(); if (FLOW[x].terminal) { ok = true; break; } for (const t of FLOW[x].next) if (!seen.has(t)) { seen.add(t); q.push(t); } } if (!ok) errs.push(k + ': cannot end'); }
    const reach = new Set(['ADOPT', 'PREFLIGHT']), q = ['ADOPT', 'PREFLIGHT']; while (q.length) for (const t of FLOW[q.shift()].next) if (!reach.has(t)) { reach.add(t); q.push(t); }
    for (const k of Object.keys(FLOW)) if (!reach.has(k)) errs.push(k + ': unreachable');
    for (const st of judging) for (const r of Object.values(RUNGS)) for (const t of r.to) if (!FLOW[st].next.includes(t)) errs.push(`${st}: ladder target ${t} not allowed`);
    for (const [from, row] of Object.entries(LIMIT)) for (const [o, [n, to]] of Object.entries(row)) if (!RUNGS[to] || n < 1) errs.push(`ladder ${from}/${o}: bad limit`);
    if (!RUNGS.redefine.to.includes('ASK')) errs.push('the ladder does not end with the user');
    console.log(errs.length ? 'FLOW INVALID\n- ' + errs.join('\n- ') : `FLOW OK: ${Object.keys(FLOW).length} states, each reachable and able to end; ladder of ${Object.keys(RUNGS).length} rungs reachable from every judging state, ending with the user`);
    process.exit(errs.length ? 1 : 0);
  },
  flow() { console.log(Object.entries(FLOW).map(([k, v]) => `${k} → ${v.next.join(', ') || '(end)'}`).join('\n') + '\n\nLADDER (outcomes counted per rung since the last PASS or rung change; PASS → small; BLOCKED → redefine)\n' + Object.entries(LIMIT).map(([r, row]) => `${r}: ` + Object.entries(row).map(([o, [n, to]]) => `${o} ${to === r ? 'stays' : n === 1 ? '→ ' + to : 'stays (' + n + (n === 2 ? 'nd' : 'rd') + ' → ' + to + ')'}`).join(' · ')).join('\n')); },
};
if (!C[cmd]) { console.log('commands: ' + Object.keys(C).join(' ')); process.exit(cmd ? 2 : 0); }
C[cmd]();
