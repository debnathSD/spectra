/**
 * The GitHub Action's engine (see action.yml). Runs Spectra on this commit
 * and, for a pull request with compare-to-base, on the base commit too, in a
 * git worktree on the same runner, so both sides are measured the same way.
 * Then writes the job summary, the outputs and (optionally) a PR comment, and
 * decides whether the check fails.
 *
 * Inputs arrive as SPECTRA_* environment variables (set by action.yml).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MARKER, failureReason, summaryMarkdown } from './summary.mjs';

const env = process.env;
const input = (name, fallback = '') => (env[`SPECTRA_${name}`] ?? '').trim() || fallback;
const bool = (name, fallback) => /^(true|1|yes)$/i.test(input(name, String(fallback)));

const WORKSPACE = env.GITHUB_WORKSPACE || process.cwd();
const CWD = path.resolve(WORKSPACE, input('WORKING_DIRECTORY', '.'));
const OUT = path.join(env.RUNNER_TEMP || path.join(CWD, '.spectra'), 'spectra-action');
const MODE = input('MODE', 'quick');
const ARTIFACT = input('ARTIFACT_NAME', 'spectra-reports');

const log = (...a) => console.log(...a);
const group = (title, fn) => {
  log(`::group::${title}`);
  try {
    return fn();
  } finally {
    log('::endgroup::');
  }
};
const output = (name, value) => env.GITHUB_OUTPUT && fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\n/g, ' ')}\n`);

/**
 * How to run Spectra, resolved once from this commit and used for the base
 * commit too: both sides are measured by the same Spectra, even when the base
 * pins an older one or doesn't have it yet.
 */
function cliFor(dir) {
  const custom = input('CLI');
  if (/\.[cm]?js$/.test(custom)) return { cmd: process.execPath, prefix: [path.resolve(WORKSPACE, custom)] };
  if (custom) return { cmd: custom.split(' ')[0], prefix: custom.split(' ').slice(1) };
  const local = path.join(dir, 'node_modules', '@progen-labs', 'spectra', 'bin', 'spectra.js');
  if (fs.existsSync(local) && !input('VERSION')) return { cmd: process.execPath, prefix: [local] };
  return { cmd: 'npx', prefix: ['-y', `@progen-labs/spectra@${input('VERSION', 'latest')}`] };
}

function spectraArgs(outFile) {
  const args = ['performance', '--json', '--out', outFile];
  if (MODE === 'golden-paths') args.push('--paths', input('PATHS', '6'));
  else args.push('--mode', 'load', '--runs', input('RUNS', '3'));
  if (input('URL')) args.push('--url', input('URL'));
  if (input('COMMAND')) args.push('--command', input('COMMAND'));
  if (input('CONFIG')) args.push('--config', path.resolve(CWD, input('CONFIG')));
  return args;
}

const CLI = cliFor(CWD);

/** Runs Spectra, streaming its log; resolves with the exit code. */
function runSpectra(dir, args) {
  const cli = CLI;
  const chromeArgs = [env.PERF_CHROME_ARGS, process.platform === 'linux' && !bool('CHROME_SANDBOX', false) ? '--no-sandbox' : '']
    .filter(Boolean)
    .join(' ');
  log(`$ ${[cli.cmd, ...cli.prefix, ...args].join(' ')}`);
  return new Promise(resolve => {
    const child = spawn(cli.cmd, [...cli.prefix, ...args], {
      cwd: dir,
      env: { ...env, PERF_CHROME_ARGS: chromeArgs },
      stdio: ['ignore', 'ignore', 'inherit'], // the JSON goes to --out; tables go to stderr
      shell: process.platform === 'win32',
    });
    child.on('close', code => resolve(code ?? 1));
    child.on('error', err => {
      console.error(`::error::${err.message}`);
      resolve(1);
    });
  });
}

