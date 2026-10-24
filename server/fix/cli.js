/**
 * The unattended mode of `spectra improve` (and `spectra fix`, its old name).
 * It runs in the user's project: profiles a copy of the last commit, hands
 * the costliest findings in the project's own code to a coding agent one at
 * a time, and keeps a change only when the project's checks pass and Spectra
 * measures it faster beyond run-to-run noise. Kept changes are commits on a
 * new branch; nothing else is touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intOption, parseArgs } from '../args.js';
import { bootDevServer } from '../explore/boot.js';
import { EXIT, SPECTRA_VERSION } from '../output.js';
import { agentFromOption, claudeAgent, detectAgent } from './agent.js';
import { detectChecks, runChecks } from './checks.js';
import { runFix } from './harness.js';
import { reportMarkdown } from './report.js';
import { changesIn, commitChange, commitsOn, createWorkspace, diffOf, ignoreSpectra, removeWorkspace, repoOf, uncommitted, undoChanges } from './workspace.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/spectra.js');
const VALUES = ['runs', 'max-fixes', 'agent', 'model', 'max-budget-usd', 'check', 'command', 'boot-timeout', 'branch', 'out', 'max-lines', 'url'];

/**
 * Runs a session. `agent` is the agent to use when the options name none;
 * without it, the agent found on the machine, or Claude Code.
 * @returns {Promise<number>} the exit code
 */
export async function runFixCli(argv, { agent: given = null } = {}) {
  const { opt, flag } = parseArgs(argv, { values: VALUES });
  const log = line => console.error(`spectra: ${line}`);
  const json = flag('json');
  const fail = message => {
    throw Object.assign(new Error(message), { early: true });
  };

  const checksFrom = () => {
    const list = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--check' && argv[i + 1]) list.push({ name: argv[i + 1], cmd: argv[++i] });
    return list;
  };

  const controller = new AbortController();
  let ws = null;
  let server = null;
  let child = null;
  let session = null;
  let repo = null;
  let branch = null;
  let sessionDir = null;
  const projectDir = process.cwd();

  async function cleanup() {
    await server?.stop().catch(() => {});
    if (ws && !flag('keep-worktree')) removeWorkspace(repo.root, ws, { keepBranch: commitsOn(repo.root, ws.branch) > 0 });
  }
  const onSignal = signal => {
    controller.abort();
    child?.kill('SIGTERM');
    log('stopping …');
    cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, onSignal);

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

  let agent = given;
  try {
    const runs = intOption(opt('runs'), 'runs', { min: 1, max: 10, fallback: 3 });
    const maxFixes = intOption(opt('max-fixes'), 'max-fixes', { min: 1, max: 20, fallback: 3 });
    const maxLines = intOption(opt('max-lines'), 'max-lines', { min: 1, max: 5000, fallback: 150 });
    if (opt('url')) fail('spectra improve starts its own dev server in a copy of your project, so it does not take --url. Use --command if the dev server needs a special command, or `spectra improve next` to work on a running page.');

    repo = repoOf(projectDir);
    const dirty = uncommitted(repo.root);
    if (dirty.length)
      fail(`commit or stash your changes first: spectra improve works on a copy of your last commit, and these would not be in it:\n  ${dirty.slice(0, 6).join('\n  ')}${dirty.length > 6 ? '\n  …' : ''}`);

    let checks = checksFrom();
    if (!checks.length && !flag('no-checks')) checks = detectChecks(projectDir);
    if (!checks.length && !flag('no-checks'))
      fail('no checks to run. A faster page must not be a broken one, so spectra improve needs at least one check that proves the app still works: add a test script, pass --check "<cmd>" (it can test the running app at $SPECTRA_FIX_URL), or pass --no-checks to rely on measurements alone.');
    if (flag('no-checks')) checks = [];

    if (!agent) {
      const agentOpts = { model: opt('model') === true ? undefined : opt('model'), budgetUsd: Number(opt('max-budget-usd') ?? 2) };
      const found = opt('agent') ? null : detectAgent();
      agent = opt('agent') ? agentFromOption(String(opt('agent')), agentOpts) : found ? agentFromOption(found.id, { ...agentOpts, bin: found.bin }) : claudeAgent(agentOpts);
    }

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const sessionRoot = path.join(projectDir, '.spectra', 'improve');
    sessionDir = path.join(sessionRoot, stamp);
    const historyFile = path.join(sessionRoot, 'history.json');
    branch = typeof opt('branch') === 'string' ? opt('branch') : `spectra/improve-${stamp}`;
    fs.mkdirSync(path.join(sessionDir, 'results'), { recursive: true });
    ignoreSpectra(repo.root);

    if (branchExists(repo.root, branch)) fail(`branch ${branch} already exists; pass --branch <name>.`);
    log(`working in a copy of ${shortHead(repo.root)} on branch ${branch}, with ${agent.name} …`);
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
    if (/cannot work/.test(err.message) && agent?.id === 'claude' && !opt('agent'))
      console.error('spectra: sign in to Claude Code first (run `claude` once), set SPECTRA_CLAUDE to its path, or pass --agent <name|"command">.');
    await cleanup();
    for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, onSignal);
    return EXIT.ERROR;
  }

  await cleanup();
  for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, onSignal);
  const md = reportMarkdown(session);
  fs.writeFileSync(path.join(sessionDir, 'report.md'), md);
  fs.writeFileSync(path.join(sessionDir, 'report.json'), `${JSON.stringify(session, null, 2)}\n`);
  if (opt('out') && typeof opt('out') === 'string') fs.writeFileSync(path.resolve(opt('out')), `${JSON.stringify(session, null, 2)}\n`);

  const rel = p => path.relative(projectDir, p) || '.';
  const n = session.attempts.length;
  console.error('');
  if (!n && !session.skipped.length) console.error("Spectra improve — nothing to fix: nothing in your own code crossed Spectra's thresholds.");
  else console.error(`Spectra improve — ${session.kept} of ${n} problem${n === 1 ? '' : 's'} fixed`);
  for (const a of session.attempts) console.error(`  ${a.outcome === 'kept' ? '✓ fixed   ' : '✗ undone  '} ${a.finding.title} (${a.finding.file}${a.finding.line ? `:${a.finding.line}` : ''})${a.outcome === 'kept' ? `: ${a.reason}` : ` — ${a.reason}`}`);
  for (const s of session.skipped) console.error(`  – skipped  ${s.title} — ${s.reason}`);
  if (session.final) {
    console.error(`\nOverall, before → after: ${session.final.verdict.toUpperCase()} (confidence: ${session.final.confidence})`);
    for (const h of session.final.headlines) console.error(`  ${h.kind === 'improved' ? '✓' : '✗'} ${h.text}`);
  }
  if (session.kept) console.error(`\nThe fixes are on branch ${branch}, one commit each, with the measurements in the commit messages.\nReview them with:  git log -p HEAD..${branch}\nthen merge the branch or open a pull request. Your own files were not touched.`);
  console.error(`\nReport: ${rel(path.join(sessionDir, 'report.md'))}`);
  if (json) process.stdout.write(`${JSON.stringify(session)}\n`);
  return EXIT.OK;
}

function branchExists(root, name) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: root }).status === 0;
}
function shortHead(root) {
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
}
