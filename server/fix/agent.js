/**
 * The coding agent `spectra fix` hands one finding to. By default it is Claude
 * Code in headless mode, allowed only to read and edit files: no shell, no
 * web, no MCP servers. Any other agent works through --agent "<command>": it
 * gets the instructions on stdin (and in $SPECTRA_FIX_PROMPT_FILE) and runs in
 * the copy of the project.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = (cmd, args, { cwd, input, env, signal, timeoutMs, shell = false }) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], shell });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', e => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error(`${cmd} was not found`) : e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ code, out, err });
    });
    child.stdin.end(input ?? '');
  });

/** Claude Code, headless. */
export function claudeAgent({ bin = process.env.SPECTRA_CLAUDE || 'claude', model, budgetUsd = 2, timeoutMs = 10 * 60_000 } = {}) {
  return {
    name: `Claude Code${model ? ` (${model})` : ''}`,
    async run(prompt, { cwd, signal }) {
      const args = [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Read Edit Write Glob Grep',
        '--disallowedTools',
        'Bash WebFetch WebSearch',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--max-budget-usd',
        String(budgetUsd),
        ...(model ? ['--model', model] : []),
      ];
      let res;
      try {
        res = await run(bin, args, { cwd, signal, timeoutMs });
      } catch (err) {
        throw new Error(`could not start Claude Code (${err.message}). Install it (https://claude.com/claude-code), set SPECTRA_CLAUDE to its path, or pass --agent "<command>".`);
      }
      let parsed = null;
      try {
        parsed = JSON.parse(res.out.trim().split('\n').pop());
      } catch {
        /* not JSON */
      }
      if (res.code !== 0 && !parsed) throw new Error(`Claude Code exited with code ${res.code}: ${(res.err || res.out).trim().split('\n').slice(-3).join(' ')}`);
      return {
        summary: String(parsed?.result ?? res.out).trim().split('\n').filter(Boolean).pop()?.slice(0, 300) || '',
        costUsd: parsed?.total_cost_usd ?? null,
        turns: parsed?.num_turns ?? null,
        error: parsed?.is_error ? String(parsed.result || 'agent error') : null,
      };
    },
  };
}

/** Any agent, as a shell command run in the copy of the project. */
export function commandAgent(command, { timeoutMs = 10 * 60_000 } = {}) {
  return {
    name: command,
    async run(prompt, { cwd, signal, finding }) {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-fix-')), 'prompt.md');
      fs.writeFileSync(file, prompt);
      try {
        const res = await run(command, [], { cwd, input: prompt, signal, timeoutMs, shell: true, env: { SPECTRA_FIX_PROMPT_FILE: file, SPECTRA_FIX_FINDING: JSON.stringify(finding) } });
        if (res.code !== 0) throw new Error(`the agent exited with code ${res.code}: ${(res.err || res.out).trim().split('\n').slice(-2).join(' ')}`);
        return { summary: res.out.trim().split('\n').filter(Boolean).pop()?.slice(0, 300) || '', costUsd: null, turns: null, error: null };
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    },
  };
}
