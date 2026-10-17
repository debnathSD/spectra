/**
 * The project's own checks: the tests, type check and build that must pass
 * after every change, so a "faster" page is never a broken one. A check can
 * test the live app at $SPECTRA_FIX_URL.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PLACEHOLDER = /no test specified/;

/** Checks from package.json scripts: test, typecheck and build. */
export function detectChecks(projectDir) {
  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')).scripts || {};
  } catch {
    /* no package.json */
  }
  const checks = [];
  if (scripts.test && !PLACEHOLDER.test(scripts.test)) checks.push({ name: 'npm test', cmd: 'npm test' });
  const typecheck = ['typecheck', 'type-check', 'check-types', 'tsc'].find(s => scripts[s]);
  if (typecheck) checks.push({ name: `npm run ${typecheck}`, cmd: `npm run ${typecheck}` });
  if (scripts.build) checks.push({ name: 'npm run build', cmd: 'npm run build' });
  return checks;
}

/** Run checks in order, stopping at the first failure. */
export async function runChecks(checks, { cwd, env = {}, signal, timeoutMs = 10 * 60_000 }) {
  const results = [];
  for (const check of checks) {
    const t0 = Date.now();
    const res = await new Promise(resolve => {
      const child = spawn(check.cmd, { cwd, shell: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', d => (out = (out + d).slice(-4000)));
      child.stderr.on('data', d => (out = (out + d).slice(-4000)));
      const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
      const abort = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', e => resolve({ code: 127, out: e.message }));
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve({ code, out });
      });
    });
    const result = { name: check.name, ok: res.code === 0, ms: Date.now() - t0, tail: res.out.trim().split('\n').slice(-12).join('\n') };
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}
