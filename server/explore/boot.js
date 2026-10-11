/**
 * Self-boot: start the target project's own dev server so `spectra performance`
 * can profile it with no --url. The server's URL is read from its stdout (every
 * common dev server — Vite, Next, CRA, Angular, Vue CLI, SvelteKit — prints a
 * localhost URL when ready), then polled until it actually responds.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ANSI = /\x1b\[[0-9;]*m/g;
const URL_RE =
  /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s)'"<]*)/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Choose a dev command from the project's package.json scripts. */
export function pickDevCommand(root) {
  let scripts = {};
  try {
    scripts = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ).scripts || {};
  } catch {
    // no package.json / unreadable — fall through
  }
  for (const name of ['dev', 'start', 'serve', 'develop']) {
    if (scripts[name]) return { cmd: 'npm', args: ['run', name], label: `npm run ${name}` };
  }
  return null;
}

function normalizeUrl(u) {
  return u.replace('://0.0.0.0', '://localhost').replace(/\/$/, '');
}

/** Poll a URL until it responds (any HTTP status) or the deadline passes. */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ctrl = AbortSignal.timeout(2000);
      const res = await fetch(url, { signal: ctrl, redirect: 'manual' });
      if (res.status > 0) return true;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  return false;
}

/**
 * Start the dev server and resolve once it is reachable.
 *
 * @param {object} opts
 * @param {string} [opts.root]       project directory (default cwd)
 * @param {string} [opts.command]    explicit command, e.g. "npm run dev"
 * @param {number} [opts.timeoutMs]  how long to wait for the URL + readiness
 * @param {(line:string)=>void} [opts.onLog]  receives de-ANSI'd server output
 * @returns {Promise<{ url:string, proc:import('child_process').ChildProcess, stop:()=>Promise<void> }>}
 */
export async function bootDevServer({
  root = process.cwd(),
  command,
  timeoutMs = 60_000,
  onLog,
} = {}) {
  const chosen = command
    ? { cmd: command.split(' ')[0], args: command.split(' ').slice(1), label: command }
    : pickDevCommand(root);
  if (!chosen) {
    throw new Error(
      'no dev script found in package.json (looked for dev/start/serve/develop). ' +
        'Pass --url to profile an already-running server, or --command "<cmd>".',
    );
  }

  const proc = spawn(chosen.cmd, chosen.args, {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let detectedUrl = null;
  let resolveUrl;
  const urlPromise = new Promise(r => (resolveUrl = r));
  const scan = buf => {
    const text = buf.toString().replace(ANSI, '');
    if (onLog) onLog(text);
    if (!detectedUrl) {
      const m = text.match(URL_RE);
      if (m) {
        detectedUrl = normalizeUrl(m[1]);
        resolveUrl(detectedUrl);
      }
    }
  };
  proc.stdout.on('data', scan);
  proc.stderr.on('data', scan);

  let exited = false;
  let exitErr = null;
  proc.on('exit', code => {
    exited = true;
    if (code) exitErr = new Error(`dev server (${chosen.label}) exited early with code ${code}`);
    resolveUrl(null);
  });
  proc.on('error', err => {
    exited = true;
    exitErr = new Error(`could not start dev server (${chosen.label}): ${err.message}`);
    resolveUrl(null);
  });

  const stop = async () => {
    if (exited) return;
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 10 && !exited; i++) await sleep(150);
    if (!exited) {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  };

  const url = await Promise.race([urlPromise, sleep(timeoutMs).then(() => null)]);
  if (exitErr) throw exitErr;
  if (!url) {
    await stop();
    throw new Error(
      'could not detect the dev server URL from its output in time. Pass --url explicitly.',
    );
  }

  const ok = await waitForServer(url, Math.max(5000, Math.floor(timeoutMs / 2)));
  if (!ok) {
    await stop();
    throw new Error(
      `dev server reported ${url} but it never became reachable. Pass --url explicitly.`,
    );
  }

  return { url, proc, stop };
}
