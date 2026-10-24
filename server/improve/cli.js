/**
 * spectra improve — make the app faster. Two ways, with the same rules:
 *
 *   spectra improve             unattended: a coding agent on this machine makes
 *                               the changes in a copy of the project, and only
 *                               what passes the checks and measures faster is
 *                               kept, as commits on a new branch (../fix/)
 *   spectra improve next        guided: Spectra measures and names the next
 *   spectra improve check       problem; an AI agent (or you) changes the code in
 *   spectra improve report      the working tree; Spectra measures the change and
 *   spectra improve stop        says whether to keep it (./session.js)
 *
 * Without an agent on the machine, `spectra improve` starts a guided session.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intOption, parseArgs } from '../args.js';
import { bootDevServer } from '../explore/boot.js';
import { EXIT, SPECTRA_VERSION, exitAfterFlush } from '../output.js';
import { AGENT_IDS, agentFromOption, detectAgent } from '../fix/agent.js';
import { detectChecks, runChecks } from '../fix/checks.js';
import { ignoreSpectra, repoOf } from '../fix/workspace.js';
import { checkTask, checkText, nextTask, overall, reportMarkdown, reportText, startSession, taskText } from './session.js';
import { RESULT_SCHEMA_VERSION } from '../../shared/result.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/spectra.js');
const STEPS = ['next', 'check', 'report', 'stop'];
const VALUES = ['url', 'runs', 'max-fixes', 'check', 'command', 'boot-timeout', 'config', 'login-url', 'login-user', 'login', 'throttle', 'agent', 'model', 'max-budget-usd', 'branch', 'max-lines', 'out'];
// options the profiling runs take as they are (how to reach the page, and how to sign in)
const PASS_THROUGH = ['config', 'login-url', 'login-user', 'login', 'throttle'];

export const HELP = `usage: spectra improve [options]
       spectra improve next | check | report | stop [options]

Makes the app faster: measures it, finds the problems in your own code, has
each one fixed, measures again, and keeps only what measurably helped.

Unattended (spectra improve): a coding agent on this machine makes the
changes in a copy of your last commit. Kept fixes are commits on a new
branch, for you to review. Spectra finds the agent by itself
(${AGENT_IDS.join(', ')}), or take --agent.

Guided (next, check, report, stop): for the AI agent you are talking to, or
for you. "next" measures and names the next problem; after the change,
"check" measures it and says whether to keep it, then names the next one;
"report" sums up; "stop" ends the session.

  --url <page>            The page to make faster (default: the dev server's home page,
                          started and stopped by Spectra)
  --max-fixes <n>         Problems to attempt (default 3 unattended, 5 guided)
  --runs <n>              Page loads per measurement (default 3)
  --check "<cmd>"         A check that must pass after every change (repeat it
                          for several). Default: your test, typecheck and
                          build scripts. Checks can test the running app at
                          $SPECTRA_FIX_URL
  --no-checks             Rely on measurements alone (not recommended)
  --command "<cmd>"       The dev-server command (default: your npm dev script)
  --boot-timeout <s>      How long to wait for the dev server (default 60)
  --login-url, --login-user, --login <method>, --config <file>
                          Sign in first, as for spectra performance
  --json, --out <file>    Machine-readable output

unattended only:
  --agent <name|"cmd">    ${AGENT_IDS.join(', ')}, or your own
                          command (it gets the instructions on stdin)
  --model <name>          Model for Claude Code
  --max-budget-usd <n>    Claude Code's spending cap per finding (default 2)
  --install               Install dependencies in the copy instead of linking yours
  --branch <name>         Branch for the fixes (default spectra/improve-<time>)
  --max-lines <n>         Largest change accepted (default 150 lines)
  --retry                 Try problems that failed in an earlier session
  --keep-worktree         Keep the copy in .spectra/improve/ for inspection

guided only:
  --restart               End the current session and start over (with next)`;

export async function runImproveCli(argv) {
  const { opt, flag, positionals } = parseArgs(argv, { values: VALUES });
  if (flag('help') || flag('h')) {
    console.log(HELP);
    return EXIT.OK;
  }
  const step = positionals.find(p => STEPS.includes(p));
  if (positionals.length && !step) {
    console.error(`spectra: improve takes one of ${STEPS.join(', ')} (got "${positionals[0]}"). See spectra improve --help.`);
    return EXIT.ERROR;
  }
  if (step) return guided(step, argv, { opt, flag });

  // unattended, with the agent named or found; without one, the guided mode's first step
  const agentOpts = { model: opt('model') === true ? undefined : opt('model'), budgetUsd: Number(opt('max-budget-usd') ?? 2) };
  let agent = null;
  try {
    agent = opt('agent') ? agentFromOption(String(opt('agent')), agentOpts) : (found => found && agentFromOption(found.id, { ...agentOpts, bin: found.bin }))(detectAgent());
  } catch (err) {
    console.error(`spectra: ${err.message}`);
    return EXIT.ERROR;
  }
  if (agent) {
    const { runFixCli } = await import('../fix/cli.js');
    return runFixCli(argv, { agent });
  }
  console.error(`spectra: no coding agent found on this machine (${AGENT_IDS.join(', ')}), so Spectra cannot make the changes unattended.`);
  console.error('spectra: starting a guided session instead: ask your AI agent to "improve the performance", or make each change yourself.\n');
  return guided('next', argv, { opt, flag });
}

// ------------------------------------------------------------------ guided

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

async function guided(step, argv, { opt, flag }) {
  const json = flag('json');
  const log = json ? console.error : console.log; // with --json, stdout carries only the result
  const status = line => console.error(`spectra: ${line}`);
  const projectDir = process.cwd();
  const root = path.join(projectDir, '.spectra', 'improve');
  const currentFile = path.join(root, 'current.json');
  const historyFile = path.join(root, 'history.json');
  const readJson = (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  };
  const save = session => fs.writeFileSync(currentFile, `${JSON.stringify(session, null, 2)}\n`);
  try {
    ignoreSpectra(repoOf(projectDir).root);
  } catch {
    /* not a git repository: fine for the guided mode */
  }

  let runs;
  let maxFixes;
  try {
    runs = intOption(opt('runs'), 'runs', { min: 1, max: 10, fallback: 3 });
    maxFixes = intOption(opt('max-fixes'), 'max-fixes', { min: 1, max: 20, fallback: 5 });
  } catch (err) {
    console.error(`spectra: ${err.message}`);
    return EXIT.ERROR;
  }

  let session = readJson(currentFile, null);
  if (step === 'next' && flag('restart') && session) {
    await finish(session, { archive: true });
    session = null;
  }

  // the result for --json / --out, and the text for people and agents
  const emit = (message, extra = {}) => {
    log(message);
    const result = { schemaVersion: RESULT_SCHEMA_VERSION, kind: 'improve', spectraVersion: SPECTRA_VERSION, createdAt: new Date().toISOString(), step, message, ...extra, session };
    if (opt('out') && typeof opt('out') === 'string') fs.writeFileSync(path.resolve(opt('out')), `${JSON.stringify(result, null, 2)}\n`);
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  };
  const total = s => s.attempts.length + (s.task ? 1 : 0) + s.queue.length;

  // ---- the dev server, for the commands that measure
  const active = { server: null, child: null };
  const stopServer = async () => {
    const s = active.server;
    active.server = null;
    if (s) {
      await s.stop().catch(() => {});
      status('stopped the dev server.');
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      active.child?.kill('SIGTERM');
      stopServer().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
    });
  const pageUrl = async s => {
    if (s.fixedUrl) return s.fixedUrl;
    if (!active.server) {
      const command = s.command || (typeof opt('command') === 'string' ? opt('command') : undefined);
      status(`starting the dev server in ${projectDir}${command ? ` (${command})` : ''} …`);
      active.server = await bootDevServer({ root: projectDir, command, timeoutMs: (Number(s.bootTimeout || opt('boot-timeout')) || 60) * 1000 });
      status(`dev server ready at ${active.server.url}`);
    }
    return active.server.url;
  };

  /** `spectra <args> --json`, in the project; resolves with the parsed result. */
  const spectra = (args, dir) =>
    new Promise((resolve, reject) => {
      active.child = spawn(process.execPath, [BIN, ...args, '--json'], {
        cwd: projectDir,
        env: { ...process.env, PERF_FRONTEND_DIR: projectDir, PERF_REPORTS_DIR: path.join(dir, 'reports') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      active.child.stdout.on('data', d => (out += d));
      active.child.stderr.on('data', d => {
        err += d;
        for (const line of String(d).split('\n')) if (/^spectra: run \d+\/\d+/.test(line)) console.error(`           ${line.replace(/^spectra:\s*/, '')}`);
      });
      active.child.on('error', reject);
      active.child.on('close', code => {
        active.child = null;
        if (code === 1) return reject(new Error(err.trim().split('\n').filter(l => l.startsWith('spectra:')).pop()?.replace(/^spectra:\s*/, '') || `spectra ${args[0]} failed`));
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error(`spectra ${args[0]} printed no result`));
        }
      });
    });
  const passThrough = s => s.profileArgs || [];
  const deps = s => ({
    profile: async label => {
      const url = await pageUrl(s);
      const file = path.join(s.dir, 'results', `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now()}.json`);
      const result = await spectra(['performance', '--quick', '--runs', String(s.runs), '--url', url, ...passThrough(s), '--out', file], s.dir);
      return { file, result };
    },
    compare: async (before, after) => (await spectra(['compare', before.join(','), after.join(',')], s.dir)).comparison,
    runChecks: s.checkCommands?.length
      ? async () => runChecks(s.checkCommands, { cwd: projectDir, env: { SPECTRA_FIX_URL: await pageUrl(s) } })
      : null,
    log: status,
  });

  async function finish(s, { archive }) {
    const result = await overall(s, deps(s).compare).catch(() => null);
    fs.writeFileSync(path.join(s.dir, 'report.md'), reportMarkdown(s, result));
    fs.writeFileSync(path.join(s.dir, 'session.json'), `${JSON.stringify(s, null, 2)}\n`);
    if (archive) fs.rmSync(currentFile, { force: true });
    return result;
  }
  const remember = s => {
    const history = readJson(historyFile, {});
    for (const a of s.attempts) history[a.finding.key] = { title: a.finding.title, outcome: a.outcome, at: new Date().toISOString() };
    fs.writeFileSync(historyFile, `${JSON.stringify(history, null, 2)}\n`);
  };

  try {
    if (step === 'next') {
      if (!session) {
        const dir = path.join(root, stamp());
        fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
        // the checks: --check, or the project's own; none is allowed here, the measurements then decide alone
        let checkCommands = [];
        for (let i = 0; i < argv.length; i++) if (argv[i] === '--check' && argv[i + 1]) checkCommands.push({ name: argv[i + 1], cmd: argv[++i] });
        if (!checkCommands.length && !flag('no-checks')) checkCommands = detectChecks(projectDir);
        const meta = {
          id: path.basename(dir),
          dir,
          runs,
          fixedUrl: typeof opt('url') === 'string' ? opt('url') : null,
          command: typeof opt('command') === 'string' ? opt('command') : null,
          bootTimeout: Number(opt('boot-timeout')) || null,
          profileArgs: PASS_THROUGH.flatMap(name => (typeof opt(name) === 'string' ? [`--${name}`, name === 'config' ? path.resolve(opt(name)) : opt(name)] : [])),
          checkCommands,
        };
        status(`measuring the baseline (${runs} page loads) …`);
        session = await startSession({ ...deps(meta), exists: f => fs.existsSync(path.join(projectDir, f)), history: readJson(historyFile, {}), retry: flag('retry'), maxFixes, checks: checkCommands, meta });
        if (!checkCommands.length) status('no checks found (no test, typecheck or build script): the measurements decide alone.');
      }
      const task = nextTask(session);
      save(session);
      if (!task) {
        const result = await finish(session, { archive: false });
        emit(`${reportText(session, result)}\n\nNothing left to try in this session. Run:  npx spectra improve next --restart  to measure again from the start.`, { task: null, result });
      } else emit(taskText(task, { total: total(session) }), { task });
    } else if (step === 'check') {
      if (!session) throw new Error('no session: run `npx spectra improve next` first.');
      const { attempt, next } = await checkTask(session, deps(session));
      save(session);
      remember(session);
      emit(checkText(attempt, next, { total: total(session) }), { attempt, task: next });
    } else if (step === 'report') {
      if (!session) throw new Error('no session: run `npx spectra improve next` first.');
      const result = await finish(session, { archive: false });
      emit(`${reportText(session, result)}\n\nReport: ${path.relative(projectDir, path.join(session.dir, 'report.md'))}`, { result });
    } else {
      if (!session) throw new Error('no session to stop.');
      const result = await finish(session, { archive: true });
      remember(session);
      emit(`${reportText(session, result)}\n\nSession ended. Report: ${path.relative(projectDir, path.join(session.dir, 'report.md'))}`, { result });
    }
  } catch (err) {
    console.error(`spectra: ${err.message}`);
    await stopServer();
    return EXIT.ERROR;
  }
  await stopServer();
  return EXIT.OK;
}

/** Entry point for bin/spectra.js: runs, then exits once stdout is flushed. */
export async function main(argv) {
  let code = EXIT.ERROR;
  try {
    code = await runImproveCli(argv);
  } catch (err) {
    console.error(`spectra: ${err.message}`);
  }
  exitAfterFlush(code);
}