const git = (args, opts = {}) => {
  const res = spawnSync('git', args, { cwd: CWD, encoding: 'utf8', ...opts });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr.trim()}`);
  return res.stdout.trim();
};

function installCommand(dir) {
  if (input('INSTALL_COMMAND')) return input('INSTALL_COMMAND');
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm install --frozen-lockfile';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn install --frozen-lockfile';
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm ci';
  return 'npm install';
}

/** Profiles the pull request's base commit in a worktree. Returns { file, code } or null. */
async function profileBase() {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    /* no event payload */
  }
  const sha = input('BASE_SHA') || event.pull_request?.base?.sha;
  if (!sha) {
    log('::notice::compare-to-base needs a pull_request event (or base-sha); skipping the base run.');
    return null;
  }
  const repoRoot = git(['rev-parse', '--show-toplevel']);
  const worktree = path.join(OUT, 'base');
  fs.rmSync(worktree, { recursive: true, force: true });
  group(`Check out the base commit ${sha.slice(0, 7)}`, () => {
    try {
      git(['cat-file', '-e', `${sha}^{commit}`]);
    } catch {
      git(['fetch', '--no-tags', '--depth=1', 'origin', sha]);
    }
    git(['worktree', 'add', '--detach', worktree, sha]);
  });
  const baseDir = path.join(worktree, path.relative(repoRoot, CWD));
  const install = installCommand(baseDir);
  const ok = group(`Install the base commit's dependencies (${install})`, () => spawnSync(install, { cwd: baseDir, shell: true, stdio: 'inherit' }).status === 0);
  if (!ok) {
    log('::warning::Installing the base commit failed; skipping the comparison.');
    return null;
  }
  const file = path.join(OUT, 'base.json');
  log('::group::Profile the base commit');
  const code = await runSpectra(baseDir, spectraArgs(file));
  log('::endgroup::');
  return code !== 1 && fs.existsSync(file) ? { file, code, worktree } : null;
}

async function compare(baseFile, headFile) {
  const file = path.join(OUT, 'compare.json');
  const code = await runSpectra(CWD, ['compare', baseFile, headFile, '--json', '--out', file]);
  return code !== 1 && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).comparison : null;
}

async function comment(body) {
  const token = input('GITHUB_TOKEN');
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    /* none */
  }
  const number = event.pull_request?.number;
  if (!token || !number || !env.GITHUB_REPOSITORY) {
    log('::notice::comment: true needs a pull_request event and a token; skipped.');
    return;
  }
  const api = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/issues`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  try {
    const list = await (await fetch(`${api}/${number}/comments?per_page=100`, { headers })).json();
    const mine = Array.isArray(list) && list.find(c => c.body?.includes(MARKER));
    const res = await fetch(mine ? `${api}/comments/${mine.id}` : `${api}/${number}/comments`, {
      method: mine ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    log(mine ? 'Updated the pull request comment.' : 'Commented on the pull request.');
  } catch (err) {
    log(`::warning::Could not comment on the pull request (does the workflow grant pull-requests: write?): ${err.message}`);
  }
}

// ------------------------------------------------------------------ main

fs.mkdirSync(OUT, { recursive: true });
const headFile = path.join(OUT, 'head.json');
log('::group::Profile this commit');
const headCode = await runSpectra(CWD, spectraArgs(headFile));
log('::endgroup::');
if (headCode === 1 || !fs.existsSync(headFile)) {
  console.error('::error::Spectra could not profile this commit. See the log above.');
  output('result-file', '');
  process.exit(1);
}
const head = JSON.parse(fs.readFileSync(headFile, 'utf8'));

let base = null;
let comparison = null;
if (bool('COMPARE_TO_BASE', false)) {
  if (MODE !== 'quick') log('::notice::compare-to-base compares page-load profiles; use mode: quick.');
  else {
    const b = await profileBase();
    if (b) {
      base = JSON.parse(fs.readFileSync(b.file, 'utf8'));
      comparison = await compare(b.file, headFile);
      try {
        git(['worktree', 'remove', '--force', b.worktree]);
      } catch {
        /* leave it; the runner is discarded */
      }
    }
  }
}

const reproduce = `npx spectra ${MODE === 'golden-paths' ? `performance --paths ${input('PATHS', '6')}` : `performance --quick --runs ${input('RUNS', '3')}`}${input('URL') ? ` --url ${input('URL')}` : ''}`;
const markdown = summaryMarkdown({ head, base, comparison, reproduce, artifact: ARTIFACT });
const summaryFile = path.join(OUT, 'summary.md');
fs.writeFileSync(summaryFile, markdown);
if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
if (bool('COMMENT', false)) await comment(markdown);

output('result-file', headFile);
output('summary-file', summaryFile);
output('over-budget', headCode === 2);
output('verdict', comparison?.verdict || '');

const reason = failureReason({ headCode, comparison, failOnBudget: bool('FAIL_ON_BUDGET', true), failOnRegression: bool('FAIL_ON_REGRESSION', false) });
if (reason) {
  console.error(`::error::${reason}`);
  process.exit(1);
}
log('Spectra: check passed.');
