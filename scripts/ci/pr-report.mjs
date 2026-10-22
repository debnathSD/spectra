#!/usr/bin/env node
/**
 * Composes spectra-bot's pull request report from the Checks workflow: a table
 * with every check's result (each linked to its job), then, for each failure,
 * where it happened: the failing step (linked to that line of the log), the
 * files and lines the check pointed at, and the end of the log. Details from
 * the jobs' notes (sizes, tests, the bench) follow, folded. Prints Markdown;
 * pr-comment.mjs posts it.
 *
 *   NEEDS='{…}' HEAD_SHA=… GITHUB_TOKEN=… GITHUB_REPOSITORY=… GITHUB_RUN_ID=… node scripts/ci/pr-report.mjs ci-notes
 */
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = '<!-- spectra-bot:checks -->';
const dir = process.argv[2] || 'ci-notes';
const needs = JSON.parse(process.env.NEEDS || '{}');
const sha = process.env.HEAD_SHA || '';
const { GITHUB_TOKEN, GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: RUN_ID, GITHUB_RUN_ATTEMPT: ATTEMPT = '1' } = process.env;
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const runUrl = `${server}/${REPO}/actions/runs/${RUN_ID}`;

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
const firstLine = text => (text || '').split('\n')[0].replace(/\|/g, '\\|');

