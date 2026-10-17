// The AI fix harness without a browser or a model: its rules, its loop with
// fake measurements and agents, and its git copy in a throwaway repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { commandAgent } from './agent.js';
import { detectChecks } from './checks.js';
import { runFix } from './harness.js';
import { fixPrompt, judge, rankFindings, scopeProblem } from './policy.js';
import { reportMarkdown } from './report.js';
import { changesIn, commitChange, commitsOn, createWorkspace, ignoreSpectra, removeWorkspace, repoOf, uncommitted, undoChanges } from './workspace.js';

const finding = (id, extra = {}) => ({ id, severity: 'critical', title: `${id} is slow`, impactMs: 500, file: 'src/Row.jsx', line: 3, fix: 'memoize it', culprits: [{ fn: 'Row', file: 'src/Row.jsx', line: 3, ms: 500 }], ...extra });
const comparison = (verdict, confidence = 'medium', extra = {}) => ({
  verdict,
  confidence,
  headlines: verdict === 'improved' ? [{ kind: 'improved', text: 'JavaScript CPU time: 1.55 s → 107 ms (−93%)' }] : verdict === 'neutral' ? [] : [{ kind: 'degraded', text: 'Total blocking time: 0 ms → 300 ms' }],
  findings: { added: [], resolved: [], persisting: [], ...extra },
});

test('ranks own-code findings, most costly first, one per place', () => {
  const findings = [
    finding('row-render', { impactMs: 1441 }),
    finding('row-count', { impactMs: 1440, title: 'Row rendered 7200×' }), // same file and line
    finding('heavy', { file: 'src/heavy.js', line: 2, impactMs: 1425, culprits: [{ fn: 'burn', file: 'src/heavy.js', line: 2 }] }),
    finding('bundle', { file: 'node_modules/react-dom/index.js', impactMs: 600 }),
    finding('note', { severity: 'info', file: 'src/App.jsx' }),
    finding('gone', { file: 'src/Deleted.jsx' }),
  ];
  const exists = f => !f.includes('Deleted');
  const { candidates } = rankFindings(findings, { exists, max: 5 });
  assert.deepEqual(candidates.map(c => c.id), ['row-render', 'heavy']);
  const again = rankFindings(findings, { exists, history: { 'row-render': { outcome: 'checks-failed' } } });
  assert.deepEqual(again.candidates.map(c => c.id), ['row-count', 'heavy'], 'a failed finding is skipped, so the next one at that line gets its chance');
  assert.match(again.skipped[0].reason, /checks failed/);
  assert.deepEqual(rankFindings(findings, { exists, history: { 'row-render': { outcome: 'checks-failed' } }, retry: true }).candidates[0].id, 'row-render');
});

test('keeps changes inside the source, small, and without deleting files', () => {
  const src = (p, added = 3, removed = 1, status = 'M') => ({ path: p, status, added, removed });
  assert.equal(scopeProblem([src('src/Row.jsx')]), null);
  assert.match(scopeProblem([src('package.json')]), /may not touch/);
  assert.match(scopeProblem([src('pnpm-lock.yaml')]), /may not touch/);
  assert.match(scopeProblem([src('src/Row.test.jsx')]), /may not touch/);
  assert.match(scopeProblem([src('vite.config.js')]), /may not touch/);
  assert.match(scopeProblem([src('src/Row.jsx', 0, 9, 'D')]), /deleted/);
  assert.match(scopeProblem([src('src/Row.jsx', 200, 10)]), /more than the 150/);
});

test('judges a change from the comparison', () => {
  assert.equal(judge(comparison('improved')).decision, 'keep');
  assert.equal(judge(comparison('improved', 'high')).decision, 'keep');
  assert.equal(judge(comparison('improved', 'low')).decision, 'measure-again');
  assert.equal(judge(comparison('neutral')).outcome, 'no-gain');
  assert.equal(judge(comparison('regressed')).outcome, 'slower');
  assert.equal(judge(comparison('mixed')).outcome, 'mixed');
  assert.equal(judge(comparison('improved', 'high', { added: [{ severity: 'critical', title: 'Long task' }] })).outcome, 'new-problem');
});

