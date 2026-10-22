#!/usr/bin/env node
/**
 * Posts spectra-bot's pull request report as one comment, and updates that same
 * comment on later runs. It also lists the checks other apps ran on the commit
 * (CodeQL, Socket, Snyk's app), so the comment covers everything.
 *
 * Runs in pr-comment.yml (a workflow_run, so it works for pull requests from
 * forks too, with the token of spectra-bot or, without the app, GitHub
 * Actions). The report itself is only ever posted as text.
 *
 *   GH_TOKEN=… REPO=owner/name HEAD_SHA=… HEAD_OWNER=… HEAD_BRANCH=… node scripts/ci/pr-comment.mjs [comment.md]
 */
import fs from 'node:fs';

const MARKER = '<!-- spectra-bot:checks -->';
const OTHERS = '<!-- spectra-bot:other-checks -->';
const { GH_TOKEN, REPO, HEAD_SHA, HEAD_OWNER, HEAD_BRANCH } = process.env;
const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: { authorization: `Bearer ${GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

// the pull request this commit belongs to (found from the branch, not from the run's own files)
const pulls = await api('GET', `/pulls?state=open&head=${encodeURIComponent(`${HEAD_OWNER}:${HEAD_BRANCH}`)}&per_page=10`);
const pr = pulls.find(p => p.head.sha === HEAD_SHA);
if (!pr) {
  console.log(`No open pull request has ${HEAD_SHA.slice(0, 7)} as its head (it moved on, or was closed): nothing to post.`);
  process.exit(0);
}

const comments = [];
for (let page = 1; page <= 10; page++) {
  const batch = await api('GET', `/issues/${pr.number}/comments?per_page=100&page=${page}`);
  comments.push(...batch);
  if (batch.length < 100) break;
}
const mine = comments.find(c => c.body?.startsWith(MARKER));

// the report: new from this run, or the one already posted (when only other checks changed)
const file = process.argv[2];
let report = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : mine?.body.split(OTHERS)[0].trim();
if (!report) {
  console.log('No report yet for this pull request: nothing to post.');
  process.exit(0);
}
report = report.slice(0, 60000);

// what other apps checked on the same commit
const runs = (await api('GET', `/commits/${HEAD_SHA}/check-runs?per_page=100`)).check_runs.filter(r => r.app?.slug !== 'github-actions' || /codeql|analy[sz]e/i.test(r.name));
const ICON = { success: '✅', failure: '❌', neutral: '➖', cancelled: '⏹️', skipped: '⏭️', timed_out: '⌛', action_required: '⚠️' };
const others = runs.length
  ? [
      OTHERS,
      '',
      '**Other checks on this commit**',
      '',
      ...runs.map(r => `- ${r.status === 'completed' ? ICON[r.conclusion] || '❔' : '⏳'} [${r.name}](${r.html_url})${r.app?.name && r.app.slug !== 'github-actions' ? ` · ${r.app.name}` : ''}${r.status === 'completed' ? '' : ' (running)'}`),
    ].join('\n')
  : '';

const body = [report, others].filter(Boolean).join('\n\n');
if (mine) {
  if (mine.body === body) console.log('The comment is up to date.');
  else await api('PATCH', `/issues/comments/${mine.id}`, { body });
} else await api('POST', `/issues/${pr.number}/comments`, { body });
console.log(`Report ${mine ? 'updated' : 'posted'} on #${pr.number}.`);
