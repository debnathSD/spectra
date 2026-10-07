// Named test-*.js (not *.test.js): the repo's jest testRegex covers tools/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareSides,
  findingKey,
  formatDelta,
  formatPct,
  formatValue,
  judge,
  median,
} from '../shared/compare.js';
import {
  hashFromFileName,
  snapshotFileName,
  validateReport,
  withCommit,
} from '../shared/snapshot.js';

/** A realistic-enough report; override any section. */
function makeReport(over = {}) {
  const base = {
    id: '20260930T100000-load',
    createdAt: '2026-09-30T10:00:00.000Z',
    meta: {
      url: 'http://localhost:3000/pages/custom/579/?x=1',
      mode: 'load',
      durationMs: 10000,
      cpuThrottle: 1,
      navStatus: 200,
      attribution: 'webpack-markers',
      git: null,
      label: '',
    },
    vitals: {
      tbtMs: 1000,
      longTaskCount: 10,
      maxLongTaskMs: 400,
      inpMs: 300,
      lcpMs: 3000,
      fcpMs: 1500,
      cls: 0.05,
    },
    totals: {
      activeMs: 4000,
      scriptingMs: 3000,
      layoutMs: 100,
      styleMs: 200,
      paintMs: 100,
      gcMs: 100,
      compileMs: 50,
      layoutCount: 200,
      styleRecalcCount: 300,
      forcedLayoutCount: 100,
      forcedStyleCount: 100,
      forcedMs: 50,
    },
    memory: {
      domNodes: 5000,
      listeners: 800,
      heapGrowthMb: 20,
      heapUsedMb: 100,
    },
    network: { count: 120, totalEncoded: 5 * 1024 * 1024 },
    react: {
      detected: true,
      hasTimings: true,
      version: '17.0.2',
      components: [],
      commits: { count: 100, totalMs: 900, maxMs: 80 },
    },
    files: [],
    findings: [],
  };
  const merged = { ...base, ...over };
  for (const k of ['meta', 'vitals', 'totals', 'memory', 'network'])
    merged[k] = { ...base[k], ...(over[k] || {}) };
  merged.react = { ...base.react, ...(over.react || {}) };
  return merged;
}
const side = (reports, git) => ({ runs: reports, git });
const metric = (cmp, id) => cmp.metrics.find(m => m.id === id);

test('median, formatting and the significance test', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(formatValue('ms', 1534), '1.53 s');
  assert.equal(formatValue('ms', 42.34), '42.3 ms');
  assert.equal(formatValue('bytes', 5 * 1024 * 1024), '5.00 MB');
  assert.equal(formatPct(-0.424), '−42%');
  assert.equal(formatPct(0.1), '+10%');
  assert.equal(formatPct(null), 'new');
  assert.equal(formatDelta('ms', -250), '−250 ms');
  // below the absolute floor: 8 ms on a 20 ms metric is a 40 % change but still noise
  assert.equal(judge([20], [28], { minAbs: 50, minRel: 0.1 }).verdict, 'same');
  assert.equal(
    judge([1000], [400], { minAbs: 50, minRel: 0.1 }).verdict,
    'improved',
  );
  assert.equal(
    judge([1000], [1300], { minAbs: 50, minRel: 0.1 }).verdict,
    'degraded',
  );
  assert.equal(judge([null], [5], { minAbs: 1, minRel: 0.1 }).verdict, 'n/a');
});

test('run-to-run spread widens the band: a delta inside the noise is "same"', () => {
  // before: 100 and 400 (spread 300, median 250); after: 150 -> delta -100 < 300
  const noisy = judge([100, 400], [150], { minAbs: 50, minRel: 0.1 });
  assert.equal(noisy.verdict, 'same');
  assert.equal(noisy.threshold, 300);
  // tight runs on both sides make the same delta significant
  assert.equal(
    judge([250, 252, 248], [150, 151, 149], { minAbs: 50, minRel: 0.1 })
      .verdict,
    'improved',
  );
});

