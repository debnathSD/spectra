import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeCpuProfile,
  extractCpuProfile,
  windowSelf,
} from './analysis/cpu.js';
import { buildFindings } from './analysis/findings.js';
import { analyzeTrace, findMainThread } from './analysis/trace.js';

const PID = 1;
const TID = 2;
const meta = {
  ph: 'M',
  name: 'thread_name',
  pid: PID,
  tid: TID,
  args: { name: 'CrRendererMain' },
};
const x = (name, ts, dur, args = {}) => ({
  ph: 'X',
  name,
  pid: PID,
  tid: TID,
  ts,
  dur,
  args,
  cat: 'devtools.timeline',
});

test('long tasks are broken down by category and blamed on their trigger', () => {
  const events = [
    meta,
    x('RunTask', 0, 10_000),
    x('RunTask', 20_000, 120_000),
    x('EventDispatch', 20_500, 110_000, { data: { type: 'click' } }),
    x('FunctionCall', 21_000, 100_000, {
      data: { functionName: 'onClick', url: 'a.js' },
    }),
    x('Layout', 90_000, 20_000, {
      beginData: { totalObjects: 500, dirtyObjects: 3 },
    }),
    x('UpdateLayoutTree', 112_000, 6_000),
  ];
  const t = analyzeTrace(events, findMainThread(events));
  assert.equal(t.tasks.length, 2);
  assert.equal(t.longTasks.length, 1);
  const [long] = t.longTasks;
  assert.equal(long.trigger.type, 'click handler');
  assert.equal(long.breakdown.layout, 20_000);
  assert.equal(long.breakdown.style, 6_000);
  // EventDispatch self 10ms + FunctionCall self 74ms (its nested layout and style are counted separately)
  assert.equal(long.breakdown.scripting, 84_000);
  assert.equal(t.maxLayoutObjects, 500);
});

test('layout inside script is a forced reflow; three in one task is thrashing', () => {
  const events = [
    meta,
    x('RunTask', 0, 100_000),
    x('FunctionCall', 100, 90_000),
  ];
  for (let i = 0; i < 4; i += 1)
    events.push(
      x('Layout', 1000 + i * 10_000, 2000, {
        beginData: {
          stackTrace: [
            {
              functionName: 'measure',
              url: 'a.js',
              scriptId: '7',
              lineNumber: 4,
              columnNumber: 2,
            },
          ],
        },
      }),
    );
  events.push(x('Layout', 95_000, 1000)); // outside script: normal layout
  const t = analyzeTrace(events, findMainThread(events));
  assert.equal(t.forced.length, 4);
  assert.equal(t.forced[0].stack[0].functionName, 'measure');
  assert.equal(t.tasks[0].thrash, true);
  assert.equal(t.counts.layout, 5);
});

