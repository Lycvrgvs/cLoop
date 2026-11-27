#!/usr/bin/env node
// cLoop engine: runs the flow in flow.json, binds the cards in cards/, enforces what can be computed.
// Judgment stays with the agent (the profile and the cards); the user's decisions stay with the user.
// Node standard library only. Installed as .cloop/cloop.mjs with .cloop/flow.json and .cloop/cards/;
// run from the repository root: node .cloop/cloop.mjs <command> ...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.2.3';
const ROOT = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(ROOT, 'cloop');
const F = { state: path.join(DIR, 'state.json'), log: path.join(DIR, 'log.jsonl'), board: path.join(DIR, 'board.md'), rubric: path.join(DIR, 'rubric.md') };
const METHOD_PATHS = ['.cloop/', '.codex/', '.claude/', 'AGENTS.md', 'CLAUDE.md', 'cloop.mjs']; // the installed method, never part of the product
const CMD = 'node ' + (path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/') || 'cloop.mjs');
const TAGS = ['CORE', 'NON-CORE'];
const ROLES = ['judge', 'member', 'explorer', 'dueler', 'dynamic', 'mechanical'];
const EXPLORE_TRIGGERS = { shape: "the output's shape is unclear after DEFINE", mechanism: 'several mechanisms are plausible and no cheap check separates them' };
const ZERO = () => ({ ADVANCED: 0, STALLED: 0, REGRESSION: 0 });
const now = () => new Date().toISOString();
const die = (msg) => { console.error('REFUSED: ' + msg); process.exit(2); };
const NEXT_HINT = `${CMD} status shows the state, its cards and what each exit needs`;

// ── Flow and cards: data, read at start ──────────────────────────────────────────────────
function readFlow() {
  const p = path.join(HERE, 'flow.json');
  if (!fs.existsSync(p)) die(`flow.json is missing next to the engine (${p}): reinstall with install.mjs update`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const FLOWDATA = readFlow(), FLOW = FLOWDATA.states, LADDER = FLOWDATA.ladder, RUNGS = FLOWDATA.rungs, PREVENT = FLOWDATA.prevent || {};
function readCards() { // cards/<id>.md: front matter (card, state, rung, role, loads), then the body
  const dir = path.join(HERE, 'cards'), cards = {};
  if (!fs.existsSync(dir)) return cards;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n'), m = t.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) { cards[f] = { file: f, bad: 'no front matter' }; continue; }
    const fm = Object.fromEntries(m[1].split('\n').map((l) => l.split(/:\s*/)).filter((x) => x.length >= 2).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
    cards[fm.card || f] = { file: f, ...fm, states: (fm.state || '').split(/,\s*/).filter(Boolean), body: m[2].trim().replaceAll('{{cmd}}', CMD) };
  }
  return cards;
}
const CARDS = readCards();
const bound = (q) => FLOWDATA.cards.filter((b) => b.state === q.state && b.role === q.role);
function cardText(q) {
  const out = [];
  for (const b of bound(q)) { const c = CARDS[b.card]; if (!c || !c.body) die(`card "${b.card}" (${b.state}, ${b.role}) is missing from ${path.join(HERE, 'cards')}: reinstall with install.mjs update`); out.push(c.body); }
  return out.join('\n\n');
}

// ── State, log, git ────────────────────────────────────────────────────────────────────────
function load() {
  if (!fs.existsSync(F.state)) die(`no task here: ${CMD} init <FOCUSED|FULL> <slug> "<reason>" (DIRECT uses no tool)`);
  const s = JSON.parse(fs.readFileSync(F.state, 'utf8'));
  if (!FLOW[s.state]) die(`this task was started by cLoop 1.1.0 or earlier (state ${s.state}): finish it with that version, or ${CMD} clean --force and start again`);
  if (s.version !== VERSION) { // a task saved by an earlier version continues; the prevent is owed from its next state entry
    const from = s.version;
    if ('stage' in s) { // 1.2.0: a core and a non-core stage become one features stage
      if (s.prevent) s.entry.prevent = s.prevent;
      for (const k of ['stage', 'prevent']) delete s[k];
      s.entry.block = null; s.blocks = [];
    }
    s.entry.legacy = true; s.version = VERSION;
    save(s, { ev: 'migrate', from, to: VERSION });
  }
  return s;
}
function save(s, event) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(F.state, JSON.stringify(s, null, 2));
  if (event) fs.appendFileSync(F.log, JSON.stringify({ t: now(), state: s.state, rung: s.rung, ...event }) + '\n');
  fs.writeFileSync(F.board, board(s));
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd || ROOT, maxBuffer: 1 << 26, shell: !!opts.shell, timeout: opts.timeout });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}
const ident = ['-c', 'user.name=cloop', '-c', 'user.email=cloop@localhost'];
const STORE = path.join(DIR, 'git'), storeLine = () => fs.existsSync(STORE) ? `git: cloop/git (${CMD} git <args>)` : '';
const gitDirArgs = () => fs.existsSync(STORE) ? ['--git-dir=' + STORE, '--work-tree=' + ROOT] : [];
let hasId = null; // commits need an identity; a fresh sandbox may have none
function git(args, cwd) {
  if (hasId === null) hasId = !!sh('git', ['config', 'user.email']).out.trim();
  return sh('git', ['-c', 'safe.directory=*', ...(hasId ? [] : ident), ...(cwd ? [] : gitDirArgs()), ...args], { cwd });
}
const head = (cwd) => git(['rev-parse', 'HEAD'], cwd).out.trim();
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const product = (p) => !METHOD_PATHS.some((m) => p === m.replace(/\/$/, '') || p.startsWith(m));
const dirty = (s) => git(['status', '--porcelain']).out.split('\n').filter((l) => l.trim()).map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter((p) => product(p) && !((s && s.dirtyAtInit) || []).includes(p));
const snapshot = () => ({ head: head(), status: git(['status', '--porcelain']).out, diff: sha256(git(['diff']).out), t: now() });
const sameTree = (a, b) => a.head === b.head && a.status === b.status && a.diff === b.diff;
const diffSize = (from, to) => from && to ? git(['diff', '--numstat', from, to]).out.split('\n').filter(Boolean).reduce((n, l) => n + (+l.split('\t')[0] || 0) + (+l.split('\t')[1] || 0), 0) : 0;
function gitProbe(slug) { // make the very writes the method needs, never a proxy: the exclude file, the task branch, a cl/ worktree and a commit in it; '' when all work, else what refused
  const why = (what, r) => `${what}: ${r.out.trim().split('\n').pop() || 'refused'}`;
  let r;
  if (!fs.existsSync(path.join(ROOT, '.git')) && !gitDirArgs().length && (r = git(['init', '-b', 'main'])).code) return why('git init', r);
  if (git(['rev-parse', '--verify', 'HEAD']).code && (r = git(['commit', '--allow-empty', '-m', 'cLoop baseline'])).code) return why('the baseline commit', r);
  const gd = git(['rev-parse', '--git-dir']).out.trim(); if (!gd) return 'no repository found';
  try { const ex = path.resolve(ROOT, gd, 'info', 'exclude'); fs.mkdirSync(path.dirname(ex), { recursive: true }); fs.appendFileSync(ex, ''); } catch (e) { return 'info/exclude: ' + e.message; }
  if ((r = git(['checkout', '-q', '-B', 'cl/' + slug])).code) return why('the task branch', r);
  const tag = crypto.randomBytes(3).toString('hex'), br = 'cl/probe-' + tag, wt = path.join(DIR, 'wt', 'probe-' + tag);
  const w = git(['worktree', 'add', '-q', '-b', br, wt, 'HEAD']), c = w.code ? w : git(['commit', '-q', '--allow-empty', '-m', 'cLoop probe'], wt);
  git(['worktree', 'remove', '--force', wt]); git(['branch', '-q', '-D', br]); git(['worktree', 'prune']); fs.rmSync(wt, { recursive: true, force: true });
  return w.code ? why('a worktree', w) : c.code ? why('a commit in a worktree', c) : '';
}

