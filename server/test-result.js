// Named test-*.js (not *.test.js): the repo's jest testRegex covers tools/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BUDGET_KEYS,
  RESULT_SCHEMA_VERSION,
  SUMMARY_METRICS,
  briefFinding,
  buildCompareResult,
  buildEvaluationResult,
  buildProfileResult,
  checkBudgets,
  isRegression,
  representativeRun,
  summarize,
  summarizeRuns,
  validateBudgets,
} from '../shared/result.js';
import { finding, report, workspace } from './testing/fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSchema = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', name), 'utf8'));

test('summarize reads the headline numbers, rounded, with null where unmeasured', () => {
  const s = summarize(report('a', { tbt: 212.96 }));
  assert.equal(s.tbtMs, 213);
  assert.equal(s.cls, 0.002);
  assert.equal(s.inpMs, null);
  assert.equal(s.transferKb, 2048);
  assert.equal(s.criticalFindings, 1);
  assert.deepEqual(Object.keys(s), SUMMARY_METRICS.map(m => m.key));
});

test('several runs reduce to medians with a min / max spread; the typical run supplies the findings', () => {
  const runs = [report('r1', { scripting: 900 }), report('r2', { scripting: 1000 }), report('r3', { scripting: 2000 })];
  const { summary, spread } = summarizeRuns(runs);
  assert.equal(summary.runs, 3);
  assert.equal(summary.scriptingMs, 1000);
  assert.deepEqual(spread.scriptingMs, { min: 900, max: 2000 });
  assert.equal(representativeRun(runs).id, 'r2');
  // one run: no spread to speak of
  assert.deepEqual(summarizeRuns([runs[0]]).spread, {});
});

test('briefFinding keeps what a reader acts on', () => {
  const b = briefFinding(finding());
  assert.equal(b.impactMs, 1442.9);
  assert.equal(b.line, 3);
  assert.equal(b.culprits[0].abs, '/p/src/Row.jsx');
  assert.equal(b.fix, 'Memoise it.');
});

test('budgets: unknown keys and bad limits are rejected, unmeasured metrics are skipped', () => {
  assert.equal(validateBudgets({ tbt: 200 }).ok, false);
  assert.match(validateBudgets({ tbt: 200 }).error, /Unknown budget "tbt"/);
  assert.equal(validateBudgets({ tbtMs: -1 }).ok, false);
  assert.equal(validateBudgets(undefined).ok, true);
  const res = checkBudgets({ tbtMs: 200, inpMs: 100, criticalFindings: 0 }, [{ name: 'median', summary: summarize(report('a', { tbt: 250 })) }]);
  assert.equal(res.ok, false);
  assert.equal(res.failed, 2);
  assert.deepEqual(res.checks.map(c => c.status), ['fail', 'skipped', 'fail']);
  assert.equal(checkBudgets({}, []), null);
});

test('profile result: versioned envelope, per-run summaries, findings marked with how many runs saw them', () => {
  const runs = [report('r1'), report('r2', { findings: [] }), report('r3')];
  const result = buildProfileResult({ reports: runs, fileOf: id => `/reports/${id}.json`, target: 'demo', spectraVersion: '9.9.9', budgets: { tbtMs: 200 } });
  assert.equal(result.schemaVersion, RESULT_SCHEMA_VERSION);
  assert.equal(result.kind, 'profile');
  assert.equal(result.runs[1].file, '/reports/r2.json');
  assert.equal(result.findings[0].seenIn, 2);
  assert.equal(result.budgets.ok, true);
});

test('evaluation result: one summary per journey, budgets name the journey that broke them', () => {
  const reports = { base: report('base'), p1: report('p1', { tbt: 400 }) };
  const evaluation = {
    url: 'http://localhost:5188/',
    target: 'demo',
    discovered: 3,
    skippedDestructive: [],
    baseline: { id: 'base', title: 'Initial page load', kind: 'load', ok: true },
    paths: [{ id: 'p1', title: 'Click "Long task"', kind: 'interaction', ok: true }],
  };
  const result = buildEvaluationResult({ evaluation, readReport: id => reports[id], budgets: { tbtMs: 200 } });
  assert.equal(result.journeys.length, 2);
  assert.equal(result.passed, 1);
  const failed = result.budgets.checks.filter(c => c.status === 'fail');
  assert.deepEqual(failed.map(c => c.where), ['Click "Long task"']);
});

test('compare result wraps the shared comparison and flags regressions', () => {
  const slow = [report('b1', { scripting: 1500 }), report('b2', { scripting: 1520 })];
  const fast = [report('a1', { scripting: 90, findings: [] }), report('a2', { scripting: 95, findings: [] })];
  const better = buildCompareResult({ before: slow, after: fast });
  assert.equal(better.kind, 'compare');
  assert.equal(better.comparison.verdict, 'improved');
  assert.equal(better.comparison.findings.resolved.length, 1);
  assert.equal(isRegression(better), false);
  assert.equal(isRegression(buildCompareResult({ before: fast, after: slow })), true);
});