test('CPU profile chunks are paired with their header and attributed to files', () => {
  // Real traces: the Profile header is on the main thread, chunks come from V8's helper thread.
  const HELPER = 77;
  const chunk = (id, nodes, samples, deltas, ts = 0) => ({
    ph: 'P',
    name: 'ProfileChunk',
    pid: PID,
    tid: HELPER,
    id,
    ts,
    args: { data: { cpuProfile: { nodes, samples }, timeDeltas: deltas } },
  });
  const events = [
    {
      ph: 'P',
      name: 'Profile',
      pid: PID,
      tid: TID,
      id: '0x1',
      ts: 5,
      args: { data: { startTime: 1000 } },
    },
    // a second profiler in the same process (e.g. a WebUI page) reuses id 0x1 and node ids
    {
      ph: 'P',
      name: 'Profile',
      pid: PID,
      tid: 99,
      id: '0x1',
      ts: 6,
      args: { data: { startTime: 50 } },
    },
    chunk(
      '0x1',
      [
        {
          id: 1,
          callFrame: { functionName: '(root)', url: '', scriptId: '0' },
        },
        {
          id: 2,
          parent: 1,
          callFrame: {
            functionName: 'render',
            url: 'http://h/src/a.js',
            scriptId: '1',
            lineNumber: 3,
          },
        },
        {
          id: 3,
          parent: 2,
          callFrame: {
            functionName: 'work',
            url: 'http://h/src/b.js',
            scriptId: '2',
            lineNumber: 1,
          },
        },
        {
          id: 4,
          parent: 3,
          callFrame: { functionName: 'sort', url: '', scriptId: '0' },
        },
        {
          id: 5,
          parent: 1,
          callFrame: { functionName: '(idle)', url: '', scriptId: '0' },
        },
      ],
      [3, 3, 4, 5, 5],
      [0, 1000, 1000, 1000, 1000],
      10,
    ),
    chunk(
      '0x1',
      [
        {
          id: 1,
          callFrame: { functionName: '(root)', url: '', scriptId: '0' },
        },
        {
          id: 2,
          parent: 1,
          callFrame: { functionName: 'other', url: 'x', scriptId: '9' },
        },
      ],
      [2],
      [10],
      11,
    ),
  ];
  const profile = extractCpuProfile(events, PID, TID);
  assert.equal(profile.startTime, 1000);
  assert.equal(profile.samples.length, 5);
  const cpu = analyzeCpuProfile(profile, cf => ({
    file: cf.url.replace('http://h/', ''),
    vendor: false,
    pkg: null,
    line: cf.lineNumber + 1,
    name: cf.functionName,
    exact: true,
  }));
  const byFile = Object.fromEntries(cpu.files.map(f => [f.file, f]));
  // 'sort' is a builtin (no url): its time is blamed on the caller, b.js
  assert.equal(byFile['src/b.js'].selfUs, 3000);
  assert.equal(byFile['src/a.js'].selfUs, 0);
  assert.equal(byFile['src/a.js'].totalUs, 3000);
  // timestamps are on the trace clock: startTime + cumulative deltas
  const inWindow = windowSelf(cpu, 1000, 3500);
  assert.equal([...inWindow.values()].reduce((a, b) => a + b, 0) > 0, true);
});

test('findings rank critical React and layout problems with concrete fixes', () => {
  const base = {
    vitals: {
      tbtMs: 0,
      longTaskCount: 0,
      maxLongTaskMs: 0,
      cls: 0,
      shifts: [],
      lcpMs: null,
      fcpMs: null,
    },
    files: [],
    longTasks: [],
    forcedReflows: [],
    thrashTasks: 0,
    interactions: [],
    totals: { activeMs: 1000, gcMs: 0, compileMs: 0 },
    memory: { domNodes: 100, listeners: 10, heapGrowthMb: 0 },
    network: { uncompressed: [], large: [], slow: [] },
    meta: { durationMs: 5000 },
    react: {
      detected: true,
      hasTimings: true,
      slowCommits: [],
      components: [
        {
          name: 'Row',
          file: 'src/Row.tsx',
          line: 3,
          renders: 100,
          mounts: 1,
          wasted: 80,
          selfMs: 50,
          totalMs: 60,
          wastedMs: 40,
          reasons: {},
          unstableProps: [{ prop: 'onPick', kind: 'function', count: 90 }],
          topParent: 'List',
        },
      ],
    },
  };
  const findings = buildFindings(base);
  const wasted = findings.find(f => f.id.startsWith('wasted-'));
  assert.equal(wasted.severity, 'critical');
  assert.match(wasted.fix, /React\.memo/);
  assert.ok(
    findings.some(
      f => f.id.startsWith('unstable-') && /useCallback/.test(f.fix),
    ),
  );
});

test('a recording of an HTTP error page leads with a critical setup finding', () => {
  const report = {
    vitals: {
      tbtMs: 0,
      longTaskCount: 0,
      maxLongTaskMs: 0,
      cls: 0,
      shifts: [],
      lcpMs: null,
      fcpMs: null,
    },
    files: [],
    longTasks: [],
    forcedReflows: [],
    thrashTasks: 0,
    interactions: [],
    totals: { activeMs: 10, gcMs: 0, compileMs: 0 },
    memory: { domNodes: 5, listeners: 0, heapGrowthMb: 0 },
    network: { uncompressed: [], large: [], slow: [] },
    meta: {
      durationMs: 3000,
      navStatus: 500,
      navUrl: 'http://localhost:3000/login/',
    },
    react: {
      detected: false,
      hasTimings: false,
      slowCommits: [],
      components: [],
    },
  };
  const [first] = buildFindings(report);
  assert.equal(first.id, 'page-failed');
  assert.equal(first.severity, 'critical');
  assert.match(first.title, /HTTP 500/);
});