// ── The rubric: goals mapped to criteria, criteria with their cases ──────────────────────
function section(text, name) {
  const start = text.search(new RegExp(`^## ${name}\\s*$`, 'm')); if (start < 0) return null;
  const body = text.slice(start).split('\n').slice(1), end = body.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? body : body.slice(0, end)).map((l) => l.trim()).filter((l) => l.startsWith('- '));
}
function rubric() {
  if (!fs.existsSync(F.rubric)) return { crit: [], goals: [], errors: ['cloop/rubric.md is missing (the define card gives its format)'], warnings: [] };
  const text = fs.readFileSync(F.rubric, 'utf8'), errors = [], warnings = [], crit = [], goals = [];
  const cl = section(text, 'Criteria'), gl = section(text, 'Goals');
  if (!cl) errors.push('add a "## Criteria" section'); if (!gl) errors.push('add a "## Goals" section');
  for (const raw of cl || []) {
    const parts = raw.slice(2).split(' | ').map((p) => p.trim()), [id, tag, property] = parts;
    const field = (k) => (parts.find((p) => p.startsWith(k + ':')) || '').slice(k.length + 1).trim();
    const c = { id, tag, property, evidence: field('evidence'), pass: field('pass'), fail: field('fail'), boundary: field('boundary'), raw };
    c.use = /\buse session\b/i.test(c.evidence);
    if (!id || !TAGS.includes(tag) || !property) { errors.push(`"${raw.slice(0, 50)}…" needs "<ID> | CORE|NON-CORE | <property>"`); continue; }
    for (const k of ['evidence', 'pass', 'fail', 'boundary']) if (!c[k]) errors.push(`${id}: add "| ${k}: …"`);
    if (crit.some((x) => x.id === id)) errors.push(`${id}: duplicate ID`);
    if (/\band\b/i.test(property)) warnings.push(`${id}: "and" in the property; split it if it can be half-met`);
    crit.push(c);
  }
  for (const raw of gl || []) {
    const [gid, words, map] = raw.slice(2).split(' | ').map((p) => p.trim());
    if (!gid || !words || !map) { errors.push(`goal "${raw.slice(0, 50)}…" needs "<G#> | <the user's words> | <IDs> or Drop: <reason>"`); continue; }
    const drop = /^Drop:\s*\S/.test(map), ids = drop ? [] : map.split(/[,\s]+/).filter(Boolean);
    for (const id of ids) if (!crit.some((c) => c.id === id)) errors.push(`${gid}: maps to unknown criterion ${id}`);
    if (!drop && !ids.length) errors.push(`${gid}: map it to criteria or to "Drop: <reason>"`);
    goals.push({ gid, raw, ids, drop });
  }
  for (const c of crit) if (!goals.some((g) => g.ids.includes(c.id))) errors.push(`${c.id}: no goal traces to it (map it from a goal, or remove it)`);
  if (!crit.some((c) => c.tag === 'CORE')) errors.push('add a CORE criterion');
  return { crit, goals, errors, warnings, hash: sha256([...(gl || []), ...(cl || [])].join('\n')) };
}
const allIds = () => rubric().crit.map((c) => c.id);
const coreIds = () => rubric().crit.filter((c) => c.tag === 'CORE').map((c) => c.id);
const open = (s) => allIds().filter((id) => !s.est.includes(id));
const JUDGE_KIND = { ONESHOT: 'oneshot', LOOP: 'loop', DUEL: 'merge', GATE: 'gate', EXPLORE: 'explore' };

// ── Guards: named functions; flow.json says which apply to which exit ─────────────────────
const GUARDS = {
  ladder: (s, to) => {
    if (s.ask && s.state !== 'ASK' && to !== 'ASK') return [`a re-define is open (${s.ask}): ${CMD} advance ASK`];
    if (to === 'ASK' && !s.ask && !(s.require || []).includes('ASK')) return [`ASK is the re-define: it opens from the ladder, or from ${CMD} blocked "<what blocks>"`];
    if (s.require && !s.require.includes(to)) return [`the last outcome leads to ${s.require.join(' or ')} (rung ${s.rung}): ${CMD} advance ${s.require[0]}`];
    return [];
  },
  rubricUnchanged: (s) => !s.frozen || rubric().hash === s.frozen ? [] : [`the rubric changed since the freeze: restore cloop/rubric.md to the frozen version (${CMD} git checkout -- cloop/rubric.md); only DEFINE changes it, through a re-define`],
  rubricValid: () => rubric().errors.map((x) => `rubric: ${x} (fix cloop/rubric.md, then ${CMD} freeze)`),
  rubricFrozen: (s) => s.frozen === rubric().hash ? [] : [`freeze the rubric: ${CMD} freeze`],
  baselineRun: (s) => s.entry.runs.some((r) => r.kind === 'run' && !r.cwd) ? [] : [`the baseline real run on HEAD: ${CMD} run -- <command>`],
  prevented: (s) => owed(s, null), // the state's exit checks its prevent again
  adoptRecord: (s) => s.adopt ? [] : [`the adoption decision: ${CMD} adopt keep|simplify|replace "<what exists, what works, the user's answer>"`],
  adoptRubric: (s, to) => {
    if (!s.adopt) return [];
    if (s.adopt === 'replace') return to === 'DEFINE' ? [] : [`replace: DEFINE writes the new rubric: ${CMD} advance DEFINE`];
    const R = rubric(), n = R.errors.map((x) => `rubric: ${x} (fix cloop/rubric.md)`);
    if (s.frozen !== R.hash) n.push(`freeze the adopted rubric: ${CMD} freeze`);
    if (R.crit.length > s.baselineCount) n.push(`adoption never adds criteria (${R.crit.length} > ${s.baselineCount}): remove the new ones, or ${CMD} adopt replace "<why>"`);
    return n;
  },
  redefineBuilds: (s, to) => s.rung === 'redefine' && open(s).length && to !== 'DUEL' ? [`after a re-define, the loop-breakers build: ${CMD} advance DUEL`] : [],
  exploreAllowed: (s, to, why) => s.route !== 'FULL' ? [`a FOCUSED task never explores; it climbs: ${CMD} advance ONESHOT`] : ['ADOPT', 'DEFINE'].includes(s.state) && !EXPLORE_TRIGGERS[why] ? [`name the trigger: ${CMD} advance EXPLORE --why ${Object.keys(EXPLORE_TRIGGERS).join('|')}`] : [],
  somethingToFix: (s) => open(s).length ? [] : [`every criterion is established: a duel has nothing to fix; the release gate comes next: ${CMD} advance GATE once a next-shot has passed (else ${CMD} advance LOOP)`],
  nextShotPassed: (s) => { const j = s.entry.judged; return j && ['loop', 'merge'].includes(j.kind) && j.outcome === 'PASS' ? [] : [`the release gate needs a next-shot that passed its council: ${CMD} advance LOOP`]; },
  exploreSettled: (s) => {
    const e = s.entry, j = e.judged;
    if (!j || !e.winner) return [`the options judged and one chosen: ${CMD} judge explore <idA> <idB> --options <aliases>, then ${CMD} winner <alias>`];
    if (!j.outcome) return [j.amalgam ? `the amalgam judged: ${CMD} judge merge <idA> <idB>` : `settle every NOT_MET: ${CMD} reproduce <ID> yes|no -- <command>`];
    return e.runs.some((r) => r.code === 0 && r.t > e.winnerT && r.sha === head() && !r.cwd) ? [] : [`the merged one-shot run on real input on HEAD: ${CMD} run -- <command>`];
  },
  realRun: (s) => s.entry.runs.some((r) => r.kind === 'run' && r.code === 0) ? [] : [`a passing real run of the one-shot: ${CMD} run -- <command>`],
  seenFailing: (s) => !(s.entry.failing || []).length || s.entry.runs.some((r) => r.kind === 'before' && (r.code !== 0 || r.judgment)) ? [] : [`a failing criterion seen failing on BEST before the repair: ${CMD} run --before --cwd <a worktree of BEST> -- <its check>`],
  judged: (s) => {
    const j = s.entry.judged, kind = JUDGE_KIND[s.state];
    if (!j) return [`the council: ${CMD} call judge (twice), then ${CMD} judge ${kind} <idA> <idB>`];
    return j.outcome ? [] : [`settle every NOT_MET: ${CMD} reproduce <ID> yes|no -- <command> | ${CMD} reproduce <ID> missing "<why>"`];
  },
  userAnswer: (s) => s.entry.answer ? [] : [`the user's words: ${CMD} answer "<their words>"`],
  replanApproved: (s, to) => {
    const e = s.entry;
    if (!e.replan) return [`the loop-breakers' re-plan: ${CMD} call dueler (twice), then ${CMD} stepback replan DEFINE|EXPLORE "<the re-plan>"`];
    if (!e.approved) return [`the user's yes to the re-plan: ${CMD} approve "<their words>"`];
    return to === e.replan.choice ? [] : [`the approved re-plan goes to ${e.replan.choice}: ${CMD} advance ${e.replan.choice}`];
  },
  finalReport: (s) => s.entry.finalReport ? [] : [`the final report: ${CMD} report --final`],
  proposalsResolved: (s) => s.proposals.some((p) => !p.resolved) ? [`resolve every rubric proposal: ${CMD} resolve <n> "<applied in DEFINE | dismissed: reason>"`] : [],
  gatedHead: (s) => head() === s.gateSha ? [] : [`HEAD ${head().slice(0, 7)} is not the gated commit ${(s.gateSha || 'none').slice(0, 7)}: ${CMD} git checkout ${(s.gateSha || '').slice(0, 7)}, or gate again`],
};
function needs(s, to, why) {
  const st = FLOW[s.state];
  if (!st.next.includes(to)) return [`${s.state} cannot go to ${to}; it goes to ${st.next.join(', ') || 'nothing (the task is over)'}: ${CMD} advance <one of them>`];
  const n = [];
  for (const g of FLOWDATA.always) n.push(...GUARDS[g](s, to, why));
  if (to === FLOWDATA.escape && s.state !== FLOWDATA.escape) return n; // the user decides; no exit evidence is owed
  for (const g of [...(st.exit || []), ...((st.to || {})[to] || [])]) n.push(...GUARDS[g](s, to, why));
  if (PREVENT[s.state] && !FLOW[to].terminal) n.push(...GUARDS.prevented(s, to)); // the user may stop without one
  return [...new Set(n)];
}
function allowed(s, name, call) { // a command runs only in the states flow.json names for it, and a work command only after the state's prevent
  const where = FLOWDATA.commands[name];
  if (where && !where.includes(s.state)) die(`${name} belongs to ${where.join(' or ')}; this task is in ${s.state}: ${NEXT_HINT}`);
  const p = owed(s, name, call); if (p.length) die(`PREVENT first: ${name} in ${s.state} waits for ${p.join('; ')}`);
}
const STEPBACK = {
  small: () => `the step back: ${CMD} stepback small "<the whole, the cause, what to remove, the real property, the correction>"`,
  replan: () => `the loop-breakers' re-plan: ${CMD} call dueler (twice), then ${CMD} stepback replan DEFINE|EXPLORE "<the re-plan>"`,
  full: (id) => `loop-breaker ${id}'s full step back: ${CMD} stepback full --call ${id} "<its step back, from its reply>"`,
};
const BLOCK = (st, id) => id ? `loop-breaker ${id}'s one-block: ${CMD} block --call ${id} "<its one-block, from its reply>"` : `the one-block${st === 'ASK' ? ' of the new definition' : ''}: ${CMD} block "<${st === 'ASK' ? 'the new definition' : 'the next action'}, whole>"`;
const perCalls = (s, p) => Object.keys(s.calls).filter((id) => s.calls[id].role === p.per && s.calls[id].t >= s.entry.t);
const stepped = (s, p) => p.stepback === 'replan' ? s.entry.replan : s.entry.prevent;
function owed(s, name, call) { // flow.json's prevent row for this state: what is still owed before command `name` (null: the state's exit)
  const p = PREVENT[s.state], e = s.entry, draft = (p && p.draft || []).includes(name);
  if (!p || e.legacy || (name && !draft && !(p.before || []).includes(name))) return [];
  if (p.per) { // each loop-breaker's own prevent, recorded by the root from its reply: a record, not a witness
    const ids = perCalls(s, p), mine = ids.includes(call) ? [call] : ids;
    return mine.flatMap((id) => [...(s.calls[id].prevent ? [] : [STEPBACK[p.stepback](id)]), ...(p.block && !s.calls[id].block ? [BLOCK(s.state, id)] : [])]);
  }
  return [...(stepped(s, p) ? [] : [STEPBACK[p.stepback]()]), ...(p.block && !draft && !e.block ? [BLOCK(s.state)] : [])];
}
function gateRuns(s, sha, before) { // the release gate runs the product end to end and the full suite on the commit it certifies
  const ok = (k) => s.runs.some((r) => r.kind === k && r.code === 0 && r.sha === sha && (!before || r.t < before));
  const n = [];
  if (!ok('e2e')) n.push(`a passing end-to-end run on this commit: ${CMD} run --e2e -- <command>`);
  if (!ok('suite')) n.push(`a passing full suite on this commit: ${CMD} run --suite -- <command>`);
  if (n.length) die('the release gate needs, before its judges:\n- ' + n.join('\n- '));
}

