// End-to-end: runs the extension inside a real, isolated VS Code against the
// demo app (start it first with `npm run demo` in the repository root).
'use strict';

const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '../../..');
// VS Code's IPC socket lives in the user-data folder and its path must stay
// under 103 characters, so keep that folder short.
const USER_DATA = path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'spectra-vscode-e2e');

runTests({
  extensionDevelopmentPath: path.resolve(__dirname, '../..'),
  extensionTestsPath: path.resolve(__dirname, 'suite.js'),
  launchArgs: [
    path.join(ROOT, 'fixtures', 'demo-app'),
    `--user-data-dir=${USER_DATA}`,
    '--disable-extensions',
    '--skip-welcome',
    '--skip-release-notes',
  ],
  extensionTestsEnv: {
    SPECTRA_E2E_CLI: path.join(ROOT, 'bin', 'spectra.js'),
    SPECTRA_E2E_URL: process.env.SPECTRA_E2E_URL || 'http://localhost:5188/',
  },
}).catch(err => {
  console.error(err);
  process.exit(1);
});
