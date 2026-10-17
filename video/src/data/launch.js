// Real Spectra output used by the launch film and the feature loops, all from
// the demo app on 17 October 2026 (or verbatim from the docs' real examples).

// `npx spectra performance` (golden paths), run from the project: 10.9 s end to end
export const ONE_COMMAND = {
  command: 'npx spectra performance',
  log: [
    'spectra: no --url given — starting the react/vite dev server …',
    'spectra: dev server ready at http://localhost:5199 — profiling …',
    'spectra: recording baseline page load …',
    'spectra: discovering actionable elements …',
    'spectra: 3 actionable elements (0 destructive skipped) → 3 golden paths',
    'spectra: [1/3] Click "Long task"',
    'spectra: [2/3] Click "Layout thrash"',
    'spectra: [3/3] Click "Layout shift"',
  ],
  seconds: '10.9 s',
  matrix: [
    { path: 'Initial page load', tbt: '0ms', lcp: '92ms', top: 'Row is slow to render: 1442ms' },
    { path: 'Click "Long task"', tbt: '213ms', lcp: '—', top: 'src/heavy.js spent 583ms of JavaScript' },
    { path: 'Click "Layout thrash"', tbt: '0ms', lcp: '—', top: 'src/heavy.js spent 340ms of JavaScript' },
    { path: 'Click "Layout shift"', tbt: '0ms', lcp: '—', top: 'Row is slow to render: 336ms' },
  ],
  summary: 'Automation: 3/3 golden paths passed.',
};

// the React components of one page load
export const COMPONENTS = [
  { name: 'Row', file: 'src/Row.jsx:3', renders: 7200, ms: 1442.1, wasted: 0 },
  { name: 'App', file: 'src/main.jsx:15', renders: 60, ms: 4.6, wasted: 0 },
  { name: 'Panel', file: 'src/Panel.jsx:4', renders: 60, ms: 0.4, wasted: 0 },
  { name: 'Wasted', file: 'src/Wasted.jsx:2', renders: 60, ms: 0, wasted: 59 },
];

// `spectra compare before.json after.json` (docs: Compare before and after)
export const COMPARE = {
  verdict: 'IMPROVED',
  confidence: 'medium',
  lines: [
    { label: 'JavaScript CPU time', before: '1.52 s', after: '92.1 ms', delta: '−94%' },
    { label: 'Row render time', before: '1.44 s', after: '7.4 ms', delta: '−99%' },
  ],
  findings: '3 resolved · 2 new · 10 still present',
};

// spectra.config.json budgets and the run that broke them (docs: Budgets and CI)
export const BUDGETS = {
  config: ['"budgets": {', '  "tbtMs": 200,', '  "scriptingMs": 500,', '  "criticalFindings": 0', '}'],
  checks: [
    { label: 'Total blocking time', value: '0 ms', limit: '200 ms', ok: true, fill: 0.04 },
    { label: 'Scripting time', value: '1.46 s', limit: '500 ms', ok: false, fill: 2.92 },
    { label: 'Critical findings', value: '3', limit: '0', ok: false, fill: 1.6 },
  ],
  exit: 'exit code 2',
};

// the GitHub Action's pull request report (docs: GitHub Action)
export const PR_REPORT = {
  title: '⚡ Spectra performance: ✅ Improved',
  confidence: 'Confidence: medium. A change counts only when it is bigger than the run-to-run noise.',
  headlines: ['Total blocking time: 587 ms → 0 ms (−100%)', 'Long tasks (> 50 ms): 1 → 0 (−100%)', 'JavaScript CPU time: 640 ms → 5.3 ms (−99%)'],
  rows: [
    ['Total blocking time', '587 ms', '0 ms'],
    ['Largest contentful paint', '656 ms', '24 ms'],
    ['Scripting time', '637 ms', '1.5 ms'],
  ],
};

export const SAFE = { blocked: ['Delete', 'Pay', 'Log out'], allowed: ['Search', 'Open settings', 'Next page'] };

export const RESULT_JSON = [
  '{',
  '  "kind": "profile",',
  '  "spectraVersion": "0.3.0",',
  '  "summary": {',
  '    "tbtMs": 0, "lcpMs": 120,',
  '    "scriptingMs": 1490,',
  '    "criticalFindings": 3',
  '  },',
  '  "findings": [ … ]',
  '}',
];

export const FRAMEWORKS = [
  { name: 'React', deep: true, color: '#58c4dc' },
  { name: 'Next.js', deep: true, color: '#e8e8e8' },
  { name: 'Vue', deep: true, color: '#42b883' },
  { name: 'Angular', deep: true, color: '#e03157' },
  { name: 'Svelte', deep: false, color: '#ff6a33' },
  { name: 'Any build', deep: false, color: '#9aa6c8' },
];

// every way to run it, all free
export const SURFACES = [
  { name: 'npm package', cmd: 'npm i -D @progen-labs/spectra' },
  { name: 'MCP server', cmd: 'npx -y @progen-labs/spectra mcp' },
  { name: 'Claude Code', cmd: '/plugin install spectra@progen-labs' },
  { name: 'VS Code', cmd: 'progen-labs.spectra-performance' },
  { name: 'GitHub Action', cmd: 'uses: progen-labs/spectra@v1' },
];
