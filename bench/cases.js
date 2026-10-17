// The test bench's cases. Each one sets up a copy of the React demo app
// (fixtures/demo-app), runs `spectra fix` on it, and states what the harness
// must decide. The scripted ("replay") agent applies a known change, so the
// harness's decisions are tested exactly; the real agent is scored on what it
// actually achieves.
export const CASES = [
  {
    id: 'memoize',
    what: 'A real fix: the expensive work in Row moves into useMemo, so it runs once per row instead of on every render.',
    patch: {
      file: 'src/Row.jsx',
      from: "import { burn } from './heavy.js';\n\nexport function Row({ index, onPick }) {\n  burn(0.15);",
      to: "import { useMemo } from 'react';\nimport { burn } from './heavy.js';\n\nexport function Row({ index, onPick }) {\n  useMemo(() => burn(0.15), []);",
    },
    expect: 'kept',
  },
  {
    id: 'breaks-page',
    what: 'Faster by cheating: Row stops rendering anything. The behaviour check must catch it.',
    patch: { file: 'src/Row.jsx', from: '  burn(0.15);\n  return (', to: '  return null;\n  return (' },
    expect: 'checks-failed',
  },
  {
    id: 'no-gain',
    what: 'A cosmetic change. It must not count as a fix.',
    patch: { file: 'src/Row.jsx', from: '  burn(0.15);', to: '  burn(0.15); // keep in sync with Panel' },
    expect: 'no-gain',
  },
  {
    id: 'touches-config',
    what: 'A change to package.json, which a fix may not touch.',
    patch: { file: 'package.json', from: '"private": true', to: '"private": true, "sideEffects": false' },
    expect: 'out-of-scope',
  },
];
