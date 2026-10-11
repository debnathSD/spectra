#!/usr/bin/env node
/**
 * Spectra CLI — a Progen Labs project.
 *
 *   spectra performance [--url <page>] [profiler options]   profile a frontend
 *   spectra dashboard                                        open the dashboard UI
 *   spectra --help                                           show this help
 *   spectra --version                                        print the version
 *
 * When Spectra is installed in a project, it profiles THAT project: reports are
 * written under the current working directory (.spectra/reports) and the project
 * root is used for source lookup, unless the matching PERF_* env var overrides it.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, '..');
const pkg = JSON.parse(
  readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'),
);

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);

const HELP = `
Spectra ${pkg.version} — frontend performance profiler (Progen Labs)

Usage:
  spectra performance [options]   Profile a frontend build and report the culprits
  spectra dashboard               Open the Spectra dashboard UI
  spectra --help, -h              Show this help
  spectra --version, -v           Print the version

performance options (passed through to the profiler):
  --url <page>          Page to profile (e.g. http://localhost:3000/)
  --mode live|load      Live session (default) or page-load recording
  --duration <seconds>  Live recording length (default 8)
  --throttle <n>        CPU throttle multiplier (default 1)
  --scenario <file.mjs> Script a live session: export default async page => {…}
  --headed              Show the browser window
  --save-trace          Keep the raw Chrome trace alongside the report
  --sign-in <url>       Sign-in URL template, e.g. "http://host/login/?redirect={url}"

Examples:
  spectra performance --url http://localhost:3000/ --mode load
  spectra performance --url http://localhost:5173/ --duration 10 --throttle 4
`;

function runNode(scriptRelPath, args, extraEnv = {}) {
  const child = spawn(
    process.execPath,
    [path.join(PKG_ROOT, scriptRelPath), ...args],
    {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    },
  );
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => {
    console.error(`spectra: failed to start — ${err.message}`);
    process.exit(1);
  });
}

/**
 * Default the profiled project and the reports location to the user's current
 * directory, so an installed Spectra profiles the host project and writes
 * reports there rather than inside node_modules. Explicit PERF_* vars win.
 */
function projectEnv() {
  const cwd = process.cwd();
  const env = {};
  if (!process.env.PERF_FRONTEND_DIR && !process.env.FRONTEND_DIR) {
    env.PERF_FRONTEND_DIR = cwd;
  }
  if (!process.env.PERF_REPORTS_DIR) {
    env.PERF_REPORTS_DIR = path.join(cwd, '.spectra', 'reports');
  }
  return env;
}

function runProfile() {
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(HELP);
    return;
  }
  runNode('server/cli.js', rest, projectEnv());
}

function runDashboard() {
  // Phase 1: reuse the existing Vite dev server. A standalone server that
  // serves a prebuilt dashboard is coming in a later phase.
  const child = spawn('npx', ['vite'], {
    cwd: PKG_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...projectEnv() },
  });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => {
    console.error(`spectra: failed to start the dashboard — ${err.message}`);
    process.exit(1);
  });
}

switch (command) {
  case 'performance':
  case 'perf':
    runProfile();
    break;
  case 'dashboard':
  case 'ui':
    runDashboard();
    break;
  case '--version':
  case '-v':
    console.log(pkg.version);
    break;
  case undefined:
  case '--help':
  case '-h':
  case 'help':
    console.log(HELP);
    break;
  default:
    console.error(`spectra: unknown command "${command}"`);
    console.log(HELP);
    process.exit(1);
}
