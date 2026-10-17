/**
 * The isolated copy `spectra fix` works in: a git worktree of the last commit
 * on its own branch, inside .spectra/fix/<session>/ (which git is told to
 * ignore). Every attempt is either committed on that branch or undone, so a
 * failed attempt never reaches the user's working tree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const gitRaw = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (cwd, args) => gitRaw(cwd, args).trim();
const tryGit = (cwd, args) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

/** The repository around `dir`, and where the project sits inside it. */
export function repoOf(dir) {
  const root = tryGit(dir, ['rev-parse', '--show-toplevel']);
  if (!root) throw new Error('spectra fix needs a git repository: it works on a copy of your last commit.');
  const real = fs.realpathSync(dir);
  return { root: fs.realpathSync(root), sub: path.relative(fs.realpathSync(root), real) };
}

/** Uncommitted changes in the project (other than Spectra's own files). */
export function uncommitted(root) {
  return gitRaw(root, ['status', '--porcelain', '--untracked-files=normal'])
    .split('\n')
    .filter(Boolean)
    .filter(l => !/(^|\/)\.spectra(\/|$)/.test(l.slice(3)));
}

/** Tell git, locally, to ignore .spectra/ so the session never shows up as a change. */
export function ignoreSpectra(root) {
  const file = path.resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']));
  const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!now.split('\n').some(l => l.trim() === '.spectra/' || l.trim() === '.spectra')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${now && !now.endsWith('\n') ? '\n' : ''}.spectra/\n`);
  }
}

/**
 * A worktree of HEAD on a new branch, with the project's dependencies linked
 * in (or installed fresh, with install).
 */
export function createWorkspace({ root, sub, dir, branch, install = false, log = () => {} }) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(root, ['worktree', 'add', '-q', '-b', branch, dir, 'HEAD']);
  const projectDir = path.join(dir, sub);
  if (install) {
    const lock = f => fs.existsSync(path.join(projectDir, f));
    const [cmd, ...args] = lock('pnpm-lock.yaml') ? ['pnpm', 'install', '--frozen-lockfile'] : lock('yarn.lock') ? ['yarn', 'install', '--frozen-lockfile'] : lock('package-lock.json') ? ['npm', 'ci'] : ['npm', 'install'];
    log(`installing dependencies in the copy (${cmd} ${args.join(' ')}) …`);
    const r = spawnSync(cmd, args, { cwd: projectDir, stdio: 'ignore', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in the copy.`);
  } else {
    // node_modules of the project and of the repository root (hoisted workspaces)
    for (const rel of new Set([sub, ''])) {
      const from = path.join(root, rel, 'node_modules');
      const to = path.join(dir, rel, 'node_modules');
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  return { dir, projectDir, branch };
}

/** What the agent changed: [{ path, status, added, removed }], paths relative to the project. */
export function changesIn(ws) {
  const status = gitRaw(ws.projectDir, ['status', '--porcelain', '--untracked-files=all', '--', '.'])
    .split('\n')
    .filter(Boolean)
    .map(l => ({ status: l.slice(0, 2).trim()[0] === '?' ? 'A' : l.slice(0, 2).trim()[0], file: l.slice(3).replace(/^"|"$/g, '') }))
    .filter(c => !/(^|\/)node_modules$/.test(c.file));
  const counts = new Map(
    git(ws.projectDir, ['diff', '--numstat', 'HEAD', '--', '.'])
      .split('\n')
      .filter(Boolean)
      .map(l => {
        const [a, r, f] = l.split('\t');
        return [f, { added: Number(a) || 0, removed: Number(r) || 0 }];
      }),
  );
  const prefix = git(ws.projectDir, ['rev-parse', '--show-prefix']);
  return status.map(c => {
    const rel = c.file.startsWith(prefix) ? c.file.slice(prefix.length) : c.file;
    const n = counts.get(c.file) || (c.status === 'A' ? { added: lineCount(path.join(ws.dir, c.file)), removed: 0 } : { added: 0, removed: 0 });
    return { path: rel, status: c.status, ...n };
  });
}
const lineCount = file => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
};

/** The diff of the files a change touched, for the report. */
export const diffOf = ws => git(ws.projectDir, ['diff', 'HEAD', '--', '.']);

/** Commit exactly these files on the session branch. */
export function commitChange(ws, files, message) {
  git(ws.projectDir, ['add', '--', ...files]);
  const named = tryGit(ws.dir, ['config', 'user.email']);
  const who = named ? [] : ['-c', 'user.name=Spectra fix', '-c', 'user.email=spectra-fix@localhost'];
  git(ws.dir, [...who, 'commit', '-q', '-m', message]);
  undoChanges(ws); // anything the checks left behind
  return git(ws.dir, ['rev-parse', '--short', 'HEAD']);
}

/** Undo everything since the last commit (the dependency link stays). */
export function undoChanges(ws) {
  git(ws.dir, ['reset', '-q', '--hard']);
  git(ws.dir, ['clean', '-fdq', '-e', 'node_modules']);
}

/** Remove the copy; keep the branch only if it holds fixes. */
export function removeWorkspace(root, ws, { keepBranch }) {
  tryGit(root, ['worktree', 'remove', '--force', ws.dir]);
  if (fs.existsSync(ws.dir)) fs.rmSync(ws.dir, { recursive: true, force: true });
  tryGit(root, ['worktree', 'prune']);
  if (!keepBranch) tryGit(root, ['branch', '-D', ws.branch]);
}

export const commitsOn = (root, branch) => Number(tryGit(root, ['rev-list', '--count', `HEAD..${branch}`]) || 0);
