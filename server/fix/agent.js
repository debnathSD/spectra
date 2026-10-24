/**
 * The coding agent `spectra improve` hands one finding to when it runs
 * unattended. Spectra knows the common agent CLIs by name (AGENTS below) and
 * finds one on the machine by itself; Claude Code runs allowed only to read
 * and edit files: no shell, no web, no MCP servers. Any other agent works
 * through --agent "<command>": it gets the instructions on stdin (and in
 * $SPECTRA_FIX_PROMPT_FILE) and runs in the copy of the project.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The agents Spectra can run by name: how each one takes a single prompt,
 * edits files in the current directory without asking, and exits (the
 * "print" mode every CLI agent has), and the signs that it is in use.
 */
export const AGENTS = {
  claude: { name: 'Claude Code', bin: 'claude', project: ['CLAUDE.md', '.claude'], home: ['.claude', '.claude.json'], also: ['.local/bin/claude', '.claude/local/claude'] },
  codex: { name: 'Codex CLI', bin: 'codex', args: p => ['exec', '--full-auto', p], project: ['.codex'], home: ['.codex'] },
  gemini: { name: 'Gemini CLI', bin: 'gemini', args: p => ['-p', p, '--yolo'], project: ['GEMINI.md', '.gemini'], home: ['.gemini'] },
  copilot: { name: 'GitHub Copilot CLI', bin: 'copilot', args: p => ['-p', p, '--allow-all-tools'], project: ['.github/copilot-instructions.md', '.github/instructions'], home: ['.copilot'] },
  cursor: { name: 'Cursor CLI', bin: 'cursor-agent', args: p => ['-p', p, '--force'], project: ['.cursor', '.cursorrules'], home: ['.cursor'] },
  opencode: { name: 'OpenCode', bin: 'opencode', args: p => ['run', p], project: ['opencode.json', '.opencode'], home: ['.config/opencode'] },
  amp: { name: 'Amp', bin: 'amp', args: p => ['-x', p], project: [], home: ['.config/amp'] },
};
export const AGENT_IDS = Object.keys(AGENTS);

const exists = p => {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** Where an agent's executable is: on PATH, or in the places its installer uses. Null when it is not installed. */
export function findExecutable(id, { env = process.env, home = os.homedir() } = {}) {
  const a = AGENTS[id];
  if (id === 'claude' && env.SPECTRA_CLAUDE) return env.SPECTRA_CLAUDE;
  const names = process.platform === 'win32' ? [`${a.bin}.cmd`, `${a.bin}.exe`, a.bin] : [a.bin];
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean))
    for (const n of names) if (exists(path.join(dir, n))) return path.join(dir, n);
  for (const rel of a.also || []) if (home && exists(path.join(home, rel))) return path.join(home, rel);
  return null;
}

/**
 * The agent to run unattended, when none was named: first one the project or
 * the machine shows signs of (so it is the agent the user already works with),
 * then any that is installed. Null when there is none.
 */
export function detectAgent({ root = process.cwd(), home = os.homedir(), env = process.env } = {}) {
  const installed = AGENT_IDS.filter(id => findExecutable(id, { env, home }));
  const inUse = id => (AGENTS[id].project || []).some(p => exists(path.join(root, p))) || (AGENTS[id].home || []).some(p => home && exists(path.join(home, p)));
  const id = installed.find(inUse) || installed[0];
  return id ? { id, ...AGENTS[id], bin: findExecutable(id, { env, home }) } : null;
}

/** The agent for --agent: a name from AGENTS, or any shell command. */
export function agentFromOption(value, opts = {}) {
  return AGENTS[value] ? namedAgent(value, opts) : commandAgent(String(value), opts);
}

/** One of AGENTS, ready to run. */
export function namedAgent(id, { bin, model, budgetUsd, timeoutMs = 10 * 60_000, env, home } = {}) {
  const a = AGENTS[id];
  if (!a) throw new Error(`unknown agent "${id}"; the names are ${AGENT_IDS.join(', ')}, or pass a command.`);
  const executable = bin || findExecutable(id, { env, home }) || a.bin;
  if (id === 'claude') return claudeAgent({ bin: executable, model, budgetUsd, timeoutMs });
  return {
    id,
    name: a.name,
    async run(prompt, { cwd, signal }) {
      let res;
      try {
        res = await run(executable, a.args(prompt), { cwd, signal, timeoutMs, env: { CI: '1' } });
      } catch (err) {
        throw new Error(`could not start ${a.name} (${err.message}). Install it, or pass --agent "<command>".`);
      }
      if (res.code !== 0) throw new Error(`${a.name} exited with code ${res.code}: ${(res.err || res.out).trim().split('\n').slice(-3).join(' ')}`);
      return { summary: res.out.trim().split('\n').filter(Boolean).pop()?.slice(0, 300) || '', costUsd: null, turns: null, error: null };
    },
  };
}

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
    id: 'claude',
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
