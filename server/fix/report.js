/**
 * The session report: a Markdown summary for people (and pull requests) and
 * the JSON behind it.
 */
const OUTCOME = {
  kept: '✅ kept',
  'no-change': '➖ no change',
  'out-of-scope': '⛔ out of scope',
  'checks-failed': '❌ checks failed',
  'no-gain': '➖ no measurable gain',
  slower: '❌ slower',
  mixed: '⚠️ mixed',
  'new-problem': '❌ new problem',
  unproven: '➖ not proven',
  'agent-error': '⚠️ agent error',
};

export function reportMarkdown(s) {
  const lines = [
    `## ⚡ Spectra fix: ${s.kept} of ${s.attempts.length} finding${s.attempts.length === 1 ? '' : 's'} fixed`,
    '',
    `Agent: ${s.agent} · checks: ${s.checks.length ? s.checks.join(', ') : 'none'} · ${s.runs} page-load runs per measurement${s.branch && s.kept ? ` · branch \`${s.branch}\`` : ''}`,
    '',
  ];
  if (s.final) {
    lines.push(`**Overall, before → after all kept fixes:** ${s.final.verdict} (confidence: ${s.final.confidence})`, '', ...s.final.headlines.map(h => `- ${h.kind === 'improved' ? '✅' : '❌'} ${h.text}`), '');
  }
  if (s.attempts.length) {
    lines.push('| Finding | Where | Outcome | Why |', '| --- | --- | --- | --- |');
    for (const a of s.attempts)
      lines.push(`| ${a.finding.title.replace(/\|/g, '\\|')} | \`${a.finding.file}${a.finding.line ? `:${a.finding.line}` : ''}\` | ${OUTCOME[a.outcome] || a.outcome}${a.commit ? ` (${a.commit})` : ''} | ${(a.reason || '').replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  for (const a of s.attempts.filter(x => x.summary)) lines.push(`- **${a.finding.title}**: ${a.summary}`);
  if (s.skipped.length) lines.push('', 'Skipped:', ...s.skipped.map(x => `- ${x.title}: ${x.reason}`));
  lines.push('', '<sub>Every kept change passed the checks and measured faster beyond run-to-run noise. Review it like any other change.</sub>');
  return `${lines.join('\n')}\n`;
}
