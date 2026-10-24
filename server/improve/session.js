/**
 * The guided mode of `spectra improve`: Spectra measures and decides, and
 * whoever is at the keyboard (an AI agent, or a person) edits the code in the
 * working tree.
 *
 *   next     measure, when nothing is measured yet; then the next problem to fix
 *   check    measure the change just made: kept, or to be undone; then the next problem
 *   report   what has happened so far
 *   stop     end the session
 *
 * The session is a JSON file, so each command is one short run and the state
 * survives between them. Everything that measures, compares or runs checks is
 * passed in, so the logic is tested without a browser (test-improve.js). The
 * rules (which findings, when a change is kept) are the unattended mode's,
 * from ../fix/policy.js, so both modes decide the same way.
 */
import { findingKey } from '../../shared/compare.js';
import { judge, rankFindings } from '../fix/policy.js';

export const SESSION_VERSION = 1;

const where = f => `${f.file}${f.line ? `:${f.line}` : ''}`;
const ms = v => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Starts a session: measures the baseline and queues the problems worth a
 * try. `o.profile(label)` resolves with { file, result }; `o.exists(file)`
 * says whether a finding's file is in the project.
 */
export async function startSession(o) {
  const { profile, exists, history = {}, retry = false, maxFixes = 5, checks = [], meta = {} } = o;
  const baseline = await profile('baseline');
  const { candidates, skipped } = rankFindings(baseline.result.findings, { exists, history, retry, max: maxFixes });
  return {
    version: SESSION_VERSION,
    ...meta,
    startedAt: new Date().toISOString(),
    url: baseline.result.url,
    checks: checks.map(c => c.name),
    baseline: { file: baseline.file, summary: baseline.result.summary, findings: baseline.result.findings.length },
    current: [baseline.file],
    queue: candidates.map(f => ({ key: f.key, title: f.title, file: f.file, line: f.line, severity: f.severity, impactMs: f.impactMs, detail: f.detail, fix: f.fix, culprits: f.culprits, seenIn: f.seenIn })),
    task: null,
    attempts: [],
    skipped: skipped.map(s => ({ title: s.finding.title, reason: s.reason })),
    kept: 0,
  };
}

/** The problem to work on: the one handed out already, or the next in the queue. Null when there is none left. */
export function nextTask(session) {
  if (!session.task && session.queue.length) session.task = { ...session.queue.shift(), number: session.attempts.length + 1 };
  return session.task;
}

/**
 * Measures the change made for the current task and decides: kept, or to be
 * undone. The task is done either way; the next one is handed out. Resolves
 * with the attempt (outcome, reason, headlines, checks) and the next task.
 */
export async function checkTask(session, o) {
  const { profile, compare, runChecks, log = () => {} } = o;
  const task = session.task;
  if (!task) throw new Error('nothing to check: run `spectra improve next` first, make the change it describes, then check it.');
  const attempt = { finding: { title: task.title, file: task.file, line: task.line, severity: task.severity, impactMs: task.impactMs, key: task.key }, outcome: null, reason: '', headlines: [], checks: [] };
  const done = (outcome, reason, extra = {}) => {
    Object.assign(attempt, { outcome, reason, ...extra });
    session.attempts.push(attempt);
    session.task = null;
    return { attempt, next: nextTask(session) };
  };

  if (session.checks.length && runChecks) {
    log(`running the checks (${session.checks.join(', ')}) …`);
    const results = await runChecks();
    attempt.checks = results.map(r => ({ name: r.name, ok: r.ok }));
    const failed = results.find(r => !r.ok);
    if (failed) return done('checks-failed', `"${failed.name}" failed`, { checkTail: failed.tail });
  }

  log('measuring the change …');
  const after = [await profile(`after ${attempt.finding.key}`)];
  let comparison = await compare(session.current, after.map(a => a.file));
  let verdict = judge(comparison);
  if (verdict.decision === 'measure-again') {
    log('improved with low confidence; measuring again …');
    after.push(await profile(`after ${attempt.finding.key}, more runs`));
    comparison = await compare(session.current, after.map(a => a.file));
    verdict = judge(comparison);
    if (verdict.decision === 'measure-again') verdict = { decision: 'discard', outcome: 'unproven', reason: 'not proven: still low confidence after more runs' };
  }
  attempt.comparison = { verdict: comparison.verdict, confidence: comparison.confidence, resolved: comparison.findings.resolved.map(x => x.title), added: comparison.findings.added.map(x => x.title) };
  if (verdict.decision !== 'keep') return done(verdict.outcome, verdict.reason);

  session.current = after.map(a => a.file);
  session.kept++;
  // one fix often clears several problems: drop the queued ones the new measurement no longer shows
  const present = new Set(after.flatMap(a => a.result.findings || []).map(findingKey));
  const gone = session.queue.filter(f => !present.has(f.key));
  session.queue = session.queue.filter(f => present.has(f.key));
  for (const f of gone) session.skipped.push({ title: f.title, reason: 'already resolved by an earlier kept change' });
  return done('kept', verdict.reason, { headlines: verdict.headlines });
}

/** The session's before → after, when something was kept; needs `compare` (no browser). */
export async function overall(session, compare) {
  if (!session.kept) return null;
  const c = await compare([session.baseline.file], session.current);
  return { verdict: c.verdict, confidence: c.confidence, headlines: c.headlines, resolved: c.findings.resolved.map(x => x.title) };
}

// ------------------------------------------------------------------ words

