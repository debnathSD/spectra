#!/usr/bin/env node
/**
 * Composes spectra-bot's pull request report from the Checks workflow: each
 * job's result (NEEDS, the workflow's `needs` as JSON) and the short notes the
 * jobs left in the report folder. Prints Markdown; pr-comment.mjs posts it.
 *
 *   NEEDS='{…}' HEAD_SHA=… RUN_URL=… node scripts/ci/pr-report.mjs .report
 */
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = '<!-- spectra-bot:checks -->';
const dir = process.argv[2] || '.report';
const needs = JSON.parse(process.env.NEEDS || '{}');
const sha = (process.env.HEAD_SHA || '').slice(0, 7);
const runUrl = process.env.RUN_URL || '';

const read = name => {
  try {
    return fs.readFileSync(path.join(dir, name), 'utf8').trim();
  } catch {
    return '';
  }
};
const notes = prefix =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
        .sort()
        .map(f => read(f))
        .filter(Boolean)
    : [];
const firstLine = text => text.split('\n')[0].replace(/\|/g, '\\|');
const ICON = { success: '✅', failure: '❌', cancelled: '⏹️', skipped: '⏭️' };

// one row per check: [job id, name, what it says]
const rows = [
  ['lint', 'Lint', firstLine(read('lint.md')) || 'ESLint'],
  ['test', 'Tests', (() => {
    const runs = notes('test-');
    const failed = runs.filter(r => / [1-9]\d* failed/.test(r) || /did not run/.test(r)).length;
    const count = (runs[0]?.match(/(\d+) passed/) || [])[1];
    return runs.length ? `${runs.length - failed} of ${runs.length} runs passed${count ? `, ${count} tests each` : ''}` : 'see the job';
  })()],
  ['build', 'Build', firstLine(read('build.md')) || 'The dashboard'],
  ['package', 'Package', (() => {
    const ok = notes('package-').length;
    return ok ? `Installs and runs from the packed package on ${ok} of 3 platforms (Linux, macOS, Windows)` : 'see the job';
  })()],
  ['size', 'Size budget', (() => {
    const t = read('size.md');
    if (!t) return 'see the job';
    if (/Over budget/.test(t)) return firstLine(t.split('\n').find(l => /Over budget/.test(l)) || 'over budget');
    const grew = t.split('\n').filter(l => l.includes('🔺')).length;
    const shrank = t.split('\n').filter(l => l.includes('🔻')).length;
    return `Within every budget${grew || shrank ? ` (${grew} bigger, ${shrank} smaller than the base)` : ''}`;
  })()],
  ['audit', 'npm audit', firstLine(read('audit.md')) || 'see the job'],
  ['dependency-review', 'Dependency review', firstLine(read('dependency-review.md')) || 'see the job'],
  ['snyk', 'Snyk', firstLine(read('snyk.md')) || 'see the job'],
  ['bench', 'Fix harness bench', firstLine(read('bench.md')) || 'see the job'],
  ['action', 'GitHub Action', firstLine(read('action.md')) || 'see the job'],
];

const status = id => needs[id]?.result || 'skipped';
// a job that failed before it could write its note (installing the dependencies, say)
const NOTED = { lint: 'lint.md', build: 'build.md', size: 'size.md', audit: 'audit.md', 'dependency-review': 'dependency-review.md', snyk: 'snyk.md', bench: 'bench.md', action: 'action.md' };
for (const row of rows) {
  const [id] = row;
  const noted = NOTED[id] ? read(NOTED[id]) : notes(id === 'test' ? 'test-' : 'package-').length;
  if (status(id) === 'failure' && !noted) row[2] = `Failed before it finished, often at \`npm install\` ([the log](${runUrl}))`;
  if (status(id) === 'cancelled') row[2] = 'Cancelled';
}
const icon = ([id, , note]) => (status(id) === 'success' && /^Not tested/.test(note) ? '⏭️' : ICON[status(id)] || '❔');
const failed = rows.filter(([id]) => status(id) === 'failure');
const cancelled = rows.filter(([id]) => status(id) === 'cancelled');

const out = [
  MARKER,
  failed.length
    ? `### ❌ ${failed.length} check${failed.length === 1 ? '' : 's'} failed: ${failed.map(r => r[1]).join(', ')}`
    : cancelled.length
      ? `### ⏹️ Checks were cancelled`
      : '### ✅ Every check passed',
  `<sub>Commit \`${sha}\` · [all the details](${runUrl})</sub>`,
  '',
  '| | Check | Result |',
  '| :-: | --- | --- |',
  ...rows.map(r => `| ${icon(r)} | ${r[1]} | ${r[2]} |`),
];

const details = (title, body) => (body ? ['', `<details><summary>${title}</summary>`, '', body, '', '</details>'] : []);
out.push(...details('Size: the package, the install and the dashboard', read('size.md')));
out.push(...details('Tests, run by run', notes('test-').join('\n\n')));
out.push(...details('Fix harness bench', read('bench.md')));
if (/\| (critical|high) \|/.test(read('snyk.md'))) out.push(...details('Snyk: high and critical vulnerabilities', read('snyk.md')));
if (status('lint') === 'failure') out.push(...details('Lint problems', read('lint.md')));

console.log(out.join('\n'));
