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
import { bootDevServer } from '../server/explore/boot.js';
import { detectFramework } from '../server/framework.js';

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

Run it from inside your project. With no --url, Spectra detects the framework,
starts your dev server (npm run dev/start/serve), profiles it, then shuts it
down. Reports are written to .spectra/reports in the current directory.

performance options:
  --url <page>          Profile an already-running page; skips self-boot
  --command "<cmd>"     Override the dev-server command (default: your npm dev script)
  --boot-timeout <s>    How long to wait for the dev server (default 60)
  --mode live|load      Live session (default) or page-load recording
  --duration <seconds>  Live recording length (default 8)
  --throttle <n>        CPU throttle multiplier (default 1)
  --scenario <file.mjs> Script a live session: export default async page => {…}
  --headed              Show the browser window
  --save-trace          Keep the raw Chrome trace alongside the report
  --sign-in <url>       Sign-in URL template, e.g. "http://host/login/?redirect={url}"

Examples:
  spectra performance                              # self-boot + profile
  spectra performance --mode load                  # self-boot, page-load recording
  spectra performance --url http://localhost:3000/ # profile a running server
`;

function runNodeAsync(scriptRelPath, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(PKG_ROOT, scriptRelPath), ...args],
      {
        cwd: PKG_ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...extraEnv },
      },
    );
    child.on('exit', code => resolve(code ?? 0));
    child.on('error', reject);
  });
}

/** Pull `--name value` out of an argv array, returning the value and the rest. */
function takeOption(args, name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return { value: undefined, rest: args };
  const copy = args.slice();
  const [, value] = copy.splice(i, 2);
  return { value, rest: copy };
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

async function runProfile() {
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(HELP);
    return 0;
  }
  const env = projectEnv();

  // An explicit --url means the server is already running: profile it directly.
  if (rest.includes('--url')) {
    return runNodeAsync('server/cli.js', rest, env);
  }

  // No --url: self-boot the target project's own dev server, profile, stop.
  const cwd = process.cwd();
  const { value: command, rest: afterCmd } = takeOption(rest, 'command');
  const { value: bootTimeout, rest: profileArgs } = takeOption(afterCmd, 'boot-timeout');
  const fw = detectFramework(cwd);
  const label =
    fw.framework !== 'unknown' ? `${fw.framework}/${fw.bundler}` : fw.bundler;
  // Status goes to stderr so it never mixes with the report on stdout.
  console.error(
    `spectra: no --url given — starting the ${label} dev server in ${cwd} …`,
  );

  let server;
  try {
    server = await bootDevServer({
      root: cwd,
      command,
      timeoutMs: bootTimeout ? Number(bootTimeout) * 1000 : 60_000,
    });
  } catch (err) {
    console.error(`spectra: ${err.message}`);
    return 1;
  }
  console.error(`spectra: dev server ready at ${server.url} — profiling …\n`);

  let code = 1;
  try {
    code = await runNodeAsync(
      'server/cli.js',
      [...profileArgs, '--url', server.url],
      env,
    );
  } finally {
    await server.stop();
    console.error('\nspectra: stopped the dev server.');
  }
  return code;
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
    runProfile()
      .then(code => process.exit(code ?? 0))
      .catch(err => {
        console.error(`spectra: ${err.message}`);
        process.exit(1);
      });
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