// ------------------------------------------------------------------ the run's jobs, from the API
const api = async url => {
  const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, {
    headers: { ...(GITHUB_TOKEN && { authorization: `Bearer ${GITHUB_TOKEN}` }), accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
};
let jobs = [];
try {
  jobs = (await (await api(`/actions/runs/${RUN_ID}/attempts/${ATTEMPT}/jobs?per_page=100`)).json()).jobs;
} catch (err) {
  console.error(`Could not list the run's jobs: ${err.message}`);
}
const jobsOf = prefix => jobs.filter(j => j.name === prefix || j.name.startsWith(`${prefix} (`));

// where a failed job went wrong: the step, the annotated lines, the end of its log
async function whereItFailed(job) {
  const step = (job.steps || []).find(s => s.conclusion === 'failure');
  const out = [`#### ❌ [${job.name}](${job.html_url})`];
  out.push(step ? `Failed at step ${step.number}, **${step.name}**: [open the log there](${job.html_url}#step:${step.number}:1).` : `[Open the log](${job.html_url}).`);
  try {
    const annotations = await (await api(`/check-runs/${job.id}/annotations?per_page=50`)).json();
    const real = annotations.filter(a => a.annotation_level === 'failure' && !/^Process completed with exit code/.test(a.message));
    for (const a of real.slice(0, 15)) {
      const where = a.path && a.path !== '.github' ? `[\`${a.path}:${a.start_line}\`](${server}/${REPO}/blob/${sha}/${a.path}#L${a.start_line}) ` : '';
      out.push(`- ${where}${a.title ? `**${a.title}**: ` : ''}${String(a.message).split('\n')[0].slice(0, 400)}`);
    }
  } catch {}
  try {
    // the last lines of the failing step: what it printed just before it stopped
    const log = await (await api(`/actions/jobs/${job.id}/logs`)).text();
    const lines = log.split('\n').map(l => l.replace(/^\S+Z /, '').replace(/\r$/, ''));
    const end = lines.findIndex(l => /^##\[error\]Process completed with exit code/.test(l));
    const stop = end < 0 ? lines.length : end;
    let start = stop;
    while (start > 0 && !/^##\[group\]Run /.test(lines[start - 1])) start--;
    const tail = lines
      .slice(start, stop)
      .filter(l => l.trim() && !/^##\[(group|endgroup)\]/.test(l) && !/^::(error|warning|notice)/.test(l))
      .map(l => l.replace(/^##\[error\]/, 'Error: '))
      .slice(-25);
    if (tail.length) out.push('', '<details><summary>The end of the log</summary>', '', '```text', ...tail.map(l => l.slice(0, 300)), '```', '', '</details>');
  } catch {}
  return out.join('\n');
}

// ------------------------------------------------------------------ the table
const status = id => needs[id]?.result || 'skipped';
const link = (name, prefix) => {
  const list = jobsOf(prefix);
  return list.length === 1 ? `[${name}](${list[0].html_url})` : name;
};
const matrix = (prefix, label) => {
  const list = jobsOf(prefix);
  if (!list.length) return null;
  const failed = list.filter(j => j.conclusion === 'failure');
  return failed.length
    ? `${failed.length} of ${list.length} failed: ${failed.map(j => `[${j.name.slice(prefix.length + 2, -1)}](${j.html_url})`).join(', ')}`
    : `${label(list)}`;
};
const rows = [
  ['lint', link('Lint', 'Lint'), firstLine(read('lint.md'))],
  ['test', 'Tests', matrix('Tests', list => {
    const count = (notes('test-')[0]?.match(/(\d+) passed/) || [])[1];
    const coverage = (notes('test-').join('\n').match(/Coverage: lines ([\d.]+)%/) || [])[1];
    return `${list.length} of ${list.length} runs passed${count ? `, ${count} tests each` : ''}${coverage ? `; ${coverage}% of lines covered` : ''}: ${list.map(j => j.name.slice(7, -1)).join(' · ')}`;
  })],
  ['package', 'Package', matrix('Package', list => `Installs and runs from the packed package: ${list.map(j => j.name.slice(9, -1)).join(' · ')}`)],
  ['links', link('Links', 'Links'), firstLine(read('links.md'))],
  ['size', link('Size budget', 'Size budget'), (() => {
    const t = read('size.md');
    if (!t) return '';
    if (/Over budget/.test(t)) return firstLine(t.split('\n').find(l => /Over budget/.test(l)));
    const grew = t.split('\n').filter(l => l.includes('🔺')).length;
    const shrank = t.split('\n').filter(l => l.includes('🔻')).length;
    return `Within every budget${grew || shrank ? ` (${grew} bigger, ${shrank} smaller than the base)` : ', no change from the base'}`;
  })()],
  ['dependency-review', link('Dependency review', 'Dependency review'), firstLine(read('dependency-review.md'))],
  ['bench', link('Fix harness bench', 'Fix harness bench'), firstLine(read('bench.md'))],
  ['action', link('GitHub Action', 'GitHub Action'), firstLine(read('action.md'))],
];
const ICON = { success: '✅', failure: '❌', cancelled: '⏹️', skipped: '⏭️' };
for (const row of rows) {
  const s = status(row[0]);
  if (s === 'cancelled') row[2] = 'Cancelled';
  else if (s === 'skipped') row[2] = 'Skipped';
  else if (!row[2]) row[2] = s === 'failure' ? 'Failed: see below' : '';
}
const failed = rows.filter(([id]) => status(id) === 'failure');
const cancelled = rows.filter(([id]) => status(id) === 'cancelled');
const plain = name => name.replace(/^\[(.+?)\]\(.+\)$/, '$1');

const out = [
  MARKER,
  failed.length
    ? `### ❌ ${failed.length} check${failed.length === 1 ? '' : 's'} failed: ${failed.map(r => plain(r[1])).join(', ')}`
    : cancelled.length
      ? '### ⏹️ Checks were cancelled'
      : '### ✅ Every check passed',
  `<sub>Commit \`${sha.slice(0, 7)}\` · [the whole run](${runUrl}) · updated on every push</sub>`,
  '',
  '| | Check | Result |',
  '| :-: | --- | --- |',
  ...rows.map(r => `| ${status(r[0]) === 'success' && /^Not checked/.test(r[2]) ? '⏭️' : ICON[status(r[0])] || '❔'} | ${r[1]} | ${r[2]} |`),
];

// ------------------------------------------------------------------ what failed, and where
const failedJobs = jobs.filter(j => j.conclusion === 'failure' && j.name !== 'PR report');
if (failedJobs.length) {
  out.push('', '### Where it failed');
  for (const job of failedJobs) {
    out.push('', await whereItFailed(job));
    // the job's own note, when it says more than the table (failing tests, lint problems, dependency problems)
    const id = job.name.startsWith('Tests') ? `test-${job.name.match(/Node (\d+), (\S+)\)/)?.slice(1).reverse().join('-')}` : { Lint: 'lint', Links: 'links', 'Dependency review': 'dependency-review', 'Fix harness bench': 'bench', 'Size budget': 'size' }[job.name];
    const note = id ? read(`${id}.md`) : '';
    if (note && note.includes('\n')) out.push('', note);
  }
}

// ------------------------------------------------------------------ the details, folded
const details = (title, body) => (body ? ['', `<details><summary>${title}</summary>`, '', body, '', '</details>'] : []);
out.push(...details('Size: the package, the install and the dashboard', read('size.md')));
if (!failedJobs.some(j => j.name.startsWith('Tests'))) out.push(...details('Tests, run by run', notes('test-').join('\n\n')));
if (!failedJobs.some(j => j.name === 'Fix harness bench')) out.push(...details('Fix harness bench', read('bench.md')));
out.push('', '<sub>npm audit and Snyk run on `main` and weekly; on pull requests, Dependency review checks what changes, and Snyk\'s and Socket\'s apps report below when they are set up.</sub>');

console.log(out.join('\n'));
