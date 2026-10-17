// Finding and running the Spectra CLI. No `vscode` import (testable alone).
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const WINDOWS = process.platform === 'win32';

/**
 * How to start Spectra for a workspace, first match wins:
 *   1. the `spectra.cliPath` setting: a path to bin/spectra.js, or an executable
 *   2. the project's own install, node_modules/@progen-labs/spectra
 *   3. npx -y @progen-labs/spectra@latest
 */
function resolveCli(workspaceDir, cliPath) {
  if (cliPath) {
    const p = path.isAbsolute(cliPath) ? cliPath : path.join(workspaceDir, cliPath);
    return /\.[cm]?js$/.test(p)
      ? { command: 'node', prefix: [p], source: 'setting' }
      : { command: p, prefix: [], source: 'setting' };
  }
  const local = path.join(workspaceDir, 'node_modules', '@progen-labs', 'spectra');
  const bin = path.join(local, 'bin', 'spectra.js');
  if (fs.existsSync(bin)) {
    let version = null;
    try {
      version = JSON.parse(fs.readFileSync(path.join(local, 'package.json'), 'utf8')).version;
    } catch {
      /* unreadable: treated as unknown */
    }
    return { command: 'node', prefix: [bin], source: 'project', version };
  }
  return { command: 'npx', prefix: ['-y', '@progen-labs/spectra@latest'], source: 'npx' };
}

const describe = cli =>
  cli.source === 'project'
    ? `the project's Spectra ${cli.version || ''}`.trim()
    : cli.source === 'setting'
      ? `Spectra at ${cli.prefix[0] || cli.command}`
      : 'the latest Spectra from npm (npx)';

/**
 * Runs `spectra <args>` (with --json) in `cwd`. Resolves with the parsed
 * result and the exit code (2 = over budget, still a result). `onLine` gets
 * each status line; `token` is a cancellation token.
 */
function runSpectra(cli, args, { cwd, onLine, onOutput, token } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli.command, [...cli.prefix, ...args], {
      cwd,
      env: process.env,
      shell: WINDOWS, // npx is a .cmd file on Windows
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let buf = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => {
      const text = String(d);
      err += text;
      onOutput && onOutput(text);
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) if (line.startsWith('spectra:')) onLine && onLine(line.replace(/^spectra:\s*/, ''));
    });
    let cancelled = false;
    const sub = token && token.onCancellationRequested(() => {
      cancelled = true;
      child.kill('SIGTERM');
    });
    child.on('error', e =>
      reject(e.code === 'ENOENT' ? new Error(`Could not start "${cli.command}". Is Node.js installed and on your PATH?`) : e),
    );
    child.on('close', code => {
      sub && sub.dispose();
      if (cancelled) return reject(Object.assign(new Error('Cancelled.'), { cancelled: true }));
      let json = null;
      try {
        json = out.trim() ? JSON.parse(out) : null;
      } catch {
        /* not JSON: reported below */
      }
      if (!json) {
        const why =
          err.split('\n').filter(l => l.startsWith('spectra:')).pop() || err.trim().split('\n').pop() || `exit code ${code}`;
        return reject(new Error(why.replace(/^spectra:\s*/, '')));
      }
      resolve({ json, code });
    });
  });
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/** Starts `spectra dashboard` and resolves with its URL once it is listening. */
async function startDashboard(cli, cwd, onOutput) {
  const port = await freePort();
  const child = spawn(cli.command, [...cli.prefix, 'dashboard', '--port', String(port)], {
    cwd,
    env: process.env,
    shell: WINDOWS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The dashboard did not start within 60 seconds.')), 60_000);
    const scan = d => {
      onOutput && onOutput(String(d));
      const m = /running at (http:\/\/\S+)/.exec(String(d));
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[1], child });
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`The dashboard exited (code ${code}).`));
    });
  });
}

module.exports = { resolveCli, describe, runSpectra, startDashboard };
