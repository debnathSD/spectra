// Named test-*.js (not *.test.js): the repo's jest testRegex covers tools/.
// The GitHub Action's job summary and pass/fail decision.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCompareResult, buildProfileResult } from '../shared/result.js';
import { report } from '../server/testing/fixtures.js';
import { MARKER, failureReason, summaryMarkdown } from './summary.mjs';

const slow = [report('b1', { tbt: 590, scripting: 640 }), report('b2', { tbt: 585, scripting: 636 }), report('b3', { tbt: 580, scripting: 630 })];
const fast = [report('a1', { tbt: 0, scripting: 2, findings: [] }), report('a2', { tbt: 0, scripting: 1.5, findings: [] }), report('a3', { tbt: 0, scripting: 1.6, findings: [] })];

test('a comparison: verdict, base vs head table, resolved findings, marker for comment updates', () => {
  const base = buildProfileResult({ reports: slow, spectraVersion: '0.3.0' });
  const head = buildProfileResult({ reports: fast, spectraVersion: '0.3.0', budgets: { tbtMs: 200 } });
  const { comparison } = buildCompareResult({ before: slow, after: fast });
  const md = summaryMarkdown({ head, base, comparison, reproduce: 'npx spectra performance --quick --runs 3', artifact: 'spectra-reports' });
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /## ⚡ Spectra performance: ✅ Improved/);
  assert.match(md, /3 page-load runs per side, medians · Spectra 0\.3\.0/);
  assert.match(md, /\| Total blocking time \| 585 ms \| 0 ms \| ✅ better \|/);
  assert.match(md, /✅ resolved: Row is slow to render/);
  assert.match(md, /\*\*Budgets:\*\* ✅ all 1 checks within budget\./);
  assert.match(md, /Reproduce locally: `npx spectra performance --quick --runs 3`/);
});

test('no comparison: medians, budgets over, top findings without notes', () => {
  const head = buildProfileResult({ reports: [slow[0]], budgets: { tbtMs: 100 } });
  head.findings.push({ id: 'react-missing', severity: 'info', title: 'No React renderer was seen', culprits: [], impactMs: 0, fix: '' });
  const md = summaryMarkdown({ head });
  assert.match(md, /## ⚡ Spectra performance: ❌ Over budget/);
  assert.match(md, /1 page-load run · Spectra/);
  assert.doesNotMatch(md, /per side/);
  assert.match(md, /\| `tbtMs` \| 590 ms \| 100 ms \| median \|/);
  assert.match(md, /🔴 critical \| Row is slow to render \| `src\/Row\.jsx:3`/);
  assert.doesNotMatch(md, /No React renderer/);
});

test('table cells survive pipes and newlines in page text', () => {
  const head = buildProfileResult({ reports: [report('x', { findings: [{ id: 'f', severity: 'warning', category: 'Network', title: 'a | b\nc', impactMs: 5, fix: 'x|y', culprits: [] }] })] });
  const md = summaryMarkdown({ head });
  assert.match(md, /a \\\| b c/);
});

test('failure decision', () => {
  assert.match(failureReason({ headCode: 1 }), /could not run/);
  assert.match(failureReason({ headCode: 2, failOnBudget: true }), /budget was exceeded/);
  assert.equal(failureReason({ headCode: 2, failOnBudget: false }), null);
  assert.match(failureReason({ headCode: 0, comparison: { verdict: 'regressed' }, failOnRegression: true }), /regressed/);
  assert.match(failureReason({ headCode: 0, comparison: { verdict: 'mixed' }, failOnRegression: true }), /got worse in some key metrics/);
  assert.equal(failureReason({ headCode: 0, comparison: { verdict: 'regressed' }, failOnRegression: false }), null);
});