test('function definitions are located by name in the real source', async () => {
  const { findDefinitionLine, searchableName } = await import(
    './analysis/locate.js'
  );
  const source = [
    "import x from 'y';",
    'const helper = () => 1;',
    'export function buildRows(data) {',
    '  return data.map(d => d.id);',
    '}',
    'class Grid {',
    '  componentDidUpdate(prev) {',
    '    this.run(prev);',
    '  }',
    '}',
    'export const Toolbar = memo(function Toolbar() {});',
  ].join('\n');
  assert.equal(findDefinitionLine(source, 'buildRows'), 3);
  assert.equal(findDefinitionLine(source, 'Grid'), 6);
  assert.equal(findDefinitionLine(source, 'Grid.componentDidUpdate'), 7);
  assert.equal(findDefinitionLine(source, 'helper'), 2);
  assert.equal(findDefinitionLine(source, 'Toolbar'), 11);
  assert.equal(findDefinitionLine(source, '(anonymous in buildRows)'), 3);
  assert.equal(findDefinitionLine(source, 'nope'), null);
  // a bare call is not a definition
  assert.equal(findDefinitionLine('  run(prev);\nfunction run() {}', 'run'), 2);
  assert.equal(searchableName('(anonymous)'), null);
});

test('anonymous callbacks are named after the function they live in', () => {
  const events = [
    {
      ph: 'P',
      name: 'Profile',
      pid: 1,
      tid: 2,
      id: '0x1',
      ts: 0,
      args: { data: { startTime: 0 } },
    },
    {
      ph: 'P',
      name: 'ProfileChunk',
      pid: 1,
      tid: 2,
      id: '0x1',
      ts: 0,
      args: {
        data: {
          cpuProfile: {
            nodes: [
              {
                id: 1,
                callFrame: { functionName: '(root)', url: '', scriptId: '0' },
              },
              {
                id: 2,
                parent: 1,
                callFrame: {
                  functionName: 'renderRows',
                  url: 'http://h/src/a.js',
                  scriptId: '1',
                  lineNumber: 4,
                },
              },
              {
                id: 3,
                parent: 2,
                callFrame: {
                  functionName: '',
                  url: 'http://h/src/a.js',
                  scriptId: '1',
                  lineNumber: 6,
                },
              },
              {
                id: 4,
                parent: 1,
                callFrame: {
                  functionName: 'lodashSort',
                  url: 'http://h/node_modules/lodash/lodash.js',
                  scriptId: '2',
                  lineNumber: 1,
                },
              },
            ],
            samples: [3, 3, 3],
          },
          timeDeltas: [0, 1000, 1000],
        },
      },
    },
  ];
  // renderRows -> (anonymous); lodash called directly under the root has no app caller
  const profile = extractCpuProfile(events, 1, 2);
  profile.nodes.find(n => n.id === 4).parent = 3; // make lodash a callee of the anonymous callback
  profile.samples = [4, 4, 3];
  const cpu = analyzeCpuProfile(profile, cf => ({
    file: cf.url.replace('http://h/', ''),
    vendor: cf.url.includes('node_modules'),
    pkg: cf.url.includes('node_modules') ? 'lodash' : null,
    line: cf.lineNumber + 1,
    name: cf.functionName,
    exact: false,
  }));
  const names = cpu.functions.map(f => f.name);
  assert.ok(names.includes('(anonymous in renderRows)'));
  const drivers = [...cpu.vendorDrivers.get('lodash').values()];
  assert.equal(drivers[0].name, '(anonymous in renderRows)');
});

test('sign-in URLs embed the page to return to and detect a signed-out landing', async () => {
  const { buildSignInUrl, looksSignedOut } = await import('./signin.js');
  assert.equal(
    buildSignInUrl(
      'http://h/login/?redirect={url}',
      'http://h/path/to/page/?edit=true&x=1#top',
    ),
    'http://h/login/?redirect=%2Fpath%2Fto%2Fpage%2F%3Fedit%3Dtrue%26x%3D1%23top',
  );
  assert.equal(buildSignInUrl('', 'http://h/p'), null);
  assert.equal(
    buildSignInUrl('http://h/login', 'http://h/p'),
    'http://h/login',
  );
  assert.equal(
    looksSignedOut({ status: 500 }, 'http://h/login/?next=/p'),
    true,
  );
  assert.equal(looksSignedOut(null, 'http://h/login/?next=/p'), true);
  assert.equal(
    looksSignedOut({ status: 200 }, 'http://h/path/to/page/1'),
    false,
  );
});