test('the published schemas list exactly the metrics and budgets the code produces', () => {
  const result = readSchema('result.schema.json');
  assert.deepEqual(Object.keys(result.$defs.summary.properties), SUMMARY_METRICS.map(m => m.key));
  assert.equal(result.properties.schemaVersion.const, RESULT_SCHEMA_VERSION);
  const config = readSchema('config.schema.json');
  assert.deepEqual(Object.keys(config.properties.budgets.properties), BUDGET_KEYS);
  // every key the schema requires is present in what the builders return
  const profile = buildProfileResult({ reports: [report('r1')], budgets: {} });
  for (const key of [...result.required, ...result.$defs.profile.required]) assert.ok(key in profile, `profile result lacks ${key}`);
  const finding0 = profile.findings[0];
  for (const key of result.$defs.finding.required) assert.ok(key in finding0, `finding lacks ${key}`);
});

// ------------------------------------------------------------------ CLI (no Chrome needed)

const run = (script, args, ws) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ws.dir,
    encoding: 'utf8',
    env: { ...process.env, PERF_FRONTEND_DIR: ws.dir, PERF_REPORTS_DIR: ws.reports },
  });

test('cli: compare by ids prints a verdict, emits JSON, and exits 2 on a regression when asked', () => {
  const ws = workspace();
  const before = '20261017T100000-load,20261017T100010-load';
  const after = '20261017T100100-load,20261017T100110-load';
  const ok = run('bin/spectra.js', ['compare', before, after, '--json'], ws);
  assert.equal(ok.status, 0, ok.stderr);
  const result = JSON.parse(ok.stdout);
  assert.equal(result.comparison.verdict, 'improved');
  assert.match(ok.stderr, /Spectra compare — IMPROVED/);

  const worse = run('bin/spectra.js', ['compare', after, before, '--fail-on-regression'], ws);
  assert.equal(worse.status, 2);
  assert.match(worse.stdout, /REGRESSED/);
  fs.rmSync(ws.dir, { recursive: true, force: true });
});

test('cli: a saved profile result works as a compare side, from any directory', () => {
  const ws = workspace();
  const profile = buildProfileResult({
    reports: ['20261017T100000-load', '20261017T100010-load'].map(id => JSON.parse(fs.readFileSync(path.join(ws.reports, `${id}.json`), 'utf8'))),
    fileOf: id => path.join(ws.reports, `${id}.json`),
  });
  fs.writeFileSync(path.join(ws.dir, 'before.json'), JSON.stringify(profile));
  const res = run('bin/spectra.js', ['compare', 'before.json', '20261017T100100-load', '--out', 'cmp.json'], ws);
  assert.equal(res.status, 0, res.stderr);
  const written = JSON.parse(fs.readFileSync(path.join(ws.dir, 'cmp.json'), 'utf8'));
  assert.equal(written.comparison.before.runs.length, 2);
  fs.rmSync(ws.dir, { recursive: true, force: true });
});

test('cli: reports lists newest first; bad input fails fast with exit 1 and no browser', () => {
  const ws = workspace();
  const list = run('bin/spectra.js', ['reports', '--json'], ws);
  assert.equal(list.status, 0, list.stderr);
  const parsed = JSON.parse(list.stdout);
  assert.equal(parsed.kind, 'reports');
  assert.equal(parsed.reports[0].id, '20261017T100110-load');

  const missing = run('bin/spectra.js', ['compare', 'nope', '20261017T100100-load'], ws);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no report "nope"/);

  fs.writeFileSync(path.join(ws.dir, 'spectra.config.json'), JSON.stringify({ budgets: { tbt: 200 } }));
  const badConfig = run('server/cli.js', ['--url', 'http://localhost:9/', '--mode', 'load'], ws);
  assert.equal(badConfig.status, 1);
  assert.match(badConfig.stderr, /Unknown budget "tbt"/);

  const runsOnSuite = run('bin/spectra.js', ['performance', '--runs', '3', '--url', 'http://localhost:9/'], ws);
  assert.equal(runsOnSuite.status, 1);
  assert.match(runsOnSuite.stderr, /--runs works with single-page profiles/);

  const quickLive = run('bin/spectra.js', ['performance', '--quick', '--mode', 'live', '--url', 'http://localhost:9/'], ws);
  assert.equal(quickLive.status, 1);
  fs.rmSync(ws.dir, { recursive: true, force: true });
});
