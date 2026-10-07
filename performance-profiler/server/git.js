/**
 * Commit metadata for labelling recordings, so two snapshots can be compared as
 * "before this commit / after this commit". Only the author's *name* is read
 * (never the email), and only commit metadata: no file contents or diffs.
 */
import { execFileSync } from 'node:child_process';

const FIELD = '\x1f';
const FORMAT = ['%H', '%h', '%an', '%aI', '%s'].join('%x1f');
// A hash (4-40 hex) or HEAD: never a free-form ref, so nothing here can look like a git option.
const REV = /^(?:HEAD|[0-9a-fA-F]{4,40})$/;

const git = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 1024 * 1024,
  }).trim();

export function isValidRev(rev) {
  return typeof rev === 'string' && REV.test(rev);
}

/**
 * @param {string} cwd  a directory inside the repository
 * @param {string} [rev] 'HEAD' or a commit hash (full or abbreviated)
 * @returns {{hash: string, shortHash: string, author: string, date: string,
 *   subject: string, branch: string|null, dirty: boolean|null} | null}
 */
export function gitInfo(cwd, rev = 'HEAD') {
  if (!isValidRev(rev)) return null;
  try {
    const [hash, shortHash, author, date, subject] = git(
      ['log', '-1', `--format=${FORMAT}`, rev, '--'],
      cwd,
    ).split(FIELD);
    if (!hash) return null;
    const isHead = rev === 'HEAD';
    return {
      hash,
      shortHash,
      author,
      date,
      subject,
      branch: isHead ? git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) : null,
      // Uncommitted edits to tracked frontend sources mean the hash does not describe what was measured.
      // The profiler's own folder is excluded: it is a dev tool, not the code being profiled.
      dirty: isHead
        ? git(
            ['status', '--porcelain', '-uno', '--', '.', ':(exclude)tools'],
            cwd,
          ).length > 0
        : null,
    };
  } catch {
    return null;
  }
}
