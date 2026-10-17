// Unit tests for the extension's logic (no VS Code needed): node --test test/
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const model = require('../lib/model');
const runner = require('../lib/runner');

const WS = '/work/app';
const existing = new Set([`${WS}/src/Row.jsx`, `${WS}/src/heavy.js`]);
const exists = p => existing.has(p);

const finding = {
  id: 'slow-component-Row-src/Row.jsx',
  severity: 'critical',
  category: 'React',
  title: 'Row is slow to render',
  fix: 'Memoise it.',
  culprits: [
    { fn: 'Row', file: 'src/Row.jsx', line: 3, lineKind: 'exact', abs: '/elsewhere/src/Row.jsx', ms: 1443.1 },
    { fn: 'Row', file: 'src/Row.jsx', line: 3, lineKind: 'exact', ms: 1443.1 },
    { fn: 'renderWithHooks', file: 'node_modules/react-dom/cjs/react-dom.development.js', line: 10 },
  ],
};

test('times read naturally', () => {
  assert.equal(model.formatMs(0), '0 ms');
  assert.equal(model.formatMs(0.6), '0.6 ms');
  assert.equal(model.formatMs(42.4), '42 ms');
  assert.equal(model.formatMs(1443.1), '1.44 s');
  assert.equal(model.formatMs(null), '—');
});

test('culprit files resolve inside the workspace only', () => {
  const resolve = model.makeResolver(WS, exists);
  assert.equal(resolve({ abs: `${WS}/src/Row.jsx`, file: 'x' }), `${WS}/src/Row.jsx`);
  assert.equal(resolve({ abs: '/elsewhere/src/Row.jsx', file: 'src/Row.jsx' }), `${WS}/src/Row.jsx`);
  assert.equal(resolve({ file: 'node_modules/react/index.js' }), null);
  assert.equal(resolve({ file: 'src/missing.js' }), null);
});

test('findings become problems at their lines: perf issues are warnings, never errors', () => {
  const diags = model.diagnosticsFrom([finding, { ...finding, id: 'b', severity: 'info', culprits: [] , file: 'src/heavy.js', line: 2 }], model.makeResolver(WS, exists), 'Click "Save"');
  assert.equal(diags.length, 2, 'duplicates and library culprits are dropped');
  assert.deepEqual(
    { file: diags[0].file, line: diags[0].line, severity: diags[0].severity, code: diags[0].code },
    { file: `${WS}/src/Row.jsx`, line: 2, severity: 'warning', code: 'React' },
  );
  assert.match(diags[0].message, /Row is slow to render \(1\.44 s\) — in Click "Save"\nFix: Memoise it\./);
  assert.equal(diags[1].severity, 'hint');
});

test('CodeLens: costliest components and own functions, one per line', () => {
  const report = {
    id: 'r1',
    react: {
      components: [
        { name: 'Panel', file: 'src/heavy.js', line: 9, renders: 60, wasted: 0, selfMs: 0.2, maxMs: 0.1 },
        { name: 'Row', file: 'src/Row.jsx', line: 3, renders: 7200, wasted: 0, selfMs: 1443.1, maxMs: 0.7 },
      ],
    },
    hotFunctions: [
      { name: 'burn', file: 'src/heavy.js', line: 2, vendor: false, selfMs: 1398.3, totalMs: 1398.3, share: 91.1 },
      { name: 'renderWithHooks', file: 'node_modules/react-dom/x.js', line: 1, vendor: true, selfMs: 13.6, share: 0.9 },
      { name: 'Row', file: 'src/Row.jsx', line: 3, vendor: false, selfMs: 2.3, share: 0.1 },
    ],
  };
  const lenses = model.lensesFrom(report, model.makeResolver(WS, exists));
  assert.deepEqual(
    lenses.map(l => l.title),
    ['⚡ Spectra: Row · 7,200 renders · 1.44 s rendering', '⚡ Spectra: burn() · 1.40 s own time (91% of CPU)'],
  );
  assert.equal(lenses[0].line, 2);
});

test('status bar: headline numbers, budgets flagged', () => {
  assert.equal(model.statusFrom(null).text, '$(pulse) Spectra');
  const profile = {
    kind: 'profile',
    url: 'http://localhost:5188/',
    runs: [{}, {}, {}],
    summary: { tbtMs: 0, lcpMs: 120, fcpMs: 120, cls: 0.002, scriptingMs: 1490, longTaskCount: 0, findingCount: 13 },
    budgets: { ok: false, failed: 2 },
    findings: [{ severity: 'critical', title: 'Row is slow to render' }],
  };
  const s = model.statusFrom(profile);
  assert.equal(s.text, '$(pulse) TBT 0 ms · LCP 120 ms · scripting 1.49 s $(warning)');
  assert.equal(s.warn, true);
  assert.match(s.tooltip, /3 runs \(medians\)[\s\S]*2 over budget[\s\S]*Top: \[critical\] Row is slow to render/);
  assert.equal(model.statusFrom({ kind: 'evaluation', url: 'u', passed: 3, total: 4, budgets: null }).text, '$(pulse) 3/4 journeys');
});

