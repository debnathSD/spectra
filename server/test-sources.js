import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SourceResolver,
  indexWebpackModules,
  moduleAt,
  normalizePath,
  packageOf,
} from './analysis/sources.js';

const ROOT = '/repo/target-frontend';

test('normalizePath handles every bundler spelling', () => {
  assert.equal(
    normalizePath('webpack://superset/./src/a/b.tsx?1a2b', ROOT),
    'src/a/b.tsx',
  );
  assert.equal(
    normalizePath('webpack-internal:///./src/a/b.tsx', ROOT),
    'src/a/b.tsx',
  );
  assert.equal(
    normalizePath(
      './node_modules/react-dom/cjs/react-dom.development.js',
      ROOT,
    ),
    'node_modules/react-dom/cjs/react-dom.development.js',
  );
  assert.equal(
    normalizePath('../node_modules/lodash/lodash.js', ROOT),
    'node_modules/lodash/lodash.js',
  );
  assert.equal(
    normalizePath(`${ROOT}/packages/superset-ui-core/src/x.ts`, ROOT),
    'packages/superset-ui-core/src/x.ts',
  );
  assert.equal(normalizePath('./src/a.tsx + 3 modules', ROOT), 'src/a.tsx');
});

test('packageOf finds npm package names, including scoped and vite-prebundled ones', () => {
  assert.equal(packageOf('node_modules/react/index.js'), 'react');
  assert.equal(
    packageOf('node_modules/@emotion/react/dist/x.js'),
    '@emotion/react',
  );
  assert.equal(
    packageOf('node_modules/.vite/deps/react-dom_client.js'),
    'react-dom',
  );
  assert.equal(packageOf('src/app.ts'), null);
});

const bundle = [
  '(() => {',
  '/******/ var __webpack_modules__ = ({',
  '',
  '/***/ "./src/a.tsx":',
  '/*!******************!*\\',
  '  !*** ./src/a.tsx ***!',
  '  \\******************/',
  '/***/ ((module) => {',
  'function a() {}',
  '/***/ }),',
  '',
  '/***/ "./node_modules/left-pad/index.js":',
  '/***/ ((module) => {',
  'function pad() {}',
  '/***/ })',
  '/******/ });',
].join('\n');

test('the inlined entry module is found through its banner comment', () => {
  const source = [
    '/***/ "./src/a.tsx":',
    '/***/ ((m) => { function a() {} }),',
    '/******/ });',
    '// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.',
    '(() => {',
    '/*!******************!*\\',
    '  !*** ./src/main.jsx ***!',
    '  \\******************/',
    'function App() {}',
    '})();',
  ].join('\n');
  const markers = indexWebpackModules(source);
  assert.equal(moduleAt(markers, 1), './src/a.tsx');
  assert.equal(moduleAt(markers, 8), './src/main.jsx');
});

test('webpack module markers map bundle lines back to module ids', () => {
  const markers = indexWebpackModules(bundle);
  assert.deepEqual(
    markers.map(m => m.id),
    ['./src/a.tsx', './node_modules/left-pad/index.js'],
  );
  assert.equal(moduleAt(markers, 8), './src/a.tsx');
  assert.equal(moduleAt(markers, 13), './node_modules/left-pad/index.js');
  assert.equal(moduleAt(markers, 1), null);
});

test('resolver falls back from source map to markers to URLs', async () => {
  const scripts = new Map([
    ['1', { url: 'http://localhost:9000/static/assets/main.js' }],
    ['2', { url: 'http://localhost:5177/src/App.jsx?t=1' }],
    ['3', { url: 'pptr:evaluate;x' }],
    ['4', { url: 'http://localhost:9000/static/assets/app.abcdef12.chunk.js' }],
  ]);
  const resolver = new SourceResolver({
    root: ROOT,
    scripts,
    getSource: async id => (id === '1' ? bundle : 'console.log(1)'),
  });
  await resolver.prepare(['1', '2', '3', '4']);
  assert.equal(
    resolver.resolve('1', scripts.get('1').url, 8, 0).file,
    'src/a.tsx',
  );
  const vendor = resolver.resolve('1', scripts.get('1').url, 13, 0);
  assert.deepEqual(
    [vendor.file, vendor.vendor, vendor.pkg],
    ['node_modules/left-pad/index.js', true, 'left-pad'],
  );
  assert.equal(
    resolver.resolve('2', scripts.get('2').url, 0, 0).file,
    'src/App.jsx',
  );
  assert.equal(
    resolver.resolve('3', scripts.get('3').url, 0, 0).file,
    '(injected)',
  );
  assert.equal(
    resolver.resolve('4', scripts.get('4').url, 0, 0).file,
    'bundle:app.abcdef12.chunk.js',
  );
  assert.deepEqual([...resolver.kinds].sort(), ['urls', 'webpack-markers']);
});