/** The task, as instructions for whoever makes the change. */
export function taskText(task, { total, command = 'npx spectra improve check' }) {
  const culprits = (task.culprits || []).slice(0, 4).map(c => `    ${c.fn || '(anonymous)'}()${c.file ? ` in ${c.file}${c.line ? `:${c.line}` : ''}` : ''}${c.ms ? `: ${ms(c.ms)}` : ''}${c.note ? ` (${c.note})` : ''}`);
  return [
    `Problem ${task.number} of ${total}: ${task.title}`,
    `  Where: ${where(task)}`,
    `  Cost: about ${ms(task.impactMs)}${task.seenIn ? `, seen in ${task.seenIn} runs` : ''}`,
    ...(task.detail ? [`  Detail: ${task.detail}`] : []),
    ...(culprits.length ? ['  Where the time went:', ...culprits] : []),
    ...(task.fix ? [`  Suggested fix: ${task.fix}`] : []),
    '',
    `Make ONE focused change in ${task.file} that removes or reduces this cost, keeping the behaviour exactly the same:`,
    'the same output, UI and data. Edit only the source files involved (not package.json, lockfiles, configuration,',
    'tests or CI), keep the change small, and do not delete features or hide content to look faster.',
    `Then run:  ${command}`,
  ].join('\n');
}

const OUTCOME = {
  kept: 'fixed',
  'checks-failed': 'undone: a check failed',
  'no-gain': 'undone: no measurable gain',
  slower: 'undone: slower',
  mixed: 'undone: mixed',
  'new-problem': 'undone: new problem',
  unproven: 'undone: not proven',
};

/** What happened to the change just checked, and what to do now. */
export function checkText(attempt, next, { total, command = 'npx spectra improve check', reportCommand = 'npx spectra improve report' }) {
  const lines = [];
  if (attempt.outcome === 'kept') {
    lines.push(`✓ Kept: ${attempt.reason}`, ...attempt.headlines.slice(1).map(h => `  also ${h}`));
    if (attempt.comparison?.resolved.length) lines.push(`  Resolved: ${attempt.comparison.resolved.slice(0, 3).join('; ')}`);
    if (attempt.checks.length) lines.push(`  Checks passed: ${attempt.checks.map(c => c.name).join(', ')}.`);
    lines.push('  Keep this change.');
  } else {
    lines.push(`✗ Undo this change: ${attempt.reason}.`);
    if (attempt.outcome === 'checks-failed' && attempt.checkTail) lines.push(...attempt.checkTail.split('\n').slice(-6).map(l => `  | ${l}`));
    lines.push('  Revert the files you changed for this problem (and only those), then continue.');
  }
  lines.push('');
  if (next) lines.push(taskText(next, { total, command }));
  else lines.push(`No more problems to try. Run:  ${reportCommand}`);
  return lines.join('\n');
}

/** The session so far, in plain words. */
export function reportText(session, result, { workingTree = true } = {}) {
  const tried = session.attempts.length;
  const lines = [`Spectra improve — ${session.kept} of ${plural(tried, 'problem')} fixed${session.task ? ` (one being worked on)` : ''}${session.queue.length ? `, ${session.queue.length} still to try` : ''}`];
  for (const a of session.attempts) lines.push(`  ${a.outcome === 'kept' ? '✓' : '✗'} ${(OUTCOME[a.outcome] || a.outcome).padEnd(28)} ${a.finding.title} (${where(a.finding)})${a.outcome === 'kept' ? `: ${a.reason}` : a.reason ? ` — ${a.reason}` : ''}`);
  if (session.task) lines.push(`  … in progress                ${session.task.title} (${where(session.task)})`);
  if (result) {
    lines.push('', `Overall, before → after: ${result.verdict.toUpperCase()} (confidence: ${result.confidence})`, ...result.headlines.map(h => `  ${h.kind === 'improved' ? '✓' : '✗'} ${h.text}`));
  } else if (!tried) lines.push('', session.queue.length ? `${plural(session.queue.length, 'problem')} found in your own code. Run:  npx spectra improve next` : 'Nothing in your own code crossed Spectra\'s thresholds: nothing to fix.');
  if (session.skipped.length) lines.push('', 'Not attempted:', ...session.skipped.slice(0, 6).map(s => `  – ${s.title}: ${s.reason}`));
  if (session.kept && workingTree) lines.push('', 'The kept changes are in your working tree, uncommitted. Review them with `git diff`, then commit.');
  return lines.join('\n');
}

/** The report as Markdown, for a pull request. */
export function reportMarkdown(session, result) {
  const lines = [`## ⚡ Spectra improve: ${session.kept} of ${plural(session.attempts.length, 'problem')} fixed`, '', `Page: ${session.url} · checks: ${session.checks.length ? session.checks.join(', ') : 'none'}`, ''];
  if (result) lines.push(`**Overall, before → after:** ${result.verdict} (confidence: ${result.confidence})`, '', ...result.headlines.map(h => `- ${h.kind === 'improved' ? '✅' : '❌'} ${h.text}`), '');
  if (session.attempts.length) {
    lines.push('| Problem | Where | Outcome | Why |', '| --- | --- | --- | --- |');
    for (const a of session.attempts) lines.push(`| ${a.finding.title.replace(/\|/g, '\\|')} | \`${where(a.finding)}\` | ${a.outcome === 'kept' ? '✅ fixed' : `❌ ${OUTCOME[a.outcome] || a.outcome}`} | ${(a.reason || '').replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  if (session.skipped.length) lines.push('Not attempted:', ...session.skipped.map(s => `- ${s.title}: ${s.reason}`), '');
  lines.push('<sub>Every kept change measured faster beyond run-to-run noise. Review it like any other change.</sub>');
  return `${lines.join('\n')}\n`;
}
