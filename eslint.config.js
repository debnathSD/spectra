// Lint for correctness: undefined names, unused code, broken hooks. Formatting
// is left to the editor. `npm run lint`; CI runs it on every pull request.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/', 'node_modules/', 'fixtures/', 'video/', 'reports/', '.spectra/', 'vscode/node_modules/', 'vscode/.vscode-test/', 'bench/agents/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // the dashboard: React in the browser
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // runs inside the profiled page, as a classic script
  {
    files: ['server/probe.browser.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  // code passed to page.evaluate runs in the browser
  {
    files: ['server/signin.js', 'server/recorder.js', 'server/explore/**/*.js', 'scripts/**/*.mjs', 'bench/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // the VS Code extension is CommonJS
  {
    files: ['vscode/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
];
