/**
 * Teaches AI coding agents about Spectra. The knowledge doc (agents/spectra.md:
 * what Spectra does, which command answers which request, how to read the
 * results, the rules) is written where each agent reads its project
 * instructions, so a user can just ask in plain words ("why is checkout
 * slow?", "did my change help?") and the agent runs the right Spectra command.
 *
 * Runs after `npm install @progen-labs/spectra` (server/postinstall.js) for the
 * agents this machine or project uses, and on demand with `spectra agents`.
 *
 * Files Spectra owns carry a `spectra:managed` marker and are replaced on
 * update; in shared files (AGENTS.md, CLAUDE.md, GEMINI.md) only the block
 * between the `spectra:start` and `spectra:end` markers is touched. A file
 * without the marker is never overwritten, and `--remove` takes everything
 * back out, leaving the rest of each file as it was.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_FILE = path.join(PKG_ROOT, 'agents', 'spectra.md');
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;

const MANAGED = 'spectra:managed';
const START = '<!-- spectra:start -->';
const END = '<!-- spectra:end -->';
const note = `written by @progen-labs/spectra ${VERSION} and replaced when it updates; remove with: npx spectra agents --remove`;
const DESCRIPTION =
  'Spectra (@progen-labs/spectra, installed in this project) measures and improves frontend performance. Use it when the user asks why the app or a page is slow, about jank, re-renders, long tasks, load time or Web Vitals (LCP, TBT, CLS, INP), to profile a page or an interaction, to prove that a change made things faster, to set performance budgets, or to profile pages behind a login.';

/** The knowledge doc, with its headings one level deeper when it sits inside another file. */
export function knowledge({ nested = false } = {}) {
  const doc = fs.readFileSync(DOC_FILE, 'utf8').trim();
  return nested ? doc.replace(/^(#{1,5}) /gm, '#$1 ') : doc;
}

const frontmatter = fields =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => (v === '' ? `${k}:` : `${k}: ${v}`))
    .join('\n')}\n---\n`;
const ownFile = (head = '') => `${head}<!-- ${MANAGED}: ${note} -->\n\n${knowledge()}\n`;
const quoted = s => JSON.stringify(s);

/**
 * Where each agent reads project instructions. `home` and `project` are the
 * signs that the agent is in use: a folder or file in the user's home, or in
 * the project. AGENTS.md, the cross-agent standard, is always written.
 */
export const TARGETS = [
  {
    id: 'agents-md',
    name: 'AGENTS.md (Codex, GitHub Copilot, Cursor, Windsurf, Zed, Jules, Amp and other agents)',
    file: 'AGENTS.md',
    block: () => knowledge({ nested: true }),
    always: true,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    file: '.claude/skills/spectra/SKILL.md',
    content: () => ownFile(frontmatter({ name: 'spectra', description: quoted(DESCRIPTION) })),
    // and a short note in its memory file, which it always reads
    also: {
      file: 'CLAUDE.md',
      block: () =>
        '## Spectra (performance)\n\nThis project has Spectra (`@progen-labs/spectra`) installed. For anything about speed, slowness, re-renders, Web Vitals or proving that a change made things faster, follow the `spectra` skill (`.claude/skills/spectra/SKILL.md`) and measure with `npx spectra …` instead of guessing.',
    },
    project: ['CLAUDE.md', '.claude'],
    home: ['.claude', '.claude.json'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    file: '.cursor/rules/spectra.mdc',
    content: () => ownFile(frontmatter({ description: quoted(DESCRIPTION), globs: '', alwaysApply: 'false' })),
    project: ['.cursor', '.cursorrules'],
    home: ['.cursor'],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot (VS Code, Visual Studio, JetBrains, the coding agent)',
    file: '.github/instructions/spectra.instructions.md',
    content: () => ownFile(frontmatter({ applyTo: quoted('**'), description: quoted(DESCRIPTION) })),
    project: ['.github/copilot-instructions.md', '.github/instructions', '.github/prompts', '.vscode'],
    home: ['.vscode', '.vscode-insiders', '.config/github-copilot'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    file: '.windsurf/rules/spectra.md',
    content: () => ownFile(frontmatter({ trigger: 'model_decision', description: quoted(DESCRIPTION) })),
    project: ['.windsurf', '.windsurfrules'],
    home: ['.codeium/windsurf'],
  },
  {
    id: 'cline',
    name: 'Cline',
    file: '.clinerules/spectra.md',
    content: () => ownFile(),
    project: ['.clinerules'],
    home: ['Documents/Cline'],
  },
  {
    id: 'roo',
    name: 'Roo Code',
    file: '.roo/rules/spectra.md',
    content: () => ownFile(),
    project: ['.roo', '.roorules'],
    home: ['.roo'],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    file: 'GEMINI.md',
    block: () => knowledge({ nested: true }),
    project: ['GEMINI.md', '.gemini'],
    home: ['.gemini'],
  },
];
export const TARGET_IDS = TARGETS.map(t => t.id);

const exists = p => {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** The agents this project or machine uses, plus AGENTS.md. */
export function detectTargets({ root, home = os.homedir() }) {
  return TARGETS.filter(
    t => t.always || (t.project || []).some(p => exists(path.join(root, p))) || (t.home || []).some(p => home && exists(path.join(home, p))),
  ).map(t => t.id);
}

/** What `agentDocs` in spectra.config.json asks for: false (none), an array of target ids, or undefined (the default). */
export function readAgentDocsSetting(root) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'spectra.config.json'), 'utf8'));
    return config?.agentDocs;
  } catch {
    return undefined;
  }
}

const blockText = text => `${START}\n<!-- ${note} -->\n\n${text}\n${END}`;

// where Spectra's block is in a shared file: [start, end), or null
function findBlock(text) {
  const i = text.indexOf(START);
  const j = i < 0 ? -1 : text.indexOf(END, i);
  return i < 0 || j < 0 ? null : [i, j + END.length];
}

// the file without Spectra's block, and the blank lines it was set apart with
function withoutBlock(text) {
  const [i, j] = findBlock(text);
  const head = text.slice(0, i).replace(/\s*$/, '');
  const tail = text.slice(j).replace(/^\s*/, '');
  const rest = head && tail ? `${head}\n\n${tail}` : head || tail;
  return rest ? `${rest.replace(/\s*$/, '')}\n` : '';
}

function writeBlock(file, text, dryRun) {
  const before = exists(file) ? fs.readFileSync(file, 'utf8') : null;
  const block = blockText(text);
  const at = before == null ? null : findBlock(before);
  const after =
    before == null
      ? `${block}\n`
      : at
        ? `${before.slice(0, at[0])}${block}${before.slice(at[1])}` // in place: the rest stays exactly as it was
        : `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${block}\n`;
  if (after === before) return 'unchanged';
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, after);
  }
  return before == null ? 'created' : 'updated';
}

function writeOwn(file, content, dryRun) {
  const before = exists(file) ? fs.readFileSync(file, 'utf8') : null;
  if (before != null && !before.includes(MANAGED)) return 'skipped (a file of yours is already there)';
  if (before === content) return 'unchanged';
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return before == null ? 'created' : 'updated';
}

/**
 * Writes the knowledge doc for the given targets (default: the detected ones).
 * Returns [{ id, name, file, result }], result being created, updated,
 * unchanged or skipped (…).
 */
export function installAgentDocs({ root, targets, home, dryRun = false } = {}) {
  const ids = targets || detectTargets({ root, home });
  const out = [];
  for (const t of TARGETS.filter(x => ids.includes(x.id))) {
    const file = path.join(root, t.file);
    out.push({ id: t.id, name: t.name, file: t.file, result: t.block ? writeBlock(file, t.block(), dryRun) : writeOwn(file, t.content(), dryRun) });
    if (t.also) out.push({ id: t.id, name: t.name, file: t.also.file, result: writeBlock(path.join(root, t.also.file), t.also.block(), dryRun) });
  }
  return out;
}

// removes now-empty folders Spectra made, up to (not including) the project root
function pruneDirs(dir, root) {
  while (dir.startsWith(root) && dir !== root) {
    try {
      if (fs.readdirSync(dir).length) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/** Takes the knowledge doc out of every agent's files; the rest of each file stays. */
export function removeAgentDocs({ root, dryRun = false } = {}) {
  const out = [];
  const files = TARGETS.flatMap(t => [{ t, file: t.file, block: !!t.block }, ...(t.also ? [{ t, file: t.also.file, block: true }] : [])]);
  for (const { t, file: rel, block } of files) {
    const file = path.join(root, rel);
    if (!exists(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (block) {
      if (!findBlock(text)) continue;
      const rest = withoutBlock(text);
      if (!dryRun) {
        if (rest) fs.writeFileSync(file, rest);
        else fs.rmSync(file); // Spectra made it: nothing else was in it
      }
      out.push({ id: t.id, name: t.name, file: rel, result: rest ? 'removed' : 'deleted' });
    } else if (text.includes(MANAGED)) {
      if (!dryRun) {
        fs.rmSync(file);
        pruneDirs(path.dirname(file), root);
      }
      out.push({ id: t.id, name: t.name, file: rel, result: 'deleted' });
    }
  }
  return out;
}

/**
 * Should the install step write the docs? Only for a real project install:
 * not in CI, not a global install, not `npx` running Spectra from its cache,
 * not Spectra's own repository, and not when the user opted out.
 */
export function postinstallPlan({ env = process.env, pkgRoot = PKG_ROOT } = {}) {
  const root = env.INIT_CWD && path.resolve(env.INIT_CWD);
  if (env.SPECTRA_AGENT_DOCS === '0' || env.SPECTRA_AGENT_DOCS === 'false') return { skip: 'SPECTRA_AGENT_DOCS=0' };
  if (env.CI && env.CI !== 'false' && env.CI !== '0') return { skip: 'CI' };
  if (env.npm_config_global === 'true') return { skip: 'a global install' };
  if (!root) return { skip: 'no project directory (INIT_CWD)' };
  const pkg = path.resolve(pkgRoot);
  if (pkg === root) return { skip: "Spectra's own repository" };
  // installed into this project's node_modules (pnpm keeps it under node_modules/.pnpm), not into npx's cache
  const real = (() => {
    try {
      return fs.realpathSync(pkg);
    } catch {
      return pkg;
    }
  })();
  const modules = path.join(root, 'node_modules') + path.sep;
  if (!pkg.startsWith(modules) && !real.startsWith(modules)) return { skip: 'not installed into this project (npx or a parent folder)' };
  if (!exists(path.join(root, 'package.json'))) return { skip: 'no package.json' };
  const setting = readAgentDocsSetting(root);
  if (setting === false) return { skip: '"agentDocs": false in spectra.config.json' };
  return { root, targets: Array.isArray(setting) ? setting.filter(id => TARGET_IDS.includes(id)) : undefined };
}

/** One line per file, for people. */
export const describe = results => results.map(r => `  ${r.result.padEnd(9)} ${r.file}  (${r.name})`).join('\n');
