/**
 * The loop of `spectra fix`: measure, hand one finding to an agent, check its
 * change, measure again, and keep the change only if it measurably helped.
 * Everything it touches is passed in (profile, compare, agent, workspace,
 * checks), so the loop itself is tested without a browser or a model.
 */
import { fixPrompt, judge, rankFindings, scopeProblem } from './policy.js';

// agent errors no other finding would get past: stop instead of trying them all
const FATAL = /not logged in|\/login|authenticat|api key|credit balance|was not found|could not start/i;

/**
 * @param {object} o
 * @param {(label: string) => Promise<{file: string, result: object}>} o.profile
 * @param {(before: string[], after: string[]) => Promise<object>} o.compare   spectra compare's comparison
 * @param {{name: string, run: Function}} o.agent
 * @param {object} o.workspace   { projectDir, exists(file), changes(), diff(), commit(files, message), undo() }
 * @param {() => Promise<{name: string, ok: boolean}[]>} o.runChecks
 * @param {{name: string}[]} o.checks
 * @returns {Promise<object>} the session: baseline, attempts, overall comparison
 */
export async function runFix(o) {
  const { profile, compare, agent, workspace: ws, runChecks, checks = [], log = () => {}, maxFixes = 3, maxLines = 150, history = {}, retry = false, url, signal } = o;
  const session = { agent: agent.name, checks: checks.map(c => c.name), attempts: [], skipped: [], baseline: null, final: null, kept: 0 };

  if (checks.length) {
    log(`running the checks before any change (${checks.map(c => c.name).join(', ')}) …`);
    const before = await runChecks();
    const failed = before.find(r => !r.ok);
    if (failed) throw Object.assign(new Error(`"${failed.name}" fails before any change, so it cannot tell a good fix from a bad one. Fix it first, or choose checks with --check.`), { tail: failed.tail });
  }

  log('measuring the baseline …');
  const baseline = await profile('baseline');
  session.baseline = { file: baseline.file, summary: baseline.result.summary, url: baseline.result.url };
  let current = [baseline.file];

  const { candidates, skipped } = rankFindings(baseline.result.findings, { exists: ws.exists, history, retry, max: maxFixes });
  session.skipped = skipped.map(s => ({ title: s.finding.title, reason: s.reason }));
  if (!candidates.length) {
    log('no findings in your own code to fix.');
    return session;
  }
  log(`${candidates.length} finding${candidates.length === 1 ? '' : 's'} to attempt, most costly first.`);

  for (const [i, f] of candidates.entries()) {
    if (signal?.aborted) break;
    const n = `${i + 1}/${candidates.length}`;
    const attempt = { finding: { title: f.title, file: f.file, line: f.line, severity: f.severity, impactMs: f.impactMs, key: f.key }, outcome: null, reason: '', changes: [] };
    session.attempts.push(attempt);
    const discard = (outcome, reason) => {
      ws.undo();
      Object.assign(attempt, { outcome, reason });
      log(`[${n}] ✗ ${reason} — change undone.`);
    };

    log(`[${n}] ${f.title} — ${f.file}${f.line ? `:${f.line}` : ''}`);
    log(`[${n}] asking ${agent.name} for one focused change …`);
    const t0 = Date.now();
    try {
      const res = await agent.run(fixPrompt(f, { url }), { cwd: ws.projectDir, signal, finding: attempt.finding });
      Object.assign(attempt, { summary: res.summary, costUsd: res.costUsd, agentMs: Date.now() - t0 });
      if (res.error) throw new Error(res.error);
    } catch (err) {
      discard('agent-error', `the agent failed: ${err.message}`);
      if (FATAL.test(err.message)) throw Object.assign(new Error(`${agent.name} cannot work: ${err.message}`), { session });
      continue;
    }

    const changes = ws.changes();
    attempt.changes = changes;
    if (!changes.length) {
      Object.assign(attempt, { outcome: 'no-change', reason: 'the agent made no change' });
      log(`[${n}] – the agent made no change.`);
      continue;
    }
    attempt.diff = ws.diff();
    log(`[${n}] changed ${changes.map(c => `${c.path} (+${c.added} −${c.removed})`).join(', ')}${attempt.summary ? `: ${attempt.summary}` : ''}`);
    const problem = scopeProblem(changes, { maxLines });
    if (problem) {
      discard('out-of-scope', problem);
      continue;
    }

    if (checks.length) {
      log(`[${n}] running the checks …`);
      const results = await runChecks();
      attempt.checks = results.map(r => ({ name: r.name, ok: r.ok }));
      const failed = results.find(r => !r.ok);
      if (failed) {
        attempt.checkTail = failed.tail;
        discard('checks-failed', `"${failed.name}" failed`);
        continue;
      }
    }

    log(`[${n}] measuring the change …`);
    const after = [await profile(`after ${i + 1}`)];
    let comparison = await compare(current, after.map(a => a.file));
    let verdict = judge(comparison);
    if (verdict.decision === 'measure-again') {
      log(`[${n}] improved with low confidence; measuring again …`);
      after.push(await profile(`after ${i + 1}, more runs`));
      comparison = await compare(current, after.map(a => a.file));
      verdict = judge(comparison);
      if (verdict.decision === 'measure-again') verdict = { decision: 'discard', outcome: 'unproven', reason: 'not proven: still low confidence after more runs' };
    }
    attempt.comparison = { verdict: comparison.verdict, confidence: comparison.confidence, headlines: comparison.headlines, resolved: comparison.findings.resolved.map(x => x.title), added: comparison.findings.added.map(x => x.title) };
    if (verdict.decision !== 'keep') {
      discard(verdict.outcome, verdict.reason);
      continue;
    }

    const message = [
      `perf: ${f.title.replace(/\s+/g, ' ').slice(0, 72)}`,
      '',
      ...(attempt.summary ? [attempt.summary, ''] : []),
      `Verified by spectra fix: ${comparison.verdict} (confidence: ${comparison.confidence}).`,
      ...verdict.headlines.map(h => `- ${h}`),
      ...(attempt.checks?.length ? [`Checks passed: ${attempt.checks.map(c => c.name).join(', ')}.`] : []),
      `Finding: ${f.file}${f.line ? `:${f.line}` : ''}`,
    ].join('\n');
    attempt.commit = ws.commit(
      changes.map(c => c.path),
      message,
    );
    Object.assign(attempt, { outcome: 'kept', reason: verdict.reason });
    session.kept++;
    current = after.map(a => a.file);
    log(`[${n}] ✓ kept (${attempt.commit}): ${verdict.reason}`);
  }

  if (session.kept) {
    const overall = await compare([baseline.file], current);
    session.final = { verdict: overall.verdict, confidence: overall.confidence, headlines: overall.headlines, resolved: overall.findings.resolved.map(x => x.title) };
  }
  return session;
}
