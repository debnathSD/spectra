#!/usr/bin/env node
/**
 * Spectra CLI — a Progen Labs project.
 *
 *   spectra performance [--url <page>] [profiler options]   profile a frontend
 *   spectra compare <before> <after>                         before vs after, noise-aware
 *   spectra reports                                          list saved reports
 *   spectra mcp [--project <dir>]                            MCP server for AI tools (stdio)
 *   spectra fix [options]                                    the AI fix harness: fix, check, verify
 *   spectra dashboard                                        open the dashboard UI
 *   spectra --help                                           show this help
 *   spectra --version                                        print the version
 *
 * When Spectra is installed in a project, it profiles THAT project: reports are
 * written under the current working directory (.spectra/reports) and the project
 * root is used for source lookup, unless the matching PERF_* env var overrides it.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  spectra compare <before> <after> [options]
                                  Compare two profiles; a change counts only when
                                  it is bigger than the noise between runs
  spectra reports [--json]        List saved reports (ids for compare / dashboard)
  spectra mcp [--project <dir>] [--allow-remote]
                                  Run as an MCP server (stdio) for Claude Code,
                                  Cursor, VS Code and other AI tools
  spectra fix [options]           The AI fix harness: an agent fixes the costliest
                                  findings in a copy of your code; a change is kept
                                  only if your checks pass and it measures faster
                                  (spectra fix --help for its options)
  spectra dashboard               Open the Spectra dashboard UI
  spectra --help, -h              Show this help
  spectra --version, -v           Print the version

Run it from inside your project. With no --url, Spectra detects the framework,
starts your dev server (npm run dev/start/serve), evaluates it, then shuts it
down. By default it records a baseline page load, auto-discovers the actionable
elements, synthesizes golden-path journeys, runs them (safe actions only), and
prints a performance matrix. Every path is saved as a report you can open in
the dashboard. Reports go to .spectra/reports in the current directory.

performance options:
  --url <page>          Evaluate an already-running page; skips self-boot
  --paths <n>           Max golden paths to run (default 12)
  --command "<cmd>"     Override the dev-server command (default: your npm dev script)
  --boot-timeout <s>    How long to wait for the dev server (default 60)
  --headed              Show the browser window
  --sign-in <url>       Sign-in URL template, e.g. "http://host/login/?redirect={url}"

quick single-page profile (opt in with --quick, --mode or --scenario):
  --quick               One page-load profile (about 15 s): the fast loop
  --runs <n>            Record n times and report the median (with --quick/--mode)
  --mode live|load      Live session or page-load recording
  --duration <seconds>  Live recording length (default 8)
  --throttle <n>        CPU throttle multiplier (default 1)
  --scenario <file.mjs> Script a live session: export default async page => {…}
  --save-trace          Keep the raw Chrome trace alongside the report

output and checks (any performance run):
  --json                Print a machine-readable result on stdout (progress and
                        tables go to stderr)
  --out <file>          Also write that result to a file (input for compare)
  --config <file>       Budgets file (default: spectra.config.json in the project)

compare options:
  <before> <after>      Each: a report id, a report file, a --out result file,
                        or several ids joined by commas
  --json, --out <file>  As above
  --fail-on-regression  Exit with code 2 when a key metric got worse

Budgets (spectra.config.json in your project root):
  { "budgets": { "tbtMs": 200, "lcpMs": 2500, "cls": 0.1, "criticalFindings": 0 } }

Exit codes: 0 done · 1 could not run · 2 over budget / regression

Examples:
  spectra performance                              # self-boot + golden-path suite
  spectra performance --paths 8                    # cap the suite at 8 journeys
  spectra performance --url http://localhost:3000/ # evaluate a running server
  spectra performance --quick --runs 5 --out before.json
  spectra performance --quick --runs 5 --out after.json
  spectra compare before.json after.json           # did the change help?
  spectra fix --max-fixes 3                        # let an agent fix them, verified
  spectra performance --json | jq .summary         # pipe it anywhere
`;

// What a terminate signal must clean up: the running script and a dev server
// Spectra started. Without this, stopping Spectra from outside (an editor or
// an AI client cancelling a run) would leave the dev server running.
const active = { child: null, server: null };
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    active.child?.kill(signal);
    Promise.resolve(active.server?.stop())
      .catch(() => {})
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

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
    active.child = child;
    child.on('exit', code => {
      if (active.child === child) active.child = null;
      resolve(code ?? 0);
    });
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
 * The scripts run with the package as their working directory, so path
 * options the user typed relative to their own directory are made absolute
 * here, before they cross over.
 */