test('metrics are classified improved / degraded / same and the verdict follows the key metrics', () => {
  const before = makeReport();
  const after = makeReport({
    vitals: { tbtMs: 400, longTaskCount: 4 }, // key: improved
    totals: { activeMs: 4010, gcMs: 100 }, // key: same
    memory: { heapGrowthMb: 60 }, // key: degraded
  });
  const cmp = compareSides(side([before]), side([after]));
  assert.equal(metric(cmp, 'tbt').verdict, 'improved');
  assert.equal(metric(cmp, 'tbt').pct, -0.6);
  assert.equal(metric(cmp, 'cpu').verdict, 'same');
  assert.equal(metric(cmp, 'heapGrowth').verdict, 'degraded');
  assert.equal(cmp.verdict, 'mixed');
  assert.ok(cmp.counts.improved >= 2 && cmp.counts.degraded >= 1);
  assert.match(
    cmp.headlines.find(h => h.kind === 'improved').text,
    /Total blocking time: 1\.00 s → 400 ms \(−60%\)/,
  );
});

test('overall verdict: improved, regressed, neutral', () => {
  const base = makeReport();
  const better = makeReport({ vitals: { tbtMs: 300 } });
  const worse = makeReport({ vitals: { tbtMs: 3000 } });
  assert.equal(compareSides(side([base]), side([better])).verdict, 'improved');
  assert.equal(compareSides(side([base]), side([worse])).verdict, 'regressed');
  assert.equal(
    compareSides(side([base]), side([makeReport()])).verdict,
    'neutral',
  );
});

test('metrics unavailable on both sides (LCP in interaction mode) are n/a, not same', () => {
  const live = makeReport({
    meta: { mode: 'live' },
    vitals: { lcpMs: null, fcpMs: null },
  });
  const cmp = compareSides(side([live]), side([live]));
  assert.equal(metric(cmp, 'lcp').verdict, 'n/a');
  assert.ok(cmp.counts.unavailable >= 2);
});

const component = (name, over = {}) => ({
  name,
  file: `src/${name}.tsx`,
  line: 3,
  renders: 100,
  wasted: 0,
  selfMs: 10,
  vendor: false,
  ...over,
});

test('components: improved, degraded, added and removed are separated and ranked', () => {
  const before = makeReport({
    react: {
      components: [
        component('Row', { renders: 2000, wasted: 1500, selfMs: 400 }),
        component('Chart', { selfMs: 20 }),
        component('Gone', { renders: 80 }),
        component('Stable'),
      ],
    },
  });
  const after = makeReport({
    react: {
      components: [
        component('Row', { renders: 400, wasted: 30, selfMs: 60 }),
        component('Chart', { selfMs: 220 }),
        component('Fresh', { renders: 90, selfMs: 30 }),
        component('Stable'),
      ],
    },
  });
  const { components } = compareSides(side([before]), side([after]));
  assert.deepEqual(
    components.improved.map(c => c.name),
    ['Row'],
  );
  assert.deepEqual(
    components.degraded.map(c => c.name),
    ['Chart'],
  );
  assert.deepEqual(
    components.added.map(c => c.name),
    ['Fresh'],
  );
  assert.deepEqual(
    components.removed.map(c => c.name),
    ['Gone'],
  );
  assert.equal(components.unchanged, 1);
  const row = components.improved[0];
  assert.deepEqual(
    row.changes
      .filter(c => c.verdict === 'improved')
      .map(c => c.id)
      .sort(),
    ['renders', 'selfMs', 'wasted'],
  );
});

test('functions and files are compared by their own key', () => {
  const fn = (name, selfMs) => ({
    name,
    selfMs,
    totalMs: selfMs,
    line: 5,
    lineKind: 'located',
  });
  const file = (path, selfMs, functions) => ({
    path,
    selfMs,
    blockMs: selfMs,
    reactMs: 0,
    forcedCount: 0,
    vendor: false,
    functions,
  });
  const before = makeReport({
    files: [file('src/a.ts', 300, [fn('hot', 280)])],
  });
  const after = makeReport({ files: [file('src/a.ts', 50, [fn('hot', 30)])] });
  const cmp = compareSides(side([before]), side([after]));
  assert.equal(cmp.files.improved[0].name, 'src/a.ts');
  assert.equal(cmp.functions.improved[0].name, 'hot');
  assert.equal(cmp.functions.improved[0].file, 'src/a.ts');
});

