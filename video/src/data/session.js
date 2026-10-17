// Real output of Spectra's MCP server on the demo app (profile_page, then a
// one-line change, then verify_change), as recorded on 17 October 2026. The
// Claude Code and MCP videos show these lines verbatim or shortened, never
// invented numbers.
export const PROFILE = {
  seconds: '14.7 s',
  url: 'http://localhost:5188/',
  resultFile: '.spectra/results/profile-20261017T045006.json',
  metrics: [
    ['TBT', '0 ms'],
    ['LCP', '120 ms'],
    ['Scripting', '1.49 s'],
    ['DOM', '816 nodes'],
  ],
  findingCount: 13,
  findings: [
    {
      title: 'Row is slow to render: 1441ms total, 0.2ms per render (7200×)',
      where: 'src/Row.jsx:3',
      cost: '1.44 s',
      fix: 'Move expensive calculations into useMemo, virtualise long lists, and avoid deriving large data structures inside render.',
    },
    { title: 'src/heavy.js spent 1425ms of JavaScript (92% of CPU)', where: 'src/heavy.js:2', cost: '1.43 s' },
  ],
};

export const CHANGE = { file: 'src/Row.jsx', before: '  burn(0.15);', after: '  burn(0);' };

export const VERIFY = {
  seconds: '14.3 s',
  verdict: 'IMPROVED',
  confidence: 'medium',
  runs: '3 runs before, 3 after',
  headlines: [
    { label: 'JavaScript CPU time', before: '1.55 s', after: '107 ms', delta: '−93%' },
    { label: 'Row (src/Row.jsx) render time', before: '1.44 s', after: '8.3 ms', delta: '−99%' },
  ],
  scripting: { label: 'Scripting', before: '1.49 s', after: '52 ms' },
  findings: '2 resolved, 1 new, 11 still present',
};
