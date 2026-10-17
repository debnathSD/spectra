/**
 * spectra fix — the AI fix harness. It runs in the user's project: profiles a
 * copy of the last commit, hands the costliest findings in the project's own
 * code to a coding agent one at a time, and keeps a change only when the
 * project's checks pass and Spectra measures it faster beyond run-to-run
 * noise. Kept changes are commits on a new branch; nothing else is touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intOption, parseArgs } from '../args.js';
import { bootDevServer } from '../explore/boot.js';
import { SPECTRA_VERSION } from '../output.js';
import { claudeAgent, commandAgent } from './agent.js';
import { detectChecks, runChecks } from './checks.js';
import { runFix } from './harness.js';
import { reportMarkdown } from './report.js';
import { changesIn, commitChange, commitsOn, createWorkspace, diffOf, ignoreSpectra, removeWorkspace, repoOf, uncommitted, undoChanges } from './workspace.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/spectra.js');
const argv = process.argv.slice(3);
const { opt, flag } = parseArgs(argv, { values: ['runs', 'max-fixes', 'agent', 'model', 'max-budget-usd', 'check', 'command', 'boot-timeout', 'branch', 'out', 'max-lines'] });
const log = line => console.error(`spectra: ${line}`);
const json = flag('json');

const HELP = `usage: spectra fix [options]

The AI fix harness. In an isolated copy of your last commit, it hands the
costliest findings in your own code to a coding agent one at a time, then
keeps a change only if your checks pass and Spectra measures it faster
beyond run-to-run noise. Kept changes are commits on a new branch.

  --max-fixes <n>         Findings to attempt (default 3)
  --runs <n>              Page loads per measurement (default 3)
  --check "<cmd>"         A check that must pass after every change (repeat it
                          for several). Default: your test, typecheck and
                          build scripts. Checks can test the running app at
                          $SPECTRA_FIX_URL.
  --no-checks             Rely on measurements alone (not recommended)
  --agent "<cmd>"         Your own agent: gets the instructions on stdin and in
                          $SPECTRA_FIX_PROMPT_FILE, runs in the copy
  --model <name>          Model for Claude Code, the default agent
  --max-budget-usd <n>    Claude Code's spending cap per finding (default 2)
  --command "<cmd>"       The dev-server command (default: your npm dev script)
  --boot-timeout <s>      How long to wait for the dev server (default 60)
  --install               Install dependencies in the copy instead of linking yours
  --branch <name>         Branch for the fixes (default spectra/fix-<time>)
  --max-lines <n>         Largest change accepted (default 150 lines)
  --retry                 Try findings that failed in an earlier session
  --keep-worktree         Keep the copy in .spectra/fix/ for inspection
  --json, --out <file>    Machine-readable session report`;

if (flag('help') || flag('h')) {
  console.log(HELP);
  process.exit(0);
}

const fail = (message, code = 1) => {
  console.error(`spectra: ${message}`);
  process.exit(code);
};

const checksFrom = () => {
  const list = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--check' && argv[i + 1]) list.push({ name: argv[i + 1], cmd: argv[++i] });
  return list;
};

let runs;
let maxFixes;
let maxLines;
try {
  runs = intOption(opt('runs'), 'runs', { min: 1, max: 10, fallback: 3 });
  maxFixes = intOption(opt('max-fixes'), 'max-fixes', { min: 1, max: 20, fallback: 3 });
  maxLines = intOption(opt('max-lines'), 'max-lines', { min: 1, max: 5000, fallback: 150 });
} catch (err) {
  fail(err.message);
}
if (opt('url')) fail('spectra fix starts its own dev server in a copy of your project, so it does not take --url. Use --command if the dev server needs a special command.');

const projectDir = process.cwd();
let repo;
try {
  repo = repoOf(projectDir);
} catch (err) {
  fail(err.message);
}
const dirty = uncommitted(repo.root);
if (dirty.length)
  fail(`commit or stash your changes first: spectra fix works on a copy of your last commit, and these would not be in it:\n  ${dirty.slice(0, 6).join('\n  ')}${dirty.length > 6 ? '\n  …' : ''}`);

let checks = checksFrom();
if (!checks.length && !flag('no-checks')) checks = detectChecks(projectDir);
if (!checks.length && !flag('no-checks'))
  fail('no checks to run. A faster page must not be a broken one, so spectra fix needs at least one check that proves the app still works: add a test script, pass --check "<cmd>" (it can test the running app at $SPECTRA_FIX_URL), or pass --no-checks to rely on measurements alone.');
if (flag('no-checks')) checks = [];

const agent = opt('agent')
  ? commandAgent(String(opt('agent')))
  : claudeAgent({ model: opt('model') === true ? undefined : opt('model'), budgetUsd: Number(opt('max-budget-usd') ?? 2) });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const sessionRoot = path.join(projectDir, '.spectra', 'fix');
const sessionDir = path.join(sessionRoot, stamp);
const historyFile = path.join(sessionRoot, 'history.json');
let branch = typeof opt('branch') === 'string' ? opt('branch') : `spectra/fix-${stamp}`;
fs.mkdirSync(path.join(sessionDir, 'results'), { recursive: true });
ignoreSpectra(repo.root);

const controller = new AbortController();
let ws = null;
let server = null;
let child = null;
let session = null;

async function cleanup() {
  await server?.stop().catch(() => {});
  if (ws && !flag('keep-worktree')) removeWorkspace(repo.root, ws, { keepBranch: commitsOn(repo.root, ws.branch) > 0 });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    controller.abort();
    child?.kill('SIGTERM');
    log('stopping …');
    cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

/** `spectra <args> --json` in the copy; resolves with the parsed result. */
function spectra(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [BIN, ...args, '--json'], {
      cwd: ws.projectDir,
      env: { ...process.env, PERF_FRONTEND_DIR: ws.projectDir, PERF_REPORTS_DIR: path.join(sessionDir, 'reports') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => {
      err += d;
      for (const line of String(d).split('\n')) if (/^spectra: run \d+\/\d+/.test(line)) console.error(`           ${line.replace(/^spectra:\s*/, '')}`);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 1) return reject(new Error(err.trim().split('\n').filter(l => l.startsWith('spectra:')).pop()?.replace(/^spectra:\s*/, '') || `spectra ${args[0]} failed`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`spectra ${args[0]} printed no result`));
      }
    });
  });
}