test('findings: new, resolved and persisting are matched by stable key, not position', () => {
  const finding = (id, over = {}) => ({
    id,
    severity: 'warning',
    category: 'CPU',
    title: id,
    impactMs: 100,
    culprits: [],
    fix: 'fix',
    ...over,
  });
  const culprit = fn => ({ fn, file: 'src/a.ts', line: 1, ms: 1 });
  const before = makeReport({
    findings: [
      finding('long-task-0', { culprits: [culprit('burn')] }),
      finding('wasted-Row-src/Row.tsx', { severity: 'critical' }),
      finding('hot-file-src/old.ts'),
    ],
  });
  // the same long task is now at index 2, a new forced-reflow finding appeared, two were fixed
  const after = makeReport({
    findings: [
      finding('long-task-2', { culprits: [culprit('burn')], impactMs: 60 }),
      finding('forced-src/b.ts-measure', { severity: 'critical' }),
    ],
  });
  const { findings } = compareSides(side([before]), side([after]));
  assert.equal(findingKey(before.findings[0]), 'long-task:src/a.ts:burn');
  assert.deepEqual(
    findings.added.map(f => f.id),
    ['forced-src/b.ts-measure'],
  );
  assert.deepEqual(
    findings.resolved.map(f => f.id),
    ['wasted-Row-src/Row.tsx', 'hot-file-src/old.ts'],
  );
  assert.equal(findings.persisting.length, 1);
  assert.equal(findings.persisting[0].beforeImpactMs, 100);
});

test("a finding must appear in half of a side's runs to count", () => {
  const f = id => ({
    id,
    severity: 'warning',
    category: 'CPU',
    title: id,
    impactMs: 10,
    culprits: [],
    fix: '',
  });
  const runs = [
    makeReport({ findings: [f('flaky')] }),
    makeReport({ findings: [] }),
    makeReport({ findings: [] }),
  ];
  const cmp = compareSides(
    side(runs),
    side([makeReport(), makeReport(), makeReport()]),
  );
  assert.equal(
    cmp.findings.resolved.length,
    0,
    'seen in 1 of 3 runs: not established',
  );
});

