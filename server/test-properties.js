// Property-based tests: the pure functions that decide what Spectra says and
// keeps, checked against thousands of generated inputs instead of a few
// examples. fast-check shrinks any failure to the smallest input that breaks it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { parseArgs } from './args.js';
import { judge, median, resourceName } from '../shared/compare.js';
import { rankFindings, scopeProblem } from './fix/policy.js';
import { jsLiteral } from './recorder.js';

const RUNS = { numRuns: 500 };
const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
const samples = fc.array(finite, { minLength: 1, maxLength: 9 });
const thresholds = fc.record({ minAbs: fc.double({ min: 0, max: 1000, noNaN: true }), minRel: fc.double({ min: 0, max: 1, noNaN: true }) });

test('median: between the smallest and the largest value, whatever the order', () => {
  fc.assert(
    fc.property(samples, fc.integer(), (xs, seed) => {
      const m = median(xs);
      assert.ok(m >= Math.min(...xs) && m <= Math.max(...xs));
      const shuffled = [...xs].sort((a, b) => ((a * 31 + seed) % 7) - ((b * 31 + seed) % 7));
      assert.equal(median(shuffled), m);
    }),
    RUNS,
  );
});

test('judge: the same runs on both sides are never a change; a verdict always points the way the medians moved', () => {
  fc.assert(
    fc.property(samples, thresholds, (xs, t) => {
      assert.equal(judge(xs, xs, t).verdict, 'same');
    }),
    RUNS,
  );
  fc.assert(
    fc.property(samples, samples, thresholds, (before, after, t) => {
      const j = judge(before, after, t);
      if (j.verdict === 'improved') assert.ok(j.delta < 0);
      if (j.verdict === 'degraded') assert.ok(j.delta > 0);
      // a change no bigger than the spread between runs is noise
      const spread = Math.max(Math.max(...before) - Math.min(...before), Math.max(...after) - Math.min(...after));
      if (Math.abs(j.delta) <= spread) assert.equal(j.verdict, 'same');
    }),
    RUNS,
  );
});

test('resourceName: a chunk is the same resource whatever hash and query string a build gives it', () => {
  const word = fc.stringMatching(/^[a-z][a-z-]{0,10}[a-z]$/);
  const hash = fc.stringMatching(/^[A-Za-z0-9_]{8}$/);
  const query = fc.option(fc.stringMatching(/^\?[a-z]=[0-9a-z]{1,8}$/), { nil: '' });
  fc.assert(
    fc.property(word, hash, hash, query, query, fc.constantFrom('js', 'mjs', 'css'), (name, h1, h2, q1, q2, ext) => {
      const a = resourceName(`${name}-${h1}.${ext}${q1} is 2.4 MB over the wire`);
      assert.equal(a, resourceName(`${name}-${h2}.${ext}${q2} is 2.4 MB over the wire`));
      assert.equal(resourceName(a), a, 'idempotent');
      assert.ok(!a.includes('?'));
    }),
    RUNS,
  );
});

test('jsLiteral: any JSON value goes into a page script as itself, and never as code', () => {
  fc.assert(
    fc.property(fc.jsonValue(), value => {
      const lit = jsLiteral(value);
      assert.ok(!/[<>/\u2028\u2029]/.test(lit), lit);
      assert.deepEqual((0, eval)(`(${lit})`), JSON.parse(JSON.stringify(value)));
    }),
    RUNS,
  );
  fc.assert(
    fc.property(fc.string({ unit: 'binary' }), s => assert.equal((0, eval)(jsLiteral(s)), s)),
    RUNS,
  );
});

test('parseArgs: every --name value pair reads back, and a value is never taken for a positional', () => {
  const name = fc.stringMatching(/^[a-z][a-z-]{0,8}$/);
  const value = fc.stringMatching(/^[a-z0-9./:]{1,12}$/);
  fc.assert(
    fc.property(fc.uniqueArray(fc.tuple(name, value), { selector: p => p[0], maxLength: 6 }), fc.array(value, { maxLength: 3 }), (pairs, positionals) => {
      const argv = [...positionals, ...pairs.flatMap(([n, v]) => [`--${n}`, v])];
      const { opt, positionals: pos } = parseArgs(argv, { values: pairs.map(p => p[0]) });
      for (const [n, v] of pairs) assert.equal(opt(n), v);
      assert.deepEqual(pos, positionals);
    }),
    RUNS,
  );
});

test("improve's rules: never a dependency's file, most costly first; never a change to package.json, a test or CI", () => {
  const file = fc.oneof(
    fc.stringMatching(/^src\/[A-Za-z]{1,8}\.(jsx|js|ts|vue)$/),
    fc.stringMatching(/^node_modules\/[a-z]{1,8}\/index\.js$/),
    fc.constant('https://cdn.example.com/x.js'),
  );
  const finding = fc.record({
    id: fc.uuid(),
    severity: fc.constantFrom('critical', 'warning', 'info'),
    title: fc.string({ maxLength: 20 }),
    impactMs: fc.nat(5000),
    file,
    line: fc.option(fc.nat(500), { nil: null }),
    culprits: fc.constant([]),
  });
  const RANK = { critical: 0, warning: 1 };
  fc.assert(
    fc.property(fc.array(finding, { maxLength: 15 }), fc.integer({ min: 1, max: 10 }), (findings, max) => {
      const { candidates } = rankFindings(findings, { exists: () => true, max });
      assert.ok(candidates.length <= max);
      for (const c of candidates) {
        assert.ok(c.file.startsWith('src/'), c.file);
        assert.ok(c.severity in RANK);
      }
      for (let i = 1; i < candidates.length; i++) {
        const [a, b] = [candidates[i - 1], candidates[i]];
        assert.ok(RANK[a.severity] < RANK[b.severity] || (a.severity === b.severity && a.impactMs >= b.impactMs));
      }
    }),
    RUNS,
  );
  const change = path => fc.record({ path: fc.constant(path), status: fc.constant('M'), added: fc.nat(20), removed: fc.nat(20) });
  const offLimits = fc.constantFrom('package.json', 'app/package-lock.json', 'vite.config.ts', 'src/Row.test.jsx', '.github/workflows/ci.yml', 'tests/e2e.js');
  fc.assert(
    fc.property(fc.array(fc.stringMatching(/^src\/[A-Za-z]{1,8}\.jsx$/), { maxLength: 3 }), offLimits, (ok, bad) => {
      const changes = [...ok.map(p => ({ path: p, status: 'M', added: 1, removed: 1 })), { path: bad, status: 'M', added: 1, removed: 0 }];
      assert.match(scopeProblem(changes), /may not touch/);
    }),
    RUNS,
  );
  fc.assert(fc.property(fc.array(change('src/Row.jsx'), { maxLength: 4 }), changes => {
    const lines = changes.reduce((n, c) => n + c.added + c.removed, 0);
    assert.equal(scopeProblem(changes) === null, lines <= 150);
  }), RUNS);
});