test('tells the agent the finding and the rules', () => {
  const p = fixPrompt(finding('row'), { url: 'http://localhost:5199' });
  assert.match(p, /row is slow/);
  assert.match(p, /src\/Row\.jsx:3/);
  assert.match(p, /Keep the behaviour exactly the same/);
  assert.match(p, /Do not run commands/);
  assert.match(p, /localhost:5199/);
});

// --- the loop, with fakes
function fakes({ agentChanges, checks = [true, true, true, true], verdicts }) {
  const calls = { commits: [], undos: 0, profiles: 0, compares: [] };
  let pending = [];
  let checkRun = 0;
  let verdictRun = 0;
  const workspace = {
    projectDir: '/tmp/project',
    exists: () => true,
    changes: () => pending,
    diff: () => 'diff',
    commit: (files, message) => (calls.commits.push({ files, message }), (pending = []), 'abc1234'),
    undo: () => ((pending = []), calls.undos++),
  };
  let agentRun = 0;
  return {
    calls,
    options: {
      agent: { name: 'fake', run: async () => ((pending = agentChanges[agentRun++] || []), { summary: 'memoized the work' }) },
      workspace,
      checks: [{ name: 'npm test' }],
      runChecks: async () => [{ name: 'npm test', ok: checks[checkRun++] ?? true, tail: 'expected 120 rows' }],
      profile: async label => ((calls.profiles++), { file: `${label}.json`, result: { url: 'http://localhost:5199', summary: {}, findings: [finding('row-render'), finding('heavy', { file: 'src/heavy.js', line: 2, culprits: [] })] } }),
      compare: async (before, after) => (calls.compares.push([before, after]), verdicts[verdictRun++] || comparison('neutral')),
    },
  };
}
const edit = [{ path: 'src/Row.jsx', status: 'M', added: 2, removed: 1 }];

test('keeps a change that passes the checks and measures faster, and builds on it', async () => {
  const { calls, options } = fakes({ agentChanges: [edit, edit], verdicts: [comparison('improved'), comparison('neutral'), comparison('improved')] });
  const s = await runFix(options);
  assert.deepEqual(s.attempts.map(a => a.outcome), ['kept', 'no-gain']);
  assert.equal(s.kept, 1);
  assert.equal(calls.commits.length, 1);
  assert.match(calls.commits[0].message, /^perf: row-render is slow/);
  assert.match(calls.commits[0].message, /Verified by spectra fix: improved \(confidence: medium\)/);
  assert.deepEqual(calls.compares[1], [['after 1.json'], ['after 2.json']], 'the second fix is measured against the first');
  assert.deepEqual(calls.compares[2], [['baseline.json'], ['after 1.json']], 'the overall comparison starts from the baseline');
  assert.equal(s.final.verdict, 'improved');
  assert.match(reportMarkdown({ ...s, runs: 3, branch: 'spectra/fix-x' }), /1 of 2 findings fixed/);
});

test('undoes a change whose checks fail, without measuring it', async () => {
  const { calls, options } = fakes({ agentChanges: [edit], checks: [true, false], verdicts: [] });
  options.workspace.exists = f => f === 'src/Row.jsx';
  const s = await runFix(options);
  assert.equal(s.attempts[0].outcome, 'checks-failed');
  assert.equal(calls.undos, 1);
  assert.equal(calls.profiles, 1, 'only the baseline was measured');
  assert.equal(calls.commits.length, 0);
});

test('refuses to start when a check fails before any change', async () => {
  const { options } = fakes({ agentChanges: [], checks: [false], verdicts: [] });
  await assert.rejects(runFix(options), /fails before any change/);
});

test('undoes out-of-scope and empty changes', async () => {
  const { calls, options } = fakes({ agentChanges: [[{ path: 'package.json', status: 'M', added: 1, removed: 1 }], []], verdicts: [] });
  const s = await runFix(options);
  assert.deepEqual(s.attempts.map(a => a.outcome), ['out-of-scope', 'no-change']);
  assert.equal(calls.undos, 1);
});

test('stops at once when the agent cannot work at all', async () => {
  const { options } = fakes({ agentChanges: [], verdicts: [] });
  let runs = 0;
  options.agent = { name: 'Claude Code', run: async () => (runs++, { summary: '', error: 'Not logged in · Please run /login' }) };
  await assert.rejects(runFix(options), /Claude Code cannot work: Not logged in/);
  assert.equal(runs, 1, 'no other finding was tried');
});