const slug = s => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

try {
  if (branchExists(branch)) throw new Error(`branch ${branch} already exists; pass --branch <name>.`);
  log(`working in a copy of ${shortHead()} on branch ${branch} …`);
  ws = createWorkspace({ root: repo.root, sub: repo.sub, dir: path.join(sessionDir, 'worktree'), branch, install: flag('install'), log });
  ws.exists = file => fs.existsSync(path.join(ws.projectDir, file));
  ws.changes = () => changesIn(ws);
  ws.diff = () => diffOf(ws);
  ws.commit = (files, message) => commitChange(ws, files, message);
  ws.undo = () => undoChanges(ws);

  const command = typeof opt('command') === 'string' ? opt('command') : undefined;
  log(`starting the dev server in the copy${command ? ` (${command})` : ''} …`);
  server = await bootDevServer({ root: ws.projectDir, command, timeoutMs: (Number(opt('boot-timeout')) || 60) * 1000 });
  log(`dev server ready at ${server.url}`);

  let history = {};
  try {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  } catch {
    /* first session */
  }

  session = await runFix({
    agent,
    workspace: ws,
    checks,
    history,
    retry: flag('retry'),
    maxFixes,
    maxLines,
    url: server.url,
    signal: controller.signal,
    log,
    runChecks: () => runChecks(checks, { cwd: ws.projectDir, env: { SPECTRA_FIX_URL: server.url }, signal: controller.signal }),
    profile: async label => {
      const file = path.join(sessionDir, 'results', `${slug(label)}.json`);
      const result = await spectra(['performance', '--quick', '--runs', String(runs), '--url', server.url, '--out', file]);
      return { file, result };
    },
    compare: async (before, after) => (await spectra(['compare', before.join(','), after.join(',')])).comparison,
  });
  Object.assign(session, { kind: 'fix', spectraVersion: SPECTRA_VERSION, project: projectDir, branch, runs, startedAt: stamp, sessionDir });

  for (const a of session.attempts) history[a.finding.key] = { title: a.finding.title, outcome: a.outcome, at: new Date().toISOString() };
  fs.writeFileSync(historyFile, `${JSON.stringify(history, null, 2)}\n`);
} catch (err) {
  console.error(`spectra: ${err.message}`);
  if (err.tail) console.error(err.tail.replace(/^/gm, '  | '));
  if (/cannot work/.test(err.message) && !opt('agent'))
    console.error('spectra: sign in to Claude Code first (run `claude` once), set SPECTRA_CLAUDE to its path, or pass --agent "<command>".');
  await cleanup();
  process.exit(1);
}

await cleanup();
const md = reportMarkdown(session);
fs.writeFileSync(path.join(sessionDir, 'report.md'), md);
fs.writeFileSync(path.join(sessionDir, 'report.json'), `${JSON.stringify(session, null, 2)}\n`);
if (opt('out') && typeof opt('out') === 'string') fs.writeFileSync(path.resolve(opt('out')), `${JSON.stringify(session, null, 2)}\n`);

const rel = p => path.relative(projectDir, p) || '.';
console.error('');
console.error(`Spectra fix — ${session.kept} of ${session.attempts.length} finding${session.attempts.length === 1 ? '' : 's'} fixed`);
for (const a of session.attempts) console.error(`  ${a.outcome === 'kept' ? '✓ kept    ' : '✗ undone  '} ${a.finding.title} (${a.finding.file}${a.finding.line ? `:${a.finding.line}` : ''})${a.outcome === 'kept' ? '' : ` — ${a.reason}`}`);
if (session.final) {
  console.error(`\nOverall: ${session.final.verdict.toUpperCase()} (confidence: ${session.final.confidence})`);
  for (const h of session.final.headlines) console.error(`  ${h.kind === 'improved' ? '✓' : '✗'} ${h.text}`);
}
if (session.kept) console.error(`\nThe fixes are on branch ${branch}. Review them with:\n  git log -p HEAD..${branch}\nthen merge the branch or open a pull request.`);
console.error(`\nReport: ${rel(path.join(sessionDir, 'report.md'))}`);
if (json) process.stdout.write(`${JSON.stringify(session)}\n`);
process.exit(0);

function branchExists(name) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: repo.root }).status === 0;
}
function shortHead() {
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo.root, encoding: 'utf8' }).stdout.trim();
}