// ── Judging, outcomes, the ladder ────────────────────────────────────────────────────────
function inside(cited, worktree) { // a cited file that exists inside the worktree; delimiters around the path are ignored
  const token = (cited || '').trim().split(/\s/)[0].replace(/^[`'"(<\[]+|[`'"),;:.>\]]+$/g, '');
  if (!token) return false;
  const norm = (p) => { const r = fs.realpathSync.native(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  for (const base of [ROOT, worktree]) {
    const sp = path.resolve(base, token); if (!fs.existsSync(sp)) continue;
    const r = path.relative(norm(worktree), norm(sp));
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) return true;
  }
  return false;
}
function parseOut(file, ids, worktree, useIds) {
  if (!fs.existsSync(file)) return { incomplete: [`save the judge's reply verbatim as ${rel(file)}`], v: {}, rubricLines: [], fixes: [] };
  const v = {}, incomplete = [], rubricLines = [], fixes = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim().replace(/^[-*]\s*/, '').replace(/^`|`$/g, ''))) {
    let m = line.match(/^RUBRIC:\s*(.+)/); if (m) { rubricLines.push(m[1]); continue; }
    m = line.match(/^FIX:\s*(.+)/); if (m) { fixes.push(m[1]); continue; }
    const parts = line.split(' | ').map((p) => p.trim());
    if (!ids.includes(parts[0]) || !['MET', 'NOT_MET'].includes(parts[1])) continue;
    const val = (k) => { const p = parts.find((x) => x.startsWith(k + ':')); return p ? p.slice(k.length + 1).trim() : ''; };
    if (parts[1] === 'MET' && !(val('evidence') && val('counterfeit') && val('boundary'))) incomplete.push(`${parts[0]}: MET needs evidence, counterfeit and boundary`);
    if (parts[1] === 'NOT_MET' && !val('case')) incomplete.push(`${parts[0]}: NOT_MET needs case`);
    if (parts[1] === 'MET' && useIds.includes(parts[0].split('/').pop()) && !inside(val('session'), worktree)) incomplete.push(`${parts[0]}: a MET judged by use needs session: <the judge's own session record inside its worktree>`);
    v[parts[0]] = parts[1];
  }
  for (const id of ids) if (!v[id]) incomplete.push(`${id}: no verdict line`);
  return { v, incomplete, rubricLines, fixes };
}
const AFTER_PASS = { oneshot: 'LOOP', explore: 'LOOP', loop: 'GATE', merge: 'GATE', gate: 'ACCEPT' }; // one-shot → next-shot → release gate → the user
const RETRY = { oneshot: 'ONESHOT', explore: 'ONESHOT', loop: 'LOOP', merge: 'LOOP', gate: 'LOOP' }; // the next attempt on the small rung
function escalate(s, j) { // outcomes counted per rung since the last PASS or rung change; the nth of a kind moves the rung
  if (j.outcome === 'PASS') { s.rung = LADDER.pass; s.count = ZERO(); s.require = [AFTER_PASS[j.kind]]; return; }
  const from = s.rung; s.count[j.outcome]++;
  const [n, to] = LADDER[from][j.outcome]; if (s.count[j.outcome] >= n && to !== from) { s.rung = to; s.count = ZERO(); }
  if (s.rung !== 'small') s.require = [RUNGS[s.rung].state];
  else s.require = [['oneshot', 'explore'].includes(j.kind) && j.outcome === 'ADVANCED' ? 'LOOP' : RETRY[j.kind]]; // a sound base goes to the next-shot; an unsound one is shot again
  if (s.rung === 'redefine') s.ask = `${j.kind} ${j.outcome} at rung ${from}: ${s.targets.join(', ')}`;
}
function settle(s) { // the outcome, once every NOT_MET is settled
  const j = s.entry.judged;
  if (!j || j.outcome || (j.kind === 'explore' && !s.entry.winner) || Object.values(j.alleged).some((x) => x.status === undefined)) return;
  const st = (id) => j.alleged[id] && j.alleged[id].status;
  const est = j.scope.filter((id) => st(id) !== 'yes' && (j.met.includes(id) || st(id) === 'no')); // only a reproduced violation blocks; missing evidence stays open
  const regress = j.scope.filter((id) => s.est.includes(id) && st(id) === 'yes');
  const fresh = est.filter((id) => !s.est.includes(id)), failed = j.scope.filter((id) => !est.includes(id));
  const shot = ['oneshot', 'explore'].includes(j.kind), passed = shot ? coreIds().every((id) => est.includes(id)) : !failed.length; // a one-shot passes when every core criterion works; non-core may be partial
  j.established = est;
  j.outcome = regress.length ? 'REGRESSION' : passed ? 'PASS' : fresh.length ? 'ADVANCED' : 'STALLED';
  s.est = [...new Set([...s.est.filter((id) => !regress.includes(id)), ...est])];
  s.targets = failed;
  j.diff = diffSize(s.best || s.base, j.sha);
  if (['PASS', 'ADVANCED'].includes(j.outcome)) s.best = j.sha; // ratchet-climbing: BEST only moves forward
  if (j.kind === 'gate' && j.outcome === 'PASS') s.gateSha = j.sha;
  s.hard = true; // the first council ends the provisional rubric
  const from = s.rung; escalate(s, j); j.from = from; j.to = s.rung; s.history.push(j);
}
function blocked(s, why) { s.ask = 'BLOCKED: ' + why; s.rung = LADDER.blocked; s.count = ZERO(); s.require = [RUNGS[LADDER.blocked].state]; }

// ── Computed signals: information for the agent, never a block ───────────────────────────
function signals(s) {
  const out = [], H = s.history, fails = {};
  for (const h of H) for (const [id, x] of Object.entries(h.alleged)) if (x.status === 'yes') fails[id] = (fails[id] || 0) + 1;
  const again = Object.entries(fails).filter(([, n]) => n >= 2).map(([id, n]) => `${id} (${n}×)`);
  if (again.length) out.push(`the same criterion failing again: ${again.join(', ')} → step back on the class, not the instance`);
  const ret = [...new Set(H.flatMap((h) => Object.entries(h.alleged).filter(([id, x]) => x.status === 'yes' && H.some((p) => p.t < h.t && p.established.includes(id))).map(([id]) => id)))];
  if (ret.length) out.push(`a failure returning after it was established: ${ret.join(', ')} → the earlier fix did not hold; find the shared cause`);
  const L = H.filter((h) => ['loop', 'merge'].includes(h.kind)).slice(-2);
  if (L.length === 2 && L.every((h) => ['STALLED', 'REGRESSION'].includes(h.outcome)) && L[1].diff > L[0].diff) out.push(`a diff growing while nothing is established (${L[0].diff} → ${L[1].diff} lines) → remove before adding`);
  const last = H[H.length - 1];
  if (last && last.runFailed && last.established.length) out.push(`checks green while the real run fails: the last real run on ${last.sha.slice(0, 7)} exited non-zero, yet ${last.established.join(', ')} were established → re-check the evidence`);
  return out;
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────
function counts(s) {
  const C = rubric().crit, k = (t) => C.filter((c) => c.tag === t), e = (arr) => arr.filter((c) => s.est.includes(c.id)).length;
  return `CORE ${e(k('CORE'))}/${k('CORE').length} · NON-CORE ${e(k('NON-CORE'))}/${k('NON-CORE').length}`;
}
const levelLine = (s) => `rung ${s.rung} (${RUNGS[s.rung].says}; here: ADVANCED ${s.count.ADVANCED}/${LADDER[s.rung].ADVANCED[0]}, STALLED ${s.count.STALLED}/${LADDER[s.rung].STALLED[0]}, REGRESSION ${s.count.REGRESSION}/${LADDER[s.rung].REGRESSION[0]})`;
const nextLines = (s) => FLOW[s.state].next.map((t) => { const x = needs(s, t); return `- ${t}: ${x.length ? 'needs ' + x.join('; ') : 'ready'}`; });
function board(s) {
  const R = rubric(), blk = (s.blocks || []).slice(-1)[0];
  return [`# cLoop board (rendered by cloop.mjs; do not edit)`, '',
    `## Task`, `${s.route} — ${s.reason} | cl/${s.slug} | state ${s.state} | ${levelLine(s)} | rubric ${s.frozen ? s.frozen.slice(0, 12) + (s.hard ? ' (frozen)' : ' (provisional)') : 'not frozen'}${storeLine() ? ' | ' + storeLine() : ''}`, '',
    `## BEST`, `${s.best ? s.best.slice(0, 7) : 'none'} | ${counts(s)}`, '',
    `## Next action`, ...(blk ? [`(${blk.state}, ${blk.t.slice(0, 16)})`, blk.text] : ['none yet: the one-block after the step back']), '',
    `## Criteria`, ...R.crit.map((c) => `- ${c.id} ${c.tag}${c.use ? ' (use)' : ''}: ${s.est.includes(c.id) ? 'established' : 'open'}`), '',
    `## Judgings`, ...s.history.map((h) => `- ${h.t.slice(11, 19)} ${h.kind} @${(h.sha || '').slice(0, 7)} → ${h.outcome} (${h.established.length}/${h.scope.length}), rung ${h.from} → ${h.to}`), '',
    `## Signals (computed)`, ...signals(s).map((x) => '- ' + x), '',
    `## Step backs`, ...s.stepbacks.map((x) => `- ${x.size}${x.choice ? ' → ' + x.choice : ''}${x.targets ? ' [' + x.targets.join(',') + ']' : ''}: ${x.text.slice(0, 160)}`), '',
    `## Open`, ...(s.ask ? [`- re-define with the user: ${s.ask}`] : []), ...s.proposals.map((p, i) => `- rubric proposal ${i}: ${p.text}${p.resolved ? ' (resolved: ' + p.resolved + ')' : ''}`), '',
    `## Vetoes`, ...s.vetoes.map((v) => '- ' + v), '', `## Backlog`, ...s.backlog.map((v) => '- ' + v), '', `## Notes`, ...s.notes.map((v) => '- ' + v), '',
    `## Next`, ...nextLines(s), ''].join('\n');
}
function report(s, final) {
  const j = s.history[s.history.length - 1], o = open(s);
  const ready = FLOW[s.state].next.find((t) => !needs(s, t).length);
  const out = [`Last: ${j ? j.outcome + ' (' + j.kind + ')' : 'no judging yet'} — ${levelLine(s)} — ${s.state} — ${counts(s)} — open: ${o.join(', ') || 'none'} — next: ${FLOW[s.state].terminal ? 'end' : ready || needs(s, (s.require || FLOW[s.state].next)[0]).join('; ')}`];
  if (j) {
    const blocks = Object.entries(j.alleged).filter(([, x]) => x.status === 'yes').map(([id]) => id);
    const notes = [...Object.entries(j.alleged).filter(([, x]) => x.status !== 'yes').map(([id, x]) => `${id} ${x.status === 'missing' ? 'not decided (missing run)' : 'unconfirmed'}`), ...s.proposals.filter((p) => !p.resolved).map((p) => 'rubric proposal: ' + p.text)];
    if (blocks.length) out.push('Blocks: ' + blocks.join(', ')); if (notes.length) out.push('Does not block: ' + notes.join('; '));
  }
  const sig = signals(s); if (sig.length) out.push('Signals (computed): ' + sig.join('; '));
  if (final) {
    out.push(`Delivered: cl/${s.slug} at ${head().slice(0, 7)}.`, ...(s.vetoes.length ? ['Vetoes: ' + s.vetoes.join('; ')] : []), ...(s.backlog.length ? ['Backlog: ' + s.backlog.join('; ')] : []));
    out.push(fs.existsSync(STORE) ? `Where the work is: the files on disk are the result; your own .git sees them as uncommitted changes; the task's commits are in cloop/git (${CMD} git log).` : `Where the work is: branch cl/${s.slug} in your repository.`);
  }
  return out.join('\n');
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────
const freshEntry = (failing = []) => ({ t: now(), failing, runs: [], judged: null, prevent: null, block: null, finalReport: false, winner: null, winnerT: null, answer: null, replan: null, approved: null, duelers: [], fixes: [] });
const [cmd, ...a] = process.argv.slice(2);
const flag = (f) => { const i = a.indexOf(f); if (i < 0) return false; a.splice(i, 1); return true; };
const opt = (f) => { const i = a.indexOf(f); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
const text = (what) => { const t = a.join(' ').trim(); if (!t) die(`write ${what} (in quotes after the command)`); return t; };

const C = {
  init() {
    const [route, slug, ...why] = a;
    if (!['FOCUSED', 'FULL'].includes(route) || !slug) die('init <FOCUSED|FULL> <slug> "<reason>" (DIRECT uses no tool)');
    if (fs.existsSync(F.state)) die(`a task exists here: ${NEXT_HINT}`);
    fs.mkdirSync(DIR, { recursive: true });
    const existing = !git(['rev-parse', '--verify', 'HEAD']).code && git(['ls-files']).out.split('\n').filter((f) => f && product(f)).length > 0;
    const refused = fs.existsSync(STORE) ? '' : gitProbe(slug);
    if (refused) { // the task's own repository: a clone that keeps the checkout's HEAD (its branch, a linked worktree's branch or a detached commit), with the files on disk as its working tree
      const history = !git(['rev-parse', '--verify', 'HEAD']).code;
      const r = history ? git(['clone', '--bare', '--no-hardlinks', '-q', ROOT, STORE], ROOT) : git(['init', '--bare', '-b', 'main', STORE], ROOT);
      if (r.code) die(`.git refuses the writes the method makes (${refused}), and cloop/git could not be created:\n${r.out}`);
      git(['config', 'core.bare', 'false']); git(['remote', 'remove', 'origin']); // nothing in the store can push to the user's repository
      if (history) git(['reset', '-q']);
      const again = gitProbe(slug);
      if (again) { fs.rmSync(STORE, { recursive: true, force: true }); die(`git refuses the writes the method makes, in .git (${refused}) and in cloop/git (${again}); cloop/git was removed and the task folder kept: free the writes, then init again`); }
      console.log(`.git refuses the writes the method makes here (${refused}): the repository lives in cloop/git${history ? ', with its history' : ''} (run git through ${CMD} git <args>)`);
    }
    const ex = path.resolve(ROOT, git(['rev-parse', '--git-dir']).out.trim(), 'info', 'exclude'); fs.mkdirSync(path.dirname(ex), { recursive: true });
    const have = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8').split('\n') : [];
    fs.appendFileSync(ex, ['cloop/*', '!cloop/rubric.md', '!cloop/spec.md', '!cloop/architecture.md', 'temporary/', '.cloop/'].filter((w) => !have.includes(w)).map((w) => w + '\n').join(''));
    if (git(['rev-parse', '--verify', 'HEAD']).code) { const c = git(['commit', '--allow-empty', '-m', 'cLoop baseline']); if (c.code) die(`the baseline commit failed:\n${c.out}`); }
    const co = git(['checkout', '-q', '-B', 'cl/' + slug]); if (co.code) die(`the task branch could not be checked out:\n${co.out}`);
    const dirtyAtInit = dirty(); // what was there before the task is not its candidate
    const s = { version: VERSION, route, slug, reason: why.join(' '), state: FLOWDATA.start[existing ? 'existing' : 'new'], baselineCount: fs.existsSync(F.rubric) ? rubric().crit.length : 0, entry: freshEntry(), adopt: null, frozen: null, hard: false, frozenSet: null, est: [], targets: [], rung: 'small', count: ZERO(), require: null, ask: null, proposals: [], stepbacks: [], blocks: [], history: [], vetoes: [], backlog: [], notes: [], calls: {}, runs: [], base: head(), best: null, gateSha: null, snap: null, dirtyAtInit };
    save(s, { ev: 'init', route, slug, existing }); console.log(`CLOOP: ${route} — ${s.reason}`); C.status();
  },
  status() {
    const s = load(), R = rubric(), T = FLOW[s.state];
    console.log(`STATE ${s.state} · ${s.route} · ${counts(s)} · ${levelLine(s)} · BEST ${(s.best || 'none').slice(0, 7)}${storeLine() ? ' · ' + storeLine() : ''}\n\nCARDS\n${cardText({ state: s.state, role: 'root' })}`);
    if (T.terminal) return;
    if (s.ask) console.log(`\nRE-DEFINE WITH THE USER (${s.ask})`);
    if (['LOOP', 'DUEL'].includes(s.state) && s.targets.length) console.log('\nFAILING (the next-shot repairs them; the council judges every criterion)\n' + R.crit.filter((c) => s.targets.includes(c.id)).map((c) => c.raw).join('\n'));
    if (s.state === 'DEFINE' && s.route === 'FULL') console.log('\nEXPLORE TRIGGERS\n' + Object.entries(EXPLORE_TRIGGERS).map(([k, v]) => `- ${k}: ${v}`).join('\n'));
    if (R.warnings.length) console.log('\nRUBRIC WARNINGS\n- ' + R.warnings.join('\n- '));
    const j = s.entry.judged; if (j && !j.outcome && j.alleged) { const ids = Object.keys(j.alleged).filter((id) => j.alleged[id].status === undefined); if (ids.length) console.log('\nSETTLE before the outcome counts: ' + ids.map((id) => `reproduce ${id} yes|no -- <command> | reproduce ${id} missing "<why>"`).join(' ; ')); }
    if (s.entry.fixes.length) console.log('\nCOUNCIL FIX SUGGESTIONS (advice for your next step back, not obligations)\n- ' + s.entry.fixes.join('\n- '));
    const sig = signals(s); if (sig.length) console.log('\nSIGNALS (computed; information, never a block)\n- ' + sig.join('\n- '));
    console.log('\nNEXT\n' + nextLines(s).join('\n'));
  },
  advance() {
    const s = load(), why = opt('--why'), to = a[0]; if (!FLOW[to]) die(`unknown state ${to || ''}; ${s.state} goes to ${FLOW[s.state].next.join(', ')}: ${CMD} advance <one of them>`);
    const x = needs(s, to, why); if (x.length) die(`${s.state} → ${to} needs:\n- ` + x.join('\n- '));
    if (s.state === 'ASK') { s.ask = null; if (to !== 'STOPPED') s.count = ZERO(); }
    if (s.state === 'DEFINE' && s.rung === 'redefine') s.targets = open(s); // the re-defined rubric's open criteria
    if (to === 'DONE' && (s.vetoes.length || s.backlog.length)) {
      let t = fs.readFileSync(F.rubric, 'utf8').trimEnd();
      if (s.vetoes.length) t += '\n\n## Vetoes\n' + s.vetoes.map((v) => '- ' + v).join('\n');
      if (s.backlog.length) t += '\n\n## Backlog\n' + s.backlog.map((v) => '- ' + v).join('\n');
      fs.writeFileSync(F.rubric, t + '\n'); git(['add', 'cloop/rubric.md']); git(['commit', '-q', '-m', 'Record vetoes and backlog']);
      const files = git(['diff', '--name-only', s.gateSha, 'HEAD']).out.trim().split('\n').filter(Boolean);
      if (files.some((f) => f !== 'cloop/rubric.md') || rubric().hash !== s.frozen) die(`the delivery commit changes more than the rubric's vetoes and backlog (${files.join(', ')}): ${CMD} git reset --hard ${(s.gateSha || '').slice(0, 7)}, then advance DONE again`);
    }
    if (to === 'EXPLORE' && EXPLORE_TRIGGERS[why]) s.notes.push(`EXPLORE trigger: ${why} — ${EXPLORE_TRIGGERS[why]}`);
    const carry = (PREVENT[s.state] || {}).carries && s.entry.approved && !FLOW[to].terminal ? { t: now(), carried: s.state } : null; // the approved re-plan and its one-block are the next state's prevent
    s.require = null; s.state = to; s.entry = freshEntry([...s.targets]); if (carry) { s.entry.prevent = carry; s.entry.block = carry; }
    save(s, { ev: 'advance', to, why }); C.status(); // what fails when a step starts is what it must see failing first
  },
  adopt() { const s = load(), d = a.shift(); allowed(s, 'adopt'); if (!['keep', 'simplify', 'replace'].includes(d)) die('adopt keep|simplify|replace "<what exists, what works on the baseline, the protected checks, the user\'s answer>"'); s.adopt = d; save(s, { ev: 'adopt', decision: d, reason: text("what exists and the user's answer") }); console.log('adoption: ' + d); },
  freeze() {
    const s = load(), user = opt('--user'); allowed(s, 'freeze');
    const R = rubric(); if (R.errors.length) die('fix the rubric first (cloop/rubric.md), then freeze:\n- ' + R.errors.join('\n- '));
    if (s.frozenSet && R.hash !== s.frozen) {
      const removed = s.frozenSet.ids.filter((id) => !R.crit.some((c) => c.id === id)), goals = R.goals.map((g) => g.raw).join('\n') !== s.frozenSet.goals;
      const why = [...(s.hard ? ['the rubric is frozen hard'] : []), ...(removed.length ? [`removed: ${removed.join(', ')}`] : []), ...(goals ? ['the goals changed'] : [])];
      if (why.length && !(user || '').trim()) die(`this change is the user's (${why.join('; ')}): ask them, then ${CMD} freeze --user "<their words>"`);
    }
    s.frozen = R.hash; s.frozenSet = { ids: R.crit.map((c) => c.id), goals: R.goals.map((g) => g.raw).join('\n') };
    git(['add', 'cloop/rubric.md']); git(['commit', '-q', '-m', 'Freeze rubric']);
    save(s, { ev: 'freeze', hash: R.hash, hard: s.hard, user }); console.log(`frozen ${R.hash.slice(0, 12)} (${s.hard ? 'hard' : 'provisional until the first council'})` + (R.warnings.length ? '\nwarnings:\n- ' + R.warnings.join('\n- ') : ''));
  },
  run() {
    const s = load(), kind = flag('--e2e') ? 'e2e' : flag('--suite') ? 'suite' : flag('--before') ? 'before' : 'run', judgment = flag('--judgment'), cwd = opt('--cwd');
    const at = cwd && Object.keys(s.calls).find((id) => s.calls[id].worktree === path.resolve(ROOT, cwd));
    allowed(s, kind === 'run' ? 'run' : 'run --' + kind, at);
    if (a[0] === '--') a.shift(); const command = a.join(' '); if (!command) die('run [--e2e|--suite|--before [--judgment]] [--cwd <dir>] -- <command>');
    const dir = cwd ? path.resolve(ROOT, cwd) : ROOT, t0 = Date.now(), r = sh(command, [], { cwd: dir, shell: true, timeout: 3 * 3600e3 });
    const rec = { kind, command, cwd: cwd ? dir : null, code: r.code, sha: head(cwd ? dir : undefined), secs: Math.round((Date.now() - t0) / 100) / 10, t: now(), tail: r.out.split('\n').slice(-12).join('\n'), judgment };
    s.entry.runs.push(rec); s.runs.push(rec); save(s, { ev: 'run', ...rec });
    process.stdout.write(r.out); console.log(`\n[cloop] ${kind} exit ${r.code} on ${rec.sha.slice(0, 7)} in ${rec.secs}s`);
  },
  call() {
    const s = load(), role = a[0], at = opt('--at');
    if (!ROLES.includes(role)) die(`call ${ROLES.join('|')} [--at <commit>]`);
    allowed(s, 'call ' + role);
    if (role === 'judge') {
      const d = dirty(s); if (d.length) die(`judges review HEAD: commit the candidate first (${CMD} git add -A && ${CMD} git commit -m "<what>"); a file that is not part of the product goes in the repository's info/exclude (uncommitted: ${d.slice(0, 3).join(', ')})`);
      if (s.state === 'GATE') gateRuns(s, head());
    }
    if (role === 'dueler' && s.state === 'DUEL') { const x = GUARDS.somethingToFix(s); if (x.length) die(x[0]); }
    const commit = at || (['judge', 'member'].includes(role) ? head() : s.best || head()), id = crypto.randomBytes(4).toString('hex');
    const run = path.join(DIR, 'runs', id), wt = path.join(DIR, 'wt', id); fs.mkdirSync(run, { recursive: true });
    const r = git(['worktree', 'add', '-q', '-b', 'cl/' + id, wt, commit]); if (r.code) die(`the worktree could not be created:\n${r.out}`);
    if (role === 'judge' && !s.snap) s.snap = snapshot();
    if (role === 'dueler') s.entry.duelers.push(id);
    const extra = role === 'dueler' ? ['step-back', 'one-block'].filter((c) => CARDS[c]).map((c) => CARDS[c].body) : []; // the loop-breaker takes the same prevent
    const blk = (s.blocks || []).slice(-1)[0], handoff = ['dynamic', 'mechanical'].includes(role) && blk ? `\n## The one-block this build is part of\n${blk.text}\n` : '';
    fs.writeFileSync(path.join(run, 'packet.md'), `${[cardText({ state: s.state, role }), ...extra].join('\n\n')}\n${handoff}\n## This call\n- call: ${id} (${role})\n- commit: ${commit}\n- worktree: ${rel(wt)}${role === 'judge' ? ' (read-only: write nothing outside it)' : ` (commit your work there, on branch cl/${id})`}\n\n## The assignment\n`);
    s.calls[id] = { role, commit, t: now(), worktree: wt }; save(s, { ev: 'call', id, role, commit });
    console.log(`call ${id} (${role}) at ${commit.slice(0, 7)}\npacket: ${rel(run)}/packet.md (its card is written; append the assignment)\nreturn: ${rel(run)}/out.md (the reply, verbatim)\nworktree: ${rel(wt)}`);
  },
  judge() {
    const s = load(), options = (opt('--options') || '').split(',').filter(Boolean), [kind, idA, idB] = a, e = s.entry;
    if (!['explore', 'oneshot', 'loop', 'merge', 'gate'].includes(kind) || !idA || !idB) die('judge <explore|oneshot|loop|merge|gate> <callA> <callB> [--options a,b,c]');
    allowed(s, 'judge ' + kind);
    if (e.judged && e.judged.outcome) die(`this entry is judged (${e.judged.outcome}): follow the outcome; ${NEXT_HINT}`);
    if (e.judged && !(kind === 'merge' && e.judged.amalgam && !e.judged.met.length)) die(`settle the open judging first: ${CMD} reproduce <ID> yes|no -- <command>`);
    if (kind === 'merge' && s.state === 'EXPLORE' && !(e.judged && e.judged.amalgam)) die(`judge merge in EXPLORE follows an amalgam: ${CMD} winner <a>,<b>`);
    if (kind === 'merge' && s.state === 'DUEL') {
      if (e.duelers.length < 2) die(`two loop-breakers first: ${CMD} call dueler (twice)`);
      for (const d of e.duelers) if (!e.runs.some((r) => r.cwd === s.calls[d].worktree)) die(`run loop-breaker ${d}'s result yourself: ${CMD} run --cwd ${rel(s.calls[d].worktree)} -- <command>`);
      const last = Math.max(...e.runs.filter((r) => r.cwd).map((r) => Date.parse(r.t)));
      if (!e.runs.some((r) => !r.cwd && r.code === 0 && Date.parse(r.t) > last)) die(`run the merged product on HEAD: ${CMD} run -- <command>`);
    }
    for (const id of [idA, idB]) if (!s.calls[id] || s.calls[id].role !== 'judge') die(`${id} is not a judge call: ${CMD} call judge`);
    if (idA === idB) die(`two different judges: ${CMD} call judge, twice`);
    if (!s.snap) die(`start the judge calls with ${CMD} call judge`);
    const before = s.snap, after = snapshot(); s.snap = null;
    if (!sameTree(before, after)) { save(s, { ev: 'judge-void', kind }); die(`the repository changed during the calls: both are void; ${CMD} redispatch <id> for each, with the same packets, then judge again`); }
    if (kind === 'gate') gateRuns(s, before.head, before.t);
    const scope = allIds(); // the council judges every criterion, at every step
    if (!scope.length) die(`the rubric has no criteria: ${NEXT_HINT}`);
    if (kind === 'explore' && options.length < 2) die('judge explore needs --options with at least two aliases');
    const ids = kind === 'explore' ? options.flatMap((o) => scope.map((c) => `${o}/${c}`)) : scope, useIds = rubric().crit.filter((c) => c.use).map((c) => c.id);
    const res = [idA, idB].map((id) => ({ id, ...parseOut(path.join(DIR, 'runs', id, 'out.md'), ids, s.calls[id].worktree, useIds) })), bad = res.filter((r) => r.incomplete.length);
    if (bad.length) {
      const twice = bad.filter((r) => s.calls[r.id].redispatched); if (twice.length) blocked(s, `judge ${twice.map((r) => r.id).join(', ')} incomplete after its re-dispatch`);
      save(s, { ev: 'judge-incomplete', calls: bad.map((r) => r.id) });
      die(bad.map((r) => `${r.id} incomplete:\n  - ${r.incomplete.join('\n  - ')}`).join('\n') + (s.ask ? `\n${s.ask}: ${CMD} advance ASK` : `\n${CMD} redispatch <id> once with the same packet, then judge again`));
    }
    for (const r of res) { for (const p of r.rubricLines) if (!s.proposals.some((x) => x.text === p && !x.resolved)) s.proposals.push({ text: p, resolved: null }); for (const f of r.fixes) if (!e.fixes.includes(f)) e.fixes.push(f); }
    const met = ids.filter((id) => res.some((r) => r.v[id] === 'MET')), alleged = {};
    for (const r of res) for (const id of ids) if (r.v[id] === 'NOT_MET') alleged[id] = {};
    const lastRun = e.runs.filter((r) => !r.cwd && ['run', 'e2e'].includes(r.kind) && r.sha === before.head).pop(), runFailed = !!lastRun && lastRun.code !== 0;
    if (kind === 'explore') { // eligibility is computed; the choice is judged
      const core = coreIds(), good = (o, c) => met.includes(`${o}/${c}`) && !alleged[`${o}/${c}`];
      const rank = options.map((o) => ({ o, core: core.filter((c) => good(o, c)).length, all: scope.filter((c) => good(o, c)).length }));
      const full = rank.filter((r) => r.core === core.length).map((r) => r.o), eligible = full.length ? full : options;
      e.judged = { kind, sha: before.head, scope, options, rank, eligible, met, alleged, runFailed, t: now(), outcome: null, established: [] };
      save(s, { ev: 'judge', kind, rank, eligible });
      return console.log('OPTIONS (information; the choice is yours, by the merge card)\n' + rank.map((r) => `- ${r.o}: CORE ${r.core}/${core.length}, all ${r.all}/${scope.length}${eligible.includes(r.o) ? ' — eligible' : ''}`).join('\n') + `\n${full.length ? '' : 'No option establishes every CORE criterion: all are eligible.\n'}${CMD} winner <alias>, or winner <a>,<b> for an amalgam (judged again)`);
    }
    e.judged = { kind, sha: before.head, scope, met, alleged, runFailed, t: now(), outcome: null, established: [] }; settle(s);
    save(s, { ev: 'judge', kind, met, alleged: Object.keys(alleged), outcome: e.judged.outcome }); C.status();
  },
  winner() {
    const s = load(), picks = (a[0] || '').split(',').filter(Boolean), j = s.entry.judged; allowed(s, 'winner');
    if (!j || j.kind !== 'explore' || !j.options || s.entry.winner) die(`winner follows judge explore, once: ${NEXT_HINT}`);
    if (!picks.length) die('winner <alias> | winner <a>,<b> (an amalgam, judged again)');
    for (const o of picks) if (!j.eligible.includes(o)) die(`${o} is not eligible (eligible: ${j.eligible.join(', ')}): an option that misses a CORE criterion another option establishes is out; ${CMD} winner <an eligible alias>`);
    for (const r of j.rank) if (!picks.includes(r.o)) s.vetoes.push(`explored option ${r.o}: CORE ${r.core}, all ${r.all}/${j.scope.length}`);
    s.entry.winner = picks.join(','); s.entry.winnerT = now();
    if (picks.length > 1) { s.entry.judged = { kind: 'explore', amalgam: true, scope: j.scope, alleged: {}, met: [], outcome: null, established: [], t: now() }; save(s, { ev: 'winner', options: picks }); return console.log(`amalgam: integrate it, run it on HEAD, then ${CMD} call judge (twice) and judge merge`); }
    j.met = j.scope.filter((c) => j.met.includes(`${picks[0]}/${c}`)); j.alleged = Object.fromEntries(j.scope.filter((c) => j.alleged[`${picks[0]}/${c}`]).map((c) => [c, {}]));
    settle(s); save(s, { ev: 'winner', options: picks }); C.status();
  },
  redispatch() {
    const s = load(), id = a[0]; allowed(s, 'redispatch'); if (!s.calls[id]) die(`unknown call ${id || ''}: ${NEXT_HINT}`); if (s.calls[id].redispatched) die(`a call is re-dispatched once; a second failure is BLOCKED: ${CMD} blocked "<what failed>"`);
    s.calls[id].redispatched = true;
    const wt = s.calls[id].worktree; git(['reset', '-q', '--hard', s.calls[id].commit], wt); git(['clean', '-qfdx'], wt); // the retry starts blind, as the first call did
    fs.rmSync(path.join(DIR, 'runs', id, 'out.md'), { force: true });
    if (!s.snap && s.calls[id].role === 'judge') s.snap = snapshot(); save(s, { ev: 'redispatch', id }); console.log(`re-dispatch ${id} with the same packet; save its reply as ${rel(path.join(DIR, 'runs', id, 'out.md'))}`);
  },
  reproduce() { // the engine runs the reproduction itself, so the verdict rests on a witnessed run, not on a report of one
    const s = load(), id = a.shift(), st = a.shift(), judgment = flag('--judgment'), j = s.entry.judged; allowed(s, 'reproduce');
    if (!j || !j.alleged[id] || j.alleged[id].status !== undefined) die(`no open NOT_MET ${id || ''} to settle: ${NEXT_HINT}`);
    if (!['yes', 'no', 'missing'].includes(st)) die(`reproduce ${id} yes|no [--judgment] -- <command> (the engine runs it: yes needs it to fail, no to pass) | reproduce ${id} missing "<the run that could not be made, and why>" (the criterion stays open, not a defect)`);
    let evidence;
    if (st === 'missing') evidence = text('the run that could not be made, and why');
    else {
      if (a[0] === '--') a.shift(); const command = a.join(' '); if (!command) die(`reproduce ${id} ${st} [--judgment] -- <the command that decides it>`);
      const r = sh(command, [], { shell: true, timeout: 3 * 3600e3 }), ok = st === 'yes' ? r.code !== 0 : r.code === 0;
      const rec = { kind: 'reproduce', id, command, code: r.code, sha: head(), t: now(), tail: r.out.split('\n').slice(-12).join('\n'), judgment };
      s.entry.runs.push(rec); s.runs.push(rec); process.stdout.write(r.out);
      if (!ok && !judgment) { save(s, { ev: 'run', ...rec }); die(`the run exited ${r.code}, which does not show "${st}": ${st === 'yes' ? 'a violation fails the command' : 'a holding criterion passes it'}; settle with the right verdict (${CMD} reproduce ${id} ${st === 'yes' ? 'no' : 'yes'} -- <command>), or add --judgment when the evidence is the real output rather than the exit code`); }
      evidence = `${command} → exit ${r.code}${judgment ? ' (judged on its output)' : ''}: ${rec.tail.slice(-200)}`;
    }
    j.alleged[id].status = st; j.alleged[id].evidence = evidence;
    settle(s); save(s, { ev: 'reproduce', id, status: st, evidence }); C.status();
  },
  stepback() {
    const s = load(), size = a.shift(), targets = (opt('--targets') || '').split(',').filter(Boolean), call = opt('--call'), known = allIds(), p = PREVENT[s.state] || {};
    if (!['small', 'full', 'replan'].includes(size)) die('stepback small [--targets <IDs>] "<the step back>" | stepback full --call <id> "<the loop-breaker\'s step back, from its reply>" | stepback replan DEFINE|EXPLORE "<the re-plan>"');
    allowed(s, 'stepback ' + size);
    for (const t of targets) if (!known.includes(t)) die(`unknown criterion ${t}; the rubric has ${known.join(', ')}`);
    const then = p.block ? `; now ${BLOCK(s.state, call)}` : '';
    if (size === 'full') { // the root records the loop-breaker's own step back from its reply
      if (!perCalls(s, p).includes(call)) die(`stepback full records a loop-breaker's step back against its call: ${CMD} stepback full --call <${perCalls(s, p).join('|') || 'a dueler call'}> "<its step back, from its reply>"`);
      if (!fs.existsSync(path.join(DIR, 'runs', call, 'out.md'))) die(`the record comes from the loop-breaker's reply: save it verbatim as ${rel(path.join(DIR, 'runs', call, 'out.md'))}, then ${CMD} stepback full --call ${call} "<its step back>"`);
      const t = text("the loop-breaker's step back, as its reply states it"); s.calls[call].prevent = { t: now() };
      s.stepbacks.push({ size, state: s.state, call, targets: s.targets, text: t, t: now() }); save(s, { ev: 'stepback', size, call, text: t });
      return console.log(`loop-breaker ${call}'s step back recorded${then}`);
    }
    if (size === 'small') {
      const t = text('the step back: the whole, the class and root cause, what to remove, the real property, the one correction'); s.entry.prevent = { t: now(), targets: targets.length ? targets : null };
      s.stepbacks.push({ size, state: s.state, targets: s.entry.prevent.targets, text: t, t: now() }); save(s, { ev: 'stepback', size, targets, text: t });
      return console.log(`step back recorded${then}`);
    }
    const choice = a.shift();
    if (!s.entry.answer) die(`the re-plan follows the user's comment: ${CMD} answer "<their words>"`);
    if (!['DEFINE', 'EXPLORE'].includes(choice)) die('stepback replan DEFINE|EXPLORE "<the re-plan>"');
    if (choice === 'EXPLORE' && s.route !== 'FULL') die(`a FOCUSED task never explores: ${CMD} stepback replan DEFINE "<the re-plan>"`);
    if (s.entry.duelers.length < 2) die(`two loop-breakers take the full step back with the user's comment first: ${CMD} call dueler (twice)`);
    const t = text('the re-plan: the step at fault, what changes, what is removed'); s.entry.replan = { choice, text: t, t: now() }; s.entry.approved = null;
    s.stepbacks.push({ size, choice, targets: targets.length ? targets : s.targets, text: t, t: now() }); save(s, { ev: 'stepback', size, choice, text: t });
    console.log(`re-plan recorded (${choice})${then}; show both to the user (the ask card), then: ${CMD} approve "<their yes>", or ${CMD} answer "<their new comment>"`);
  },
  block() { // the second half of a prevent: the next action written whole on the board before it is taken
    const s = load(), file = opt('--file'), call = opt('--call'), e = s.entry, p = PREVENT[s.state] || {}; allowed(s, 'block');
    const rec = p.per ? perCalls(s, p).includes(call) && s.calls[call] : e; // in the duel each loop-breaker's one-block is its own, recorded against its call
    if (!rec) die(`in the ${s.state.toLowerCase()} each loop-breaker's one-block is recorded against its call: ${CMD} block --call <${perCalls(s, p).join('|') || 'a dueler call'}> "<its one-block, from its reply>"`);
    if (!(p.per ? rec.prevent : stepped(s, p))) die(`the step back comes first, then the one-block: ${STEPBACK[p.stepback](call)}`);
    if (rec.block) die(`this step has its one-block: ${NEXT_HINT}`);
    if (file && !fs.existsSync(path.resolve(ROOT, file))) die(`no file ${file}: ${CMD} block --file <path> | ${BLOCK(s.state, call)}`);
    const t = file ? fs.readFileSync(path.resolve(ROOT, file), 'utf8').trim() : text('the next action, whole (the one-block card)');
    if (!t) die(`the one-block is empty: ${BLOCK(s.state, call)}`);
    rec.block = { t: now() }; s.blocks.push({ state: s.state, ...(call ? { call } : {}), text: t, t: now() }); save(s, { ev: 'block', ...(call ? { call } : {}), text: t }); console.log('one-block recorded on the board (## Next action)');
  },
  approve() { const s = load(); allowed(s, 'approve'); if (!s.entry.replan) die(`approve follows the re-plan: ${CMD} stepback replan DEFINE|EXPLORE "<the re-plan>"`); const t = text("the user's words"); s.entry.approved = { t: now(), text: t }; save(s, { ev: 'approve', text: t }); console.log(`the user approved the re-plan: ${CMD} advance ${s.entry.replan.choice}`); },
  blocked() { const s = load(); allowed(s, 'blocked'); const t = text('what blocks the work'); blocked(s, t); save(s, { ev: 'blocked', text: t }); console.log(`blocked: ${CMD} advance ASK, and re-define with the user`); },
  answer() { // the user's words; a new comment at ASK restarts the re-plan
    const s = load(); allowed(s, 'answer'); const t = text("the user's words");
    if (s.state === 'ASK' && s.entry.replan) { s.entry.replan = null; s.entry.block = null; s.entry.approved = null; s.entry.duelers = []; }
    s.entry.answer = t; save(s, { ev: 'answer', text: t }); console.log('answer recorded');
  },
  resolve() { const s = load(), [i, ...how] = a, p = s.proposals[+i]; if (!p || !how.join(' ').trim()) die('resolve <n> "<applied in DEFINE | dismissed: reason>"'); p.resolved = how.join(' '); save(s, { ev: 'resolve', i }); console.log('resolved'); },
  veto() { const s = load(); s.vetoes.push(text('the option and why it is vetoed')); save(s, { ev: 'veto', text: a.join(' ') }); console.log('veto recorded'); },
  backlog() { const s = load(); s.backlog.push(text('the backlog item')); save(s, { ev: 'backlog', text: a.join(' ') }); console.log('backlog recorded'); },
  note() { const s = load(); s.notes.push(text('the note')); save(s, { ev: 'note', text: a.join(' ') }); console.log('note recorded'); },
  report() { const s = load(), final = flag('--final'); if (final) { allowed(s, 'report --final'); s.entry.finalReport = true; save(s, { ev: 'report', final }); } console.log(report(s, final)); },
  clean() {
    const force = flag('--force'), s = force && fs.existsSync(F.state) ? JSON.parse(fs.readFileSync(F.state, 'utf8')) : load();
    if (!force) allowed(s, 'clean');
    for (const id of Object.keys(s.calls || {})) { git(['worktree', 'remove', '--force', s.calls[id].worktree]); git(['branch', '-q', '-D', 'cl/' + id]); }
    for (const d of [path.join(DIR, 'runs'), path.join(DIR, 'wt'), path.join(ROOT, 'temporary')]) fs.rmSync(d, { recursive: true, force: true });
    if (force) { fs.rmSync(F.state, { force: true }); return console.log('task removed; the rubric, spec, architecture, log and board are kept'); }
    save(s, { ev: 'clean' }); console.log('task files removed; rubric, spec, architecture, state, log and board kept');
  },
  git() { const r = git(a); process.stdout.write(r.out); process.exit(r.code); },
  check() { // flow and cards: every state reachable and able to end, every guard and command known, every binding resolved, every card bound
    const errs = [], states = Object.keys(FLOW);
    for (const [k, v] of Object.entries(FLOW)) {
      for (const t of v.next) if (!FLOW[t]) errs.push(`${k} → ${t}: unknown state`);
      for (const g of [...(v.exit || []), ...Object.values(v.to || {}).flat()]) if (!GUARDS[g]) errs.push(`${k}: unknown guard ${g}`);
      for (const t of Object.keys(v.to || {})) if (!v.next.includes(t)) errs.push(`${k}: guards for ${t}, which is not in next`);
    }
    for (const g of FLOWDATA.always) if (!GUARDS[g]) errs.push(`always: unknown guard ${g}`);
    for (const [k, p] of Object.entries(PREVENT)) { // each row names commands of its state, and the commands that record its prevent
      if (!FLOW[k] || FLOW[k].terminal) { errs.push(`prevent ${k}: not a working state`); continue; }
      for (const c of ['stepback ' + p.stepback, ...(p.block ? ['block'] : [])]) if (!(FLOWDATA.commands[c] || []).includes(k)) errs.push(`prevent ${k}: ${c} is not a command of ${k}`);
      for (const c of [...(p.before || []), ...(p.draft || [])]) { const w = FLOWDATA.commands[c]; if (!C[c.split(' ')[0]] || (w && !w.includes(k))) errs.push(`prevent ${k}: ${c} is not a command of ${k}`); }
      if (p.per && !ROLES.includes(p.per)) errs.push(`prevent ${k}: unknown role ${p.per}`);
    }
    for (const [c, where] of Object.entries(FLOWDATA.commands)) { if (!C[c.split(' ')[0]]) errs.push(`commands: unknown command ${c}`); for (const w of where) if (!FLOW[w]) errs.push(`commands ${c}: unknown state ${w}`); }
    for (const k of states) { const seen = new Set([k]), q = [k]; let ok = false; while (q.length) { const x = q.shift(); if (FLOW[x].terminal) { ok = true; break; } for (const t of FLOW[x].next) if (!seen.has(t)) { seen.add(t); q.push(t); } } if (!ok) errs.push(k + ': cannot end'); }
    const reach = new Set(Object.values(FLOWDATA.start)), q = [...reach]; while (q.length) for (const t of FLOW[q.shift()].next) if (!reach.has(t)) { reach.add(t); q.push(t); }
    for (const k of states) if (!reach.has(k)) errs.push(k + ': unreachable');
    for (const [st, kind] of Object.entries(JUDGE_KIND)) for (const t of [AFTER_PASS[kind], RETRY[kind], ...Object.values(RUNGS).map((r) => r.state)]) if (!FLOW[st].next.includes(t)) errs.push(`${st}: an outcome leads to ${t}, which is not in next`);
    for (const r of Object.keys(RUNGS)) for (const o of ['ADVANCED', 'STALLED', 'REGRESSION']) if (!LADDER[r] || !LADDER[r][o] || !RUNGS[LADDER[r][o][1]] || LADDER[r][o][0] < 1) errs.push(`ladder ${r}/${o}: missing or unknown rung`);
    if (RUNGS[LADDER.blocked].state !== FLOWDATA.escape) errs.push('the ladder does not end with the user');
    for (const k of states) if (!bound({ state: k, role: 'root' }).length) errs.push(`${k}: no root card bound`);
    for (const r of ROLES) if (!FLOWDATA.cards.some((b) => b.role === r)) errs.push(`no card bound for role ${r}`);
    for (const b of FLOWDATA.cards) { const c = CARDS[b.card]; if (!c || !c.body) errs.push(`binding ${b.state}/${b.role}: card "${b.card}" missing`); else if (!c.states.includes(b.state) || c.role !== b.role || (c.rung || undefined) !== b.rung) errs.push(`card "${b.card}": front matter (${c.state}${c.rung ? '/' + c.rung : ''}/${c.role}) differs from flow.json (${b.state}${b.rung ? '/' + b.rung : ''}/${b.role})`); }
    for (const [id, c] of Object.entries(CARDS)) { if (c.bad) errs.push(`${c.file}: ${c.bad}`); else { if (!FLOWDATA.cards.some((b) => b.card === id)) errs.push(`card "${id}" (${c.file}) is bound to nothing in flow.json`); for (const st of c.states) if (!FLOWDATA.cards.some((b) => b.card === id && b.state === st)) errs.push(`card "${id}" names ${st}, which flow.json does not bind`); } }
    console.log(errs.length ? 'FLOW INVALID\n- ' + errs.join('\n- ') : `FLOW OK: ${states.length} states, each reachable and able to end; ${Object.keys(PREVENT).length} working states, each refusing its first work command until its prevent; ${Object.keys(CARDS).length} cards, each bound; every outcome leads to an allowed state; the ladder ends with the user`);
    process.exit(errs.length ? 1 : 0);
  },
  flow() {
    const L = Object.keys(RUNGS).map((r) => `${r} (${RUNGS[r].state}): ` + ['ADVANCED', 'STALLED', 'REGRESSION'].map((o) => { const [n, to] = LADDER[r][o]; return `${o} ${to === r ? 'stays' : n === 1 ? '→ ' + to : `stays (${ordinal(n)} → ${to})`}`; }).join(' · '));
    console.log(Object.entries(FLOW).map(([k, v]) => `${k} → ${v.next.join(', ') || '(end)'}`).join('\n') + `\n\nLADDER (counted per rung since the last PASS or rung change; PASS → ${LADDER.pass}; BLOCKED → ${LADDER.blocked})\n` + L.join('\n') + `\n\nPREVENT (refused before it: the state's work commands; its exit checks it again)\n` + Object.entries(PREVENT).map(([k, p]) => `${k}: ${p.per ? 'each ' + p.per + "'s own " : ''}${p.stepback === 'replan' ? 're-plan' : p.stepback + ' step back'}${p.block ? ' + one-block' : ''}${p.carries ? ', carried into the next state once approved' : ''} — before ${[...(p.draft || []).map((c) => c + ' (step back only)'), ...p.before].join(', ')}`).join('\n') + `\nAfter a PASS: one-shot → next-shot (LOOP) → release gate (GATE) → ACCEPT. On the small rung the next attempt is another next-shot; an unsound one-shot (STALLED, REGRESSION) is shot again.`);
  },
  card() { const id = a[0]; if (!CARDS[id] || !CARDS[id].body) die(`unknown card ${id || ''}; cards: ${Object.keys(CARDS).join(', ')}`); console.log(CARDS[id].body); },
  version() { console.log(VERSION); },
};
const ordinal = (n) => n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
if (!C[cmd]) { console.log('cloop.mjs ' + VERSION + '\ncommands: ' + Object.keys(C).join(' ')); process.exit(cmd ? 2 : 0); }
C[cmd]();
