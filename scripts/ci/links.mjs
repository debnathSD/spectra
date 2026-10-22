// Links into the repository at the commit being checked, for CI notes.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const repo = process.env.GITHUB_REPOSITORY || 'progen-labs/spectra';
const sha = process.env.HEAD_SHA || process.env.GITHUB_SHA || 'main';
const root = process.env.GITHUB_WORKSPACE || process.cwd();

/** A path relative to the repository root, from an absolute path, a file:// URL or a relative one. */
export const repoPath = file => {
  let f = String(file || '');
  if (f.startsWith('file://')) f = fileURLToPath(f);
  if (path.isAbsolute(f)) f = path.relative(root, f);
  return f.split(path.sep).join('/');
};
/** `[server/x.js:12](…/blob/<sha>/server/x.js#L12)` */
export const fileLink = (file, line) => {
  const rel = repoPath(file);
  return `[\`${rel}${line ? `:${line}` : ''}\`](${server}/${repo}/blob/${sha}/${rel}${line ? `#L${line}` : ''})`;
};
/** A GitHub workflow command that puts an annotation on the line, in the run and on the pull request's files. */
export const annotate = (file, line, title, message) =>
  console.log(`::error file=${repoPath(file)},line=${line || 1},title=${title.replace(/[,:\n]/g, ' ')}::${String(message).replace(/\r?\n/g, ' ').slice(0, 900)}`);