test('comparability checks and confidence', () => {
  const a = makeReport({
    meta: { git: { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', dirty: false } },
  });
  const clean = compareSides(
    side([a, a, a]),
    side([makeReport(), makeReport(), makeReport()]),
  );
  assert.equal(clean.confidence, 'high');
  assert.ok(clean.checks.every(c => c.level === 'ok'));

  const single = compareSides(side([a]), side([makeReport()]));
  assert.equal(single.confidence, 'medium');
  assert.equal(single.checks.find(c => c.id === 'runs').level, 'warn');

  const differentPage = compareSides(
    side([a, a, a]),
    side([
      makeReport({ meta: { url: 'http://localhost:3000/dashboards/2/' } }),
      makeReport(),
      makeReport(),
    ]),
  );
  assert.equal(differentPage.checks.find(c => c.id === 'page').level, 'warn');

  const failed = compareSides(
    side([a]),
    side([makeReport({ meta: { navStatus: 500 } })]),
  );
  assert.equal(failed.confidence, 'low');
  assert.equal(failed.checks.find(c => c.id === 'failed-page').level, 'bad');

  const same = compareSides(side([a], a.meta.git), side([a], a.meta.git));
  assert.ok(same.checks.some(c => c.id === 'same-commit'));

  const dirty = compareSides(
    side([a]),
    side([makeReport()], { hash: 'b'.repeat(40), dirty: true }),
  );
  assert.ok(dirty.checks.some(c => c.id === 'dirty'));
});

test('commit and author come from the side override, else from the report', () => {
  const git = {
    hash: 'c'.repeat(40),
    shortHash: 'ccccccc',
    author: 'Ada Lovelace',
    subject: 'Memoise Row',
  };
  const fromReport = compareSides(
    side([makeReport({ meta: { git } })]),
    side([makeReport()]),
  );
  assert.equal(fromReport.before.git.author, 'Ada Lovelace');
  const override = compareSides(
    side([makeReport({ meta: { git } })], {
      hash: 'd'.repeat(40),
      author: 'Grace Hopper',
    }),
    side([makeReport()]),
  );
  assert.equal(override.before.git.author, 'Grace Hopper');
  assert.equal(compareSides(side([]), side([makeReport()])), null);
});

test('snapshot helpers: validation, commit in the file name, labelled copies', () => {
  assert.equal(validateReport(makeReport()).ok, true);
  assert.equal(validateReport({ traceEvents: [] }).ok, false);
  assert.match(validateReport([{}]).reason, /raw Chrome trace/);
  assert.equal(validateReport({ foo: 1 }).ok, false);

  assert.equal(
    hashFromFileName('perf_3fa516cd22_load_20260930-1548.json'),
    '3fa516cd22',
  );
  assert.equal(
    hashFromFileName('my run 938be3d83b9 after.json'),
    '938be3d83b9',
  );
  assert.equal(
    hashFromFileName('20260930T100000-live.json'),
    '',
    'a date is not a commit',
  );
  assert.equal(hashFromFileName('report.json'), '');

  const report = makeReport();
  const git = {
    hash: '3fa516cd22c30f21e2cb4803378dc7a88dd2a4b2',
    shortHash: '3fa516cd22',
  };
  assert.equal(
    snapshotFileName(report, git, 'Dashboard 579!'),
    'perf_3fa516cd22_load_20260930-100000_dashboard-579.json',
  );
  assert.equal(
    snapshotFileName(report, null, ''),
    'perf_nocommit_load_20260930-100000.json',
  );
  const labelled = withCommit(report, git, 'x');
  assert.equal(labelled.meta.git.shortHash, '3fa516cd22');
  assert.equal(report.meta.git, null, 'the original is not mutated');
});

test('the PDF html escapes names coming from the profiled app and differs by variant', async () => {
  const { renderComparisonHtml } = await import('./pdf/template.js');
  const evil = '<img src=x onerror=alert(1)>';
  const git = {
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaa',
    author: 'Ada <b>Lovelace</b>',
    subject: 'x',
    date: '2026-09-30T10:00:00Z',
  };
  const before = makeReport({
    react: {
      components: [component(evil, { renders: 900, wasted: 800, selfMs: 300 })],
    },
    findings: [
      {
        id: 'wasted-x',
        severity: 'critical',
        category: 'React',
        title: evil,
        impactMs: 5,
        culprits: [{ fn: evil, file: 'src/a.tsx', line: 1 }],
        fix: 'f',
      },
    ],
  });
  const after = makeReport({
    react: {
      components: [component(evil, { renders: 10, wasted: 0, selfMs: 5 })],
    },
  });
  const cmp = compareSides(
    side([before], git),
    side([after], { ...git, hash: 'b'.repeat(40), shortHash: 'bbbbbbb' }),
  );
  const summary = renderComparisonHtml(cmp, 'summary');
  const detailed = renderComparisonHtml(cmp, 'detailed');
  for (const html of [summary, detailed]) {
    assert.ok(
      !html.includes('<img src=x'),
      'raw markup must never reach the document',
    );
    assert.ok(!html.includes('<b>Lovelace'), 'author is escaped too');
    assert.ok(html.includes('aaaaaaa') && html.includes('bbbbbbb'));
    assert.ok(html.includes('&lt;img'));
  }
  assert.ok(
    detailed.length > summary.length * 1.3,
    'the detailed report carries more',
  );
  assert.match(detailed, /Methodology/);
  assert.doesNotMatch(summary, /Methodology/);
  assert.match(summary, /Improved|Regressed|Mixed|No significant change/);
});
