// The guided `spectra improve` session without a browser: measurements and
// comparisons are fakes, so what is tested is what Spectra decides and says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTask, checkText, nextTask, overall, reportMarkdown, reportText, startSession, taskText } from './session.js';

const finding = (title, file, extra = {}) => ({ id: `${title}-${file}`, severity: 'critical', title, impactMs: 500, file, line: 3, fix: 'memoize it', culprits: [{ fn: 'Row', file, line: 3, ms: 500 }], ...extra });
const own = [finding('Row is slow to render', 'src/Row.jsx', { impactMs: 1400 }), finding('heavy.js spent 586ms', 'src/heavy.js', { impactMs: 586 }), finding('App rendered 60×', 'src/App.jsx', { impactMs: 90, severity: 'warning' })];
const vendor = finding('react-dom is big', 'node_modules/react-dom/index.js');
const result = (findings, file = 'r.json') => ({ file, result: { url: 'http://localhost:5190/', summary: { tbtMs: 10 }, findings } });
const comparison = (verdict, confidence = 'medium', extra = {}) => ({
  verdict,
  confidence,
  headlines: verdict === 'improved' ? [{ kind: 'improved', text: 'JavaScript CPU time: 1.55 s → 107 ms (−93%)' }, { kind: 'improved', text: 'Row — render time: 1.44 s → 8 ms' }] : verdict === 'neutral' ? [] : [{ kind: 'degraded', text: 'Total blocking time: 0 ms → 300 ms' }],
  findings: { added: [], resolved: [], persisting: [], ...extra },
});

async function session(opts = {}) {
  const calls = [];
  const s = await startSession({
    profile: async label => {
      calls.push(label);
      return result([...own, vendor], 'baseline.json');
    },
    exists: f => !f.includes('Deleted'),
    checks: [{ name: 'npm test', cmd: 'npm test' }],
    meta: { id: 's1', dir: '/tmp/s1', runs: 3 },
    ...opts,
  });
  return { s, calls };
}

test('a session measures once, then queues the problems in the project\'s own code, costliest first', async () => {
  const { s, calls } = await session();
  assert.deepEqual(calls, ['baseline']);
  assert.equal(s.baseline.file, 'baseline.json');
  assert.deepEqual(s.current, ['baseline.json']);
  assert.deepEqual(
    s.queue.map(q => q.title),
    ['Row is slow to render', 'heavy.js spent 586ms', 'App rendered 60×'],
  );
  assert.equal(s.task, null);
  assert.equal(s.kept, 0);
  assert.deepEqual(s.checks, ['npm test']);
  // the same task until it is checked
  const task = nextTask(s);
  assert.equal(task.title, 'Row is slow to render');
  assert.equal(task.number, 1);
  assert.equal(nextTask(s), task);
  assert.equal(s.queue.length, 2);
  const text = taskText(task, { total: 3 });
  assert.match(text, /^Problem 1 of 3: Row is slow to render/);
  assert.match(text, /Where: src\/Row\.jsx:3/);
  assert.match(text, /Suggested fix: memoize it/);
  assert.match(text, /npx spectra improve check/);
});

test('a kept change moves the baseline on, and drops the queued problems it already solved', async () => {
  const { s } = await session();
  nextTask(s);
  const log = [];
  const { attempt, next } = await checkTask(s, {
    profile: async label => result([own[2]], `${label}.json`), // the slow row and heavy.js are gone
    compare: async (before, after) => {
      log.push([before, after]);
      return comparison('improved', 'high', { resolved: [{ title: 'Row is slow to render' }] });
    },
    runChecks: async () => [{ name: 'npm test', ok: true }],
  });
  assert.equal(attempt.outcome, 'kept');
  assert.match(attempt.reason, /JavaScript CPU time/);
  assert.deepEqual(attempt.checks, [{ name: 'npm test', ok: true }]);
  assert.deepEqual(log, [[['baseline.json'], ['after Row is slow to render-src/Row.jsx.json']]]);
  assert.equal(s.kept, 1);
  assert.deepEqual(s.current, ['after Row is slow to render-src/Row.jsx.json']);
  assert.equal(s.task, next);
  assert.equal(next.title, 'App rendered 60×', 'heavy.js was resolved by the kept change, so it is skipped');
  assert.equal(next.number, 2);
  assert.match(s.skipped[0].reason, /already resolved/);
  const text = checkText(attempt, next, { total: 3 });
  assert.match(text, /^✓ Kept: JavaScript CPU time/);
  assert.match(text, /also Row — render time/);
  assert.match(text, /Keep this change\./);
  assert.match(text, /Problem 2 of 3: App rendered 60×/);
});