test('measures again when the gain has low confidence', async () => {
  const kept = fakes({ agentChanges: [edit], verdicts: [comparison('improved', 'low'), comparison('improved', 'medium'), comparison('improved')] });
  kept.options.workspace.exists = f => f === 'src/Row.jsx';
  const s = await runFix(kept.options);
  assert.equal(s.attempts[0].outcome, 'kept');
  assert.deepEqual(kept.calls.compares[1], [['baseline.json'], ['after 1.json', 'after 1, more runs.json']]);
  const unproven = fakes({ agentChanges: [edit], verdicts: [comparison('improved', 'low'), comparison('improved', 'low')] });
  unproven.options.workspace.exists = f => f === 'src/Row.jsx';
  assert.equal((await runFix(unproven.options)).attempts[0].outcome, 'unproven');
});

// --- the git copy, in a throwaway repository
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-fix-test-')));
  sh(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'app/src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app/node_modules/dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app/src/Row.jsx'), 'export const Row = () => null;\n');
  fs.writeFileSync(path.join(dir, 'app/package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1', build: 'vite build', typecheck: 'tsc' } }));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return dir;
}

test('works in a git copy: links dependencies, commits kept changes, undoes the rest', () => {
  const root = repo();
  const { root: r, sub } = repoOf(path.join(root, 'app'));
  assert.equal(r, root);
  assert.equal(sub, 'app');
  ignoreSpectra(root);
  fs.mkdirSync(path.join(root, 'app/.spectra/fix'), { recursive: true });
  assert.deepEqual(uncommitted(root), [], '.spectra is ignored');

  const ws = createWorkspace({ root, sub, dir: path.join(root, 'app/.spectra/fix/s1/worktree'), branch: 'spectra/fix-test' });
  assert.ok(fs.lstatSync(path.join(ws.projectDir, 'node_modules')).isSymbolicLink());

  fs.writeFileSync(path.join(ws.projectDir, 'src/Row.jsx'), 'export const Row = () => null; // faster\n');
  fs.writeFileSync(path.join(ws.projectDir, 'src/cache.js'), 'export const cache = new Map();\n');
  const changes = changesIn(ws);
  assert.deepEqual(changes.map(c => [c.path, c.status]).sort(), [['src/Row.jsx', 'M'], ['src/cache.js', 'A']]);
  commitChange(ws, changes.map(c => c.path), 'perf: test');
  assert.equal(commitsOn(root, 'spectra/fix-test'), 1);

  fs.writeFileSync(path.join(ws.projectDir, 'src/Row.jsx'), 'broken');
  fs.writeFileSync(path.join(ws.projectDir, 'src/junk.js'), 'junk');
  undoChanges(ws);
  assert.deepEqual(changesIn(ws), []);
  assert.ok(fs.existsSync(path.join(ws.projectDir, 'node_modules')), 'the dependency link survives an undo');
  assert.equal(fs.readFileSync(path.join(root, 'app/src/Row.jsx'), 'utf8'), 'export const Row = () => null;\n', 'the user\'s files never change');

  removeWorkspace(root, ws, { keepBranch: true });
  assert.ok(!fs.existsSync(ws.dir));
  assert.equal(commitsOn(root, 'spectra/fix-test'), 1, 'the branch with the fix stays');
  fs.rmSync(root, { recursive: true, force: true });
});

test('finds checks in package.json and runs any agent command', async () => {
  const root = repo();
  assert.deepEqual(detectChecks(path.join(root, 'app')).map(c => c.cmd), ['npm run typecheck', 'npm run build'], 'the npm placeholder test is not a check');
  const agent = commandAgent(`node -e "const fs=require('fs');const p=fs.readFileSync(process.env.SPECTRA_FIX_PROMPT_FILE,'utf8');fs.writeFileSync('src/Row.jsx','// '+p.split('\\n')[2]+'\\n');console.log('rewrote Row')"`);
  const res = await agent.run('Fix it.\n\nFinding: Row is slow', { cwd: path.join(root, 'app'), finding: {} });
  assert.equal(res.summary, 'rewrote Row');
  assert.equal(fs.readFileSync(path.join(root, 'app/src/Row.jsx'), 'utf8'), '// Finding: Row is slow\n');
  fs.rmSync(root, { recursive: true, force: true });
});