function absolutize(args, names) {
  return args.map((a, i) =>
    i > 0 && names.includes(args[i - 1].replace(/^--/, '')) && args[i - 1].startsWith('--') && !a.startsWith('--')
      ? path.resolve(process.cwd(), a)
      : a,
  );
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
  let args = absolutize(rest, ['scenario', 'out', 'config']);

  // --quick is shorthand for a single page-load profile.
  if (args.includes('--quick')) {
    const mode = takeOption(args, 'mode').value;
    if ((mode && mode !== 'load') || args.includes('--scenario')) {
      console.error('spectra: --quick is a page-load profile; it cannot be combined with --mode live or --scenario.');
      return 1;
    }
    args = args.filter(a => a !== '--quick');
    if (!mode) args.push('--mode', 'load');
  }

  // Golden-path evaluation is the default. --mode/--scenario opt into the
  // classic single-page profile instead.
  const classic = args.includes('--mode') || args.includes('--scenario');
  const script = classic ? 'server/cli.js' : 'server/explore/evaluate-cli.js';
  if (!classic && args.includes('--runs')) {
    console.error(
      'spectra: --runs works with single-page profiles (--quick, --mode or --scenario); the golden-path suite records each journey once.',
    );
    return 1;
  }

  // An explicit --url means the server is already running: run against it.
  if (args.includes('--url')) {
    return runNodeAsync(script, args, env);
  }

  // No --url: self-boot the target project's own dev server, run, stop.
  const cwd = process.cwd();
  const { value: command, rest: afterCmd } = takeOption(args, 'command');
  const { value: bootTimeout, rest: profileArgs } = takeOption(afterCmd, 'boot-timeout');
  const fw = detectFramework(cwd);
  const label = [fw.framework, fw.bundler].filter(x => x && x !== 'unknown').join('/');
  // Status goes to stderr so it never mixes with the report on stdout.
  console.error(
    `spectra: no --url given — starting the ${label ? `${label} ` : ''}dev server in ${cwd} …`,
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
  active.server = server;
  console.error(`spectra: dev server ready at ${server.url} — profiling …\n`);

  let code = 1;
  try {
    code = await runNodeAsync(
      script,
      [...profileArgs, '--url', server.url],
      env,
    );
  } finally {
    active.server = null;
    await server.stop();
    console.error('\nspectra: stopped the dev server.');
  }
  return code;
}

function runCompare() {
  // Sides may be files relative to the user's directory (ids pass through).
  const fixToken = t =>
    t.endsWith('.json') || existsSync(path.resolve(process.cwd(), t)) ? path.resolve(process.cwd(), t) : t;
  const args = absolutize(rest, ['out']).map((a, i, all) =>
    a.startsWith('--') || all[i - 1] === '--out' ? a : a.split(',').map(fixToken).join(','),
  );
  return runNodeAsync('server/compare-cli.js', args, projectEnv());
}

function runDashboard() {
  // Standalone server: serves the prebuilt dashboard and the backend API, so an
  // installed Spectra needs no dev toolchain. projectEnv() points it at this
  // project's reports and source roots.
  const child = spawn(
    process.execPath,
    [path.join(PKG_ROOT, 'server/dashboard.js'), ...rest],
    {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...projectEnv() },
    },
  );
  active.child = child;
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
  case 'compare':
  case 'reports': {
    const run = command === 'compare' ? runCompare() : runNodeAsync('server/reports-cli.js', rest, projectEnv());
    run
      .then(code => process.exit(code ?? 0))
      .catch(err => {
        console.error(`spectra: ${err.message}`);
        process.exit(1);
      });
    break;
  }
  case 'fix':
    // In-process, in the user's project: the harness manages its own copy,
    // dev server and child processes (server/fix/cli.js).
    import('../server/fix/cli.js').catch(err => {
      console.error(`spectra: ${err.message}`);
      process.exit(1);
    });
    break;
  case 'mcp':
    // In-process: stdin/stdout are the protocol channel, and the working
    // directory stays the user's (the project, unless --project or the
    // client's roots say otherwise).
    import('../server/mcp.js').catch(err => {
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