test('a change that measures no better is to be undone; a failing check stops it before measuring', async () => {
  const { s } = await session();
  nextTask(s);
  let profiled = 0;
  const noGain = await checkTask(s, { profile: async () => (profiled++, result(own, 'a.json')), compare: async () => comparison('neutral'), runChecks: async () => [{ name: 'npm test', ok: true }] });
  assert.equal(noGain.attempt.outcome, 'no-gain');
  assert.equal(s.kept, 0);
  assert.deepEqual(s.current, ['baseline.json'], 'the baseline stays where it was');
  assert.equal(noGain.next.title, 'heavy.js spent 586ms');
  assert.match(checkText(noGain.attempt, noGain.next, { total: 3 }), /^✗ Undo this change: no measurable improvement.*\n {2}Revert the files you changed/);

  profiled = 0;
  const broken = await checkTask(s, { profile: async () => (profiled++, result(own)), compare: async () => comparison('improved'), runChecks: async () => [{ name: 'npm test', ok: false, tail: 'Error: rows 0' }] });
  assert.equal(broken.attempt.outcome, 'checks-failed');
  assert.equal(profiled, 0, 'a broken page is not measured');
  assert.match(checkText(broken.attempt, broken.next, { total: 3 }), /"npm test" failed[\s\S]*\| Error: rows 0/);
  assert.equal(broken.next.title, 'App rendered 60×');

  // low confidence measures again once, then gives up
  let n = 0;
  const unproven = await checkTask(s, { profile: async () => result(own, `p${n++}.json`), compare: async () => comparison('improved', 'low'), runChecks: async () => [{ name: 'npm test', ok: true }] });
  assert.equal(n, 2);
  assert.equal(unproven.attempt.outcome, 'unproven');
  assert.equal(unproven.next, null);
  assert.match(checkText(unproven.attempt, null, { total: 3 }), /No more problems to try\. Run: {2}npx spectra improve report/);
  await assert.rejects(checkTask(s, {}), /nothing to check/);
});

test('the report says what happened, and the overall change compares the baseline with the latest kept state', async () => {
  const { s } = await session();
  assert.match(reportText(s, null), /3 problems found in your own code/);
  nextTask(s);
  await checkTask(s, { profile: async () => result(own.slice(1), 'k1.json'), compare: async () => comparison('improved', 'high'), runChecks: async () => [{ name: 'npm test', ok: true }] });
  await checkTask(s, { profile: async () => result(own.slice(1), 'u1.json'), compare: async () => comparison('regressed'), runChecks: async () => [{ name: 'npm test', ok: true }] });
  const seen = [];
  const final = await overall(s, async (before, after) => (seen.push([before, after]), comparison('improved', 'high')));
  assert.deepEqual(seen, [[['baseline.json'], ['k1.json']]]);
  const text = reportText(s, final);
  assert.match(text, /^Spectra improve — 1 of 2 problems fixed/);
  assert.match(text, /✓ fixed .*Row is slow to render \(src\/Row\.jsx:3\): JavaScript CPU time/);
  assert.match(text, /✗ undone: slower .*heavy\.js spent 586ms/);
  assert.match(text, /Overall, before → after: IMPROVED \(confidence: high\)/);
  assert.match(text, /in your working tree, uncommitted/);
  const md = reportMarkdown(s, final);
  assert.match(md, /^## ⚡ Spectra improve: 1 of 2 problems fixed/);
  assert.match(md, /\| Row is slow to render \| `src\/Row\.jsx:3` \| ✅ fixed \|/);
  assert.match(md, /❌ undone: slower/);
  assert.equal(await overall({ kept: 0 }, async () => assert.fail('nothing kept, nothing to compare')), null);
});
