/**
 * The rules of `spectra fix`: which findings to attempt, what an agent may
 * change, and when a change has earned its place. Pure functions, so the
 * rules are tested on their own (test-fix.js).
 */
import { findingKey } from '../../shared/compare.js';

const SEVERITY = { critical: 0, warning: 1 };

/** A finding's source file, when it points into the project (not a dependency or a URL). */
export function ownFile(f) {
  const file = f.file || f.culprits?.find(c => c.file)?.file || null;
  if (!file || /^[a-z]+:\/\//i.test(file) || /(^|\/)node_modules\//.test(file) || file.startsWith('/@') || file.startsWith('..')) return null;
  return file.replace(/^\.\//, '');
}

/**
 * The findings worth an attempt, most costly first: critical or warning,
 * pointing at a file in the project, one per place in the code, and not one
 * that failed in an earlier session (unless retry).
 *
 * @param {object[]} findings   brief findings from a profile result
 * @param {object} o
 * @param {(file: string) => boolean} o.exists
 * @param {Record<string, {outcome: string}>} [o.history]
 * @returns {{ candidates: object[], skipped: {finding: object, reason: string}[] }}
 */
export function rankFindings(findings, { exists, history = {}, retry = false, max = 3 }) {
  const candidates = [];
  const skipped = [];
  const taken = new Set();
  const ordered = [...(findings || [])].sort(
    (a, b) => (SEVERITY[a.severity] ?? 9) - (SEVERITY[b.severity] ?? 9) || (b.impactMs || 0) - (a.impactMs || 0),
  );
  for (const f of ordered) {
    if (!(f.severity in SEVERITY)) continue;
    const file = ownFile(f);
    if (!file || !exists(file)) continue;
    const key = findingKey(f);
    const spot = `${file}:${f.line ?? ''}`;
    if (taken.has(spot) || taken.has(key)) continue;
    const past = history[key];
    if (past && past.outcome !== 'kept' && !retry) {
      skipped.push({ finding: f, reason: `an earlier attempt was ${past.outcome.replace(/-/g, ' ')} (use --retry to try again)` });
      continue;
    }
    taken.add(spot);
    taken.add(key);
    candidates.push({ ...f, file, key });
    if (candidates.length >= max) break;
  }
  return { candidates, skipped };
}

// files an agent must not touch: dependencies, tooling, tests and CI
const OFF_LIMITS = [
  /(^|\/)package\.json$/,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /(^|\/)[^/]*\.config\.[cm]?[jt]s$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)\.(eslintrc|prettierrc|babelrc)[^/]*$/,
  /(^|\/)spectra\.config\.json$/,
  /(^|\/)(__tests__|__snapshots__|tests?|e2e|cypress|playwright)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)\.github\//,
  /(^|\/)\.spectra\//,
];

/**
 * What is wrong with a proposed change, if anything.
 * @param {{path: string, status: string, added: number, removed: number}[]} changes
 */
export function scopeProblem(changes, { maxLines = 150 } = {}) {
  if (!changes.length) return null;
  const deleted = changes.find(c => c.status === 'D');
  if (deleted) return `deleted ${deleted.path}`;
  const forbidden = changes.find(c => OFF_LIMITS.some(re => re.test(c.path)));
  if (forbidden) return `changed ${forbidden.path}, which a fix may not touch (dependencies, configuration, tests and CI are off limits)`;
  const lines = changes.reduce((n, c) => n + c.added + c.removed, 0);
  if (lines > maxLines) return `${lines} changed lines, more than the ${maxLines} allowed for one focused fix`;
  return null;
}

/**
 * Keep, discard or measure again, from spectra compare's comparison of the
 * code before the change with the code after it.
 */
export function judge(c) {
  if (!c) return { decision: 'discard', outcome: 'not-measured', reason: 'nothing to compare' };
  const worse = c.headlines.filter(h => h.kind === 'degraded').map(h => h.text);
  const better = c.headlines.filter(h => h.kind === 'improved').map(h => h.text);
  if (c.verdict === 'regressed') return { decision: 'discard', outcome: 'slower', reason: `slower: ${worse[0] || 'a key metric got worse'}` };
  if (c.verdict === 'mixed') return { decision: 'discard', outcome: 'mixed', reason: `mixed: ${worse[0] || 'something got worse'}` };
  if (c.verdict !== 'improved') return { decision: 'discard', outcome: 'no-gain', reason: 'no measurable improvement: every change was within run-to-run noise' };
  // a new critical problem in the project's own code counts; one in a dependency or a network
  // resource (a vendor chunk the dev server renamed between runs) is not something the change made
  const critical = c.findings.added.find(f => f.severity === 'critical' && ownFile(f));
  if (critical) return { decision: 'discard', outcome: 'new-problem', reason: `introduced a critical finding: ${critical.title}` };
  if (c.confidence === 'low') return { decision: 'measure-again', outcome: 'unproven', reason: 'improved, but with low confidence' };
  return { decision: 'keep', outcome: 'kept', reason: better[0] || 'improved', headlines: better };
}

/** The instructions an agent gets for one finding. */
export function fixPrompt(f, { url } = {}) {
  const culprits = (f.culprits || [])
    .slice(0, 5)
    .map(c => `  - ${c.fn || '(anonymous)'}${c.file ? ` in ${c.file}${c.line ? `:${c.line}` : ''}` : ''}${c.ms ? `: ${c.ms} ms` : ''}${c.note ? ` (${c.note})` : ''}`);
  return [
    'Fix one frontend performance problem that Spectra, a profiler, measured in this project.',
    '',
    `Finding: ${f.title}`,
    `Where: ${f.file}${f.line ? `:${f.line}` : ''}`,
    `Cost: about ${f.impactMs} ms${f.seenIn ? `, seen in ${f.seenIn} runs` : ''}`,
    ...(f.detail ? [`Detail: ${f.detail}`] : []),
    ...(culprits.length ? ['Where the time went:', ...culprits] : []),
    ...(f.fix ? [`Suggested fix: ${f.fix}`] : []),
    '',
    'Make ONE focused change that removes or reduces this cost.',
    'Rules:',
    '- Keep the behaviour exactly the same: the same output, UI and data. Never delete features, skip work the page needs, or hide content to look faster.',
    '- Edit only the source files involved. Do not edit package.json, lockfiles, configuration, tests or CI files, and do not delete files.',
    '- Keep the change small: a few lines to a few dozen.',
    "- Do not run commands. Spectra runs the project's checks and measures the change after you finish.",
    ...(url ? [`- The app is served at ${url} while you work, if you want to read it.`] : []),
    '',
    'When you are done, reply with one sentence that describes the change.',
  ].join('\n');
}