test('compare text: verdict, lead headline, and what to warn about', () => {
  const c = {
    verdict: 'improved',
    confidence: 'medium',
    before: { runs: [1, 2, 3] },
    after: { runs: [1, 2, 3] },
    headlines: [{ kind: 'improved', text: 'JavaScript CPU time: 1.55 s → 107 ms (−93%)' }],
    metrics: [{ label: 'JavaScript CPU time', unit: 'ms', verdict: 'improved', before: { value: 1550 }, after: { value: 107 } }],
    findings: { resolved: [{ severity: 'critical', title: 'Row is slow' }], added: [], persisting: [] },
    checks: [{ level: 'warn', title: 'Different attribution', detail: 'lines may differ' }],
  };
  const t = model.compareText(c);
  assert.equal(t.short, 'Spectra: Improved — JavaScript CPU time: 1.55 s → 107 ms (−93%) (confidence: medium)');
  assert.equal(t.good, true);
  assert.ok(t.lines.includes('  ✓ JavaScript CPU time: 1.55 s → 107 ms'));
  assert.equal(model.compareText({ ...c, verdict: 'mixed' }).bad, true);
});

test('viewOf reads a result file and its typical run from disk', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-ext-'));
  fs.mkdirSync(path.join(ws, 'src'));
  fs.writeFileSync(path.join(ws, 'src', 'Row.jsx'), 'export function Row() {}\n');
  const reportFile = path.join(ws, 'r1.json');
  fs.writeFileSync(
    reportFile,
    JSON.stringify({ id: 'r1', react: { components: [{ name: 'Row', file: 'src/Row.jsx', line: 1, renders: 10, wasted: 9, selfMs: 5, maxMs: 1 }] }, hotFunctions: [] }),
  );
  const resultFile = path.join(ws, 'result.json');
  fs.writeFileSync(
    resultFile,
    JSON.stringify({ kind: 'profile', url: 'u', runs: [{ id: 'r1', file: reportFile }], representativeRunId: 'r1', summary: {}, findings: [finding], budgets: null }),
  );
  const view = model.viewOf(resultFile, ws);
  assert.equal(view.diagnostics.length, 1);
  assert.equal(view.diagnostics[0].file, path.join(ws, 'src', 'Row.jsx'));
  assert.equal(view.lenses[0].title, '⚡ Spectra: Row · 10 renders · 5.0 ms rendering · 9 wasted');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('version check', () => {
  assert.equal(model.atLeast('0.2.0', '0.2.0'), true);
  assert.equal(model.atLeast('0.10.1', '0.2.0'), true);
  assert.equal(model.atLeast('0.1.3', '0.2.0'), false);
});

// ------------------------------------------------------------------ runner

test('resolveCli: setting, then the project install, then npx', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-ext-'));
  assert.deepEqual(runner.resolveCli(ws, 'tools/spectra.js'), { command: 'node', prefix: [path.join(ws, 'tools/spectra.js')], source: 'setting' });
  assert.equal(runner.resolveCli(ws, '').source, 'npx');
  const pkg = path.join(ws, 'node_modules', '@progen-labs', 'spectra');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'bin', 'spectra.js'), '');
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"version":"0.3.0"}');
  const local = runner.resolveCli(ws, '');
  assert.equal(local.source, 'project');
  assert.equal(local.version, '0.3.0');
  fs.rmSync(ws, { recursive: true, force: true });
});

function fakeCli(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-fake-'));
  const file = path.join(dir, 'spectra.js');
  fs.writeFileSync(file, body);
  return { cli: { command: process.execPath, prefix: [file], source: 'setting' }, dir };
}

test('runSpectra: JSON from stdout, status lines from stderr, exit code 2 still a result', async () => {
  const { cli, dir } = fakeCli(`
    console.error('spectra: run 1/2 …'); console.error('a table line'); console.error('spectra: run 2/2 …');
    process.stdout.write(JSON.stringify({ kind: 'profile' })); process.exitCode = 2;`);
  const lines = [];
  const res = await runner.runSpectra(cli, [], { cwd: dir, onLine: l => lines.push(l) });
  assert.deepEqual(res, { json: { kind: 'profile' }, code: 2 });
  assert.deepEqual(lines, ['run 1/2 …', 'run 2/2 …']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runSpectra: a failed run rejects with Spectra\'s own message', async () => {
  const { cli, dir } = fakeCli(`console.error('spectra: Chrome was not found.'); process.exit(1);`);
  await assert.rejects(runner.runSpectra(cli, [], { cwd: dir }), /^Error: Chrome was not found\.$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runSpectra: cancelling kills the run', async () => {
  const { cli, dir } = fakeCli(`setTimeout(() => {}, 60000);`);
  let cancel;
  const token = { onCancellationRequested: cb => ((cancel = cb), { dispose() {} }) };
  const run = runner.runSpectra(cli, [], { cwd: dir, token });
  setTimeout(() => cancel(), 200);
  await assert.rejects(run, err => err.cancelled === true);
  fs.rmSync(dir, { recursive: true, force: true });
});
